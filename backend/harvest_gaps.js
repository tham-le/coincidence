// Fill the holes in pre-1800 coverage.
//
// The database is shaped like Wikipedia: dense in Europe after 1400, thin
// everywhere else, and close to empty in some corners. Africa between 500 and
// 999 held zero people. South America before 1800 held nine.
//
// Every earlier harvester asked Wikidata for "notable people" and sorted by
// sitelinks, which is how the database got that shape in the first place: one
// global ranking always returns the same well-linked Europeans.
//
// This one samples each era and continent as its own bucket and takes the top
// of each. Ranking within a bucket is the whole point. The best-documented
// person in 9th century Africa is worth having even though a global sort would
// never reach them.

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const {
  sparql, sleep, parseTime,
  fetchFacts, fetchFallbacks, applyFallback, fetchSummary,
} = require('./wikidata');
const { categoryFromOccupations } = require('./occupations');

const db = new sqlite3.Database(path.join(__dirname, 'coincidence.db'));

const run = (sql, p = []) => new Promise((res, rej) => db.run(sql, p, function (e) { e ? rej(e) : res(this); }));
const all = (sql, p = []) => new Promise((res, rej) => db.all(sql, p, (e, r) => e ? rej(e) : res(r)));
const get = (sql, p = []) => new Promise((res, rej) => db.get(sql, p, (e, r) => e ? rej(e) : res(r)));

const ALIVE_BIRTH_CUTOFF = 1935;
const PAUSE_MS = 4000;

const ERAS = [
  [-800, 0], [0, 500], [500, 1000], [1000, 1400], [1400, 1600], [1600, 1800],
];

// Quotas reflect how thin each part already is, not how much Wikidata holds.
// Europe is already the densest part of the database and gets the smallest
// share here.
const CONTINENTS = [
  { name: 'Africa',        qid: 'Q15', quota: 60 },
  { name: 'Asia',          qid: 'Q48', quota: 60 },
  { name: 'South America', qid: 'Q18', quota: 40 },
  { name: 'North America', qid: 'Q49', quota: 40 },
  // Q55 is the Netherlands. Oceania as a P30 value is Q538, Insular Oceania,
  // which is the only one that returns countries. Australia comes in through
  // its own entry below.
  { name: 'Oceania',       qid: 'Q538', quota: 25 },
  { name: 'Australia',     qid: 'Q3960', quota: 25 },
  { name: 'Europe',        qid: 'Q46', quota: 20 },
];

// A low floor on purpose. Requiring the reach that a European of the same era
// has would reproduce the bias this script exists to correct.
const MIN_SITELINKS = 8;

const isoYear = y => {
  const neg = y < 0;
  const abs = String(Math.abs(y)).padStart(4, '0');
  return `${neg ? '-' : ''}${abs}-01-01`;
};

// Countries are looked up per continent once, then used as an explicit VALUES
// set in every era query.
//
// The obvious query, join every human through birth place to country to
// continent, times out on Asia and Europe: the planner scans all humans with a
// birth date before it can apply the continent filter. Naming the countries
// makes the same question selective, and the query drops from a 504 to about
// fifteen seconds.
const COUNTRY_CHUNK = 12;

async function countriesOf(continentQid) {
  const bindings = await sparql(`
SELECT DISTINCT ?c WHERE {
  ?c wdt:P30 wd:${continentQid} ;
     wdt:P31/wdt:P279* wd:Q6256 .
}`);
  return bindings.map(b => b.c.value.split('/').pop());
}

const chunk = (arr, n) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

// Citizenship or birth place, because neither alone covers the ancient world.
async function discoverPeople(fromYear, toYear, countries, limit) {
  const values = countries.map(c => `wd:${c}`).join(' ');
  const bindings = await sparql(`
SELECT DISTINCT ?item ?sitelinks WHERE {
  VALUES ?c { ${values} }
  { ?item wdt:P27 ?c } UNION { ?item wdt:P19/wdt:P17 ?c }
  ?item wdt:P569 ?birth ;
        wikibase:sitelinks ?sitelinks .
  FILTER(?birth >= "${isoYear(fromYear)}"^^xsd:dateTime && ?birth < "${isoYear(toYear)}"^^xsd:dateTime)
  FILTER(?sitelinks >= ${MIN_SITELINKS})
}
ORDER BY DESC(?sitelinks)
LIMIT ${limit}`);
  return bindings.map(b => ({ id: b.item.value.split('/').pop(), links: parseInt(b.sitelinks.value, 10) }));
}

// Events are thinner than people before 1800 and the waves chart depends on
// them, so they get their own pass.
async function discoverEvents(fromYear, toYear, countries, limit) {
  const values = countries.map(c => `wd:${c}`).join(' ');
  const bindings = await sparql(`
SELECT DISTINCT ?item ?sitelinks WHERE {
  VALUES ?c { ${values} }
  VALUES ?class { wd:Q198 wd:Q178561 wd:Q10931 wd:Q124734 wd:Q8465 }
  ?item wdt:P17 ?c ;
        wdt:P31/wdt:P279* ?class ;
        wdt:P580 ?start ;
        wikibase:sitelinks ?sitelinks .
  FILTER(?start >= "${isoYear(fromYear)}"^^xsd:dateTime && ?start < "${isoYear(toYear)}"^^xsd:dateTime)
  FILTER(?sitelinks >= ${MIN_SITELINKS})
}
ORDER BY DESC(?sitelinks)
LIMIT ${limit}`);
  return bindings.map(b => ({ id: b.item.value.split('/').pop(), links: parseInt(b.sitelinks.value, 10) }));
}

// Runs one era-continent bucket across however many country chunks it takes,
// then keeps the best of the merged result.
async function topOfBucket(discover, from, to, countries, quota, label) {
  const seen = new Map();
  for (const part of chunk(countries, COUNTRY_CHUNK)) {
    const rows = await withRetry(label, () => discover(from, to, part, quota));
    if (rows) for (const r of rows) if (!seen.has(r.id)) seen.set(r.id, r.links);
    await sleep(PAUSE_MS);
  }
  return [...seen.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, quota)
    .map(([id]) => id);
}

// Wikidata's query service returns 502 under load often enough that skipping a
// bucket on the first failure loses whole eras. Retry once, slowly.
async function withRetry(label, fn) {
  try {
    return await fn();
  } catch (e) {
    console.log(`    ${label}: ${e.message}, retrying in 15s`);
    await sleep(15000);
    try {
      return await fn();
    } catch (e2) {
      console.log(`    ${label}: gave up (${e2.message})`);
      return null;
    }
  }
}

async function existingIds() {
  const rows = await all('SELECT id FROM historical_entities');
  return new Set(rows.map(r => r.id));
}

async function insertPerson(qid, facts) {
  if (!facts.birth) return 'no birth date';
  if (facts.lat === null || facts.lon === null) return 'no coordinates';

  const birthYear = facts.birth.year;
  const deathYear = facts.death ? facts.death.year : null;
  const alive = deathYear === null && birthYear >= ALIVE_BIRTH_CUTOFF ? 1 : 0;
  const extra = await fetchSummary(facts.label);

  await run(`INSERT OR IGNORE INTO historical_entities
      (id, name, wpTitle, type, start_year, end_year, latitude, longitude,
       importance_score, thumbnailUrl, category, summary,
       start_date, end_date, date_prec, curated, alive, enriched, occupations)
    VALUES (?,?,?,'person',?,?,?,?,?,?,?,?,?,?,?,0,?,1,?)`,
    [
      qid, facts.label, String(facts.label).replace(/ /g, '_'),
      birthYear, deathYear, facts.lat, facts.lon,
      facts.sitelinks, extra.thumbnail,
      categoryFromOccupations(facts.occs), extra.summary,
      facts.birth.prec === 'year' ? null : facts.birth.iso,
      facts.death && facts.death.prec !== 'year' ? facts.death.iso : null,
      facts.birth.prec, alive, facts.occs.join(','),
    ]);
  return 'added';
}

async function harvestPeople(known, countryMap) {
  let added = 0, skipped = 0;
  for (const [from, to] of ERAS) {
    for (const c of CONTINENTS) {
      const ids = await topOfBucket(discoverPeople, from, to,
        countryMap.get(c.name), c.quota, `${from}..${to} ${c.name}`);
      if (!ids.length) { continue; }
      const fresh = ids.filter(id => !known.has(id));
      if (fresh.length === 0) {
        console.log(`  ${String(from).padStart(5)}..${String(to).padStart(4)} ${c.name.padEnd(14)} ${ids.length} found, all known`);
        await sleep(PAUSE_MS);
        continue;
      }

      // A failure here used to end the whole run. Losing one bucket is fine;
      // the script is idempotent and a later pass picks it up.
      let facts;
      try {
        facts = await fetchFacts(fresh);
      } catch (e) {
        console.log(`    ${from}..${to} ${c.name}: facts failed (${e.message}), skipping bucket`);
        await sleep(10000);
        continue;
      }
      // Anything without a birth place gets the same outward walk the curated
      // seeding uses, which is what rescues most non-European figures.
      const incomplete = fresh.filter(id => {
        const f = facts.get(id);
        return f && (f.lat === null || f.lon === null || !f.birth);
      });
      if (incomplete.length) {
        try {
          const fbs = await fetchFallbacks(incomplete);
          for (const id of incomplete) applyFallback(facts.get(id), fbs.get(id));
        } catch { /* the rows simply stay incomplete and are skipped below */ }
      }

      let bucketAdded = 0;
      for (const id of fresh) {
        const f = facts.get(id);
        if (!f) { skipped++; continue; }
        const result = await insertPerson(id, f);
        if (result === 'added') { bucketAdded++; added++; known.add(id); }
        else skipped++;
      }
      console.log(`  ${String(from).padStart(5)}..${String(to).padStart(4)} ${c.name.padEnd(14)} ${ids.length} found, ${bucketAdded} added`);
      await sleep(PAUSE_MS);
    }
  }
  return { added, skipped };
}

async function harvestEvents(known, countryMap) {
  let added = 0;
  for (const [from, to] of ERAS) {
    for (const c of CONTINENTS) {
      const ids = await topOfBucket(discoverEvents, from, to,
        countryMap.get(c.name), Math.round(c.quota / 2), `${from}..${to} ${c.name} events`);
      if (!ids.length) { continue; }
      const fresh = ids.filter(id => !known.has(id));
      if (fresh.length === 0) { await sleep(PAUSE_MS); continue; }

      // Events carry P580/P582 and a location, which enrich_events.js already
      // knows how to read. Insert the shell and let that pass fill it in.
      let bucketAdded = 0;
      let coords;
      try {
        coords = await fetchEventPlaces(fresh);
      } catch (e) {
        console.log(`    ${from}..${to} ${c.name}: event places failed (${e.message})`);
        await sleep(10000);
        continue;
      }
      for (const id of fresh) {
        const c2 = coords.get(id);
        if (!c2) continue;
        const r = await run(`INSERT OR IGNORE INTO historical_entities
            (id, name, wpTitle, type, start_year, end_year, latitude, longitude,
             importance_score, category, curated, alive, enriched, event_classified)
          VALUES (?,?,?,'event',?,?,?,?,?,NULL,0,0,1,0)`,
          [id, c2.label, String(c2.label).replace(/ /g, '_'),
           c2.start, c2.end, c2.lat, c2.lon, c2.sitelinks]);
        if (r.changes) { bucketAdded++; added++; known.add(id); }
      }
      if (bucketAdded) {
        console.log(`  ${String(from).padStart(5)}..${String(to).padStart(4)} ${c.name.padEnd(14)} ${bucketAdded} events added`);
      }
      await sleep(PAUSE_MS);
    }
  }
  return added;
}

async function fetchEventPlaces(ids) {
  const values = ids.map(id => `wd:${id}`).join(' ');
  const bindings = await sparql(`
SELECT ?item ?itemLabel ?start ?sprec ?end ?eprec ?sitelinks ?lat ?lon WHERE {
  VALUES ?item { ${values} }
  OPTIONAL { ?item p:P580/psv:P580 ?sn . ?sn wikibase:timeValue ?start ; wikibase:timePrecision ?sprec . }
  OPTIONAL { ?item p:P582/psv:P582 ?en . ?en wikibase:timeValue ?end ; wikibase:timePrecision ?eprec . }
  OPTIONAL { ?item wikibase:sitelinks ?sitelinks . }
  OPTIONAL {
    ?item wdt:P625 ?coord .
    BIND(geof:latitude(?coord) AS ?lat) BIND(geof:longitude(?coord) AS ?lon)
  }
  OPTIONAL {
    ?item wdt:P17 ?country . ?country wdt:P625 ?ccoord .
    BIND(geof:latitude(?ccoord) AS ?clat) BIND(geof:longitude(?ccoord) AS ?clon)
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`);

  const out = new Map();
  for (const b of bindings) {
    const id = b.item.value.split('/').pop();
    const start = parseTime(b.start?.value, b.sprec?.value);
    if (!start) continue;
    const lat = b.lat ? parseFloat(b.lat.value) : null;
    if (lat === null) continue;
    const end = parseTime(b.end?.value, b.eprec?.value);
    const rec = {
      label: b.itemLabel?.value || id,
      start: start.year,
      end: end ? end.year : start.year,
      lat,
      lon: parseFloat(b.lon.value),
      sitelinks: b.sitelinks ? parseInt(b.sitelinks.value, 10) : 0,
    };
    if (!out.has(id)) out.set(id, rec);
  }
  return out;
}

async function report() {
  const eras = [[-800, 0, 'BCE'], [0, 500, '0-499'], [500, 1000, '500-999'],
    [1000, 1400, '1000-1399'], [1400, 1600, '1400-1599'], [1600, 1800, '1600-1799']];
  console.log('\npeople before 1800, by era:');
  for (const [lo, hi, label] of eras) {
    const n = await get(`SELECT COUNT(*) c FROM historical_entities
      WHERE type='person' AND start_year >= ? AND start_year < ?`, [lo, hi]);
    console.log(`  ${label.padEnd(11)} ${n.c}`);
  }
  const ev = await get(`SELECT COUNT(*) c FROM historical_entities
    WHERE type='event' AND start_year < 1800`);
  console.log(`  events before 1800: ${ev.c}`);
}

async function main() {
  const known = await existingIds();
  console.log(`${known.size} rows already present\n`);

  console.log('country lists');
  const countryMap = new Map();
  for (const c of CONTINENTS) {
    const list = await countriesOf(c.qid);
    countryMap.set(c.name, list);
    console.log(`  ${c.name.padEnd(14)} ${list.length} countries`);
    await sleep(400);
  }

  console.log('\npeople');
  const people = await harvestPeople(known, countryMap);
  console.log(`\n  added ${people.added}, skipped ${people.skipped}`);

  console.log('\nevents');
  const events = await harvestEvents(known, countryMap);
  console.log(`  added ${events}`);

  await report();
  console.log('\nNow run: node enrich_regions.js && node enrich_events.js && node rank.js');
  db.close();
}

main().catch(e => { console.error(e); process.exit(1); });
