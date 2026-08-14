/* =========================================================================
   rotation-ranking.js — GET ?task=&department=&window=90

   Ranked "who's next" roster for a rotation task, derived fresh from
   history on every call — there is no stored order pointer, so roster
   adds, terminations, and leaves can't corrupt the rotation.

   Ranking rules (see ROTATION_SPEC.md §3):
     • count tasks (garbage): fewest turns in the rolling window first,
       tie-break longest time since last turn. Skipped turns do NOT count,
       so a skipped person stays at the front of the ranking.
     • hours tasks (labor_share): fewest out-of-department hours first —
       loaned hours + project hours COMBINED, not a count of loans. Open
       blocks count their elapsed time so far. Tie-break longest since
       last time out.
     • Ranking is within department, never warehouse-wide. With no
       ?department= the response carries every department, each ranked
       separately.

   Roster comes from employees_sync_state (active employees only);
   employees with no history rank first (zero total, never assigned).

   Auth: always-on authorize() with no role restriction — every invited,
   non-suspended hc_users account can read. Visibility to associates is
   the point of the module; writes (assign/skip/loan) are separate
   functions with their own gating. Read-only: no writes here.
   ========================================================================= */

const { Pool } = require('pg');
const { ensureRotationSchema } = require('./_rotation-schema');

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
      id: String(e.id || '').trim() || String(e.name).trim(),
      name: String(e.name).trim(),
      department: String(e.department || 'Receiving').trim(),
    }));
}

// Turn counts per employee for a count-unit task. Counts follow the person
// across transfers (a turn served while in another department still counts
// toward their total); the department snapshot column is for reporting.
async function loadTurnStats(taskCode, windowDays) {
  const r = await pool.query(
    `SELECT employee_id,
            COUNT(*) FILTER (WHERE status IN ('assigned','completed'))::int AS turns,
            MAX(service_date) FILTER (WHERE status IN ('assigned','completed')) AS last_turn
       FROM hc_rotation_turns
      WHERE task_code = $1
        AND service_date >= CURRENT_DATE - $2::int
      GROUP BY employee_id;`,
    [taskCode, windowDays]
  );
  const stats = {};
  for (const row of r.rows) {
    const last = row.last_turn ? row.last_turn.toISOString().slice(0, 10) : null;
    stats[row.employee_id] = { total: row.turns, last, turns: row.turns, last_turn: last };
  }
  return stats;
}

// Out-of-department hours per employee: loans and projects combined.
// Open blocks (no actual_end) count elapsed time so far; planned blocks
// that never started count 0 but still update "last out" for tie-breaks.
async function loadHourStats(windowDays) {
  const r = await pool.query(
    `SELECT employee_id,
            COALESCE(SUM(GREATEST(0, EXTRACT(EPOCH FROM (COALESCE(actual_end, NOW()) - actual_start)) / 3600.0))
              FILTER (WHERE actual_start IS NOT NULL AND block_type = 'loan'), 0)    AS loaned_hours,
            COALESCE(SUM(GREATEST(0, EXTRACT(EPOCH FROM (COALESCE(actual_end, NOW()) - actual_start)) / 3600.0))
              FILTER (WHERE actual_start IS NOT NULL AND block_type = 'project'), 0) AS project_hours,
            COUNT(*) FILTER (WHERE actual_start IS NOT NULL AND actual_end IS NULL)::int AS open_blocks,
            MAX(service_date) AS last_out
       FROM hc_assignment_blocks
      WHERE service_date >= CURRENT_DATE - $1::int
      GROUP BY employee_id;`,
    [windowDays]
  );
  const stats = {};
  for (const row of r.rows) {
    const loaned = round2(row.loaned_hours);
    const project = round2(row.project_hours);
    stats[row.employee_id] = {
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
            COALESCE(SUM(GREATEST(0, EXTRACT(EPOCH FROM (COALESCE(actual_end, NOW()) - actual_start)) / 3600.0))
              FILTER (WHERE actual_start IS NOT NULL), 0) AS hours_out
       FROM hc_assignment_blocks
      WHERE service_date >= CURRENT_DATE - $1::int
      GROUP BY home_department;`,
    [windowDays]
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

  const roster = await loadRoster();
  const statsById = taskRow.unit === 'hours'
    ? await loadHourStats(windowDays)
    : await loadTurnStats(taskRow.code, windowDays);
  const deptHoursOut = taskRow.unit === 'hours' ? await loadDeptHoursOut(windowDays) : null;

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
      return taskRow.unit === 'hours'
        ? { rank: rest.rank, employee_id: rest.employee_id, name: rest.name, department: rest.department,
            loaned_hours: rest.loaned_hours || 0, project_hours: rest.project_hours || 0,
            combined_hours: rest.combined_hours || 0, open_blocks: rest.open_blocks || 0, last_out: last }
        : { rank: rest.rank, employee_id: rest.employee_id, name: rest.name, department: rest.department,
            turns: rest.turns || 0, last_turn: last };
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
