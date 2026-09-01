package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/time/rate"
	_ "modernc.org/sqlite"
)

var db *sql.DB

var httpClient = &http.Client{Timeout: 5 * time.Second}

type visitor struct {
	limiter  *rate.Limiter
	lastSeen time.Time
}

var (
	visitors   = make(map[string]*visitor)
	visitorsMu sync.Mutex
)

func getVisitor(ip string) *rate.Limiter {
	visitorsMu.Lock()
	defer visitorsMu.Unlock()
	v, ok := visitors[ip]
	if !ok {
		lim := rate.NewLimiter(rate.Every(time.Minute/60), 20)
		visitors[ip] = &visitor{limiter: lim, lastSeen: time.Now()}
		return lim
	}
	v.lastSeen = time.Now()
	return v.limiter
}

func cleanupVisitors() {
	for {
		time.Sleep(time.Minute)
		visitorsMu.Lock()
		for ip, v := range visitors {
			if time.Since(v.lastSeen) > 3*time.Minute {
				delete(visitors, ip)
			}
		}
		visitorsMu.Unlock()
	}
}

// Present year, used as the end of a living person's lifespan.
const currentYear = 2026

// A death year we do not know. Only used to keep overlap queries working; the
// JSON always says the value was estimated so the UI can avoid stating it.
const assumedLifespan = 65

// entityColumns is the select list every handler shares, so scanEntity and the
// query always agree on column order.
const entityColumns = `id,name,wpTitle,type,start_year,end_year,latitude,longitude,
	importance_score,thumbnailUrl,category,summary,start_date,end_date,date_prec,
	COALESCE(fame,0),COALESCE(curated,0),COALESCE(alive,0),region,
	COALESCE(start_reliable,0),COALESCE(end_reliable,0)`

// effEnd is the year a lifespan effectively ends. An unknown death year would
// otherwise drop the row out of every BETWEEN, which is what used to happen to
// everyone still living.
var effEnd = fmt.Sprintf(
	"COALESCE(end_year, CASE WHEN alive = 1 THEN %d ELSE start_year + %d END)",
	currentYear, assumedLifespan)

type Entity struct {
	ID              string  `json:"id"`
	Name            string  `json:"name"`
	WpTitle         string  `json:"wpTitle"`
	Type            string  `json:"type"`
	StartYear       int     `json:"start_year"`
	EndYear         *int    `json:"end_year"`
	StartDate       *string `json:"start_date,omitempty"`
	EndDate         *string `json:"end_date,omitempty"`
	DatePrecision   *string `json:"date_precision,omitempty"`
	Latitude        float64 `json:"latitude"`
	Longitude       float64 `json:"longitude"`
	ImportanceScore int     `json:"importance_score"`
	Fame            float64 `json:"fame"`
	Curated         bool    `json:"curated"`
	Alive           bool    `json:"alive"`
	Region          *string `json:"region,omitempty"`
	// Birth and death are flagged separately: a date early enough that its
	// exact day is a tradition rather than a record cannot be used for
	// anything that counts days. One combined flag hid recorded death dates
	// behind an unrelated birth date.
	StartReliable bool    `json:"start_reliable"`
	EndReliable   bool    `json:"end_reliable"`
	ThumbnailURL  *string `json:"thumbnailUrl"`
	Category      *string `json:"category"`
	Summary       *string `json:"summary,omitempty"`
	SyncScore     float64 `json:"sync_score,omitempty"`
	FairnessScore float64 `json:"fairness_score,omitempty"`
	RegionWeight  float64 `json:"region_weight,omitempty"`
}

// EffectiveEnd mirrors the effEnd SQL so Go-side scoring agrees with queries.
func (e *Entity) EffectiveEnd() int {
	if e.EndYear != nil {
		return *e.EndYear
	}
	if e.Alive {
		return currentYear
	}
	return e.StartYear + assumedLifespan
}

// EndIsEstimated reports whether EffectiveEnd was invented rather than known.
func (e *Entity) EndIsEstimated() bool { return e.EndYear == nil }

// scanRow accepts either *sql.Rows or *sql.Row.
type scanner interface{ Scan(dest ...any) error }

func scanEntityFrom(s scanner, extra ...any) (*Entity, error) {
	var e Entity
	var endYear sql.NullInt64
	var thumbnailURL, category, summary sql.NullString
	var startDate, endDate, datePrec, region sql.NullString
	var curated, alive, startReliable, endReliable int

	dest := []any{
		&e.ID, &e.Name, &e.WpTitle, &e.Type,
		&e.StartYear, &endYear, &e.Latitude, &e.Longitude,
		&e.ImportanceScore, &thumbnailURL, &category, &summary,
		&startDate, &endDate, &datePrec,
		&e.Fame, &curated, &alive, &region, &startReliable, &endReliable,
	}
	dest = append(dest, extra...)

	if err := s.Scan(dest...); err != nil {
		return nil, err
	}
	if endYear.Valid {
		v := int(endYear.Int64)
		e.EndYear = &v
	}
	e.Curated = curated == 1
	e.Alive = alive == 1
	e.StartReliable = startReliable == 1
	e.EndReliable = endReliable == 1
	for _, f := range []struct {
		src sql.NullString
		dst **string
	}{
		{thumbnailURL, &e.ThumbnailURL}, {category, &e.Category}, {summary, &e.Summary},
		{startDate, &e.StartDate}, {endDate, &e.EndDate}, {datePrec, &e.DatePrecision},
		{region, &e.Region},
	} {
		if f.src.Valid {
			v := f.src.String
			*f.dst = &v
		}
	}
	return &e, nil
}

func scanEntity(rows *sql.Rows) (*Entity, error) { return scanEntityFrom(rows) }

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func securityHeadersMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "SAMEORIGIN")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		next.ServeHTTP(w, r)
	})
}

func rateLimitMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip, _, err := net.SplitHostPort(r.RemoteAddr)
		if err != nil {
			ip = r.RemoteAddr
		}
		if !getVisitor(ip).Allow() {
			writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "rate limit exceeded"})
			return
		}
		next.ServeHTTP(w, r)
	})
}

func handleEntity(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/entity/")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing id"})
		return
	}

	rows, err := db.Query(
		"SELECT "+entityColumns+" FROM historical_entities WHERE id = ?",
		id,
	)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "database error"})
		return
	}
	defer rows.Close()

	if !rows.Next() {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		return
	}
	e, err := scanEntity(rows)
	rows.Close()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "scan error"})
		return
	}

	if e.Summary != nil {
		// Return with parsed summary
		type EntityWithParsedSummary struct {
			Entity
			Summary json.RawMessage `json:"summary,omitempty"`
		}
		out := EntityWithParsedSummary{Entity: *e}
		out.Entity.Summary = nil
		out.Summary = json.RawMessage(*e.Summary)
		writeJSON(w, http.StatusOK, out)
		return
	}

	if e.WpTitle == "" {
		writeJSON(w, http.StatusOK, e)
		return
	}

	// Fetch from Wikipedia
	wpTitle := strings.ReplaceAll(e.WpTitle, " ", "_")
	wpURL := fmt.Sprintf("https://en.wikipedia.org/api/rest_v1/page/summary/%s", url.PathEscape(wpTitle))
	req, _ := http.NewRequest("GET", wpURL, nil)
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; CoincidenceBot/1.0)")
	req.Header.Set("Accept", "application/json; charset=utf-8")

	resp, err := httpClient.Do(req)
	if err != nil || resp.StatusCode != http.StatusOK {
		writeJSON(w, http.StatusOK, e)
		return
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		writeJSON(w, http.StatusOK, e)
		return
	}

	var wp map[string]any
	if err := json.Unmarshal(body, &wp); err != nil {
		writeJSON(w, http.StatusOK, e)
		return
	}
	if wpType, ok := wp["type"].(string); ok && wpType == "disambiguation" {
		writeJSON(w, http.StatusOK, e)
		return
	}

	summaryStr := string(body)
	db.Exec("UPDATE historical_entities SET summary = ? WHERE id = ?", summaryStr, id)

	type EntityWithParsedSummary struct {
		Entity
		Summary json.RawMessage `json:"summary,omitempty"`
	}
	out := EntityWithParsedSummary{Entity: *e}
	out.Entity.Summary = nil
	out.Summary = json.RawMessage(summaryStr)
	writeJSON(w, http.StatusOK, out)
}

func handleSearchName(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	if len(q) < 2 {
		writeJSON(w, http.StatusOK, []any{})
		return
	}

	// Search the alias table as well as the name column. Without this, a row
	// whose Wikidata label is a birth name is unreachable by the name people
	// actually know: "Quang Trung" never matched "Nguyễn Huệ".
	like := "%" + q + "%"
	prefix := q + "%"
	rows, err := db.Query(`
		SELECT `+entityColumns+`, MIN(match_rank) AS match_rank
		FROM (
			SELECT e.*, CASE
				WHEN e.name = ?        THEN 0
				WHEN e.name LIKE ?     THEN 1
				ELSE 2 END AS match_rank
			FROM historical_entities e WHERE e.name LIKE ?
			UNION ALL
			SELECT e.*, CASE
				WHEN a.alias = ?       THEN 0
				WHEN a.alias LIKE ?    THEN 1
				ELSE 3 END AS match_rank
			FROM historical_entities e
			JOIN entity_aliases a ON a.entity_id = e.id
			WHERE a.alias LIKE ?
		)
		GROUP BY id
		ORDER BY match_rank ASC, COALESCE(fame,0) DESC, importance_score DESC
		LIMIT 12`,
		q, prefix, like,
		q, prefix, like,
	)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "database error"})
		return
	}
	defer rows.Close()

	var results []*Entity
	for rows.Next() {
		var rank int
		e, err := scanEntityFrom(rows, &rank)
		if err != nil {
			continue
		}
		results = append(results, e)
	}
	if results == nil {
		results = []*Entity{}
	}
	writeJSON(w, http.StatusOK, results)
}

func handleContemporaries(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	s, _ := strconv.Atoi(q.Get("start"))
	e, _ := strconv.Atoi(q.Get("end"))
	excludeID := q.Get("excludeId")
	category := q.Get("category")
	focusLat, _ := strconv.ParseFloat(q.Get("lat"), 64)
	focusLon, _ := strconv.ParseFloat(q.Get("lon"), 64)

	activeStart := s + 18
	span := float64(e - s)
	if span == 0 {
		span = 1
	}

	// Two lifespans overlap when each starts before the other ends. Written
	// this way it needs no OR branches and it works for an unknown death year.
	sqlStr := `SELECT ` + entityColumns + `,
		CASE WHEN (latitude BETWEEN 35 AND 72) AND (longitude BETWEEN -25 AND 45) THEN 0.3 ELSE 1.0 END as region_weight
		FROM historical_entities
		WHERE id != ?
		AND start_year <= ? AND ` + effEnd + ` >= ?`
	params := []any{excludeID, e, s}

	if category != "" && category != "All" {
		sqlStr += " AND LOWER(category) = ?"
		params = append(params, strings.ToLower(category))
	}

	rows, err := db.Query(sqlStr, params...)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "database error"})
		return
	}
	defer rows.Close()

	type ScoredEntity struct {
		Entity
		RegionWeight float64 `json:"region_weight"`
		SyncScore    float64 `json:"sync_score"`
	}

	var scored []ScoredEntity
	for rows.Next() {
		var regionWeight float64
		ent, err := scanEntityFrom(rows, &regionWeight)
		if err != nil {
			continue
		}

		overlapStart := math.Max(float64(activeStart), float64(ent.StartYear+18))
		overlapEnd := math.Min(float64(e), float64(ent.EffectiveEnd()))
		overlap := math.Max(0, overlapEnd-overlapStart)
		temporalScore := overlap / span

		dist := haversineKm(ent.Latitude, ent.Longitude, focusLat, focusLon)
		symmetryBoost := 1 + (dist / maxEarthDistanceKm)

		// fame already carries the regional correction, so the old European
		// discount would apply it twice.
		syncScore := temporalScore * symmetryBoost * ent.Fame

		scored = append(scored, ScoredEntity{Entity: *ent, RegionWeight: regionWeight, SyncScore: syncScore})
	}

	sort.Slice(scored, func(i, j int) bool {
		return scored[i].SyncScore > scored[j].SyncScore
	})
	if len(scored) > 40 {
		scored = scored[:40]
	}
	if scored == nil {
		scored = []ScoredEntity{}
	}
	writeJSON(w, http.StatusOK, scored)
}

func handleCategories(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query("SELECT DISTINCT category FROM historical_entities WHERE category IS NOT NULL")
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "database error"})
		return
	}
	defer rows.Close()

	seen := map[string]bool{}
	var cats []string
	for rows.Next() {
		var c string
		if err := rows.Scan(&c); err != nil {
			continue
		}
		normalized := strings.ToUpper(c[:1]) + strings.ToLower(c[1:])
		if !seen[normalized] {
			seen[normalized] = true
			cats = append(cats, normalized)
		}
	}
	if cats == nil {
		cats = []string{}
	}
	writeJSON(w, http.StatusOK, cats)
}

func handleHistoryDensity(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query("SELECT (start_year / 20) * 20 as decade, COUNT(*) as count FROM historical_entities GROUP BY decade ORDER BY decade ASC")
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "database error"})
		return
	}
	defer rows.Close()

	type Bucket struct {
		Decade int `json:"decade"`
		Count  int `json:"count"`
	}
	var results []Bucket
	for rows.Next() {
		var b Bucket
		if err := rows.Scan(&b.Decade, &b.Count); err != nil {
			continue
		}
		results = append(results, b)
	}
	if results == nil {
		results = []Bucket{}
	}
	writeJSON(w, http.StatusOK, results)
}

func handleSearchRegion(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	targetYear, _ := strconv.Atoi(q.Get("year"))
	targetLat, _ := strconv.ParseFloat(q.Get("lat"), 64)
	targetLon, _ := strconv.ParseFloat(q.Get("lon"), 64)

	windowStart := targetYear - 30
	windowEnd := targetYear + 30

	rows, err := db.Query(`SELECT `+entityColumns+`
		FROM historical_entities
		WHERE type = 'person'
		AND start_year <= ? AND `+effEnd+` >= ?
		AND (latitude BETWEEN ? AND ?)
		AND (longitude BETWEEN ? AND ?)
		ORDER BY COALESCE(fame,0) DESC
		LIMIT 10`,
		windowEnd, windowStart,
		targetLat-9, targetLat+9,
		targetLon-9, targetLon+9,
	)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "database error"})
		return
	}
	defer rows.Close()

	var results []*Entity
	for rows.Next() {
		e, err := scanEntity(rows)
		if err != nil {
			continue
		}
		results = append(results, e)
	}
	if results == nil {
		results = []*Entity{}
	}
	writeJSON(w, http.StatusOK, results)
}

func handleYearSummary(w http.ResponseWriter, r *http.Request) {
	targetYear, _ := strconv.Atoi(r.URL.Query().Get("year"))

	limit := 150
	switch {
	case targetYear > 1900:
		limit = 40
	case targetYear > 1500:
		limit = 60
	case targetYear > 500:
		limit = 100
	}

	// fame is already normalized within region and century, so it is the
	// fairness score now. Curated rows get a nudge so a hand-picked figure
	// is not edged out by a well-linked minor one.
	rows, err := db.Query(`SELECT `+entityColumns+`,
		COALESCE(fame,0) + CASE WHEN curated = 1 THEN 8 ELSE 0 END as fairness_score
		FROM historical_entities
		WHERE start_year <= ? AND `+effEnd+` >= ?
		ORDER BY fairness_score DESC
		LIMIT 400`,
		targetYear, targetYear,
	)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "database error"})
		return
	}
	defer rows.Close()

	type ScoredEntity struct {
		Entity
		FairnessScore float64 `json:"fairness_score"`
	}

	var pool []ScoredEntity
	for rows.Next() {
		var fairnessScore float64
		ent, err := scanEntityFrom(rows, &fairnessScore)
		if err != nil {
			continue
		}
		pool = append(pool, ScoredEntity{Entity: *ent, FairnessScore: fairnessScore})
	}

	if len(pool) == 0 {
		writeJSON(w, http.StatusOK, []any{})
		return
	}

	// Category balancing: take the top few of each so one busy category cannot
	// fill the map on its own.
	categoryVariants := map[string][]string{
		"Leaders":    {"leaders"},
		"Scientists": {"scientists"},
		"Artists":    {"artists"},
		"Thinkers":   {"thinkers"},
		"Military":   {"military"},
		"Explorers":  {"explorers"},
		"Events":     {"events", "wars", "battles", "revolutions"},
	}
	catOrder := []string{"Leaders", "Thinkers", "Artists", "Scientists", "Military", "Explorers", "Events"}

	seen := map[string]bool{}
	var balanced []ScoredEntity

	for _, catName := range catOrder {
		variants := categoryVariants[catName]
		variantSet := map[string]bool{}
		for _, v := range variants {
			variantSet[v] = true
		}
		count := 0
		for _, e := range pool {
			if count >= 3 {
				break
			}
			if seen[e.ID] {
				continue
			}
			cat := ""
			if e.Category != nil {
				cat = strings.ToLower(*e.Category)
			}
			if variantSet[cat] {
				balanced = append(balanced, e)
				seen[e.ID] = true
				count++
			}
		}
	}

	for _, e := range pool {
		if !seen[e.ID] {
			balanced = append(balanced, e)
		}
	}

	if len(balanced) > limit {
		balanced = balanced[:limit]
	}
	writeJSON(w, http.StatusOK, balanced)
}

func handleEventContemporaries(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	start, _ := strconv.Atoi(q.Get("start"))
	end, _ := strconv.Atoi(q.Get("end"))
	if end == 0 {
		end = start + 10
	}

	latMinStr := q.Get("latMin")
	latMaxStr := q.Get("latMax")
	lonMinStr := q.Get("lonMin")
	lonMaxStr := q.Get("lonMax")
	hasRegion := latMinStr != "" && latMaxStr != "" && lonMinStr != "" && lonMaxStr != ""

	var rows *sql.Rows
	var err error
	if hasRegion {
		latMin, _ := strconv.ParseFloat(latMinStr, 64)
		latMax, _ := strconv.ParseFloat(latMaxStr, 64)
		lonMin, _ := strconv.ParseFloat(lonMinStr, 64)
		lonMax, _ := strconv.ParseFloat(lonMaxStr, 64)
		rows, err = db.Query(`
			SELECT `+entityColumns+`
			FROM historical_entities
			WHERE type = 'person'
			AND start_year <= ? AND `+effEnd+` >= ?
			AND COALESCE(fame,0) >= 20
			AND latitude BETWEEN ? AND ?
			AND longitude BETWEEN ? AND ?
			ORDER BY COALESCE(fame,0) DESC LIMIT 30`,
			end, start, latMin, latMax, lonMin, lonMax,
		)
	} else {
		rows, err = db.Query(`
			SELECT `+entityColumns+`
			FROM historical_entities
			WHERE type = 'person'
			AND start_year <= ? AND `+effEnd+` >= ?
			AND COALESCE(fame,0) >= 20
			ORDER BY COALESCE(fame,0) DESC LIMIT 30`,
			end, start,
		)
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "database error"})
		return
	}
	defer rows.Close()

	var results []*Entity
	for rows.Next() {
		e, err := scanEntity(rows)
		if err != nil {
			continue
		}
		results = append(results, e)
	}
	if results == nil {
		results = []*Entity{}
	}
	writeJSON(w, http.StatusOK, results)
}

func main() {
	dbPath := os.Getenv("DB_PATH")
	if dbPath == "" {
		dbPath = "../backend/coincidence.db"
	}

	var err error
	db, err = sql.Open("sqlite", dbPath)
	if err != nil {
		log.Fatalf("open db: %v", err)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)

	mux := http.NewServeMux()

	mux.HandleFunc("/api/entity/", handleEntity)
	mux.HandleFunc("/api/search-name", handleSearchName)
	mux.HandleFunc("/api/contemporaries", handleContemporaries)
	mux.HandleFunc("/api/categories", handleCategories)
	mux.HandleFunc("/api/history-density", handleHistoryDensity)
	mux.HandleFunc("/api/search-region", handleSearchRegion)
	mux.HandleFunc("/api/year-summary", handleYearSummary)
	mux.HandleFunc("/api/event-contemporaries", handleEventContemporaries)
	mux.HandleFunc("/api/pair", handlePair)
	mux.HandleFunc("/api/reveal", handleReveal)
	mux.HandleFunc("/api/year-card", handleYearCard)
	mux.HandleFunc("/api/waves", handleWaves)
	mux.HandleFunc("/api/wave-kinds", handleWaveKinds)
	mux.HandleFunc("/api/daily", handleDaily)
	mux.HandleFunc("/api/card", handleCard)
	mux.HandleFunc("/api/same-day", handleSameDay)
	mux.HandleFunc("/api/shared-birthday", handleSharedBirthday)
	mux.HandleFunc("/api/near-miss", handleNearMiss)

	// Static files
	buildPath := os.Getenv("FRONTEND_BUILD")
	if buildPath == "" {
		buildPath = "../frontend/build"
	}
	absPath, _ := filepath.Abs(buildPath)
	fs := http.FileServer(http.Dir(absPath))
	indexPath := filepath.Join(absPath, "index.html")
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		path := filepath.Join(absPath, r.URL.Path)
		if _, err := os.Stat(path); err == nil && r.URL.Path != "/" {
			fs.ServeHTTP(w, r)
			return
		}
		// SPA fallback. The crawler that fetches a shared link never runs the
		// app, so the social tags have to be filled in here or the link
		// previews as a bare grey line.
		doc, err := os.ReadFile(indexPath)
		if err != nil {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(injectMeta(doc, metaForPath(r, r.URL.Path)))
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}

	go cleanupVisitors()

	log.Printf("listening on :%s", port)
	if err := http.ListenAndServe(":"+port, corsMiddleware(securityHeadersMiddleware(rateLimitMiddleware(mux)))); err != nil {
		log.Fatal(err)
	}
}
