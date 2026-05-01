/* =========================================================
   flight-tracker-photos.js — Houston Control
   Store and retrieve confirmation photos for pack builders.
   Photos stored as base64 in Neon to avoid external storage costs.
   ========================================================= */

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

function json(code, body) {
  return {
    statusCode: code,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS flight_tracker_photos (
      id          SERIAL PRIMARY KEY,
      pb_id       TEXT NOT NULL,
      pb_name     TEXT,
      account     TEXT,
      photo_data  TEXT NOT NULL,
      taken_by    TEXT,
      taken_at    TIMESTAMPTZ DEFAULT NOW(),
      photo_index INTEGER DEFAULT 0
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_ftp_pb_id ON flight_tracker_photos(pb_id)
  `);
}

exports.handler = async function(event) {
  await ensureTable();

  // GET with ?id=123 — fetch actual image data for a specific photo
  if (event.httpMethod === 'GET' && event.queryStringParameters?.id) {
    const id = event.queryStringParameters.id;
    const result = await pool.query(
      'SELECT photo_data, taken_at, taken_by FROM flight_tracker_photos WHERE id=$1',
      [id]
    );
    if (!result.rows.length) return json(404, { error: 'Photo not found' });
    return json(200, {
      photo_data: result.rows[0].photo_data,
      taken_at: result.rows[0].taken_at,
      taken_by: result.rows[0].taken_by,
    });
  }

  // GET with ?batch=pb1,pb2 — fetch photo counts for multiple PBs
  if (event.httpMethod === 'GET' && event.queryStringParameters?.batch) {
    const ids = event.queryStringParameters.batch.split(',').map(s => s.trim()).filter(Boolean);
    if (!ids.length) return json(200, { counts: {} });
    const result = await pool.query(
      'SELECT pb_id, COUNT(*) as count FROM flight_tracker_photos WHERE pb_id = ANY($1) GROUP BY pb_id',
      [ids]
    );
    const counts = {};
    result.rows.forEach(r => { counts[r.pb_id] = parseInt(r.count); });
    return json(200, { counts });
  }

  // GET — fetch photos list for a pb_id
  if (event.httpMethod === 'GET') {
    const pb_id = event.queryStringParameters?.pb_id;
    if (!pb_id) return json(400, { error: 'pb_id required' });
    const result = await pool.query(
      'SELECT id, pb_id, pb_name, account, taken_by, taken_at, photo_index FROM flight_tracker_photos WHERE pb_id=$1 ORDER BY photo_index ASC, taken_at ASC',
      [pb_id]
    );
    return json(200, { photos: result.rows });
  }

  // POST — save a photo
  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON' }); }

    const { pb_id, pb_name, account, photo_data, taken_by } = body;
    if (!pb_id) return json(400, { error: 'pb_id required' });
    if (!photo_data) return json(400, { error: 'photo_data required' });

    // Enforce max 3 photos per PB
    const countRes = await pool.query(
      'SELECT COUNT(*) as count FROM flight_tracker_photos WHERE pb_id=$1',
      [pb_id]
    );
    const count = parseInt(countRes.rows[0].count);
    if (count >= 3) return json(400, { error: 'Maximum 3 photos per pack builder' });

    const result = await pool.query(
      'INSERT INTO flight_tracker_photos (pb_id, pb_name, account, photo_data, taken_by, photo_index) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, taken_at',
      [pb_id, pb_name || '', account || '', photo_data, taken_by || 'Unknown', count]
    );

    return json(200, { ok: true, id: result.rows[0].id, taken_at: result.rows[0].taken_at });
  }

  // DELETE — remove a specific photo (admin/manager only - enforced client side for now)
  if (event.httpMethod === 'DELETE') {
    const id = event.queryStringParameters?.id;
    if (!id) return json(400, { error: 'id required' });
    await pool.query('DELETE FROM flight_tracker_photos WHERE id=$1', [id]);
    return json(200, { ok: true });
  }

  return json(405, { error: 'Method not allowed' });
};
