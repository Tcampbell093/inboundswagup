/* =========================================================
   inbound-po-priorities.js — Houston Control
   Persistent per-PO priority flags + pre-arrival watch list.
   Shared across all users.

   GET    /.netlify/functions/inbound-po-priorities
          → { priorities: [{ po_num, note, set_by, set_at }] }

   POST   /.netlify/functions/inbound-po-priorities
          body: { poNum, note, setBy }
          → { ok:true, priority: {...} }
          (Upsert — flagging an already-flagged PO is a no-op)

   DELETE /.netlify/functions/inbound-po-priorities?po=<poNum>
          → { ok:true }
   ========================================================= */
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : undefined,
});

let schemaReady = false;
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
    CREATE TABLE IF NOT EXISTS inbound_po_priorities (
      po_num TEXT PRIMARY KEY,
      note   TEXT,
      set_by TEXT,
      set_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  schemaReady = true;
}

exports.handler = async function handler(event) {
  if (!process.env.DATABASE_URL) return json(500, { error: 'DATABASE_URL is not configured' });
  try {
    await ensureSchema();

    if (event.httpMethod === 'GET') {
      const result = await pool.query(
        `SELECT po_num, note, set_by, set_at FROM inbound_po_priorities ORDER BY set_at DESC;`
      );
      return json(200, { priorities: result.rows });
    }

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const poNum = String(body.poNum || '').trim();
      if (!poNum) return json(400, { error: 'poNum required' });
      const note  = String(body.note  || '').slice(0, 500);
      const setBy = String(body.setBy || '').slice(0, 120);
      const result = await pool.query(
        `INSERT INTO inbound_po_priorities (po_num, note, set_by, set_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (po_num) DO UPDATE
           SET note   = COALESCE(NULLIF(EXCLUDED.note, ''), inbound_po_priorities.note),
               set_by = COALESCE(NULLIF(EXCLUDED.set_by, ''), inbound_po_priorities.set_by)
         RETURNING po_num, note, set_by, set_at;`,
        [poNum, note, setBy]
      );
      return json(200, { ok: true, priority: result.rows[0] });
    }

    if (event.httpMethod === 'DELETE') {
      const q = event.queryStringParameters || {};
      const poNum = String(q.po || '').trim();
      if (!poNum) return json(400, { error: 'po query param required' });
      await pool.query(`DELETE FROM inbound_po_priorities WHERE po_num = $1;`, [poNum]);
      return json(200, { ok: true });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (error) {
    return json(500, { error: error.message || 'Unknown priorities error' });
  }
};
