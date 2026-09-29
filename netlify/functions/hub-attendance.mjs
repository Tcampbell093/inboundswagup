import pg from 'pg';
import crypto from 'node:crypto';

const { Pool } = pg;
let poolInstance = null;
let schemaReady = false;

const SESSION_COOKIE = 'hub_associate_session';
const SESSION_VERSION = 2;

const DEFAULT_STATUSES = [
  { id: 'present', label: 'Present', points: 0, tone: 'good' },
  { id: 'late-under-4', label: 'Late < 4hrs', points: 0.5, tone: 'warn' },
  { id: 'late-over-4', label: 'Late > 4hrs', points: 1, tone: 'warn' },
  { id: 'early-under-4', label: 'Early Departure < 4hrs', points: 0.5, tone: 'warn' },
  { id: 'early-over-4', label: 'Early Departure > 4hrs', points: 1, tone: 'warn' },
  { id: 'call-out', label: 'Call Out', points: 2, tone: 'bad' },
  { id: 'ncns', label: 'NCNS', points: 3, tone: 'bad' },
  { id: 'excused', label: 'Excused Absence', points: 0, tone: 'neutral' },
  { id: 'sick', label: 'Sick Time', points: 0, tone: 'neutral' },
  { id: 'pto', label: 'PTO', points: 0, tone: 'neutral' },
  { id: 'maternity', label: 'Maternity', points: 0, tone: 'neutral' },
  { id: 'streak', label: '30 Day Streak', points: -1, tone: 'good' },
];

const DEFAULT_THRESHOLDS = [
  { id: 'verbal', label: 'Verbal Warning', points: 5 },
  { id: 'written', label: 'Written Warning', points: 7 },
  { id: 'termination-review', label: 'Termination Review', points: 12 },
];

function env(name) {
  return globalThis.Netlify?.env?.get(name) || '';
}

function getPool() {
  const connectionString = env('DATABASE_URL');
  if (!connectionString) throw new Error('DATABASE_URL is not configured');
  if (!poolInstance) poolInstance = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  return poolInstance;
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function clean(value, max = 500) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function slug(value) {
  return clean(value, 140).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 120);
}

function cookieMap(request) {
  const raw = request.headers.get('cookie') || '';
  return Object.fromEntries(raw.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf('=');
    return index === -1 ? [part, ''] : [part.slice(0, index), part.slice(index + 1)];
  }));
}

function hubSession(request) {
  try {
    const secret = env('HUB_ASSOCIATE_SESSION_SECRET');
    const token = cookieMap(request)[SESSION_COOKIE];
    if (!secret || !token) return null;
    const key = crypto.createHash('sha256').update(secret).digest();
    const [ivText, tagText, dataText] = String(token).split('.');
    if (!ivText || !tagText || !dataText) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivText, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(dataText, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
    const payload = JSON.parse(plain);
    if (payload?.v !== SESSION_VERSION || !payload?.name || Number(payload.exp || 0) <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function managerSession(request) {
  const session = hubSession(request);
  if (!session || String(session.role || '').toLowerCase() !== 'manager') return null;
  return session;
}

function validDate(value) {
  const raw = clean(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
}

async function ensureSchema() {
  if (schemaReady) return;
  const db = getPool();
  await db.query(`
    CREATE TABLE IF NOT EXISTS hub_attendance_settings (
      settings_key TEXT PRIMARY KEY,
      statuses_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      thresholds_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS hub_attendance_records (
      id UUID PRIMARY KEY,
      employee_key TEXT NOT NULL,
      employee_name TEXT NOT NULL,
      department TEXT NOT NULL,
      attendance_date DATE NOT NULL,
      status_id TEXT NOT NULL,
      status_label TEXT NOT NULL,
      points NUMERIC(8,2) NOT NULL DEFAULT 0,
      note TEXT NOT NULL DEFAULT '',
      recorded_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(employee_key, attendance_date)
    );
    CREATE INDEX IF NOT EXISTS hub_attendance_records_date_idx ON hub_attendance_records(attendance_date DESC);
    CREATE INDEX IF NOT EXISTS hub_attendance_records_employee_idx ON hub_attendance_records(employee_key, attendance_date DESC);

    CREATE TABLE IF NOT EXISTS hub_attendance_audit (
      id BIGSERIAL PRIMARY KEY,
      employee_key TEXT NOT NULL,
      employee_name TEXT NOT NULL,
      attendance_date DATE NOT NULL,
      previous_status TEXT NOT NULL DEFAULT '',
      new_status TEXT NOT NULL DEFAULT '',
      previous_points NUMERIC(8,2) NOT NULL DEFAULT 0,
      new_points NUMERIC(8,2) NOT NULL DEFAULT 0,
      actor TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS hub_attendance_audit_employee_idx ON hub_attendance_audit(employee_key, created_at DESC);
  `);
  await db.query(`
    INSERT INTO hub_attendance_settings(settings_key,statuses_json,thresholds_json,updated_by)
    VALUES('default',$1::jsonb,$2::jsonb,'System')
    ON CONFLICT(settings_key) DO NOTHING
  `, [JSON.stringify(DEFAULT_STATUSES), JSON.stringify(DEFAULT_THRESHOLDS)]);
  schemaReady = true;
}

function sanitizeStatuses(value) {
  const rows = Array.isArray(value) ? value : [];
  const out = [];
  const seen = new Set();
  for (const row of rows.slice(0, 40)) {
    const label = clean(row?.label, 100);
    if (!label) continue;
    const id = slug(row?.id || label);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const points = Number(row?.points);
    out.push({
      id,
      label,
      points: Number.isFinite(points) ? Math.max(-10, Math.min(20, Math.round(points * 100) / 100)) : 0,
      tone: ['good','warn','bad','neutral'].includes(row?.tone) ? row.tone : 'neutral',
    });
  }
  return out.length ? out : DEFAULT_STATUSES;
}

function sanitizeThresholds(value) {
  const rows = Array.isArray(value) ? value : [];
  const out = [];
  const seen = new Set();
  for (const row of rows.slice(0, 10)) {
    const label = clean(row?.label, 100);
    if (!label) continue;
    const id = slug(row?.id || label);
    const points = Number(row?.points);
    if (!id || seen.has(id) || !Number.isFinite(points)) continue;
    seen.add(id);
    out.push({ id, label, points: Math.max(0, Math.round(points * 100) / 100) });
  }
  out.sort((a,b) => a.points - b.points);
  return out.length ? out : DEFAULT_THRESHOLDS;
}

async function readSettings(db) {
  const result = await db.query(`
    SELECT statuses_json,thresholds_json,updated_at,updated_by
    FROM hub_attendance_settings WHERE settings_key='default' LIMIT 1
  `);
  const row = result.rows[0] || {};
  return {
    statuses: sanitizeStatuses(row.statuses_json),
    thresholds: sanitizeThresholds(row.thresholds_json),
    updatedAt: row.updated_at || null,
    updatedBy: row.updated_by || '',
  };
}

async function snapshot(db, date) {
  const settings = await readSettings(db);
  const day = await db.query(`
    SELECT id,employee_key,employee_name,department,to_char(attendance_date,'YYYY-MM-DD') AS attendance_date,
           status_id,status_label,points,note,recorded_by,created_at,updated_at
    FROM hub_attendance_records
    WHERE attendance_date=$1::date
    ORDER BY department,employee_name
  `, [date]);
  const totals = await db.query(`
    SELECT employee_key,
           MAX(employee_name) AS employee_name,
           GREATEST(0, ROUND(SUM(points)::numeric,2)) AS total_points,
           MAX(attendance_date) AS last_record_date
    FROM hub_attendance_records
    GROUP BY employee_key
  `);
  return {
    date,
    settings,
    dayRecords: day.rows.map((row) => ({
      id: row.id,
      employeeKey: row.employee_key,
      employeeName: row.employee_name,
      department: row.department,
      date: row.attendance_date,
      statusId: row.status_id,
      statusLabel: row.status_label,
      points: Number(row.points || 0),
      note: row.note || '',
      recordedBy: row.recorded_by || '',
      updatedAt: row.updated_at || null,
    })),
    totals: totals.rows.map((row) => ({
      employeeKey: row.employee_key,
      employeeName: row.employee_name,
      totalPoints: Number(row.total_points || 0),
      lastRecordDate: row.last_record_date ? String(row.last_record_date).slice(0,10) : '',
    })),
  };
}

async function personHistory(db, employeeKey) {
  const records = await db.query(`
    SELECT id,employee_key,employee_name,department,to_char(attendance_date,'YYYY-MM-DD') AS attendance_date,
           status_id,status_label,points,note,recorded_by,created_at,updated_at
    FROM hub_attendance_records
    WHERE employee_key=$1
    ORDER BY attendance_date DESC,updated_at DESC
    LIMIT 300
  `, [employeeKey]);
  const total = records.rows.reduce((sum,row) => sum + Number(row.points || 0), 0);
  return {
    employeeKey,
    totalPoints: Math.max(0, Math.round(total * 100) / 100),
    history: records.rows.map((row) => ({
      id: row.id,
      employeeKey: row.employee_key,
      employeeName: row.employee_name,
      department: row.department,
      date: row.attendance_date,
      statusId: row.status_id,
      statusLabel: row.status_label,
      points: Number(row.points || 0),
      note: row.note || '',
      recordedBy: row.recorded_by || '',
      updatedAt: row.updated_at || null,
    })),
  };
}

async function saveDay(db, session, body) {
  const date = validDate(body.date);
  if (!date) throw new Error('Choose a valid attendance date.');
  const settings = await readSettings(db);
  const statusMap = new Map(settings.statuses.map((row) => [row.id, row]));
  const records = Array.isArray(body.records) ? body.records.slice(0, 500) : [];
  const client = await db.connect();
  let saved = 0;
  let cleared = 0;
  try {
    await client.query('BEGIN');
    for (const raw of records) {
      const employeeKey = clean(raw?.employeeKey, 160);
      const employeeName = clean(raw?.employeeName, 120);
      const department = clean(raw?.department, 120) || 'Unassigned';
      const statusId = clean(raw?.statusId, 100);
      const note = clean(raw?.note, 1000);
      if (!employeeKey || !employeeName) continue;

      const priorResult = await client.query(`
        SELECT status_label,points FROM hub_attendance_records
        WHERE employee_key=$1 AND attendance_date=$2::date LIMIT 1
      `, [employeeKey, date]);
      const prior = priorResult.rows[0] || null;

      if (!statusId) {
        if (prior) {
          await client.query(`DELETE FROM hub_attendance_records WHERE employee_key=$1 AND attendance_date=$2::date`, [employeeKey, date]);
          await client.query(`
            INSERT INTO hub_attendance_audit(employee_key,employee_name,attendance_date,previous_status,new_status,previous_points,new_points,actor)
            VALUES($1,$2,$3::date,$4,'',$5,0,$6)
          `, [employeeKey, employeeName, date, prior.status_label || '', Number(prior.points || 0), clean(session.name,120)]);
          cleared += 1;
        }
        continue;
      }

      const status = statusMap.get(statusId);
      if (!status) throw new Error(`Unknown attendance status: ${statusId}`);
      const points = Number(status.points || 0);
      const id = crypto.randomUUID();
      await client.query(`
        INSERT INTO hub_attendance_records(id,employee_key,employee_name,department,attendance_date,status_id,status_label,points,note,recorded_by,created_at,updated_at)
        VALUES($1,$2,$3,$4,$5::date,$6,$7,$8,$9,$10,NOW(),NOW())
        ON CONFLICT(employee_key,attendance_date) DO UPDATE SET
          employee_name=EXCLUDED.employee_name,
          department=EXCLUDED.department,
          status_id=EXCLUDED.status_id,
          status_label=EXCLUDED.status_label,
          points=EXCLUDED.points,
          note=EXCLUDED.note,
          recorded_by=EXCLUDED.recorded_by,
          updated_at=NOW()
      `, [id, employeeKey, employeeName, department, date, status.id, status.label, points, note, clean(session.name,120)]);

      const changed = !prior || prior.status_label !== status.label || Number(prior.points || 0) !== points;
      if (changed) {
        await client.query(`
          INSERT INTO hub_attendance_audit(employee_key,employee_name,attendance_date,previous_status,new_status,previous_points,new_points,actor)
          VALUES($1,$2,$3::date,$4,$5,$6,$7,$8)
        `, [employeeKey, employeeName, date, prior?.status_label || '', status.label, Number(prior?.points || 0), points, clean(session.name,120)]);
      }
      saved += 1;
    }
    await client.query('COMMIT');
    return { saved, cleared };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

async function saveSettings(db, session, body) {
  const statuses = sanitizeStatuses(body.statuses);
  const thresholds = sanitizeThresholds(body.thresholds);
  await db.query(`
    INSERT INTO hub_attendance_settings(settings_key,statuses_json,thresholds_json,updated_at,updated_by)
    VALUES('default',$1::jsonb,$2::jsonb,NOW(),$3)
    ON CONFLICT(settings_key) DO UPDATE SET
      statuses_json=EXCLUDED.statuses_json,
      thresholds_json=EXCLUDED.thresholds_json,
      updated_at=NOW(),
      updated_by=EXCLUDED.updated_by
  `, [JSON.stringify(statuses), JSON.stringify(thresholds), clean(session.name,120)]);
  return readSettings(db);
}

export default async (request) => {
  try {
    const session = managerSession(request);
    if (!session) return json(401, { error: 'Manager sign-in through the Warehouse Hub is required.' });
    await ensureSchema();
    const db = getPool();
    const url = new URL(request.url);

    if (request.method === 'GET') {
      const employeeKey = clean(url.searchParams.get('person'), 160);
      if (employeeKey) return json(200, await personHistory(db, employeeKey));
      const date = validDate(url.searchParams.get('date')) || new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
      return json(200, await snapshot(db, date));
    }

    if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });
    const body = await request.json().catch(() => ({}));
    const action = clean(body.action, 50);

    if (action === 'saveDay') {
      const result = await saveDay(db, session, body);
      return json(200, { ok: true, ...result, snapshot: await snapshot(db, validDate(body.date)) });
    }

    if (action === 'saveSettings') {
      const settings = await saveSettings(db, session, body);
      return json(200, { ok: true, settings });
    }

    return json(400, { error: 'Unsupported attendance action.' });
  } catch (error) {
    return json(400, { error: clean(error?.message || 'Unexpected attendance error.', 300) });
  }
};

export const config = { path: '/api/attendance-control' };
