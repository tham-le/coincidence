# Data Model: Historical Skeleton

Minimal metadata strategy: store searchable "skeleton" data in SQLite, fetch rich "skin" (content) from Wikipedia.

## SQLite Table: `historical_entities`

| Column | Type | Description |
| --- | --- | --- |
| `id` | TEXT (PK) | Wikidata Q-ID. |
| `name` | TEXT | Display name. |
| `wpTitle` | TEXT | English Wikipedia page title (REST API key). |
| `type` | TEXT | `person` or `event`. |
| `start_year` | INTEGER | Birth or Start (Supports BCE). |
| `end_year` | INTEGER | Death or End. |
| `latitude` | REAL | -90 to 90. |
| `longitude` | REAL | -180 to 180. |
| `importance_score` | INTEGER | Wikidata `sitelinks` count. |
| `thumbnailUrl` | TEXT | Wikimedia image link. |
| `category` | TEXT | Grouping: 'Leaders', 'Scientists', 'Artists', etc. |

## Map Projection
The app uses an **Equirectangular** projection (Plate Carrée).
- **Longitude to X**: `(lon + 180) / 3.6` (maps -180...180 to 0%...100%)
- **Latitude to Y**: `(90 - lat) / 1.8` (maps -90...90 to 0%...100%)
- **Visuals**: Locked to a `2:1` aspect ratio stage to prevent coordinate drift.
