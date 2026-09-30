import pg from 'pg';

const { Pool } = pg;
let poolInstance = null;
let schemaReady = false;

function env(name) {
  return globalThis.Netlify?.env?.get(name) || '';
}

function getPool() {
  const connectionString = env('DATABASE_URL');
  if (!connectionString) throw new Error('DATABASE_URL is not configured.');
  if (!poolInstance) poolInstance = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  return poolInstance;
}

function clean(value, max = 200) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

async function ensureSchema() {
  if (schemaReady) return;
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS hub_bingo_photos (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL DEFAULT '',
      mime_type TEXT NOT NULL,
      image_bytes BYTEA NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by TEXT NOT NULL DEFAULT '',
      removed_at TIMESTAMPTZ,
      removed_by TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS hub_bingo_photos_active_idx
      ON hub_bingo_photos(active, created_at DESC);
  `);
  schemaReady = true;
}

export default async (request) => {
  try {
    if (request.method !== 'GET') {
      return new Response('Method not allowed.', { status: 405, headers: { 'Cache-Control': 'no-store' } });
    }

    await ensureSchema();
    const url = new URL(request.url);
    const id = clean(url.searchParams.get('id'), 80);
    if (!id) return new Response('Photo not found.', { status: 404, headers: { 'Cache-Control': 'no-store' } });

    const result = await getPool().query(
      `SELECT mime_type,image_bytes FROM hub_bingo_photos WHERE id=$1 LIMIT 1`,
      [id],
    );
    const row = result.rows[0];
    if (!row?.image_bytes) {
      return new Response('Photo not found.', { status: 404, headers: { 'Cache-Control': 'no-store' } });
    }

    return new Response(row.image_bytes, {
      status: 200,
      headers: {
        'Content-Type': row.mime_type || 'image/jpeg',
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return new Response('Photo unavailable.', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }
};

export const config = { path: '/api/bingo-photo' };
