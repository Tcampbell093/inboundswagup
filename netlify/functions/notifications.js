/* =========================================================
   notifications.js — Houston Control
   GET  ?action=list   — get unread notifications for admin
   POST ?action=read   — mark notification(s) as read
   ========================================================= */

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : undefined,
});

const GOTRUE_URL = 'https://inboundswagup.netlify.app/.netlify/identity';

function json(code, body) {
  return {
    statusCode: code,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hc_notifications (
      id           SERIAL PRIMARY KEY,
      type         TEXT,
      target_email TEXT,
      message      TEXT,
      read         BOOLEAN DEFAULT false,
      created_at   TIMESTAMPTZ DEFAULT now()
    )
  `);
}

async function getCallerEmail(event) {
  const auth  = event.headers['authorization'] || event.headers['Authorization'] || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return null;
  const res = await fetch(`${GOTRUE_URL}/user`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) return null;
  const user = await res.json();
  return user?.email || null;
}

exports.handler = async function(event) {
  const method = event.httpMethod;
  const action = (event.queryStringParameters || {}).action;

  await ensureSchema();

  if (method === 'GET' && action === 'list') {
    const email = await getCallerEmail(event);
    if (!email) return json(401, { error: 'Unauthorized' });

    const result = await pool.query(
      `SELECT * FROM hc_notifications
       WHERE target_email=$1 AND read=false
       ORDER BY created_at DESC LIMIT 20`,
      [email]
    );
    return json(200, { notifications: result.rows });
  }

  if (method === 'POST' && action === 'read') {
    const email = await getCallerEmail(event);
    if (!email) return json(401, { error: 'Unauthorized' });

    const { id } = JSON.parse(event.body || '{}');
    if (id) {
      await pool.query(
        `UPDATE hc_notifications SET read=true WHERE id=$1 AND target_email=$2`,
        [id, email]
      );
    } else {
      // Mark all as read
      await pool.query(
        `UPDATE hc_notifications SET read=true WHERE target_email=$1`,
        [email]
      );
    }
    return json(200, { ok: true });
  }

  return json(405, { error: 'Method not allowed' });
};
