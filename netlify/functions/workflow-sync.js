
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
    CREATE TABLE IF NOT EXISTS workflow_sync_state (
      state_key TEXT PRIMARY KEY,
      data_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      masters_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    INSERT INTO workflow_sync_state (state_key, data_json, masters_json)
    VALUES ('default', '{}'::jsonb, '{}'::jsonb)
    ON CONFLICT (state_key) DO NOTHING;
  `);
  schemaReady = true;
}
exports.handler = async function handler(event) {
  if (!process.env.DATABASE_URL) return json(500, { error: 'DATABASE_URL is not configured' });
  try {
    await ensureSchema();
    if (event.httpMethod === 'GET') {
      const result = await pool.query(
        `SELECT data_json, masters_json, updated_at FROM workflow_sync_state WHERE state_key='default' LIMIT 1;`
      );
      const row = result.rows[0] || { data_json: {}, masters_json: {}, updated_at: null };
      return json(200, { data: row.data_json || {}, masters: row.masters_json || {}, updated_at: row.updated_at });
    }
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const data = body && typeof body.data === 'object' && body.data ? body.data : {};
      const masters = body && typeof body.masters === 'object' && body.masters ? body.masters : {};
      const result = await pool.query(
        `INSERT INTO workflow_sync_state (state_key, data_json, masters_json, updated_at)
         VALUES ('default', $1::jsonb, $2::jsonb, NOW())
         ON CONFLICT (state_key)
         DO UPDATE SET data_json=EXCLUDED.data_json, masters_json=EXCLUDED.masters_json, updated_at=NOW()
         RETURNING data_json, masters_json, updated_at;`,
        [JSON.stringify(data), JSON.stringify(masters)]
      );
      return json(200, { ok: true, data: result.rows[0].data_json, masters: result.rows[0].masters_json, updated_at: result.rows[0].updated_at });
    }
    return json(405, { error: 'Method not allowed' });
  } catch (error) {
    return json(500, { error: error.message || 'Unknown workflow sync error' });
  }
};
