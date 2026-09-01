package main

import (
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Two ways of finding a coincidence that the pair view cannot reach on its own.
//
// Same day: people who share a calendar date, and the sharper version of it,
// someone born on the day someone else died.
//
// Near miss: two lives that did not touch. "They missed each other by four
// months" is a better story than a forty year overlap, and nothing in the site
// surfaced it even though the pair endpoint already worked it out.
//
// Both only ever use dates flagged reliable. Without that guard the same
// day view would confidently assert Plato's birthday.

// ---------------------------------------------------------------------------
// Same day
// ---------------------------------------------------------------------------

type sameDayCollision struct {
	Born       *Entity `json:"born"`
	Died       *Entity `json:"died"`
	Date       string  `json:"date"`
	YearsApart int     `json:"years_apart"`
	Sentence   string  `json:"sentence"`
}

type sameDayResult struct {
	MonthDay   string              `json:"month_day"`
	Label      string              `json:"label"`
	Born       []*Entity           `json:"born"`
	Died       []*Entity           `json:"died"`
	Collisions []*sameDayCollision `json:"collisions"`
}

var monthNames = []string{"January", "February", "March", "April", "May", "June",
	"July", "August", "September", "October", "November", "December"}

func monthDayLabel(md string) string {
	parts := strings.Split(md, "-")
	if len(parts) != 2 {
		return md
	}
	m, err1 := strconv.Atoi(parts[0])
	d, err2 := strconv.Atoi(parts[1])
	if err1 != nil || err2 != nil || m < 1 || m > 12 {
		return md
	}
	return fmt.Sprintf("%d %s", d, monthNames[m-1])
}

// handleSameDay answers "what happened on this date". Defaults to today, which
// makes it a page worth opening more than once.
func handleSameDay(w http.ResponseWriter, r *http.Request) {
	md := r.URL.Query().Get("md")
	if md == "" {
		md = time.Now().UTC().Format("01-02")
	}
	if len(md) != 5 || md[2] != '-' {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "md must be MM-DD"})
		return
	}

	born, err := queryEntities(`SELECT `+entityColumns+`
		FROM historical_entities
		WHERE type = 'person' AND start_reliable = 1
		  AND substr(start_date, 6, 5) = ?
		ORDER BY COALESCE(fame,0) + CASE WHEN curated = 1 THEN 25 ELSE 0 END
		         - CASE WHEN category IN ('Sport','Entertainment') THEN 15 ELSE 0 END DESC
		LIMIT 24`, md)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "database error"})
		return
	}

	died, err := queryEntities(`SELECT `+entityColumns+`
		FROM historical_entities
		WHERE type = 'person' AND end_reliable = 1
		  AND substr(end_date, 6, 5) = ?
		ORDER BY COALESCE(fame,0) + CASE WHEN curated = 1 THEN 25 ELSE 0 END
		         - CASE WHEN category IN ('Sport','Entertainment') THEN 15 ELSE 0 END DESC
		LIMIT 24`, md)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "database error"})
		return
	}

	res := &sameDayResult{
		MonthDay: md,
		Label:    monthDayLabel(md),
		Born:     born,
		Died:     died,
	}
	res.Collisions = collisions(born, died)
	writeJSON(w, http.StatusOK, res)
}

// collisions finds the strongest version of the fact: one person born on the
// exact day another died, same year or not.
func collisions(born, died []*Entity) []*sameDayCollision {
	out := []*sameDayCollision{}
	for _, b := range born {
		if b.StartDate == nil {
			continue
		}
		for _, d := range died {
			if d.EndDate == nil || d.ID == b.ID {
				continue
			}
			if *b.StartDate != *d.EndDate {
				continue
			}
			out = append(out, &sameDayCollision{
				Born: b, Died: d, Date: *b.StartDate,
				Sentence: fmt.Sprintf("%s was born the day %s died.", b.Name, d.Name),
			})
		}
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].Born.Fame+out[i].Died.Fame > out[j].Born.Fame+out[j].Died.Fame
	})
	if len(out) > 8 {
		out = out[:8]
	}
	return out
}

// handleSharedBirthday finds two people born on the same calendar date but
// centuries apart, which reads as a stranger coincidence than a same-year one.
func handleSharedBirthday(w http.ResponseWriter, r *http.Request) {
	minGap := 200
	if n, err := strconv.Atoi(r.URL.Query().Get("min_gap")); err == nil && n > 0 {
		minGap = n
	}

	rows, err := db.Query(`
		SELECT a.id, a.name, a.start_year, a.start_date, a.region, a.category,
		       b.id, b.name, b.start_year, b.start_date, b.region, b.category
		FROM historical_entities a
		JOIN historical_entities b
		  ON substr(a.start_date, 6, 5) = substr(b.start_date, 6, 5)
		 AND a.id < b.id
		WHERE a.type = 'person' AND b.type = 'person'
		  AND a.start_reliable = 1 AND b.start_reliable = 1
		  AND abs(a.start_year - b.start_year) >= ?
		  AND COALESCE(a.fame,0) > 80 AND COALESCE(b.fame,0) > 80
		ORDER BY (COALESCE(a.fame,0) + COALESCE(b.fame,0)) DESC
		LIMIT 30`, minGap)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "database error"})
		return
	}
	defer rows.Close()

	type brief struct {
		ID       string  `json:"id"`
		Name     string  `json:"name"`
		Year     int     `json:"year"`
		Date     string  `json:"date"`
		Region   *string `json:"region"`
		Category *string `json:"category"`
	}
	type share struct {
		Label string `json:"label"`
		A     brief  `json:"a"`
		B     brief  `json:"b"`
	}

	out := []share{}
	for rows.Next() {
		var a, b brief
		var aRegion, aCat, bRegion, bCat, aDate, bDate *string
		if err := rows.Scan(&a.ID, &a.Name, &a.Year, &aDate, &aRegion, &aCat,
			&b.ID, &b.Name, &b.Year, &bDate, &bRegion, &bCat); err != nil {
			continue
		}
		if aDate == nil || bDate == nil {
			continue
		}
		a.Date, b.Date = *aDate, *bDate
		a.Region, a.Category, b.Region, b.Category = aRegion, aCat, bRegion, bCat
		out = append(out, share{Label: monthDayLabel((*aDate)[len(*aDate)-5:]), A: a, B: b})
	}
	writeJSON(w, http.StatusOK, out)
}

// ---------------------------------------------------------------------------
// Near miss
// ---------------------------------------------------------------------------

// handleNearMiss lists pairs whose lives did not overlap, closest first. The
// candidate join is on years, then buildPair works out the real gap from the
// dates, so a pair that turns out to overlap after all is dropped.
func handleNearMiss(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	within := 8
	if n, err := strconv.Atoi(q.Get("within")); err == nil && n >= 1 && n <= 60 {
		within = n
	}

	var rows []*Entity
	var err error
	if anchor := q.Get("anchor"); anchor != "" {
		a, aerr := fetchEntity(anchor)
		if aerr != nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "anchor not found"})
			return
		}
		// Everyone who died just before the anchor was born, or was born just
		// after the anchor died.
		rows, err = queryEntities(`SELECT `+entityColumns+`
			FROM historical_entities
			WHERE type = 'person' AND id != ?
			  AND (COALESCE(fame,0) >= 70 OR curated = 1)
			  AND ( end_year BETWEEN ? AND ?
			     OR start_year BETWEEN ? AND ? )
			ORDER BY COALESCE(fame,0) DESC LIMIT 60`,
			a.ID,
			a.StartYear-within, a.StartYear,
			a.EffectiveEnd(), a.EffectiveEnd()+within)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "database error"})
			return
		}
		writeJSON(w, http.StatusOK, rankMisses(a, rows))
		return
	}

	// No anchor: search notable pairs whose years almost touch.
	//
	// The ids are read out and the result set closed before any entity is
	// fetched. The pool is capped at one connection, so querying while the
	// outer rows are still open waits for a connection that the outer query is
	// holding, and the request hangs forever.
	type idPair struct{ a, b string }
	var wanted []idPair
	ids := map[string]bool{}

	func() {
		pairRows, err := db.Query(`
			SELECT a.id, b.id
			FROM historical_entities a
			JOIN historical_entities b
			  ON b.end_year BETWEEN a.start_year - ? AND a.start_year
			WHERE a.type = 'person' AND b.type = 'person' AND a.id != b.id
			  AND a.start_reliable = 1 AND b.end_reliable = 1
			  AND COALESCE(a.fame,0) >= 85 AND COALESCE(b.fame,0) >= 85
			  AND COALESCE(a.category,'') NOT IN ('Sport','Entertainment')
			  AND COALESCE(b.category,'') NOT IN ('Sport','Entertainment')
			ORDER BY (COALESCE(a.fame,0) + COALESCE(b.fame,0)
			          + CASE WHEN a.curated = 1 THEN 20 ELSE 0 END
			          + CASE WHEN b.curated = 1 THEN 20 ELSE 0 END) DESC
			LIMIT 160`, within)
		if err != nil {
			return
		}
		defer pairRows.Close()
		seen := map[string]bool{}
		for pairRows.Next() {
			var idA, idB string
			if err := pairRows.Scan(&idA, &idB); err != nil {
				continue
			}
			key := idA + "/" + idB
			if seen[key] {
				continue
			}
			seen[key] = true
			wanted = append(wanted, idPair{idA, idB})
			ids[idA] = true
			ids[idB] = true
		}
	}()

	if len(wanted) == 0 {
		writeJSON(w, http.StatusOK, []*PairResult{})
		return
	}

	// One query for every entity involved, rather than two per pair.
	byID, err := fetchEntities(ids)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "database error"})
		return
	}

	var results []*PairResult
	for _, wp := range wanted {
		a, okA := byID[wp.a]
		b, okB := byID[wp.b]
		if !okA || !okB {
			continue
		}
		pair := buildPair(a, b)
		if pair.Overlaps {
			continue
		}
		results = append(results, pair)
	}

	sort.Slice(results, func(i, j int) bool {
		gi, gj := 0, 0
		if results[i].GapYears != nil {
			gi = *results[i].GapYears
		}
		if results[j].GapYears != nil {
			gj = *results[j].GapYears
		}
		if gi != gj {
			return gi < gj
		}
		return results[i].A.Fame+results[i].B.Fame > results[j].A.Fame+results[j].B.Fame
	})
	if len(results) > 20 {
		results = results[:20]
	}
	if results == nil {
		results = []*PairResult{}
	}
	writeJSON(w, http.StatusOK, results)
}

// fetchEntities loads many entities in one query. Callers that need more than
// a couple of rows must use this rather than looping over fetchEntity.
func fetchEntities(ids map[string]bool) (map[string]*Entity, error) {
	if len(ids) == 0 {
		return map[string]*Entity{}, nil
	}
	placeholders := make([]string, 0, len(ids))
	args := make([]any, 0, len(ids))
	for id := range ids {
		placeholders = append(placeholders, "?")
		args = append(args, id)
	}
	rows, err := queryEntities(
		"SELECT "+entityColumns+" FROM historical_entities WHERE id IN ("+
			strings.Join(placeholders, ",")+")", args...)
	if err != nil {
		return nil, err
	}
	out := make(map[string]*Entity, len(rows))
	for _, e := range rows {
		out[e.ID] = e
	}
	return out, nil
}

func rankMisses(anchor *Entity, candidates []*Entity) []*PairResult {
	var out []*PairResult
	for _, c := range candidates {
		pair := buildPair(anchor, c)
		if pair.Overlaps {
			continue
		}
		out = append(out, pair)
	}
	sort.Slice(out, func(i, j int) bool {
		gi, gj := 0, 0
		if out[i].GapYears != nil {
			gi = *out[i].GapYears
		}
		if out[j].GapYears != nil {
			gj = *out[j].GapYears
		}
		return gi < gj
	})
	if len(out) > 12 {
		out = out[:12]
	}
	if out == nil {
		out = []*PairResult{}
	}
	return out
}
