// Recompute person categories from the occupation ids already stored by
// enrich.js. No network, so editing occupations.js and rerunning this is cheap.
//
// A category that no occupation supports is set to NULL rather than left at
// whatever a harvester guessed from its search term.

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { categoryFromOccupations } = require('./occupations');

const db = new sqlite3.Database(path.join(__dirname, 'coincidence.db'));
const run = (sql, p = []) => new Promise((res, rej) => db.run(sql, p, function (e) { e ? rej(e) : res(this); }));
const all = (sql, p = []) => new Promise((res, rej) => db.all(sql, p, (e, r) => e ? rej(e) : res(r)));

async function main() {
  const rows = await all(`SELECT id, name, category, curated, occupations
    FROM historical_entities
    WHERE type = 'person' AND occupations IS NOT NULL`);
  console.log(`${rows.length} people with stored occupations`);

  let changed = 0, cleared = 0;
  const moves = [];
  await run('BEGIN');
  for (const r of rows) {
    const occs = r.occupations ? r.occupations.split(',').filter(Boolean) : [];
    const cat = categoryFromOccupations(occs);
    // A curated row keeps its category when nothing matches. It is on the list
    // because someone decided it belongs, so leaving it uncategorized would
    // drop it out of the filters for no good reason.
    if (cat === null && r.curated === 1) continue;
    if (cat === r.category) continue;
    await run('UPDATE historical_entities SET category = ? WHERE id = ?', [cat, r.id]);
    if (cat === null) cleared++; else changed++;
    if (moves.length < 12) moves.push(`${r.name}: ${r.category ?? 'none'} -> ${cat ?? 'none'}`);
  }
  await run('COMMIT');

  for (const m of moves) console.log(`  ${m}`);
  console.log(`\n${changed} recategorized, ${cleared} cleared`);

  const cats = await all(`SELECT category, COUNT(*) c FROM historical_entities
    WHERE type = 'person' GROUP BY category ORDER BY c DESC`);
  for (const c of cats) console.log(`  ${c.category ?? '(none)'}: ${c.c}`);
  db.close();
}

main().catch(e => { console.error(e); process.exit(1); });
