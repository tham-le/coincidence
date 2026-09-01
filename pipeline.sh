#!/bin/bash
#
# Turn a freshly harvested database into one the site can use.
#
# The harvesters in backend/ collect rows. This pipeline is what makes those
# rows trustworthy: it clears the death years five different harvesters
# invented, refetches real dates from Wikidata, adds the aliases that make a
# reign name findable, pulls in the hand-picked figures, works out a fame score
# that is fair across the world, and drops the noise.
#
# Every step is safe to run again. Run the whole thing after any harvest.

set -e
cd "$(dirname "$0")/backend"

echo "=== 1/7 schema and cleanup ==="
node migrate.js

echo ""
echo "=== 2/7 real dates, categories and aliases from Wikidata ==="
node enrich.js

echo ""
echo "=== 3/7 hand-picked figures ==="
node seed_curated.js

echo ""
echo "=== 4/7 countries, for region labels ==="
node enrich_regions.js

echo ""
echo "=== 5/7 event classification and dates ==="
node enrich_events.js

echo ""
echo "=== 6/7 regions and fame ==="
node rank.js

echo ""
echo "=== 7/7 prune the noise, then rank again ==="
node prune.js --apply
node rank.js

echo ""
echo "Done. Start the site with ./run.sh"
