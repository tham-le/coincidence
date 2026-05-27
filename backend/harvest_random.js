const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, 'coincidence.db'));
const SPARQL_URL = 'https://query.wikidata.org/sparql';
const HEADERS = { 'User-Agent': 'GlobalSynchronicityApp/2.0 (contact: user@example.com)' };

const OCC_TO_CATEGORY = {
    Q82955:    'Leaders',
    Q15712165: 'Leaders',
    Q484188:   'Leaders',
    Q30461:    'Leaders',
    Q1097498:  'Leaders',
    Q372436:   'Leaders',
    Q16947657: 'Leaders',
    Q3527302:  'Leaders',
    Q189348:   'Leaders',

    Q901:      'Scientists',
    Q170790:   'Scientists',
    Q11063:    'Scientists',
    Q169470:   'Scientists',
    Q593644:   'Scientists',
    Q3621491:  'Scientists',
    Q864503:   'Scientists',
    Q2110551:  'Scientists',
    Q205375:   'Scientists',
    Q2500638:  'Scientists',
    Q1650915:  'Scientists',

    Q483501:   'Artists',
    Q49757:    'Artists',
    Q482980:   'Artists',
    Q36180:    'Artists',
    Q1028181:  'Artists',
    Q6625963:  'Artists',
    Q33999:    'Artists',
    Q177220:   'Artists',
    Q36834:    'Artists',
    Q1281618:  'Artists',
    Q486748:   'Artists',
    Q33231:    'Artists',

    Q4964182:  'Philosophers',
    Q1234713:  'Philosophers',
    Q2259532:  'Philosophers',
    Q15995642: 'Philosophers',

    Q189290:   'Military',
    Q47064:    'Military',
    Q71032:    'Military',
    Q10418691: 'Military',
    Q15978655: 'Military',

    Q13582652: 'Explorers',
    Q4773904:  'Explorers',
    Q1371378:  'Explorers',
};

function inferCategory(occUri) {
    if (!occUri) return 'Global History';
    const id = occUri.split('/').pop();
    return OCC_TO_CATEGORY[id] || 'Global History';
}

function deduplicateRows(rows) {
    const byId = new Map();
    rows.forEach(b => {
        const id = b.item.value.split('/').pop();
        const cat = inferCategory(b.occ?.value);
        if (!byId.has(id)) {
            byId.set(id, { b, cat });
        } else if (byId.get(id).cat === 'Global History' && cat !== 'Global History') {
            byId.get(id).cat = cat;
        }
    });
    return byId;
}

function insertRows(rows) {
    return new Promise((resolve) => {
        const byId = deduplicateRows(rows);
        db.serialize(() => {
            const stmt = db.prepare("INSERT OR IGNORE INTO historical_entities VALUES (?,?,?,?,?,?,?,?,?,?,?,?)");
            let count = 0;
            for (const [, { b, cat }] of byId) {
                try {
                    const startMatch = b.start.value.match(/-?\d+/);
                    if (!startMatch) continue;

                    const id = b.item.value.split('/').pop();
                    const name = b.itemLabel.value;
                    const wpTitle = b.wpTitle ? b.wpTitle.value : name;
                    const startYear = parseInt(startMatch[0]);

                    let endYear = 2024;
                    if (b.end) {
                        const endMatch = b.end.value.match(/-?\d+/);
                        if (endMatch) endYear = parseInt(endMatch[0]);
                    }

                    const lat = parseFloat(b.lat.value);
                    const lon = parseFloat(b.lon.value);
                    if (isNaN(lat) || isNaN(lon)) continue;

                    stmt.run(
                        id, name, wpTitle, 'person',
                        startYear, endYear,
                        lat, lon,
                        parseInt(b.sitelinks ? b.sitelinks.value : 0),
                        b.img ? b.img.value + '?width=400' : null,
                        cat,
                        null
                    );
                    count++;
                } catch (err) {}
            }
            stmt.finalize(() => resolve(count));
        });
    });
}

async function sparql(query, timeoutMs = 45000) {
    const url = SPARQL_URL + '?format=json&query=' + encodeURIComponent(query);
    const res = await axios.get(url, { headers: HEADERS, timeout: timeoutMs });
    return res.data.results.bindings;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Build query using a 5-year window and OPTIONAL image to reduce join cost.
// Use direct wdt:P625 coords on the person (fast) and fall back to birthplace coords via OPTIONAL.
function buildQuery(year) {
    const y0 = year;
    const y1 = year + 4;
    return `
    SELECT ?item ?itemLabel ?lat ?lon ?start ?end ?sitelinks ?wpTitle ?img ?occ WHERE {
      ?item wdt:P31 wd:Q5 ;
            wdt:P569 ?start ;
            wikibase:sitelinks ?sitelinks .
      FILTER(YEAR(?start) >= ${y0} && YEAR(?start) <= ${y1})
      FILTER(?sitelinks > 25)
      ?wpArticle schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?wpTitle .
      {
        ?item wdt:P625 ?coords .
      } UNION {
        ?item wdt:P19 ?bp . ?bp wdt:P625 ?coords .
      }
      OPTIONAL { ?item wdt:P18 ?img . }
      OPTIONAL { ?item wdt:P570 ?end . }
      OPTIONAL { ?item wdt:P106 ?occ . }
      BIND(geof:latitude(?coords) AS ?lat)
      BIND(geof:longitude(?coords) AS ?lon)
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    } LIMIT 200`;
}

async function harvest() {
    console.log('--- Starting Random History Harvest ---');

    await new Promise(r => db.run(`CREATE TABLE IF NOT EXISTS historical_entities (
        id TEXT PRIMARY KEY, name TEXT, wpTitle TEXT, type TEXT,
        start_year INTEGER, end_year INTEGER, latitude REAL, longitude REAL,
        importance_score INTEGER, thumbnailUrl TEXT, category TEXT, summary TEXT
    )`, r));

    // Pick 8 random start years (5-year windows), spanning -500 to 1980
    const years = [];
    for (let i = 0; i < 8; i++) {
        years.push(Math.floor(Math.random() * (1980 - (-500) + 1)) + (-500));
    }

    let totalNew = 0;

    for (const year of years) {
        process.stdout.write(`  Years ${year}..${year + 4} ... `);

        const q = buildQuery(year);

        let rows = null;
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                rows = await sparql(q, 50000);
                break;
            } catch (e) {
                if (attempt === 0) {
                    process.stdout.write('(retry) ');
                    await sleep(20000);
                }
            }
        }

        if (!rows) {
            console.log('skipped');
        } else {
            const saved = await insertRows(rows);
            console.log(`${saved} added (${rows.length} raw rows)`);
            totalNew += saved;
        }

        await sleep(4000);
    }

    const total = await new Promise(r => db.get("SELECT COUNT(*) as n FROM historical_entities", (e, row) => r(row.n)));
    console.log(`\nFinished. Added ~${totalNew} new items. Total in DB: ${total}`);
    db.close();
}

harvest();
