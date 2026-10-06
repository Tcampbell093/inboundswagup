import pg from 'pg';
import crypto from 'node:crypto';
import hubCleaning from './_hub_cleaning.js';
import hubPush from './_hub_push.js';
import schedule from './_hub_schedule.js';

const { Pool } = pg;
const SESSION_COOKIE = 'hub_associate_session';
const SESSION_VERSION = 2;
const HUB_PIN_ITERATIONS = 100000;
let poolInstance = null;
let bingoSchemaReady = false;

function env(name) {
  return globalThis.Netlify?.env?.get(name) || '';
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function clean(value, max = 120) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function slug(value) {
  return clean(value, 100)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function getPool() {
  const connectionString = env('DATABASE_URL');
  if (!connectionString) throw new Error('DATABASE_URL is not configured.');
  if (!poolInstance) poolInstance = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  return poolInstance;
}

function sessionKey() {
  const secret = env('HUB_ASSOCIATE_SESSION_SECRET');
  return secret ? crypto.createHash('sha256').update(secret).digest() : null;
}

function cookieMap(request) {
  const raw = request.headers.get('cookie') || '';
  return Object.fromEntries(
    raw.split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf('=');
        return index === -1 ? [part, ''] : [part.slice(0, index), part.slice(index + 1)];
      }),
  );
}

function decryptSession(token) {
  try {
    const key = sessionKey();
    if (!key || !token) return null;
    const [ivText, tagText, dataText] = String(token).split('.');
    if (!ivText || !tagText || !dataText) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivText, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(dataText, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
    const payload = JSON.parse(plain);
    if (
      payload?.v !== SESSION_VERSION ||
      !payload?.name ||
      !payload?.pin ||
      Number(payload.exp || 0) <= Date.now()
    ) return null;
    return payload;
  } catch {
    return null;
  }
}

function hashPin(pin, saltHex, iterations = HUB_PIN_ITERATIONS) {
  return crypto.pbkdf2Sync(pin, Buffer.from(saltHex, 'hex'), iterations, 32, 'sha256').toString('hex');
}

function safeEqualHex(a, b) {
  if (!a || !b) return false;
  const aa = Buffer.from(String(a), 'hex');
  const bb = Buffer.from(String(b), 'hex');
  return aa.length === bb.length && aa.length > 0 && crypto.timingSafeEqual(aa, bb);
}

function legacyHash(pin) {
  return crypto.createHash('sha256').update(`${env('HUB_PIN_SALT')}:${pin}`).digest('hex');
}

async function verifyCurrentHubCredential(session) {
  const key = slug(session?.name);
  const pin = clean(session?.pin, 8);
  const employeeId = Number(session?.employeeId) > 0 ? Number(session.employeeId) : null;
  if (!key || !/^\d{4,8}$/.test(pin)) return false;

  const modern = await getPool().query(
    `SELECT pin_salt,pin_hash,pin_iterations,active
     FROM hub_associate_auth
     WHERE employee_key=$1 OR ($2::BIGINT IS NOT NULL AND employee_id=$2)
     ORDER BY CASE WHEN employee_key=$1 THEN 0 ELSE 1 END, updated_at DESC`,
    [key, employeeId],
  ).catch(async (error) => {
    if (error?.code !== '42703') throw error;
    return getPool().query(
      'SELECT pin_salt,pin_hash,pin_iterations,active FROM hub_associate_auth WHERE employee_key=$1 LIMIT 1',
      [key],
    );
  });

  for (const row of modern.rows) {
    if (row.active === false) continue;
    try {
      const iterations = Number(row.pin_iterations || HUB_PIN_ITERATIONS);
      if (safeEqualHex(hashPin(pin, row.pin_salt, iterations), row.pin_hash)) return true;
    } catch {}
  }

  const legacy = await getPool().query(
    'SELECT pin_hash,active FROM hub_employee_pins WHERE employee_key=$1 LIMIT 1',
    [key],
  ).catch(() => ({ rows: [] }));
  const row = legacy.rows[0];
  return !!(row && row.active !== false && safeEqualHex(legacyHash(pin), row.pin_hash));
}

async function ensureBingoSchema() {
  if (bingoSchemaReady) return;
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS hub_bingo_wallet (
      employee_key TEXT PRIMARY KEY,
      employee_name TEXT NOT NULL,
      coins INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS hub_bingo_coin_events (
      source_key TEXT PRIMARY KEY,
      employee_key TEXT NOT NULL,
      employee_name TEXT NOT NULL,
      amount INTEGER NOT NULL DEFAULT 1,
      assignment_id BIGINT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  bingoSchemaReady = true;
}

async function awardBingoCoin(employeeName, assignmentId) {
  try {
    await ensureBingoSchema();
    const employeeKey = slug(employeeName);
    if (!employeeKey || !assignmentId) return null;

    const sourceKey = `fairshift:${assignmentId}:finish`;
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query(`
        INSERT INTO hub_bingo_coin_events(source_key,employee_key,employee_name,amount,assignment_id,created_at)
        VALUES($1,$2,$3,1,$4,NOW())
        ON CONFLICT(source_key) DO NOTHING
        RETURNING source_key
      `, [sourceKey, employeeKey, clean(employeeName, 100), assignmentId]);

      if (inserted.rowCount) {
        const wallet = await client.query(`
          INSERT INTO hub_bingo_wallet(employee_key,employee_name,coins,updated_at)
          VALUES($1,$2,1,NOW())
          ON CONFLICT(employee_key) DO UPDATE SET
            employee_name=EXCLUDED.employee_name,
            coins=hub_bingo_wallet.coins + 1,
            updated_at=NOW()
          RETURNING coins
        `, [employeeKey, clean(employeeName, 100)]);
        await client.query('COMMIT');
        return { awarded: true, coins: Number(wallet.rows[0]?.coins || 0) };
      }

      const wallet = await client.query(
        'SELECT coins FROM hub_bingo_wallet WHERE employee_key=$1 LIMIT 1',
        [employeeKey],
      );
      await client.query('COMMIT');
      return { awarded: false, coins: Number(wallet.rows[0]?.coins || 0) };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  } catch {
    return null;
  }
}

function easternToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function isoOrNull(value) {
  return value ? new Date(value).toISOString() : null;
}

// FairShift still owns the schedule; the Hub owns start/finish. A Hub check-in
// always wins over FairShift's status for the same assignment.
function withHubStatus(assignment, checkin) {
  if (!assignment || !checkin) return assignment;
  return {
    ...assignment,
    dutyStatus: checkin.status,
    startTime: isoOrNull(checkin.started_at) || assignment.startTime || null,
    endTime: isoOrNull(checkin.finished_at) || assignment.endTime || null,
    checkinSource: 'hub',
  };
}

async function loadAssignment(assignmentId) {
  let found;
  try {
    found = await schedule.checkinAssignment(getPool(), assignmentId);
  } catch {
    return { result: { status: 503, body: { error: 'The cleaning schedule is temporarily unavailable.' } }, assignment: null };
  }
  if (!found) return { result: { status: 404, body: { error: 'This cleaning assignment no longer exists.' } }, assignment: null };
  const checkins = await hubCleaning.checkinsByIdSafe(getPool(), [assignmentId]);
  return { result: { status: 200, body: { assignment: found } }, assignment: withHubStatus(found, checkins.get(assignmentId)) };
}

export default async (request) => {
  try {
    return await handle(request);
  } catch (error) {
    return json(503, { error: 'Cleaning check-in is temporarily unavailable. Please try again.' });
  }
};

// Duties started or finished before the Hub took over live on the schedule
// row itself (copied from FairShift). Put one back to scheduled, keeping a
// backup who had taken it over. Returns the old row for the audit log.
async function resetScheduleRow(db, assignmentId, fromStatus) {
  const r = await db.query(`
    UPDATE hub_sched_assignments a SET
      duty_status = CASE WHEN a.actual_employee_id IS NOT NULL AND a.actual_employee_id<>a.employee_id
        THEN 'alternate_assigned' ELSE 'scheduled' END,
      actual_employee_id = CASE WHEN a.actual_employee_id IS NOT NULL AND a.actual_employee_id<>a.employee_id
        THEN a.actual_employee_id ELSE NULL END,
      start_time = NULL, end_time = NULL
    FROM hub_sched_assignments old
    LEFT JOIN hub_sched_employees e ON e.id = COALESCE(old.actual_employee_id, old.employee_id)
    WHERE a.id = old.id AND a.id = $1 AND a.type = 'cleaning' AND old.duty_status = $2
    RETURNING e.name AS employee_name, old.duty_status AS status, old.start_time AS started_at, old.end_time AS finished_at
  `, [assignmentId, fromStatus]);
  const row = r.rows[0];
  if (!row) return null;
  const asTime = (value) => (value && !Number.isNaN(Date.parse(value)) ? value : null);
  return { ...row, started_at: asTime(row.started_at), finished_at: asTime(row.finished_at) };
}

// Undo a start (e.g. tapped by mistake): the duty goes back to scheduled. The
// assigned person can undo today's start; Admins and Team Leads can undo any.
async function undoStart(session, assignment, assignedName) {
  const role = clean(session.role, 40).toLowerCase();
  const isLead = role === 'manager' || role === 'team lead';
  const isMine = slug(assignedName) === slug(session.name);
  if (!isLead && !isMine) {
    return json(403, { error: `Only ${assignedName || 'the assigned person'} or a Team Lead can undo this start.` });
  }
  if (!isLead && String(assignment.assignmentDate || '').slice(0, 10) !== easternToday()) {
    return json(409, { error: 'Only today’s start can be undone. Ask a Team Lead for older duties.' });
  }
  if (assignment.dutyStatus !== 'in_progress') {
    return json(409, { error: assignment.dutyStatus === 'completed'
      ? 'This cleaning duty is already completed, so its start can’t be undone.'
      : 'This cleaning duty hasn’t been started.' });
  }
  const db = getPool();
  await hubCleaning.ensureSchema(db);
  const removed = await db.query(
    `DELETE FROM hub_cleaning_checkins WHERE assignment_id=$1 AND status='in_progress'
     RETURNING employee_name,status,started_at,finished_at`,
    [Number(assignment.id)],
  );
  const previous = removed.rows[0] || await resetScheduleRow(db, Number(assignment.id), 'in_progress');
  if (!previous) return json(409, { error: 'This cleaning duty hasn’t been started.' });
  await audit(db, assignment.id, 'undo_start', previous, session.name);
  const updated = (await loadAssignment(Number(assignment.id))).assignment || assignment;
  return json(200, { ok: true, assignment: updated });
}

async function audit(db, assignmentId, action, row, doneBy) {
  await db.query(`
    INSERT INTO hub_cleaning_checkin_audit(assignment_id,action,employee_name,previous_status,started_at,finished_at,done_by)
    VALUES($1,$2,$3,$4,$5,$6,$7)
  `, [Number(assignmentId), action, clean(row?.employee_name, 100), clean(row?.status, 40),
    row?.started_at || null, row?.finished_at || null, clean(doneBy, 100)]).catch(() => {});
}

// Admin-only: put a completed duty back to Scheduled so it can be started again.
// The Bingo Coin from finishing is taken back (never below zero, in case it was
// already spent); finishing again earns it again.
async function reopenCompleted(session, assignment) {
  if (clean(session.role, 40).toLowerCase() !== 'manager') {
    return json(403, { error: 'Only an Admin can reopen a completed cleaning duty.' });
  }
  if (assignment.dutyStatus !== 'completed') {
    return json(409, { error: 'Only completed duties can be reopened.' });
  }
  const assignmentId = Number(assignment.id);
  const client = await getPool().connect();
  try {
    await hubCleaning.ensureSchema(client);
    await ensureBingoSchema();
    await client.query('BEGIN');
    const removed = await client.query(
      `DELETE FROM hub_cleaning_checkins WHERE assignment_id=$1 AND status='completed'
       RETURNING employee_name,status,started_at,finished_at`,
      [assignmentId],
    );
    const previous = removed.rows[0] || await resetScheduleRow(client, assignmentId, 'completed');
    if (!previous) {
      await client.query('ROLLBACK');
      return json(409, { error: 'Only completed duties can be reopened.' });
    }
    const coin = await client.query(
      `DELETE FROM hub_bingo_coin_events WHERE source_key=$1 RETURNING employee_key`,
      [`fairshift:${assignmentId}:finish`],
    );
    if (coin.rowCount) {
      await client.query(
        `UPDATE hub_bingo_wallet SET coins=GREATEST(coins-1,0),updated_at=NOW() WHERE employee_key=$1`,
        [coin.rows[0].employee_key],
      );
    }
    await client.query('COMMIT');
    await audit(getPool(), assignmentId, 'reopen', previous, session.name);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  const updated = (await loadAssignment(assignmentId)).assignment || assignment;
  return json(200, { ok: true, assignment: updated });
}

async function handle(request) {
  if (request.method === 'GET') {
    const url = new URL(request.url);
    const assignmentId = Number(url.searchParams.get('assignmentId'));
    if (!assignmentId) return json(400, { error: 'A valid assignment ID is required.' });
    const { result, assignment } = await loadAssignment(assignmentId);
    if (!assignment) return json(result.status, result.body);
    // Signed-out visitors can see the duty but not who is assigned.
    if (!decryptSession(cookieMap(request)[SESSION_COOKIE])) {
      return json(200, { ...result.body, assignment: { ...assignment, activeEmployeeName: '', scheduledEmployeeName: '', namesHidden: true } });
    }
    return json(200, { ...result.body, assignment });
  }

  if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });

  const session = decryptSession(cookieMap(request)[SESSION_COOKIE]);
  if (!session) {
    return json(401, {
      error: 'Your Hub cleaning session is not available. Sign in to the Hub again.',
      code: 'HUB_SESSION_MISSING',
    });
  }

  const hubCredentialCurrent = await verifyCurrentHubCredential(session).catch(() => false);
  if (!hubCredentialCurrent) {
    return json(401, {
      error: 'Your Warehouse Hub PIN changed after this sign-in. Sign in again with your current PIN.',
      code: 'HUB_CREDENTIAL_STALE',
    });
  }

  const body = await request.json().catch(() => ({}));
  const action = clean(body.action, 12);
  const assignmentId = Number(body.assignmentId);

  if (!['start', 'finish', 'undo', 'reopen'].includes(action)) return json(400, { error: 'Invalid cleaning action.' });
  if (!Number.isSafeInteger(assignmentId) || assignmentId <= 0) return json(400, { error: 'A valid assignment ID is required.' });

  const { result, assignment } = await loadAssignment(assignmentId);
  if (!assignment) {
    return json(result.status, result.body);
  }

  const assignedName = clean(assignment.activeEmployeeName || assignment.scheduledEmployeeName, 100);
  if (action === 'undo') return undoStart(session, assignment, assignedName);
  if (action === 'reopen') return reopenCompleted(session, assignment);
  if (slug(assignedName) !== slug(session.name)) {
    return json(403, { error: `This cleaning duty is assigned to ${assignedName || 'someone else'}.` });
  }
  if (String(assignment.assignmentDate || '').slice(0, 10) !== easternToday()) {
    return json(409, { error: 'Only today’s cleaning can be started or finished.' });
  }

  const status = clean(assignment.dutyStatus, 40);
  const employeeKey = slug(session.name);
  const employeeName = clean(session.name, 100);
  const db = getPool();
  await hubCleaning.ensureSchema(db);

  let changed = null;
  if (action === 'start') {
    if (status === 'completed') return json(409, { error: 'This cleaning duty is already completed.' });
    if (status === 'missed') return json(409, { error: 'This cleaning duty was closed as missed.' });
    if (status !== 'in_progress') {
      changed = await db.query(`
        INSERT INTO hub_cleaning_checkins(assignment_id,assignment_date,area,employee_key,employee_name,status,started_at,updated_at)
        VALUES($1,$2,$3,$4,$5,'in_progress',NOW(),NOW())
        ON CONFLICT(assignment_id) DO NOTHING
      `, [assignmentId, assignment.assignmentDate, clean(assignment.area, 100), employeeKey, employeeName]);
    }
  } else {
    if (status === 'missed') return json(409, { error: 'This cleaning duty was closed as missed.' });
    if (status !== 'in_progress' && status !== 'completed') {
      return json(409, { error: 'Start this cleaning duty before finishing it.' });
    }
    if (status === 'in_progress') {
      // Covers duties started in the Hub and ones started in FairShift before the switch.
      changed = await db.query(`
        INSERT INTO hub_cleaning_checkins(assignment_id,assignment_date,area,employee_key,employee_name,status,started_at,finished_at,updated_at)
        VALUES($1,$2,$3,$4,$5,'completed',$6,NOW(),NOW())
        ON CONFLICT(assignment_id) DO UPDATE SET
          status='completed',finished_at=NOW(),updated_at=NOW()
        WHERE hub_cleaning_checkins.status='in_progress'
      `, [assignmentId, assignment.assignmentDate, clean(assignment.area, 100), employeeKey, employeeName, Date.parse(assignment.startTime) ? assignment.startTime : null]);
    }
  }

  if (changed?.rowCount) {
    const area = clean(assignment.area, 100) || 'Cleaning';
    await hubPush.sendAdmins(getPool(), {
      category: action === 'start' ? 'cleaning_start' : 'cleaning_finish',
      eventKey: `cleaning-${action}:${assignmentId}:${Date.now()}`,
      title: action === 'start' ? `🧹 ${employeeName} started cleaning` : `✅ ${employeeName} finished cleaning`,
      body: `${area} · ${assignment.assignmentDate}`,
      url: '/warehouse-hub/',
      tag: `cleaning-${assignmentId}`,
      excludeName: employeeName,
    });
  }

  const updated = (await loadAssignment(assignmentId)).assignment || assignment;
  const response = { ok: true, assignment: updated };
  if (action === 'finish' && updated.dutyStatus === 'completed') {
    const award = await awardBingoCoin(session.name, assignmentId);
    if (award) {
      response.bingoCoinAwarded = award.awarded;
      response.bingoCoins = award.coins;
    }
  }
  return json(200, response);
}
