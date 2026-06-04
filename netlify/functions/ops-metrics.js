/* =========================================================================
   ops-metrics.js — Read-only data feed for the Trends/Stats page.

   Aggregates the four datasets that have real, time-stamped history into
   chart-ready JSON in a single round-trip:
     • daily_metrics            — captured overstock / inbound / attendance
     • sord_snapshots           — daily order-pipeline snapshots
     • pallet_events            — workflow activity events
     • productivity_daily_records — daily productivity / cost-per-unit

   Each query is wrapped so a missing/empty table degrades to [] rather than
   failing the whole response. Read-only: no writes anywhere.
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

async function safeRows(sql, params = []) {
  try {
    const r = await pool.query(sql, params);
    return r.rows;
  } catch (e) {
    // Table may not exist yet (e.g. daily_metrics before first capture) — that's fine.
    return [];
  }
}

exports.handler = async function handler(event) {
  if (!process.env.DATABASE_URL) return json(500, { error: 'DATABASE_URL is not configured' });

  // Optional window (days). Defaults to ~6 months; capped to keep payload sane.
  let days = parseInt((event.queryStringParameters && event.queryStringParameters.days) || '180', 10);
  if (!Number.isFinite(days) || days <= 0) days = 180;
  if (days > 730) days = 730;

  const [daily, sord, palletEvents, productivity] = await Promise.all([
    safeRows(
      `SELECT snapshot_date, area, metric, dimension, value
         FROM daily_metrics
        WHERE snapshot_date >= (CURRENT_DATE - $1::int)
        ORDER BY snapshot_date ASC`,
      [days]
    ),
    safeRows(
      `SELECT snapshot_date,
              SUM(units)      AS units,
              SUM(packs)      AS packs,
              SUM(subtotal)   AS subtotal,
              SUM(flag_count) AS flags,
              COUNT(*)        AS sords
         FROM sord_snapshots
        WHERE snapshot_date >= (CURRENT_DATE - $1::int)
        GROUP BY snapshot_date
        ORDER BY snapshot_date ASC`,
      [days]
    ),
    safeRows(
      `SELECT event_ts::date AS day, event_type, COUNT(*) AS count
         FROM pallet_events
        WHERE event_ts >= (CURRENT_DATE - $1::int)
        GROUP BY event_ts::date, event_type
        ORDER BY day ASC`,
      [days]
    ),
    safeRows(
      `SELECT record_date,
              total_touched_units,
              total_hours_used,
              cpu_touched,
              total_used_dollars
         FROM productivity_daily_records
        WHERE record_date >= (CURRENT_DATE - $1::int)
        ORDER BY record_date ASC`,
      [days]
    ),
  ]);

  return json(200, {
    ok: true,
    generated_at: new Date().toISOString(),
    window_days: days,
    daily_metrics: daily,
    sord: sord,
    pallet_events: palletEvents,
    productivity: productivity,
  });
};
