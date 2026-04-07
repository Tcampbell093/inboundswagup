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
  await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

  // Workspace seed (mirrors other functions)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL,
      slug text NOT NULL UNIQUE,
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await pool.query(
    `INSERT INTO workspaces (id, name, slug)
     VALUES ($1, 'Houston Control', 'houston-control')
     ON CONFLICT (id) DO NOTHING;`,
    [WORKSPACE_ID]
  );

  // EOD / huddle recap notes — one record per date, upsertable
  await pool.query(`
    CREATE TABLE IF NOT EXISTS huddle_recaps (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      recap_date date NOT NULL,
      what_worked text NOT NULL DEFAULT '',
      what_didnt text NOT NULL DEFAULT '',
      biggest_blocker text NOT NULL DEFAULT '',
      labor_moves text NOT NULL DEFAULT '',
      rolls_tomorrow text NOT NULL DEFAULT '',
      special_notes text NOT NULL DEFAULT '',
      extra jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (workspace_id, recap_date)
    );
  `);

  // Daily SORD status snapshots — append-only; one row per sord+date+import
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sord_snapshots (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      snapshot_date date NOT NULL,
      imported_at timestamptz NOT NULL DEFAULT now(),
      sord_id text NOT NULL DEFAULT '',
      sales_order_id text NOT NULL DEFAULT '',
      account text NOT NULL DEFAULT '',
      status text NOT NULL DEFAULT '',
      po_status text NOT NULL DEFAULT '',
      units integer NOT NULL DEFAULT 0,
      packs integer NOT NULL DEFAULT 0,
      subtotal numeric(14,2) NOT NULL DEFAULT 0,
      earliest_ihd date,
      latest_ihd date,
      earliest_eta date,
      readiness text NOT NULL DEFAULT '',
      complexity text NOT NULL DEFAULT '',
      po_count integer NOT NULL DEFAULT 0,
      supplier_count integer NOT NULL DEFAULT 0,
      pb_count integer NOT NULL DEFAULT 0,
      flag_count integer NOT NULL DEFAULT 0,
      meta jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS sord_snapshots_date_idx
      ON sord_snapshots (workspace_id, snapshot_date DESC);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS sord_snapshots_sord_idx
      ON sord_snapshots (workspace_id, sord_id, snapshot_date DESC);
  `);

  schemaReady = true;
}

function safeDate(v) {
  if (!v) return null;
  const s = String(v).slice(0, 10);
  return s.match(/^\d{4}-\d{2}-\d{2}$/) ? s : null;
}
function safeText(v) { return v == null ? '' : String(v).trim(); }
function safeNum(v, fallback = 0) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }

async function readRecaps() {
  const res = await pool.query(
    `SELECT id, recap_date, what_worked, what_didnt, biggest_blocker,
            labor_moves, rolls_tomorrow, special_notes, extra, updated_at
     FROM huddle_recaps
     WHERE workspace_id = $1
     ORDER BY recap_date DESC
     LIMIT 90;`,
    [WORKSPACE_ID]
  );
  return res.rows.map(r => ({
    id: r.id,
    date: r.recap_date,
    whatWorked: r.what_worked,
    whatDidnt: r.what_didnt,
    biggestBlocker: r.biggest_blocker,
    laborMoves: r.labor_moves,
    rollsTomorrow: r.rolls_tomorrow,
    specialNotes: r.special_notes,
    extra: r.extra || {},
    updatedAt: r.updated_at,
  }));
}

async function readSnapshotDates() {
  const res = await pool.query(
    `SELECT DISTINCT snapshot_date
     FROM sord_snapshots
     WHERE workspace_id = $1
     ORDER BY snapshot_date DESC
     LIMIT 180;`,
    [WORKSPACE_ID]
  );
  return res.rows.map(r => r.snapshot_date);
}

async function readSnapshotForDate(date) {
  const res = await pool.query(
    `SELECT sord_id, sales_order_id, account, status, po_status,
            units, packs, subtotal, earliest_ihd, latest_ihd, earliest_eta,
            readiness, complexity, po_count, supplier_count, pb_count, flag_count, meta
     FROM sord_snapshots
     WHERE workspace_id = $1 AND snapshot_date = $2
     ORDER BY sord_id ASC;`,
    [WORKSPACE_ID, date]
  );
  return res.rows.map(r => ({
    sordId: r.sord_id,
    salesOrderId: r.sales_order_id,
    account: r.account,
    status: r.status,
    poStatus: r.po_status,
    units: safeNum(r.units),
    packs: safeNum(r.packs),
    subtotal: safeNum(r.subtotal),
    earliestIhd: r.earliest_ihd || null,
    latestIhd: r.latest_ihd || null,
    earliestEta: r.earliest_eta || null,
    readiness: r.readiness,
    complexity: r.complexity,
    poCount: safeNum(r.po_count),
    supplierCount: safeNum(r.supplier_count),
    pbCount: safeNum(r.pb_count),
    flagCount: safeNum(r.flag_count),
    meta: r.meta || {},
  }));
}

exports.handler = async function handler(event) {
  if (!process.env.DATABASE_URL) {
    return json(500, { error: 'DATABASE_URL is not configured' });
  }

  try {
    await ensureSchema();
    const path = (event.path || '').replace(/\/+$/, '');
    const action = event.queryStringParameters?.action || '';

    // ── GET ──────────────────────────────────────────────────────────────────
    if (event.httpMethod === 'GET') {
      if (action === 'snapshot_dates') {
        return json(200, { dates: await readSnapshotDates() });
      }
      if (action === 'snapshot' && event.queryStringParameters?.date) {
        const rows = await readSnapshotForDate(event.queryStringParameters.date);
        return json(200, { date: event.queryStringParameters.date, rows });
      }
      // Default: return recaps + available snapshot dates
      const [recaps, snapshotDates] = await Promise.all([readRecaps(), readSnapshotDates()]);
      return json(200, { recaps, snapshotDates });
    }

    // ── POST ─────────────────────────────────────────────────────────────────
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');

      // Save / upsert EOD recap
      if (body.recap && typeof body.recap === 'object') {
        const r = body.recap;
        const recapDate = safeDate(r.date);
        if (!recapDate) return json(400, { error: 'recap.date is required (YYYY-MM-DD)' });

        await pool.query(
          `INSERT INTO huddle_recaps
             (workspace_id, recap_date, what_worked, what_didnt, biggest_blocker,
              labor_moves, rolls_tomorrow, special_notes, extra)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
           ON CONFLICT (workspace_id, recap_date)
           DO UPDATE SET
             what_worked      = EXCLUDED.what_worked,
             what_didnt       = EXCLUDED.what_didnt,
             biggest_blocker  = EXCLUDED.biggest_blocker,
             labor_moves      = EXCLUDED.labor_moves,
             rolls_tomorrow   = EXCLUDED.rolls_tomorrow,
             special_notes    = EXCLUDED.special_notes,
             extra            = EXCLUDED.extra,
             updated_at       = now();`,
          [
            WORKSPACE_ID, recapDate,
            safeText(r.whatWorked), safeText(r.whatDidnt), safeText(r.biggestBlocker),
            safeText(r.laborMoves), safeText(r.rollsTomorrow), safeText(r.specialNotes),
            JSON.stringify(r.extra || {}),
          ]
        );
        const recaps = await readRecaps();
        return json(200, { ok: true, recaps });
      }

      // Save SORD snapshot (called from sord.js after import)
      if (Array.isArray(body.snapshot)) {
        const snapshotDate = safeDate(body.snapshotDate) || new Date().toISOString().slice(0, 10);
        const importedAt = body.importedAt || new Date().toISOString();
        const rows = body.snapshot;

        await pool.query('BEGIN');
        // Delete any existing snapshot for this date (idempotent re-import)
        await pool.query(
          `DELETE FROM sord_snapshots WHERE workspace_id = $1 AND snapshot_date = $2;`,
          [WORKSPACE_ID, snapshotDate]
        );
        for (const item of rows) {
          await pool.query(
            `INSERT INTO sord_snapshots
               (workspace_id, snapshot_date, imported_at, sord_id, sales_order_id, account,
                status, po_status, units, packs, subtotal,
                earliest_ihd, latest_ihd, earliest_eta,
                readiness, complexity, po_count, supplier_count, pb_count, flag_count, meta)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb);`,
            [
              WORKSPACE_ID, snapshotDate, importedAt,
              safeText(item.sordId || item.sord), safeText(item.salesOrderId),
              safeText(item.account),
              safeText(item.status), safeText(item.poStatus),
              Math.round(safeNum(item.units)), Math.round(safeNum(item.packs)),
              safeNum(item.subtotal),
              safeDate(item.earliestIhd), safeDate(item.latestIhd), safeDate(item.earliestEta),
              safeText(item.readiness), safeText(item.complexity),
              Math.round(safeNum(item.poCount)), Math.round(safeNum(item.supplierCount)),
              Math.round(safeNum(item.pbCount)), Math.round(safeNum(item.flagCount)),
              JSON.stringify(item.meta || {}),
            ]
          );
        }
        await pool.query('COMMIT');
        const snapshotDates = await readSnapshotDates();
        return json(200, { ok: true, snapshotDate, rowCount: rows.length, snapshotDates });
      }

      return json(400, { error: 'Unrecognized POST body. Expected { recap } or { snapshot, snapshotDate }.' });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (error) {
    try { await pool.query('ROLLBACK'); } catch {}
    return json(500, { error: error.message || 'Unknown huddle sync error' });
  }
};
