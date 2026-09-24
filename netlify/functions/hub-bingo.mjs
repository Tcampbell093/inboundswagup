import pg from 'pg';
import crypto from 'node:crypto';

const { Pool } = pg;
const SESSION_COOKIE = 'hub_associate_session';
const SESSION_VERSION = 2;
const ROUND_ANCHOR = '2026-09-21';
const ROUND_DAYS = 28;
const SYMBOLS = ['⭐','🎵','☕','🚗','🌴','🌮','🍕','🎬','🍩','⚽','🎧','🌞','🍓','🎈','🥤','🎲'];
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

function clean(value, max = 200) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function slug(value) {
  return clean(value, 100).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
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
    if (
      payload?.v !== SESSION_VERSION ||
      payload?.fairShiftVerified !== true ||
      !payload?.name ||
      Number(payload.exp || 0) <= Date.now()
    ) return null;
    return payload;
  } catch {
    return null;
  }
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

function epochDay(dateText) {
  const [y, m, d] = String(dateText).split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

function dateFromEpoch(day) {
  const date = new Date(day * 86400000);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function roundInfo() {
  const current = easternDate();
  const currentDay = epochDay(current);
  const anchorDay = epochDay(ROUND_ANCHOR);
  const cycle = Math.floor((currentDay - anchorDay) / ROUND_DAYS);
  const startDay = anchorDay + cycle * ROUND_DAYS;
  const endDay = startDay + ROUND_DAYS - 1;
  const weekNumber = Math.max(1, Math.floor((currentDay - startDay) / 7) + 1);
  const start = dateFromEpoch(startDay);
  return {
    key: start,
    start,
    end: dateFromEpoch(endDay),
    daysLeft: Math.max(0, endDay - currentDay + 1),
    weekKey: `${start}:w${weekNumber}`,
  };
}

function shuffle(values) {
  const list = [...values];
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

function makeCard() {
  const chosen = shuffle(SYMBOLS).slice(0, 8);
  return [chosen[0], chosen[1], chosen[2], chosen[3], 'FREE', chosen[4], chosen[5], chosen[6], chosen[7]];
}

function hasBingo(marked) {
  const set = new Set((Array.isArray(marked) ? marked : []).map(Number));
  const lines = [
    [0,1,2],[3,4,5],[6,7,8],
    [0,3,6],[1,4,7],[2,5,8],
    [0,4,8],[2,4,6],
  ];
  return lines.some((line) => line.every((index) => set.has(index)));
}

async function ensureSchema() {
  if (schemaReady) return;
  const pool = getPool();
  await pool.query(`
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

    CREATE TABLE IF NOT EXISTS hub_bingo_players (
      round_key TEXT NOT NULL,
      employee_key TEXT NOT NULL,
      employee_name TEXT NOT NULL,
      employee_id BIGINT,
      card JSONB NOT NULL,
      marked JSONB NOT NULL DEFAULT '[4]'::jsonb,
      drawn JSONB NOT NULL DEFAULT '[]'::jsonb,
      weekly_free_key TEXT,
      won_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (round_key, employee_key)
    );

    CREATE INDEX IF NOT EXISTS hub_bingo_players_round_idx ON hub_bingo_players(round_key);
  `);
  schemaReady = true;
}

async function ensurePlayer(client, session, round) {
  const employeeKey = slug(session.name);
  await client.query(`
    INSERT INTO hub_bingo_wallet(employee_key, employee_name, coins, updated_at)
    VALUES($1,$2,0,NOW())
    ON CONFLICT(employee_key) DO UPDATE SET employee_name=EXCLUDED.employee_name, updated_at=NOW()
  `, [employeeKey, clean(session.name, 100)]);

  let result = await client.query(`
    SELECT round_key,employee_key,employee_name,employee_id,card,marked,drawn,weekly_free_key,won_at
    FROM hub_bingo_players
    WHERE round_key=$1 AND employee_key=$2
    LIMIT 1
  `, [round.key, employeeKey]);

  if (!result.rows[0]) {
    const card = makeCard();
    await client.query(`
      INSERT INTO hub_bingo_players(round_key,employee_key,employee_name,employee_id,card,marked,drawn,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5::jsonb,'[4]'::jsonb,'[]'::jsonb,NOW(),NOW())
      ON CONFLICT(round_key,employee_key) DO NOTHING
    `, [round.key, employeeKey, clean(session.name, 100), session.employeeId || null, JSON.stringify(card)]);
    result = await client.query(`
      SELECT round_key,employee_key,employee_name,employee_id,card,marked,drawn,weekly_free_key,won_at
      FROM hub_bingo_players
      WHERE round_key=$1 AND employee_key=$2
      LIMIT 1
    `, [round.key, employeeKey]);
  }
  return result.rows[0];
}

async function statePayload(client, session, round, extra = {}) {
  const player = await ensurePlayer(client, session, round);
  const employeeKey = slug(session.name);
  const [walletResult, statsResult] = await Promise.all([
    client.query(`SELECT coins FROM hub_bingo_wallet WHERE employee_key=$1 LIMIT 1`, [employeeKey]),
    client.query(`
      SELECT COUNT(*)::int AS players, COUNT(*) FILTER (WHERE won_at IS NOT NULL)::int AS winners
      FROM hub_bingo_players
      WHERE round_key=$1
    `, [round.key]),
  ]);
  const marked = Array.isArray(player.marked) ? player.marked.map(Number) : [4];
  const drawn = Array.isArray(player.drawn) ? player.drawn : [];
  return {
    ok: true,
    signedIn: true,
    player: {
      name: clean(session.name, 100),
      department: clean(session.department, 100),
      coins: Number(walletResult.rows[0]?.coins || 0),
      card: Array.isArray(player.card) ? player.card : [],
      marked,
      drawn,
      bingo: !!player.won_at || hasBingo(marked),
      weeklyFreeAvailable: player.weekly_free_key !== round.weekKey,
    },
    round: {
      start: round.start,
      end: round.end,
      daysLeft: round.daysLeft,
    },
    stats: {
      players: Number(statsResult.rows[0]?.players || 0),
      winners: Number(statsResult.rows[0]?.winners || 0),
    },
    ...extra,
  };
}

async function drawSymbol(session) {
  const pool = getPool();
  const client = await pool.connect();
  const round = roundInfo();
  const employeeKey = slug(session.name);
  try {
    await client.query('BEGIN');
    await ensurePlayer(client, session, round);

    const playerResult = await client.query(`
      SELECT round_key,employee_key,employee_name,employee_id,card,marked,drawn,weekly_free_key,won_at
      FROM hub_bingo_players
      WHERE round_key=$1 AND employee_key=$2
      FOR UPDATE
    `, [round.key, employeeKey]);
    const player = playerResult.rows[0];
    if (player.won_at || hasBingo(player.marked)) {
      await client.query('COMMIT');
      return { status: 409, body: await statePayload(client, session, round, { error: 'You already completed Bingo for this round.' }) };
    }

    const walletResult = await client.query(`SELECT coins FROM hub_bingo_wallet WHERE employee_key=$1 FOR UPDATE`, [employeeKey]);
    const coins = Number(walletResult.rows[0]?.coins || 0);
    const useFree = player.weekly_free_key !== round.weekKey;
    if (!useFree && coins < 1) {
      await client.query('COMMIT');
      return { status: 409, body: await statePayload(client, session, round, { error: 'You need a Bingo Coin to draw another symbol.' }) };
    }

    const drawn = Array.isArray(player.drawn) ? [...player.drawn] : [];
    const remaining = SYMBOLS.filter((symbol) => !drawn.includes(symbol));
    if (!remaining.length) {
      await client.query('COMMIT');
      return { status: 409, body: await statePayload(client, session, round, { error: 'All symbols have already been drawn for this card.' }) };
    }

    const symbol = remaining[crypto.randomInt(remaining.length)];
    drawn.push(symbol);
    const card = Array.isArray(player.card) ? player.card : [];
    const marked = new Set((Array.isArray(player.marked) ? player.marked : [4]).map(Number));
    const cardIndex = card.indexOf(symbol);
    const matched = cardIndex >= 0;
    if (matched) marked.add(cardIndex);
    const markedArray = [...marked].sort((a, b) => a - b);
    const bingo = hasBingo(markedArray);

    if (!useFree) {
      await client.query(`UPDATE hub_bingo_wallet SET coins=coins-1,updated_at=NOW() WHERE employee_key=$1`, [employeeKey]);
    }

    await client.query(`
      UPDATE hub_bingo_players
      SET marked=$3::jsonb,
          drawn=$4::jsonb,
          weekly_free_key=$5,
          won_at=CASE WHEN $6 THEN COALESCE(won_at,NOW()) ELSE won_at END,
          updated_at=NOW()
      WHERE round_key=$1 AND employee_key=$2
    `, [
      round.key,
      employeeKey,
      JSON.stringify(markedArray),
      JSON.stringify(drawn),
      useFree ? round.weekKey : player.weekly_free_key,
      bingo,
    ]);

    await client.query('COMMIT');
    return {
      status: 200,
      body: await statePayload(client, session, round, {
        drawResult: { symbol, matched, usedFree: useFree, bingo },
      }),
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
    await ensureSchema();
    const session = decryptSession(cookieMap(request)[SESSION_COOKIE]);
    if (!session) return json(401, { signedIn: false, error: 'Sign in to the Hub to play Warehouse Bingo.' });

    if (request.method === 'GET') {
      const client = await getPool().connect();
      try {
        return json(200, await statePayload(client, session, roundInfo()));
      } finally {
        client.release();
      }
    }

    if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });
    const body = await request.json().catch(() => ({}));
    const action = clean(body.action, 30);
    if (action !== 'draw') return json(400, { error: 'Unsupported action.' });

    const result = await drawSymbol(session);
    return json(result.status, result.body);
  } catch (error) {
    return json(400, { error: clean(error?.message || 'Warehouse Bingo is temporarily unavailable.', 300) });
  }
};
