# Data Model

## Table: `historical_entities`

| Column | Type | Description |
| --- | --- | --- |
| `id` | TEXT (PK) | Wikidata Q-ID. |
| `name` | TEXT | Display name. |
| `wpTitle` | TEXT | Wikipedia page title, used as key for the REST API. |
| `type` | TEXT | `person` or `event`. |
| `start_year` | INTEGER | Birth year or event start. Negative values are BCE. |
| `end_year` | INTEGER | Death year or event end. **NULL means unknown or still living** (see below). |
| `start_date` | TEXT | ISO birth date when known to the month or day, else NULL. |
| `end_date` | TEXT | ISO death date when known to the month or day, else NULL. |
| `date_prec` | TEXT | Precision of the **birth** date: `day`, `month`, `year`, or `circa`. |
| `start_reliable` | INTEGER | 1 when the birth date may be used for exact-day facts. |
| `end_reliable` | INTEGER | 1 when the death date may be used for exact-day facts. |
| `alive` | INTEGER | 1 when the person has no recorded death and was born in 1935 or later. |
| `latitude` | REAL | -90 to 90. Birth place, falling back to death place, work place, then country. |
| `longitude` | REAL | -180 to 180. |
| `country` | TEXT | Country label from Wikidata P27 (people) or P17 (events). |
| `country_lat` | REAL | Country centre point, used to derive `region`. |
| `country_lon` | REAL | |
| `region` | TEXT | One of the ten region names below. |
| `importance_score` | INTEGER | Raw Wikidata sitelink count. Kept for reference, not used for ranking. |
| `fame` | REAL | Ranking score, roughly 0 to 125. See below. |
| `curated` | INTEGER | 1 for hand-picked figures, which ranking and pruning never drop. |
| `category` | TEXT | See below. |
| `thumbnailUrl` | TEXT | Wikimedia image URL. |
| `summary` | TEXT | The whole Wikipedia REST summary response, stored as a JSON string. |
| `occupations` | TEXT | Comma-separated Wikidata occupation ids (P106), kept so categories can be recomputed offline. |
| `enriched` | INTEGER | 1 once Wikidata facts have been fetched for the row. |
| `event_classified` | INTEGER | 1 once an event has been categorized from its Wikidata type. |

## Table: `entity_aliases`

| Column | Type | Description |
| --- | --- | --- |
| `entity_id` | TEXT | References `historical_entities(id)`. |
| `alias` | TEXT | Another name for the same person. |
| `lang` | TEXT | Language code of the alias. |

Roughly 35,000 rows in English, Vietnamese, French and Chinese. This is what
lets a search for "Quang Trung" find the row labelled "Nguyễn Huệ".

## A NULL `end_year`

Five harvesters each invented a different default death year (`2024`,
`birth + 40`, `birth + 60`, `birth + 72`). Those are cleared. A NULL now means
one of two things, and `alive` tells them apart:

- `alive = 1`: no recorded death, born 1935 or later. Treat the lifespan as
  running to the present.
- `alive = 0`: nobody recorded a death date. Mostly ancient figures.

Queries must not use `end_year >= ?`, which silently drops every NULL. The
server uses this expression instead, and the client mirrors it in `lib.js`:

```sql
COALESCE(end_year, CASE WHEN alive = 1 THEN 2026 ELSE start_year + 65 END)
```

The `start_year + 65` fallback exists only so overlap queries work. It is never
shown as a date: the API reports `end_estimated`, and the interface draws those
bars with a dashed fill.

## Categories

People, from Wikidata occupations (P106), weighted so a ruling or fighting role
outranks a side occupation:

`Leaders`, `Military`, `Scientists`, `Artists`, `Thinkers`, `Explorers`,
`Sport`, `Entertainment`

Events, from Wikidata type (P31 walked up P279*):

`Revolutions`, `Wars`, `Battles`, `Events`

Revolution roots are tested before war roots, because a civil war is also a kind
of war and would otherwise swallow every uprising.

A person's occupations are weighted rather than counted. Wikidata lists every
role someone ever held, so counting them equally lets four writing credits
outvote one "military officer". `OCCUPATION_WEIGHT` in `backend/occupations.js`
scores monarch, general and president well above writer, journalist and
professor. An occupation listed under two categories throws at load time, since
silently letting the last one win is how "military officer" once meant Business.

When no occupation maps to a category, the category is set to NULL rather than
left at whatever a harvester guessed from its search term. Curated rows are the
exception and keep theirs.

## Which dates can be trusted to the day

Before roughly 1500, an "exact" date is usually a tradition or a later
reconstruction. Wikidata stores those at day precision anyway, so the raw data
claims Plato was born on 2 May 426 BCE and Genghis Khan on 7 June 1162. No
historian accepts either.

The dates are kept, because they are still the best guess and the interface
prints them with "c.". Two flags decide what may use them:

```
start_reliable = start_date IS NOT NULL AND start_year >= 1500
                 AND (date_prec IS NULL OR date_prec = 'day')
end_reliable   = end_date   IS NOT NULL AND end_year   >= 1500
```

Birth and death are flagged **separately**. A single flag derived from
`date_prec`, which only ever described the birth, hid 1,359 recorded death
dates from the "died on this day" query.

Month precision is excluded because such a date is written with day 01, which
would collide with everyone genuinely born on the first of a month.

Anything counting days honours these: `overlap_days` and `gap_days` are omitted
rather than guessed, and the same-day pages skip untrusted rows entirely.

## Regions

Derived from the **country centre point**, not the birth place. Testing a birth
place against latitude boxes fails wherever the boxes meet: Zhu Xi, born in
Fujian, landed in "Southeast Asia" because the box around Vietnam also covers
southern China, and Ibn Battuta, born in Tangier, landed in "Europe" because
Tangier is north of Gibraltar. A country centre sits far from those edges.

`Southeast Asia`, `East Asia`, `South Asia`, `Central Asia`, `Middle East`,
`Africa`, `Europe`, `North America`, `South America`, `Oceania`, `Elsewhere`

## `fame`

Sitelinks measure who was written about in European languages, not who mattered.
`fame` replaces it:

```
local   = percentile within (region, century), pulled toward 0.5 for small groups
global   = log(1 + sitelinks) / log(1 + max sitelinks)
fame     = 100 * (0.65 * local + 0.35 * global) * REGION_BOOST[region]
```

Curated rows never fall below 62. The value is not clipped at 100, so boosted
regions run to about 125; clipping flattened every boosted region's top rows
into a tie and threw away their order.

`REGION_BOOST` is a single table at the top of `backend/rank.js` and is the one
place to tune how often each part of the world appears.

## Map projection

Equirectangular (Plate Carrée), locked to a 2:1 aspect ratio.

```
x = (lon + 180) / 3.6      // 0% to 100%
y = (90 - lat) / 1.8       // 0% to 100%
```
