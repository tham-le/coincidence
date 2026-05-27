const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database('./coincidence.db');
const SPARQL_URL = 'https://query.wikidata.org/sparql';
const HEADERS = { 'User-Agent': 'GlobalSynchronicityApp/1.0 (contact: user@example.com)' };

async function sparql(query) {
    const url = SPARQL_URL + '?format=json&query=' + encodeURIComponent(query);
    const res = await axios.get(url, { headers: HEADERS, timeout: 90000 });
    return res.data.results.bindings;
}

function insertRows(rows, type, category) {
    return new Promise((resolve) => {
        db.serialize(() => {
            const stmt = db.prepare("INSERT OR REPLACE INTO historical_entities VALUES (?,?,?,?,?,?,?,?,?,?,?,?)");
            let count = 0;
            rows.forEach(b => {
                try {
                    const startMatch = b.start.value.match(/-?\d+/);
                    if (!startMatch) return;
                    
                    const id = b.item.value.split('/').pop();
                    const name = b.itemLabel.value;
                    const wpTitle = b.wpTitle ? b.wpTitle.value : name;
                    const startYear = parseInt(startMatch[0]);
                    
                    let endYear = 2024;
                    if (b.end) {
                        const endMatch = b.end.value.match(/-?\d+/);
                        if (endMatch) endYear = parseInt(endMatch[0]);
                    }

                    stmt.run(
                        id,
                        name,
                        wpTitle,
                        type,
                        startYear,
                        endYear,
                        parseFloat(b.lat.value),
                        parseFloat(b.lon.value),
                        parseInt(b.sitelinks ? b.sitelinks.value : 0),
                        b.img ? b.img.value + '?width=400' : null,
                        category || type,
                        null
                    );
                    count++;
                } catch (err) {}
            });
            stmt.finalize(() => resolve(count));
        });
    });
}

async function productionHarvest() {
    await new Promise((resolve) => {
        db.serialize(() => {
            // Keep table but ensure category column exists (handled by previous shell command)
            db.run(`CREATE TABLE IF NOT EXISTS historical_entities (
                id TEXT PRIMARY KEY,
                name TEXT,
                wpTitle TEXT,
                type TEXT,
                start_year INTEGER,
                end_year INTEGER,
                latitude REAL,
                longitude REAL,
                importance_score INTEGER,
                thumbnailUrl TEXT,
                category TEXT
            )`, () => resolve());
        });
    });

    const categories = [
        { name: 'Leaders',      id: 'wd:Q15712165', type: 'person' },
        { name: 'Scientists',   id: 'wd:Q901',       type: 'person' },
        { name: 'Artists',      id: 'wd:Q483504',    type: 'person' },
        { name: 'Philosophers', id: 'wd:Q4964182',   type: 'person' },
        { name: 'Military',     id: 'wd:Q189290',    type: 'person' },
        { name: 'Explorers',    id: 'wd:Q13582652',  type: 'person' },
    ];

    let totalSaved = 0;
    
    for (const cat of categories) {
        process.stdout.write(`  Fetching ${cat.name} ... `);
        const q = `
        SELECT ?item ?itemLabel ?lat ?lon ?start ?end ?sitelinks ?wpTitle ?img WHERE {
          ?item wdt:P31 wd:Q5 .
          ?item wdt:P106/wdt:P279* ${cat.id} .
          ?item wdt:P19/wdt:P625 ?coords .
          ?item wdt:P18 ?img .
          ?item wdt:P569 ?start .
          ?wpArticle schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?wpTitle .
          ?item wikibase:sitelinks ?sitelinks .
          FILTER(?sitelinks > 70)
          BIND(geof:latitude(?coords) AS ?lat)
          BIND(geof:longitude(?coords) AS ?lon)
          OPTIONAL { ?item wdt:P570 ?end . }
          SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
        } LIMIT 250`;

        try {
            const rows = await sparql(q);
            const count = await insertRows(rows, cat.type, cat.name);
            console.log(`${count} saved`);
            totalSaved += count;
            await new Promise(r => setTimeout(r, 1000));
        } catch (e) { console.log('failed'); }
    }

    process.stdout.write(`  Fetching High Impact Events ... `);
    const eventsQuery = `
    SELECT ?item ?itemLabel ?lat ?lon ?start ?end ?sitelinks ?wpTitle ?img WHERE {
      VALUES ?type { wd:Q198 wd:Q178561 wd:Q1656682 wd:Q49118 wd:Q209628 wd:Q215101 wd:Q13220391 wd:Q306501 }
      ?item wdt:P31 ?type .
      ?item wdt:P580 ?start .
      ?item wdt:P625 ?coords .
      ?item wdt:P18 ?img .
      ?wpArticle schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?wpTitle .
      ?item wikibase:sitelinks ?sitelinks .
      BIND(geof:latitude(?coords) AS ?lat)
      BIND(geof:longitude(?coords) AS ?lon)
      OPTIONAL { ?item wdt:P582 ?end . }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    } LIMIT 500`;

    try {
        const eventRows = await sparql(eventsQuery);
        const count = await insertRows(eventRows, 'event', 'Events');
        console.log(`${count} saved`);
        totalSaved += count;
    } catch (e) { console.log('failed'); }

    const row = await new Promise((res, rej) =>
        db.get("SELECT COUNT(*) as n FROM historical_entities", (e, r) => e ? rej(e) : res(r))
    );
    console.log(`\nDone. Total in DB: ${row.n}`);
    db.close();
}

productionHarvest();
