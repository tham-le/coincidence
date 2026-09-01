# Coincidence

A map of who was alive at the same time. The French Revolution and Quang Trung's
revolution happened in the same year. Ho Chi Minh was born while Van Gogh had
71 days left to live. This site finds those.

## What it does

**Coincidence** opens on today's pair, the same one for everyone, and changes at
UTC midnight. "Show me another" draws a random one. Each pair One sentence, two portraits, two lifespan bars
with the shared years filled in, and the reasons it picked them: how far apart
they were, whether they worked in different fields, how brief the overlap was.
Every pair has its own link, so `/pair/Q36014/Q5582` always opens the same card.

**A year** shows one year across the whole world, grouped by region, with each
person's age that year. Type 1789 and the French Revolution sits beside Quang
Trung at 37 and Qianlong at 78.

**Compare two** takes any two names and works out whether their lives touched,
by how much, and how old each was when the other was born.

**On this day** takes one calendar date and shows who was born and who died on
it, and the sharper version: someone born on the exact day someone else died.
Pol Pot was born the day Max Scheler died. Ho Chi Minh, Pol Pot and Malcolm X
were all born on 19 May.

**They never met** sits under the daily coincidence: two lives that just missed
each other. Nelson Mandela was born 158 days after the last Ottoman sultan died.

**Waves** asks whether revolutions cluster in time. It buckets events by period
and marks a bucket as a wave when it is well above average *and* spans at least
three regions, so one busy country cannot invent one.

Waves also carries a climate layer: large sulfur-rich eruptions and the Little
Ice Age on the same axis as the revolutions, because "when the harvest fails,
does the world revolt" is a real line of history writing. The site shows the
juxtaposition and computes no correlation from it, because ten eruptions cannot
measure anything, and the page says so plainly.

**Map** is the original explorer: a timeline from 3000 BCE, a density sparkline,
dots on an equirectangular world map, zone selection with Alt and drag.

## Setup

```bash
./run.sh
```

Opens at [http://localhost:3000](http://localhost:3000).

In production set `PUBLIC_URL` to the real origin, for example
`PUBLIC_URL=https://example.com`. The server writes it into `og:image`, which
has to be an absolute URL for any social preview to work.

## Building the database

Harvest first, then run the pipeline. The harvesters collect rows; the pipeline
is what makes them trustworthy.

```bash
./harvest.sh     # collect rows from Wikidata (Ctrl+C when you have enough)
./pipeline.sh    # clean, enrich, curate, rank, prune
```

`pipeline.sh` is safe to run again at any time, and every step in it is
resumable.

### Why the pipeline exists

Raw Wikidata harvesting produces a database that cannot answer this site's own
question. The pipeline fixes four specific things.

**Invented death years.** Five harvesters each had a different default for a
missing death date: `2024`, `birth + 40`, `birth + 60`, `birth + 72`. That is
1,784 people given a death year nobody recorded, which makes "alive at the same
time" wrong for everyone recent. Now a missing death year is `NULL`, and the
interface says "to today" or "death unknown" instead of a number.

**Names nobody searches for.** Search only looked at the `name` column, so
typing "Quang Trung" found nothing while the row sat there under "Nguyễn Huệ".
There is now an alias table with roughly 35,000 entries in English, Vietnamese,
French and Chinese, and search reads it.

**Eurocentric ranking.** Wikidata sitelinks count how many language editions
wrote about someone, which tracks how much of the internet writes in European
languages. Quang Trung has 39; a mid-tier European has 80. Ranked that way, Asia
never appears next to the French Revolution. `rank.js` ranks a person inside
their own region and century first, blends a smaller amount of global reach back
in, and applies a per-region weight. The weights are one table at the top of
`backend/rank.js`; raise a number to see that part of the world more often.

**Categories that meant nothing.** There were 14 category values including four
spellings of "event", and `Global History` held 1,391 rows. Einstein was a
Philosopher and Leonardo an Explorer. Categories now come from Wikidata
occupations, and events are classified by what Wikidata says they are, which
moved 577 military campaigns out of "Revolutions".

Occupations are weighted, not counted. Wikidata lists every role a person ever
held, so a general who published his memoirs picks up writer, journalist,
essayist and poet, and a plain count makes him an artist. `backend/occupations.js`
gives each occupation a weight: monarch and general count for much more than
writer or professor. Raw occupation ids are stored on each row, so after editing
that file you can rerun `node backend/recategorize.js` to reclassify everyone
without going back to the network.

### Coverage gaps and how they are filled

Wikidata records an exact birth date and birth-place coordinate for most
Europeans and for far fewer people elsewhere. `seed_curated.js` walks outward
from birth place to place of death, place of work, then country, and
`backend/manual_figures.js` holds hand-entered dates and places for the 23
figures Wikidata cannot place at all, mostly ancient and non-European. Those
carry `date_prec = 'circa'` and are shown as approximate.

To add someone, put their English Wikipedia title in `backend/curated_list.js`
and rerun `node backend/seed_curated.js`. Titles are resolved through Wikipedia,
so a typo is reported rather than silently inserting the wrong person.

## Sharing

Pasting a link to a pair into Slack, Twitter or Discord shows a rendered card:
the sentence, both portraits, and the two lifespans with the shared years
marked. The Go server renders it as a PNG at `/api/card` and points `og:image`
at it, and fills the social tags per route before returning `index.html`.

The card font (DejaVu, bundled in `server/assets/`) is there rather than a
system font because it covers Vietnamese. A card that cannot spell "Nguyễn Huệ"
is no use here.

## Stack

- Backend: Go + SQLite, with Node scripts for harvesting and enrichment
- Frontend: React, plain CSS, SVG for the map and lifespan bars
- Data: Wikidata via SPARQL, Wikipedia REST API for bios and images

## Docs

See `docs/` for the API reference and data model.
