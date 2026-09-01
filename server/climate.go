package main

// Climate markers for the waves chart.
//
// The question this answers is "when the weather goes bad, does the world
// revolt". It is a real line of history writing, not a private theory: Geoffrey
// Parker's Global Crisis argues it for the seventeenth century, and the Laki
// eruption wrecking French harvests before 1789 is a standard part of that
// story.
//
// What the site does with it is show the two things on one axis and let the
// reader judge. It does not compute a correlation, because with this many
// events any number would be noise dressed up as a finding. The interface says
// so on the page.
//
// Only large, sulfur-rich eruptions with well-established dates are listed.
// Sulfur reaching the stratosphere is what cools summers; a big lava eruption
// that stays low does not.

type climateMarker struct {
	Year  int    `json:"year"`
	End   int    `json:"end,omitempty"` // set for a period rather than a moment
	Label string `json:"label"`
	Kind  string `json:"kind"` // "eruption" or "period"
	Note  string `json:"note,omitempty"`
}

var climateMarkers = []climateMarker{
	{Year: 536, End: 545, Kind: "period", Label: "Dust veil of 536",
		Note: "Two eruptions in quick succession. Contemporaries wrote of a sun without brightness for a year."},
	{Year: 939, Kind: "eruption", Label: "Eldgjá, Iceland"},
	{Year: 1257, Kind: "eruption", Label: "Samalas, Lombok",
		Note: "The largest eruption of the last millennium. Followed by famine across Europe."},
	{Year: 1452, Kind: "eruption", Label: "Kuwae, Vanuatu"},
	{Year: 1300, End: 1850, Kind: "period", Label: "Little Ice Age",
		Note: "A long cool phase, not a single event. Shown as a band because its edges are argued over."},
	{Year: 1600, Kind: "eruption", Label: "Huaynaputina, Peru",
		Note: "Followed by the Russian famine of 1601 to 1603, which killed perhaps a third of the population."},
	{Year: 1641, Kind: "eruption", Label: "Mount Parker, Philippines"},
	{Year: 1783, Kind: "eruption", Label: "Laki, Iceland",
		Note: "Crop failure across Europe in the years before 1789."},
	{Year: 1815, Kind: "eruption", Label: "Tambora, Sumbawa",
		Note: "1816 was the year without a summer. Bread riots across Europe."},
	{Year: 1883, Kind: "eruption", Label: "Krakatoa"},
	{Year: 1902, Kind: "eruption", Label: "Santa María, Guatemala"},
	{Year: 1912, Kind: "eruption", Label: "Novarupta, Alaska"},
	{Year: 1991, Kind: "eruption", Label: "Pinatubo, Philippines"},
}

// markersInRange returns the markers that fall inside the chart's window, so a
// view of 1500 onward is not cluttered with the 536 dust veil.
func markersInRange(from, to int) []climateMarker {
	out := []climateMarker{}
	for _, m := range climateMarkers {
		end := m.End
		if end == 0 {
			end = m.Year
		}
		if end < from || m.Year > to {
			continue
		}
		out = append(out, m)
	}
	return out
}
