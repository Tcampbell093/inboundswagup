const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : undefined,
});

let schemaReady = false;

function json(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extraHeaders },
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
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      read_by     TEXT[] NOT NULL DEFAULT '{}'
    );
  `);
  await pool.query(`ALTER TABLE flight_tracker_comments ADD COLUMN IF NOT EXISTS read_by TEXT[] NOT NULL DEFAULT '{}';`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_ftc_pb_id ON flight_tracker_comments (pb_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_ftc_so ON flight_tracker_comments (so);`);
  schemaReady = true;
}

const ALERT_CATEGORIES = ['hold_request', 'date_change_request', 'priority'];

exports.handler = async function handler(event) {
  if (!process.env.DATABASE_URL) return json(500, { error: 'DATABASE_URL is not configured' });
  try {
    await ensureSchema();

    if (event.httpMethod === 'GET') {
      const params = event.queryStringParameters || {};

      // ?unread_for=email — nav badge count
      if (params.unread_for) {
        const email = String(params.unread_for).trim().toLowerCase();
        const result = await pool.query(
          `SELECT COUNT(*) as count FROM flight_tracker_comments
            WHERE category = ANY($1) AND NOT ($2 = ANY(read_by))`,
          [ALERT_CATEGORIES, email]
        );
        return json(200, { count: parseInt(result.rows[0].count) });
      }

      // ?latest=N
      if (params.latest) {
        const limit = Math.min(Math.max(1, parseInt(params.latest, 10) || 1), 500);
        const result = await pool.query(
          `SELECT id, pb_id, pb_name, so, account, author_name, category, body, created_at, read_by
             FROM flight_tracker_comments ORDER BY id DESC LIMIT $1;`,
          [limit]
        );
        return json(200, { comments: result.rows });
      }

      const pbId = (params.pb_id || '').trim();
      const so   = (params.so   || '').trim();
      if (!pbId && !so) return json(400, { error: 'Provide pb_id, so, latest, or unread_for' });

      const result = pbId
        ? await pool.query(`SELECT id, pb_id, pb_name, so, account, author_name, category, body, created_at, read_by FROM flight_tracker_comments WHERE pb_id=$1 ORDER BY created_at ASC;`, [pbId])
        : await pool.query(`SELECT id, pb_id, pb_name, so, account, author_name, category, body, created_at, read_by FROM flight_tracker_comments WHERE so=$1 ORDER BY created_at ASC;`, [so]);
      return json(200, { comments: result.rows });
    }

    if (event.httpMethod === 'POST') {
      let body;
      try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON body' }); }
      const pbId       = String(body.pb_id      || '').trim();
      const pbName     = String(body.pb_name    || '').trim();
      const so         = String(body.so         || '').trim();
      const account    = String(body.account    || '').trim();
      const authorName = String(body.author_name || 'Stakeholder').trim().slice(0, 80);
      const category   = ['priority','instructions','general','hold_request','date_change_request'].includes(body.category) ? body.category : 'general';
      const commentBody = String(body.body || '').trim();
      if (!commentBody) return json(400, { error: 'Comment body is required' });
      if (!pbId && !so) return json(400, { error: 'pb_id or so is required' });
      if (commentBody.length > 2000) return json(400, { error: 'Comment exceeds 2000 characters' });
      const result = await pool.query(
        `INSERT INTO flight_tracker_comments (pb_id, pb_name, so, account, author_name, category, body, read_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'{}') RETURNING id, pb_id, pb_name, so, account, author_name, category, body, created_at;`,
        [pbId, pbName, so, account, authorName, category, commentBody]
      );
      return json(201, { comment: result.rows[0] });
    }

    // PATCH — mark all actionable comments read for a user
    if (event.httpMethod === 'PATCH') {
      let body;
      try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON' }); }
      const reader = String(body.reader || '').trim().toLowerCase();
      if (!reader) return json(400, { error: 'reader required' });
      await pool.query(
        `UPDATE flight_tracker_comments
            SET read_by = array_append(read_by, $1)
          WHERE category = ANY($2) AND NOT ($1 = ANY(read_by))`,
        [reader, ALERT_CATEGORIES]
      );
      return json(200, { ok: true });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('flight-tracker-comments error:', err);
    return json(500, { error: err.message || 'Internal server error' });
  }
};
