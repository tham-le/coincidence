// Insert the hand-picked figures from curated_list.js and mark them curated,
// so ranking can never drop them.
//
// Titles are resolved through Wikipedia, which follows redirects and reports
// what it could not find. A name that fails to resolve is printed at the end
// rather than skipped in silence.

const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const CURATED = require('./curated_list');
const { categoryFromOccupations } = require('./occupations');
const MANUAL = require('./manual_figures');

const path = require('path');
// Resolve next to this file, not the shell's working directory, so running
// the script from the project root cannot create an empty database there.
const db = new sqlite3.Database(path.join(__dirname, 'coincidence.db'));
const UA = 'CoincidenceMap/1.0 (https://github.com/tham/coincidence; tham@kyber.tech)';
const WP_API = 'https://en.wikipedia.org/w/api.php';
const WP_REST = 'https://en.wikipedia.org/api/rest_v1/page/summary/';
const SPARQL_URL = 'https://query.wikidata.org/sparql';

const TITLE_BATCH = 40;
const SPARQL_BATCH = 100;
const PAUSE_MS = 900;

const PREC = { 11: 'day', 10: 'month', 9: 'year' };
const ALIVE_BIRTH_CUTOFF = 1935;

const run = (sql, p = []) => new Promise((res, rej) => db.run(sql, p, function (e) { e ? rej(e) : res(this); }));
const get = (sql, p = []) => new Promise((res, rej) => db.get(sql, p, (e, r) => e ? rej(e) : res(r)));
const sleep = ms => new Promise(r => setTimeout(r, ms));

function parseTime(value, precision) {
  if (!value) return null;
  const m = value.match(/^(-?)(\d{4,})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const sign = m[1] === '-' ? -1 : 1;
  const prec = PREC[parseInt(precision, 10)] || null;
  if (!prec) return null;
  return { year: sign * parseInt(m[2], 10), iso: `${m[1]}${m[2]}-${m[3]}-${m[4]}`, prec };
}

// Wikipedia resolves redirects for us, so "Ho Chi Minh" and a reign name both
// land on the same Wikidata id.
async function resolveTitles(titles) {
  const res = await axios.get(WP_API, {
    params: {
      action: 'query', titles: titles.join('|'), prop: 'pageprops',
      ppprop: 'wikibase_item', redirects: 1, format: 'json',
    },
    headers: { 'User-Agent': UA }, timeout: 60000,
  });

  const data = res.data.query || {};
  // Redirects and normalizations remap the title we asked for to the one
  // Wikipedia actually used, so track both directions.
  const asked = new Map();
  for (const n of data.normalized || []) asked.set(n.to, n.from);
  for (const r of data.redirects || []) asked.set(r.to, asked.get(r.from) || r.from);

  const out = [];
  for (const page of Object.values(data.pages || {})) {
    const original = asked.get(page.title) || page.title;
    const qid = page.pageprops?.wikibase_item;
    out.push({ title: original, resolved: page.title, qid: qid || null, missing: page.missing !== undefined });
  }
  return out;
}

async function fetchFacts(ids) {
  const values = ids.map(id => `wd:${id}`).join(' ');
  const query = `
SELECT ?item ?itemLabel ?birth ?bprec ?death ?dprec ?sitelinks ?lat ?lon
       (GROUP_CONCAT(DISTINCT STRAFTER(STR(?occ),"entity/"); separator=",") AS ?occs) WHERE {
  VALUES ?item { ${values} }
  OPTIONAL { ?item p:P569/psv:P569 ?bn . ?bn wikibase:timeValue ?birth ; wikibase:timePrecision ?bprec . }
  OPTIONAL { ?item p:P570/psv:P570 ?dn . ?dn wikibase:timeValue ?death ; wikibase:timePrecision ?dprec . }
  OPTIONAL { ?item wikibase:sitelinks ?sitelinks . }
  OPTIONAL { ?item wdt:P106 ?occ . }
  OPTIONAL {
    ?item wdt:P19 ?birthPlace .
    ?birthPlace wdt:P625 ?coord .
    BIND(geof:latitude(?coord) AS ?lat)
    BIND(geof:longitude(?coord) AS ?lon)
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
} GROUP BY ?item ?itemLabel ?birth ?bprec ?death ?dprec ?sitelinks ?lat ?lon`;

  const res = await axios.get(SPARQL_URL, {
    params: { query, format: 'json' },
    headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json' },
    timeout: 90000,
  });

  const out = new Map();
  for (const b of res.data.results.bindings) {
    const id = b.item.value.split('/').pop();
    const rec = {
      label: b.itemLabel?.value || id,
      birth: parseTime(b.birth?.value, b.bprec?.value),
      death: parseTime(b.death?.value, b.dprec?.value),
      sitelinks: b.sitelinks ? parseInt(b.sitelinks.value, 10) : 0,
      lat: b.lat ? parseFloat(b.lat.value) : null,
      lon: b.lon ? parseFloat(b.lon.value) : null,
      occs: b.occs?.value ? b.occs.value.split(',').filter(Boolean) : [],
    };
    // Prefer the row that carries coordinates when an item appears twice.
    const prev = out.get(id);
    if (!prev || (prev.lat === null && rec.lat !== null)) out.set(id, rec);
  }
  return out;
}

// Wikidata records a birth place with coordinates for most Europeans and for
// far fewer people elsewhere, so the first pass drops exactly the figures this
// site exists to show. These fallbacks walk outward from the birth place to
// the place of death, the place they worked, and finally the country, which is
// enough to put a dot on a map at the right end of the world.
async function fetchFallbacks(ids) {
  const values = ids.map(id => `wd:${id}`).join(' ');
  const query = `
SELECT ?item ?deathLat ?deathLon ?workLat ?workLon ?countryLat ?countryLon ?floruit ?fprec WHERE {
  VALUES ?item { ${values} }
  OPTIONAL {
    ?item wdt:P20 ?dp . ?dp wdt:P625 ?dc .
    BIND(geof:latitude(?dc) AS ?deathLat) BIND(geof:longitude(?dc) AS ?deathLon)
  }
  OPTIONAL {
    ?item wdt:P937 ?wp . ?wp wdt:P625 ?wc .
    BIND(geof:latitude(?wc) AS ?workLat) BIND(geof:longitude(?wc) AS ?workLon)
  }
  OPTIONAL {
    ?item wdt:P27 ?country . ?country wdt:P625 ?cc .
    BIND(geof:latitude(?cc) AS ?countryLat) BIND(geof:longitude(?cc) AS ?countryLon)
  }
  OPTIONAL { ?item p:P1317/psv:P1317 ?fn . ?fn wikibase:timeValue ?floruit ; wikibase:timePrecision ?fprec . }
}`;

  const res = await axios.get(SPARQL_URL, {
    params: { query, format: 'json' },
    headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json' },
    timeout: 90000,
  });

  const out = new Map();
  for (const b of res.data.results.bindings) {
    const id = b.item.value.split('/').pop();
    const num = k => (b[k] ? parseFloat(b[k].value) : null);
    const rec = {
      death: [num('deathLat'), num('deathLon')],
      work: [num('workLat'), num('workLon')],
      country: [num('countryLat'), num('countryLon')],
      floruit: parseTime(b.floruit?.value, b.fprec?.value),
    };
    const prev = out.get(id);
    // Keep the row that filled the most, since each OPTIONAL can come back
    // on its own line.
    const filled = r => [r.death[0], r.work[0], r.country[0], r.floruit].filter(v => v !== null && v !== undefined).length;
    if (!prev || filled(rec) > filled(prev)) out.set(id, rec);
  }
  return out;
}

// Applies the fallbacks in order and reports which one was used, so the run
// log shows how a figure got onto the map.
function applyFallback(facts, fb) {
  let via = null;
  if ((facts.lat === null || facts.lon === null) && fb) {
    for (const [key, label] of [['death', 'place of death'], ['work', 'place of work'], ['country', 'country']]) {
      const [lat, lon] = fb[key];
      if (lat !== null && lon !== null && !Number.isNaN(lat)) {
        facts.lat = lat;
        facts.lon = lon;
        via = label;
        break;
      }
    }
  }
  if (!facts.birth && fb?.floruit) {
    // A floruit is when someone was active, not when they were born. Back off
    // by a working lifetime so the lifespan bar is not obviously wrong, and
    // keep the precision at year so no card ever claims a day.
    facts.birth = { year: fb.floruit.year - 30, iso: null, prec: 'year' };
    via = via ? `${via} + floruit` : 'floruit';
  }
  return via;
}

// The summary column holds the whole Wikipedia REST response as a JSON string,
// which is what /api/entity hands back to the client untouched. Store the same
// shape here or that endpoint will try to parse plain text as JSON.
async function fetchSummary(title) {
  try {
    const res = await axios.get(WP_REST + encodeURIComponent(title.replace(/ /g, '_')), {
      headers: { 'User-Agent': UA }, timeout: 20000,
    });
    if (res.data?.type === 'disambiguation') return { summary: null, thumbnail: null };
    return {
      summary: JSON.stringify(res.data),
      thumbnail: res.data.thumbnail?.source || null,
    };
  } catch {
    return { summary: null, thumbnail: null };
  }
}

async function upsert(qid, title, facts, extra) {
  const birthYear = facts.birth ? facts.birth.year : null;
  if (birthYear === null) return 'no birth date';
  if (facts.lat === null || facts.lon === null) return 'no coordinates';

  const deathYear = facts.death ? facts.death.year : null;
  const alive = deathYear === null && birthYear >= ALIVE_BIRTH_CUTOFF ? 1 : 0;
  const category = categoryFromOccupations(facts.occs) || 'Leaders';

  const existing = await get('SELECT id FROM historical_entities WHERE id = ?', [qid]);

  await run(`INSERT INTO historical_entities
      (id, name, wpTitle, type, start_year, end_year, latitude, longitude,
       importance_score, thumbnailUrl, category, summary,
       start_date, end_date, date_prec, curated, alive, enriched)
    VALUES (?,?,?,'person',?,?,?,?,?,?,?,?,?,?,?,1,?,1)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      wpTitle = excluded.wpTitle,
      start_year = excluded.start_year,
      end_year = excluded.end_year,
      latitude = excluded.latitude,
      longitude = excluded.longitude,
      importance_score = excluded.importance_score,
      thumbnailUrl = COALESCE(excluded.thumbnailUrl, thumbnailUrl),
      category = excluded.category,
      summary = COALESCE(excluded.summary, summary),
      start_date = excluded.start_date,
      end_date = excluded.end_date,
      date_prec = excluded.date_prec,
      curated = 1,
      alive = excluded.alive,
      enriched = 1`,
    [
      qid, facts.label, title.replace(/ /g, '_'),
      birthYear, deathYear, facts.lat, facts.lon,
      facts.sitelinks, extra.thumbnail, category, extra.summary,
      facts.birth.prec === 'year' ? null : facts.birth.iso,
      facts.death && facts.death.prec !== 'year' ? facts.death.iso : null,
      facts.birth.prec, alive,
    ]);

  // The title we asked for is itself a good alias: it is the name a person
  // typed, which is not always the Wikidata label.
  await run('INSERT OR IGNORE INTO entity_aliases (entity_id, alias, lang) VALUES (?,?,?)', [qid, title, 'en']);
  return existing ? 'updated' : 'added';
}

async function main() {
  const entries = [];
  for (const [group, titles] of Object.entries(CURATED)) {
    for (const t of titles) entries.push({ group, title: t });
  }
  console.log(`${entries.length} curated names across ${Object.keys(CURATED).length} groups`);

  // Resolve every title to a Wikidata id.
  const resolved = [];
  const unresolved = [];
  for (let i = 0; i < entries.length; i += TITLE_BATCH) {
    const batch = entries.slice(i, i + TITLE_BATCH);
    const res = await resolveTitles(batch.map(b => b.title));
    const byTitle = new Map(res.map(r => [r.title, r]));
    for (const b of batch) {
      const r = byTitle.get(b.title);
      if (!r || r.missing || !r.qid) { unresolved.push(b.title); continue; }
      resolved.push({ ...b, qid: r.qid, resolvedTitle: r.resolved });
    }
    process.stdout.write(`\r  resolving ${Math.min(i + TITLE_BATCH, entries.length)}/${entries.length}   `);
    await sleep(400);
  }
  console.log(`\n  resolved ${resolved.length}, unresolved ${unresolved.length}`);

  // Fetch the facts in bulk.
  const facts = new Map();
  const ids = resolved.map(r => r.qid);
  for (let i = 0; i < ids.length; i += SPARQL_BATCH) {
    const batch = ids.slice(i, i + SPARQL_BATCH);
    try {
      for (const [k, v] of await fetchFacts(batch)) facts.set(k, v);
    } catch (e) {
      console.error(`\n  facts batch ${i} failed: ${e.message}`);
    }
    process.stdout.write(`\r  facts ${Math.min(i + SPARQL_BATCH, ids.length)}/${ids.length}   `);
    await sleep(PAUSE_MS);
  }
  console.log();

  // Second pass for whatever the birth-place query could not place.
  const incomplete = resolved.filter(r => {
    const f = facts.get(r.qid);
    return f && (f.lat === null || f.lon === null || !f.birth);
  });
  if (incomplete.length) {
    console.log(`  ${incomplete.length} without a birth place or birth date, trying fallbacks`);
    const fbIds = incomplete.map(r => r.qid);
    const recovered = [];
    for (let i = 0; i < fbIds.length; i += SPARQL_BATCH) {
      const batch = fbIds.slice(i, i + SPARQL_BATCH);
      try {
        const fbs = await fetchFallbacks(batch);
        for (const qid of batch) {
          const f = facts.get(qid);
          const via = applyFallback(f, fbs.get(qid));
          if (via && f.lat !== null && f.birth) {
            recovered.push(`${f.label} (via ${via})`);
          }
        }
      } catch (e) {
        console.error(`\n  fallback batch ${i} failed: ${e.message}`);
      }
      await sleep(PAUSE_MS);
    }
    console.log(`  recovered ${recovered.length}:`);
    for (const r of recovered) console.log(`    ${r}`);
  }

  // Anything Wikidata still cannot place or date gets its values by hand.
  let manualUsed = 0;
  for (const r of resolved) {
    const m = MANUAL[r.title];
    if (!m) continue;
    const f = facts.get(r.qid);
    if (!f) continue;
    if (!f.birth) f.birth = { year: m.start, iso: null, prec: 'circa' };
    if (m.end !== undefined && !f.death) f.death = { year: m.end, iso: null, prec: 'circa' };
    if (f.lat === null || f.lon === null) { f.lat = m.lat; f.lon = m.lon; }
    manualUsed++;
  }
  if (manualUsed) console.log(`  ${manualUsed} figures filled from manual_figures.js`);

  // Summaries and thumbnails, one page at a time.
  const skipped = [];
  let added = 0, updated = 0, n = 0;
  for (const r of resolved) {
    n++;
    const f = facts.get(r.qid);
    if (!f) { skipped.push(`${r.title} (no facts)`); continue; }
    const extra = await fetchSummary(r.resolvedTitle);
    const result = await upsert(r.qid, r.resolvedTitle, f, extra);
    if (result === 'added') added++;
    else if (result === 'updated') updated++;
    else skipped.push(`${r.title} (${result})`);
    process.stdout.write(`\r  writing ${n}/${resolved.length}  (+${added} new, ${updated} updated)   `);
    await sleep(120);
  }
  console.log();

  if (unresolved.length) {
    console.log(`\nnot found on Wikipedia (${unresolved.length}):`);
    for (const t of unresolved) console.log(`  ${t}`);
  }
  if (skipped.length) {
    console.log(`\nskipped (${skipped.length}):`);
    for (const s of skipped) console.log(`  ${s}`);
  }

  const total = await get('SELECT COUNT(*) c FROM historical_entities WHERE curated = 1');
  console.log(`\n${total.c} curated rows in the database`);
  db.close();
}

main().catch(e => { console.error(e); process.exit(1); });
