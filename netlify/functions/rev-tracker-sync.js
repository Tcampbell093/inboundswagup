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
    CREATE TABLE IF NOT EXISTS rev_tracker_sync (
      state_key   TEXT PRIMARY KEY,
      rows_json   JSONB NOT NULL DEFAULT '[]'::jsonb,
      goal        NUMERIC(14,2) NOT NULL DEFAULT 0,
      imported_at TIMESTAMPTZ,
      file_name   TEXT NOT NULL DEFAULT '',
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    INSERT INTO rev_tracker_sync (state_key)
    VALUES ('default')
    ON CONFLICT (state_key) DO NOTHING;
  `);
  schemaReady = true;
}

exports.handler = async function handler(event) {
  if (!process.env.DATABASE_URL) {
    return json(500, { error: 'DATABASE_URL not configured' });
  }

  try {
    await ensureSchema();

    // GET — load state + goal
    if (event.httpMethod === 'GET') {
      const result = await pool.query(
        `SELECT rows_json, goal, imported_at, file_name, updated_at
           FROM rev_tracker_sync WHERE state_key = 'default' LIMIT 1;`
      );
      const row = result.rows[0] || {};
      return json(200, {
        rows:       row.rows_json || [],
        goal:       Number(row.goal || 0),
        importedAt: row.imported_at || null,
        fileName:   row.file_name || null,
        updatedAt:  row.updated_at || null,
      });
    }

    // POST — save state and/or goal
    if (event.httpMethod === 'POST') {
      let body;
      try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }

      const rows       = Array.isArray(body.rows) ? body.rows : null;
      const goal       = body.goal !== undefined ? Number(body.goal) || 0 : null;
      const importedAt = body.importedAt || null;
      const fileName   = body.fileName || null;

      if (rows !== null) {
        // Full state save
        await pool.query(
          `UPDATE rev_tracker_sync
              SET rows_json   = $1::jsonb,
                  imported_at = $2,
                  file_name   = COALESCE($3, file_name),
                  goal        = COALESCE($4, goal),
                  updated_at  = NOW()
            WHERE state_key   = 'default';`,
          [JSON.stringify(rows), importedAt, fileName, goal]
        );
      } else if (goal !== null) {
        // Goal-only save
        await pool.query(
          `UPDATE rev_tracker_sync SET goal = $1, updated_at = NOW()
            WHERE state_key = 'default';`,
          [goal]
        );
      }

      const result = await pool.query(
        `SELECT rows_json, goal, imported_at, file_name, updated_at
           FROM rev_tracker_sync WHERE state_key = 'default' LIMIT 1;`
      );
      const row = result.rows[0] || {};
      return json(200, {
        ok:        true,
        rows:      row.rows_json || [],
        goal:      Number(row.goal || 0),
        importedAt:row.imported_at || null,
        fileName:  row.file_name || null,
        updatedAt: row.updated_at || null,
      });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('rev-tracker-sync error:', err);
    return json(500, { error: err.message || 'Internal error' });
  }
};
