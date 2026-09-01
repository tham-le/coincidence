package main

import (
	"strings"
	"testing"
)

// Tests for the date and overlap logic.
//
// Every case here is one that was wrong at some point: the headline naming the
// wrong person as the one being born, a day count off by one, a day count
// stated for a date nobody actually recorded, a year printed with a thousands
// separator. They are cheap to get wrong again because the inputs are awkward:
// BCE years, unknown death dates, and dates whose precision varies per row.

func strp(s string) *string { return &s }
func intp(n int) *int       { return &n }

type personOpt func(*Entity)

func withDates(birth, death string) personOpt {
	return func(e *Entity) {
		if birth != "" {
			e.StartDate = strp(birth)
			e.StartReliable = true
		}
		if death != "" {
			e.EndDate = strp(death)
			e.EndReliable = true
		}
	}
}

// unreliable keeps the dates but marks them as not good enough to count days
// with, which is what every pre-1500 row looks like.
func unreliable() personOpt {
	return func(e *Entity) {
		e.StartReliable = false
		e.EndReliable = false
	}
}

func at(lat, lon float64) personOpt {
	return func(e *Entity) { e.Latitude, e.Longitude = lat, lon }
}

func category(c string) personOpt {
	return func(e *Entity) { e.Category = strp(c) }
}

func region(r string) personOpt {
	return func(e *Entity) { e.Region = strp(r) }
}

func living() personOpt {
	return func(e *Entity) { e.EndYear = nil; e.Alive = true }
}

// deathUnknown is the other reason a death year is missing: nobody recorded it.
func deathUnknown() personOpt {
	return func(e *Entity) { e.EndYear = nil; e.Alive = false }
}

func person(name string, born, died int, opts ...personOpt) *Entity {
	e := &Entity{
		ID:        name,
		Name:      name,
		Type:      "person",
		StartYear: born,
		EndYear:   intp(died),
		Fame:      80,
	}
	for _, o := range opts {
		o(e)
	}
	return e
}

// ---------------------------------------------------------------------------
// Overlap
// ---------------------------------------------------------------------------

func TestOverlapDaysCountsTheGapNotTheEndpoints(t *testing.T) {
	// Van Gogh died 29 July 1890. Ho Chi Minh was born 19 May 1890. The
	// sentence says how many days were left, so it is the difference between
	// the two dates and not an inclusive count of both.
	hcm := person("Ho Chi Minh", 1890, 1969, withDates("1890-05-19", "1969-09-02"))
	vg := person("Vincent van Gogh", 1853, 1890, withDates("1853-03-30", "1890-07-29"))

	got := buildPair(hcm, vg)
	if !got.Overlaps {
		t.Fatal("expected the lives to overlap")
	}
	if got.OverlapDays == nil {
		t.Fatal("expected a day count, both dates are reliable")
	}
	if *got.OverlapDays != 71 {
		t.Errorf("overlap days = %d, want 71", *got.OverlapDays)
	}
}

func TestHeadlineNamesTheYoungerAsTheOneBorn(t *testing.T) {
	// This read backwards once: it announced van Gogh being born and Ho Chi
	// Minh having days left to live.
	hcm := person("Ho Chi Minh", 1890, 1969, withDates("1890-05-19", "1969-09-02"))
	vg := person("Vincent van Gogh", 1853, 1890, withDates("1853-03-30", "1890-07-29"))

	for _, order := range []struct {
		name string
		a, b *Entity
	}{
		{"younger first", hcm, vg},
		{"older first", vg, hcm},
	} {
		t.Run(order.name, func(t *testing.T) {
			h := buildPair(order.a, order.b).Headline
			if !strings.HasPrefix(h, "When Ho Chi Minh was born") {
				t.Errorf("headline = %q, want it to open with Ho Chi Minh being born", h)
			}
			if !strings.Contains(h, "Vincent van Gogh had 71 days left") {
				t.Errorf("headline = %q, want van Gogh as the one with days left", h)
			}
		})
	}
}

func TestNoDayCountWhenADateIsNotTrustworthy(t *testing.T) {
	// Wikidata gives Plato a birthday. No historian accepts it, so the pair
	// may still overlap but must not claim a number of days.
	plato := person("Plato", -428, -348, withDates("-0428-05-21", "-0348-01-01"), unreliable())
	aristotle := person("Aristotle", -384, -322, withDates("-0384-01-01", "-0322-01-01"), unreliable())

	got := buildPair(plato, aristotle)
	if !got.Overlaps {
		t.Fatal("Plato and Aristotle overlapped")
	}
	if got.OverlapDays != nil {
		t.Errorf("overlap days = %d, want none for dates this old", *got.OverlapDays)
	}
	if got.OverlapYears <= 0 {
		t.Errorf("overlap years = %d, want a positive count", got.OverlapYears)
	}
}

func TestBCELifespansOverlapCorrectly(t *testing.T) {
	caesar := person("Caesar", -100, -44)
	cleopatra := person("Cleopatra", -69, -30)

	got := buildPair(caesar, cleopatra)
	if !got.Overlaps {
		t.Fatal("Caesar and Cleopatra were alive at the same time")
	}
	// Cleopatra is born in -69 and Caesar dies in -44.
	if got.OverlapStart != -69 || got.OverlapEnd != -44 {
		t.Errorf("overlap = %d..%d, want -69..-44", got.OverlapStart, got.OverlapEnd)
	}
}

// ---------------------------------------------------------------------------
// A missing death year
// ---------------------------------------------------------------------------

func TestLivingPersonRunsToThePresent(t *testing.T) {
	alive := person("Someone Alive", 1950, 0, living())
	dead := person("Someone Dead", 1900, 1960)

	if got := alive.EffectiveEnd(); got != currentYear {
		t.Errorf("effective end = %d, want %d for a living person", got, currentYear)
	}
	if !buildPair(alive, dead).Overlaps {
		t.Error("a living person born in 1950 overlaps someone who died in 1960")
	}
	if !alive.EndIsEstimated() {
		t.Error("a living person has no recorded death year, so the end is estimated")
	}
}

func TestUnknownDeathFallsBackToALifespanAndSaysSo(t *testing.T) {
	// Not the same as being alive: nobody wrote the death down.
	unknown := person("Ancient Someone", 800, 0, deathUnknown())

	want := 800 + assumedLifespan
	if got := unknown.EffectiveEnd(); got != want {
		t.Errorf("effective end = %d, want %d", got, want)
	}

	other := person("Contemporary", 820, 890)
	got := buildPair(unknown, other)
	if !got.EndEstimatedA {
		t.Error("the pair must report that one death year was assumed")
	}
	var flagged bool
	for _, c := range got.Chips {
		if c.Kind == "estimate" {
			flagged = true
		}
	}
	if !flagged {
		t.Error("expected a chip warning that a death date is unknown")
	}
}

// ---------------------------------------------------------------------------
// Shared birth year
// ---------------------------------------------------------------------------

func TestSharedBirthYearLeadsTheHeadline(t *testing.T) {
	// Both born in 1890, 187 days apart. The overlap is 78 years, which used
	// to be all the headline said.
	hcm := person("Ho Chi Minh", 1890, 1969, withDates("1890-05-19", "1969-09-02"))
	dg := person("Charles de Gaulle", 1890, 1970, withDates("1890-11-22", "1970-11-09"))

	got := buildPair(hcm, dg)
	if !got.SameBirthYear {
		t.Fatal("both were born in 1890")
	}
	if got.BirthGapDays == nil || *got.BirthGapDays != 187 {
		t.Errorf("birth gap = %v, want 187 days", got.BirthGapDays)
	}
	if !strings.Contains(got.Headline, "187 days apart") {
		t.Errorf("headline = %q, want the days between the two births", got.Headline)
	}
}

func TestSharedBirthYearOutscoresALongQuietOverlap(t *testing.T) {
	// Before this, sharing a birth year meant sharing a lifetime, which the
	// brevity term scored near the bottom. The pair never surfaced.
	sameYear := buildPair(
		person("A", 1890, 1969, at(21, 105), category("Leaders"), region("Southeast Asia")),
		person("B", 1890, 1970, at(48, 2), category("Leaders"), region("Europe")),
	)
	different := buildPair(
		person("C", 1885, 1969, at(21, 105), category("Leaders"), region("Southeast Asia")),
		person("D", 1895, 1970, at(48, 2), category("Leaders"), region("Europe")),
	)

	a := surprise(sameYear.A, sameYear.B, sameYear)
	b := surprise(different.A, different.B, different)
	if a <= b {
		t.Errorf("shared birth year scored %.3f, a similar pair without one scored %.3f", a, b)
	}
}

// ---------------------------------------------------------------------------
// Near miss
// ---------------------------------------------------------------------------

func TestNearMissReportsTheGapAndNotAnOverlap(t *testing.T) {
	earlier := person("Died First", 1850, 1918, withDates("1850-01-01", "1918-02-10"))
	later := person("Born After", 1918, 2000, withDates("1918-07-18", "2000-01-01"))

	got := buildPair(earlier, later)
	if got.Overlaps {
		t.Fatal("one died before the other was born")
	}
	if got.GapDays == nil {
		t.Fatal("both dates are reliable, so the gap should be in days")
	}
	if *got.GapDays != 158 {
		t.Errorf("gap = %d days, want 158", *got.GapDays)
	}
	if !strings.Contains(got.Headline, "Born After was born 158 days after Died First died") {
		t.Errorf("headline = %q", got.Headline)
	}
}

func TestNearMissWithoutTrustworthyDatesFallsBackToYears(t *testing.T) {
	earlier := person("Ancient A", 900, 960, withDates("0900-01-01", "0960-03-04"), unreliable())
	later := person("Ancient B", 970, 1030, withDates("0970-06-01", "1030-01-01"), unreliable())

	got := buildPair(earlier, later)
	if got.Overlaps {
		t.Fatal("these two never overlapped")
	}
	if got.GapDays != nil {
		t.Errorf("gap days = %d, want none for dates this old", *got.GapDays)
	}
	if got.GapYears == nil || *got.GapYears != 10 {
		t.Errorf("gap years = %v, want 10", got.GapYears)
	}
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

func TestYearsNeverTakeAThousandsSeparator(t *testing.T) {
	// The share card printed "1,890 to 1,969" because years went through the
	// helper meant for distances.
	cases := map[int]string{1890: "1890", 2026: "2026", -384: "384 BCE", 0: "0"}
	for in, want := range cases {
		if got := yearLabel(in); got != want {
			t.Errorf("yearLabel(%d) = %q, want %q", in, got, want)
		}
	}
}

func TestDistancesDoTakeAThousandsSeparator(t *testing.T) {
	cases := map[int]string{9120: "9,120", 999: "999", 20015: "20,015", 0: "0"}
	for in, want := range cases {
		if got := withThousands(in); got != want {
			t.Errorf("withThousands(%d) = %q, want %q", in, got, want)
		}
	}
}

func TestPluralKeepsOneYearsOutOfTheInterface(t *testing.T) {
	if got := plural(1, "year"); got != "1 year" {
		t.Errorf("plural(1) = %q, want %q", got, "1 year")
	}
	if got := plural(2, "day"); got != "2 days" {
		t.Errorf("plural(2) = %q, want %q", got, "2 days")
	}
	if got := plural(0, "year"); got != "0 years" {
		t.Errorf("plural(0) = %q, want %q", got, "0 years")
	}
}

func TestParseISOHandlesBCEAndUnknownParts(t *testing.T) {
	cases := []struct {
		in        string
		wantYear  int
		wantMonth int
	}{
		{"1890-05-19", 1890, 5},
		{"-0384-06-01", -384, 6},
		// Wikidata writes an unknown month or day as 00.
		{"1600-00-00", 1600, 1},
	}
	for _, c := range cases {
		got, err := parseISO(c.in)
		if err != nil {
			t.Errorf("parseISO(%q) failed: %v", c.in, err)
			continue
		}
		if got.Year() != c.wantYear || int(got.Month()) != c.wantMonth {
			t.Errorf("parseISO(%q) = %v, want year %d month %d",
				c.in, got, c.wantYear, c.wantMonth)
		}
	}
	if _, err := parseISO("not-a-date"); err == nil {
		t.Error("parseISO should reject a string that is not a date")
	}
}

// ---------------------------------------------------------------------------
// Distance
// ---------------------------------------------------------------------------

func TestDistanceBetweenKnownPlaces(t *testing.T) {
	// Hanoi to Paris is a little over 9,000 km.
	got := haversineKm(21.03, 105.85, 48.86, 2.35)
	if got < 8800 || got > 9400 {
		t.Errorf("Hanoi to Paris = %.0f km, want roughly 9,000", got)
	}
	if same := haversineKm(21.03, 105.85, 21.03, 105.85); same != 0 {
		t.Errorf("distance to the same point = %.4f, want 0", same)
	}
}

func TestOppositeSidesOfTheEarthAreWithinTheMaximum(t *testing.T) {
	got := haversineKm(0, 0, 0, 180)
	if got > maxEarthDistanceKm+1 {
		t.Errorf("antipodal distance = %.0f, exceeds the assumed maximum %.0f",
			got, maxEarthDistanceKm)
	}
}

// ---------------------------------------------------------------------------
// Dates on the same calendar day
// ---------------------------------------------------------------------------

func TestMonthDayLabel(t *testing.T) {
	cases := map[string]string{
		"05-19": "19 May",
		"01-01": "1 January",
		"12-31": "31 December",
		"bogus": "bogus",
	}
	for in, want := range cases {
		if got := monthDayLabel(in); got != want {
			t.Errorf("monthDayLabel(%q) = %q, want %q", in, got, want)
		}
	}
}
