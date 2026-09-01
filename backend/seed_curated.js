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
const {
  UA, sleep, fetchFacts, fetchFallbacks, applyFallback, fetchSummary,
} = require('./wikidata');

const path = require('path');
// Resolve next to this file, not the shell's working directory, so running
// the script from the project root cannot create an empty database there.
const db = new sqlite3.Database(path.join(__dirname, 'coincidence.db'));
const WP_API = 'https://en.wikipedia.org/w/api.php';

const TITLE_BATCH = 40;
const SPARQL_BATCH = 100;
const PAUSE_MS = 900;

const ALIVE_BIRTH_CUTOFF = 1935;

const run = (sql, p = []) => new Promise((res, rej) => db.run(sql, p, function (e) { e ? rej(e) : res(this); }));
const get = (sql, p = []) => new Promise((res, rej) => db.get(sql, p, (e, r) => e ? rej(e) : res(r)));

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
