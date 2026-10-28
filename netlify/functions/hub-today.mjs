// Warehouse Hub labor board: where each associate works today, what's on the
// floor this morning (POs and units per department), and UPH (yesterday,
// month average, and today's minimum to finish the month at goal).
//
// Everyone can read team numbers; names only appear for signed-in viewers.
// Only Team Leads and Admins (Manager role) can save.
import pg from 'pg';
import crypto from 'node:crypto';
import schedule from './_hub_schedule.js';

const { Pool } = pg;
const SESSION_COOKIE = 'hub_associate_session';
const SESSION_VERSION = 2;
// The departments the morning board and UPH track (names match the team list).
const LABOR_DEPARTMENTS = ['QA Receiving', 'QA Prep', 'Assembly'];
const DEFAULT_GOALS = { 'QA Receiving': 200, 'QA Prep': 300, Assembly: 220 };
const SPANISH = {
  'QA Receiving': 'Recepción QA', 'QA Prep': 'Preparación QA', Assembly: 'Ensamblaje', 'Put-Away': 'Almacenamiento',
  'Printing Station': 'Estación de impresión', Printing: 'Impresión', Returns: 'Devoluciones', Fulfillment: 'Despacho',
  Facilities: 'Instalaciones', Inventory: 'Inventario',
};
let poolInstance = null;
let schemaReady = false;

const env = (name) => globalThis.Netlify?.env?.get(name) || process.env[name] || '';
const clean = (value, max = 120) => String(value == null ? '' : value).trim().slice(0, max);
const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

function getPool() {
  const connectionString = env('DATABASE_URL');
  if (!connectionString) throw new Error('DATABASE_URL is not configured.');
  if (!poolInstance) poolInstance = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  return poolInstance;
}

function session(request) {
  try {
    const secret = env('HUB_ASSOCIATE_SESSION_SECRET');
    const raw = request.headers.get('cookie') || '';
    const token = raw.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
    if (!secret || !token) return null;
    const [ivText, tagText, dataText] = token.split('.');
    const decipher = crypto.createDecipheriv('aes-256-gcm', crypto.createHash('sha256').update(secret).digest(), Buffer.from(ivText, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
    const payload = JSON.parse(Buffer.concat([decipher.update(Buffer.from(dataText, 'base64url')), decipher.final()]).toString('utf8'));
    if (payload?.v !== SESSION_VERSION || !payload?.name || Number(payload.exp || 0) <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

const canEdit = (s) => ['manager', 'team lead'].includes(clean(s?.role, 40).toLowerCase());

async function ensureSchema(db) {
  if (schemaReady) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS hub_labor_board (
      work_date DATE NOT NULL,
      department TEXT NOT NULL,
      pos INTEGER NOT NULL DEFAULT 0,
      units INTEGER NOT NULL DEFAULT 0,
      updated_by TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (work_date, department)
    );
    CREATE TABLE IF NOT EXISTS hub_labor_uph (
      work_date DATE NOT NULL,
      department TEXT NOT NULL,
      uph NUMERIC NOT NULL,
      updated_by TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (work_date, department)
    );
    -- Hours are kept if entered but no longer used in the month average.
    ALTER TABLE hub_labor_uph ADD COLUMN IF NOT EXISTS hours NUMERIC;
    CREATE TABLE IF NOT EXISTS hub_labor_goals (
      department TEXT PRIMARY KEY,
      goal NUMERIC NOT NULL,
      updated_by TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS hub_labor_assignments (
      work_date DATE NOT NULL,
      employee_id BIGINT NOT NULL,
      department TEXT NOT NULL,
      updated_by TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (work_date, employee_id)
    );
    -- Assembly uses pos as its order count; packs is Assembly-only.
    ALTER TABLE hub_labor_board ADD COLUMN IF NOT EXISTS packs INTEGER;
    -- End-of-day huddle notes, keyed by the day they're about:
    -- reads/issues = how that day went (written at its end-of-day meeting);
    -- expect = what to expect that day (written the workday before).
    CREATE TABLE IF NOT EXISTS hub_huddle_days (
      work_date DATE PRIMARY KEY,
      reads JSONB NOT NULL DEFAULT '{}'::jsonb,
      issues TEXT NOT NULL DEFAULT '',
      expect TEXT NOT NULL DEFAULT '',
      closed_by TEXT NOT NULL DEFAULT '',
      closed_at TIMESTAMPTZ,
      planned_by TEXT NOT NULL DEFAULT '',
      planned_at TIMESTAMPTZ
    );
  `);
  schemaReady = true;
}

// ---- dates (America/New_York, Monday-Friday workdays) ----
function easternToday() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}
const asDate = (text) => new Date(`${text}T12:00:00Z`);
const iso = (date) => date.toISOString().slice(0, 10);
const addDays = (text, n) => { const d = asDate(text); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const isWorkday = (text) => { const day = asDate(text).getUTCDay(); return day >= 1 && day <= 5; };
function previousWorkday(text) {
  let day = addDays(text, -1);
  while (!isWorkday(day)) day = addDays(day, -1);
  return day;
}
function nextWorkday(text) {
  let day = addDays(text, 1);
  while (!isWorkday(day)) day = addDays(day, 1);
  return day;
}
const OFF = 'Off';
const READS = ['On track', 'Close', 'Behind', 'Unsure'];
function workdaysInMonth(text) {
  const first = `${text.slice(0, 7)}-01`;
  let count = 0;
  for (let day = first; day.slice(0, 7) === text.slice(0, 7); day = addDays(day, 1)) if (isWorkday(day)) count += 1;
  return count;
}
const label = (text, opts) => asDate(text).toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });

// Month UPH = plain average of the daily UPHs entered this month.
function monthUph(entries) {
  if (!entries.length) return null;
  return entries.reduce((sum, e) => sum + e.uph, 0) / entries.length;
}

// UPH needed today and every remaining workday for the month's average to
// finish at goal: (goal x workdays in month - UPH already entered) / days left.
// Only entered days count as done, so a missed entry doesn't drag the target.
function minimumToday(goal, entries, total) {
  const left = total - entries.length;
  if (!goal || left <= 0) return null;
  const banked = entries.reduce((sum, e) => sum + e.uph, 0);
  return Math.max(0, Math.ceil((goal * total - banked) / left));
}

async function repairOct20LateCloseout(db, viewer) {
  // One-time recovery for the close-out accidentally entered on Tue Oct 20
  // at ~7:51 AM ET. It belonged to Mon Oct 19 and its plan belongs to Tue Oct 20.
  // The narrow timestamp window and missing Oct 19 close-out make this safe and
  // prevent it from ever running against a later legitimate close-out.
  if (!viewer || clean(viewer.role, 40).toLowerCase() !== 'manager' || easternToday() !== '2026-10-20') return false;

  const yesterday = '2026-10-19';
  const today = '2026-10-20';
  const tomorrow = '2026-10-21';
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const h = await client.query(`
      SELECT to_char(work_date,'YYYY-MM-DD') AS work_date,reads,issues,expect,closed_by,closed_at,planned_by,planned_at
      FROM hub_huddle_days
      WHERE work_date IN ($1,$2,$3)
      FOR UPDATE
    `, [yesterday, today, tomorrow]);
    const rows = Object.fromEntries(h.rows.map((row) => [row.work_date, row]));
    const prev = rows[yesterday] || {};
    const cur = rows[today] || {};
    const next = rows[tomorrow] || {};

    const closedAt = cur.closed_at ? new Date(cur.closed_at).getTime() : 0;
    const plannedAt = next.planned_at ? new Date(next.planned_at).getTime() : 0;
    const windowStart = Date.parse('2026-10-20T11:45:00Z');
    const windowEnd = Date.parse('2026-10-20T12:05:00Z');
    const sameSave = closedAt >= windowStart && closedAt <= windowEnd
      && plannedAt >= windowStart && plannedAt <= windowEnd
      && Math.abs(plannedAt - closedAt) <= 120000
      && clean(cur.closed_by, 100)
      && clean(cur.closed_by, 100) === clean(next.planned_by, 100);

    if (!sameSave || prev.closed_at) {
      await client.query('ROLLBACK');
      return false;
    }

    // Move "how Monday went" back to Monday while preserving any Monday plan note.
    await client.query(`
      INSERT INTO hub_huddle_days(work_date,reads,issues,closed_by,closed_at)
      VALUES($1,$2::jsonb,$3,$4,$5)
      ON CONFLICT(work_date) DO UPDATE SET
        reads=EXCLUDED.reads,
        issues=EXCLUDED.issues,
        closed_by=EXCLUDED.closed_by,
        closed_at=EXCLUDED.closed_at
    `, [yesterday, JSON.stringify(cur.reads || {}), clean(cur.issues, 2000), clean(cur.closed_by, 100), cur.closed_at]);

    // Move the plan that was mistakenly saved for Wednesday back to Tuesday,
    // and clear the accidental Tuesday close-out so today's real EOD remains open.
    await client.query(`
      INSERT INTO hub_huddle_days(work_date,reads,issues,expect,closed_by,closed_at,planned_by,planned_at)
      VALUES($1,'{}'::jsonb,'',$2,'',NULL,$3,$4)
      ON CONFLICT(work_date) DO UPDATE SET
        reads='{}'::jsonb,
        issues='',
        closed_by='',
        closed_at=NULL,
        expect=EXCLUDED.expect,
        planned_by=EXCLUDED.planned_by,
        planned_at=EXCLUDED.planned_at
    `, [today, clean(next.expect, 2000), clean(next.planned_by, 100), next.planned_at]);

    // The planned staffing and floor numbers were also one workday too far ahead.
    await client.query('DELETE FROM hub_labor_assignments WHERE work_date=$1', [today]);
    await client.query(`
      INSERT INTO hub_labor_assignments(work_date,employee_id,department,updated_by,updated_at)
      SELECT $1,employee_id,department,updated_by,updated_at
      FROM hub_labor_assignments
      WHERE work_date=$2
    `, [today, tomorrow]);
    await client.query('DELETE FROM hub_labor_assignments WHERE work_date=$1', [tomorrow]);

    await client.query('DELETE FROM hub_labor_board WHERE work_date=$1', [today]);
    await client.query(`
      INSERT INTO hub_labor_board(work_date,department,pos,units,packs,updated_by,updated_at)
      SELECT $1,department,pos,units,packs,updated_by,updated_at
      FROM hub_labor_board
      WHERE work_date=$2
    `, [today, tomorrow]);
    await client.query('DELETE FROM hub_labor_board WHERE work_date=$1', [tomorrow]);

    // Leave Wednesday available for tonight's real plan.
    await client.query(`
      UPDATE hub_huddle_days
      SET expect='',planned_by='',planned_at=NULL
      WHERE work_date=$1
    `, [tomorrow]);

    await client.query('COMMIT');
    console.log('hub-today: repaired Oct 20 morning late close-out -> Oct 19/20');
    return true;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.warn('hub-today late close-out repair skipped:', error?.message);
    return false;
  } finally {
    client.release();
  }
}

function editableCloseOutDay(value, fallback = easternToday()) {
  const today = easternToday();
  const day = clean(value, 10) || fallback;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('Choose a valid End-of-Day date.');
  if (day > today) throw new Error('End-of-Day cannot be saved for a future date.');
  if (day < addDays(today, -62)) throw new Error('End-of-Day history can be edited for the last two months.');
  if (!isWorkday(day)) throw new Error('End-of-Day is only kept for Monday to Friday.');
  return day;
}

async function closeOutState(db, workDate) {
  const day = editableCloseOutDay(workDate);
  const planDay = nextWorkday(day);
  const [people, huddleRows, planAssign, planBoard] = await Promise.all([
    schedule.employees(db),
    db.query(`
      SELECT to_char(work_date,'YYYY-MM-DD') AS work_date,reads,issues,expect,closed_by,closed_at,planned_by,planned_at
      FROM hub_huddle_days
      WHERE work_date IN ($1,$2)
    `, [day, planDay]),
    db.query(`SELECT employee_id,department FROM hub_labor_assignments WHERE work_date=$1`, [planDay]),
    db.query(`SELECT department,pos,units,packs FROM hub_labor_board WHERE work_date=$1`, [planDay]),
  ]);
  const huddle = Object.fromEntries(huddleRows.rows.map((row) => [row.work_date, row]));
  const active = people.filter((person) => person.active);
  const planMoved = new Map(planAssign.rows.map((row) => [Number(row.employee_id), row.department]));
  const planByDept = new Map(planBoard.rows.map((row) => [row.department, row]));
  const reads = huddle[day]?.reads && typeof huddle[day].reads === 'object' ? huddle[day].reads : {};
  return {
    today: day,
    planDay,
    todayLabel: label(day, { weekday: 'short', month: 'short', day: 'numeric' }),
    planLabel: label(planDay, { weekday: 'long', month: 'short', day: 'numeric' }),
    reads,
    issues: clean(huddle[day]?.issues, 2000),
    expect: clean(huddle[planDay]?.expect, 2000),
    closedBy: clean(huddle[day]?.closed_by, 100),
    closedAt: huddle[day]?.closed_at || null,
    plannedBy: clean(huddle[planDay]?.planned_by, 100),
    plannedAt: huddle[planDay]?.planned_at || null,
    people: active.map((person) => ({
      id: person.id,
      name: person.name,
      home: person.homeDepartment,
      plan: planMoved.get(person.id) || person.homeDepartment,
    })),
    floor: LABOR_DEPARTMENTS.map((department) => {
      const row = planByDept.get(department);
      return {
        department,
        pos: row ? Number(row.pos) : null,
        units: row ? Number(row.units) : null,
        packs: row && row.packs !== null ? Number(row.packs) : null,
      };
    }),
  };
}

async function boardState(db, viewer) {
  await schedule.ensureImported(db);
  await repairOct20LateCloseout(db, viewer);
  const today = easternToday();
  const lastWorkday = previousWorkday(today);
  const monthStart = `${today.slice(0, 7)}-01`;
  const planDay = nextWorkday(today);
  const [boardRows, uphRows, goalRows, assignRows, people, huddleRows] = await Promise.all([
    db.query(`SELECT department,pos,units,packs,updated_by,updated_at FROM hub_labor_board WHERE work_date=$1`, [today]),
    db.query(`SELECT to_char(work_date,'YYYY-MM-DD') AS work_date,department,uph,hours FROM hub_labor_uph WHERE work_date >= $1 AND work_date < $2 OR work_date >= $3`, [monthStart, today, addDays(today, -62)]),
    db.query(`SELECT department,goal FROM hub_labor_goals`),
    db.query(`SELECT employee_id,department FROM hub_labor_assignments WHERE work_date=$1`, [today]),
    schedule.employees(db),
    db.query(`SELECT to_char(work_date,'YYYY-MM-DD') AS work_date,reads,issues,expect,closed_by,closed_at,planned_by,planned_at
      FROM hub_huddle_days WHERE work_date IN ($1,$2,$3)`, [lastWorkday, today, planDay]),
  ]);
  const huddle = Object.fromEntries(huddleRows.rows.map((row) => [row.work_date, row]));
  const readsOf = (day) => (huddle[day]?.reads && typeof huddle[day].reads === 'object' ? huddle[day].reads : {});
  const goals = { ...DEFAULT_GOALS, ...Object.fromEntries(goalRows.rows.map((row) => [row.department, Number(row.goal)])) };
  const boardByDept = new Map(boardRows.rows.map((row) => [row.department, row]));
  const latest = boardRows.rows.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))[0];
  const total = workdaysInMonth(today);

  const uph = LABOR_DEPARTMENTS.map((department) => {
    const mine = uphRows.rows.filter((row) => row.department === department);
    const monthEntries = mine.filter((row) => row.work_date >= monthStart && row.work_date < today && isWorkday(row.work_date))
      .map((row) => ({ uph: Number(row.uph), hours: row.hours === null ? 0 : Number(row.hours) }));
    const yesterday = mine.find((row) => row.work_date === lastWorkday);
    const month = monthUph(monthEntries);
    return {
      department,
      goal: goals[department] || null,
      yesterday: yesterday ? Math.round(Number(yesterday.uph)) : null,
      read: readsOf(lastWorkday)[department] || '',
      month: month === null ? null : Math.round(month),
      entries: monthEntries.length,
      minimum: minimumToday(goals[department], monthEntries, total),
    };
  });

  const result = {
    today, lastWorkday,
    dateLabel: label(today, { weekday: 'long', month: 'short', day: 'numeric' }),
    lastWorkdayLabel: label(lastWorkday, { weekday: 'short', month: 'short', day: 'numeric' }),
    monthName: label(today, { month: 'long' }),
    workdaysTotal: total,
    board: LABOR_DEPARTMENTS.map((department) => {
      const row = boardByDept.get(department);
      return { department, pos: row ? Number(row.pos) : null, units: row ? Number(row.units) : null, packs: row && row.packs !== null ? Number(row.packs) : null };
    }),
    // Notes can mention people, so only signed-in viewers get them.
    expect: viewer ? clean(huddle[today]?.expect, 2000) : '',
    boardBy: latest ? clean(latest.updated_by, 100) : '',
    boardAt: latest ? new Date(latest.updated_at).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }) : '',
    uph,
    canEdit: canEdit(viewer),
  };

  // Where everyone works today: home department unless a lead moved them.
  const active = people.filter((person) => person.active);
  const moved = new Map(assignRows.rows.map((row) => [Number(row.employee_id), row.department]));
  const placed = active.map((person) => ({
    id: person.id, name: person.name, home: person.homeDepartment,
    today: moved.get(person.id) || person.homeDepartment,
  }));
  const counts = {};
  for (const person of placed) if (person.today !== OFF) counts[person.today] = (counts[person.today] || 0) + 1;
  result.floor = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([department, count]) => ({ department, count }));

  if (viewer) {
    const me = placed.find((person) => person.id === Number(viewer.employeeId))
      || placed.find((person) => person.name.toLowerCase() === clean(viewer.name, 100).toLowerCase());
    if (me) {
      const cleaning = await db.query(`
        SELECT a.to_department FROM hub_sched_assignments a
        LEFT JOIN hub_cleaning_checkins c ON c.assignment_id = a.id
        WHERE a.type='cleaning' AND a.assignment_date=$1 AND COALESCE(a.actual_employee_id,a.employee_id)=$2
          AND a.duty_status NOT IN ('completed','missed') AND COALESCE(c.status,'') <> 'completed'
        LIMIT 1`, [today, me.id]).catch(() => ({ rows: [] }));
      result.me = {
        name: me.name,
        department: me.today,
        departmentEs: SPANISH[me.today] || me.today,
        homeDepartment: me.home,
        moved: me.today !== me.home,
        teammates: me.today === OFF ? [] : placed.filter((person) => person.today === me.today && person.id !== me.id).map((person) => person.name),
        cleaning: cleaning.rows[0] ? { area: cleaning.rows[0].to_department } : null,
      };
    }
  }
  if (result.canEdit) {
    // Recent daily UPH and hours, so a lead can view or correct a past day.
    result.history = uphRows.rows.filter((row) => row.work_date < today)
      .map((row) => ({ date: row.work_date, department: row.department, uph: Number(row.uph), hours: row.hours === null ? null : Number(row.hours) }));
    result.roster = placed.map(({ id, name, home, today: dept }) => ({ id, name, home, today: dept }));
    result.departments = (await schedule.departments(db)).filter((d) => d.active).map((d) => d.name);
    // Last workday's notes for the huddle, and the editable End-of-Day record.
    result.lastIssues = clean(huddle[lastWorkday]?.issues, 2000);
    result.closeOut = await closeOutState(db, today);
  }
  return result;
}

const count = (value) => {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(String(value).replace(/,/g, ''));
  if (!Number.isFinite(number) || number < 0 || number > 10000000) throw new Error('Numbers must be zero or more.');
  return Math.round(number);
};

const decimal = (value) => {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(String(value).replace(/,/g, ''));
  if (!Number.isFinite(number) || number < 0 || number > 100000) throw new Error('UPH and hours must be zero or more.');
  return Math.round(number * 100) / 100;
};

// The day a UPH entry is for: the last workday by default, or a past workday
// within ~2 months (for corrections and back-filling).
function pastWorkday(value, fallback) {
  const date = clean(value, 10);
  if (!date) return fallback;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date >= easternToday() || date < addDays(easternToday(), -62)) throw new Error('Choose a past day within the last two months.');
  if (!isWorkday(date)) throw new Error('UPH is only kept for Monday to Friday.');
  return date;
}

async function saveUph(db, date, department, uphValue, hoursValue, actor) {
  if (!LABOR_DEPARTMENTS.includes(department)) return;
  const uph = decimal(uphValue);
  const hours = decimal(hoursValue);
  if (uph === null) {
    await db.query('DELETE FROM hub_labor_uph WHERE work_date=$1 AND department=$2', [date, department]);
    return;
  }
  await db.query(`INSERT INTO hub_labor_uph(work_date,department,uph,hours,updated_by,updated_at) VALUES($1,$2,$3,$4,$5,NOW())
    ON CONFLICT(work_date,department) DO UPDATE SET uph=EXCLUDED.uph,hours=EXCLUDED.hours,updated_by=EXCLUDED.updated_by,updated_at=NOW()`,
  [date, department, uph, hours, actor]);
}

// Where people work on a day: only moves out of the home department are stored.
// "Off" marks someone not in that day.
async function saveAssignments(client, day, rows, actor) {
  const people = new Map((await schedule.employees(client)).map((person) => [person.id, person]));
  const departments = new Set((await schedule.departments(client)).filter((d) => d.active).map((d) => d.name));
  for (const row of Array.isArray(rows) ? rows : []) {
    const person = people.get(Number(row?.id));
    if (!person || !person.active) continue;
    const department = clean(row.department, 100);
    if (!department || department === person.homeDepartment) {
      await client.query('DELETE FROM hub_labor_assignments WHERE work_date=$1 AND employee_id=$2', [day, person.id]);
    } else {
      if (department !== OFF && !departments.has(department)) throw new Error(`${department} isn't an active department.`);
      await client.query(`INSERT INTO hub_labor_assignments(work_date,employee_id,department,updated_by,updated_at) VALUES($1,$2,$3,$4,NOW())
        ON CONFLICT(work_date,employee_id) DO UPDATE SET department=EXCLUDED.department,updated_by=EXCLUDED.updated_by,updated_at=NOW()`,
      [day, person.id, department, actor]);
    }
  }
}

async function save(db, viewer, body) {
  const actor = clean(viewer.name, 100);
  const today = easternToday();
  const lastWorkday = previousWorkday(today);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    if (body.action === 'saveBoard') {
      const uphDate = pastWorkday(body.uphDate, lastWorkday);
      for (const row of Array.isArray(body.board) ? body.board : []) {
        if (!LABOR_DEPARTMENTS.includes(row?.department)) continue;
        const pos = count(row.pos); const units = count(row.units); const packs = row.department === 'Assembly' ? count(row.packs) : null;
        if (pos === null && units === null && packs === null) {
          await client.query('DELETE FROM hub_labor_board WHERE work_date=$1 AND department=$2', [today, row.department]);
        } else {
          await client.query(`INSERT INTO hub_labor_board(work_date,department,pos,units,packs,updated_by,updated_at) VALUES($1,$2,$3,$4,$5,$6,NOW())
            ON CONFLICT(work_date,department) DO UPDATE SET pos=EXCLUDED.pos,units=EXCLUDED.units,packs=EXCLUDED.packs,updated_by=EXCLUDED.updated_by,updated_at=NOW()`,
          [today, row.department, pos || 0, units || 0, packs, actor]);
        }
        await saveUph(client, uphDate, row.department, row.uph, row.hours, actor);
        const goal = count(row.goal);
        if (goal) await client.query(`INSERT INTO hub_labor_goals(department,goal,updated_by,updated_at) VALUES($1,$2,$3,NOW())
          ON CONFLICT(department) DO UPDATE SET goal=EXCLUDED.goal,updated_by=EXCLUDED.updated_by,updated_at=NOW()`,
        [row.department, goal, actor]);
      }
    } else if (body.action === 'saveAssignments') {
      await saveAssignments(client, today, body.assignments, actor);
    } else if (body.action === 'closeOut') {
      // End of day: how the selected workday went + the plan for its next workday.
      // workDate is explicit for history edits; older clients still default to today.
      const workDate = editableCloseOutDay(body.workDate, today);
      const planDay = nextWorkday(workDate);
      const reads = {};
      for (const department of LABOR_DEPARTMENTS) {
        const value = clean(body.reads?.[department], 20);
        if (READS.includes(value)) reads[department] = value;
      }
      await client.query(`INSERT INTO hub_huddle_days(work_date,reads,issues,closed_by,closed_at) VALUES($1,$2::jsonb,$3,$4,NOW())
        ON CONFLICT(work_date) DO UPDATE SET reads=EXCLUDED.reads,issues=EXCLUDED.issues,closed_by=EXCLUDED.closed_by,closed_at=NOW()`,
      [workDate, JSON.stringify(reads), clean(body.issues, 2000), actor]);
      await client.query(`INSERT INTO hub_huddle_days(work_date,expect,planned_by,planned_at) VALUES($1,$2,$3,NOW())
        ON CONFLICT(work_date) DO UPDATE SET expect=EXCLUDED.expect,planned_by=EXCLUDED.planned_by,planned_at=NOW()`,
      [planDay, clean(body.expect, 2000), actor]);
      await saveAssignments(client, planDay, body.assignments, actor);
      for (const row of Array.isArray(body.floor) ? body.floor : []) {
        if (!LABOR_DEPARTMENTS.includes(row?.department)) continue;
        const pos = count(row.pos); const units = count(row.units); const packs = row.department === 'Assembly' ? count(row.packs) : null;
        if (pos === null && units === null && packs === null) {
          await client.query('DELETE FROM hub_labor_board WHERE work_date=$1 AND department=$2', [planDay, row.department]);
        } else {
          await client.query(`INSERT INTO hub_labor_board(work_date,department,pos,units,packs,updated_by,updated_at) VALUES($1,$2,$3,$4,$5,$6,NOW())
            ON CONFLICT(work_date,department) DO UPDATE SET pos=EXCLUDED.pos,units=EXCLUDED.units,packs=EXCLUDED.packs,updated_by=EXCLUDED.updated_by,updated_at=NOW()`,
          [planDay, row.department, pos || 0, units || 0, packs, actor]);
        }
      }
    } else {
      throw new Error('Unsupported action.');
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// Back-fill past days' UPH and hours from the daily report, authorized with
// the workbook import key (same key as the Excel sync).
async function backfill(db, request, body) {
  const expected = env('OVERSTOCK_EXCEL_IMPORT_SECRET');
  const supplied = request.headers.get('x-overstock-import-key') || '';
  if (!expected || supplied.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
    return [401, { error: 'Invalid import key.' }];
  }
  const rows = Array.isArray(body.rows) ? body.rows.slice(0, 200) : [];
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    for (const row of rows) {
      await saveUph(client, pastWorkday(row.date, ''), row.department, row.uph, row.hours, clean(body.by || 'Daily report back-fill', 100));
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    return [400, { error: clean(error.message, 200) }];
  } finally {
    client.release();
  }
  return [200, { ok: true, saved: rows.length, ...(await boardState(db, null)) }];
}

export default async (request) => {
  try {
    const db = getPool();
    await ensureSchema(db);
    await schedule.ensureImported(db);
    const viewer = session(request);
    if (request.method === 'GET') {
      const url = new URL(request.url);
      const closeOutDate = clean(url.searchParams.get('closeOutDate'), 10);
      if (closeOutDate) {
        if (!viewer) return json(401, { error: 'Sign in to the Hub first.' });
        if (!canEdit(viewer)) return json(403, { error: 'Only Team Leads and Admins can view End-of-Day history.' });
        return json(200, { ok: true, closeOut: await closeOutState(db, closeOutDate) });
      }
      return json(200, await boardState(db, viewer));
    }
    if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });
    const body = await request.json().catch(() => ({}));
    if (body.action === 'backfillUph') return json(...(await backfill(db, request, body)));
    if (!viewer) return json(401, { error: 'Sign in to the Hub first.' });
    if (!canEdit(viewer)) return json(403, { error: 'Only Team Leads and Admins can change the labor board.' });
    await save(db, viewer, body);
    return json(200, { ok: true, ...(await boardState(db, viewer)) });
  } catch (error) {
    return json(400, { error: clean(error?.message || 'The labor board is unavailable right now.', 200) });
  }
};
