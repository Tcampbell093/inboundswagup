const crypto = require('crypto');
const { Pool } = require('pg');

const FAIRSHIFT_BASE = 'https://fairshift-rotations.thandoyordani.chatgpt.site';
const SESSION_COOKIE = 'hub_associate_session';
const SESSION_VERSION = 2;
let poolInstance = null;
let bingoSchemaReady = false;

function env(name) {
  return globalThis.Netlify?.env?.get(name) || '';
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

function cleanText(value, max = 120) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function slug(value) {
  return cleanText(value, 100).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
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

function cookieValue(event, name) {
  const raw = event.headers?.cookie || event.headers?.Cookie || '';
  for (const part of String(raw).split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${name}=`)) return trimmed.slice(name.length + 1);
  }
  return '';
}

function sessionFromEvent(event) {
  try {
    const key = sessionKey();
    const token = cookieValue(event, SESSION_COOKIE);
    if (!key || !token) return null;
    const [ivText, tagText, dataText] = token.split('.');
    if (!ivText || !tagText || !dataText) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivText, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
    const plain = Buffer.concat([decipher.update(Buffer.from(dataText, 'base64url')), decipher.final()]).toString('utf8');
    const payload = JSON.parse(plain);
    if (payload?.v !== SESSION_VERSION || payload?.fairShiftVerified !== true || !payload?.name || !payload?.pin || Number(payload.exp || 0) <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

async function forwardResult(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let body;
    try { body = text ? JSON.parse(text) : {}; }
    catch { body = { error: 'FairShift returned an unreadable response.' }; }
    return { statusCode: response.status, body };
  } catch (error) {
    return {
      statusCode: 502,
      body: { error: error?.name === 'AbortError' ? 'FairShift took too long to respond.' : 'FairShift check-in is temporarily unavailable.' },
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
      `, [sourceKey, employeeKey, cleanText(employeeName, 100), assignmentId]);

      if (inserted.rowCount) {
        const wallet = await client.query(`
          INSERT INTO hub_bingo_wallet(employee_key,employee_name,coins,updated_at)
          VALUES($1,$2,1,NOW())
          ON CONFLICT(employee_key) DO UPDATE SET
            employee_name=EXCLUDED.employee_name,
            coins=hub_bingo_wallet.coins + 1,
            updated_at=NOW()
          RETURNING coins
        `, [employeeKey, cleanText(employeeName, 100)]);
        await client.query('COMMIT');
        return { awarded: true, coins: Number(wallet.rows[0]?.coins || 0) };
      }

      const wallet = await client.query(`SELECT coins FROM hub_bingo_wallet WHERE employee_key=$1 LIMIT 1`, [employeeKey]);
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

exports.handler = async function handler(event) {
  if (event.httpMethod === 'GET') {
    const assignmentId = Number(event.queryStringParameters?.assignmentId);
    if (!assignmentId) return json(400, { error: 'A valid assignment ID is required.' });
    const result = await forwardResult(`${FAIRSHIFT_BASE}/api/checkin?assignmentId=${encodeURIComponent(assignmentId)}`, {
      headers: { Accept: 'application/json' },
    });
    return json(result.statusCode, result.body);
  }

  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { error: 'Invalid request body.' }); }

  const action = cleanText(body.action, 12);
  const assignmentId = Number(body.assignmentId);
  const session = sessionFromEvent(event);
  const manualEmployeeName = cleanText(body.employeeName, 100);
  const manualPin = cleanText(body.pin, 8);

  if (!['start', 'finish'].includes(action)) return json(400, { error: 'Invalid cleaning action.' });
  if (!assignmentId) return json(400, { error: 'A valid assignment ID is required.' });

  if (!session && (!manualEmployeeName || !/^\d{4,8}$/.test(manualPin))) {
    return json(401, { error: 'Please sign in to the Hub again before updating cleaning. Your previous session cannot be used for direct cleaning.' });
  }

  const employeeName = cleanText(session?.name || manualEmployeeName, 100);
  const pin = cleanText(session?.pin || manualPin, 8);
  const result = await forwardResult(`${FAIRSHIFT_BASE}/api/checkin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ action, assignmentId, employeeName, pin }),
  });

  if (result.statusCode >= 200 && result.statusCode < 300 && action === 'finish' && result.body?.ok !== false) {
    const award = await awardBingoCoin(employeeName, assignmentId);
    if (award) {
      result.body = {
        ...result.body,
        bingoCoinAwarded: award.awarded,
        bingoCoins: award.coins,
      };
    }
  }

  return json(result.statusCode, result.body);
};
