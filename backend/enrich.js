// Refetch the facts we care about from Wikidata for every row we already have.
//
// This is the step that replaces guessed data with real data: exact birth and
// death dates (with their precision), the death year that five harvesters used
// to invent, the occupations that decide a category, the alias list that makes
// "Quang Trung" findable, and a fresh sitelink count.
//
// Resumable. Rows already done are skipped, so it is safe to stop and rerun.

const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const { categoryFromOccupations } = require('./occupations');

const path = require('path');
// Resolve next to this file, not the shell's working directory, so running
// the script from the project root cannot create an empty database there.
const db = new sqlite3.Database(path.join(__dirname, 'coincidence.db'));
const UA = 'CoincidenceMap/1.0 (+https://github.com/tham-le/coincidence)';
const SPARQL_URL = 'https://query.wikidata.org/sparql';
const WD_API = 'https://www.wikidata.org/w/api.php';

const SPARQL_BATCH = 120;
const ALIAS_BATCH = 50;
const PAUSE_MS = 1200;

// Wikidata time precision codes we accept. Anything vaguer than a year is
// not useful for a lifespan bar.
const PREC = { 11: 'day', 10: 'month', 9: 'year' };

// Someone with no recorded death who was born recently enough is alive, not
// missing data. Before this cutoff, a missing death date means unknown.
const ALIVE_BIRTH_CUTOFF = 1935;

const run = (sql, p = []) => new Promise((res, rej) => db.run(sql, p, function (e) { e ? rej(e) : res(this); }));
const all = (sql, p = []) => new Promise((res, rej) => db.all(sql, p, (e, r) => e ? rej(e) : res(r)));
const get = (sql, p = []) => new Promise((res, rej) => db.get(sql, p, (e, r) => e ? rej(e) : res(r)));
const sleep = ms => new Promise(r => setTimeout(r, ms));

// "-0384-01-01T00:00:00Z" -> { year: -384, iso: "-0384-01-01", prec: "day" }
function parseTime(value, precision) {
  if (!value) return null;
  const m = value.match(/^(-?)(\d{4,})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const sign = m[1] === '-' ? -1 : 1;
  const year = sign * parseInt(m[2], 10);
  const prec = PREC[parseInt(precision, 10)] || null;
  if (!prec) return null;
  return { year, iso: `${m[1]}${m[2]}-${m[3]}-${m[4]}`, prec };
}

async function sparqlDates(ids) {
  const values = ids.map(id => `wd:${id}`).join(' ');
  const query = `
SELECT ?item ?birth ?bprec ?death ?dprec ?sitelinks
       (GROUP_CONCAT(DISTINCT STRAFTER(STR(?occ),"entity/"); separator=",") AS ?occs) WHERE {
  VALUES ?item { ${values} }
  OPTIONAL { ?item p:P569/psv:P569 ?bn . ?bn wikibase:timeValue ?birth ; wikibase:timePrecision ?bprec . }
  OPTIONAL { ?item p:P570/psv:P570 ?dn . ?dn wikibase:timeValue ?death ; wikibase:timePrecision ?dprec . }
  OPTIONAL { ?item wikibase:sitelinks ?sitelinks . }
  OPTIONAL { ?item wdt:P106 ?occ . }
} GROUP BY ?item ?birth ?bprec ?death ?dprec ?sitelinks`;

  const res = await axios.get(SPARQL_URL, {
    params: { query, format: 'json' },
    headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json' },
    timeout: 90000,
  });

  const out = new Map();
  for (const b of res.data.results.bindings) {
    const id = b.item.value.split('/').pop();
    // An item can come back on several rows when it has more than one birth
    // or death statement. Keep the first, which is the preferred one.
    if (out.has(id)) continue;
    out.set(id, {
      birth: parseTime(b.birth?.value, b.bprec?.value),
      death: parseTime(b.death?.value, b.dprec?.value),
      sitelinks: b.sitelinks ? parseInt(b.sitelinks.value, 10) : null,
      occs: b.occs?.value ? b.occs.value.split(',').filter(Boolean) : [],
    });
  }
  return out;
}

// Aliases come from the entity API, which is cheap when you ask only for
// labels and aliases. Vietnamese is included on purpose: this site exists
// because of a Vietnamese example, and reign names live in the vi aliases.
async function fetchAliases(ids) {
  const res = await axios.get(WD_API, {
    params: {
      action: 'wbgetentities',
      ids: ids.join('|'),
      props: 'labels|aliases',
      languages: 'en|vi|fr|zh',
      format: 'json',
    },
    headers: { 'User-Agent': UA },
    timeout: 60000,
  });

  const out = new Map();
  for (const [id, ent] of Object.entries(res.data.entities || {})) {
    if (ent.missing !== undefined) continue;
    const names = [];
    for (const l of Object.values(ent.labels || {})) names.push({ alias: l.value, lang: l.language });
    for (const [lang, list] of Object.entries(ent.aliases || {})) {
      for (const a of list) names.push({ alias: a.value, lang });
    }
    out.set(id, names);
  }
  return out;
}

async function ensureEnrichedColumn() {
  const cols = await all('PRAGMA table_info(historical_entities)');
  const have = new Set(cols.map(c => c.name));
  if (!have.has('enriched')) {
    await run('ALTER TABLE historical_entities ADD COLUMN enriched INTEGER DEFAULT 0');
  }
  if (!have.has('occupations')) {
    await run('ALTER TABLE historical_entities ADD COLUMN occupations TEXT');
  }
}

async function applyFacts(id, row, data) {
  const fields = [];
  const params = [];
  const push = (col, val) => { fields.push(`${col} = ?`); params.push(val); };

  if (data.birth) {
    push('start_year', data.birth.year);
    push('start_date', data.birth.prec === 'year' ? null : data.birth.iso);
    push('date_prec', data.birth.prec);
  }

  if (data.death) {
    push('end_year', data.death.year);
    push('end_date', data.death.prec === 'year' ? null : data.death.iso);
    push('alive', 0);
  } else if (row.type === 'person') {
    // No death statement on Wikidata. Either they are alive or nobody knows.
    const birthYear = data.birth ? data.birth.year : row.start_year;
    push('end_year', null);
    push('end_date', null);
    push('alive', birthYear >= ALIVE_BIRTH_CUTOFF ? 1 : 0);
  }

  if (data.sitelinks !== null) push('importance_score', data.sitelinks);

  // Keep the raw occupation ids so categories can be recomputed later without
  // asking Wikidata again. See recategorize.js.
  push('occupations', data.occs.join(','));

  // A category set by hand on a curated row wins over the occupation guess.
  if (row.curated === 0) {
    const cat = categoryFromOccupations(data.occs);
    // When no occupation maps to a category, clear whatever is there rather
    // than keeping it. The old value came from whichever harvester query found
    // the row, which is how Osama bin Laden ended up filed as an Explorer.
    push('category', cat);
  }

  push('enriched', 1);

  params.push(id);
  await run(`UPDATE historical_entities SET ${fields.join(', ')} WHERE id = ?`, params);
}

async function main() {
  await ensureEnrichedColumn();

  const rows = await all(`SELECT id, type, start_year, category, curated
    FROM historical_entities WHERE enriched = 0 AND id LIKE 'Q%'`);
  console.log(`${rows.length} rows to enrich`);
  if (!rows.length) { db.close(); return; }

  const byId = new Map(rows.map(r => [r.id, r]));
  const ids = rows.map(r => r.id);
  let done = 0, dated = 0, deaths = 0, cats = 0, aliasCount = 0;

  for (let i = 0; i < ids.length; i += SPARQL_BATCH) {
    const batch = ids.slice(i, i + SPARQL_BATCH);
    let data;
    try {
      data = await sparqlDates(batch);
    } catch (e) {
      console.error(`\n  sparql batch ${i} failed: ${e.message}, retrying once`);
      await sleep(8000);
      try { data = await sparqlDates(batch); }
      catch (e2) { console.error(`  skipped batch ${i}: ${e2.message}`); continue; }
    }

    await run('BEGIN');
    for (const id of batch) {
      const d = data.get(id);
      // Nothing came back: the item was deleted or merged. Mark it done so a
      // rerun does not keep asking.
      if (!d) { await run('UPDATE historical_entities SET enriched = 1 WHERE id = ?', [id]); continue; }
      await applyFacts(id, byId.get(id), d);
      if (d.birth) dated++;
      if (d.death) deaths++;
      if (categoryFromOccupations(d.occs)) cats++;
    }
    await run('COMMIT');

    done += batch.length;
    process.stdout.write(`\r  dates ${done}/${ids.length}  (${dated} birth, ${deaths} death, ${cats} category)   `);
    await sleep(PAUSE_MS);
  }
  console.log();

  for (let i = 0; i < ids.length; i += ALIAS_BATCH) {
    const batch = ids.slice(i, i + ALIAS_BATCH);
    let aliases;
    try {
      aliases = await fetchAliases(batch);
    } catch (e) {
      console.error(`\n  alias batch ${i} failed: ${e.message}`);
      await sleep(5000);
      continue;
    }
    await run('BEGIN');
    for (const [id, names] of aliases) {
      for (const n of names) {
        if (!n.alias || n.alias.length > 120) continue;
        const r = await run('INSERT OR IGNORE INTO entity_aliases (entity_id, alias, lang) VALUES (?,?,?)',
          [id, n.alias, n.lang]);
        aliasCount += r.changes;
      }
    }
    await run('COMMIT');
    process.stdout.write(`\r  aliases ${Math.min(i + ALIAS_BATCH, ids.length)}/${ids.length}  (+${aliasCount})   `);
    await sleep(PAUSE_MS);
  }
  console.log();

  const stats = await get(`SELECT
    COUNT(*) total,
    SUM(CASE WHEN start_date IS NOT NULL THEN 1 ELSE 0 END) with_day,
    SUM(CASE WHEN alive = 1 THEN 1 ELSE 0 END) living,
    SUM(CASE WHEN category IS NULL THEN 1 ELSE 0 END) no_cat
    FROM historical_entities`);
  console.log(`\n${stats.total} rows, ${stats.with_day} with a real date, ${stats.living} living, ${stats.no_cat} still uncategorized`);
  db.close();
}

main().catch(e => { console.error(e); process.exit(1); });
