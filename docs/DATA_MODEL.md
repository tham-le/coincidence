# Data Model

## Table: `historical_entities`

| Column | Type | Description |
| --- | --- | --- |
| `id` | TEXT (PK) | Wikidata Q-ID. |
| `name` | TEXT | Display name. |
| `wpTitle` | TEXT | Wikipedia page title, used as key for the REST API. |
| `type` | TEXT | `person` or `event`. |
| `start_year` | INTEGER | Birth year or event start. Negative values are BCE. |
| `end_year` | INTEGER | Death year or event end. |
| `latitude` | REAL | -90 to 90. |
| `longitude` | REAL | -180 to 180. |
| `importance_score` | INTEGER | Wikidata sitelinks count, used for ranking. |
| `thumbnailUrl` | TEXT | Wikimedia image URL. |
| `category` | TEXT | One of: Leaders, Scientists, Artists, Philosophers, Military, Explorers, Events, Global History. |

## Map projection

Equirectangular (Plate Carrée), locked to a 2:1 aspect ratio.

```
x = (lon + 180) / 3.6      // 0% to 100%
y = (90 - lat) / 1.8       // 0% to 100%
```
