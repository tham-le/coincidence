// Give events a category based on what Wikidata says they are, and fetch
// their real start and end dates.
//
// The harvesters set an event's category from the search term that found it,
// so "Revolutions" ended up holding the Albigensian Crusade, the Aleutian
// Islands Campaign and the invasion of Poland. Asking whether a wave of
// revolutions crosses the world is meaningless while the category means
// "turned up in the revolution query".
//
// Classification walks P31 up the subclass chain (P279*) to a small set of
// roots, so "war of independence" and "civil war" both resolve without having
// to list every subtype by hand.

const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, 'coincidence.db'));
const UA = 'CoincidenceMap/1.0 (+https://github.com/tham-le/coincidence)';
const SPARQL_URL = 'https://query.wikidata.org/sparql';
const BATCH = 80;
const PAUSE_MS = 1200;

const PREC = { 11: 'day', 10: 'month', 9: 'year' };

const run = (sql, p = []) => new Promise((res, rej) => db.run(sql, p, function (e) { e ? rej(e) : res(this); }));
const all = (sql, p = []) => new Promise((res, rej) => db.all(sql, p, (e, r) => e ? rej(e) : res(r)));
const get = (sql, p = []) => new Promise((res, rej) => db.get(sql, p, (e, r) => e ? rej(e) : res(r)));
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Roots are checked in this order and the first match wins. An uprising is
// also a kind of conflict, so the revolt roots have to be tested before the
// war roots or everything would come out as a war.
const ROOTS = [
  ['Revolutions', ['Q10931', 'Q124734', 'Q45382', 'Q8465', 'Q21994376', 'Q1124199']],
  ['Battles',     ['Q178561', 'Q188055']],
  ['Wars',        ['Q198', 'Q831663', 'Q645883']],
];

const ROOT_TO_CATEGORY = new Map();
for (const [cat, ids] of ROOTS) for (const id of ids) ROOT_TO_CATEGORY.set(id, cat);
const CATEGORY_ORDER = ROOTS.map(r => r[0]);

function parseTime(value, precision) {
  if (!value) return null;
  const m = value.match(/^(-?)(\d{4,})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const prec = PREC[parseInt(precision, 10)] || null;
  if (!prec) return null;
  return {
    year: (m[1] === '-' ? -1 : 1) * parseInt(m[2], 10),
    iso: `${m[1]}${m[2]}-${m[3]}-${m[4]}`,
    prec,
  };
}

async function fetchEventFacts(ids) {
  const values = ids.map(id => `wd:${id}`).join(' ');
  const roots = [...ROOT_TO_CATEGORY.keys()].map(id => `wd:${id}`).join(' ');
  const query = `
SELECT ?item ?root ?start ?sprec ?end ?eprec WHERE {
  VALUES ?item { ${values} }
  OPTIONAL {
    VALUES ?root { ${roots} }
    ?item wdt:P31/wdt:P279* ?root .
  }
  OPTIONAL { ?item p:P580/psv:P580 ?sn . ?sn wikibase:timeValue ?start ; wikibase:timePrecision ?sprec . }
  OPTIONAL { ?item p:P582/psv:P582 ?en . ?en wikibase:timeValue ?end ; wikibase:timePrecision ?eprec . }
}`;

  const res = await axios.get(SPARQL_URL, {
    params: { query, format: 'json' },
    headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json' },
    timeout: 120000,
  });

  const out = new Map();
  for (const b of res.data.results.bindings) {
    const id = b.item.value.split('/').pop();
    if (!out.has(id)) out.set(id, { roots: new Set(), start: null, end: null });
    const rec = out.get(id);
    if (b.root) rec.roots.add(b.root.value.split('/').pop());
    if (!rec.start) rec.start = parseTime(b.start?.value, b.sprec?.value);
    if (!rec.end) rec.end = parseTime(b.end?.value, b.eprec?.value);
  }
  return out;
}

function categoryFor(rootIds) {
  const found = new Set();
  for (const r of rootIds) {
    const cat = ROOT_TO_CATEGORY.get(r);
    if (cat) found.add(cat);
  }
  for (const cat of CATEGORY_ORDER) if (found.has(cat)) return cat;
  return null;
}

async function ensureColumn() {
  const cols = await all('PRAGMA table_info(historical_entities)');
  if (!cols.some(c => c.name === 'event_classified')) {
    await run('ALTER TABLE historical_entities ADD COLUMN event_classified INTEGER DEFAULT 0');
  }
}

async function main() {
  await ensureColumn();
  const rows = await all(`SELECT id, name, category FROM historical_entities
    WHERE type = 'event' AND event_classified = 0 AND id LIKE 'Q%'`);
  console.log(`${rows.length} events to classify`);
  if (!rows.length) { db.close(); return; }

  const ids = rows.map(r => r.id);
  const before = new Map(rows.map(r => [r.id, r.category]));
  let classified = 0, dated = 0, moved = 0;

  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    let data;
    try {
      data = await fetchEventFacts(batch);
    } catch (e) {
      console.error(`\n  batch ${i} failed: ${e.message}`);
      await sleep(8000);
      continue;
    }

    await run('BEGIN');
    for (const id of batch) {
      const d = data.get(id);
      if (!d) { await run('UPDATE historical_entities SET event_classified = 1 WHERE id = ?', [id]); continue; }

      const fields = ['event_classified = 1'];
      const params = [];
      const cat = categoryFor(d.roots);
      if (cat) {
        fields.push('category = ?');
        params.push(cat);
        classified++;
        if (before.get(id) !== cat) moved++;
      }
      if (d.start) {
        fields.push('start_year = ?', 'start_date = ?');
        params.push(d.start.year, d.start.prec === 'year' ? null : d.start.iso);
        dated++;
      }
      if (d.end) {
        fields.push('end_year = ?', 'end_date = ?');
        params.push(d.end.year, d.end.prec === 'year' ? null : d.end.iso);
      }
      params.push(id);
      await run(`UPDATE historical_entities SET ${fields.join(', ')} WHERE id = ?`, params);
    }
    await run('COMMIT');
    process.stdout.write(`\r  ${Math.min(i + BATCH, ids.length)}/${ids.length}  (${classified} classified, ${moved} recategorized, ${dated} dated)   `);
    await sleep(PAUSE_MS);
  }
  console.log();

  const cats = await all(`SELECT category, COUNT(*) c FROM historical_entities
    WHERE type = 'event' GROUP BY category ORDER BY c DESC`);
  for (const c of cats) console.log(`  ${c.category ?? '(none)'}: ${c.c}`);
  db.close();
}

main().catch(e => { console.error(e); process.exit(1); });
