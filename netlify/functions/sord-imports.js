const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : undefined,
});

const WORKSPACE_ID = '00000000-0000-0000-0000-000000000001';
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
    CREATE TABLE IF NOT EXISTS sord_import_cache (
      id           BIGSERIAL    PRIMARY KEY,
      workspace_id UUID         NOT NULL,
      slot         VARCHAR(50)  NOT NULL DEFAULT 'default',
      imported_at  TIMESTAMPTZ  NOT NULL,
      file_names   JSONB        NOT NULL DEFAULT '{}',
      queue_rows   JSONB        NOT NULL DEFAULT '[]',
      revenue_rows JSONB        NOT NULL DEFAULT '[]',
      eom_rows     JSONB        NOT NULL DEFAULT '[]',
      row_counts   JSONB        NOT NULL DEFAULT '{}',
      updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      CONSTRAINT sord_import_cache_workspace_slot UNIQUE (workspace_id, slot)
    );
  `);
  schemaReady = true;
}

exports.handler = async function handler(event) {
  if (!process.env.DATABASE_URL) return json(500, { error: 'DATABASE_URL not configured' });

  try {
    await ensureSchema();

    // ── GET — return the latest saved import ──────────────────────────
    if (event.httpMethod === 'GET') {
      const res = await pool.query(
        `SELECT imported_at, file_names, queue_rows, revenue_rows, eom_rows, row_counts, updated_at
         FROM sord_import_cache
         WHERE workspace_id = $1 AND slot = 'default'
         LIMIT 1;`,
        [WORKSPACE_ID]
      );
      if (!res.rows.length) return json(200, { found: false });
      const row = res.rows[0];
      return json(200, {
        found: true,
        importedAt: row.imported_at,
        fileNames: row.file_names  || {},
        queueRows: row.queue_rows  || [],
        revenueRows: row.revenue_rows || [],
        eomRows: row.eom_rows   || [],
        counts: row.row_counts  || {},
        updatedAt: row.updated_at,
      });
    }

    // ── POST — upsert an import ───────────────────────────────────────
    if (event.httpMethod === 'POST') {
      let body;
      try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON body' }); }

      const importedAt  = body.importedAt  || new Date().toISOString();
      const fileNames   = body.fileNames   || {};
      const queueRows   = Array.isArray(body.queueRows)   ? body.queueRows   : [];
      const revenueRows = Array.isArray(body.revenueRows) ? body.revenueRows : [];
      const eomRows     = Array.isArray(body.eomRows)     ? body.eomRows     : [];
      const counts = {
        queue:   queueRows.length,
        revenue: revenueRows.length,
        eom:     eomRows.length,
      };

      await pool.query(
        `INSERT INTO sord_import_cache
           (workspace_id, slot, imported_at, file_names, queue_rows, revenue_rows, eom_rows, row_counts, updated_at)
         VALUES ($1, 'default', $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, NOW())
         ON CONFLICT (workspace_id, slot) DO UPDATE SET
           imported_at  = EXCLUDED.imported_at,
           file_names   = EXCLUDED.file_names,
           queue_rows   = EXCLUDED.queue_rows,
           revenue_rows = EXCLUDED.revenue_rows,
           eom_rows     = EXCLUDED.eom_rows,
           row_counts   = EXCLUDED.row_counts,
           updated_at   = NOW();`,
        [
          WORKSPACE_ID,
          importedAt,
          JSON.stringify(fileNames),
          JSON.stringify(queueRows),
          JSON.stringify(revenueRows),
          JSON.stringify(eomRows),
          JSON.stringify(counts),
        ]
      );

      return json(200, { ok: true, counts });
    }

    // ── DELETE — clear the saved import ──────────────────────────────
    if (event.httpMethod === 'DELETE') {
      await pool.query(
        `DELETE FROM sord_import_cache WHERE workspace_id = $1 AND slot = 'default';`,
        [WORKSPACE_ID]
      );
      return json(200, { ok: true });
    }

    return json(405, { error: 'Method not allowed' });

  } catch (error) {
    console.error('[sord-imports]', error);
    return json(500, { error: error.message || 'Unknown error in sord-imports function' });
  }
};
