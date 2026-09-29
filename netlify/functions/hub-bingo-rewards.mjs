import pg from 'pg';
import crypto from 'node:crypto';

const { Pool } = pg;
const SESSION_COOKIE = 'hub_associate_session';
const SESSION_VERSION = 2;
let poolInstance = null;
let schemaReady = false;

function env(name) {
  return globalThis.Netlify?.env?.get(name) || '';
}

function getPool() {
  const connectionString = env('DATABASE_URL');
  if (!connectionString) throw new Error('DATABASE_URL is not configured.');
  if (!poolInstance) poolInstance = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  return poolInstance;
}

function clean(value, max = 300) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
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

function decryptHubSession(token) {
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
    if (payload?.v !== SESSION_VERSION || !payload?.name || Number(payload.exp || 0) <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function rewardAdminSession(request) {
  const session = decryptHubSession(cookieMap(request)[SESSION_COOKIE]);
  const role = clean(session?.role, 50).toLowerCase();
  return session && (role === 'manager' || role === 'team lead') ? session : null;
}

async function ensureSchema() {
  if (schemaReady) return;
  const db = getPool();
  await db.query(`
    CREATE TABLE IF NOT EXISTS hub_bingo_rewards (
      round_key TEXT NOT NULL,
      employee_key TEXT NOT NULL,
      employee_name TEXT NOT NULL,
      won_at TIMESTAMPTZ NOT NULL,
      rewarded_at TIMESTAMPTZ,
      rewarded_by TEXT NOT NULL DEFAULT '',
      rewarded_by_role TEXT NOT NULL DEFAULT '',
      reward_note TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(round_key, employee_key)
    );
    CREATE INDEX IF NOT EXISTS hub_bingo_rewards_rewarded_idx
      ON hub_bingo_rewards(rewarded_at DESC);
  `);
  schemaReady = true;
}

async function rewardLedger(db) {
  const result = await db.query(`
    SELECT
      p.round_key,
      p.employee_key,
      p.employee_name,
      p.won_at,
      r.rewarded_at,
      COALESCE(r.rewarded_by,'') AS rewarded_by,
      COALESCE(r.rewarded_by_role,'') AS rewarded_by_role,
      COALESCE(r.reward_note,'') AS reward_note
    FROM hub_bingo_players p
    LEFT JOIN hub_bingo_rewards r
      ON r.round_key=p.round_key AND r.employee_key=p.employee_key
    WHERE p.won_at IS NOT NULL
    ORDER BY
      CASE WHEN r.rewarded_at IS NULL THEN 0 ELSE 1 END,
      p.won_at DESC,
      p.employee_name ASC
    LIMIT 1000
  `);

  const rows = result.rows.map((row) => ({
    roundKey: row.round_key,
    employeeKey: row.employee_key,
    employeeName: row.employee_name,
    wonAt: row.won_at || null,
    rewardedAt: row.rewarded_at || null,
    rewardedBy: row.rewarded_by || '',
    rewardedByRole: row.rewarded_by_role || '',
    rewardNote: row.reward_note || '',
    status: row.rewarded_at ? 'given' : 'pending',
  }));

  return {
    pendingCount: rows.filter((row) => row.status === 'pending').length,
    pending: rows.filter((row) => row.status === 'pending'),
    history: rows.filter((row) => row.status === 'given'),
  };
}

async function markRewardGiven(db, session, body) {
  const roundKey = clean(body.roundKey, 40);
  const employeeKey = clean(body.employeeKey, 100);
  const rewardNote = clean(body.rewardNote, 500);
  if (!roundKey || !employeeKey) throw new Error('Winner information is missing.');

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const winnerResult = await client.query(`
      SELECT round_key,employee_key,employee_name,won_at
      FROM hub_bingo_players
      WHERE round_key=$1 AND employee_key=$2 AND won_at IS NOT NULL
      FOR UPDATE
    `, [roundKey, employeeKey]);
    const winner = winnerResult.rows[0];
    if (!winner) {
      await client.query('ROLLBACK');
      return { status: 404, body: { error: 'That Bingo win could not be found.' } };
    }

    const existingResult = await client.query(`
      SELECT rewarded_at,rewarded_by,reward_note
      FROM hub_bingo_rewards
      WHERE round_key=$1 AND employee_key=$2
      FOR UPDATE
    `, [roundKey, employeeKey]);
    const existing = existingResult.rows[0];
    if (existing?.rewarded_at) {
      await client.query('ROLLBACK');
      return {
        status: 409,
        body: {
          error: `Reward already marked given by ${existing.rewarded_by || 'an admin/team lead'}.`,
          alreadyGiven: true,
          rewardedAt: existing.rewarded_at,
          rewardedBy: existing.rewarded_by || '',
          rewardNote: existing.reward_note || '',
        },
      };
    }

    const role = clean(session.role, 50);
    await client.query(`
      INSERT INTO hub_bingo_rewards(
        round_key,employee_key,employee_name,won_at,
        rewarded_at,rewarded_by,rewarded_by_role,reward_note,updated_at
      )
      VALUES($1,$2,$3,$4,NOW(),$5,$6,$7,NOW())
      ON CONFLICT(round_key,employee_key) DO UPDATE SET
        employee_name=EXCLUDED.employee_name,
        won_at=EXCLUDED.won_at,
        rewarded_at=CASE
          WHEN hub_bingo_rewards.rewarded_at IS NULL THEN NOW()
          ELSE hub_bingo_rewards.rewarded_at
        END,
        rewarded_by=CASE
          WHEN hub_bingo_rewards.rewarded_at IS NULL THEN EXCLUDED.rewarded_by
          ELSE hub_bingo_rewards.rewarded_by
        END,
        rewarded_by_role=CASE
          WHEN hub_bingo_rewards.rewarded_at IS NULL THEN EXCLUDED.rewarded_by_role
          ELSE hub_bingo_rewards.rewarded_by_role
        END,
        reward_note=CASE
          WHEN hub_bingo_rewards.rewarded_at IS NULL THEN EXCLUDED.reward_note
          ELSE hub_bingo_rewards.reward_note
        END,
        updated_at=NOW()
    `, [
      winner.round_key,
      winner.employee_key,
      clean(winner.employee_name, 100),
      winner.won_at,
      clean(session.name, 100),
      role,
      rewardNote,
    ]);

    await client.query('COMMIT');
    return {
      status: 200,
      body: {
        ok: true,
        message: `Reward marked given to ${clean(winner.employee_name, 100)}.`,
      },
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export default async (request) => {
  try {
    const session = rewardAdminSession(request);
    if (!session) return json(403, { error: 'Admin or Team Lead access is required.' });

    await ensureSchema();
    const db = getPool();

    if (request.method === 'GET') {
      return json(200, {
        ok: true,
        viewer: {
          name: clean(session.name, 100),
          role: clean(session.role, 50),
        },
        ...(await rewardLedger(db)),
      });
    }

    if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });
    const body = await request.json().catch(() => ({}));
    const action = clean(body.action, 40);

    if (action === 'markGiven') {
      const result = await markRewardGiven(db, session, body);
      return json(result.status, result.body);
    }

    return json(400, { error: 'Unsupported reward action.' });
  } catch (error) {
    return json(400, { error: clean(error?.message || 'Bingo rewards are temporarily unavailable.', 300) });
  }
};

export const config = { path: '/api/bingo-rewards' };
