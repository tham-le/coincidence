// Schema migration and data cleanup. Safe to run more than once.
//
// Adds the columns the day-precision and fame-ranking work needs, creates the
// alias table, drops rows with impossible dates, and folds the category mess
// down to one set of names. Real dates come later, from enrich.js.

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
// Resolve next to this file, not the shell's working directory, so running
// the script from the project root cannot create an empty database there.
const db = new sqlite3.Database(path.join(__dirname, 'coincidence.db'));

const run = (sql, params = []) => new Promise((res, rej) =>
  db.run(sql, params, function (e) { e ? rej(e) : res(this); }));
const all = (sql, params = []) => new Promise((res, rej) =>
  db.all(sql, params, (e, r) => e ? rej(e) : res(r)));
const get = (sql, params = []) => new Promise((res, rej) =>
  db.get(sql, params, (e, r) => e ? rej(e) : res(r)));

// Wikidata gives dates as ISO strings. We keep both the raw date and the year,
// so a query can stay cheap on years but a card can still say "71 days".
const NEW_COLUMNS = [
  ['start_date', 'TEXT'],    // ISO birth/start date, null when only a year is known
  ['end_date',   'TEXT'],    // ISO death/end date
  ['date_prec',  'TEXT'],    // 'day', 'month', or 'year'
  ['curated',    'INTEGER DEFAULT 0'],  // hand-picked, never ranked out
  ['fame',       'REAL'],    // sitelinks normalized within region and era
  ['region',     'TEXT'],    // derived from coordinates
  ['alive',      'INTEGER DEFAULT 0'],  // no death date and plausibly still living
];

async function addColumns() {
  const cols = await all('PRAGMA table_info(historical_entities)');
  const have = new Set(cols.map(c => c.name));
  for (const [name, type] of NEW_COLUMNS) {
    if (have.has(name)) continue;
    await run(`ALTER TABLE historical_entities ADD COLUMN ${name} ${type}`);
    console.log(`  + column ${name}`);
  }
}

async function aliasTable() {
  await run(`CREATE TABLE IF NOT EXISTS entity_aliases (
    entity_id TEXT NOT NULL,
    alias     TEXT NOT NULL,
    lang      TEXT,
    PRIMARY KEY (entity_id, alias),
    FOREIGN KEY (entity_id) REFERENCES historical_entities(id) ON DELETE CASCADE
  )`);
  await run('CREATE INDEX IF NOT EXISTS idx_alias ON entity_aliases (alias)');
  await run('CREATE INDEX IF NOT EXISTS idx_alias_entity ON entity_aliases (entity_id)');
}

// A wpTitle that differs from name is already a usable alias. This is what
// made "Quang Trung" unfindable while the row was sitting right there.
async function seedAliasesFromTitles() {
  const r = await run(`INSERT OR IGNORE INTO entity_aliases (entity_id, alias, lang)
    SELECT id, REPLACE(wpTitle,'_',' '), 'en'
    FROM historical_entities
    WHERE wpTitle IS NOT NULL AND wpTitle != '' AND REPLACE(wpTitle,'_',' ') != name`);
  console.log(`  aliases from wpTitle: ${r.changes}`);
}

// A few rows kept the Wikidata id as their display name because the label
// lookup failed during harvest. The Wikipedia title is the real name.
async function repairNames() {
  const bad = await all(`SELECT id, wpTitle FROM historical_entities
    WHERE name GLOB 'Q[0-9]*' AND wpTitle IS NOT NULL AND wpTitle != ''`);
  for (const b of bad) {
    await run('UPDATE historical_entities SET name = ? WHERE id = ?',
      [b.wpTitle.replace(/_/g, ' '), b.id]);
  }
  console.log(`  renamed ${bad.length} rows that showed a Q-id`);
}

async function dropImpossible() {
  // Years outside a sane range are parse failures, not data.
  const bad = await all(`SELECT id,name,start_year,end_year FROM historical_entities
    WHERE start_year IS NULL OR start_year < -4000 OR start_year > 2030
       OR end_year > 2200`);
  for (const b of bad) console.log(`  drop ${b.name} (${b.start_year} to ${b.end_year})`);
  const r = await run(`DELETE FROM historical_entities
    WHERE start_year IS NULL OR start_year < -4000 OR start_year > 2030
       OR end_year > 2200`);
  console.log(`  dropped ${r.changes} impossible rows`);

  // A death before a birth means one of the two was misparsed. Keep the row,
  // drop the death year, let enrich.js refill it.
  const r2 = await run(`UPDATE historical_entities SET end_year = NULL
    WHERE end_year IS NOT NULL AND end_year < start_year`);
  console.log(`  cleared ${r2.changes} death-before-birth years`);
}

// A person born before this and with no recorded death is dead, not living.
// Matches the cutoff enrich.js uses.
const ALIVE_BIRTH_CUTOFF = 1935;

// Five harvesters each invented a different default death year. None of them
// are real. Clear them and let enrich.js fetch the truth.
const SYNTHETIC = [
  { label: 'ingest/random default 2024', where: 'end_year = 2024' },
  { label: 'global_harvester birth+60',  where: 'end_year - start_year = 60' },
  { label: 'harvest_bronze birth+40',    where: 'end_year - start_year = 40' },
  { label: 'harvest_targeted birth+72',  where: 'end_year - start_year = 72' },
  { label: 'death year in the future',   where: 'end_year > 2026' },
];

async function clearSyntheticDeaths() {
  const cols = await all('PRAGMA table_info(historical_entities)');
  const hasEnriched = cols.some(c => c.name === 'enriched');

  // A real lifespan can be exactly 40, 60 or 72 years long. Quang Trung was
  // born 1752 and died 1792, which looks identical to harvest_bronze's
  // invented "birth + 40". Never touch a row whose death date came from
  // Wikidata, so a true value is not mistaken for a guessed one.
  const guard = ' AND end_date IS NULL' + (hasEnriched ? ' AND enriched = 0' : '');

  for (const s of SYNTHETIC) {
    const n = await get(`SELECT COUNT(*) c FROM historical_entities
      WHERE type = 'person' AND ${s.where}${guard}`);
    if (!n.c) continue;
    // Only someone born recently enough can still be living. Setting alive on
    // every cleared row marked 6th century BCE philosophers as alive today.
    await run(`UPDATE historical_entities
      SET end_year = NULL,
          alive = CASE WHEN start_year >= ${ALIVE_BIRTH_CUTOFF} THEN 1 ELSE 0 END
      WHERE type = 'person' AND ${s.where}${guard}`);
    console.log(`  cleared ${n.c} (${s.label})`);
  }
}

// Persons and events had their category columns mixed together, with four
// spellings of "event" and two buckets that mean nothing.
const CATEGORY_MAP = {
  'event': 'Events', 'events': 'Events',
  'war': 'Wars', 'wars': 'Wars',
  'battle': 'Battles', 'battles': 'Battles',
  'revolution': 'Revolutions', 'revolutions': 'Revolutions',
  'leader': 'Leaders', 'leaders': 'Leaders',
  'scientist': 'Scientists', 'scientists': 'Scientists',
  'artist': 'Artists', 'artists': 'Artists',
  'philosopher': 'Thinkers', 'philosophers': 'Thinkers', 'thinkers': 'Thinkers',
  'military': 'Military',
  'explorer': 'Explorers', 'explorers': 'Explorers',
};
// Not categories, just where the harvester dumped whatever it could not label.
const PLACEHOLDER = new Set(['person', 'global history', '']);

const EVENT_CATEGORIES = new Set(['Events', 'Wars', 'Battles', 'Revolutions']);

async function normalizeCategories() {
  const rows = await all('SELECT id, category, type FROM historical_entities');
  let mapped = 0, cleared = 0, retyped = 0;
  await run('BEGIN');
  for (const r of rows) {
    const raw = (r.category || '').trim().toLowerCase();
    if (PLACEHOLDER.has(raw)) {
      if (r.category !== null) { await run('UPDATE historical_entities SET category = NULL WHERE id = ?', [r.id]); cleared++; }
      continue;
    }
    const mappedCat = CATEGORY_MAP[raw];
    if (!mappedCat) continue;
    if (mappedCat !== r.category) { await run('UPDATE historical_entities SET category = ? WHERE id = ?', [mappedCat, r.id]); mapped++; }
    // An entity in an event category is an event, whatever type said before.
    const wantType = EVENT_CATEGORIES.has(mappedCat) ? 'event' : 'person';
    if (r.type !== wantType) { await run('UPDATE historical_entities SET type = ? WHERE id = ?', [wantType, r.id]); retyped++; }
  }
  await run('COMMIT');
  console.log(`  renamed ${mapped}, cleared ${cleared} placeholders, retyped ${retyped}`);
}

// Repairs rows an earlier run of this script marked living by mistake.
async function repairAlive() {
  const r = await run(`UPDATE historical_entities SET alive = 0
    WHERE alive = 1 AND start_year < ${ALIVE_BIRTH_CUTOFF}`);
  console.log(`  cleared ${r.changes} rows wrongly marked as living`);
}

// Puts back a death year that an earlier, unguarded run of this script
// removed even though the exact date was known.
async function repairDeathYears() {
  const r = await run(`UPDATE historical_entities
    SET end_year = CAST(
      CASE WHEN SUBSTR(end_date,1,1) = '-'
           THEN -CAST(SUBSTR(end_date,2,4) AS INTEGER)
           ELSE CAST(SUBSTR(end_date,1,4) AS INTEGER) END AS INTEGER),
        alive = 0
    WHERE end_year IS NULL AND end_date IS NOT NULL`);
  console.log(`  restored ${r.changes} death years from a known date`);
}

// Before roughly 1500, an "exact" date is usually a tradition or a later
// reconstruction, not a record. Wikidata stores those at day precision anyway,
// so the database confidently claims Plato was born on 2 May 426 BCE and
// Genghis Khan on 7 June 1162. No historian accepts either.
//
// The dates stay, because they are still the best guess and the interface can
// print them with "c.". These flags mark which ones may be used for anything
// that depends on the exact day.
//
// Birth and death are flagged separately. A single flag derived from date_prec,
// which only ever described the birth, wrongly hid 1,359 recorded death dates
// from the "died on this day" query.
//
// A month-precision date is written with day 01, so it would collide with
// everyone genuinely born on the first. Those are excluded too.
const TRUSTED_DATE_FROM = 1500;

async function markDateReliability() {
  const cols = await all('PRAGMA table_info(historical_entities)');
  const have = new Set(cols.map(c => c.name));
  for (const name of ['start_reliable', 'end_reliable']) {
    if (!have.has(name)) {
      await run(`ALTER TABLE historical_entities ADD COLUMN ${name} INTEGER DEFAULT 0`);
    }
  }

  await run(`UPDATE historical_entities SET
    start_reliable = CASE WHEN start_date IS NOT NULL AND start_year >= ${TRUSTED_DATE_FROM}
                           AND (date_prec IS NULL OR date_prec = 'day')
                          THEN 1 ELSE 0 END,
    end_reliable   = CASE WHEN end_date IS NOT NULL AND end_year >= ${TRUSTED_DATE_FROM}
                          THEN 1 ELSE 0 END`);

  if (have.has('date_reliable')) {
    // Superseded by the two flags above. Dropping it stops anything reading a
    // value that means something subtly different from its name.
    try {
      await run('ALTER TABLE historical_entities DROP COLUMN date_reliable');
      console.log('  dropped the old single date_reliable column');
    } catch (e) {
      console.log(`  could not drop date_reliable (${e.message}); it is unused`);
    }
  }

  const s = await get(`SELECT
    SUM(start_reliable) sr, SUM(end_reliable) er,
    SUM(CASE WHEN start_date IS NOT NULL AND start_reliable = 0 THEN 1 ELSE 0 END) demoted
    FROM historical_entities`);
  console.log(`  ${s.sr} birth dates and ${s.er} death dates usable for exact-day facts`);
  console.log(`  ${s.demoted} keep a birth date but are shown as approximate`);
}

async function indexes() {
  await run('CREATE INDEX IF NOT EXISTS idx_years ON historical_entities (start_year, end_year)');
  await run('CREATE INDEX IF NOT EXISTS idx_fame ON historical_entities (fame)');
  await run('CREATE INDEX IF NOT EXISTS idx_curated ON historical_entities (curated)');
  await run('CREATE INDEX IF NOT EXISTS idx_name ON historical_entities (name)');
  await run('CREATE INDEX IF NOT EXISTS idx_start_md ON historical_entities (substr(start_date,6,5))');
  await run('CREATE INDEX IF NOT EXISTS idx_end_md ON historical_entities (substr(end_date,6,5))');
}

async function main() {
  console.log('schema');
  await addColumns();
  await aliasTable();

  console.log('aliases');
  await seedAliasesFromTitles();

  console.log('names');
  await repairNames();

  console.log('impossible dates');
  await dropImpossible();

  console.log('synthetic death years');
  await clearSyntheticDeaths();

  console.log('death years');
  await repairDeathYears();

  console.log('living flags');
  await repairAlive();

  console.log('categories');
  await normalizeCategories();

  console.log('date reliability');
  await markDateReliability();

  console.log('indexes');
  await indexes();

  const total = await get('SELECT COUNT(*) c FROM historical_entities');
  const cats = await all(`SELECT category, COUNT(*) c FROM historical_entities
    GROUP BY category ORDER BY c DESC`);
  console.log(`\n${total.c} rows`);
  for (const c of cats) console.log(`  ${c.category ?? '(none, enrich.js will fill)'}: ${c.c}`);
  db.close();
}

main().catch(e => { console.error(e); process.exit(1); });
