package main

import (
	"bytes"
	_ "embed"
	"image"
	"image/color"
	"image/draw"
	_ "image/gif"
	_ "image/jpeg"
	"image/png"
	"io"
	"math"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/image/font"
	"golang.org/x/image/font/opentype"
	"golang.org/x/image/math/fixed"
)

// The share card. Pasting a link into Slack, Twitter or Discord shows this
// image, which is the only thing most people will ever see of the site, so it
// carries the whole fact on its own: the sentence, both faces, and the two
// lifespans with the shared years marked.
//
// DejaVu is bundled rather than read from the system because it covers
// Vietnamese, and a card that cannot spell "Nguyễn Huệ" is useless here.

//go:embed assets/DejaVuSans.ttf
var fontRegularTTF []byte

//go:embed assets/DejaVuSans-Bold.ttf
var fontBoldTTF []byte

const (
	cardWidth  = 1200
	cardHeight = 630
)

var (
	cardBG    = color.RGBA{0xF5, 0xF7, 0xFA, 0xFF}
	cardPanel = color.RGBA{0xFF, 0xFF, 0xFF, 0xFF}
	cardInk   = color.RGBA{0x2C, 0x3E, 0x50, 0xFF}
	cardDim   = color.RGBA{0x7F, 0x8C, 0x8D, 0xFF}
	cardGold  = color.RGBA{0xD4, 0xA0, 0x17, 0xFF}
	cardTrack = color.RGBA{0xE6, 0xEA, 0xEF, 0xFF}
	// NRGBA, not RGBA. Go's color.RGBA is alpha-premultiplied, so giving it
	// straight channel values with a low alpha produces a colour that is not
	// the one you asked for: this band came out violet over the red bars.
	cardOverlapC = color.NRGBA{0xD4, 0xA0, 0x17, 0x3C}
)

var categoryRGB = map[string]color.RGBA{
	"Leaders":       {0xE0, 0x52, 0x52, 0xFF},
	"Scientists":    {0x4A, 0x90, 0xE2, 0xFF},
	"Artists":       {0xB0, 0x7F, 0xD8, 0xFF},
	"Thinkers":      {0x27, 0xAE, 0x80, 0xFF},
	"Military":      {0xE6, 0x7E, 0x22, 0xFF},
	"Explorers":     {0x16, 0xA0, 0x85, 0xFF},
	"Sport":         {0x7F, 0x8C, 0x8D, 0xFF},
	"Entertainment": {0xD0, 0x81, 0xA8, 0xFF},
	"Business":      {0x8E, 0x7C, 0x5A, 0xFF},
}

func entityColor(e *Entity) color.RGBA {
	if e.Category != nil {
		if c, ok := categoryRGB[*e.Category]; ok {
			return c
		}
	}
	return cardGold
}

type faceSet struct {
	headline font.Face
	name     font.Face
	body     font.Face
	small    font.Face
}

var (
	faces     *faceSet
	facesErr  error
	facesOnce sync.Once
)

func newFace(ttf []byte, size float64) (font.Face, error) {
	f, err := opentype.Parse(ttf)
	if err != nil {
		return nil, err
	}
	return opentype.NewFace(f, &opentype.FaceOptions{
		Size: size, DPI: 72, Hinting: font.HintingFull,
	})
}

func loadFaces() (*faceSet, error) {
	facesOnce.Do(func() {
		set := &faceSet{}
		var err error
		if set.headline, err = newFace(fontBoldTTF, 40); err != nil {
			facesErr = err
			return
		}
		if set.name, err = newFace(fontBoldTTF, 22); err != nil {
			facesErr = err
			return
		}
		if set.body, err = newFace(fontRegularTTF, 19); err != nil {
			facesErr = err
			return
		}
		if set.small, err = newFace(fontRegularTTF, 16); err != nil {
			facesErr = err
			return
		}
		faces = set
	})
	return faces, facesErr
}

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

func fillRect(dst draw.Image, x, y, w, h int, c color.Color) {
	if w <= 0 || h <= 0 {
		return
	}
	draw.Draw(dst, image.Rect(x, y, x+w, y+h), &image.Uniform{c}, image.Point{}, draw.Src)
}

// blendRect paints a translucent colour over what is already there. fillRect
// uses draw.Src, which replaces pixels outright: painting the overlap band with
// it wiped out the two lifespan bars underneath.
func blendRect(dst draw.Image, x, y, w, h int, c color.Color) {
	if w <= 0 || h <= 0 {
		return
	}
	draw.Draw(dst, image.Rect(x, y, x+w, y+h), &image.Uniform{c}, image.Point{}, draw.Over)
}

// roundRect is a rectangle with square ends good enough at these sizes, plus
// rounded caps so the lifespan bars do not look like raw blocks.
func roundRect(dst draw.Image, x, y, w, h int, c color.Color) {
	if w <= 0 || h <= 0 {
		return
	}
	r := h / 2
	if r > w/2 {
		r = w / 2
	}
	fillRect(dst, x+r, y, w-2*r, h, c)
	fillCircle(dst, x+r, y+r, r, c)
	fillCircle(dst, x+w-r-1, y+r, r, c)
}

func fillCircle(dst draw.Image, cx, cy, r int, c color.Color) {
	for dy := -r; dy <= r; dy++ {
		for dx := -r; dx <= r; dx++ {
			if dx*dx+dy*dy <= r*r {
				dst.Set(cx+dx, cy+dy, c)
			}
		}
	}
}

// circleMask is the alpha channel that turns a square thumbnail into a round
// portrait, with a soft edge so it does not look jagged.
type circleMask struct {
	r int
}

func (m *circleMask) ColorModel() color.Model { return color.AlphaModel }
func (m *circleMask) Bounds() image.Rectangle { return image.Rect(0, 0, 2*m.r, 2*m.r) }
func (m *circleMask) At(x, y int) color.Color {
	dx := float64(x-m.r) + 0.5
	dy := float64(y-m.r) + 0.5
	d := math.Sqrt(dx*dx + dy*dy)
	edge := float64(m.r) - d
	switch {
	case edge >= 1:
		return color.Alpha{A: 255}
	case edge <= 0:
		return color.Alpha{A: 0}
	default:
		return color.Alpha{A: uint8(edge * 255)}
	}
}

func textWidth(face font.Face, s string) int {
	return font.MeasureString(face, s).Round()
}

func drawText(dst draw.Image, face font.Face, c color.Color, x, y int, s string) {
	d := &font.Drawer{
		Dst: dst, Src: &image.Uniform{c}, Face: face,
		Dot: fixed.P(x, y),
	}
	d.DrawString(s)
}

func drawTextCentered(dst draw.Image, face font.Face, c color.Color, cx, y int, s string) {
	drawText(dst, face, c, cx-textWidth(face, s)/2, y, s)
}

// wrapText breaks a sentence to fit a width. Splitting on spaces is enough for
// the languages these headlines are written in.
func wrapText(face font.Face, s string, maxWidth int) []string {
	var lines []string
	var line string
	for _, word := range splitSpaces(s) {
		candidate := word
		if line != "" {
			candidate = line + " " + word
		}
		if textWidth(face, candidate) <= maxWidth || line == "" {
			line = candidate
			continue
		}
		lines = append(lines, line)
		line = word
	}
	if line != "" {
		lines = append(lines, line)
	}
	return lines
}

func splitSpaces(s string) []string {
	var out []string
	start := -1
	for i, r := range s {
		if r == ' ' {
			if start >= 0 {
				out = append(out, s[start:i])
				start = -1
			}
			continue
		}
		if start < 0 {
			start = i
		}
	}
	if start >= 0 {
		out = append(out, s[start:])
	}
	return out
}

// ---------------------------------------------------------------------------
// Portraits
// ---------------------------------------------------------------------------

var (
	thumbCache   = map[string]image.Image{}
	thumbCacheMu sync.Mutex
)

// fetchThumb pulls a portrait from Wikimedia. A failure is not an error worth
// reporting: the card falls back to an initial, which still reads fine.
func fetchThumb(url string) image.Image {
	if url == "" {
		return nil
	}
	thumbCacheMu.Lock()
	if img, ok := thumbCache[url]; ok {
		thumbCacheMu.Unlock()
		return img
	}
	thumbCacheMu.Unlock()

	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil
	}
	req.Header.Set("User-Agent", "CoincidenceMap/1.0 (share card renderer)")
	client := &http.Client{Timeout: 8 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil
	}
	// Wikimedia thumbnails are small, but cap the read anyway rather than
	// trusting a remote Content-Length.
	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return nil
	}
	img, _, err := image.Decode(bytes.NewReader(body))
	if err != nil {
		return nil
	}

	thumbCacheMu.Lock()
	if len(thumbCache) > 500 {
		thumbCache = map[string]image.Image{}
	}
	thumbCache[url] = img
	thumbCacheMu.Unlock()
	return img
}

// scaleToSquare crops the source to a centred square and samples it down to
// size. Nearest neighbour is enough for a 180px portrait.
func scaleToSquare(src image.Image, size int) *image.RGBA {
	b := src.Bounds()
	side := b.Dx()
	if b.Dy() < side {
		side = b.Dy()
	}
	offX := b.Min.X + (b.Dx()-side)/2
	// Faces sit high in a portrait, so bias the crop towards the top rather
	// than taking the middle of the image.
	offY := b.Min.Y + (b.Dy()-side)/4

	dst := image.NewRGBA(image.Rect(0, 0, size, size))
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			sx := offX + x*side/size
			sy := offY + y*side/size
			dst.Set(x, y, src.At(sx, sy))
		}
	}
	return dst
}

func drawPortrait(dst draw.Image, e *Entity, cx, cy, r int) {
	ring := entityColor(e)
	fillCircle(dst, cx, cy, r+4, ring)

	var thumb image.Image
	if e.ThumbnailURL != nil {
		thumb = fetchThumb(*e.ThumbnailURL)
	}

	if thumb == nil {
		fillCircle(dst, cx, cy, r, color.RGBA{0xE8, 0xEC, 0xF1, 0xFF})
		if f, err := loadFaces(); err == nil {
			initial := firstRune(e.Name)
			drawTextCentered(dst, f.headline, cardDim, cx, cy+14, initial)
		}
		return
	}

	square := scaleToSquare(thumb, 2*r)
	draw.DrawMask(dst,
		image.Rect(cx-r, cy-r, cx+r, cy+r),
		square, image.Point{},
		&circleMask{r: r}, image.Point{},
		draw.Over)
}

func firstRune(s string) string {
	for _, r := range s {
		return string(r)
	}
	return "?"
}

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

func renderPairCard(pair *PairResult) (*image.RGBA, error) {
	f, err := loadFaces()
	if err != nil {
		return nil, err
	}

	img := image.NewRGBA(image.Rect(0, 0, cardWidth, cardHeight))
	draw.Draw(img, img.Bounds(), &image.Uniform{cardBG}, image.Point{}, draw.Src)
	fillRect(img, 40, 34, cardWidth-80, cardHeight-68, cardPanel)
	// A gold rule along the top edge, so the card reads as one object in a feed.
	fillRect(img, 40, 34, cardWidth-80, 6, cardGold)

	// Headline, at most three lines.
	lines := wrapText(f.headline, pair.Headline, cardWidth-200)
	if len(lines) > 3 {
		lines = lines[:3]
	}
	y := 118
	for _, line := range lines {
		drawTextCentered(img, f.headline, cardInk, cardWidth/2, y, line)
		y += 52
	}

	// Portraits.
	const portraitR = 96
	portraitY := y + 96
	drawPortrait(img, pair.A, 246, portraitY, portraitR)
	drawPortrait(img, pair.B, cardWidth-246, portraitY, portraitR)

	drawTextCentered(img, f.name, cardInk, 246, portraitY+portraitR+44, pair.A.Name)
	drawTextCentered(img, f.name, cardInk, cardWidth-246, portraitY+portraitR+44, pair.B.Name)
	drawTextCentered(img, f.small, cardDim, 246, portraitY+portraitR+70, lifespanText(pair.A))
	drawTextCentered(img, f.small, cardDim, cardWidth-246, portraitY+portraitR+70, lifespanText(pair.B))

	// The shared period, above the bars. The distance already appears in the
	// reasons line at the bottom, so repeating it here wasted the slot.
	drawTextCentered(img, f.body, cardGold, cardWidth/2, portraitY-34, overlapLabel(pair))

	// Lifespan bars, the part a map cannot show.
	drawCardLifespans(img, f, pair, cardWidth/2-190, portraitY-8, 380)

	// The reasons this pair was picked, in the space the layout left over.
	drawTextCentered(img, f.body, cardDim, cardWidth/2, cardHeight-84, chipLine(pair))
	drawTextCentered(img, f.small, cardGold, cardWidth/2, cardHeight-48, "coincidence")
	return img, nil
}

// overlapLabel names the shared period in the fewest words that stay true.
func overlapLabel(pair *PairResult) string {
	if !pair.Overlaps {
		if pair.GapYears != nil {
			return "missed each other by " + strconv.Itoa(*pair.GapYears) + " years"
		}
		return "never overlapped"
	}
	if pair.OverlapDays != nil && *pair.OverlapDays < 400 {
		return strconv.Itoa(*pair.OverlapDays) + " days together"
	}
	if pair.OverlapStart == pair.OverlapEnd {
		return "shared " + yearLabel(pair.OverlapStart)
	}
	return "shared " + yearLabel(pair.OverlapStart) + " to " + yearLabel(pair.OverlapEnd)
}

// chipLine joins the reasons, dropping the caveat chip. A share card is not
// the place to explain that one death date is a guess.
func chipLine(pair *PairResult) string {
	var bits []string
	for _, c := range pair.Chips {
		if c.Kind == "estimate" {
			continue
		}
		bits = append(bits, c.Label)
	}
	return strings.Join(bits, "   ·   ")
}

func lifespanText(e *Entity) string {
	circa := ""
	if e.DatePrecision != nil && *e.DatePrecision == "circa" {
		circa = "c. "
	}
	from := circa + yearLabel(e.StartYear)
	if e.EndYear == nil {
		if e.Alive {
			return from + " to today"
		}
		return from + ", death unknown"
	}
	return from + " to " + circa + yearLabel(*e.EndYear)
}

// A year never takes a thousands separator. withThousands is for distances.
func yearLabel(y int) string {
	if y < 0 {
		return strconv.Itoa(-y) + " BCE"
	}
	return strconv.Itoa(y)
}

func drawCardLifespans(img draw.Image, f *faceSet, pair *PairResult, x, y, w int) {
	a, b := pair.A, pair.B
	aEnd, bEnd := a.EffectiveEnd(), b.EffectiveEnd()

	min := a.StartYear
	if b.StartYear < min {
		min = b.StartYear
	}
	max := aEnd
	if bEnd > max {
		max = bEnd
	}
	span := max - min
	if span < 1 {
		span = 1
	}
	scale := func(year int) int {
		return x + int(float64(year-min)/float64(span)*float64(w))
	}

	const barH = 16
	rows := []struct {
		e   *Entity
		end int
	}{{a, aEnd}, {b, bEnd}}

	// Order matters: empty tracks, then the shared band behind, then the bars
	// on top, then the edges of the shared period last so they stay visible.
	for i := range rows {
		fillRect(img, x, y+i*(barH+12), w, barH, cardTrack)
	}

	overlapEdges := func() (int, int) {
		os, oe := scale(pair.OverlapStart), scale(pair.OverlapEnd)
		if oe-os < 3 {
			oe = os + 3
		}
		return os, oe
	}

	if pair.Overlaps {
		os, oe := overlapEdges()
		blendRect(img, os, y-6, oe-os, 2*barH+24, cardOverlapC)
	}

	for i, row := range rows {
		top := y + i*(barH+12)
		left := scale(row.e.StartYear)
		width := scale(row.end) - left
		if width < 4 {
			width = 4
		}
		roundRect(img, left, top, width, barH, entityColor(row.e))
	}

	if pair.Overlaps {
		os, oe := overlapEdges()
		fillRect(img, os, y-6, 2, 2*barH+24, cardGold)
		fillRect(img, oe, y-6, 2, 2*barH+24, cardGold)
	}

	drawText(img, f.small, cardDim, x, y+2*barH+40, yearLabel(min))
	label := yearLabel(max)
	drawText(img, f.small, cardDim, x+w-textWidth(f.small, label), y+2*barH+40, label)
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

type cachedCard struct {
	data []byte
	at   time.Time
}

var (
	cardCache   = map[string]cachedCard{}
	cardCacheMu sync.Mutex
)

const cardCacheTTL = 12 * time.Hour

// handleCard renders /api/card?a=..&b=.. as a PNG. Social networks fetch this
// once and cache it, so the work happens rarely.
func handleCard(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	idA, idB := q.Get("a"), q.Get("b")
	if idA == "" || idB == "" {
		http.Error(w, "need a and b", http.StatusBadRequest)
		return
	}
	key := idA + "/" + idB

	cardCacheMu.Lock()
	if c, ok := cardCache[key]; ok && time.Since(c.at) < cardCacheTTL {
		data := c.data
		cardCacheMu.Unlock()
		writePNG(w, data)
		return
	}
	cardCacheMu.Unlock()

	a, err := fetchEntity(idA)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	b, err := fetchEntity(idB)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	img, err := renderPairCard(buildPair(a, b))
	if err != nil {
		http.Error(w, "render failed", http.StatusInternalServerError)
		return
	}

	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		http.Error(w, "encode failed", http.StatusInternalServerError)
		return
	}
	data := buf.Bytes()

	cardCacheMu.Lock()
	if len(cardCache) > 300 {
		cardCache = map[string]cachedCard{}
	}
	cardCache[key] = cachedCard{data: data, at: time.Now()}
	cardCacheMu.Unlock()

	writePNG(w, data)
}

func writePNG(w http.ResponseWriter, data []byte) {
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "public, max-age=86400")
	w.Write(data)
}
