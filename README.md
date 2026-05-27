# Coincidence: Global Synchronicity Timeline

A visual engine for discovering historical "coincidences"—major figures and events from across the world who shared the same air and era.

## Features

- **Dynamic Timeline**: Explore human history from 3000 BCE to today using a specialized "History Sparkline" that shows data density across eras.
- **Global Synchronicity**: Select any person (e.g., Ho Chi Minh or Quang Trung) to instantly visualize their global contemporaries—people alive anywhere on Earth during their exact lifespan.
- **Visual Connections**: Real-time connection lines link your chosen subject to world leaders, scientists, and artists across the planet.
- **Intelligent Filtering**: Filter contemporaries by category: Leaders, Scientists, Artists, Philosophers, or Events.
- **Smart Search**: Find any major historical figure instantly; the map will automatically "time-travel" to their birth year and focus on their location.
- **High-Performance Map**: Custom "Pin & Glow" UI with perfect Equirectangular alignment, ensuring historical figures appear exactly where they lived.

## Quick Start

1. **Setup**: Run `./run.sh` from the root directory. This will install dependencies, build the frontend, and start the server.
2. **Access**: Open [http://localhost:3000](http://localhost:3000) in your browser.
3. **Data Ingestion**: 
   - `node backend/ingest.js`: Builds the initial global dataset using city-based and high-impact category harvesting.
   - `node backend/harvest_random.js`: An "endless" harvester that picks random years in history to build a massive, diverse database.

## Architecture

- **Backend**: Node.js/Express with SQLite for high-speed metadata lookups and temporal/spatial filtering.
- **Frontend**: React.js with custom SVG-driven mapping and CSS-based animation for smooth historical transitions.
- **Data Strategy**: Stores minimal "Skeleton" metadata (coordinates, years, importance, category) and fetches "Skin" (biographies/images) live via the Wikipedia REST API.

## Documentation
See the `agent-doc/` folder for detailed API, Data Model, and Handover documentation.
