import pg from 'pg';
import crypto from 'node:crypto';

const { Pool } = pg;
const FAIRSHIFT_BASE = 'https://fairshift-rotations.thandoyordani.chatgpt.site';
const SESSION_COOKIE = 'hub_associate_session';
const SESSION_SECONDS = 10 * 60 * 60;
const SESSION_VERSION = 2;
const HUB_PIN_ITERATIONS = 100000;
let poolInstance = null;
let schemaReady = false;
let rosterCache = { expiresAt: 0, people: [], selfService: false };
let signingKeyPromise = null;

function env(name) {
  return globalThis.Netlify?.env?.get(name) || '';
}

function getPool() {
  const connectionString = env('DATABASE_URL');
  if (!connectionString) throw new Error('DATABASE_URL is not configured.');
  if (!poolInstance) poolInstance = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  return poolInstance;
}

function clean(value, max = 200) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function slug(value) {
  return clean(value, 100).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });
}

function todayEastern() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

async function ensureSchema() {
  if (schemaReady) return;
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hub_associate_auth (
      employee_key TEXT PRIMARY KEY,
      employee_name TEXT NOT NULL,
      department TEXT,
      pin_salt TEXT NOT NULL,
      pin_hash TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS hub_associate_auth_name_idx ON hub_associate_auth(employee_name);
    ALTER TABLE hub_associate_auth ADD COLUMN IF NOT EXISTS pin_iterations INTEGER NOT NULL DEFAULT 120000;
    CREATE TABLE IF NOT EXISTS hub_employee_pins (
      employee_key TEXT PRIMARY KEY,
      employee_name TEXT NOT NULL,
      department TEXT,
      pin_hash TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS hub_pin_reset_audit (
      id TEXT PRIMARY KEY,
      employee_key TEXT NOT NULL,
      employee_name TEXT NOT NULL,
      employee_id BIGINT,
      reset_by TEXT NOT NULL,
      scope TEXT NOT NULL,
      reset_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS hub_pin_reset_audit_recent_idx ON hub_pin_reset_audit(reset_at DESC);
  `);
  schemaReady = true;
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

function cookieMap(request) {
  const raw = request.headers.get('cookie') || '';
  return Object.fromEntries(raw.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const idx = part.indexOf('=');
    return idx === -1 ? [part, ''] : [part.slice(0, idx), part.slice(idx + 1)];
  }));
}

function sessionKey() {
  const secret = env('HUB_ASSOCIATE_SESSION_SECRET');
  if (!secret) throw new Error('HUB_ASSOCIATE_SESSION_SECRET is not configured.');
  return crypto.createHash('sha256').update(secret).digest();
}

function encryptSession(payload) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', sessionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((part) => part.toString('base64url')).join('.');
}

function decryptSession(token) {
  try {
    const [ivText, tagText, dataText] = String(token || '').split('.');
    if (!ivText || !tagText || !dataText) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', sessionKey(), Buffer.from(ivText, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(dataText, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
    const payload = JSON.parse(plain);
    if (payload?.v !== SESSION_VERSION || !payload?.name || !payload?.pin || Number(payload.exp || 0) <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function sessionCookie(payload) {
  return `${SESSION_COOKIE}=${encryptSession(payload)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_SECONDS}`;
}

function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

async function signingKey() {
  if (signingKeyPromise) return signingKeyPromise;
  const pem = env('FAIRSHIFT_HUB_SIGNING_PRIVATE_KEY');
  if (!pem) throw new Error('FairShift Hub signing key is not configured.');
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----/g, '').replace(/-----END PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  const der = Buffer.from(body, 'base64');
  signingKeyPromise = crypto.webcrypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  return signingKeyPromise;
}

async function signedFairShiftHeaders(path, method, bodyText) {
  const timestamp = String(Date.now());
  const canonical = `${timestamp}\n${method.toUpperCase()}\n${path}\n${bodyText}`;
  const key = await signingKey();
  const signature = await crypto.webcrypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(canonical),
  );
  return {
    'x-hub-ts': timestamp,
    'x-hub-signature': Buffer.from(signature).toString('base64url'),
  };
}

async function fairShiftRequest(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const method = String(options.method || 'GET').toUpperCase();
    const bodyText = typeof options.body === 'string' ? options.body : '';
    let authHeaders = {};
    try {
      authHeaders = await signedFairShiftHeaders(path, method, bodyText);
    } catch {
      const syncKey = env('FAIRSHIFT_HUB_PIN_SYNC_KEY');
      if (syncKey) authHeaders = { 'x-hub-pin-key': syncKey };
    }
    const response = await fetch(`${FAIRSHIFT_BASE}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...authHeaders,
        ...(options.headers || {}),
      },
    });
    const body = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, body };
  } finally {
    clearTimeout(timeout);
  }
}

async function loadRoster(force = false) {
  if (!force && rosterCache.expiresAt > Date.now()) return rosterCache;

  let modernPeople = [];
  let selfService = false;

  try {
    const modern = await fairShiftRequest('/api/checkin?roster=1');
    if (modern.ok && Array.isArray(modern.body?.employees)) {
      modernPeople = modern.body.employees.map((employee) => ({
        id: Number(employee.id),
        name: clean(employee.name, 100),
        department: clean(employee.homeDepartment, 100),
        role: clean(employee.role, 60),
        pinConfigured: !!employee.pinConfigured,
        fairShiftSelfService: true,
      })).filter((employee) => employee.id && employee.name);
      selfService = true;
    }
  } catch {}

  let dashboardPeople = [];
  try {
    const dashboard = await fairShiftRequest(`/api/dashboard?date=${encodeURIComponent(todayEastern())}`);
    if (dashboard.ok) {
      dashboardPeople = (Array.isArray(dashboard.body?.employees) ? dashboard.body.employees : [])
        .filter((employee) => employee && employee.active !== false)
        .map((employee) => ({
          id: Number(employee.id),
          name: clean(employee.name, 100),
          department: clean(employee.homeDepartment, 100),
          role: clean(employee.role, 60),
          pinConfigured: null,
          fairShiftSelfService: false,
        }))
        .filter((employee) => employee.id && employee.name);
    }
  } catch {}

  if (!modernPeople.length && !dashboardPeople.length) {
    throw new Error('FairShift employee list is unavailable.');
  }

  // The protected FairShift roster intentionally omits Team Leads because they
  // are not part of cleaning rotation self-service. Merge the public active
  // team roster so Team Leads can still use Warehouse Hub features. People
  // present in the protected roster keep FairShift PIN/cleaning integration;
  // dashboard-only people use a Hub-only PIN.
  const merged = new Map();
  for (const person of dashboardPeople) merged.set(slug(person.name), person);
  for (const person of modernPeople) merged.set(slug(person.name), person);

  const people = [...merged.values()].sort((a, b) => {
    const roleA = String(a.role || '').toLowerCase();
    const roleB = String(b.role || '').toLowerCase();
    const leadA = roleA.includes('lead') ? 0 : 1;
    const leadB = roleB.includes('lead') ? 0 : 1;
    return leadA - leadB || a.name.localeCompare(b.name);
  });

  rosterCache = { expiresAt: Date.now() + 30000, people, selfService };
  return rosterCache;
}

async function authMaps() {
  const pool = getPool();
  const [modern, legacy] = await Promise.all([
    pool.query(`SELECT employee_key,active FROM hub_associate_auth`),
    pool.query(`SELECT employee_key,active FROM hub_employee_pins`).catch(() => ({ rows: [] })),
  ]);
  return {
    modern: new Map(modern.rows.map((row) => [row.employee_key, row.active !== false])),
    legacy: new Map(legacy.rows.map((row) => [row.employee_key, row.active !== false])),
  };
}

async function publicRoster(force = false) {
  const roster = await loadRoster(force);
  const maps = await authMaps();
  return {
    selfServiceConnected: roster.selfService,
    pinSource: 'hub',
    employees: roster.people.map((person) => {
      const key = slug(person.name);
      const hubConfigured = maps.modern.get(key) === true || maps.legacy.get(key) === true;
      return {
        ...person,
        hubPinConfigured: hubConfigured,
        fairShiftPinConfigured: person.pinConfigured === true,
      };
    }),
  };
}

async function findPerson(name, force = false) {
  const roster = await loadRoster(force);
  const key = slug(name);
  return {
    roster,
    person: roster.people.find((candidate) => slug(candidate.name) === key) || null,
  };
}

async function saveModernPin(person, pin, queryClient = getPool()) {
  const pool = queryClient;
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPin(pin, salt, HUB_PIN_ITERATIONS);
  await pool.query(`
    INSERT INTO hub_associate_auth(employee_key,employee_name,department,pin_salt,pin_hash,pin_iterations,active,created_at,updated_at)
    VALUES($1,$2,$3,$4,$5,$6,TRUE,NOW(),NOW())
    ON CONFLICT(employee_key) DO UPDATE SET
      employee_name=EXCLUDED.employee_name,
      department=EXCLUDED.department,
      pin_salt=EXCLUDED.pin_salt,
      pin_hash=EXCLUDED.pin_hash,
      pin_iterations=EXCLUDED.pin_iterations,
      active=TRUE,
      updated_at=NOW()
  `, [slug(person.name), person.name, person.department || '', salt, hash, HUB_PIN_ITERATIONS]);
}

async function verifyHubFallback(person, pin) {
  const pool = getPool();
  const key = slug(person.name);
  const modern = await pool.query(`SELECT pin_salt,pin_hash,pin_iterations,active FROM hub_associate_auth WHERE employee_key=$1 LIMIT 1`, [key]);
  if (modern.rows[0]) {
    const row = modern.rows[0];
    if (row.active !== false) {
      try {
        const iterations = Number(row.pin_iterations || 120000);
        if (safeEqualHex(hashPin(pin, row.pin_salt, iterations), row.pin_hash)) return true;
      } catch {}
    }
  }

  const legacy = await pool.query(`SELECT pin_hash,active FROM hub_employee_pins WHERE employee_key=$1 LIMIT 1`, [key]).catch(() => ({ rows: [] }));
  const row = legacy.rows[0];
  return !!(row && row.active !== false && safeEqualHex(legacyHash(pin), row.pin_hash));
}

function authorizedAdmin(session, roster) {
  if (!session || clean(session.role, 60).toLowerCase() !== 'manager') return null;
  return roster.people.find(person =>
    slug(person.name) === slug(session.name) &&
    Number(person.id) === Number(session.employeeId) &&
    clean(person.role, 60).toLowerCase() === 'manager'
  ) || null;
}

async function pinResetHistory() {
  const result = await getPool().query(`
    SELECT employee_name,employee_id,reset_by,scope,reset_at
    FROM hub_pin_reset_audit
    ORDER BY reset_at DESC,id DESC LIMIT 75
  `);
  return result.rows.map(row => ({
    employeeName: row.employee_name,
    employeeId: row.employee_id,
    resetBy: row.reset_by,
    scope: row.scope,
    resetAt: row.reset_at,
  }));
}

async function resetEmployeePin(request, body) {
  const session = decryptSession(cookieMap(request)[SESSION_COOKIE]);
  if (!session || clean(session.role, 60).toLowerCase() !== 'manager')
    return json(403, { error: 'Admin sign-in is required to reset employee PINs.' });

  const roster = await loadRoster(true);
  const admin = authorizedAdmin(session, roster);
  if (!admin) return json(403, { error: 'Admin access could not be verified. Sign out and sign in again.' });

  const targetId = Number(body.employeeId);
  const name = clean(body.employeeName, 100);
  const person = Number.isSafeInteger(targetId) && targetId > 0
    ? roster.people.find(candidate => candidate.id === targetId && slug(candidate.name) === slug(name))
    : null;
  if (!person) return json(404, { error: 'The selected employee could not be verified in the current roster.' });

  const pin = clean(body.pin, 8);
  if (!/^\d{4,8}$/.test(pin)) return json(400, { error: 'Enter a 4–8 digit PIN.' });
  if (pin !== clean(body.confirmPin, 8)) return json(400, { error: 'The two PINs do not match.' });

  // Hub is authoritative. Save the reset here first; FairShift sync is
  // best-effort and must never veto a valid Hub credential again.
  const auditId = crypto.randomUUID();
  let scope = 'Warehouse Hub';
  const db = getPool();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await saveModernPin(person, pin, client);
    await client.query(`
      UPDATE hub_employee_pins
      SET pin_hash=$2,employee_name=$3,department=$4,active=TRUE,updated_at=NOW()
      WHERE employee_key=$1
    `, [slug(person.name), legacyHash(pin), person.name, person.department || '']);
    await client.query(`
      INSERT INTO hub_pin_reset_audit
        (id,employee_key,employee_name,employee_id,reset_by,scope,reset_at)
      VALUES($1,$2,$3,$4,$5,$6,NOW())
    `, [auditId, slug(person.name), person.name, person.id, admin.name, scope]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  let fairShiftSynced = person.fairShiftSelfService === false;
  let warning = '';
  if (person.fairShiftSelfService !== false && roster.selfService) {
    try {
      const payload = JSON.stringify({
        action: 'adminResetPin',
        employeeId: person.id,
        employeeName: person.name,
        pin,
      });
      const remote = await fairShiftRequest('/api/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      });
      if (remote.ok && remote.body?.ok !== false) {
        const verified = await verifyFairShiftPin(person, pin).catch(() => ({ ok: false }));
        fairShiftSynced = verified.ok && verified.body?.ok === true;
      }
    } catch {}
  }

  if (fairShiftSynced && person.fairShiftSelfService !== false) {
    scope = 'Warehouse Hub + FairShift';
    await db.query('UPDATE hub_pin_reset_audit SET scope=$2 WHERE id=$1', [auditId, scope]).catch(() => {});
  } else if (person.fairShiftSelfService !== false) {
    warning = 'Hub PIN reset succeeded. FairShift cleaning still has a separate older PIN, but it can no longer block Warehouse Hub sign-in.';
  }

  rosterCache.expiresAt = 0;
  return json(200, {
    ok: true,
    employeeName: person.name,
    scope,
    resetBy: admin.name,
    fairShiftSynced,
    warning,
    message: `PIN reset for ${person.name}. The new Warehouse Hub PIN is active.`,
  });
}

async function verifyFairShiftPin(person, pin) {
  const bodyText = JSON.stringify({ action: 'verifyPin', employeeName: person.name, pin });
  return fairShiftRequest('/api/checkin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: bodyText,
  });
}

function createSession(person, pin, fairShiftVerified) {
  const exp = Date.now() + SESSION_SECONDS * 1000;
  return {
    payload: {
      v: SESSION_VERSION,
      fairShiftVerified: !!fairShiftVerified,
      name: person.name,
      department: person.department || '',
      employeeId: person.id || null,
      role: person.role || 'Associate',
      pin,
      exp,
    },
    public: {
      signedIn: true,
      fairShiftVerified: !!fairShiftVerified,
      name: person.name,
      department: person.department || '',
      employeeId: person.id || null,
      role: person.role || 'Associate',
      expiresAt: new Date(exp).toISOString(),
    },
  };
}

export default async (request) => {
  try {
    await ensureSchema();
    const url = new URL(request.url);

    if (request.method === 'GET') {
      const action = url.searchParams.get('action') || 'session';
      if (action === 'roster') return json(200, await publicRoster(url.searchParams.get('refresh') === '1'));
      if (action === 'pinResetHistory') {
        const session = decryptSession(cookieMap(request)[SESSION_COOKIE]);
        if (!session || clean(session.role, 60).toLowerCase() !== 'manager')
          return json(403, { error: 'Admin sign-in required.' });
        const roster = await loadRoster(true);
        if (!authorizedAdmin(session, roster)) return json(403, { error: 'Admin access could not be verified.' });
        return json(200, { history: await pinResetHistory() });
      }
      if (action === 'session') {
        const token = cookieMap(request)[SESSION_COOKIE];
        const session = decryptSession(token);
        if (!session) return json(200, { signedIn: false });
        return json(200, {
          signedIn: true,
          fairShiftVerified: session.fairShiftVerified === true,
          name: session.name,
          department: session.department || '',
          employeeId: session.employeeId || null,
          role: session.role || 'Associate',
          expiresAt: new Date(session.exp).toISOString(),
        });
      }
      return json(400, { error: 'Unsupported request.' });
    }

    if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });
    const body = await request.json().catch(() => ({}));
    const action = clean(body.action, 30);

    if (action === 'logout') {
      return json(200, { ok: true, signedIn: false }, { 'Set-Cookie': clearSessionCookie() });
    }
    if (action === 'adminResetPin') return resetEmployeePin(request, body);

    const lookup = await findPerson(body.employeeName, true);
    const person = lookup.person;
    if (!person) return json(404, { error: 'Choose your name from the active warehouse team list.' });

    const pin = clean(body.pin, 8);
    if (!/^\d{4,8}$/.test(pin)) return json(400, { error: 'Enter a 4–8 digit PIN.' });

    if (action === 'setup') {
      const confirmPin = clean(body.confirmPin, 8);
      if (pin !== confirmPin) return json(400, { error: 'The two PINs do not match.' });

      const maps = await authMaps();
      const key = slug(person.name);
      if (maps.modern.get(key) === true || maps.legacy.get(key) === true) {
        return json(409, {
          error: 'This person already has a Warehouse Hub PIN. An Admin must use Reset PIN to change it.',
        });
      }

      // Warehouse Hub is authoritative for first-time PIN setup. A legacy
      // FairShift cleaning PIN must never block an associate from establishing
      // a Hub PIN. Save the Hub credential first, then best-effort sync that
      // same PIN to FairShift so Cleaning follows the Hub automatically.
      await saveModernPin(person, pin);
      rosterCache.expiresAt = 0;

      let fairShiftVerified = person.fairShiftSelfService === false;
      if (person.fairShiftSelfService !== false && lookup.roster.selfService) {
        try {
          const bodyText = JSON.stringify({
            action: 'adminResetPin',
            employeeId: person.id,
            employeeName: person.name,
            pin,
          });
          const provision = await fairShiftRequest('/api/checkin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: bodyText,
          });
          if (provision.ok && provision.body?.ok !== false) {
            const verified = await verifyFairShiftPin(person, pin).catch(() => ({ ok: false }));
            fairShiftVerified = verified.ok && verified.body?.ok === true;
          }
        } catch {}
      }

      const session = createSession(person, pin, fairShiftVerified);
      return json(200, {
        ok: true,
        ...session.public,
        warning: fairShiftVerified || person.fairShiftSelfService === false
          ? ''
          : 'Warehouse Hub PIN created successfully. Cleaning PIN sync did not complete, but the Hub PIN is active and can be reset from Admin Hub tools.',
      }, { 'Set-Cookie': sessionCookie(session.payload) });
    }

    if (action === 'login') {
      // Warehouse Hub is the source of truth for Hub authentication.
      // FairShift verification is now best-effort and cannot reject a valid
      // Hub PIN. This prevents stale FairShift credentials from locking an
      // associate out after an Admin reset.
      const verified = await verifyHubFallback(person, pin);
      if (!verified) return json(403, { error: 'Name or PIN is incorrect.' });

      let fairShiftVerified = person.fairShiftSelfService === false;
      if (person.fairShiftSelfService !== false && lookup.roster.selfService) {
        try {
          const remote = await verifyFairShiftPin(person, pin);
          fairShiftVerified = remote.ok && remote.body?.ok === true;
        } catch {}
      }

      const session = createSession(person, pin, fairShiftVerified);
      return json(200, {
        ok: true,
        ...session.public,
        warning: fairShiftVerified || person.fairShiftSelfService === false
          ? ''
          : 'You are signed in to Warehouse Hub. Cleaning check-in is still linked to the older FairShift PIN until that migration is completed.',
      }, { 'Set-Cookie': sessionCookie(session.payload) });
    }

    return json(400, { error: 'Unsupported action.' });
  } catch (error) {
    return json(400, { error: clean(error?.message || 'Unexpected error.', 300) });
  }
};
