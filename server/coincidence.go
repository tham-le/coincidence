package main

import (
	"fmt"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Half the earth's circumference. A pair this far apart is as far apart as
// two people can be.
const maxEarthDistanceKm = 20015.0

const earthRadiusKm = 6371.0

func haversineKm(lat1, lon1, lat2, lon2 float64) float64 {
	rad := func(d float64) float64 { return d * math.Pi / 180 }
	dLat := rad(lat2 - lat1)
	dLon := rad(lon2 - lon1)
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(rad(lat1))*math.Cos(rad(lat2))*math.Sin(dLon/2)*math.Sin(dLon/2)
	return 2 * earthRadiusKm * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

// lifeBound turns an ISO date, or a bare year, into a comparable instant.
// atStart picks January 1 when only the year is known, atEnd picks December 31,
// so an unknown-precision lifespan is treated as its widest reading.
func lifeBound(iso *string, year int, atStart bool) time.Time {
	if iso != nil {
		if t, err := parseISO(*iso); err == nil {
			return t
		}
	}
	if atStart {
		return time.Date(year, time.January, 1, 0, 0, 0, 0, time.UTC)
	}
	return time.Date(year, time.December, 31, 0, 0, 0, 0, time.UTC)
}

// parseISO handles the BCE form Wikidata uses, "-0384-01-01".
func parseISO(s string) (time.Time, error) {
	neg := strings.HasPrefix(s, "-")
	body := strings.TrimPrefix(s, "-")
	parts := strings.SplitN(body, "-", 3)
	if len(parts) != 3 {
		return time.Time{}, fmt.Errorf("bad date %q", s)
	}
	y, err1 := strconv.Atoi(parts[0])
	m, err2 := strconv.Atoi(parts[1])
	d, err3 := strconv.Atoi(parts[2])
	if err1 != nil || err2 != nil || err3 != nil {
		return time.Time{}, fmt.Errorf("bad date %q", s)
	}
	if neg {
		y = -y
	}
	// Wikidata writes an unknown month or day as 00.
	if m < 1 {
		m = 1
	}
	if d < 1 {
		d = 1
	}
	return time.Date(y, time.Month(m), d, 0, 0, 0, 0, time.UTC), nil
}

// hasDayPrecision reports whether a boundary is a date we can count days
// against. A date is only usable when it was actually recorded: an early one
// carries a day because Wikidata stores a tradition that way, and counting
// days from it would state a fact nobody knows.
func hasDayPrecision(e *Entity, atStart bool) bool {
	if atStart {
		return e.StartReliable && e.StartDate != nil
	}
	return e.EndReliable && e.EndDate != nil
}

// ---------------------------------------------------------------------------
// Pair
// ---------------------------------------------------------------------------

type PairChip struct {
	Kind  string `json:"kind"`
	Label string `json:"label"`
}

type PairResult struct {
	A *Entity `json:"a"`
	B *Entity `json:"b"`

	OverlapYears int  `json:"overlap_years"`
	OverlapDays  *int `json:"overlap_days,omitempty"`
	OverlapStart int  `json:"overlap_start"`
	OverlapEnd   int  `json:"overlap_end"`
	Overlaps     bool `json:"overlaps"`
	GapYears     *int `json:"gap_years,omitempty"`
	GapDays      *int `json:"gap_days,omitempty"`

	// Two people born in the same year is a coincidence in its own right, and
	// one that a long shared lifetime otherwise hides.
	SameBirthYear bool `json:"same_birth_year"`
	BirthGapDays  *int `json:"birth_gap_days,omitempty"`
	EndEstimatedA bool `json:"end_estimated_a"`
	EndEstimatedB bool `json:"end_estimated_b"`

	DistanceKm int        `json:"distance_km"`
	Chips      []PairChip `json:"chips"`
	Headline   string     `json:"headline"`

	// Age of each at the moment the younger one was born, which is the line
	// that makes an overlap feel like a real moment.
	AgeAAtBBirth *int `json:"age_a_at_b_birth,omitempty"`
	AgeBAAtBirth *int `json:"age_b_at_a_birth,omitempty"`
}

func buildPair(a, b *Entity) *PairResult {
	aStart := lifeBound(a.StartDate, a.StartYear, true)
	bStart := lifeBound(b.StartDate, b.StartYear, true)
	aEnd := lifeBound(a.EndDate, a.EffectiveEnd(), false)
	bEnd := lifeBound(b.EndDate, b.EffectiveEnd(), false)

	start, end := aStart, aEnd
	if bStart.After(start) {
		start = bStart
	}
	if bEnd.Before(end) {
		end = bEnd
	}

	res := &PairResult{
		A: a, B: b,
		DistanceKm:    int(math.Round(haversineKm(a.Latitude, a.Longitude, b.Latitude, b.Longitude))),
		EndEstimatedA: a.EndIsEstimated(),
		EndEstimatedB: b.EndIsEstimated(),
		OverlapStart:  start.Year(),
		OverlapEnd:    end.Year(),
	}

	if end.Before(start) {
		// They missed each other. The size of the miss is its own story, and a
		// miss measured in days is the best version of it.
		days := int(start.Sub(end).Hours() / 24)
		gap := int(math.Round(float64(days) / 365.2425))
		res.Overlaps = false
		res.GapYears = &gap

		// The two boundaries that decide the gap are the earlier death and the
		// later birth. Both have to be dates we trust before stating days.
		earlier, later := a, b
		if bEnd.Before(aEnd) {
			earlier, later = b, a
		}
		if hasDayPrecision(earlier, false) && hasDayPrecision(later, true) {
			res.GapDays = &days
		}

		res.Headline = missHeadline(a, b, res)
		res.Chips = pairChips(a, b, res, 0)
		return res
	}

	res.Overlaps = true
	res.SameBirthYear = a.StartYear == b.StartYear
	if res.SameBirthYear && hasDayPrecision(a, true) && hasDayPrecision(b, true) {
		d := int(math.Abs(aStart.Sub(bStart).Hours() / 24))
		res.BirthGapDays = &d
	}

	// Days between the two boundary dates, not counting both endpoints. This
	// is the number the headline needs: born on day 0, the other died on day N,
	// so N days were left. Adding one would make the sentence off by a day.
	days := int(end.Sub(start).Hours() / 24)
	res.OverlapYears = int(math.Floor(float64(days) / 365.2425))

	// Only claim a day count when both boundary dates are real. The boundary
	// that matters is whichever side is later at the start and earlier at the
	// end, since that is the one that decides the number.
	startFromA := !bStart.After(aStart)
	endFromA := !aEnd.After(bEnd)
	startKnown := (startFromA && hasDayPrecision(a, true)) || (!startFromA && hasDayPrecision(b, true))
	endKnown := (endFromA && hasDayPrecision(a, false)) || (!endFromA && hasDayPrecision(b, false))
	if startKnown && endKnown {
		res.OverlapDays = &days
	}

	if ageA := ageAt(aStart, bStart); ageA != nil && bStart.After(aStart) {
		res.AgeAAtBBirth = ageA
	}
	if ageB := ageAt(bStart, aStart); ageB != nil && aStart.After(bStart) {
		res.AgeBAAtBirth = ageB
	}

	res.Headline = overlapHeadline(a, b, res, days)
	res.Chips = pairChips(a, b, res, days)
	return res
}

func ageAt(birth, moment time.Time) *int {
	if moment.Before(birth) {
		return nil
	}
	years := moment.Year() - birth.Year()
	if moment.YearDay() < birth.YearDay() {
		years--
	}
	return &years
}

// overlapHeadline writes the one sentence the reveal card leads with. A very
// short overlap gets the sharper phrasing, because that is the surprising one.
func overlapHeadline(a, b *Entity, res *PairResult, days int) string {
	// Order so the sentence talks about the younger person being born. The
	// younger one is whoever was born later.
	younger, older := a, b
	if b.StartYear > a.StartYear {
		younger, older = b, a
	}

	if res.OverlapDays != nil && days < 400 {
		return fmt.Sprintf("When %s was born, %s had %d days left to live.",
			younger.Name, older.Name, days)
	}
	// Same year of birth beats the length of the overlap as the thing worth
	// saying. Ho Chi Minh and Charles de Gaulle were both born in 1890, which
	// "alive at the same time for 78 years" buries completely.
	if res.SameBirthYear {
		if res.BirthGapDays != nil && *res.BirthGapDays > 0 {
			return fmt.Sprintf("%s and %s were born %s apart, in the same year.",
				a.Name, b.Name, plural(*res.BirthGapDays, "day"))
		}
		return fmt.Sprintf("%s and %s were born in the same year, %s.",
			a.Name, b.Name, fmtYearOnly(a.StartYear))
	}
	if res.OverlapYears == 0 {
		return fmt.Sprintf("%s and %s were alive at the same time, for less than a year.",
			a.Name, b.Name)
	}
	if res.OverlapYears < 5 {
		return fmt.Sprintf("%s and %s shared only %s on earth.",
			a.Name, b.Name, plural(res.OverlapYears, "year"))
	}
	return fmt.Sprintf("%s and %s were alive at the same time for %d years.",
		a.Name, b.Name, res.OverlapYears)
}

func fmtYearOnly(y int) string {
	if y < 0 {
		return strconv.Itoa(-y) + " BCE"
	}
	return strconv.Itoa(y)
}

// plural keeps "1 years" out of the interface.
func plural(n int, word string) string {
	if n == 1 {
		return fmt.Sprintf("%d %s", n, word)
	}
	return fmt.Sprintf("%d %ss", n, word)
}

func missHeadline(a, b *Entity, res *PairResult) string {
	first, second := a, b
	if b.StartYear < a.StartYear {
		first, second = b, a
	}
	if res.GapDays != nil {
		return fmt.Sprintf("%s was born %s after %s died.",
			second.Name, plural(*res.GapDays, "day"), first.Name)
	}
	gap := 0
	if res.GapYears != nil {
		gap = *res.GapYears
	}
	if gap == 0 {
		return fmt.Sprintf("%s died the same year %s was born. They never met.",
			first.Name, second.Name)
	}
	return fmt.Sprintf("%s missed %s by %s.", second.Name, first.Name, plural(gap, "year"))
}

func pairChips(a, b *Entity, res *PairResult, days int) []PairChip {
	var chips []PairChip

	if res.DistanceKm > 1000 {
		chips = append(chips, PairChip{"distance", fmt.Sprintf("%s km apart", withThousands(res.DistanceKm))})
	}
	if a.Region != nil && b.Region != nil && *a.Region != *b.Region {
		chips = append(chips, PairChip{"region", fmt.Sprintf("%s and %s", *a.Region, *b.Region)})
	}
	if a.Category != nil && b.Category != nil && *a.Category != *b.Category {
		chips = append(chips, PairChip{"domain", fmt.Sprintf("%s and %s", strings.ToLower(*a.Category), strings.ToLower(*b.Category))})
	}
	if res.Overlaps && res.OverlapDays != nil && days < 400 {
		chips = append(chips, PairChip{"brief", "overlapped " + plural(days, "day")})
	} else if res.Overlaps && res.OverlapYears < 5 {
		chips = append(chips, PairChip{"brief", "overlapped " + plural(res.OverlapYears, "year")})
	}
	if res.SameBirthYear {
		chips = append(chips, PairChip{"birth", "born the same year"})
	}
	if res.EndEstimatedA || res.EndEstimatedB {
		chips = append(chips, PairChip{"estimate", "one death date is unknown"})
	}
	return chips
}

func withThousands(n int) string {
	s := strconv.Itoa(n)
	if len(s) <= 3 {
		return s
	}
	var out []byte
	for i, c := range []byte(s) {
		if i > 0 && (len(s)-i)%3 == 0 {
			out = append(out, ',')
		}
		out = append(out, c)
	}
	return string(out)
}

func fetchEntity(id string) (*Entity, error) {
	row := db.QueryRow("SELECT "+entityColumns+" FROM historical_entities WHERE id = ?", id)
	return scanEntityFrom(row)
}

func handlePair(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	idA, idB := q.Get("a"), q.Get("b")
	if idA == "" || idB == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "need a and b"})
		return
	}
	a, err := fetchEntity(idA)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "a not found"})
		return
	}
	b, err := fetchEntity(idB)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "b not found"})
		return
	}
	writeJSON(w, http.StatusOK, buildPair(a, b))
}

// ---------------------------------------------------------------------------
// Reveal: hand the visitor a coincidence instead of asking them to find one
// ---------------------------------------------------------------------------

// surprise rewards the things that make a pair worth showing: distance, a
// different field of life, and a short overlap. Two French generals who both
// lived eighty years score low no matter how famous they are.
func surprise(a, b *Entity, res *PairResult) float64 {
	if !res.Overlaps {
		return 0
	}
	distance := haversineKm(a.Latitude, a.Longitude, b.Latitude, b.Longitude) / maxEarthDistanceKm

	domain := 1.0
	if a.Category != nil && b.Category != nil && *a.Category != *b.Category {
		domain = 1.5
	}
	region := 1.0
	if a.Region != nil && b.Region != nil && *a.Region != *b.Region {
		region = 1.4
	}

	// A brief overlap is the more surprising kind, but only mildly. Weighted
	// any harder, this term picked two obscure people whose lives happened to
	// touch for three years over any pair a reader would recognise.
	brevity := 0.6 + 0.4*math.Exp(-float64(res.OverlapYears)/15.0)

	// The other kind of near-coincidence: born at the same moment on opposite
	// sides of the world. Without this the brevity term buries every such pair,
	// because sharing a birth year also means sharing a whole lifetime.
	sameStart := 1.0
	switch birthGap := abs(a.StartYear - b.StartYear); {
	case birthGap == 0:
		sameStart = 1.9
	case birthGap <= 2:
		sameStart = 1.4
	}

	// The product of the two normalized fames, not the mean, so one famous
	// name cannot carry an unknown one into the reveal.
	fame := (a.Fame / 100) * (b.Fame / 100)

	// A hand-picked figure is there because someone decided it matters.
	curated := 1.0
	if a.Curated {
		curated *= 1.25
	}
	if b.Curated {
		curated *= 1.25
	}

	return distance * domain * region * brevity * sameStart * fame * curated
}

func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}

func queryEntities(query string, args ...any) ([]*Entity, error) {
	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	// Starts empty rather than nil: a nil slice marshals to JSON null, and
	// every caller that reads .length off the result then crashes the page.
	out := []*Entity{}
	for rows.Next() {
		e, err := scanEntity(rows)
		if err != nil {
			continue
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func handleReveal(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	// An anchor can be requested, so "another one like this" keeps a person.
	var anchor *Entity
	var err error
	if id := q.Get("anchor"); id != "" {
		anchor, err = fetchEntity(id)
		if err != nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "anchor not found"})
			return
		}
	} else {
		anchors, err := queryEntities(`SELECT ` + entityColumns + `
			FROM historical_entities
			WHERE type = 'person' AND start_year IS NOT NULL
			  AND (curated = 1 OR COALESCE(fame,0) >= 85)
			ORDER BY RANDOM() LIMIT 1`)
		if err != nil || len(anchors) == 0 {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "no anchor available"})
			return
		}
		anchor = anchors[0]
	}

	// Candidates that were alive at the same time, sampled at random so the
	// same pair does not come back every time.
	candidates, err := queryEntities(`SELECT `+entityColumns+`
		FROM historical_entities
		WHERE type = 'person' AND id != ?
		  AND start_year <= ? AND `+effEnd+` >= ?
		  AND (curated = 1 OR COALESCE(fame,0) >= 75)
		ORDER BY RANDOM() LIMIT 150`,
		anchor.ID, anchor.EffectiveEnd(), anchor.StartYear)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "database error"})
		return
	}

	var best *PairResult
	var bestScore float64
	for _, c := range candidates {
		pair := buildPair(anchor, c)
		s := surprise(anchor, c, pair)
		if s > bestScore {
			bestScore, best = s, pair
		}
	}
	if best == nil {
		writeJSON(w, http.StatusOK, map[string]any{"error": "no overlapping contemporary found", "anchor": anchor})
		return
	}
	writeJSON(w, http.StatusOK, best)
}

// ---------------------------------------------------------------------------
// Year card: one year, the whole world, grouped by region
// ---------------------------------------------------------------------------

type RegionGroup struct {
	Region string    `json:"region"`
	People []*Entity `json:"people"`
	Events []*Entity `json:"events"`
}

func handleYearCard(w http.ResponseWriter, r *http.Request) {
	year, err := strconv.Atoi(r.URL.Query().Get("year"))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "year required"})
		return
	}
	perRegion := 6
	if n, err := strconv.Atoi(r.URL.Query().Get("per_region")); err == nil && n > 0 && n <= 20 {
		perRegion = n
	}

	rows, err := queryEntities(`SELECT `+entityColumns+`
		FROM historical_entities
		WHERE start_year <= ? AND `+effEnd+` >= ?
		ORDER BY COALESCE(fame,0) + CASE WHEN curated = 1 THEN 8 ELSE 0 END DESC
		LIMIT 600`, year, year)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "database error"})
		return
	}

	groups := map[string]*RegionGroup{}
	var order []string
	for _, e := range rows {
		region := "Elsewhere"
		if e.Region != nil {
			region = *e.Region
		}
		g, ok := groups[region]
		if !ok {
			g = &RegionGroup{Region: region, People: []*Entity{}, Events: []*Entity{}}
			groups[region] = g
			order = append(order, region)
		}
		if e.Type == "event" {
			if len(g.Events) < perRegion {
				g.Events = append(g.Events, e)
			}
			continue
		}
		if len(g.People) < perRegion {
			g.People = append(g.People, e)
		}
	}

	out := make([]*RegionGroup, 0, len(order))
	for _, name := range order {
		out = append(out, groups[name])
	}
	sort.Slice(out, func(i, j int) bool {
		return len(out[i].People)+len(out[i].Events) > len(out[j].People)+len(out[j].Events)
	})
	writeJSON(w, http.StatusOK, map[string]any{"year": year, "regions": out})
}

// ---------------------------------------------------------------------------
// Waves: does everyone revolt at once?
// ---------------------------------------------------------------------------

type WaveBucket struct {
	Start    int       `json:"start"`
	End      int       `json:"end"`
	Count    int       `json:"count"`
	IsWave   bool      `json:"is_wave"`
	Regions  int       `json:"regions"`
	Examples []*Entity `json:"examples,omitempty"`
}

// handleWaves buckets events of one kind and marks the buckets that stand out.
// A bucket counts as a wave when it is well above the local average and the
// events in it are spread over several regions, so a single busy country
// cannot manufacture one.
func handleWaves(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	kind := q.Get("kind")
	if kind == "" {
		kind = "Revolutions"
	}
	bucketSize := 20
	if n, err := strconv.Atoi(q.Get("bucket")); err == nil && n >= 5 && n <= 100 {
		bucketSize = n
	}
	from, to := 1500, 2000
	if n, err := strconv.Atoi(q.Get("from")); err == nil {
		from = n
	}
	if n, err := strconv.Atoi(q.Get("to")); err == nil {
		to = n
	}

	var where string
	var args []any
	switch strings.ToLower(kind) {
	case "all", "events":
		where = "type = 'event'"
	default:
		where = "type = 'event' AND LOWER(category) = ?"
		args = append(args, strings.ToLower(kind))
	}

	rows, err := db.Query(fmt.Sprintf(`
		SELECT (start_year / %d) * %d AS bucket, COUNT(*) AS n, COUNT(DISTINCT region) AS regions
		FROM historical_entities
		WHERE %s AND start_year BETWEEN ? AND ?
		GROUP BY bucket ORDER BY bucket`, bucketSize, bucketSize, where),
		append(args, from, to)...)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "database error"})
		return
	}
	defer rows.Close()

	var buckets []*WaveBucket
	total := 0
	for rows.Next() {
		var b WaveBucket
		if err := rows.Scan(&b.Start, &b.Count, &b.Regions); err != nil {
			continue
		}
		b.End = b.Start + bucketSize - 1
		total += b.Count
		buckets = append(buckets, &b)
	}
	// Close before the per-bucket example queries below. The pool holds one
	// connection, so querying while this result set is open would wait on a
	// connection this query is holding.
	rows.Close()

	if len(buckets) == 0 {
		writeJSON(w, http.StatusOK, map[string]any{"kind": kind, "buckets": []any{}})
		return
	}

	mean := float64(total) / float64(len(buckets))
	variance := 0.0
	for _, b := range buckets {
		variance += (float64(b.Count) - mean) * (float64(b.Count) - mean)
	}
	stddev := math.Sqrt(variance / float64(len(buckets)))

	for _, b := range buckets {
		b.IsWave = float64(b.Count) > mean+stddev && b.Regions >= 3
		if !b.IsWave {
			continue
		}
		ex, err := queryEntities(`SELECT `+entityColumns+`
			FROM historical_entities
			WHERE `+where+` AND start_year BETWEEN ? AND ?
			ORDER BY COALESCE(fame,0) DESC LIMIT 6`,
			append(append([]any{}, args...), b.Start, b.End)...)
		if err == nil {
			b.Examples = ex
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"kind":        kind,
		"bucket_size": bucketSize,
		"mean":        math.Round(mean*10) / 10,
		"stddev":      math.Round(stddev*10) / 10,
		"buckets":     buckets,
		// Large eruptions and cold periods on the same axis, so the reader can
		// see the juxtaposition without the site claiming a cause.
		"climate": markersInRange(from, to),
	})
}

// handleWaveKinds lists the event categories that have enough rows to plot.
func handleWaveKinds(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query(`SELECT category, COUNT(*) c FROM historical_entities
		WHERE type = 'event' AND category IS NOT NULL
		GROUP BY category HAVING c >= 20 ORDER BY c DESC`)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "database error"})
		return
	}
	defer rows.Close()
	type kind struct {
		Name  string `json:"name"`
		Count int    `json:"count"`
	}
	out := []kind{}
	for rows.Next() {
		var k kind
		if err := rows.Scan(&k.Name, &k.Count); err == nil {
			out = append(out, k)
		}
	}
	writeJSON(w, http.StatusOK, out)
}

// ---------------------------------------------------------------------------
// Daily
// ---------------------------------------------------------------------------

// handleDaily returns the same pair to everyone for a given UTC day.
//
// A site like this is looked at once and then finished with. One coincidence a
// day, identical for every visitor, is the only thing that gives anyone a
// reason to come back and something to compare notes about.
//
// Everything here has to be deterministic, so the anchor is chosen by offset
// over an id-ordered list rather than with RANDOM(), and candidates are scored
// in a fixed order.
func handleDaily(w http.ResponseWriter, r *http.Request) {
	day := time.Now().UTC()
	if d := r.URL.Query().Get("date"); d != "" {
		parsed, err := time.Parse("2006-01-02", d)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "date must be YYYY-MM-DD"})
			return
		}
		day = parsed
	}
	dayNumber := day.Unix() / 86400

	var poolSize int
	if err := db.QueryRow(`SELECT COUNT(*) FROM historical_entities
		WHERE type = 'person' AND curated = 1 AND start_year IS NOT NULL`).Scan(&poolSize); err != nil || poolSize == 0 {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "no pool"})
		return
	}

	// Spread consecutive days across the pool instead of walking it in order.
	// A stride coprime with the pool size visits every entry before repeating.
	const stride = 7919
	offset := int((dayNumber*stride)%int64(poolSize)+int64(poolSize)) % poolSize

	anchors, err := queryEntities(`SELECT `+entityColumns+`
		FROM historical_entities
		WHERE type = 'person' AND curated = 1 AND start_year IS NOT NULL
		ORDER BY id LIMIT 1 OFFSET ?`, offset)
	if err != nil || len(anchors) == 0 {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "no anchor"})
		return
	}
	anchor := anchors[0]

	candidates, err := queryEntities(`SELECT `+entityColumns+`
		FROM historical_entities
		WHERE type = 'person' AND id != ?
		  AND start_year <= ? AND `+effEnd+` >= ?
		  AND (curated = 1 OR COALESCE(fame,0) >= 75)
		ORDER BY id`,
		anchor.ID, anchor.EffectiveEnd(), anchor.StartYear)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "database error"})
		return
	}

	var best *PairResult
	var bestScore float64
	for _, c := range candidates {
		pair := buildPair(anchor, c)
		if s := surprise(anchor, c, pair); s > bestScore {
			bestScore, best = s, pair
		}
	}
	if best == nil {
		writeJSON(w, http.StatusOK, map[string]any{"error": "no contemporary", "anchor": anchor})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"date": day.Format("2006-01-02"),
		"pair": best,
	})
}
