const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, 'coincidence.db'));
const SPARQL_URL = 'https://query.wikidata.org/sparql';
const HEADERS = { 'User-Agent': 'GlobalSynchronicityApp/2.0 (contact: user@example.com)' };

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function sparql(query, timeoutMs = 60000) {
    const url = SPARQL_URL + '?format=json&query=' + encodeURIComponent(query);
    const res = await axios.get(url, { headers: HEADERS, timeout: timeoutMs });
    return res.data.results.bindings;
}

async function ensureTable() {
    return new Promise(r => db.run(`CREATE TABLE IF NOT EXISTS historical_entities (
        id TEXT PRIMARY KEY, name TEXT, wpTitle TEXT, type TEXT,
        start_year INTEGER, end_year INTEGER, latitude REAL, longitude REAL,
        importance_score INTEGER, thumbnailUrl TEXT, category TEXT, summary TEXT
    )`, r));
}

// Wikidata class QIDs, grouped by category.
// Q198      = war
// Q103495   = world war
// Q8465     = civil war
// Q178561   = battle
// Q10931    = revolution
// Q831663   = rebellion
// Q188686   = military conflict (broad catch-all)
const WAR_CLASSES = [
    'wd:Q198',    // war
    'wd:Q103495', // world war
    'wd:Q8465',   // civil war
    'wd:Q188686', // military conflict
];

const REVOLUTION_CLASSES = [
    'wd:Q10931',  // revolution
    'wd:Q831663', // rebellion
];

const BATTLE_CLASSES = [
    'wd:Q178561', // battle
];

const GROUPS = [
    { label: 'Wars',        classes: WAR_CLASSES,        category: 'Wars' },
    { label: 'Revolutions', classes: REVOLUTION_CLASSES, category: 'Revolutions' },
    { label: 'Battles',     classes: BATTLE_CLASSES,     category: 'Battles' },
];

// Minimum sitelinks to keep only events with real Wikipedia presence.
const MIN_SITELINKS = 10;

function insertRows(rows, category) {
    return new Promise((resolve) => {
        db.serialize(() => {
            const stmt = db.prepare(`INSERT OR REPLACE INTO historical_entities
                (id, name, wpTitle, type, start_year, end_year, latitude, longitude,
                 importance_score, thumbnailUrl, category, summary)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
            let count = 0;
            for (const b of rows) {
                try {
                    const startMatch = b.start.value.match(/-?\d+/);
                    if (!startMatch) continue;

                    const id = b.item.value.split('/').pop();
                    const name = b.itemLabel.value;
                    const wpTitle = b.wpTitle ? b.wpTitle.value : name;
                    const startYear = parseInt(startMatch[0]);

                    let endYear = startYear;
                    if (b.end) {
                        const endMatch = b.end.value.match(/-?\d+/);
                        if (endMatch) endYear = parseInt(endMatch[0]);
                    }

                    const lat = parseFloat(b.lat.value);
                    const lon = parseFloat(b.lon.value);
                    if (isNaN(lat) || isNaN(lon)) continue;

                    stmt.run(
                        id, name, wpTitle, 'event',
                        startYear, endYear,
                        lat, lon,
                        parseInt(b.sitelinks ? b.sitelinks.value : 0),
                        b.img ? b.img.value + '?width=400' : null,
                        category,
                        null
                    );
                    count++;
                } catch (_) {}
            }
            stmt.finalize(() => resolve(count));
        });
    });
}

// Use VALUES ?cls to match a set of classes in one query.
// Location fallback chain: direct P625 -> P276 location -> P17 country.
function buildQuery(classValues, minYear, maxYear) {
    return `
SELECT DISTINCT ?item ?itemLabel ?start ?end ?lat ?lon ?sitelinks ?wpTitle ?img WHERE {
  VALUES ?cls { ${classValues.join(' ')} }
  ?item wdt:P31 ?cls ;
        wdt:P580 ?start ;
        wikibase:sitelinks ?sitelinks .
  FILTER(YEAR(?start) >= ${minYear} && YEAR(?start) <= ${maxYear})
  FILTER(?sitelinks >= ${MIN_SITELINKS})
  {
    ?item wdt:P625 ?coords .
  } UNION {
    ?item wdt:P276 ?loc . ?loc wdt:P625 ?coords .
  } UNION {
    ?item wdt:P17 ?country . ?country wdt:P625 ?coords .
  }
  OPTIONAL { ?item wdt:P582 ?end . }
  OPTIONAL { ?item wdt:P18 ?img . }
  OPTIONAL {
    ?wpArticle schema:about ?item ;
               schema:isPartOf <https://en.wikipedia.org/> ;
               schema:name ?wpTitle .
  }
  BIND(geof:latitude(?coords) AS ?lat)
  BIND(geof:longitude(?coords) AS ?lon)
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT 500`;
}

// Split the full time range into chunks to avoid Wikidata timeouts.
const CHUNKS = [
    [-3000,  500],
    [  500, 1500],
    [ 1500, 1800],
    [ 1800, 1900],
    [ 1900, 1950],
    [ 1950, 2024],
];

async function harvestGroup(group) {
    console.log(`\n=== ${group.label} ===`);
    let groupTotal = 0;

    for (const [minYear, maxYear] of CHUNKS) {
        process.stdout.write(`  ${minYear} to ${maxYear} ... `);

        const q = buildQuery(group.classes, minYear, maxYear);
        let rows = null;

        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                rows = await sparql(q, 60000);
                break;
            } catch (e) {
                const wait = (attempt + 1) * 20000;
                process.stdout.write(`(retry ${attempt + 1}, wait ${wait / 1000}s) `);
                await sleep(wait);
            }
        }

        if (!rows) {
            console.log('skipped (timeout)');
        } else {
            const saved = await insertRows(rows, group.category);
            console.log(`${saved} saved (${rows.length} raw)`);
            groupTotal += saved;
        }

        await sleep(5000);
    }

    console.log(`  Subtotal ${group.label}: ${groupTotal}`);
    return groupTotal;
}

async function harvest() {
    console.log('=== Events Harvest: Wars, Revolutions & Battles ===');
    await ensureTable();

    const before = await new Promise(r =>
        db.get("SELECT COUNT(*) as n FROM historical_entities WHERE type='event'", (_, row) => r(row ? row.n : 0))
    );
    console.log(`Events in DB before: ${before}`);

    let grand = 0;
    for (const group of GROUPS) {
        grand += await harvestGroup(group);
    }

    const after = await new Promise(r =>
        db.get("SELECT COUNT(*) as n FROM historical_entities WHERE type='event'", (_, row) => r(row ? row.n : 0))
    );
    console.log(`\nDone. Added ~${grand} rows. Events in DB: ${after}`);
    db.close();
}

harvest().catch(err => {
    console.error('Fatal:', err.message);
    db.close();
    process.exit(1);
});
