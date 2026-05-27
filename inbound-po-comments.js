/* =========================================================
   inbound-po-comments.js — Houston Control
   Per-PO comment threads for the Inbound Flight Tracker.
   Mirrors the patterns of flight-tracker-comments.js but
   keyed on PO number instead of pack-builder id / SO.

   GET    /.netlify/functions/inbound-po-comments?po_num=PO-123
          → { comments: [...] }
   GET    /.netlify/functions/inbound-po-comments?latest=500
          → recent comments (used for batch-count rendering)
   GET    /.netlify/functions/inbound-po-comments?unread_for=<email>
          → { count: N }
   POST   body: { po_num, author_name, category, body }
          → { comment: {...} }
   PATCH  body: { reader, po_num? }
          → marks po_num's thread (or all) read for that reader
   ========================================================= */
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : undefined,
});

let schemaReady = false;
const ALLOWED_CATEGORIES = ['general', 'question', 'instructions', 'priority', 'vendor_issue', 'damage_report'];

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

async function ensureSchema() {
  if (schemaReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS inbound_po_comments (
      id           BIGSERIAL PRIMARY KEY,
      po_num       TEXT NOT NULL,
      author_name  TEXT NOT NULL DEFAULT 'Stakeholder',
      category     TEXT NOT NULL DEFAULT 'general',
      body         TEXT NOT NULL,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      read_by      TEXT[] NOT NULL DEFAULT '{}'
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_ipc_po_num ON inbound_po_comments (po_num);`);
  schemaReady = true;
}

exports.handler = async function handler(event) {
  if (!process.env.DATABASE_URL) return json(500, { error: 'DATABASE_URL is not configured' });
  try {
    await ensureSchema();

    if (event.httpMethod === 'GET') {
      const params = event.queryStringParameters || {};

      // Unread count for a reader (used for nav badge if we ever want one)
      if (params.unread_for) {
        const email = String(params.unread_for).trim().toLowerCase();
        const result = await pool.query(
          `SELECT COUNT(*)::int AS count FROM inbound_po_comments
            WHERE NOT ($1 = ANY(read_by));`,
          [email]
        );
        return json(200, { count: result.rows[0].count });
      }

      // Latest N — used by the board to build per-PO counts client-side
      if (params.latest) {
        const limit = Math.min(Math.max(1, parseInt(params.latest, 10) || 1), 500);
        const result = await pool.query(
          `SELECT id, po_num, author_name, category, body, created_at, read_by
             FROM inbound_po_comments ORDER BY id DESC LIMIT $1;`,
          [limit]
        );
        return json(200, { comments: result.rows });
      }

      // Single PO thread
      const poNum = String(params.po_num || '').trim();
      if (!poNum) return json(400, { error: 'po_num, latest, or unread_for is required' });
      const result = await pool.query(
        `SELECT id, po_num, author_name, category, body, created_at, read_by
           FROM inbound_po_comments WHERE LOWER(po_num) = LOWER($1)
           ORDER BY created_at ASC;`,
        [poNum]
      );
      return json(200, { comments: result.rows });
    }

    if (event.httpMethod === 'POST') {
      let body;
      try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON body' }); }
      const poNum       = String(body.po_num || '').trim();
      const authorName  = String(body.author_name || 'Stakeholder').trim().slice(0, 80);
      const category    = ALLOWED_CATEGORIES.includes(body.category) ? body.category : 'general';
      const commentBody = String(body.body || '').trim();
      if (!poNum)        return json(400, { error: 'po_num is required' });
      if (!commentBody)  return json(400, { error: 'Comment body is required' });
      if (commentBody.length > 2000) return json(400, { error: 'Comment exceeds 2000 characters' });
      const result = await pool.query(
        `INSERT INTO inbound_po_comments (po_num, author_name, category, body, read_by)
         VALUES ($1,$2,$3,$4, ARRAY[LOWER($2)])
         RETURNING id, po_num, author_name, category, body, created_at, read_by;`,
        [poNum, authorName, category, commentBody]
      );
      return json(201, { comment: result.rows[0] });
    }

    // PATCH — mark a PO's thread (or all) read for a reader
    if (event.httpMethod === 'PATCH') {
      let body;
      try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON' }); }
      const reader = String(body.reader || '').trim().toLowerCase();
      if (!reader) return json(400, { error: 'reader is required' });
      const poNum = String(body.po_num || '').trim();
      if (poNum) {
        await pool.query(
          `UPDATE inbound_po_comments
              SET read_by = array_append(read_by, $1)
            WHERE LOWER(po_num) = LOWER($2) AND NOT ($1 = ANY(read_by));`,
          [reader, poNum]
        );
      } else {
        await pool.query(
          `UPDATE inbound_po_comments
              SET read_by = array_append(read_by, $1)
            WHERE NOT ($1 = ANY(read_by));`,
          [reader]
        );
      }
      return json(200, { ok: true });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (error) {
    console.error('inbound-po-comments error:', error);
    return json(500, { error: error.message || 'Internal server error' });
  }
};
