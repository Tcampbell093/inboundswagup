const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : undefined,
});

let schemaReady = false;

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(body),
  };
}

async function ensureSchema() {
  if (schemaReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS assembly_sync_state (
      state_key TEXT PRIMARY KEY,
      state_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    INSERT INTO assembly_sync_state (state_key, state_json)
    VALUES ('default', '{"board":[],"available":[],"scheduled":[],"incomplete":[],"revenue":[]}'::jsonb)
    ON CONFLICT (state_key) DO NOTHING;
  `);
  schemaReady = true;
}

exports.handler = async function handler(event) {
  if (!process.env.DATABASE_URL) {
    return json(500, { error: 'DATABASE_URL is not configured' });
  }

  try {
    await ensureSchema();

    if (event.httpMethod === 'GET') {
      const result = await pool.query(
        `SELECT state_json, updated_at FROM assembly_sync_state WHERE state_key = 'default' LIMIT 1;`
      );
      const row = result.rows[0] || { state_json: { board: [], available: [], scheduled: [], incomplete: [], revenue: [] }, updated_at: null };
      return json(200, { state: row.state_json, updated_at: row.updated_at });
    }

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const state = body && typeof body.state === 'object' && body.state ? body.state : {};
      const safeState = {
        board: Array.isArray(state.board) ? state.board : [],
        available: Array.isArray(state.available) ? state.available : [],
        scheduled: Array.isArray(state.scheduled) ? state.scheduled : [],
        incomplete: Array.isArray(state.incomplete) ? state.incomplete : [],
        revenue: Array.isArray(state.revenue) ? state.revenue : [],
      };
      const result = await pool.query(
        `INSERT INTO assembly_sync_state (state_key, state_json, updated_at)
         VALUES ('default', $1::jsonb, NOW())
         ON CONFLICT (state_key)
         DO UPDATE SET state_json = EXCLUDED.state_json, updated_at = NOW()
         RETURNING state_json, updated_at;`,
        [JSON.stringify(safeState)]
      );
      return json(200, { ok: true, state: result.rows[0].state_json, updated_at: result.rows[0].updated_at });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (error) {
    return json(500, { error: error.message || 'Unknown assembly sync error' });
  }
};
