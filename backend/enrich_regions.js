// Fetch each person's country and the country's centre point.
//
// Assigning a region by testing the birth place against latitude boxes breaks
// exactly where the boxes meet. Zhu Xi, born in Fujian, landed in "Southeast
// Asia" because the box drawn around Vietnam also covers southern China. Ibn
// Battuta, born in Tangier, landed in "Europe" because Tangier is north of
// Gibraltar.
//
// A country centre is far from those edges: Morocco's centre is unambiguously
// in Africa and China's is unambiguously in East Asia, so the same boxes give
// the right answer. The birth place stays the map position; only the region
// label comes from the country.

const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, 'coincidence.db'));
const UA = 'CoincidenceMap/1.0 (+https://github.com/tham-le/coincidence)';
const SPARQL_URL = 'https://query.wikidata.org/sparql';
const BATCH = 150;
const PAUSE_MS = 1100;

const run = (sql, p = []) => new Promise((res, rej) => db.run(sql, p, function (e) { e ? rej(e) : res(this); }));
const all = (sql, p = []) => new Promise((res, rej) => db.all(sql, p, (e, r) => e ? rej(e) : res(r)));
const get = (sql, p = []) => new Promise((res, rej) => db.get(sql, p, (e, r) => e ? rej(e) : res(r)));
const sleep = ms => new Promise(r => setTimeout(r, ms));

// P27 is country of citizenship, which is the right notion for a person.
// P17 is the country a place or event is in, which is the right one for an
// event. Ask for both and take whichever comes back.
async function fetchCountries(ids) {
  const values = ids.map(id => `wd:${id}`).join(' ');
  const query = `
SELECT ?item ?countryLabel ?lat ?lon WHERE {
  VALUES ?item { ${values} }
  { ?item wdt:P27 ?country . } UNION { ?item wdt:P17 ?country . }
  ?country wdt:P625 ?coord .
  BIND(geof:latitude(?coord) AS ?lat)
  BIND(geof:longitude(?coord) AS ?lon)
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;

  const res = await axios.get(SPARQL_URL, {
    params: { query, format: 'json' },
    headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json' },
    timeout: 90000,
  });

  const out = new Map();
  for (const b of res.data.results.bindings) {
    const id = b.item.value.split('/').pop();
    // Someone can hold several citizenships. The first is good enough for a
    // region label, so keep it and ignore the rest.
    if (out.has(id)) continue;
    out.set(id, {
      country: b.countryLabel?.value || null,
      lat: parseFloat(b.lat.value),
      lon: parseFloat(b.lon.value),
    });
  }
  return out;
}

async function ensureColumns() {
  const cols = await all('PRAGMA table_info(historical_entities)');
  const have = new Set(cols.map(c => c.name));
  for (const [name, type] of [['country', 'TEXT'], ['country_lat', 'REAL'], ['country_lon', 'REAL']]) {
    if (!have.has(name)) await run(`ALTER TABLE historical_entities ADD COLUMN ${name} ${type}`);
  }
}

async function main() {
  await ensureColumns();
  const rows = await all(`SELECT id FROM historical_entities
    WHERE country IS NULL AND id LIKE 'Q%'`);
  console.log(`${rows.length} rows without a country`);
  if (!rows.length) { db.close(); return; }

  const ids = rows.map(r => r.id);
  let found = 0;
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    let data;
    try {
      data = await fetchCountries(batch);
    } catch (e) {
      console.error(`\n  batch ${i} failed: ${e.message}`);
      await sleep(6000);
      continue;
    }
    await run('BEGIN');
    for (const [id, c] of data) {
      await run('UPDATE historical_entities SET country = ?, country_lat = ?, country_lon = ? WHERE id = ?',
        [c.country, c.lat, c.lon, id]);
      found++;
    }
    await run('COMMIT');
    process.stdout.write(`\r  ${Math.min(i + BATCH, ids.length)}/${ids.length}  (${found} placed)   `);
    await sleep(PAUSE_MS);
  }
  console.log();

  const stat = await get('SELECT COUNT(*) c FROM historical_entities WHERE country IS NOT NULL');
  console.log(`${stat.c} rows now have a country`);
  db.close();
}

main().catch(e => { console.error(e); process.exit(1); });
