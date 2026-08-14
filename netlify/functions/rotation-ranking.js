/* =========================================================================
   rotation-ranking.js — GET ?task=&department=&window=90

   Ranked "who's next" roster for a rotation task, derived fresh from
   history on every call — there is no stored order pointer, so roster
   adds, terminations, and leaves can't corrupt the rotation.

   Ranking rules (see docs/ROTATION_SPEC.md §3):
     • count tasks (garbage): fewest turns in the rolling window first,
       tie-break longest time since last turn. Skipped turns do NOT count,
       so a skipped person stays at the front of the ranking.
     • hours tasks (labor_share): fewest out-of-department hours first —
       loaned hours + project hours COMBINED, not a count of loans. Open
       blocks count elapsed time, capped at that day's shift end so a
       block missed by the autoclose job can't balloon overnight. Tie-break
       longest since last time out.
     • Ranking is within department, never warehouse-wide. With no
       ?department= the response carries every department, each ranked
       separately.

   Identity: history is keyed by hc_rotation_people.id. The roster (from
   employees_sync_state) contributes only names; each is resolved through
   hc_rotation_person_aliases READ-ONLY here — people are created on write
   (phase 3+), never by this endpoint. A roster name with no person yet
   simply has no history and ranks first on zero.

   Auth: always-on authorize() with no role restriction — every invited,
   non-suspended hc_users account can read. Visibility to associates is
   the point of the module. Read-only: no writes here.
   ========================================================================= */

const { Pool } = require('pg');
const { ensureRotationSchema } = require('./_rotation-schema');
const { nameKey } = require('./_rotation-people');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : undefined,
});

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Shift end for the open-block cap, configurable per environment.
const SHIFT_END = process.env.ROTATION_SHIFT_END || '17:00';
const SHIFT_TZ = process.env.ROTATION_TZ || 'America/New_York';

// When a block is still open, elapsed time stops accruing at the block's
// own service-date shift end (the moment rotation-autoclose should have
// stamped). A block opened after shift end is an anomaly the autoclose
// will sweep; until then it accrues real elapsed time rather than a
// negative interval. $SHIFT_END_SQL expects $2 = 'HH:MM', $3 = timezone.
const ELAPSED_END_SQL = `
  CASE WHEN actual_end IS NOT NULL THEN actual_end
       WHEN ((service_date::text || ' ' || $2)::timestamp AT TIME ZONE $3) > actual_start
         THEN LEAST(NOW(), ((service_date::text || ' ' || $2)::timestamp AT TIME ZONE $3))
       ELSE NOW() END`;
const HOURS_SQL = `GREATEST(0, EXTRACT(EPOCH FROM ((${ELAPSED_END_SQL}) - actual_start)) / 3600.0)`;

/* ---- pure ranking helpers (exported for staging tests) ---------------- */

// Ascending by total (turns or hours); ties go to whoever has waited
// longest — earlier last date first, never-assigned (null) before any date;
// stable name tie-break so equal peers list deterministically.
function compareRank(a, b) {
  if (a.total !== b.total) return a.total - b.total;
  const al = a.last ? String(a.last) : null;
  const bl = b.last ? String(b.last) : null;
  if (al !== bl) {
    if (al === null) return -1;
    if (bl === null) return 1;
    return al < bl ? -1 : 1;
  }
  return String(a.name || '').localeCompare(String(b.name || ''));
}

// roster: [{id, name, department}] — statsById: {id: {total, last, ...extra}}.
// Returns the roster ranked per the rules above, rank starting at 1.
function rankRoster(roster, statsById) {
  const rows = roster.map((emp) => {
    const s = statsById[emp.id] || {};
    return {
      ...s,
      employee_id: emp.id,
      name: emp.name,
      department: emp.department,
      total: Number(s.total) || 0,
      last: s.last || null,
    };
  });
  rows.sort(compareRank);
  rows.forEach((row, i) => { row.rank = i + 1; });
  return rows;
}

/* ---- data access ------------------------------------------------------ */

async function loadRoster() {
  const r = await pool.query(
    `SELECT employees_json FROM employees_sync_state WHERE state_key='default' LIMIT 1;`
  );
  const raw = (r.rows[0] && r.rows[0].employees_json) || [];
  return (Array.isArray(raw) ? raw : [])
    .filter((e) => e && e.active !== false && String(e.name || '').trim())
    .map((e) => ({
      // Roster ids are stripped to "" by the app's sync, so the name is the
      // only usable roster key; person identity is resolved via aliases.
      id: String(e.name).trim(),
      name: String(e.name).trim(),
      department: String(e.department || 'Receiving').trim(),
    }));
}

// name_key -> person_id for the whole alias table (small: one row per
// roster spelling ever seen). Read-only — resolution that CREATES people
// belongs to write endpoints via resolvePersonId().
async function loadAliasMap() {
  const r = await pool.query(`SELECT name_key, person_id FROM hc_rotation_person_aliases;`);
  const map = {};
  for (const row of r.rows) map[row.name_key] = row.person_id;
  return map;
}

// Turn counts per person for a count-unit task. Counts follow the person
// across transfers (a turn served while in another department still counts
// toward their total); the department snapshot column is for reporting.
async function loadTurnStats(taskCode, windowDays) {
  const r = await pool.query(
    `SELECT person_id,
            COUNT(*) FILTER (WHERE status IN ('assigned','completed'))::int AS turns,
            MAX(service_date) FILTER (WHERE status IN ('assigned','completed')) AS last_turn
       FROM hc_rotation_turns
      WHERE task_code = $1
        AND service_date >= CURRENT_DATE - $2::int
      GROUP BY person_id;`,
    [taskCode, windowDays]
  );
  const stats = {};
  for (const row of r.rows) {
    const last = row.last_turn ? row.last_turn.toISOString().slice(0, 10) : null;
    stats[row.person_id] = { total: row.turns, last, turns: row.turns, last_turn: last };
  }
  return stats;
}

// Out-of-department hours per person: loans and projects combined. Open
// blocks count elapsed time capped at shift end (see ELAPSED_END_SQL);
// planned blocks that never started count 0 but still update "last out"
// for tie-breaks.
async function loadHourStats(windowDays) {
  const r = await pool.query(
    `SELECT person_id,
            COALESCE(SUM(${HOURS_SQL})
              FILTER (WHERE actual_start IS NOT NULL AND block_type = 'loan'), 0)    AS loaned_hours,
            COALESCE(SUM(${HOURS_SQL})
              FILTER (WHERE actual_start IS NOT NULL AND block_type = 'project'), 0) AS project_hours,
            COUNT(*) FILTER (WHERE actual_start IS NOT NULL AND actual_end IS NULL)::int AS open_blocks,
            MAX(service_date) AS last_out
       FROM hc_assignment_blocks
      WHERE service_date >= CURRENT_DATE - $1::int
      GROUP BY person_id;`,
    [windowDays, SHIFT_END, SHIFT_TZ]
  );
  const stats = {};
  for (const row of r.rows) {
    const loaned = round2(row.loaned_hours);
    const project = round2(row.project_hours);
    stats[row.person_id] = {
      total: round2(loaned + project),
      last: row.last_out ? row.last_out.toISOString().slice(0, 10) : null,
      loaned_hours: loaned,
      project_hours: project,
      combined_hours: round2(loaned + project),
      open_blocks: row.open_blocks,
    };
  }
  return stats;
}

// Department-level total hours sent out in the window, keyed by the
// home-department snapshot (spec: the sending department absorbs the gap).
async function loadDeptHoursOut(windowDays) {
  const r = await pool.query(
    `SELECT home_department,
            COALESCE(SUM(${HOURS_SQL})
              FILTER (WHERE actual_start IS NOT NULL), 0) AS hours_out
       FROM hc_assignment_blocks
      WHERE service_date >= CURRENT_DATE - $1::int
      GROUP BY home_department;`,
    [windowDays, SHIFT_END, SHIFT_TZ]
  );
  const totals = {};
  for (const row of r.rows) totals[row.home_department] = round2(row.hours_out);
  return totals;
}

/* ---- ranking builder (exported for the local DB verification) --------- */

async function buildRanking({ task, department, windowDays }) {
  const taskRow = (await pool.query(
    `SELECT code, unit, label_en, label_es FROM hc_rotation_tasks WHERE code=$1 AND active IS NOT FALSE;`,
    [task]
  )).rows[0];
  if (!taskRow) return { error: `Unknown task '${task}'` };

  const [roster, aliasMap] = await Promise.all([loadRoster(), loadAliasMap()]);
  const statsByPerson = taskRow.unit === 'hours'
    ? await loadHourStats(windowDays)
    : await loadTurnStats(taskRow.code, windowDays);
  const deptHoursOut = taskRow.unit === 'hours' ? await loadDeptHoursOut(windowDays) : null;

  // Re-key person stats onto roster entries via the alias table. A roster
  // name with no person yet has no history: zero total, ranks first.
  const statsById = {};
  const personByRosterId = {};
  for (const emp of roster) {
    const personId = aliasMap[nameKey(emp.name)];
    personByRosterId[emp.id] = personId != null ? personId : null;
    if (personId != null && statsByPerson[personId]) statsById[emp.id] = statsByPerson[personId];
  }

  // Group the roster per department (never rank warehouse-wide), then rank
  // each group independently. Department match is case-insensitive.
  const wanted = department ? department.trim().toLowerCase() : null;
  const byDept = new Map();
  for (const emp of roster) {
    if (wanted && emp.department.toLowerCase() !== wanted) continue;
    if (!byDept.has(emp.department)) byDept.set(emp.department, []);
    byDept.get(emp.department).push(emp);
  }

  const departments = [...byDept.keys()].sort((a, b) => a.localeCompare(b)).map((dept) => {
    const ranking = rankRoster(byDept.get(dept), statsById).map((row) => {
      const { total, last, ...rest } = row;
      const base = {
        rank: rest.rank,
        person_id: personByRosterId[rest.employee_id],
        name: rest.name,
        department: rest.department,
      };
      return taskRow.unit === 'hours'
        ? { ...base, loaned_hours: rest.loaned_hours || 0, project_hours: rest.project_hours || 0,
            combined_hours: rest.combined_hours || 0, open_blocks: rest.open_blocks || 0, last_out: last }
        : { ...base, turns: rest.turns || 0, last_turn: last };
    });
    const entry = { department: dept, ranking };
    if (deptHoursOut) entry.totals = { hours_out: deptHoursOut[dept] || 0 };
    return entry;
  });

  return {
    ok: true,
    task: taskRow.code,
    unit: taskRow.unit,
    label_en: taskRow.label_en,
    label_es: taskRow.label_es,
    window_days: windowDays,
    generated_at: new Date().toISOString(),
    departments,
  };
}

/* ---- handler ---------------------------------------------------------- */

exports.handler = async function handler(event) {
  const _a = await require('./_auth').authorize(event);
  if (!_a.ok) return json(_a.code, _a.body);
  if (!process.env.DATABASE_URL) return json(500, { error: 'DATABASE_URL is not configured' });
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });

  const q = event.queryStringParameters || {};
  const task = String(q.task || 'garbage').trim().toLowerCase();
  const department = q.department ? String(q.department) : null;

  let windowDays = parseInt(q.window || '90', 10);
  if (!Number.isFinite(windowDays) || windowDays <= 0) windowDays = 90;
  if (windowDays > 730) windowDays = 730;

  try {
    await ensureRotationSchema(pool);
    const result = await buildRanking({ task, department, windowDays });
    if (result.error) return json(400, { error: result.error });
    return json(200, result);
  } catch (error) {
    return json(500, { error: error.message || 'Unknown rotation ranking error' });
  }
};

// Exported for staging tests (compareRank/rankRoster are pure) and for the
// local seeded-history verification of buildRanking.
exports.compareRank = compareRank;
exports.rankRoster = rankRoster;
exports.buildRanking = buildRanking;
