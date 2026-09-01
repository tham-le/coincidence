package main

import (
	"fmt"
	"html"
	"net/http"
	"os"
	"strconv"
	"strings"
)

// Social previews.
//
// The page is a single-page app, so every route returns the same index.html and
// every shared link looked identical to Slack, Twitter and Discord: a bare grey
// line with no image. That breaks the only way a site like this spreads, since
// what people pass around is the fact, not the tool.
//
// The fix is to fill in the tags per route before handing index.html back. The
// crawler never runs the app, so this is the only chance to tell it anything.

type pageMeta struct {
	Title       string
	Description string
	Image       string // absolute URL, or empty for the default card
	URL         string
}

const defaultTitle = "Coincidence: who was alive at the same time"

const defaultDescription = "See who was alive at the same time, anywhere in the world. " +
	"The French Revolution and Quang Trung's revolution happened in the same year."

// baseURL works out how the visitor reached us so og:image can be absolute,
// which every crawler requires. PUBLIC_URL wins when set, for deployments
// behind a proxy that rewrites the host.
func baseURL(r *http.Request) string {
	if env := os.Getenv("PUBLIC_URL"); env != "" {
		return strings.TrimRight(env, "/")
	}
	scheme := "http"
	if proto := r.Header.Get("X-Forwarded-Proto"); proto != "" {
		scheme = proto
	} else if r.TLS != nil {
		scheme = "https"
	}
	host := r.Host
	if fwd := r.Header.Get("X-Forwarded-Host"); fwd != "" {
		host = fwd
	}
	return scheme + "://" + host
}

func metaForPath(r *http.Request, path string) pageMeta {
	base := baseURL(r)
	meta := pageMeta{
		Title:       defaultTitle,
		Description: defaultDescription,
		URL:         base + path,
	}

	parts := strings.Split(strings.Trim(path, "/"), "/")
	switch {
	case len(parts) == 3 && parts[0] == "pair":
		a, errA := fetchEntity(parts[1])
		b, errB := fetchEntity(parts[2])
		if errA != nil || errB != nil {
			return meta
		}
		pair := buildPair(a, b)
		meta.Title = pair.Headline
		meta.Description = pairDescription(pair)
		meta.Image = fmt.Sprintf("%s/api/card?a=%s&b=%s", base, a.ID, b.ID)

	case len(parts) == 2 && parts[0] == "year":
		year, err := strconv.Atoi(parts[1])
		if err != nil {
			return meta
		}
		meta.Title = fmt.Sprintf("The world in %s", yearLabel(year))
		meta.Description = fmt.Sprintf(
			"Who was alive in %s, across every part of the world, with their age that year.",
			yearLabel(year))

	case len(parts) == 1 && parts[0] == "waves":
		meta.Title = "Do revolutions happen at the same time?"
		meta.Description = "Revolutions, wars and battles bucketed by period, " +
			"marking the ones that spread across several regions at once."

	case len(parts) == 1 && parts[0] == "compare":
		meta.Title = "Compare any two lives"
		meta.Description = "Pick two people and see whether their lives overlapped, " +
			"by how much, and how old each was when the other was born."
	}

	return meta
}

func pairDescription(pair *PairResult) string {
	var bits []string
	for _, c := range pair.Chips {
		if c.Kind == "estimate" {
			continue
		}
		bits = append(bits, c.Label)
	}
	if len(bits) == 0 {
		return defaultDescription
	}
	// Capitalize the first chip so the sentence does not start lowercase.
	first := []rune(bits[0])
	first[0] = []rune(strings.ToUpper(string(first[0])))[0]
	bits[0] = string(first)
	return strings.Join(bits, " / ") + "."
}

// injectMeta writes the tags into the document head. index.html is built by
// the frontend toolchain and has no placeholder, so this splices in before the
// closing head tag.
func injectMeta(doc []byte, meta pageMeta) []byte {
	esc := html.EscapeString
	var b strings.Builder

	b.WriteString(`<meta name="description" content="` + esc(meta.Description) + `">`)
	b.WriteString(`<meta property="og:type" content="website">`)
	b.WriteString(`<meta property="og:site_name" content="Coincidence">`)
	b.WriteString(`<meta property="og:title" content="` + esc(meta.Title) + `">`)
	b.WriteString(`<meta property="og:description" content="` + esc(meta.Description) + `">`)
	b.WriteString(`<meta property="og:url" content="` + esc(meta.URL) + `">`)

	if meta.Image != "" {
		b.WriteString(`<meta property="og:image" content="` + esc(meta.Image) + `">`)
		b.WriteString(`<meta property="og:image:width" content="` + strconv.Itoa(cardWidth) + `">`)
		b.WriteString(`<meta property="og:image:height" content="` + strconv.Itoa(cardHeight) + `">`)
		b.WriteString(`<meta name="twitter:card" content="summary_large_image">`)
		b.WriteString(`<meta name="twitter:image" content="` + esc(meta.Image) + `">`)
	} else {
		b.WriteString(`<meta name="twitter:card" content="summary">`)
	}
	b.WriteString(`<meta name="twitter:title" content="` + esc(meta.Title) + `">`)
	b.WriteString(`<meta name="twitter:description" content="` + esc(meta.Description) + `">`)

	// The title tag itself matters too: it is what a link becomes in a
	// bookmark bar or a search result.
	out := replaceTitle(string(doc), meta.Title)
	return []byte(strings.Replace(out, "</head>", b.String()+"</head>", 1))
}

func replaceTitle(doc, title string) string {
	start := strings.Index(doc, "<title>")
	if start < 0 {
		return doc
	}
	end := strings.Index(doc[start:], "</title>")
	if end < 0 {
		return doc
	}
	return doc[:start+len("<title>")] + html.EscapeString(title) + doc[start+end:]
}
