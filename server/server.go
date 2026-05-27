package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	_ "modernc.org/sqlite"
)

var db *sql.DB

type Entity struct {
	ID              string   `json:"id"`
	Name            string   `json:"name"`
	WpTitle         string   `json:"wpTitle"`
	Type            string   `json:"type"`
	StartYear       int      `json:"start_year"`
	EndYear         int      `json:"end_year"`
	Latitude        float64  `json:"latitude"`
	Longitude       float64  `json:"longitude"`
	ImportanceScore int      `json:"importance_score"`
	ThumbnailURL    *string  `json:"thumbnailUrl"`
	Category        *string  `json:"category"`
	Summary         *string  `json:"summary,omitempty"`
	SyncScore       float64  `json:"sync_score,omitempty"`
	FairnessScore   float64  `json:"fairness_score,omitempty"`
	RegionWeight    float64  `json:"region_weight,omitempty"`
}

func scanEntity(rows *sql.Rows) (*Entity, error) {
	var e Entity
	var thumbnailURL, category, summary sql.NullString
	err := rows.Scan(
		&e.ID, &e.Name, &e.WpTitle, &e.Type,
		&e.StartYear, &e.EndYear, &e.Latitude, &e.Longitude,
		&e.ImportanceScore, &thumbnailURL, &category, &summary,
	)
	if err != nil {
		return nil, err
	}
	if thumbnailURL.Valid {
		e.ThumbnailURL = &thumbnailURL.String
	}
	if category.Valid {
		e.Category = &category.String
	}
	if summary.Valid {
		e.Summary = &summary.String
	}
	return &e, nil
}

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

func handleEntity(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/entity/")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing id"})
		return
	}

	rows, err := db.Query(
		"SELECT id,name,wpTitle,type,start_year,end_year,latitude,longitude,importance_score,thumbnailUrl,category,summary FROM historical_entities WHERE id = ?",
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

	resp, err := http.DefaultClient.Do(req)
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

	rows, err := db.Query(
		"SELECT id,name,wpTitle,type,start_year,end_year,latitude,longitude,importance_score,thumbnailUrl,category,summary FROM historical_entities WHERE name LIKE ? ORDER BY importance_score DESC LIMIT 10",
		"%"+q+"%",
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

	sqlStr := `SELECT id,name,wpTitle,type,start_year,end_year,latitude,longitude,importance_score,thumbnailUrl,category,summary,
		CASE WHEN (latitude BETWEEN 35 AND 72) AND (longitude BETWEEN -25 AND 45) THEN 0.3 ELSE 1.0 END as region_weight
		FROM historical_entities
		WHERE id != ?
		AND (
			(start_year BETWEEN ? AND ?) OR
			(end_year BETWEEN ? AND ?) OR
			(start_year <= ? AND end_year >= ?)
		)`
	params := []any{excludeID, s, e, s, e, s, e}

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
		var ent Entity
		var thumbnailURL, cat, summary sql.NullString
		var regionWeight float64
		err := rows.Scan(
			&ent.ID, &ent.Name, &ent.WpTitle, &ent.Type,
			&ent.StartYear, &ent.EndYear, &ent.Latitude, &ent.Longitude,
			&ent.ImportanceScore, &thumbnailURL, &cat, &summary, &regionWeight,
		)
		if err != nil {
			continue
		}
		if thumbnailURL.Valid {
			ent.ThumbnailURL = &thumbnailURL.String
		}
		if cat.Valid {
			ent.Category = &cat.String
		}
		if summary.Valid {
			ent.Summary = &summary.String
		}

		overlapStart := math.Max(float64(activeStart), float64(ent.StartYear+18))
		overlapEnd := math.Min(float64(e), float64(ent.EndYear))
		overlap := math.Max(0, overlapEnd-overlapStart)
		temporalScore := overlap / span

		dist := math.Sqrt(math.Pow(ent.Latitude-focusLat, 2) + math.Pow(ent.Longitude-focusLon, 2))
		symmetryBoost := 1 + (dist / 180)

		syncScore := temporalScore * symmetryBoost * float64(ent.ImportanceScore) * regionWeight

		scored = append(scored, ScoredEntity{Entity: ent, RegionWeight: regionWeight, SyncScore: syncScore})
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

	rows, err := db.Query(`SELECT id,name,wpTitle,type,start_year,end_year,latitude,longitude,importance_score,thumbnailUrl,category,summary
		FROM historical_entities
		WHERE (start_year <= ? AND end_year >= ?)
		AND (latitude BETWEEN ? AND ?)
		AND (longitude BETWEEN ? AND ?)
		ORDER BY importance_score DESC
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

	rows, err := db.Query(`SELECT id,name,wpTitle,type,start_year,end_year,latitude,longitude,importance_score,thumbnailUrl,category,summary,
		CASE
			WHEN (latitude BETWEEN 35 AND 72) AND (longitude BETWEEN -25 AND 45)
			THEN importance_score * 0.3
			ELSE CAST(importance_score AS REAL)
		END as fairness_score
		FROM historical_entities
		WHERE (start_year <= ? AND end_year >= ?)
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
		var ent Entity
		var thumbnailURL, cat, summary sql.NullString
		var fairnessScore float64
		err := rows.Scan(
			&ent.ID, &ent.Name, &ent.WpTitle, &ent.Type,
			&ent.StartYear, &ent.EndYear, &ent.Latitude, &ent.Longitude,
			&ent.ImportanceScore, &thumbnailURL, &cat, &summary, &fairnessScore,
		)
		if err != nil {
			continue
		}
		if thumbnailURL.Valid {
			ent.ThumbnailURL = &thumbnailURL.String
		}
		if cat.Valid {
			ent.Category = &cat.String
		}
		if summary.Valid {
			ent.Summary = &summary.String
		}
		pool = append(pool, ScoredEntity{Entity: ent, FairnessScore: fairnessScore})
	}

	if len(pool) == 0 {
		writeJSON(w, http.StatusOK, []any{})
		return
	}

	// Category balancing: top 3 per major category first
	categoryVariants := map[string][]string{
		"Leaders":      {"leaders", "leader", "person", "global history"},
		"Scientists":   {"scientists", "scientist"},
		"Artists":      {"artists", "artist"},
		"Philosophers": {"philosophers", "philosopher"},
		"Events":       {"event", "events"},
	}
	catOrder := []string{"Leaders", "Scientists", "Artists", "Philosophers", "Events"}

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

	// Static files
	buildPath := os.Getenv("FRONTEND_BUILD")
	if buildPath == "" {
		buildPath = "../frontend/build"
	}
	absPath, _ := filepath.Abs(buildPath)
	fs := http.FileServer(http.Dir(absPath))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// SPA fallback
		path := filepath.Join(absPath, r.URL.Path)
		if _, err := os.Stat(path); os.IsNotExist(err) {
			http.ServeFile(w, r, filepath.Join(absPath, "index.html"))
			return
		}
		fs.ServeHTTP(w, r)
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}

	log.Printf("listening on :%s", port)
	if err := http.ListenAndServe(":"+port, corsMiddleware(mux)); err != nil {
		log.Fatal(err)
	}
}
