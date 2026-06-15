/* =========================================================
   chat.js — Houston Control 1-on-1 team chat
   ---------------------------------------------------------
   Direct messages between any two signed-in users. Delivery is by
   short-interval polling (the client calls ?action=sync), which mirrors
   how hc_notifications already works — no websockets / no extra service.

   Endpoints (all require a valid Netlify Identity token):
     GET  ?action=roster                  -> { users:[{email,name,role}] }   people you can message
     GET  ?action=history&with=<email>    -> { messages:[...] }              last 50 with that person (marks their msgs read)
     GET  ?action=sync[&since=<id>]       -> { messages:[...], unread:{email:n}, maxId }
                                            baseline (no since) returns just unread + maxId;
                                            with since returns new messages involving the caller.
     POST ?action=send  {to, body}        -> { message }
     POST ?action=read  {with}            -> marks messages from <with> as read
   ========================================================= */

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : undefined,
});

const IDENTITY_URL = 'https://inboundswagup.netlify.app/.netlify/identity';
const MAX_BODY = 4000; // characters per message

function json(code, body) {
  return {
    statusCode: code,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

let _schemaReady = false;
async function ensureSchema() {
  if (_schemaReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hc_chat_messages (
      id              BIGSERIAL PRIMARY KEY,
      sender_email    TEXT NOT NULL,
      recipient_email TEXT NOT NULL,
      body            TEXT NOT NULL,
      read            BOOLEAN DEFAULT false,
      created_at      TIMESTAMPTZ DEFAULT now()
    )
  `);
  // Index the common lookups: a person's inbox and a pair's thread.
  await pool.query(`CREATE INDEX IF NOT EXISTS hc_chat_recipient_idx ON hc_chat_messages (recipient_email, read)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS hc_chat_pair_idx ON hc_chat_messages (sender_email, recipient_email, id)`);
  _schemaReady = true;
}

// Resolve the caller from their Identity token -> { email, name }, or null.
async function getCaller(event) {
  const auth  = event.headers['authorization'] || event.headers['Authorization'] || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  let user;
  try {
    const res = await fetch(`${IDENTITY_URL}/user`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    user = await res.json();
  } catch (_) { return null; }
  if (!user || !user.email) return null;

  const email = String(user.email).trim().toLowerCase();
  // Must be a known, non-suspended user — same gate the rest of the app uses.
  let name = (user.user_metadata && (user.user_metadata.full_name || user.user_metadata.name)) || email;
  try {
    const r = await pool.query('SELECT name, suspended FROM hc_users WHERE LOWER(email)=$1', [email]);
    if (!r.rows.length) return null;            // not an invited user
    if (r.rows[0].suspended) return null;       // suspended -> no access
    if (r.rows[0].name && r.rows[0].name.trim()) name = r.rows[0].name.trim();
  } catch (e) {
    // DB blip — accept a validly-signed token rather than locking chat out.
    console.warn('chat: hc_users lookup failed, accepting valid token:', e.message);
  }
  return { email, name };
}

const ROLE_RANK = { admin: 0, manager: 1, l2: 2, l1: 3, external: 4 };

function shapeMessage(row) {
  return {
    id:        String(row.id),
    from:      row.sender_email,
    to:        row.recipient_email,
    body:      row.body,
    read:      !!row.read,
    createdAt: row.created_at,
  };
}

exports.handler = async function (event) {
  const method = event.httpMethod;
  const params = event.queryStringParameters || {};
  const action = params.action;

  let caller;
  try {
    await ensureSchema();
    caller = await getCaller(event);
  } catch (e) {
    console.error('chat: setup error', e.message);
    return json(500, { error: 'Server error' });
  }
  if (!caller) return json(401, { error: 'Authentication required' });
  const me = caller.email;

  // ── GET ?action=roster — who I can message ───────────────────
  if (method === 'GET' && action === 'roster') {
    const r = await pool.query(
      `SELECT email, name, role FROM hc_users
        WHERE suspended IS NOT TRUE AND LOWER(email) <> $1
        ORDER BY COALESCE(NULLIF(name,''), email)`,
      [me]
    );
    const users = r.rows
      .map(u => ({ email: u.email, name: (u.name && u.name.trim()) || u.email, role: u.role || 'l1' }))
      .sort((a, b) => (ROLE_RANK[a.role] ?? 9) - (ROLE_RANK[b.role] ?? 9) || a.name.localeCompare(b.name));
    return json(200, { users });
  }

  // ── GET ?action=history&with=<email> — load a thread ─────────
  if (method === 'GET' && action === 'history') {
    const other = String(params.with || '').trim().toLowerCase();
    if (!other) return json(400, { error: 'with required' });

    const r = await pool.query(
      `SELECT * FROM hc_chat_messages
        WHERE (sender_email=$1 AND recipient_email=$2)
           OR (sender_email=$2 AND recipient_email=$1)
        ORDER BY id DESC LIMIT 50`,
      [me, other]
    );
    // Mark their messages to me as read now that I'm viewing the thread.
    await pool.query(
      `UPDATE hc_chat_messages SET read=true
        WHERE recipient_email=$1 AND sender_email=$2 AND read=false`,
      [me, other]
    );
    return json(200, { messages: r.rows.reverse().map(shapeMessage) });
  }

  // ── GET ?action=sync[&since=<id>] — poll for the badge + open windows
  if (method === 'GET' && action === 'sync') {
    const since = params.since != null ? String(params.since).replace(/[^0-9]/g, '') : '';

    // Per-sender unread counts power the launcher badge + per-contact dots.
    const unreadRows = await pool.query(
      `SELECT sender_email, COUNT(*)::int AS n
         FROM hc_chat_messages
        WHERE recipient_email=$1 AND read=false
        GROUP BY sender_email`,
      [me]
    );
    const unread = {};
    let unreadTotal = 0;
    for (const row of unreadRows.rows) { unread[row.sender_email] = row.n; unreadTotal += row.n; }

    const maxRow = await pool.query(
      `SELECT COALESCE(MAX(id),0) AS m FROM hc_chat_messages
        WHERE recipient_email=$1 OR sender_email=$1`,
      [me]
    );
    const maxId = String(maxRow.rows[0].m);

    let messages = [];
    if (since) {
      const r = await pool.query(
        `SELECT * FROM hc_chat_messages
          WHERE (recipient_email=$1 OR sender_email=$1) AND id > $2
          ORDER BY id ASC LIMIT 200`,
        [me, since]
      );
      messages = r.rows.map(shapeMessage);
    }
    return json(200, { messages, unread, unreadTotal, maxId });
  }

  // ── POST ?action=send {to, body} ─────────────────────────────
  if (method === 'POST' && action === 'send') {
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON' }); }
    const to   = String(body.to || '').trim().toLowerCase();
    const text = String(body.body || '').trim().slice(0, MAX_BODY);
    if (!to || !text) return json(400, { error: 'to and body required' });
    if (to === me)    return json(400, { error: 'Cannot message yourself' });

    // Recipient must be a real, non-suspended user.
    const exists = await pool.query(
      'SELECT 1 FROM hc_users WHERE LOWER(email)=$1 AND suspended IS NOT TRUE', [to]
    );
    if (!exists.rows.length) return json(404, { error: 'Recipient not found' });

    const ins = await pool.query(
      `INSERT INTO hc_chat_messages (sender_email, recipient_email, body)
       VALUES ($1,$2,$3) RETURNING *`,
      [me, to, text]
    );
    return json(200, { message: shapeMessage(ins.rows[0]) });
  }

  // ── POST ?action=read {with} — mark a thread read ────────────
  if (method === 'POST' && action === 'read') {
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON' }); }
    const other = String(body.with || '').trim().toLowerCase();
    if (!other) return json(400, { error: 'with required' });
    await pool.query(
      `UPDATE hc_chat_messages SET read=true
        WHERE recipient_email=$1 AND sender_email=$2 AND read=false`,
      [me, other]
    );
    return json(200, { ok: true });
  }

  return json(405, { error: 'Method not allowed' });
};
