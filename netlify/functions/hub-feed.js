const { Pool } = require('pg');
const crypto = require('crypto');

const FAIRSHIFT_BASE = 'https://fairshift-rotations.thandoyordani.chatgpt.site';
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : undefined,
});

let schemaReady = false;

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) };
}
function text(value, max = 500) { return String(value == null ? '' : value).trim().slice(0, max); }
function validDate(value) { const s = text(value, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ''; }
function safeEqual(a, b) { if (!a || !b) return false; const aa = Buffer.from(String(a)), bb = Buffer.from(String(b)); return aa.length === bb.length && crypto.timingSafeEqual(aa, bb); }
function managerAuthorized(event) { return safeEqual(event.headers?.['x-hub-key'] || event.headers?.['X-Hub-Key'] || '', process.env.HUB_MANAGER_KEY || ''); }
function slug(value) { return text(value, 100).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80); }
function hashPin(pin) { return crypto.createHash('sha256').update(`${process.env.HUB_PIN_SALT || ''}:${pin}`).digest('hex'); }

async function ensureSchema() {
  if (schemaReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hub_announcements (
      id TEXT PRIMARY KEY,title TEXT NOT NULL,message TEXT NOT NULL,start_date DATE NOT NULL,end_date DATE,
      department TEXT NOT NULL DEFAULT 'All teams',pinned BOOLEAN NOT NULL DEFAULT FALSE,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS hub_policies (
      id TEXT PRIMARY KEY,title TEXT NOT NULL,summary TEXT NOT NULL,effective_date DATE NOT NULL,
      read_required BOOLEAN NOT NULL DEFAULT FALSE,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS hub_cleaning_assignments (
      id TEXT PRIMARY KEY,work_date DATE NOT NULL,area TEXT NOT NULL,task TEXT,employee_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'scheduled',started_at TIMESTAMPTZ,finished_at TIMESTAMPTZ,completed_by TEXT,
      credit_minutes INTEGER NOT NULL DEFAULT 0,source TEXT NOT NULL DEFAULT 'hub',updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS hub_cleaning_work_date_idx ON hub_cleaning_assignments(work_date);
    CREATE TABLE IF NOT EXISTS hub_employee_pins (
      employee_key TEXT PRIMARY KEY,employee_name TEXT NOT NULL,department TEXT,pin_hash TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  schemaReady = true;
}

function todayEastern() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}
function dateValue(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.slice(0, 10);
  if (value instanceof Date && !Number.isNaN(value.getTime())) return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
  return String(value).slice(0, 10);
}
function normalizeLocalCleaning(row) {
  let status = row.status || 'scheduled';
  const workDate = dateValue(row.work_date);
  if (!['completed', 'reported_not_done'].includes(status) && workDate && workDate < todayEastern()) status = 'missed';
  return { id: row.id, date: workDate, area: row.area, task: row.task || '', employeeName: row.employee_name, status, startedAt: row.started_at || null, finishedAt: row.finished_at || null, completedBy: row.completed_by || null, creditMinutes: Number(row.credit_minutes || 0), source: row.source || 'hub', updatedAt: row.updated_at || null };
}
function fairShiftStatus(value) {
  if (value === 'completed') return 'completed';
  if (value === 'in_progress') return 'in_progress';
  if (value === 'missed') return 'missed';
  return 'scheduled';
}

async function fetchFairShiftCleaning() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${FAIRSHIFT_BASE}/api/dashboard?date=${todayEastern()}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`FairShift returned ${response.status}`);
    const data = await response.json();
    const employeeMap = new Map((Array.isArray(data.employees) ? data.employees : []).map(e => [Number(e.id), e.name]));
    const cleaning = (Array.isArray(data.assignments) ? data.assignments : [])
      .filter(a => a && a.type === 'cleaning')
      .map(a => {
        const fairshiftId = Number(a.id);
        const scheduledName = a.employeeName || employeeMap.get(Number(a.employeeId)) || 'Unassigned';
        const actualName = a.actualEmployeeId ? employeeMap.get(Number(a.actualEmployeeId)) : null;
        const employeeName = actualName || scheduledName;
        const covered = Boolean(a.actualEmployeeId && Number(a.actualEmployeeId) !== Number(a.employeeId));
        const status = fairShiftStatus(a.dutyStatus);
        return {
          id: `fairshift-${fairshiftId}`,
          fairshiftId,
          date: String(a.assignmentDate || '').slice(0, 10),
          area: a.toDepartment || a.homeDepartment || 'Cleaning',
          task: covered ? `Covering for ${scheduledName}` : (a.note || 'Weekly cleaning duty'),
          employeeName,
          scheduledEmployeeName: scheduledName,
          covered,
          status,
          startedAt: status === 'in_progress' ? (a.startTime || null) : null,
          finishedAt: status === 'completed' ? (a.endTime || null) : null,
          completedBy: status === 'completed' ? employeeName : null,
          creditMinutes: status === 'completed' ? 15 : 0,
          source: 'fairshift',
          checkinUrl: `/warehouse-hub/checkin.html?assignment=${encodeURIComponent(fairshiftId)}`,
          updatedAt: a.createdAt || null,
        };
      });
    return { ok: true, cleaning, error: null };
  } catch (error) {
    return { ok: false, cleaning: [], error: text(error?.message || 'FairShift unavailable', 200) };
  } finally {
    clearTimeout(timeout);
  }
}

async function readFeed(includeAdmin = false) {
  const [a, p, c, fs] = await Promise.all([
    pool.query(`SELECT id,title,message,start_date,end_date,department,pinned,updated_at FROM hub_announcements ORDER BY pinned DESC,start_date DESC,updated_at DESC`),
    pool.query(`SELECT id,title,summary,effective_date,read_required,updated_at FROM hub_policies ORDER BY effective_date DESC,updated_at DESC`),
    pool.query(`SELECT * FROM hub_cleaning_assignments ORDER BY work_date,area,employee_name`),
    fetchFairShiftCleaning(),
  ]);
  const manualCleaning = c.rows.map(normalizeLocalCleaning);
  const result = {
    announcements: a.rows.map(r => ({ id: r.id, title: r.title, message: r.message, startDate: dateValue(r.start_date), endDate: r.end_date ? dateValue(r.end_date) : '', department: r.department, pinned: !!r.pinned, updatedAt: r.updated_at })),
    policies: p.rows.map(r => ({ id: r.id, title: r.title, summary: r.summary, effectiveDate: dateValue(r.effective_date), readRequired: !!r.read_required, updatedAt: r.updated_at })),
    cleaning: fs.ok ? fs.cleaning : manualCleaning,
    cleaningSource: fs.ok ? 'fairshift' : 'hub-fallback',
    fairshiftConnected: !!fs.ok,
    generatedAt: new Date().toISOString(),
  };
  if (includeAdmin) {
    const e = await pool.query(`SELECT employee_name,department,active FROM hub_employee_pins ORDER BY employee_name`);
    result.employees = e.rows.map(r => ({ name: r.employee_name, department: r.department || '', active: !!r.active }));
    result.manualCleaning = manualCleaning;
    result.fairshiftError = fs.ok ? null : fs.error;
  }
  return result;
}

async function upsertAnnouncement(body) {
  const title = text(body.title, 120), message = text(body.message, 1200), startDate = validDate(body.startDate), endDate = validDate(body.endDate);
  if (!title || !message || !startDate) throw new Error('Title, message, and start date are required.');
  const id = text(body.id, 80) || crypto.randomUUID();
  await pool.query(`INSERT INTO hub_announcements(id,title,message,start_date,end_date,department,pinned,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,NOW()) ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,message=EXCLUDED.message,start_date=EXCLUDED.start_date,end_date=EXCLUDED.end_date,department=EXCLUDED.department,pinned=EXCLUDED.pinned,updated_at=NOW()`, [id, title, message, startDate, endDate || null, text(body.department, 80) || 'All teams', !!body.pinned]);
  return { id };
}
async function upsertPolicy(body) {
  const title = text(body.title, 140), summary = text(body.summary, 1600), effectiveDate = validDate(body.effectiveDate);
  if (!title || !summary || !effectiveDate) throw new Error('Title, summary, and effective date are required.');
  const id = text(body.id, 80) || crypto.randomUUID();
  await pool.query(`INSERT INTO hub_policies(id,title,summary,effective_date,read_required,updated_at) VALUES($1,$2,$3,$4,$5,NOW()) ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,summary=EXCLUDED.summary,effective_date=EXCLUDED.effective_date,read_required=EXCLUDED.read_required,updated_at=NOW()`, [id, title, summary, effectiveDate, !!body.readRequired]);
  return { id };
}
async function deleteRecord(body) {
  const kind = text(body.kind, 30), id = text(body.id, 80);
  if (kind === 'announcement' && id) return pool.query(`DELETE FROM hub_announcements WHERE id=$1`, [id]);
  if (kind === 'policy' && id) return pool.query(`DELETE FROM hub_policies WHERE id=$1`, [id]);
  if (kind === 'cleaning' && id) return pool.query(`DELETE FROM hub_cleaning_assignments WHERE id=$1`, [id]);
  if (kind === 'employee' && body.name) return pool.query(`DELETE FROM hub_employee_pins WHERE employee_key=$1`, [slug(body.name)]);
  throw new Error('Unsupported delete request.');
}
async function cleaningAction(body) {
  if (!process.env.HUB_PIN_SALT) throw new Error('HUB_PIN_SALT is not configured.');
  const assignmentId = text(body.assignmentId, 80), employeeName = text(body.employeeName, 100), pin = text(body.pin, 12), action = text(body.cleaningAction, 20);
  if (!assignmentId || !employeeName || !pin || !['start', 'finish'].includes(action)) throw new Error('Incomplete cleaning check-in request.');
  const employee = await pool.query(`SELECT employee_name,pin_hash,active FROM hub_employee_pins WHERE employee_key=$1 LIMIT 1`, [slug(employeeName)]);
  const e = employee.rows[0];
  if (!e || !e.active || !safeEqual(e.pin_hash, hashPin(pin))) throw new Error('Name or PIN is incorrect.');
  const assignment = await pool.query(`SELECT * FROM hub_cleaning_assignments WHERE id=$1 LIMIT 1`, [assignmentId]);
  const row = assignment.rows[0];
  if (!row) throw new Error('Cleaning assignment not found.');
  const workDate = dateValue(row.work_date);
  if (workDate !== todayEastern()) throw new Error('Cleaning can only be checked in for today.');
  if (String(row.employee_name).toLowerCase() !== employeeName.toLowerCase()) throw new Error('This assignment is scheduled to another employee.');
  if (action === 'start') {
    if (row.status !== 'scheduled') throw new Error('This assignment has already been started or closed.');
    await pool.query(`UPDATE hub_cleaning_assignments SET status='in_progress',started_at=NOW(),updated_at=NOW() WHERE id=$1`, [assignmentId]);
  } else {
    if (row.status !== 'in_progress') throw new Error('Start the cleaning assignment before finishing it.');
    await pool.query(`UPDATE hub_cleaning_assignments SET status='completed',finished_at=NOW(),completed_by=$2,credit_minutes=15,updated_at=NOW() WHERE id=$1`, [assignmentId, employeeName]);
  }
  const updated = await pool.query(`SELECT * FROM hub_cleaning_assignments WHERE id=$1`, [assignmentId]);
  return normalizeLocalCleaning(updated.rows[0]);
}

exports.handler = async function handler(event) {
  if (!process.env.DATABASE_URL) return json(500, { error: 'DATABASE_URL is not configured' });
  try {
    await ensureSchema();
    if (event.httpMethod === 'GET') {
      const admin = String(event.queryStringParameters?.admin || '') === '1';
      if (admin && !managerAuthorized(event)) return json(401, { error: 'Manager access denied.' });
      return json(200, await readFeed(admin));
    }
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
    const body = JSON.parse(event.body || '{}');
    if (body.action === 'cleaningAction') return json(200, { ok: true, result: await cleaningAction(body) });
    if (!managerAuthorized(event)) return json(401, { error: 'Manager access denied.' });
    let result = null;
    if (body.action === 'upsertAnnouncement') result = await upsertAnnouncement(body);
    else if (body.action === 'upsertPolicy') result = await upsertPolicy(body);
    else if (body.action === 'deleteAnnouncement') { body.kind = 'announcement'; await deleteRecord(body); }
    else if (body.action === 'deletePolicy') { body.kind = 'policy'; await deleteRecord(body); }
    else return json(400, { error: 'Unsupported action.' });
    return json(200, { ok: true, result });
  } catch (error) {
    return json(400, { error: text(error?.message || 'Unexpected error.', 300) });
  }
};
