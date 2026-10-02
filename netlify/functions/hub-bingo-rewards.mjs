import pg from 'pg';
import crypto from 'node:crypto';

const { Pool } = pg;
const SESSION_COOKIE = 'hub_associate_session';
const SESSION_VERSION = 2;
const DEFAULT_BOARD_SIZE = 5;
const SUPPORTED_BOARD_SIZES = [3, 5];
const DEFAULT_ROUND_ANCHOR = '2026-09-21';
const BINGO_RULES_VERSION = 2;
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

function easternDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function normalizeBoardSize(value) {
  const size = Number(value);
  return SUPPORTED_BOARD_SIZES.includes(size) ? size : DEFAULT_BOARD_SIZE;
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

    CREATE TABLE IF NOT EXISTS hub_bingo_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      board_size INTEGER NOT NULL DEFAULT 5,
      anchor_date DATE NOT NULL DEFAULT '2026-09-21',
      reset_number INTEGER NOT NULL DEFAULT 0,
      reset_at TIMESTAMPTZ,
      reset_by TEXT NOT NULL DEFAULT '',
      rules_version INTEGER NOT NULL DEFAULT 1,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS hub_bingo_photos (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL DEFAULT '',
      mime_type TEXT NOT NULL,
      image_bytes BYTEA NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by TEXT NOT NULL DEFAULT '',
      removed_at TIMESTAMPTZ,
      removed_by TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS hub_bingo_photos_active_idx
      ON hub_bingo_photos(active, created_at DESC);

    INSERT INTO hub_bingo_settings(id,board_size,anchor_date,reset_number,reset_by,updated_at)
    VALUES(1,5,'2026-09-21',0,'',NOW())
    ON CONFLICT(id) DO NOTHING;

    ALTER TABLE hub_bingo_settings ADD COLUMN IF NOT EXISTS rules_version INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE IF EXISTS hub_bingo_players ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ;
    ALTER TABLE IF EXISTS hub_bingo_players ADD COLUMN IF NOT EXISTS void_reason TEXT NOT NULL DEFAULT '';
  `);

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const settings = await client.query(
      'SELECT rules_version FROM hub_bingo_settings WHERE id=1 FOR UPDATE'
    );
    if (Number(settings.rows[0]?.rules_version || 1) < BINGO_RULES_VERSION) {
      const currentRound = await client.query(`
        SELECT round_key
        FROM hub_bingo_players
        WHERE voided_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1
      `).catch(() => ({ rows: [] }));
      const oldRoundKey = clean(currentRound.rows[0]?.round_key, 60);
      if (oldRoundKey) {
        await client.query(`
          UPDATE hub_bingo_players
          SET voided_at=NOW(),void_reason='Fair play rules reset',updated_at=NOW()
          WHERE round_key=$1 AND voided_at IS NULL
        `, [oldRoundKey]);
      }
      await client.query(`
        UPDATE hub_bingo_settings
        SET anchor_date=$1,
            reset_number=reset_number+1,
            reset_at=NOW(),
            reset_by='Fair play rules update',
            rules_version=$2,
            updated_at=NOW()
        WHERE id=1
      `, [easternDate(), BINGO_RULES_VERSION]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  schemaReady = true;
}

async function bingoSettings(db) {
  const result = await db.query(`
    SELECT board_size,anchor_date,reset_number,reset_at,reset_by
    FROM hub_bingo_settings
    WHERE id=1
    LIMIT 1
  `);
  const row = result.rows[0] || {};
  return {
    boardSize: normalizeBoardSize(row.board_size),
    anchorDate: row.anchor_date ? String(row.anchor_date).slice(0, 10) : DEFAULT_ROUND_ANCHOR,
    resetNumber: Math.max(0, Number(row.reset_number || 0)),
    resetAt: row.reset_at || null,
    resetBy: clean(row.reset_by, 100),
  };
}

async function setBoardSize(db, session, body) {
  const size = Number(body.boardSize);
  if (!SUPPORTED_BOARD_SIZES.includes(size)) {
    return { status: 400, body: { error: 'Choose either a 3×3 or 5×5 Bingo board.' } };
  }
  await db.query(`
    UPDATE hub_bingo_settings
    SET board_size=$1,updated_at=NOW()
    WHERE id=1
  `, [size]);
  return {
    status: 200,
    body: {
      ok: true,
      message: `Bingo board size changed to ${size}×${size}. Current cards will resize when opened.`,
      settings: await bingoSettings(db),
    },
  };
}

async function resetBingoRound(db, session) {
  const today = easternDate();
  const client = await db.connect();
  let resetNumber = 0;
  try {
    await client.query('BEGIN');
    const currentRound = await client.query(`
      SELECT round_key
      FROM hub_bingo_players
      WHERE voided_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1
    `).catch(() => ({ rows: [] }));
    const oldRoundKey = clean(currentRound.rows[0]?.round_key, 60);
    if (oldRoundKey) {
      await client.query(`
        UPDATE hub_bingo_players
        SET voided_at=NOW(),void_reason='Admin round reset',updated_at=NOW()
        WHERE round_key=$1 AND voided_at IS NULL
      `, [oldRoundKey]);
    }
    const result = await client.query(`
      UPDATE hub_bingo_settings
      SET anchor_date=$1,
          reset_number=reset_number+1,
          reset_at=NOW(),
          reset_by=$2,
          updated_at=NOW()
      WHERE id=1
      RETURNING reset_number
    `, [today, clean(session.name, 100)]);
    resetNumber = Number(result.rows[0]?.reset_number || 0);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  return {
    status: 200,
    body: {
      ok: true,
      message: 'Bingo reset complete. Everyone has a fresh card and a new round starting today. Existing Bingo Coins and completed reward history were kept; unfinished wins from the reset round were archived.',
      resetNumber,
      settings: await bingoSettings(db),
    },
  };
}


function bingoPhotoUrl(id) {
  return `/api/bingo-photo?id=${encodeURIComponent(id)}`;
}

async function bingoPhotos(db) {
  const result = await db.query(`
    SELECT id,label,created_at,created_by
    FROM hub_bingo_photos
    WHERE active=TRUE
    ORDER BY created_at DESC,id ASC
  `);
  return result.rows.map((row) => ({
    id: row.id,
    label: clean(row.label, 100) || 'Bingo photo',
    url: bingoPhotoUrl(row.id),
    createdAt: row.created_at || null,
    createdBy: clean(row.created_by, 100),
  }));
}

function decodePhotoDataUrl(value) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(value || ''));
  if (!match) throw new Error('Choose a JPG, PNG, or WebP image.');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length) throw new Error('That photo could not be read.');
  if (bytes.length > 650000) throw new Error('That photo is too large after processing. Try a smaller image.');
  return { mimeType: match[1], bytes };
}

async function addBingoPhoto(db, session, body) {
  const { mimeType, bytes } = decodePhotoDataUrl(body.dataUrl);
  const id = crypto.randomUUID();
  const label = clean(body.label, 100) || 'Bingo photo';
  await db.query(`
    INSERT INTO hub_bingo_photos(id,label,mime_type,image_bytes,active,created_at,created_by)
    VALUES($1,$2,$3,$4,TRUE,NOW(),$5)
  `, [id, label, mimeType, bytes, clean(session.name, 100)]);
  return {
    status: 200,
    body: {
      ok: true,
      message: `${label} added to the Bingo photo pool.`,
      photo: { id, label, url: bingoPhotoUrl(id) },
      photos: await bingoPhotos(db),
    },
  };
}

async function removeBingoPhoto(db, session, body) {
  const id = clean(body.photoId, 80);
  if (!id) return { status: 400, body: { error: 'Photo information is missing.' } };
  const result = await db.query(`
    UPDATE hub_bingo_photos
    SET active=FALSE,removed_at=NOW(),removed_by=$2
    WHERE id=$1 AND active=TRUE
    RETURNING id,label
  `, [id, clean(session.name, 100)]);
  const row = result.rows[0];
  if (!row) return { status: 404, body: { error: 'That Bingo photo is no longer in the active pool.' } };
  return {
    status: 200,
    body: {
      ok: true,
      message: `${clean(row.label, 100) || 'Photo'} removed from future Bingo cards.`,
      photos: await bingoPhotos(db),
    },
  };
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
      AND (p.voided_at IS NULL OR r.rewarded_at IS NOT NULL)
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
        settings: await bingoSettings(db),
        photos: await bingoPhotos(db),
      });
    }

    if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });
    const body = await request.json().catch(() => ({}));
    const action = clean(body.action, 40);

    if (action === 'markGiven') {
      const result = await markRewardGiven(db, session, body);
      return json(result.status, result.body);
    }

    if (action === 'setBoardSize') {
      const result = await setBoardSize(db, session, body);
      return json(result.status, result.body);
    }

    if (action === 'resetRound') {
      const result = await resetBingoRound(db, session);
      return json(result.status, result.body);
    }

    if (action === 'addPhoto') {
      const result = await addBingoPhoto(db, session, body);
      return json(result.status, result.body);
    }

    if (action === 'removePhoto') {
      const result = await removeBingoPhoto(db, session, body);
      return json(result.status, result.body);
    }

    return json(400, { error: 'Unsupported Bingo admin action.' });
  } catch (error) {
    return json(400, { error: clean(error?.message || 'Bingo rewards are temporarily unavailable.', 300) });
  }
};

export const config = { path: '/api/bingo-rewards' };
