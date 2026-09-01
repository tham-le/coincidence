CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE historical_entities (
    id VARCHAR(50) PRIMARY KEY, -- Wikidata Q-number
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) CHECK (type IN ('person', 'event')),
    start_year INTEGER,
    end_year INTEGER,
    latitude FLOAT NOT NULL,
    longitude FLOAT NOT NULL,
    importance_score INTEGER DEFAULT 0,
    geom GEOMETRY(Point, 4326)
);

-- Index for spatial queries
CREATE INDEX idx_entities_geom ON historical_entities USING GIST (geom);
-- Index for temporal queries
CREATE INDEX idx_entities_years ON historical_entities (start_year, end_year);
