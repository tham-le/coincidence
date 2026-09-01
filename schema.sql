-- The SQLite schema the site actually uses.
--
-- This file is documentation, not a migration. The database is built by the
-- harvesters and then shaped by backend/migrate.js, which adds each column if
-- it is missing and is safe to run again. Creating a database from this file
-- alone gives you the right shape with no rows in it.
--
-- Column meanings, and why some of them exist, are in docs/DATA_MODEL.md.

CREATE TABLE IF NOT EXISTS historical_entities (
    id                TEXT PRIMARY KEY,   -- Wikidata Q-id
    name              TEXT,
    wpTitle           TEXT,               -- Wikipedia page title
    type              TEXT,               -- 'person' or 'event'
    start_year        INTEGER,            -- birth or start; negative is BCE
    end_year          INTEGER,            -- death or end; NULL means unknown or living
    latitude          REAL,
    longitude         REAL,
    importance_score  INTEGER,            -- raw Wikidata sitelink count
    thumbnailUrl      TEXT,
    category          TEXT,
    summary           TEXT,               -- whole Wikipedia REST response, as JSON

    -- Dates good enough to count days with. An exact date before about 1500 is
    -- usually a tradition, so the two reliable flags gate anything that needs
    -- the exact day. Birth and death are flagged separately.
    start_date        TEXT,               -- ISO, when known to month or day
    end_date          TEXT,
    date_prec         TEXT,               -- precision of the birth date
    start_reliable    INTEGER DEFAULT 0,
    end_reliable      INTEGER DEFAULT 0,

    -- Ranking. fame is normalized within a region and century so a sitelink
    -- count, which measures who was written about in European languages, does
    -- not decide who appears. See backend/rank.js.
    fame              REAL,
    curated           INTEGER DEFAULT 0,  -- hand-picked; never ranked or pruned out
    region            TEXT,
    country           TEXT,
    country_lat       REAL,               -- country centre, used to derive region
    country_lon       REAL,

    alive             INTEGER DEFAULT 0,  -- no recorded death and born recently
    occupations       TEXT,               -- Wikidata P106 ids, comma separated
    enriched          INTEGER DEFAULT 0,
    event_classified  INTEGER DEFAULT 0
);

-- Another name for the same person. This is what lets a search for
-- "Quang Trung" find the row whose label is "Nguyen Hue".
CREATE TABLE IF NOT EXISTS entity_aliases (
    entity_id TEXT NOT NULL,
    alias     TEXT NOT NULL,
    lang      TEXT,
    PRIMARY KEY (entity_id, alias),
    FOREIGN KEY (entity_id) REFERENCES historical_entities(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_years   ON historical_entities (start_year, end_year);
CREATE INDEX IF NOT EXISTS idx_scores  ON historical_entities (importance_score);
CREATE INDEX IF NOT EXISTS idx_fame    ON historical_entities (fame);
CREATE INDEX IF NOT EXISTS idx_curated ON historical_entities (curated);
CREATE INDEX IF NOT EXISTS idx_name    ON historical_entities (name);

-- Expression indexes for "who was born or died on this date", which matches on
-- the month and day only.
CREATE INDEX IF NOT EXISTS idx_start_md ON historical_entities (substr(start_date, 6, 5));
CREATE INDEX IF NOT EXISTS idx_end_md   ON historical_entities (substr(end_date, 6, 5));

CREATE INDEX IF NOT EXISTS idx_alias        ON entity_aliases (alias);
CREATE INDEX IF NOT EXISTS idx_alias_entity ON entity_aliases (entity_id);
