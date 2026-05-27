# API Reference

## Endpoints

### `GET /api/year-summary`

Returns up to 150 entities active around a given year, sorted by importance.

| Param | Type | Description |
| --- | --- | --- |
| `year` | integer | Matches entities whose lifespan overlaps `year ± 30`. |

### `GET /api/search-name`

Name search against the `name` column using `%q%`.

| Param | Type | Description |
| --- | --- | --- |
| `q` | string | Search term. |

### `GET /api/contemporaries`

Returns up to 30 entities whose lifespans overlap a given range, sorted by importance.

| Param | Type | Description |
| --- | --- | --- |
| `start` | integer | Start year of the focus person. |
| `end` | integer | End year of the focus person. |
| `excludeId` | string | Wikidata Q-ID to exclude. |
| `category` | string | Optional. Filter by category (e.g. `Leaders`). |

### `GET /api/history-density`

Entity counts grouped by 50-year buckets. Drives the timeline sparkline.

### `GET /api/categories`

All distinct category values in the database.

## External APIs

Wikipedia REST API, called client-side to fetch biography and thumbnail:

```
GET https://en.wikipedia.org/api/rest_v1/page/summary/{wpTitle}
```
