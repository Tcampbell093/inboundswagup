import pg from 'pg';
import crypto from 'node:crypto';

const { Pool } = pg;
const FAIRSHIFT_BASE = 'https://fairshift-rotations.thandoyordani.chatgpt.site';
const SESSION_COOKIE = 'hub_associate_session';
const SESSION_VERSION = 2;
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
      payload?.fairShiftVerified !== true ||
      !payload?.name ||
      !payload?.pin ||
      Number(payload.exp || 0) <= Date.now()
    ) return null;
    return payload;
  } catch {
    return null;
  }
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

  const body = await request.json().catch(() => ({}));
  const action = clean(body.action, 12);
  const assignmentId = Number(body.assignmentId);

  if (!['start', 'finish'].includes(action)) return json(400, { error: 'Invalid cleaning action.' });
  if (!assignmentId) return json(400, { error: 'A valid assignment ID is required.' });

  const result = await forward('/api/checkin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action,
      assignmentId,
      employeeName: clean(session.name, 100),
      pin: clean(session.pin, 8),
    }),
  });

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
