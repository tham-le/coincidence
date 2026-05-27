# API Reference

The backend coordinates metadata from SQLite and serves the frontend UI.

## Endpoints

### 1. `GET /api/year-summary`
Returns top entities active globally for a specific year.
*   **Query Params**: `year` (Integer)
*   **Logic**: Top 150 entities by `importance_score` where lifespan overlaps `year ± 30`.

### 2. `GET /api/search-name`
Fuzzy name search for historical figures.
*   **Query Params**: `q` (String)
*   **Logic**: Matches `%q%` against `name` column.

### 3. `GET /api/contemporaries`
Finds global contemporaries for a specific lifespan.
*   **Query Params**: 
    *   `start`, `end` (Integer): Lifespan of the focus person.
    *   `excludeId` (String): ID to skip (usually the focus person).
    *   `category` (String, Optional): Filter by category (e.g., 'Leaders').
*   **Logic**: Returns top 30 entities whose lives overlapped the given range.

### 4. `GET /api/history-density`
Data for the timeline sparkline.
*   **Logic**: Returns counts of entities grouped by 50-year buckets.

### 5. `GET /api/categories`
Returns a list of all unique categories in the database (e.g., Leaders, Scientists).

## External Integrations

### Wikipedia REST API (Client Side)
Used by `EntityCard` to fetch bios and high-res images.
*   **URL**: `https://en.wikipedia.org/api/rest_v1/page/summary/{wpTitle}`
