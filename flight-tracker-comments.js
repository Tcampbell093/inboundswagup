const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : undefined,
});

let schemaReady = false;

function json(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  };
}

async function ensureSchema() {
  if (schemaReady) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS flight_tracker_comments (
      id          BIGSERIAL PRIMARY KEY,
      pb_id       TEXT NOT NULL DEFAULT '',
      pb_name     TEXT NOT NULL DEFAULT '',
      so          TEXT NOT NULL DEFAULT '',
      account     TEXT NOT NULL DEFAULT '',
      author_name TEXT NOT NULL DEFAULT 'Stakeholder',
      category    TEXT NOT NULL DEFAULT 'general',
      body        TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Stage 3: add read_by column if it doesn't exist yet
  await pool.query(`
    ALTER TABLE flight_tracker_comments
      ADD COLUMN IF NOT EXISTS read_by TEXT[] NOT NULL DEFAULT '{}';
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_ftc_pb_id ON flight_tracker_comments (pb_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_ftc_so   ON flight_tracker_comments (so);`);

  schemaReady = true;
}

exports.handler = async function handler(event) {
  if (!process.env.DATABASE_URL) {
    return json(500, { error: 'DATABASE_URL is not configured' });
  }

  try {
    await ensureSchema();

    // ── GET ──────────────────────────────────────────────────────────────────
    if (event.httpMethod === 'GET') {
      const params = event.queryStringParameters || {};

      // ?latest=N — most recent N comments (batch count / poller)
      if (params.latest) {
        const limit = Math.min(Math.max(1, parseInt(params.latest, 10) || 1), 500);
        const result = await pool.query(
          `SELECT id, pb_id, pb_name, so, account, author_name, category, body, created_at, read_by
             FROM flight_tracker_comments
             ORDER BY id DESC
             LIMIT $1;`,
          [limit]
        );
        return json(200, { comments: result.rows });
      }

      // ?pb_id=xxx or ?so=xxx — thread for a specific PB or SO
      const pbId = (params.pb_id || '').trim();
      const so   = (params.so   || '').trim();
      if (!pbId && !so) return json(400, { error: 'Provide pb_id or so query param' });

      let result;
      if (pbId) {
        result = await pool.query(
          `SELECT id, pb_id, pb_name, so, account, author_name, category, body, created_at, read_by
             FROM flight_tracker_comments
            WHERE pb_id = $1
            ORDER BY created_at ASC;`,
          [pbId]
        );
      } else {
        result = await pool.query(
          `SELECT id, pb_id, pb_name, so, account, author_name, category, body, created_at, read_by
             FROM flight_tracker_comments
            WHERE so = $1
            ORDER BY created_at ASC;`,
          [so]
        );
      }
      return json(200, { comments: result.rows });
    }

    // ── POST — create a comment ──────────────────────────────────────────────
    if (event.httpMethod === 'POST') {
      let body;
      try { body = JSON.parse(event.body || '{}'); }
      catch { return json(400, { error: 'Invalid JSON body' }); }

      const pbId       = String(body.pb_id       || '').trim();
      const pbName     = String(body.pb_name     || '').trim();
      const so         = String(body.so          || '').trim();
      const account    = String(body.account     || '').trim();
      const authorName = String(body.author_name || 'Stakeholder').trim().slice(0, 80);
      const category   = ['priority', 'instructions', 'general'].includes(body.category)
        ? body.category : 'general';
      const commentBody = String(body.body || '').trim();

      if (!commentBody)        return json(400, { error: 'Comment body is required' });
      if (!pbId && !so)        return json(400, { error: 'pb_id or so is required' });
      if (commentBody.length > 2000) return json(400, { error: 'Comment exceeds 2000 characters' });

      // Author auto-marks their own comment as read
      const readBy = authorName ? [authorName] : [];

      const result = await pool.query(
        `INSERT INTO flight_tracker_comments
           (pb_id, pb_name, so, account, author_name, category, body, read_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, pb_id, pb_name, so, account, author_name, category, body, created_at, read_by;`,
        [pbId, pbName, so, account, authorName, category, commentBody, readBy]
      );
      return json(201, { comment: result.rows[0] });
    }

    // ── PATCH — mark comments as read ────────────────────────────────────────
    // Body: { reader: "Jane", pb_id?: "...", so?: "...", comment_ids?: [1,2,3] }
    if (event.httpMethod === 'PATCH') {
      let body;
      try { body = JSON.parse(event.body || '{}'); }
      catch { return json(400, { error: 'Invalid JSON body' }); }

      const reader = String(body.reader || '').trim();
      if (!reader) return json(400, { error: 'reader is required' });

      // Mark specific comment IDs as read
      if (Array.isArray(body.comment_ids) && body.comment_ids.length) {
        const ids = body.comment_ids.map(id => Number(id)).filter(id => id > 0);
        if (!ids.length) return json(400, { error: 'No valid comment_ids' });
        await pool.query(
          `UPDATE flight_tracker_comments
              SET read_by = array_append(read_by, $1)
            WHERE id = ANY($2::bigint[])
              AND NOT ($1 = ANY(read_by));`,
          [reader, ids]
        );
        return json(200, { ok: true, marked: ids.length });
      }

      // Mark all comments for a pb_id or so as read
      const pbId = String(body.pb_id || '').trim();
      const so   = String(body.so   || '').trim();
      if (!pbId && !so) return json(400, { error: 'Provide comment_ids, pb_id, or so' });

      const whereCol = pbId ? 'pb_id' : 'so';
      const whereVal = pbId || so;
      const result = await pool.query(
        `UPDATE flight_tracker_comments
            SET read_by = array_append(read_by, $1)
          WHERE ${whereCol} = $2
            AND NOT ($1 = ANY(read_by))
          RETURNING id;`,
        [reader, whereVal]
      );
      return json(200, { ok: true, marked: result.rowCount });
    }

    return json(405, { error: 'Method not allowed' });

  } catch (err) {
    console.error('flight-tracker-comments error:', err);
    return json(500, { error: err.message || 'Internal server error' });
  }
};
