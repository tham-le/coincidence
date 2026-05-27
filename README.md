# Coincidence

A map of who was alive at the same time. Pick any historical figure and see their contemporaries across the world.

## What it does

- Timeline slider from 3000 BCE to today, with a density sparkline so you can see where history is concentrated
- Click any person to see everyone alive during their lifespan, plotted on the world map
- Filter by category: Leaders, Scientists, Artists, Philosophers, Military, Explorers
- Search by name to jump directly to a figure and their era
- Zone selection (Alt + drag) to find coincidences within a region
- Arrow keys to cycle through coincidence pairs

## Setup

```bash
./run.sh
```

Opens at [http://localhost:3000](http://localhost:3000).

## Building the database

Run these in order for a good initial dataset:

```bash
node backend/ingest.js          # globally notable figures by category
node backend/global_harvester.js # regional diversity across 15 countries
node backend/harvest_bronze.js   # ancient figures (pharaohs, early rulers)
node backend/harvest_random.js   # run repeatedly to fill gaps by era
```

## Stack

- Backend: Node.js + Express + SQLite
- Frontend: React, plain CSS, SVG for the map and connection lines
- Data: Wikidata via SPARQL for structured metadata, Wikipedia REST API for bios and images

## Docs

See `docs/` for API reference and data model.
