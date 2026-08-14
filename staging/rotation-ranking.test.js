/* =========================================================================
   rotation-ranking.test.js — validates the pure ranking rules used by
   netlify/functions/rotation-ranking.js. Run: node staging/rotation-ranking.test.js
   No database needed — it exercises the exported rankRoster()/compareRank()
   against fixed rosters + stats and checks the ordering rules from
   ROTATION_SPEC.md §3:
     • lowest total (turns or hours) ranks first
     • ties break to whoever has waited longest (earlier last date first)
     • never-assigned (no history) beats any date at equal totals
     • equal peers order deterministically by name
   ========================================================================= */

const { rankRoster } = require('../netlify/functions/rotation-ranking.js');

function ids(rows) { return rows.map((r) => r.employee_id).join(','); }

const cases = [
  {
    name: 'lowest turn count first',
    roster: [
      { id: 'a', name: 'Ana',  department: 'Prep' },
      { id: 'b', name: 'Ben',  department: 'Prep' },
      { id: 'c', name: 'Cruz', department: 'Prep' },
    ],
    stats: {
      a: { total: 3, last: '2026-08-10' },
      b: { total: 1, last: '2026-08-01' },
      c: { total: 2, last: '2026-08-05' },
    },
    expect: 'b,c,a',
  },
  {
    name: 'tie broken by longest since last turn',
    roster: [
      { id: 'a', name: 'Ana', department: 'Prep' },
      { id: 'b', name: 'Ben', department: 'Prep' },
    ],
    stats: {
      a: { total: 2, last: '2026-08-12' },
      b: { total: 2, last: '2026-07-01' },
    },
    expect: 'b,a',
  },
  {
    name: 'never assigned ranks ahead of any date on equal totals',
    roster: [
      { id: 'new', name: 'Nia', department: 'Prep' },
      { id: 'old', name: 'Ana', department: 'Prep' },
    ],
    stats: { old: { total: 0, last: '2026-05-01' } }, // 'new' has no history at all
    expect: 'new,old',
  },
  {
    name: 'skipped person stays at the front (skips add no total)',
    roster: [
      { id: 'skipped', name: 'Sam', department: 'Prep' },
      { id: 'served',  name: 'Ana', department: 'Prep' },
    ],
    // The SQL layer excludes status='skipped' rows from both count and last
    // date, so a skipped person presents exactly like this: unchanged total.
    stats: {
      skipped: { total: 1, last: '2026-06-01' },
      served:  { total: 2, last: '2026-08-13' },
    },
    expect: 'skipped,served',
  },
  {
    name: 'hours rank ascending, two-hour loan ranks below a full shift',
    roster: [
      { id: 'a', name: 'Ana', department: 'Prep' },
      { id: 'b', name: 'Ben', department: 'Prep' },
    ],
    stats: {
      a: { total: 8, last: '2026-08-01' }, // one full-shift loan
      b: { total: 2, last: '2026-08-13' }, // two-hour loan, more recent
    },
    expect: 'b,a',
  },
  {
    name: 'full tie orders deterministically by name',
    roster: [
      { id: 'z', name: 'Zoe', department: 'Prep' },
      { id: 'a', name: 'Ana', department: 'Prep' },
    ],
    stats: {
      z: { total: 1, last: '2026-08-01' },
      a: { total: 1, last: '2026-08-01' },
    },
    expect: 'a,z',
  },
];

let failed = 0;
for (const c of cases) {
  const got = ids(rankRoster(c.roster, c.stats));
  const ok = got === c.expect;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}${ok ? '' : `  (expected ${c.expect}, got ${got})`}`);
}

// Ranks must be 1..n in output order.
const ranked = rankRoster(cases[0].roster, cases[0].stats);
const ranksOk = ranked.every((r, i) => r.rank === i + 1);
if (!ranksOk) { failed++; console.log('FAIL  ranks are 1..n'); }
else console.log('PASS  ranks are 1..n');

if (failed) { console.error(`${failed} rotation ranking test(s) failed`); process.exit(1); }
console.log('All rotation ranking tests passed.');
