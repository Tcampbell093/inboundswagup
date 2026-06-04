/* =========================================================================
   ops-metrics-capture.js — Daily operations history capture

   WHY THIS EXISTS
   ---------------
   Most of the app's operational data (overstock, pallets/inbound, attendance)
   lives inside single overwritten JSON blobs (workflow_sync_state,
   attendance_sync_state). That's fine for running the app, but it keeps only a
   "current photo" — there's no day-over-day history to draw trend lines from.

   This function takes that daily photo and APPENDS dated summary rows into a
   purpose-built, append-only table (daily_metrics). Run once a day (see the
   schedule in netlify.toml), it accumulates the history the stats page needs.
   It mirrors the same daily-snapshot pattern that already feeds sord_snapshots.

   SAFETY
   ------
   - Read-only against existing data (the sync-state blobs).
   - Writes ONLY to the new daily_metrics table — never touches app state.
   - Idempotent: re-running on the same day overwrites that day's rows
     (latest snapshot of the day wins), so a manual re-trigger is harmless.

   STORAGE SHAPE (long / tidy format — easy to chart any metric)
   -------------
   daily_metrics(snapshot_date, area, metric, dimension, value)
     e.g.  2026-06-04 | overstock | units  | __total__   | 1342
           2026-06-04 | overstock | units  | E-11        | 220
           2026-06-04 | inbound   | pallets| stage:prep  | 3
           2026-06-04 | attendance| headcount | mark:Present | 14
   Charting = filter by (area, metric), then group by date (a line over time)
   or by dimension (a breakdown). __total__ is the roll-up for that metric.
   ========================================================================= */

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : undefined,
});

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

// Business-day date string (YYYY-MM-DD) in the warehouse's timezone, so a
// capture run late in the day is stamped with the correct local date rather
// than drifting into "tomorrow" under UTC.
const BUSINESS_TZ = process.env.OPS_METRICS_TZ || 'America/New_York';
function businessDateString(d = new Date()) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TZ }).format(d); // en-CA → YYYY-MM-DD
  } catch (_) {
    return d.toISOString().slice(0, 10);
  }
}

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS daily_metrics (
      snapshot_date date        NOT NULL,
      area          text        NOT NULL,
      metric        text        NOT NULL,
      dimension     text        NOT NULL DEFAULT '__total__',
      value         numeric     NOT NULL DEFAULT 0,
      captured_at   timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (snapshot_date, area, metric, dimension)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS daily_metrics_area_metric_idx
    ON daily_metrics (area, metric, snapshot_date);`);
}

// Accumulate metric rows in memory, then bulk-upsert. add() tolerates missing
// values and skips blank dimensions so the table stays clean.
function makeCollector() {
  const rows = [];
  return {
    add(area, metric, dimension, value) {
      const v = Number(value || 0);
      const dim = String(dimension == null || dimension === '' ? '__total__' : dimension);
      if (!area || !metric) return;
      rows.push({ area, metric, dimension: dim, value: v });
    },
    rows: () => rows,
  };
}

async function readJsonState(table, column, fallback) {
  try {
    const r = await pool.query(`SELECT ${column} AS data FROM ${table} WHERE state_key='default' LIMIT 1;`);
    return r.rows[0]?.data ?? fallback;
  } catch (_) {
    return fallback;
  }
}

// ── Capture: overstock + containers (from workflow_sync_state.data_json) ──
function captureOverstock(col, data) {
  const entries = Array.isArray(data.overstockEntries) ? data.overstockEntries : [];
  const removedActions = new Set(['Missing from Box', 'Lost', 'Replaced']);

  let unitsTotal = 0, unitsActive = 0;
  const byLocation = {}, byCategory = {}, byStatus = {};

  for (const e of entries) {
    const qty = Number(e.quantity || 0);
    unitsTotal += qty;
    const active = !removedActions.has(e.action);
    if (active) unitsActive += qty;
    const loc = (e.location || '—').trim() || '—';
    const cat = (e.category || '—').trim() || '—';
    const st  = (e.status   || '—').trim() || '—';
    if (active) byLocation[loc] = (byLocation[loc] || 0) + qty;
    byCategory[cat] = (byCategory[cat] || 0) + qty;
    byStatus[st]    = (byStatus[st]    || 0) + 1;
  }

  col.add('overstock', 'units',   '__total__', unitsTotal);
  col.add('overstock', 'units_active', '__total__', unitsActive);
  col.add('overstock', 'entries', '__total__', entries.length);
  Object.entries(byLocation).forEach(([k, v]) => col.add('overstock', 'units_active', k, v));
  Object.entries(byCategory).forEach(([k, v]) => col.add('overstock', 'units', `cat:${k}`, v));
  Object.entries(byStatus).forEach(([k, v])   => col.add('overstock', 'entries', `status:${k}`, v));

  const containers = Array.isArray(data.overstockContainers) ? data.overstockContainers : [];
  const open = containers.filter(c => c.status !== 'Closed');
  col.add('overstock', 'containers', '__total__', open.length);
  const byCStatus = {};
  open.forEach(c => { const s = c.status || '—'; byCStatus[s] = (byCStatus[s] || 0) + 1; });
  Object.entries(byCStatus).forEach(([k, v]) => col.add('overstock', 'containers', `status:${k}`, v));
}

// ── Capture: inbound pallets + PO units (from workflow_sync_state.data_json) ──
function captureInbound(col, data) {
  const pallets = Array.isArray(data.pallets) ? data.pallets : [];
  const byStage = {};
  let posTotal = 0, orderedUnits = 0, receivedUnits = 0, boxes = 0;

  for (const p of pallets) {
    const stage = (p.status || 'unknown').trim() || 'unknown';
    byStage[stage] = (byStage[stage] || 0) + 1;
    const pos = Array.isArray(p.pos) ? p.pos : [];
    posTotal += pos.length;
    for (const po of pos) {
      orderedUnits  += Number(po.orderedQty  || 0);
      receivedUnits += Number(po.receivedQty || 0);
      boxes         += Number(po.boxes       || 0);
    }
  }

  col.add('inbound', 'pallets', '__total__', pallets.length);
  Object.entries(byStage).forEach(([k, v]) => col.add('inbound', 'pallets', `stage:${k}`, v));
  col.add('inbound', 'pos',            '__total__', posTotal);
  col.add('inbound', 'ordered_units',  '__total__', orderedUnits);
  col.add('inbound', 'received_units', '__total__', receivedUnits);
  col.add('inbound', 'boxes',          '__total__', boxes);
}

// ── Capture: attendance for the snapshot day (attendance_sync_state) ──
function captureAttendance(col, records, bizDate) {
  const todays = (Array.isArray(records) ? records : []).filter(r => String(r.date || '').trim() === bizDate);
  col.add('attendance', 'headcount', '__total__', todays.length);
  const byMark = {}, byDept = {};
  for (const r of todays) {
    const mark = (r.mark || '—').trim() || '—';
    const dept = (r.department || '—').trim() || '—';
    byMark[mark] = (byMark[mark] || 0) + 1;
    byDept[dept] = (byDept[dept] || 0) + 1;
  }
  Object.entries(byMark).forEach(([k, v]) => col.add('attendance', 'headcount', `mark:${k}`, v));
  Object.entries(byDept).forEach(([k, v]) => col.add('attendance', 'headcount', `dept:${k}`, v));
}

async function runCapture() {
  await ensureSchema();
  const bizDate = businessDateString();
  const col = makeCollector();

  const summary = { snapshot_date: bizDate, areas: {} };

  const workflow = await readJsonState('workflow_sync_state', 'data_json', {});
  try { captureOverstock(col, workflow || {}); summary.areas.overstock = 'ok'; }
  catch (e) { summary.areas.overstock = 'error: ' + e.message; }
  try { captureInbound(col, workflow || {}); summary.areas.inbound = 'ok'; }
  catch (e) { summary.areas.inbound = 'error: ' + e.message; }

  const attendance = await readJsonState('attendance_sync_state', 'records_json', []);
  try { captureAttendance(col, attendance || [], bizDate); summary.areas.attendance = 'ok'; }
  catch (e) { summary.areas.attendance = 'error: ' + e.message; }

  // Bulk upsert. ON CONFLICT keeps the latest capture for the day.
  const rows = col.rows();
  for (const r of rows) {
    await pool.query(
      `INSERT INTO daily_metrics (snapshot_date, area, metric, dimension, value, captured_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (snapshot_date, area, metric, dimension)
       DO UPDATE SET value = EXCLUDED.value, captured_at = now();`,
      [bizDate, r.area, r.metric, r.dimension, r.value]
    );
  }

  summary.rows_written = rows.length;
  return summary;
}

exports.handler = async function handler(event) {
  if (!process.env.DATABASE_URL) return json(500, { error: 'DATABASE_URL is not configured' });
  try {
    // Both the daily schedule and a manual GET (for seeding/verification) run
    // the same capture. A manual trigger is safe thanks to idempotency.
    const summary = await runCapture();
    return json(200, { ok: true, ...summary });
  } catch (error) {
    return json(500, { error: error.message || 'Capture failed' });
  }
};
