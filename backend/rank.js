// Assign a region to every row and compute a fame score that is fair across
// the world.
//
// The raw sitelink count measures how many language editions wrote about
// someone, which tracks how much of the internet writes in European languages.
// Ranked that way, Quang Trung (39 sitelinks) loses to any mid-tier European
// with 80, and the 18th century in Asia never shows up next to the French
// Revolution.
//
// The fix is to rank a person against their own neighbourhood in time and
// space first, then blend a smaller amount of global reach back in so a
// genuinely world-famous figure still rises.

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
// Resolve next to this file, not the shell's working directory, so running
// the script from the project root cannot create an empty database there.
const db = new sqlite3.Database(path.join(__dirname, 'coincidence.db'));

const run = (sql, p = []) => new Promise((res, rej) => db.run(sql, p, function (e) { e ? rej(e) : res(this); }));
const all = (sql, p = []) => new Promise((res, rej) => db.all(sql, p, (e, r) => e ? rej(e) : res(r)));
const get = (sql, p = []) => new Promise((res, rej) => db.get(sql, p, (e, r) => e ? rej(e) : res(r)));

// Boxes are checked in order, so the narrow ones come before the wide ones.
// These are tested against a country's centre point, not a birth place, which
// keeps them away from the borders where boxes disagree with reality.
const REGION_BOXES = [
  ['Southeast Asia', -11, 24, 92, 141],
  ['East Asia',       20, 55, 100, 146],
  ['South Asia',       5, 38, 60, 92],
  ['Middle East',     12, 45, 25, 63],
  ['Africa',         -36, 38, -20, 52],
  ['Europe',          35, 72, -25, 45],
  ['North America',   12, 75, -170, -50],
  ['South America',  -56, 13, -82, -34],
  ['Oceania',        -50, 0, 110, 180],
  ['Central Asia',    35, 56, 46, 100],
];

function boxRegion(lat, lon) {
  for (const [name, latMin, latMax, lonMin, lonMax] of REGION_BOXES) {
    if (lat >= latMin && lat <= latMax && lon >= lonMin && lon <= lonMax) return name;
  }
  return null;
}

// Prefer the country centre. Fall back to the person's own coordinates only
// when Wikidata records no country, which is mostly ancient figures.
function regionOf(row) {
  if (row.country_lat !== null && row.country_lat !== undefined) {
    const r = boxRegion(row.country_lat, row.country_lon);
    if (r) return r;
  }
  return boxRegion(row.latitude, row.longitude) || 'Elsewhere';
}

// A century is a coarse but honest unit for "who was around at the same time".
const eraOf = year => Math.floor(year / 100) * 100;

// Curated rows are in the database because a person decided they belong.
// Never let the ranking push one below the middle of the pack.
const CURATED_FLOOR = 62;

// A percentile computed over fewer rows than this says more about how little
// was harvested for that corner of the world than about the person.
const MIN_CONFIDENT_GROUP = 12;

// Wikipedia is written mostly by and about Europe and North America, so a
// sitelink count is a measure of who wrote about someone, not of who mattered.
// Ranking inside a region and century already removes most of that, because a
// Vietnamese emperor is then compared to other Vietnamese, not to Napoleon.
// This second, smaller correction decides how often each region shows up on
// screen at all, which the within-region ranking cannot fix on its own.
//
// This is the one place to tune the balance. Raise a number to see that part
// of the world more often.
const REGION_BOOST = {
  'Europe':          0.85,
  'North America':   0.90,
  'Middle East':     1.10,
  'East Asia':       1.10,
  'South Asia':      1.15,
  'Central Asia':    1.15,
  'South America':   1.15,
  'Southeast Asia':  1.25,
  'Africa':          1.25,
  'Oceania':         1.30,
  'Elsewhere':       1.00,
};

async function assignRegions() {
  const rows = await all(`SELECT id, latitude, longitude, country_lat, country_lon
    FROM historical_entities`);
  await run('BEGIN');
  for (const r of rows) {
    await run('UPDATE historical_entities SET region = ? WHERE id = ?', [regionOf(r), r.id]);
  }
  await run('COMMIT');
  const counts = await all('SELECT region, COUNT(*) c FROM historical_entities GROUP BY region ORDER BY c DESC');
  for (const c of counts) console.log(`  ${c.region}: ${c.c}`);
}

async function computeFame() {
  const rows = await all(`SELECT id, importance_score, start_year, region, curated
    FROM historical_entities WHERE start_year IS NOT NULL`);

  const maxScore = rows.reduce((m, r) => Math.max(m, r.importance_score || 0), 1);
  const logMax = Math.log(1 + maxScore);

  // Group by region and century, then rank inside each group.
  const groups = new Map();
  for (const r of rows) {
    const key = `${r.region}|${eraOf(r.start_year)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  await run('BEGIN');
  for (const members of groups.values()) {
    members.sort((a, b) => (a.importance_score || 0) - (b.importance_score || 0));
    const n = members.length;
    for (let i = 0; i < n; i++) {
      const r = members[i];
      // Percentile inside the group, pulled towards the middle when the group
      // is small. Oceania in the 1700s holds a handful of rows, and without
      // this a Fijian golfer topped that percentile and outranked Napoleon.
      const raw = n === 1 ? 0.5 : i / (n - 1);
      const confidence = Math.min(1, n / MIN_CONFIDENT_GROUP);
      const local = 0.5 + (raw - 0.5) * confidence;
      const global = Math.log(1 + (r.importance_score || 0)) / logMax;
      const boost = REGION_BOOST[r.region] ?? 1.0;
      // Not clipped at 100. Clipping flattened every boosted region's top
      // rows into a tie at exactly 100 and threw away their order. fame is an
      // internal ranking score, so the scale running to about 125 is fine.
      let fame = 100 * (0.65 * local + 0.35 * global) * boost;
      if (r.curated === 1) fame = Math.max(fame, CURATED_FLOOR);
      await run('UPDATE historical_entities SET fame = ? WHERE id = ?', [Math.round(fame * 10) / 10, r.id]);
    }
  }
  await run('COMMIT');
  console.log(`  ranked ${rows.length} rows in ${groups.size} region-century groups`);
}

async function report() {
  console.log('\ntop of 1700s, by raw sitelinks:');
  for (const r of await all(`SELECT name, region, importance_score, ROUND(fame,1) fame
      FROM historical_entities WHERE start_year BETWEEN 1700 AND 1799 AND type='person'
      ORDER BY importance_score DESC LIMIT 8`)) {
    console.log(`  ${String(r.importance_score).padStart(4)} sitelinks  fame ${String(r.fame).padStart(5)}  ${r.name} (${r.region})`);
  }
  console.log('\ntop of 1700s, by fame:');
  for (const r of await all(`SELECT name, region, importance_score, ROUND(fame,1) fame
      FROM historical_entities WHERE start_year BETWEEN 1700 AND 1799 AND type='person'
      ORDER BY fame DESC LIMIT 8`)) {
    console.log(`  ${String(r.importance_score).padStart(4)} sitelinks  fame ${String(r.fame).padStart(5)}  ${r.name} (${r.region})`);
  }
}

async function main() {
  console.log('regions');
  await assignRegions();
  console.log('fame');
  await computeFame();
  await report();
  db.close();
}

main().catch(e => { console.error(e); process.exit(1); });
