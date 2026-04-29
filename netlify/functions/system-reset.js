/* =========================================================
   system-reset.js — Houston Control
   Clears all operational data from Neon.
   Preserves: hc_users, access_audit
   Admin only.
   ========================================================= */

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : undefined,
});

const GOTRUE_URL = 'https://inboundswagup.netlify.app/.netlify/identity';

function json(code, body) {
  return {
    statusCode: code,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

async function verifyAdmin(event) {
  const auth  = event.headers['authorization'] || event.headers['Authorization'] || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return null;

  const res = await fetch(`${GOTRUE_URL}/user`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) return null;
  const user = await res.json();

  // Check role in DB
  const dbRes = await pool.query('SELECT role FROM hc_users WHERE email=$1', [user.email]);
  const role  = dbRes.rows[0]?.role
             || user.app_metadata?.role
             || user.app_metadata?.roles?.[0]
             || 'l1';

  if (role !== 'admin') return null;
  return { email: user.email, role };
}

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const caller = await verifyAdmin(event);
  if (!caller) return json(401, { error: 'Unauthorized — admin only' });

  console.log('HC Reset: initiated by', caller.email, 'at', new Date().toISOString());

  const cleared = [];
  const errors  = [];

  // Tables to TRUNCATE (wipe all rows)
  const operationalTables = [
    'assembly_sync_state',
    'attendance_sync_state',
    'cycle_count_sync_state',
    'employees_sync_state',
    'flight_tracker_comments',
    'fulfillment_sync_state',
    'huddle_recaps',
    'sord_snapshots',
    'policy_sync_state',
    'productivity_settings',
    'productivity_import_batches',
    'productivity_labor_entries',
    'productivity_daily_records',
    'putaway_containers',
    'putaway_po_lines',
    'putaway_placements',
    'putaway_locations',
    'rev_tracker_sync',
    'workflow_sync_state',
    'pallet_events',
    'hc_notifications',
  ];

  // workspaces table is shared — only clear rows that aren't user management related
  // We'll reset it too since it's just settings state
  operationalTables.push('workspaces');

  for (const table of operationalTables) {
    try {
      // Check if table exists first
      const exists = await pool.query(
        `SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_name = $1
        )`,
        [table]
      );
      if (exists.rows[0].exists) {
        await pool.query(`TRUNCATE TABLE ${table} RESTART IDENTITY CASCADE`);
        cleared.push(table);
        console.log('HC Reset: cleared', table);
      }
    } catch(e) {
      console.error('HC Reset: failed to clear', table, e.message);
      errors.push({ table, error: e.message });
    }
  }

  // Write reset event to audit log (keep audit log, just add the reset entry)
  try {
    await pool.query(
      `INSERT INTO access_audit (actor, target, action, detail)
       VALUES ($1, 'system', 'system_reset', $2)`,
      [caller.email, JSON.stringify({ cleared, errors, timestamp: new Date().toISOString() })]
    );
  } catch(e) {
    console.error('HC Reset: failed to write audit entry', e.message);
  }

  console.log('HC Reset: complete. Cleared:', cleared.length, 'tables. Errors:', errors.length);

  return json(200, {
    ok: true,
    cleared,
    errors,
    message: `Reset complete. ${cleared.length} data sources cleared.`,
  });
};
