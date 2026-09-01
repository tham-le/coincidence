// Targeted harvester for three underrepresented groups:
//   1. Vietnamese historical figures  (sitelinks >= 3, coordinate fallback to country)
//   2. Women across history            (sitelinks >= 8, all regions)
//   3. Revolutionaries and independence leaders globally (sitelinks >= 8)

const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, 'coincidence.db'));
const SPARQL_URL = 'https://query.wikidata.org/sparql';
const HEADERS = { 'User-Agent': 'CoincidenceTargetedHarvester/1.0 (contact: user@example.com)' };

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function sparql(query, timeoutMs = 90000) {
    const url = SPARQL_URL + '?format=json&query=' + encodeURIComponent(query);
    const res = await axios.get(url, { headers: HEADERS, timeout: timeoutMs });
    return res.data.results.bindings;
}

const OCC_TO_CATEGORY = {
    Q82955: 'Leaders', Q484188: 'Leaders', Q30461: 'Leaders',
    Q1097498: 'Leaders', Q372436: 'Leaders', Q16947657: 'Leaders',
    Q3527302: 'Leaders', Q189348: 'Leaders', Q15711870: 'Leaders',
    Q901: 'Scientists', Q170790: 'Scientists', Q169470: 'Scientists',
    Q593644: 'Scientists', Q2110551: 'Scientists',
    Q483501: 'Artists', Q49757: 'Artists', Q482980: 'Artists',
    Q36180: 'Artists', Q1028181: 'Artists', Q177220: 'Artists',
    Q36834: 'Artists', Q486748: 'Artists',
    Q4964182: 'Philosophers', Q1234713: 'Philosophers',
    Q189290: 'Military', Q47064: 'Military', Q71032: 'Military',
    Q13582652: 'Explorers',
};

function inferCategory(occUri) {
    if (!occUri) return 'Global History';
    const id = occUri.split('/').pop();
    return OCC_TO_CATEGORY[id] || 'Global History';
}

function parseYear(raw) {
    if (!raw) return null;
    const m = raw.match(/-?\d+/);
    return m ? parseInt(m[0]) : null;
}

function insertPeople(rows, defaultCategory = null) {
    return new Promise((resolve) => {
        // Group rows by person id, picking the best category.
        const byId = new Map();
        for (const b of rows) {
            const id = b.item.value.split('/').pop();
            const cat = defaultCategory || inferCategory(b.occ?.value);
            if (!byId.has(id)) {
                byId.set(id, { b, cat });
            } else if (byId.get(id).cat === 'Global History' && cat !== 'Global History') {
                byId.get(id).cat = cat;
            }
        }

        db.serialize(() => {
            const stmt = db.prepare(`INSERT OR IGNORE INTO historical_entities
                (id, name, wpTitle, type, start_year, end_year,
                 latitude, longitude, importance_score, thumbnailUrl, category, summary)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
            let count = 0;
            for (const [, { b, cat }] of byId) {
                try {
                    const startYear = parseYear(b.start.value);
                    if (startYear === null || startYear < -1374) continue;

                    // No death date on Wikidata means unknown, not dead this year.
                    // Store NULL; migrate.js and the interface handle it.
                    const endYear = b.end ? parseYear(b.end.value) : null;
                    const lat = parseFloat(b.lat.value);
                    const lon = parseFloat(b.lon.value);
                    if (isNaN(lat) || isNaN(lon)) continue;

                    const id = b.item.value.split('/').pop();
                    const name = b.itemLabel.value;
                    const wpTitle = b.wpTitle ? b.wpTitle.value : name;
                    const sitelinks = parseInt(b.sitelinks?.value || 0);
                    const img = b.img ? b.img.value + '?width=400' : null;

                    stmt.run(id, name, wpTitle, 'person', startYear, endYear,
                        lat, lon, sitelinks, img, cat, null);
                    count++;
                } catch (_) {}
            }
            stmt.finalize(() => resolve(count));
        });
    });
}

// Coordinate fallback: birthplace -> place of death -> country of citizenship -> country of origin.
const COORD_PATTERN = `
  OPTIONAL { ?item wdt:P19 ?bp . ?bp wdt:P625 ?bcoords . }
  OPTIONAL { ?item wdt:P20 ?dp . ?dp wdt:P625 ?dcoords . }
  OPTIONAL { ?item wdt:P27 ?cit . ?cit wdt:P625 ?citcoords . }
  OPTIONAL { ?item wdt:P17 ?orig . ?orig wdt:P625 ?origcoords . }
  BIND(COALESCE(?bcoords, ?dcoords, ?citcoords, ?origcoords) AS ?coords)
  FILTER(BOUND(?coords))
  BIND(geof:latitude(?coords) AS ?lat)
  BIND(geof:longitude(?coords) AS ?lon)`;

// ─── 1. Vietnamese people ────────────────────────────────────────────────────

async function harvestVietnamese() {
    console.log('\n── Vietnamese figures (sitelinks >= 3) ──');
    const q = `
SELECT DISTINCT ?item ?itemLabel ?start ?end ?lat ?lon ?sitelinks ?wpTitle ?img ?occ WHERE {
  ?item wdt:P31 wd:Q5 ;
        wdt:P569 ?start ;
        wdt:P27 wd:Q881 ;
        wikibase:sitelinks ?sitelinks .
  FILTER(?sitelinks >= 3)
  ${COORD_PATTERN}
  OPTIONAL { ?item wdt:P570 ?end . }
  OPTIONAL { ?item wdt:P18 ?img . }
  OPTIONAL { ?item wdt:P106 ?occ . }
  OPTIONAL {
    ?wpArticle schema:about ?item ;
               schema:isPartOf <https://en.wikipedia.org/> ;
               schema:name ?wpTitle .
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
} LIMIT 500`;

    try {
        const rows = await sparql(q);
        const saved = await insertPeople(rows);
        console.log(`  Saved ${saved} Vietnamese figures`);
    } catch (e) {
        console.log(`  Failed: ${e.message.slice(0, 80)}`);
    }
    await sleep(10000);
}

// ─── 2. Women across history ─────────────────────────────────────────────────

// Run in time chunks to avoid timeouts.
const WOMEN_CHUNKS = [
    [-1374, 500],
    [500, 1500],
    [1500, 1800],
    [1800, 1920],
    [1920, 2024],
];

async function harvestWomen() {
    console.log('\n── Women in history (sitelinks >= 8) ──');
    let total = 0;

    for (const [minYear, maxYear] of WOMEN_CHUNKS) {
        const q = `
SELECT DISTINCT ?item ?itemLabel ?start ?end ?lat ?lon ?sitelinks ?wpTitle ?img ?occ WHERE {
  ?item wdt:P31 wd:Q5 ;
        wdt:P21 wd:Q6581072 ;
        wdt:P569 ?start ;
        wikibase:sitelinks ?sitelinks .
  FILTER(YEAR(?start) >= ${minYear} && YEAR(?start) < ${maxYear})
  FILTER(?sitelinks >= 8)
  ${COORD_PATTERN}
  OPTIONAL { ?item wdt:P570 ?end . }
  OPTIONAL { ?item wdt:P18 ?img . }
  OPTIONAL { ?item wdt:P106 ?occ . }
  OPTIONAL {
    ?wpArticle schema:about ?item ;
               schema:isPartOf <https://en.wikipedia.org/> ;
               schema:name ?wpTitle .
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
} LIMIT 500`;

        process.stdout.write(`  ${minYear} to ${maxYear} ... `);
        try {
            const rows = await sparql(q);
            const saved = await insertPeople(rows);
            console.log(`${saved} saved`);
            total += saved;
        } catch (e) {
            console.log(`failed (${e.message.slice(0, 60)})`);
        }
        await sleep(10000);
    }
    console.log(`  Women total: ${total}`);
}

// ─── 3. Revolutionaries and independence leaders ──────────────────────────────

// Q3527302  = revolutionary
// Q1397808  = independence activist
// Q15711870 = national hero (often freedom fighters)
// Q672614   = resistance fighter
// Q1208268  = guerrilla fighter
const REVOLUTIONARY_OCCS = [
    'wd:Q3527302',
    'wd:Q1397808',
    'wd:Q15711870',
    'wd:Q672614',
    'wd:Q1208268',
];

const REVOLUTIONARY_CHUNKS = [
    [-1374, 1700],
    [1700, 1850],
    [1850, 1950],
    [1950, 2024],
];

async function harvestRevolutionaries() {
    console.log('\n── Revolutionaries and independence leaders (sitelinks >= 8) ──');
    let total = 0;

    for (const [minYear, maxYear] of REVOLUTIONARY_CHUNKS) {
        const q = `
SELECT DISTINCT ?item ?itemLabel ?start ?end ?lat ?lon ?sitelinks ?wpTitle ?img ?occ WHERE {
  VALUES ?occ { ${REVOLUTIONARY_OCCS.join(' ')} }
  ?item wdt:P31 wd:Q5 ;
        wdt:P106 ?occ ;
        wdt:P569 ?start ;
        wikibase:sitelinks ?sitelinks .
  FILTER(YEAR(?start) >= ${minYear} && YEAR(?start) < ${maxYear})
  FILTER(?sitelinks >= 8)
  ${COORD_PATTERN}
  OPTIONAL { ?item wdt:P570 ?end . }
  OPTIONAL { ?item wdt:P18 ?img . }
  OPTIONAL {
    ?wpArticle schema:about ?item ;
               schema:isPartOf <https://en.wikipedia.org/> ;
               schema:name ?wpTitle .
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
} LIMIT 400`;

        process.stdout.write(`  ${minYear} to ${maxYear} ... `);
        try {
            const rows = await sparql(q, 90000);
            const saved = await insertPeople(rows, 'Leaders');
            console.log(`${saved} saved`);
            total += saved;
        } catch (e) {
            console.log(`failed (${e.message.slice(0, 60)})`);
        }
        await sleep(10000);
    }
    console.log(`  Revolutionaries total: ${total}`);
}

async function run() {
    console.log('Starting targeted harvest...');
    await harvestVietnamese();
    await harvestWomen();
    await harvestRevolutionaries();
    console.log('\nDone.');
    db.close();
}

run();
