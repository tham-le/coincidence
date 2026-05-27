const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, 'coincidence.db'));
const SPARQL_URL = 'https://query.wikidata.org/sparql';
const HEADERS = { 'User-Agent': 'CoincidenceGlobalHarvester/2.0 (contact: user@example.com)' };

const OCC_TO_CATEGORY = {
    Q82955:    'Leaders',      // politician
    Q15712165: 'Leaders',      // political figure
    Q484188:   'Leaders',      // monarch
    Q30461:    'Leaders',      // president
    Q1097498:  'Leaders',      // head of state
    Q372436:   'Leaders',      // statesperson
    Q16947657: 'Leaders',      // prime minister
    Q3527302:  'Leaders',      // revolutionary
    Q189348:   'Leaders',      // diplomat

    Q901:      'Scientists',   // scientist
    Q170790:   'Scientists',   // mathematician
    Q11063:    'Scientists',   // astronomer
    Q169470:   'Scientists',   // physicist
    Q593644:   'Scientists',   // chemist
    Q3621491:  'Scientists',   // biologist
    Q864503:   'Scientists',   // botanist
    Q2110551:  'Scientists',   // inventor
    Q205375:   'Scientists',   // engineer
    Q2500638:  'Scientists',   // natural philosopher
    Q1650915:  'Scientists',   // researcher

    Q483501:   'Artists',      // musician
    Q49757:    'Artists',      // poet
    Q482980:   'Artists',      // author
    Q36180:    'Artists',      // writer
    Q1028181:  'Artists',      // painter
    Q6625963:  'Artists',      // novelist
    Q33999:    'Artists',      // actor
    Q177220:   'Artists',      // singer
    Q36834:    'Artists',      // composer
    Q1281618:  'Artists',      // sculptor
    Q486748:   'Artists',      // architect
    Q33231:    'Artists',      // photographer

    Q4964182:  'Philosophers', // philosopher
    Q1234713:  'Philosophers', // theologian
    Q2259532:  'Philosophers', // ethicist
    Q15995642: 'Philosophers', // logician

    Q189290:   'Military',     // military officer
    Q47064:    'Military',     // military personnel
    Q71032:    'Military',     // general
    Q10418691: 'Military',     // admiral
    Q15978655: 'Military',     // military commander

    Q13582652: 'Explorers',    // explorer
    Q4773904:  'Explorers',    // adventurer
    Q1371378:  'Explorers',    // traveler
};

function inferCategory(occUri) {
    if (!occUri) return 'Global History';
    const id = occUri.split('/').pop();
    return OCC_TO_CATEGORY[id] || 'Global History';
}

// Rows may have multiple entries per person (one per occupation).
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
                    const startRaw = b.start.value;
                    const isBCE = startRaw.startsWith('-');
                    const yearPart = startRaw.match(/\d+/)[0];
                    const startYear = isBCE ? -parseInt(yearPart) : parseInt(yearPart);

                    if (startYear < -1374) continue;

                    const id = b.item.value.split('/').pop();
                    const name = b.itemLabel.value;
                    const wpTitle = b.wpTitle ? b.wpTitle.value : name;

                    let endYear = startYear + 60;
                    if (b.end) {
                        const endRaw = b.end.value;
                        const isEndBCE = endRaw.startsWith('-');
                        const endYearPart = endRaw.match(/\d+/)[0];
                        endYear = isEndBCE ? -parseInt(endYearPart) : parseInt(endYearPart);
                    }

                    stmt.run(
                        id, name, wpTitle, 'person', startYear, endYear,
                        parseFloat(b.lat.value), parseFloat(b.lon.value),
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

async function sparql(query) {
    const url = SPARQL_URL + '?format=json&query=' + encodeURIComponent(query);
    const res = await axios.get(url, { headers: HEADERS, timeout: 120000 });
    return res.data.results.bindings;
}

const REGIONS = [
    { name: 'Vietnam',        id: 'wd:Q881'   },
    { name: 'Japan',          id: 'wd:Q17'    },
    { name: 'Korea',          id: 'wd:Q18097' },
    { name: 'China',          id: 'wd:Q29520' },
    { name: 'India',          id: 'wd:Q668'   },
    { name: 'Persia/Iran',    id: 'wd:Q794'   },
    { name: 'Ottoman/Turkey', id: 'wd:Q43'    },
    { name: 'Egypt',          id: 'wd:Q79'    },
    { name: 'Ethiopia',       id: 'wd:Q115'   },
    { name: 'Nigeria',        id: 'wd:Q1033'  },
    { name: 'Mali',           id: 'wd:Q912'   },
    { name: 'Mexico',         id: 'wd:Q96'    },
    { name: 'Peru',           id: 'wd:Q419'   },
    { name: 'Brazil',         id: 'wd:Q155'   },
    { name: 'Thailand',       id: 'wd:Q869'   },
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run() {
    console.log('Starting Regional Harvest...');
    let total = 0;

    for (const region of REGIONS) {
        process.stdout.write(`  ${region.name} ... `);

        const q = `
        SELECT ?item ?itemLabel ?lat ?lon ?start ?end ?sitelinks ?wpTitle ?img ?occ WHERE {
          ?item wdt:P31 wd:Q5 .
          ?item wdt:P569 ?start .
          ?item wdt:P27 ${region.id} .
          ?item wdt:P19/wdt:P625 ?coords .
          ?wpArticle schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?wpTitle .
          ?item wikibase:sitelinks ?sitelinks .
          BIND(geof:latitude(?coords) AS ?lat)
          BIND(geof:longitude(?coords) AS ?lon)
          FILTER(?sitelinks > 15)
          OPTIONAL { ?item wdt:P18 ?img . }
          OPTIONAL { ?item wdt:P570 ?end . }
          OPTIONAL { ?item wdt:P106 ?occ . }
          SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
        } LIMIT 300`;

        try {
            const rows = await sparql(q);
            const saved = await insertRows(rows);
            console.log(`${saved} saved`);
            total += saved;
        } catch (e) {
            console.log(`failed (${e.message.slice(0, 60)})`);
        }

        await sleep(8000);
    }

    console.log(`\nFinished. Total saved in this run: ${total}`);
    db.close();
}

run();
