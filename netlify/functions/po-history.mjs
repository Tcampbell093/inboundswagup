import pg from 'pg';
import crypto from 'node:crypto';

const { Pool } = pg;
let poolInstance;
let schemaReady = false;
const env = (name) => globalThis.Netlify?.env?.get(name) || process.env[name] || '';
const pool = () => poolInstance ||= new Pool({ connectionString: env('DATABASE_URL'), ssl: { rejectUnauthorized: false } });
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-overstock-import-key',
};
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...corsHeaders } });
const clean = (value, max = 500) => String(value == null ? '' : value).trim().slice(0, max);
const value = (row, names) => {
  for (const name of names) if (row && row[name] != null && clean(row[name])) return clean(row[name]);
  return '';
};

async function ensureSchema() {
  if (schemaReady) return;
  await pool().query(`
    CREATE TABLE IF NOT EXISTS po_history_records (
      record_key TEXT PRIMARY KEY,
      source_sheet TEXT NOT NULL,
      lifecycle_state TEXT NOT NULL,
      po TEXT,
      delivery_id TEXT,
      category TEXT,
      status TEXT,
      location TEXT,
      associate_name TEXT,
      activity_date TEXT,
      row_json JSONB NOT NULL,
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS po_history_po_idx ON po_history_records(po);
    CREATE INDEX IF NOT EXISTS po_history_delivery_idx ON po_history_records(delivery_id);
    CREATE INDEX IF NOT EXISTS po_history_state_idx ON po_history_records(lifecycle_state);
    CREATE INDEX IF NOT EXISTS po_history_activity_idx ON po_history_records(activity_date);
    CREATE TABLE IF NOT EXISTS po_history_sync_runs (
      id BIGSERIAL PRIMARY KEY,
      source TEXT NOT NULL,
      current_count INTEGER NOT NULL DEFAULT 0,
      archive_count INTEGER NOT NULL DEFAULT 0,
      archive_pa_count INTEGER NOT NULL DEFAULT 0,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  schemaReady = true;
}

async function authorize(request) {
  const token = clean((request.headers.get('authorization') || '').replace(/^Bearer\s+/i, ''), 4000);
  if (!token) return false;
  try {
    const origin = env('IDENTITY_URL') || 'https://inboundswagup.netlify.app/.netlify/identity';
    const response = await fetch(`${origin}/user`, { headers: { authorization: `Bearer ${token}` } });
    if (!response.ok) return false;
    const user = await response.json();
    if (!user?.email) return false;
    const result = await pool().query('SELECT suspended, invited FROM hc_users WHERE LOWER(email)=LOWER($1)', [user.email]);
    return Boolean(result.rows[0] && !result.rows[0].suspended && result.rows[0].invited !== false);
  } catch { return false; }
}

function normalized(row, sourceSheet, lifecycleState) {
  const po = value(row, ['PO # (Orden)', 'PO #', 'PO']);
  const deliveryId = value(row, ['Delivery ID (auto)', 'Delivery ID', 'Delivery / Part #']);
  const signature = deliveryId
    ? `${sourceSheet}|delivery|${deliveryId}`
    : `${sourceSheet}|po|${po}|${value(row, ['Delivery / Part #'])}|${value(row, ['Dock Date (Fecha)', 'Date (Fecha)', 'Closed On'])}|${value(row, ['Overstock Loc (Ubicacion)', 'Location / Ubicacion (QE4-A1)'])}`;
  return {
    key: crypto.createHash('sha256').update(signature).digest('hex'), sourceSheet, lifecycleState, po, deliveryId,
    category: value(row, ['Category / Categoria', 'Category']),
    status: value(row, ['Status (Estado)', 'Status']),
    location: value(row, ['Overstock Loc (Ubicacion)', 'Location / Ubicacion (QE4-A1)', 'Put-Away Loc']),
    associate: value(row, ['Done By (Por)', 'Prep By (Por)', 'Rec By (Por)', 'Dock By (Muelle-Por)']),
    activityDate: value(row, ['Done Date (Term.)', 'Prep Date (Prep)', 'Rec Date (Recibo)', 'Dock Date (Fecha)', 'Date (Fecha)', 'Closed On']),
    row,
  };
}

async function syncRows(client, rows, sourceSheet, lifecycleState) {
  const prepared = rows.map((row) => normalized(row, sourceSheet, lifecycleState)).filter((r) => r.po || r.deliveryId);
  for (let start = 0; start < prepared.length; start += 100) {
    const chunk = prepared.slice(start, start + 100);
    const params = [];
    const values = chunk.map((r, rowIndex) => {
      const offset = rowIndex * 11;
      params.push(r.key,r.sourceSheet,r.lifecycleState,r.po,r.deliveryId,r.category,r.status,r.location,r.associate,r.activityDate,JSON.stringify(r.row));
      return `(${Array.from({ length: 11 }, (_, i) => `$${offset + i + 1}${i === 10 ? '::jsonb' : ''}`).join(',')})`;
    });
    await client.query(`INSERT INTO po_history_records
      (record_key,source_sheet,lifecycle_state,po,delivery_id,category,status,location,associate_name,activity_date,row_json)
      VALUES ${values.join(',')}
      ON CONFLICT(record_key) DO UPDATE SET lifecycle_state=EXCLUDED.lifecycle_state, po=EXCLUDED.po,
      delivery_id=EXCLUDED.delivery_id, category=EXCLUDED.category, status=EXCLUDED.status,
      location=EXCLUDED.location, associate_name=EXCLUDED.associate_name, activity_date=EXCLUDED.activity_date,
      row_json=EXCLUDED.row_json, last_seen_at=NOW()`, params);
  }
  return prepared.length;
}

async function handleSync(request) {
  const expected = env('OVERSTOCK_EXCEL_IMPORT_SECRET');
  const supplied = request.headers.get('x-overstock-import-key') || '';
  if (!expected || supplied.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return json(401, { error: 'Invalid import key.' });
  const body = await request.json().catch(() => ({}));
  const currentRows = Array.isArray(body.currentRows) ? body.currentRows : [];
  const archiveRows = Array.isArray(body.archiveRows) ? body.archiveRows : [];
  const archivePaRows = Array.isArray(body.archivePaRows) ? body.archivePaRows : [];
  const client = await pool().connect();
  try {
    await client.query('BEGIN');
    const current = await syncRows(client, currentRows, 'Daily Log', 'current');
    const archive = await syncRows(client, archiveRows, 'Archive', 'archived');
    const archivePa = await syncRows(client, archivePaRows, 'Archive PA', 'archived');
    await client.query('INSERT INTO po_history_sync_runs(source,current_count,archive_count,archive_pa_count) VALUES($1,$2,$3,$4)', [clean(body.source || 'Excel workbook', 200), current, archive, archivePa]);
    await client.query('COMMIT');
    return json(200, { current, archive, archivePa, total: current + archive + archivePa });
  } catch (error) {
    await client.query('ROLLBACK');
    return json(500, { error: error.message });
  } finally { client.release(); }
}

async function handleGet(request) {
  if (!await authorize(request)) return json(401, { error: 'Houston sign-in required.' });
  const url = new URL(request.url);
  const q = clean(url.searchParams.get('q'), 200);
  const scope = ['current','archived'].includes(url.searchParams.get('scope')) ? url.searchParams.get('scope') : 'all';
  const sort = url.searchParams.get('sort') || 'newest';
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const pageSize = Math.min(100, Math.max(10, Number(url.searchParams.get('pageSize')) || 40));
  const where = []; const params = [];
  if (scope !== 'all') { params.push(scope); where.push(`lifecycle_state=$${params.length}`); }
  if (q) { params.push(`%${q}%`); where.push(`(po ILIKE $${params.length} OR delivery_id ILIKE $${params.length} OR category ILIKE $${params.length} OR status ILIKE $${params.length} OR location ILIKE $${params.length} OR associate_name ILIKE $${params.length} OR row_json::text ILIKE $${params.length})`); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const order = sort === 'oldest' ? 'activity_date ASC NULLS LAST' : sort === 'po' ? 'po ASC NULLS LAST' : sort === 'status' ? 'status ASC NULLS LAST' : 'activity_date DESC NULLS LAST, last_seen_at DESC';
  const count = await pool().query(`SELECT COUNT(*)::int AS count FROM po_history_records ${clause}`, params);
  params.push(pageSize, (page - 1) * pageSize);
  const records = await pool().query(`SELECT * FROM po_history_records ${clause} ORDER BY ${order} LIMIT $${params.length-1} OFFSET $${params.length}`, params);
  const sync = await pool().query('SELECT * FROM po_history_sync_runs ORDER BY synced_at DESC LIMIT 1');
  const stored = await pool().query('SELECT COUNT(*)::int AS count FROM po_history_records');
  return json(200, { records: records.rows, total: count.rows[0].count, totalStored: stored.rows[0].count, page, pageSize, lastSync: sync.rows[0] || null });
}

export default async (request) => {
  try {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...corsHeaders, 'Access-Control-Max-Age': '86400' } });
    await ensureSchema();
    if (request.method === 'POST') return handleSync(request);
    if (request.method === 'GET') return handleGet(request);
    return json(405, { error: 'Method not allowed.' });
  } catch (error) { return json(500, { error: error.message }); }
};

export const config = { path: '/api/po-history' };
