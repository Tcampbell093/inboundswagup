import pg from 'pg';
import crypto from 'node:crypto';

const { Pool } = pg;
const FAIRSHIFT_BASE = 'https://fairshift-rotations.thandoyordani.chatgpt.site';
const SESSION_COOKIE = 'hub_associate_session';
const SESSION_SECONDS = 10 * 60 * 60;
let poolInstance = null;
let schemaReady = false;
let rosterCache = { expiresAt: 0, people: [], selfService: false };

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
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
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
  `);
  schemaReady = true;
}

function hashPin(pin, saltHex) {
  return crypto.pbkdf2Sync(pin, Buffer.from(saltHex, 'hex'), 120000, 32, 'sha256').toString('hex');
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
    const plain = Buffer.concat([decipher.update(Buffer.from(dataText, 'base64url')), decipher.final()]).toString('utf8');
    const payload = JSON.parse(plain);
    if (!payload?.name || !payload?.pin || Number(payload.exp || 0) <= Date.now()) return null;
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

async function fairShiftRequest(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const syncKey = env('FAIRSHIFT_HUB_PIN_SYNC_KEY');
    const response = await fetch(`${FAIRSHIFT_BASE}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(syncKey ? { 'x-hub-pin-key': syncKey } : {}),
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
  let people = [];
  let selfService = false;

  try {
    const modern = await fairShiftRequest('/api/checkin?roster=1');
    if (modern.ok && Array.isArray(modern.body?.employees)) {
      people = modern.body.employees.map((employee) => ({
        id: Number(employee.id),
        name: clean(employee.name, 100),
        department: clean(employee.homeDepartment, 100),
        role: clean(employee.role, 60),
        pinConfigured: !!employee.pinConfigured,
      })).filter((employee) => employee.id && employee.name);
      selfService = true;
    }
  } catch {}

  if (!people.length) {
    const dashboard = await fairShiftRequest(`/api/dashboard?date=${encodeURIComponent(todayEastern())}`);
    if (!dashboard.ok) throw new Error('FairShift employee list is unavailable.');
    people = (Array.isArray(dashboard.body?.employees) ? dashboard.body.employees : [])
      .filter((employee) => employee && employee.active !== false)
      .map((employee) => ({
        id: Number(employee.id),
        name: clean(employee.name, 100),
        department: clean(employee.homeDepartment, 100),
        role: clean(employee.role, 60),
        pinConfigured: null,
      }))
      .filter((employee) => employee.id && employee.name);
  }

  rosterCache = { expiresAt: Date.now() + 60000, people, selfService };
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

async function publicRoster() {
  const roster = await loadRoster();
  const maps = await authMaps();
  return {
    selfServiceConnected: roster.selfService,
    employees: roster.people.map((person) => {
      const key = slug(person.name);
      const hubConfigured = maps.modern.get(key) === true || maps.legacy.get(key) === true;
      return { ...person, hubPinConfigured: hubConfigured };
    }),
  };
}

async function findPerson(name) {
  const roster = await loadRoster();
  const key = slug(name);
  return roster.people.find((person) => slug(person.name) === key) || null;
}

async function saveModernPin(person, pin) {
  const pool = getPool();
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPin(pin, salt);
  await pool.query(`
    INSERT INTO hub_associate_auth(employee_key,employee_name,department,pin_salt,pin_hash,active,created_at,updated_at)
    VALUES($1,$2,$3,$4,$5,TRUE,NOW(),NOW())
    ON CONFLICT(employee_key) DO UPDATE SET employee_name=EXCLUDED.employee_name,department=EXCLUDED.department,
      pin_salt=EXCLUDED.pin_salt,pin_hash=EXCLUDED.pin_hash,active=TRUE,updated_at=NOW()
  `, [slug(person.name), person.name, person.department || '', salt, hash]);
}

async function verifyHubPin(person, pin) {
  const pool = getPool();
  const key = slug(person.name);
  const modern = await pool.query(`SELECT pin_salt,pin_hash,active FROM hub_associate_auth WHERE employee_key=$1 LIMIT 1`, [key]);
  if (modern.rows[0]) {
    const row = modern.rows[0];
    return row.active !== false && safeEqualHex(hashPin(pin, row.pin_salt), row.pin_hash);
  }

  const legacy = await pool.query(`SELECT pin_hash,active FROM hub_employee_pins WHERE employee_key=$1 LIMIT 1`, [key]).catch(() => ({ rows: [] }));
  const row = legacy.rows[0];
  if (row && row.active !== false && safeEqualHex(legacyHash(pin), row.pin_hash)) {
    await saveModernPin(person, pin);
    return true;
  }
  return false;
}

async function verifyFairShiftPin(person, pin) {
  const roster = await loadRoster();
  if (!roster.selfService) return false;
  const result = await fairShiftRequest('/api/checkin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'verifyPin', employeeName: person.name, pin }),
  });
  return result.ok && result.body?.ok === true;
}

function createSession(person, pin) {
  const exp = Date.now() + SESSION_SECONDS * 1000;
  return {
    payload: { name: person.name, department: person.department || '', employeeId: person.id || null, pin, exp },
    public: { signedIn: true, name: person.name, department: person.department || '', employeeId: person.id || null, expiresAt: new Date(exp).toISOString() },
  };
}

export default async (request) => {
  try {
    await ensureSchema();
    const url = new URL(request.url);

    if (request.method === 'GET') {
      const action = url.searchParams.get('action') || 'session';
      if (action === 'roster') return json(200, await publicRoster());
      if (action === 'session') {
        const token = cookieMap(request)[SESSION_COOKIE];
        const session = decryptSession(token);
        if (!session) return json(200, { signedIn: false });
        return json(200, { signedIn: true, name: session.name, department: session.department || '', employeeId: session.employeeId || null, expiresAt: new Date(session.exp).toISOString() });
      }
      return json(400, { error: 'Unsupported request.' });
    }

    if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });
    const body = await request.json().catch(() => ({}));
    const action = clean(body.action, 30);

    if (action === 'logout') return json(200, { ok: true, signedIn: false }, { 'Set-Cookie': clearSessionCookie() });

    const person = await findPerson(body.employeeName);
    if (!person) return json(404, { error: 'Choose your name from the active FairShift team list.' });
    const pin = clean(body.pin, 8);
    if (!/^\d{4,8}$/.test(pin)) return json(400, { error: 'Enter a 4–8 digit PIN.' });

    if (action === 'setup') {
      const confirmPin = clean(body.confirmPin, 8);
      if (pin !== confirmPin) return json(400, { error: 'The two PINs do not match.' });
      const maps = await authMaps();
      const key = slug(person.name);
      if (maps.modern.get(key) === true || maps.legacy.get(key) === true) return json(409, { error: 'A Hub PIN is already set for this associate. Sign in instead.' });

      const roster = await loadRoster(true);
      const fresh = roster.people.find((employee) => slug(employee.name) === key) || person;
      if (roster.selfService && fresh.pinConfigured === false) {
        const provision = await fairShiftRequest('/api/checkin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'selfSetPin', employeeId: fresh.id, employeeName: fresh.name, pin }),
        });
        if (!provision.ok) return json(provision.status || 400, { error: clean(provision.body?.error || 'FairShift could not save this PIN.', 250) });
      } else if (roster.selfService && fresh.pinConfigured === true) {
        return json(409, { error: 'A cleaning PIN already exists for this associate. Use that PIN to sign in.' });
      }

      await saveModernPin(fresh, pin);
      const session = createSession(fresh, pin);
      return json(200, { ok: true, ...session.public, fairShiftPinSynced: roster.selfService }, { 'Set-Cookie': sessionCookie(session.payload) });
    }

    if (action === 'login') {
      let verified = await verifyHubPin(person, pin);
      if (!verified) {
        verified = await verifyFairShiftPin(person, pin);
        if (verified) await saveModernPin(person, pin);
      }
      if (!verified) return json(403, { error: 'Name or PIN is incorrect.' });
      const session = createSession(person, pin);
      return json(200, { ok: true, ...session.public }, { 'Set-Cookie': sessionCookie(session.payload) });
    }

    return json(400, { error: 'Unsupported action.' });
  } catch (error) {
    return json(400, { error: clean(error?.message || 'Unexpected error.', 300) });
  }
};
