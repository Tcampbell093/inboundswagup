'use strict';
// Hub-owned team roster and cleaning schedule (stage 2 of leaving FairShift).
//
// On first use the tables are filled once from FairShift's public dashboard,
// keeping FairShift's IDs so existing check-ins, Bingo Coin keys and PINs stay
// linked. After that the Hub is the only source of truth; FairShift is never
// written to and is no longer read once the import has happened.
//
// dashboard() returns the same shape FairShift's /api/dashboard did, so the
// planner and other callers only had to change where they read from.

const hubCleaning = require('./_hub_cleaning');

const FAIRSHIFT_BASE = 'https://fairshift-rotations.thandoyordani.chatgpt.site';
const ROLES = ['Associate', 'Team Lead', 'Manager'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
let schemaReady = false;
let importChecked = false;

function clean(value, max = 120) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function easternToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function addDays(dateText, days) {
  const date = new Date(`${dateText}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

class ScheduleError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

async function ensureSchema(db) {
  if (schemaReady) return;
  await db.query(`
    CREATE SEQUENCE IF NOT EXISTS hub_sched_employees_seq;
    CREATE TABLE IF NOT EXISTS hub_sched_employees (
      id BIGINT PRIMARY KEY DEFAULT nextval('hub_sched_employees_seq'),
      name TEXT NOT NULL,
      home_department TEXT NOT NULL DEFAULT 'Unassigned',
      role TEXT NOT NULL DEFAULT 'Associate',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TEXT NOT NULL DEFAULT ''
    );
    CREATE UNIQUE INDEX IF NOT EXISTS hub_sched_employees_name_idx ON hub_sched_employees(LOWER(name));

    CREATE SEQUENCE IF NOT EXISTS hub_sched_departments_seq;
    CREATE TABLE IF NOT EXISTS hub_sched_departments (
      id BIGINT PRIMARY KEY DEFAULT nextval('hub_sched_departments_seq'),
      name TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      cleaning_active BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TEXT NOT NULL DEFAULT ''
    );
    CREATE UNIQUE INDEX IF NOT EXISTS hub_sched_departments_name_idx ON hub_sched_departments(LOWER(name));

    CREATE SEQUENCE IF NOT EXISTS hub_sched_assignments_seq;
    CREATE TABLE IF NOT EXISTS hub_sched_assignments (
      id BIGINT PRIMARY KEY DEFAULT nextval('hub_sched_assignments_seq'),
      assignment_date DATE NOT NULL,
      type TEXT NOT NULL DEFAULT 'cleaning',
      employee_id BIGINT NOT NULL,
      alternate_employee_id BIGINT,
      actual_employee_id BIGINT,
      duty_status TEXT NOT NULL DEFAULT 'scheduled',
      home_department TEXT NOT NULL DEFAULT '',
      from_department TEXT NOT NULL DEFAULT '',
      to_department TEXT NOT NULL DEFAULT '',
      start_time TEXT,
      end_time TEXT,
      note TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS hub_sched_assignments_date_idx ON hub_sched_assignments(assignment_date);
    CREATE UNIQUE INDEX IF NOT EXISTS hub_sched_assignments_slot_idx
      ON hub_sched_assignments(assignment_date, LOWER(to_department)) WHERE type='cleaning';

    CREATE SEQUENCE IF NOT EXISTS hub_sched_availability_seq;
    CREATE TABLE IF NOT EXISTS hub_sched_availability (
      id BIGINT PRIMARY KEY DEFAULT nextval('hub_sched_availability_seq'),
      employee_id BIGINT NOT NULL,
      availability_date DATE NOT NULL,
      status TEXT NOT NULL,
      UNIQUE (employee_id, availability_date)
    );

    CREATE TABLE IF NOT EXISTS hub_sched_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      source TEXT NOT NULL,
      counts JSONB NOT NULL DEFAULT '{}'::jsonb
    );
  `);
  schemaReady = true;
}

// ---------------------------------------------------------------------------
// One-time import from FairShift
// ---------------------------------------------------------------------------

async function fetchDashboard(date) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(`${FAIRSHIFT_BASE}/api/dashboard?date=${encodeURIComponent(date)}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`FairShift returned ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

// FairShift only returns a window of assignments around the requested date,
// so ask for several dates and merge by ID to get the full history.
async function fetchFairShiftSnapshot() {
  const today = easternToday();
  const dates = [];
  for (let date = '2026-07-01'; date <= addDays(today, 120); date = addDays(date, 14)) dates.push(date);
  dates.push(today);
  const responses = await Promise.all(dates.map(fetchDashboard));
  const latest = responses[responses.length - 1];
  const assignments = new Map();
  const availability = new Map();
  for (const data of responses) {
    for (const row of Array.isArray(data.assignments) ? data.assignments : []) assignments.set(Number(row.id), row);
    for (const row of Array.isArray(data.availability) ? data.availability : []) availability.set(Number(row.id), row);
  }
  return {
    employees: Array.isArray(latest.employees) ? latest.employees : [],
    departments: Array.isArray(latest.departments) ? latest.departments : [],
    assignments: [...assignments.values()],
    availability: [...availability.values()],
  };
}

async function ensureImported(db, { fetchSnapshot = fetchFairShiftSnapshot } = {}) {
  await ensureSchema(db);
  await hubCleaning.ensureSchema(db);
  if (importChecked) return;
  const done = await db.query('SELECT 1 FROM hub_sched_meta WHERE id=1');
  if (done.rows.length) {
    importChecked = true;
    return;
  }
  const snapshot = await fetchSnapshot();
  if (!snapshot.employees.length) throw new ScheduleError('Could not copy the team list from FairShift. Try again in a minute.', 503);

  const client = typeof db.connect === 'function' ? await db.connect() : db;
  try {
    await client.query('BEGIN');
    // Only one import may run; a second caller waits here and then sees it done.
    await client.query('SELECT pg_advisory_xact_lock(84220201)');
    const again = await client.query('SELECT 1 FROM hub_sched_meta WHERE id=1');
    if (!again.rows.length) {
      // One statement per table (rows passed as JSON) so the copy stays fast.
      const rows = (list) => JSON.stringify(list);
      await client.query(`
        INSERT INTO hub_sched_employees(id,name,home_department,role,active,created_at)
        SELECT id,name,home_department,role,active,created_at
        FROM json_to_recordset($1::json) AS x(id BIGINT,name TEXT,home_department TEXT,role TEXT,active BOOLEAN,created_at TEXT)
        ON CONFLICT DO NOTHING
      `, [rows(snapshot.employees.map((e) => ({
        id: Number(e.id), name: clean(e.name, 100), home_department: clean(e.homeDepartment, 100) || 'Unassigned',
        role: ROLES.includes(e.role) ? e.role : 'Associate', active: e.active !== false, created_at: clean(e.createdAt, 40),
      })))]);
      await client.query(`
        INSERT INTO hub_sched_departments(id,name,active,cleaning_active,created_at)
        SELECT id,name,active,cleaning_active,created_at
        FROM json_to_recordset($1::json) AS x(id BIGINT,name TEXT,active BOOLEAN,cleaning_active BOOLEAN,created_at TEXT)
        ON CONFLICT DO NOTHING
      `, [rows(snapshot.departments.map((d) => ({
        id: Number(d.id), name: clean(d.name, 100), active: d.active !== false,
        cleaning_active: d.cleaningActive === true, created_at: clean(d.createdAt, 40),
      })))]);
      await client.query(`
        INSERT INTO hub_sched_assignments(id,assignment_date,type,employee_id,alternate_employee_id,actual_employee_id,
          duty_status,home_department,from_department,to_department,start_time,end_time,note,created_by,created_at)
        SELECT id,assignment_date,type,employee_id,alternate_employee_id,actual_employee_id,duty_status,home_department,
          from_department,to_department,start_time,end_time,note,created_by,created_at
        FROM json_to_recordset($1::json) AS x(id BIGINT,assignment_date DATE,type TEXT,employee_id BIGINT,
          alternate_employee_id BIGINT,actual_employee_id BIGINT,duty_status TEXT,home_department TEXT,from_department TEXT,
          to_department TEXT,start_time TEXT,end_time TEXT,note TEXT,created_by TEXT,created_at TEXT)
        ON CONFLICT DO NOTHING
      `, [rows(snapshot.assignments.filter((a) => DATE.test(String(a.assignmentDate || ''))).map((a) => ({
        id: Number(a.id), assignment_date: a.assignmentDate, type: clean(a.type, 30) || 'cleaning',
        employee_id: Number(a.employeeId), alternate_employee_id: Number(a.alternateEmployeeId) || null,
        actual_employee_id: Number(a.actualEmployeeId) || null, duty_status: clean(a.dutyStatus, 40) || 'scheduled',
        home_department: clean(a.homeDepartment, 100), from_department: clean(a.fromDepartment, 100),
        to_department: clean(a.toDepartment, 100), start_time: a.startTime || null, end_time: a.endTime || null,
        note: clean(a.note, 500), created_by: clean(a.createdBy, 120), created_at: clean(a.createdAt, 40),
      })))]);
      await client.query(`
        INSERT INTO hub_sched_availability(id,employee_id,availability_date,status)
        SELECT id,employee_id,availability_date,status
        FROM json_to_recordset($1::json) AS x(id BIGINT,employee_id BIGINT,availability_date DATE,status TEXT)
        ON CONFLICT DO NOTHING
      `, [rows(snapshot.availability.filter((v) => DATE.test(String(v.availabilityDate || ''))).map((v) => ({
        id: Number(v.id), employee_id: Number(v.employeeId), availability_date: v.availabilityDate,
        status: clean(v.status, 20) || 'unavailable',
      })))]);
      for (const table of ['employees', 'departments', 'assignments', 'availability']) {
        await client.query(`SELECT setval('hub_sched_${table}_seq', GREATEST((SELECT COALESCE(MAX(id),0) FROM hub_sched_${table}),1))`);
      }
      await client.query(`INSERT INTO hub_sched_meta(id,source,counts) VALUES(1,'FairShift',$1::jsonb)`, [JSON.stringify({
        employees: snapshot.employees.length,
        departments: snapshot.departments.length,
        assignments: snapshot.assignments.length,
        availability: snapshot.availability.length,
      })]);
    }
    await client.query('COMMIT');
    importChecked = true;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    if (client !== db) client.release();
  }
}

// ---------------------------------------------------------------------------
// Reads (FairShift-compatible shapes)
// ---------------------------------------------------------------------------

const ASSIGNMENT_COLUMNS = `a.id,to_char(a.assignment_date,'YYYY-MM-DD') AS assignment_date,a.type,a.employee_id,
  a.alternate_employee_id,a.actual_employee_id,a.duty_status,a.home_department,a.from_department,a.to_department,
  a.start_time,a.end_time,a.note,a.created_by,a.created_at,e.name AS employee_name`;

function assignmentOut(row) {
  return {
    id: Number(row.id),
    assignmentDate: row.assignment_date,
    employeeId: Number(row.employee_id),
    alternateEmployeeId: row.alternate_employee_id == null ? null : Number(row.alternate_employee_id),
    actualEmployeeId: row.actual_employee_id == null ? null : Number(row.actual_employee_id),
    dutyStatus: row.duty_status,
    employeeName: row.employee_name || '',
    homeDepartment: row.home_department,
    type: row.type,
    fromDepartment: row.from_department,
    toDepartment: row.to_department,
    startTime: row.start_time,
    endTime: row.end_time,
    note: row.note,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

async function employees(db) {
  const r = await db.query('SELECT id,name,home_department,role,active,created_at FROM hub_sched_employees ORDER BY id');
  return r.rows.map((e) => ({
    id: Number(e.id), name: e.name, homeDepartment: e.home_department, role: e.role, active: e.active, createdAt: e.created_at,
  }));
}

async function departments(db) {
  const r = await db.query('SELECT id,name,active,cleaning_active,created_at FROM hub_sched_departments ORDER BY id');
  return r.rows.map((d) => ({
    id: Number(d.id), name: d.name, active: d.active, cleaningActive: d.cleaning_active, createdAt: d.created_at,
  }));
}

// Everything from `days` before `date` onward (the planner shows 90 days of history).
async function dashboard(db, { date = easternToday(), days = 120 } = {}) {
  await ensureImported(db);
  const since = addDays(DATE.test(date) ? date : easternToday(), -days);
  const [emp, dept, asg, avail] = await Promise.all([
    employees(db),
    departments(db),
    db.query(`SELECT ${ASSIGNMENT_COLUMNS} FROM hub_sched_assignments a
      LEFT JOIN hub_sched_employees e ON e.id=a.employee_id
      WHERE a.assignment_date >= $1 ORDER BY a.assignment_date DESC, a.id DESC`, [since]),
    db.query(`SELECT id,employee_id,to_char(availability_date,'YYYY-MM-DD') AS availability_date,status
      FROM hub_sched_availability WHERE availability_date >= $1 ORDER BY availability_date, id`, [since]),
  ]);
  return {
    employees: emp,
    departments: dept,
    assignments: asg.rows.map(assignmentOut),
    availability: avail.rows.map((v) => ({
      id: Number(v.id), employeeId: Number(v.employee_id), availabilityDate: v.availability_date, status: v.status,
    })),
  };
}

// One cleaning assignment as the check-in page sees it (the old FairShift
// /api/checkin shape), or null if it doesn't exist.
async function checkinAssignment(db, assignmentId) {
  await ensureImported(db);
  const r = await db.query(`SELECT ${ASSIGNMENT_COLUMNS}, act.name AS active_name
    FROM hub_sched_assignments a
    LEFT JOIN hub_sched_employees e ON e.id=a.employee_id
    LEFT JOIN hub_sched_employees act ON act.id=COALESCE(a.actual_employee_id,a.employee_id)
    WHERE a.id=$1 AND a.type='cleaning'`, [Number(assignmentId)]);
  const row = r.rows[0];
  if (!row) return null;
  const activeId = Number(row.actual_employee_id || row.employee_id);
  return {
    id: Number(row.id),
    assignmentDate: row.assignment_date,
    area: row.to_department,
    scheduledEmployeeName: row.employee_name || '',
    activeEmployeeId: activeId,
    activeEmployeeName: row.active_name || '',
    covered: !!row.actual_employee_id && Number(row.actual_employee_id) !== Number(row.employee_id),
    dutyStatus: row.duty_status,
    startTime: row.start_time,
    endTime: row.end_time,
  };
}

// Active people for Hub sign-in.
async function roster(db) {
  await ensureImported(db);
  return (await employees(db)).filter((e) => e.active);
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

async function inTransaction(db, work) {
  const client = typeof db.connect === 'function' ? await db.connect() : db;
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error?.code === '23505') throw new ScheduleError('That would create a duplicate. Refresh and try again.', 409);
    throw error;
  } finally {
    if (client !== db) client.release();
  }
}

async function activeEmployee(db, id, label = 'cleaner') {
  const r = await db.query('SELECT id,name,home_department FROM hub_sched_employees WHERE id=$1 AND active=TRUE', [Number(id)]);
  if (!r.rows[0]) throw new ScheduleError(`Choose an active ${label}.`);
  return r.rows[0];
}

async function cleaningArea(db, name) {
  const r = await db.query(
    'SELECT name FROM hub_sched_departments WHERE LOWER(name)=LOWER($1) AND active=TRUE AND cleaning_active=TRUE',
    [clean(name, 100)],
  );
  if (!r.rows[0]) throw new ScheduleError(`${clean(name, 100) || 'That area'} is not an active cleaning area.`);
  return r.rows[0].name;
}

// Create or replace the cleaner for one area on one day. employeeId 0 removes it.
async function setSlot(db, { employeeId, alternateEmployeeId, assignmentDate, department }, actor) {
  const area = await cleaningArea(db, department);
  const existing = await db.query(
    `SELECT id,duty_status FROM hub_sched_assignments
     WHERE type='cleaning' AND assignment_date=$1 AND LOWER(to_department)=LOWER($2) FOR UPDATE`,
    [assignmentDate, area],
  );
  const current = existing.rows[0];
  if (current && (['completed', 'in_progress'].includes(current.duty_status) || await startedInHub(db, current.id))) {
    throw new ScheduleError('Completed or started cleaning records are protected.', 409);
  }
  if (!Number(employeeId)) {
    if (current) await db.query('DELETE FROM hub_sched_assignments WHERE id=$1', [current.id]);
    return;
  }
  const person = await activeEmployee(db, employeeId);
  const alternate = Number(alternateEmployeeId) || null;
  if (alternate) {
    if (alternate === Number(person.id)) throw new ScheduleError('The backup must be a different person.');
    await activeEmployee(db, alternate, 'backup');
  }
  if (current) {
    await db.query(`UPDATE hub_sched_assignments
      SET employee_id=$2,alternate_employee_id=$3,actual_employee_id=NULL,duty_status='scheduled',
          home_department=$4,from_department=$4,created_by=$5,created_at=$6
      WHERE id=$1`, [current.id, person.id, alternate, person.home_department, clean(actor, 120), new Date().toISOString()]);
  } else {
    await db.query(`INSERT INTO hub_sched_assignments(assignment_date,type,employee_id,alternate_employee_id,duty_status,
        home_department,from_department,to_department,created_by,created_at)
      VALUES($1,'cleaning',$2,$3,'scheduled',$4,$4,$5,$6,$7)`,
    [assignmentDate, person.id, alternate, person.home_department, area, clean(actor, 120), new Date().toISOString()]);
  }
}

// Start/finish are recorded in hub_cleaning_checkins, not on the assignment row.
async function startedInHub(db, assignmentId) {
  const r = await db.query('SELECT 1 FROM hub_cleaning_checkins WHERE assignment_id=$1', [Number(assignmentId)]);
  return r.rows.length > 0;
}

async function setAvailability(db, employeeId, date, status) {
  await db.query(`INSERT INTO hub_sched_availability(employee_id,availability_date,status) VALUES($1,$2,$3)
    ON CONFLICT(employee_id,availability_date) DO UPDATE SET status=EXCLUDED.status`, [Number(employeeId), date, status]);
}

// Schedule actions the Cleaning Planner sends (payload already validated by hub-rotations).
async function applyScheduleAction(db, payload, actor) {
  await ensureImported(db);
  return inTransaction(db, async (tx) => {
    const action = payload.action;
    if (action === 'acceptCleaningSuggestions') {
      for (const entry of payload.entries) await setSlot(tx, entry, actor);
    } else if (action === 'setCleaningSchedule') {
      await setSlot(tx, payload, actor);
    } else if (action === 'setAvailability') {
      await activeEmployee(tx, payload.employeeId, 'person');
      await setAvailability(tx, payload.employeeId, payload.availabilityDate, payload.status);
    } else if (action === 'setAvailabilityRange') {
      await activeEmployee(tx, payload.employeeId, 'person');
      const days = (Date.parse(payload.endDate) - Date.parse(payload.startDate)) / 86400000;
      if (days > 366) throw new ScheduleError('Choose a range of one year or less.');
      for (let date = payload.startDate; date <= payload.endDate; date = addDays(date, 1)) {
        await setAvailability(tx, payload.employeeId, date, payload.status);
      }
    } else if (action === 'markCleaningAbsent' || action === 'useCleaningAlternate') {
      const r = await tx.query(`SELECT id,to_char(assignment_date,'YYYY-MM-DD') AS assignment_date,employee_id,
          alternate_employee_id,duty_status FROM hub_sched_assignments WHERE id=$1 AND type='cleaning' FOR UPDATE`,
      [payload.assignmentId]);
      const duty = r.rows[0];
      if (!duty) throw new ScheduleError('This cleaning assignment no longer exists.', 404);
      if (['completed', 'in_progress'].includes(duty.duty_status) || await startedInHub(tx, duty.id)) {
        throw new ScheduleError('Cleaning has already started or finished.', 409);
      }
      if (action === 'markCleaningAbsent') {
        await setAvailability(tx, duty.employee_id, duty.assignment_date, 'unavailable');
      } else if (!duty.alternate_employee_id) {
        throw new ScheduleError('This duty has no backup selected.');
      }
      if (duty.alternate_employee_id) {
        // The backup takes over and gets the credit when they finish.
        await tx.query(`UPDATE hub_sched_assignments SET actual_employee_id=alternate_employee_id,
          duty_status='alternate_assigned' WHERE id=$1`, [duty.id]);
      } else {
        // No backup: free the slot so it shows as unassigned and can be filled.
        await tx.query('DELETE FROM hub_sched_assignments WHERE id=$1', [duty.id]);
      }
    } else if (action === 'clearCleaningScheduleDays') {
      await tx.query(`DELETE FROM hub_sched_assignments
        WHERE type='cleaning' AND assignment_date = ANY($1::date[]) AND duty_status NOT IN ('completed','in_progress')
          AND id NOT IN (SELECT assignment_id FROM hub_cleaning_checkins)`,
      [payload.dates]);
    } else {
      throw new ScheduleError('Unsupported cleaning action.');
    }
    return { ok: true };
  });
}

// Roster and department actions from Admin tools (Team & areas).
async function applyTeamAction(db, payload) {
  await ensureImported(db);
  return inTransaction(db, async (tx) => {
    const action = payload.action;
    const name = clean(payload.name, 100);
    const departmentExists = async (dept) => {
      const r = await tx.query('SELECT name FROM hub_sched_departments WHERE LOWER(name)=LOWER($1) AND active=TRUE', [clean(dept, 100)]);
      if (!r.rows[0]) throw new ScheduleError('Choose an existing department.');
      return r.rows[0].name;
    };
    if (action === 'addEmployee') {
      if (!name) throw new ScheduleError('Enter a name.');
      const homeDepartment = await departmentExists(payload.homeDepartment);
      const r = await tx.query(`INSERT INTO hub_sched_employees(name,home_department,role,active,created_at)
        VALUES($1,$2,$3,TRUE,$4) RETURNING id`, [name, homeDepartment, payload.role, new Date().toISOString()]);
      return { ok: true, id: Number(r.rows[0].id) };
    }
    if (action === 'updateEmployee') {
      const id = Number(payload.id);
      if (!name) throw new ScheduleError('Enter a name.');
      const homeDepartment = await departmentExists(payload.homeDepartment);
      const r = await tx.query(`UPDATE hub_sched_employees SET name=$2,home_department=$3,role=$4,active=$5 WHERE id=$1`,
        [id, name, homeDepartment, payload.role, payload.active !== false]);
      if (!r.rowCount) throw new ScheduleError('That team member no longer exists.', 404);
      return { ok: true };
    }
    if (action === 'addDepartment') {
      if (!name) throw new ScheduleError('Enter a department name.');
      const removed = await tx.query(
        'UPDATE hub_sched_departments SET active=TRUE WHERE LOWER(name)=LOWER($1) AND active=FALSE RETURNING id', [name]);
      if (removed.rows[0]) return { ok: true, id: Number(removed.rows[0].id) };
      const r = await tx.query(`INSERT INTO hub_sched_departments(name,active,cleaning_active,created_at)
        VALUES($1,TRUE,FALSE,$2) RETURNING id`, [name, new Date().toISOString()]);
      return { ok: true, id: Number(r.rows[0].id) };
    }
    if (action === 'updateDepartment') {
      if (!name) throw new ScheduleError('Enter a department name.');
      const r = await tx.query('SELECT name FROM hub_sched_departments WHERE id=$1 FOR UPDATE', [Number(payload.id)]);
      if (!r.rows[0]) throw new ScheduleError('That department no longer exists.', 404);
      const oldName = r.rows[0].name;
      await tx.query('UPDATE hub_sched_departments SET name=$2 WHERE id=$1', [Number(payload.id), name]);
      if (oldName !== name) {
        // Names are stored on people and assignments, so carry a rename through.
        await tx.query('UPDATE hub_sched_employees SET home_department=$2 WHERE LOWER(home_department)=LOWER($1)', [oldName, name]);
        for (const column of ['home_department', 'from_department', 'to_department']) {
          await tx.query(`UPDATE hub_sched_assignments SET ${column}=$2 WHERE LOWER(${column})=LOWER($1)`, [oldName, name]);
        }
      }
      return { ok: true };
    }
    if (action === 'setCleaningDepartment') {
      const r = await tx.query('UPDATE hub_sched_departments SET cleaning_active=$2 WHERE id=$1',
        [Number(payload.id), payload.cleaningActive === true]);
      if (!r.rowCount) throw new ScheduleError('That department no longer exists.', 404);
      return { ok: true };
    }
    if (action === 'removeDepartment') {
      const r = await tx.query('SELECT name FROM hub_sched_departments WHERE id=$1 FOR UPDATE', [Number(payload.id)]);
      if (!r.rows[0]) throw new ScheduleError('That department no longer exists.', 404);
      const people = await tx.query(
        'SELECT COUNT(*)::int AS n FROM hub_sched_employees WHERE active=TRUE AND LOWER(home_department)=LOWER($1)',
        [r.rows[0].name],
      );
      if (people.rows[0].n) throw new ScheduleError('Move the team members out of this department before removing it.', 409);
      // Kept (inactive) so past assignments still show the area name.
      await tx.query('UPDATE hub_sched_departments SET active=FALSE,cleaning_active=FALSE WHERE id=$1', [Number(payload.id)]);
      return { ok: true };
    }
    throw new ScheduleError('Unsupported team-management action.');
  });
}

module.exports = {
  ROLES,
  ScheduleError,
  ensureSchema,
  ensureImported,
  fetchFairShiftSnapshot,
  dashboard,
  checkinAssignment,
  roster,
  employees,
  departments,
  applyScheduleAction,
  applyTeamAction,
};
