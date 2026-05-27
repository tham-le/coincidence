const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, 'coincidence.db'));
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
                    
                    let endYear = startYear + 40; // Default lifespan for ancient figures
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
                        null // summary
                    );
                    count++;
                } catch (err) {}
            });
            stmt.finalize(() => resolve(count));
        });
    });
}

async function harvestBronzeAge() {
    console.log("🏺 Harvesting Bronze Age Data (Founders & Pharaohs)...");
    
    // Direct Q-IDs for high-impact ancient figures to avoid complex date filters
    const ids = [
        'wd:Q9235',  // Ramses II
        'wd:Q1413',  // Hammurabi
        'wd:Q157905', // Akhenaten
        'wd:Q333341', // Thutmose III
        'wd:Q8134',   // Amenhotep III
        'wd:Q37643',  // Khufu
        'wd:Q39239',  // Senusret I
        'wd:Q181559', // Sargon of Akkad
        'wd:Q168261', // Narmer
        'wd:Q83391',  // Djoser
        'wd:Q9316',   // Seti I
        'wd:Q15804',  // Hatshepsut
        'wd:Q12154',  // Tutankhamun
        'wd:Q40847',  // Nebuchadnezzar II
        'wd:Q8509'    // Cyrus the Great
    ];

    const ancientQuery = `
    SELECT ?item ?itemLabel ?lat ?lon ?start ?end ?sitelinks ?wpTitle ?img WHERE {
      VALUES ?item { ${ids.join(' ')} }
      ?item wdt:P569 ?start .
      ?item wdt:P19/wdt:P625 ?coords .
      OPTIONAL { ?item wdt:P18 ?img . }
      OPTIONAL { ?item wdt:P570 ?end . }
      ?wpArticle schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?wpTitle .
      ?item wikibase:sitelinks ?sitelinks .
      BIND(geof:latitude(?coords) AS ?lat)
      BIND(geof:longitude(?coords) AS ?lon)
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    } LIMIT 100`;

    try {
        const rows = await sparql(ancientQuery);
        const count = await insertRows(rows, 'person', 'Leaders');
        console.log(`✅ Saved ${count} ancient figures.`);
    } catch (e) {
        console.error('❌ Failed to harvest ancient figures:', e.message);
    }

    db.close();
}

harvestBronzeAge();
