#!/bin/bash

set -e

# Build the frontend
echo "Building frontend..."
cd frontend
npm install --silent
npm run build --silent
cd ..

# Build the Go server
echo "Building server..."
cd server
go build -o coincidence-server .
cd ..

# Check for a database
if [ ! -f "backend/coincidence.db" ]; then
    echo "No database found. Build one first:"
    echo "  ./harvest.sh    # collect rows from Wikidata"
    echo "  ./pipeline.sh   # clean, enrich, curate, rank"
fi

echo "Starting server on http://localhost:3000"
DB_PATH=backend/coincidence.db FRONTEND_BUILD=frontend/build server/coincidence-server
