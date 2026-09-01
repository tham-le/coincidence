// Remove the rows that crowd out the site's actual subject.
//
// The harvesters ranked by Wikidata sitelinks, which is why the database
// filled up with footballers and television actors born after 1950. They are
// not wrong rows, they are just not what a map of "who was alive at the same
// time" is for, and they outnumber the pre-1800 world three to one.
//
// Dry run by default. Pass --apply to actually delete.

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
// Resolve next to this file, not the shell's working directory, so running
// the script from the project root cannot create an empty database there.
const db = new sqlite3.Database(path.join(__dirname, 'coincidence.db'));

const run = (sql, p = []) => new Promise((res, rej) => db.run(sql, p, function (e) { e ? rej(e) : res(this); }));
const all = (sql, p = []) => new Promise((res, rej) => db.all(sql, p, (e, r) => e ? rej(e) : res(r)));
const get = (sql, p = []) => new Promise((res, rej) => db.get(sql, p, (e, r) => e ? rej(e) : res(r)));

const APPLY = process.argv.includes('--apply');

// Every rule spares curated rows, and every rule tests fame rather than the
// raw sitelink count. Using sitelinks here would undo the whole point of the
// ranking work: it would delete the Battle of Huế and keep a European battle
// of the same size, purely because more language editions covered the latter.
const RULES = [
  {
    name: 'modern athletes and performers with little reach',
    where: `curated = 0 AND category IN ('Sport','Entertainment')
            AND COALESCE(fame,0) < 55 AND start_year > 1900`,
  },
  {
    name: 'uncategorized modern people with little reach',
    where: `curated = 0 AND category IS NULL
            AND start_year > 1900 AND COALESCE(fame,0) < 45`,
  },
  {
    name: 'people still alive with little reach',
    where: `curated = 0 AND alive = 1 AND COALESCE(fame,0) < 50`,
  },
  {
    name: 'minor recent events',
    where: `curated = 0 AND type = 'event'
            AND start_year > 1945 AND COALESCE(fame,0) < 40`,
  },
];

async function main() {
  const before = await get('SELECT COUNT(*) c FROM historical_entities');
  console.log(`${before.c} rows before\n`);

  let totalMarked = 0;
  for (const rule of RULES) {
    const n = await get(`SELECT COUNT(*) c FROM historical_entities WHERE ${rule.where}`);
    const sample = await all(`SELECT name, start_year, category, importance_score
      FROM historical_entities WHERE ${rule.where} ORDER BY importance_score DESC LIMIT 4`);
    console.log(`${rule.name}: ${n.c}`);
    for (const s of sample) {
      console.log(`    ${s.name} (${s.start_year}, ${s.category ?? 'no category'}, ${s.importance_score})`);
    }
    if (APPLY) await run(`DELETE FROM historical_entities WHERE ${rule.where}`);
    totalMarked += n.c;
  }

  if (APPLY) {
    // Aliases of deleted rows have nothing left to point at.
    const orphans = await run(`DELETE FROM entity_aliases WHERE entity_id NOT IN
      (SELECT id FROM historical_entities)`);
    console.log(`\ncleared ${orphans.changes} orphaned aliases`);
    await run('VACUUM');
  }

  const after = await get('SELECT COUNT(*) c FROM historical_entities');
  console.log(`\n${APPLY ? 'deleted' : 'would delete'} ${totalMarked}`);
  console.log(`${after.c} rows ${APPLY ? 'now' : '(unchanged, dry run)'}`);

  const era = await all(`SELECT
      CASE WHEN start_year < 0 THEN 'BCE'
           WHEN start_year < 500 THEN '0-499'
           WHEN start_year < 1000 THEN '500-999'
           WHEN start_year < 1500 THEN '1000-1499'
           WHEN start_year < 1800 THEN '1500-1799'
           WHEN start_year < 1900 THEN '1800-1899'
           ELSE '1900+' END bucket,
      COUNT(*) c
    FROM historical_entities GROUP BY bucket ORDER BY MIN(start_year)`);
  console.log('\nera spread:');
  for (const e of era) console.log(`  ${e.bucket.padEnd(10)} ${e.c}`);

  if (!APPLY) console.log('\nrerun with --apply to delete');
  db.close();
}

main().catch(e => { console.error(e); process.exit(1); });
