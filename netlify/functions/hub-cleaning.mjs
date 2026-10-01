import pg from 'pg';
import crypto from 'node:crypto';

const { Pool } = pg;
const FAIRSHIFT_BASE = 'https://fairshift-rotations.thandoyordani.chatgpt.site';
const SESSION_COOKIE = 'hub_associate_session';
const SESSION_VERSION = 2;
const HUB_PIN_ITERATIONS = 100000;
let poolInstance = null;
let bingoSchemaReady = false;
let signingKeyPromise = null;

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

async function signingKey() {
  if (signingKeyPromise) return signingKeyPromise;
  const pem = env('FAIRSHIFT_HUB_SIGNING_PRIVATE_KEY');
  if (!pem) throw new Error('FairShift Hub signing key is not configured.');
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
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
  const canonical = `${timestamp}\n${String(method || 'GET').toUpperCase()}\n${path}\n${bodyText || ''}`;
  try {
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
  } catch {
    const syncKey = env('FAIRSHIFT_HUB_PIN_SYNC_KEY');
    return syncKey ? { 'x-hub-pin-key': syncKey } : {};
  }
}

async function repairFairShiftPin(session) {
  const employeeId = Number(session?.employeeId);
  const employeeName = clean(session?.name, 100);
  const pin = clean(session?.pin, 8);
  if (!Number.isSafeInteger(employeeId) || employeeId <= 0 || !employeeName || !/^\d{4,8}$/.test(pin)) return false;

  const path = '/api/checkin';
  const bodyText = JSON.stringify({
    action: 'adminResetPin',
    employeeId,
    employeeName,
    pin,
  });
  const auth = await signedFairShiftHeaders(path, 'POST', bodyText);
  if (!Object.keys(auth).length) return false;

  const result = await forward(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: bodyText,
  });
  return result.status >= 200 && result.status < 300 && result.body?.ok !== false;
}

async function forward(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`${FAIRSHIFT_BASE}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(options.headers || {}),
      },
    });
    const text = await response.text();
    let body = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { error: 'FairShift returned an unreadable response.' };
    }
    return { status: response.status, body };
  } catch (error) {
    return {
      status: 502,
      body: {
        error: error?.name === 'AbortError'
          ? 'FairShift took too long to respond.'
          : 'FairShift check-in is temporarily unavailable.',
      },
    };
  } finally {
    clearTimeout(timeout);
  }
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

export default async (request) => {
  if (request.method === 'GET') {
    const url = new URL(request.url);
    const assignmentId = Number(url.searchParams.get('assignmentId'));
    if (!assignmentId) return json(400, { error: 'A valid assignment ID is required.' });
    const result = await forward(`/api/checkin?assignmentId=${encodeURIComponent(assignmentId)}`);
    return json(result.status, result.body);
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

  if (!['start', 'finish'].includes(action)) return json(400, { error: 'Invalid cleaning action.' });
  if (!assignmentId) return json(400, { error: 'A valid assignment ID is required.' });

  const checkinBody = JSON.stringify({
    action,
    assignmentId,
    employeeName: clean(session.name, 100),
    pin: clean(session.pin, 8),
  });

  let result = await forward('/api/checkin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: checkinBody,
  });

  // A valid Hub credential can outlive a failed FairShift PIN sync. Repair the
  // downstream PIN from the authoritative Hub credential, then retry once.
  if (result.status === 401) {
    const repaired = await repairFairShiftPin(session).catch(() => false);
    if (repaired) {
      result = await forward('/api/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: checkinBody,
      });
    }
    if (result.status === 401) {
      return json(409, {
        error: 'Your Warehouse Hub sign-in is valid, but Cleaning could not sync your PIN to FairShift. Ask an Admin to reset your Hub PIN once, then try again.',
        code: 'FAIRSHIFT_PIN_OUT_OF_SYNC',
      });
    }
  }

  if (
    result.status >= 200 &&
    result.status < 300 &&
    action === 'finish' &&
    result.body?.ok !== false
  ) {
    const award = await awardBingoCoin(session.name, assignmentId);
    if (award) {
      result.body = {
        ...result.body,
        bingoCoinAwarded: award.awarded,
        bingoCoins: award.coins,
      };
    }
  }

  return json(result.status, result.body);
};
