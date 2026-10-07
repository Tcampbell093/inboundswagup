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
const DEFAULT_GOALS = { 'QA Receiving': 200, 'QA Prep': 300, Assembly: 175 };
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
function workdaysInMonth(text) {
  const first = `${text.slice(0, 7)}-01`;
  let count = 0;
  for (let day = first; day.slice(0, 7) === text.slice(0, 7); day = addDays(day, 1)) if (isWorkday(day)) count += 1;
  return count;
}
const label = (text, opts) => asDate(text).toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });

// UPH needed today and every remaining workday for the month to finish at goal.
// Only entered days count as done, so a missed entry doesn't drag the target.
function minimumToday(goal, entries, total) {
  const left = total - entries.length;
  if (!goal || left <= 0) return null;
  const banked = entries.reduce((sum, value) => sum + value, 0);
  return Math.max(0, Math.ceil((goal * total - banked) / left));
}

async function boardState(db, viewer) {
  await schedule.ensureImported(db);
  const today = easternToday();
  const lastWorkday = previousWorkday(today);
  const monthStart = `${today.slice(0, 7)}-01`;
  const [boardRows, uphRows, goalRows, assignRows, people] = await Promise.all([
    db.query(`SELECT department,pos,units,updated_by,updated_at FROM hub_labor_board WHERE work_date=$1`, [today]),
    db.query(`SELECT to_char(work_date,'YYYY-MM-DD') AS work_date,department,uph FROM hub_labor_uph WHERE work_date >= $1 AND work_date < $2 OR work_date=$3`, [monthStart, today, lastWorkday]),
    db.query(`SELECT department,goal FROM hub_labor_goals`),
    db.query(`SELECT employee_id,department FROM hub_labor_assignments WHERE work_date=$1`, [today]),
    schedule.employees(db),
  ]);
  const goals = { ...DEFAULT_GOALS, ...Object.fromEntries(goalRows.rows.map((row) => [row.department, Number(row.goal)])) };
  const boardByDept = new Map(boardRows.rows.map((row) => [row.department, row]));
  const latest = boardRows.rows.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))[0];
  const total = workdaysInMonth(today);

  const uph = LABOR_DEPARTMENTS.map((department) => {
    const mine = uphRows.rows.filter((row) => row.department === department);
    const monthEntries = mine.filter((row) => row.work_date >= monthStart && row.work_date < today && isWorkday(row.work_date)).map((row) => Number(row.uph));
    const yesterday = mine.find((row) => row.work_date === lastWorkday);
    return {
      department,
      goal: goals[department] || null,
      yesterday: yesterday ? Math.round(Number(yesterday.uph)) : null,
      month: monthEntries.length ? Math.round(monthEntries.reduce((s, v) => s + v, 0) / monthEntries.length) : null,
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
      return { department, pos: row ? Number(row.pos) : null, units: row ? Number(row.units) : null };
    }),
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
  for (const person of placed) counts[person.today] = (counts[person.today] || 0) + 1;
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
        teammates: placed.filter((person) => person.today === me.today && person.id !== me.id).map((person) => person.name),
        cleaning: cleaning.rows[0] ? { area: cleaning.rows[0].to_department } : null,
      };
    }
  }
  if (result.canEdit) {
    result.roster = placed.map(({ id, name, home, today: dept }) => ({ id, name, home, today: dept }));
    result.departments = (await schedule.departments(db)).filter((d) => d.active).map((d) => d.name);
  }
  return result;
}

const count = (value) => {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(String(value).replace(/,/g, ''));
  if (!Number.isFinite(number) || number < 0 || number > 10000000) throw new Error('Numbers must be zero or more.');
  return Math.round(number);
};

async function save(db, viewer, body) {
  const actor = clean(viewer.name, 100);
  const today = easternToday();
  const lastWorkday = previousWorkday(today);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    if (body.action === 'saveBoard') {
      for (const row of Array.isArray(body.board) ? body.board : []) {
        if (!LABOR_DEPARTMENTS.includes(row?.department)) continue;
        const pos = count(row.pos); const units = count(row.units);
        if (pos === null && units === null) {
          await client.query('DELETE FROM hub_labor_board WHERE work_date=$1 AND department=$2', [today, row.department]);
        } else {
          await client.query(`INSERT INTO hub_labor_board(work_date,department,pos,units,updated_by,updated_at) VALUES($1,$2,$3,$4,$5,NOW())
            ON CONFLICT(work_date,department) DO UPDATE SET pos=EXCLUDED.pos,units=EXCLUDED.units,updated_by=EXCLUDED.updated_by,updated_at=NOW()`,
          [today, row.department, pos || 0, units || 0, actor]);
        }
        const uph = count(row.uph);
        if (uph === null) await client.query('DELETE FROM hub_labor_uph WHERE work_date=$1 AND department=$2', [lastWorkday, row.department]);
        else await client.query(`INSERT INTO hub_labor_uph(work_date,department,uph,updated_by,updated_at) VALUES($1,$2,$3,$4,NOW())
          ON CONFLICT(work_date,department) DO UPDATE SET uph=EXCLUDED.uph,updated_by=EXCLUDED.updated_by,updated_at=NOW()`,
        [lastWorkday, row.department, uph, actor]);
        const goal = count(row.goal);
        if (goal) await client.query(`INSERT INTO hub_labor_goals(department,goal,updated_by,updated_at) VALUES($1,$2,$3,NOW())
          ON CONFLICT(department) DO UPDATE SET goal=EXCLUDED.goal,updated_by=EXCLUDED.updated_by,updated_at=NOW()`,
        [row.department, goal, actor]);
      }
    } else if (body.action === 'saveAssignments') {
      const people = new Map((await schedule.employees(client)).map((person) => [person.id, person]));
      const departments = new Set((await schedule.departments(client)).filter((d) => d.active).map((d) => d.name));
      for (const row of Array.isArray(body.assignments) ? body.assignments : []) {
        const person = people.get(Number(row?.id));
        if (!person || !person.active) continue;
        const department = clean(row.department, 100);
        if (!department || department === person.homeDepartment) {
          await client.query('DELETE FROM hub_labor_assignments WHERE work_date=$1 AND employee_id=$2', [today, person.id]);
        } else {
          if (!departments.has(department)) throw new Error(`${department} isn't an active department.`);
          await client.query(`INSERT INTO hub_labor_assignments(work_date,employee_id,department,updated_by,updated_at) VALUES($1,$2,$3,$4,NOW())
            ON CONFLICT(work_date,employee_id) DO UPDATE SET department=EXCLUDED.department,updated_by=EXCLUDED.updated_by,updated_at=NOW()`,
          [today, person.id, department, actor]);
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

export default async (request) => {
  try {
    const db = getPool();
    await ensureSchema(db);
    await schedule.ensureImported(db);
    const viewer = session(request);
    if (request.method === 'GET') return json(200, await boardState(db, viewer));
    if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });
    if (!viewer) return json(401, { error: 'Sign in to the Hub first.' });
    if (!canEdit(viewer)) return json(403, { error: 'Only Team Leads and Admins can change the labor board.' });
    const body = await request.json().catch(() => ({}));
    await save(db, viewer, body);
    return json(200, { ok: true, ...(await boardState(db, viewer)) });
  } catch (error) {
    return json(400, { error: clean(error?.message || 'The labor board is unavailable right now.', 200) });
  }
};
