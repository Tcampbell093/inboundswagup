
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
    CREATE TABLE IF NOT EXISTS policy_sync_state (
      state_key TEXT PRIMARY KEY,
      entries_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      docs_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    INSERT INTO policy_sync_state (state_key, entries_json, docs_json)
    VALUES ('default', '[]'::jsonb, '[]'::jsonb)
    ON CONFLICT (state_key) DO NOTHING;
  `);
  schemaReady = true;
}
exports.handler = async function handler(event) {
  if (!process.env.DATABASE_URL) return json(500, { error: 'DATABASE_URL is not configured' });
  try {
    await ensureSchema();
    if (event.httpMethod === 'GET') {
      const result = await pool.query(`SELECT entries_json, docs_json, updated_at FROM policy_sync_state WHERE state_key='default' LIMIT 1;`);
      const row = result.rows[0] || { entries_json: [], docs_json: [], updated_at: null };
      return json(200, { entries: row.entries_json || [], docs: row.docs_json || [], updated_at: row.updated_at });
    }
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const entries = Array.isArray(body.entries) ? body.entries : [];
      const docs = Array.isArray(body.docs) ? body.docs : [];
      const result = await pool.query(
        `INSERT INTO policy_sync_state (state_key, entries_json, docs_json, updated_at)
         VALUES ('default', $1::jsonb, $2::jsonb, NOW())
         ON CONFLICT (state_key)
         DO UPDATE SET entries_json=EXCLUDED.entries_json, docs_json=EXCLUDED.docs_json, updated_at=NOW()
         RETURNING entries_json, docs_json, updated_at;`,
        [JSON.stringify(entries), JSON.stringify(docs)]
      );
      return json(200, { ok: true, entries: result.rows[0].entries_json, docs: result.rows[0].docs_json, updated_at: result.rows[0].updated_at });
    }
    return json(405, { error: 'Method not allowed' });
  } catch (error) {
    return json(500, { error: error.message || 'Unknown policy sync error' });
  }
};
