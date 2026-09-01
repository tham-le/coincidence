# API Reference

All endpoints are `GET` under `/api`. Rate limited to 60 requests a minute per
address, with a burst of 20.

Every entity in a response carries the fields listed in `DATA_MODEL.md`. Note
that `end_year` may be `null`; use `alive` to tell "still living" from "nobody
recorded it".

## Pairs

### `GET /api/pair`

The full comparison of two entities. This is what the reveal card renders, and
what `/pair/:a/:b` in the browser resolves to.

| Param | Type | Description |
| --- | --- | --- |
| `a` | string | Wikidata Q-ID. |
| `b` | string | Wikidata Q-ID. |

Response:

| Field | Description |
| --- | --- |
| `a`, `b` | The two entities. |
| `headline` | One sentence, phrased for how brief the overlap was. |
| `overlaps` | Whether their lives touched at all. |
| `overlap_years` | Whole years shared. |
| `overlap_days` | Days shared. **Only present when both boundary dates are known to the day**, so the number is never an artefact of assuming 1 January. |
| `overlap_start`, `overlap_end` | Years bounding the shared period. |
| `gap_years` | Present instead of the overlap fields when they missed each other. |
| `distance_km` | Great-circle distance between their two places. |
| `chips` | Reasons this pair is interesting: distance, regions, fields, brevity, and a warning when a death date is estimated. |
| `age_a_at_b_birth`, `age_b_at_a_birth` | Age of the older one when the younger was born. |
| `end_estimated_a`, `end_estimated_b` | True when that person's death year was assumed rather than recorded. |

### `GET /api/reveal`

Picks a pair worth showing. Scores candidates on distance, different field of
life, different region, brevity of overlap, and the product of both fame scores,
so one famous name cannot carry an unknown one into the result.

| Param | Type | Description |
| --- | --- | --- |
| `anchor` | string | Optional. Keep this person and find them a new partner. |

Returns the same shape as `/api/pair`.

### `GET /api/daily`

Today's coincidence, the same pair for everyone. Changes at UTC midnight. Used
as the default on the Coincidence tab, so there is a reason to come back.

| Param | Type | Description |
| --- | --- | --- |
| `date` | string | Optional `YYYY-MM-DD`, for checking another day. |

Returns `{ date, pair }` where `pair` has the `/api/pair` shape. Selection is
deterministic: the anchor is an offset into an id-ordered list of curated
people, and candidates are scored in a fixed order, so no call can return a
different answer from another on the same day.

### `GET /api/card`

Renders the share card as a 1200x630 PNG. This is what `og:image` points at, so
it is fetched by crawlers rather than by the app. Results are cached in memory
for 12 hours and portraits are cached separately.

| Param | Type | Description |
| --- | --- | --- |
| `a` | string | Wikidata Q-ID. |
| `b` | string | Wikidata Q-ID. |

## Surprises

### `GET /api/same-day`

One calendar date across all of history: who was born on it, who died on it, and
the sharper version, someone born on the exact day someone else died.

| Param | Type | Description |
| --- | --- | --- |
| `md` | string | `MM-DD`. Defaults to today. |

Only dates flagged reliable are used, so the page never asserts a birthday that
is really a tradition.

### `GET /api/shared-birthday`

Pairs born on the same calendar date but centuries apart.

| Param | Type | Description |
| --- | --- | --- |
| `min_gap` | integer | Minimum years between the two births. Default 200. |

### `GET /api/near-miss`

Pairs whose lives did not touch, closest first. "They missed each other by four
months" is often a better story than a long overlap.

| Param | Type | Description |
| --- | --- | --- |
| `within` | integer | Search window in years, 1 to 60. Default 8. |
| `anchor` | string | Optional Q-ID: near misses for one person. |

Returns `/api/pair` objects with `overlaps: false`, carrying `gap_years` and,
when both boundary dates are trustworthy, `gap_days`.

## Social previews

Routes are served by the Go server, which fills in `og:` and `twitter:` tags per
route before returning `index.html`. A crawler never runs the app, so without
this every shared link previewed as a bare line with no image.

Set `PUBLIC_URL` in production so `og:image` is absolute and points at the real
host. Without it the server derives the origin from `X-Forwarded-Proto`,
`X-Forwarded-Host` and `Host`.

## Years

### `GET /api/year-card`

One year across the world, grouped by region.

| Param | Type | Description |
| --- | --- | --- |
| `year` | integer | Negative for BCE. |
| `per_region` | integer | Optional, 1 to 20. Default 6. |

Returns `{ year, regions: [{ region, people, events }] }`, regions ordered by
how much is happening in each.

### `GET /api/year-summary`

Up to 150 entities alive in a given year, ranked by `fame` with a bonus for
curated rows, then balanced so no single category fills the map. Drives the map
view.

| Param | Type | Description |
| --- | --- | --- |
| `year` | integer | |

### `GET /api/history-density`

Entity counts in 20-year buckets. Drives the timeline sparkline.

## Waves

### `GET /api/waves`

Buckets events of one kind over time and marks the buckets that stand out. A
bucket is a wave when its count is more than one standard deviation above the
mean **and** its events span at least three regions, so one busy country cannot
manufacture one.

| Param | Type | Description |
| --- | --- | --- |
| `kind` | string | Category name, or `all`. Default `Revolutions`. |
| `from`, `to` | integer | Year range. Default 1500 to 2000. |
| `bucket` | integer | Bucket size in years, 5 to 100. Default 20. |

Returns `{ kind, bucket_size, mean, stddev, buckets, climate }`. Each bucket has
`start`, `end`, `count`, `regions`, `is_wave`, and `examples` for waves.

`climate` carries large sulfur-rich eruptions and cold periods that fall in the
window, so the chart can show them on the same axis. The list lives in
`server/climate.go`. The site deliberately computes no correlation from it: ten
eruptions cannot measure anything, and the page says so.

### `GET /api/wave-kinds`

Event categories with at least 20 rows, as `{ name, count }`.

## People

### `GET /api/search-name`

Searches the `name` column **and the alias table**, so a reign name, a birth
name, or a Vietnamese spelling all find the same row. Results are ranked by how
exactly they matched, then by `fame`.

| Param | Type | Description |
| --- | --- | --- |
| `q` | string | At least 2 characters. |

### `GET /api/entity/{id}`

One entity. Fetches and caches the Wikipedia summary on first request.

### `GET /api/contemporaries`

Entities whose lifespans overlap a given range, scored on shared years, distance
from the focus point, and `fame`.

| Param | Type | Description |
| --- | --- | --- |
| `start`, `end` | integer | The focus person's lifespan. |
| `excludeId` | string | Q-ID to leave out. |
| `category` | string | Optional filter. |
| `lat`, `lon` | float | Focus point for the distance term. |

### `GET /api/event-contemporaries`

People alive during an event, optionally inside a bounding box
(`latMin`, `latMax`, `lonMin`, `lonMax`).

### `GET /api/search-region`

Top people alive near a point, within 9 degrees and 30 years.

| Param | Type | Description |
| --- | --- | --- |
| `year` | integer | |
| `lat`, `lon` | float | |

### `GET /api/categories`

Distinct category values.

## External APIs

Wikipedia REST, called by the server and cached into the `summary` column:

```
GET https://en.wikipedia.org/api/rest_v1/page/summary/{wpTitle}
```
