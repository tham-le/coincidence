#!/bin/bash

# Full harvest sequence. Run from the project root.
# Ctrl+C to stop once you're happy with the database size.

cd backend

echo "=== Step 1/3: categorized global figures ==="
node ingest.js

echo ""
echo "=== Step 2/3: regional diversity (15 countries) ==="
node global_harvester.js

echo ""
echo "=== Step 3/3: ancient figures ==="
node harvest_bronze.js

echo ""
echo "=== Step 4/5: wars, battles, and revolutions ==="
node harvest_events.js

echo ""
echo "=== Step 5/5: Vietnamese figures, women, and revolutionaries ==="
node harvest_targeted.js

echo ""
echo "Waiting 60s for Wikidata rate limit to reset before continuous harvest..."
sleep 60

echo ""
echo "=== Continuous random harvest (Ctrl+C to stop) ==="
echo "Each run covers 8 random 5-year windows and adds new people."
echo ""

echo "When you have enough rows, stop with Ctrl+C and run ./pipeline.sh"
echo "to clean, enrich, curate and rank what was collected."
echo ""

run=1
while true; do
    before=$(sqlite3 coincidence.db "SELECT COUNT(*) FROM historical_entities;")
    echo "--- Run #${run} (current: ${before} rows) ---"
    node harvest_random.js
    after=$(sqlite3 coincidence.db "SELECT COUNT(*) FROM historical_entities;")
    added=$((after - before))
    echo "Added: ${added} | Total: ${after}"
    echo ""
    run=$((run + 1))
    sleep 15
done
