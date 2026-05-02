/* =========================================================
   po-lookup.js — Houston Control
   Cross-module PO investigation endpoint.
   Pulls from: pallet_events, putaway_po_lines,
               putaway_placements, workflow_sync_state
   GET ?po=PO-2024-00847
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

exports.handler = async function(event) {
  if (event.httpMethod !== 'GET') return json(405, { error: 'GET only' });

  const po = ((event.queryStringParameters || {}).po || '').trim();
  if (!po) return json(400, { error: 'po param required' });

  const term = `%${po}%`;

  try {
    // 1. Pallet events — full activity trail for this PO
    const eventsRes = await pool.query(`
      SELECT
        pe.id, pe.pallet_id, pe.pallet_label,
        pe.event_type, pe.detail, pe.po_num,
        pe.by_user, pe.event_ts
      FROM pallet_events pe
      WHERE pe.po_num ILIKE $1
      ORDER BY pe.event_ts ASC
    `, [term]);

    // 2. Putaway PO lines — what is/was in the PO (skip if table doesn't exist)
    let linesRes = { rows: [] };
    try {
      linesRes = await pool.query(`
        SELECT l.*,
          c.pallet_label, c.pallet_date, c.status AS container_status,
          c.created_at AS container_created_at
        FROM putaway_po_lines l
        JOIN putaway_containers c ON c.id = l.container_id
        WHERE l.po_number ILIKE $1
        ORDER BY c.created_at DESC
      `, [term]);
    } catch(_) { /* putaway tables may not exist yet */ }

    // 3. Placements for those lines
    let placements = [];
    try {
      const lineIds = linesRes.rows.map(r => r.id);
      if (lineIds.length) {
        const pRes = await pool.query(
          `SELECT * FROM putaway_placements WHERE po_line_id = ANY($1) ORDER BY placed_at DESC`,
          [lineIds]
        );
        placements = pRes.rows;
      }
    } catch(_) { /* putaway tables may not exist yet */ }

    // 4. Pull current inbound state to check if PO is still active on floor
    const stateRes = await pool.query(
      `SELECT data_json FROM workflow_sync_state WHERE state_key='default' LIMIT 1`
    );
    const state = stateRes.rows[0]?.data_json || {};
    const pallets = Array.isArray(state.pallets) ? state.pallets : [];

    // Find pallets that reference this PO in live state
    const activePallets = pallets.filter(function(p) {
      if (!p || !Array.isArray(p.pos)) return false;
      return p.pos.some(function(poEntry) {
        return poEntry && String(poEntry.poNum || poEntry.id || '').toUpperCase().includes(po.toUpperCase());
      });
    });

    // Derive summary
    const events = eventsRes.rows;
    const lines  = linesRes.rows;

    // Who worked on it
    const workers = [...new Set(events.map(e => e.by_user).filter(Boolean))];

    // Was it partial?
    const partialEvents = events.filter(e => e.event_type === 'po_partial' || e.event_type === 'po_prior_receipt');
    const isPartial = partialEvents.length > 0;

    // Is it done?
    const receivedEvents = events.filter(e => e.event_type === 'po_received');
    const isDone = receivedEvents.length > 0 && activePallets.length === 0 && lines.every(l => l.units_placed >= l.total_units);

    // Units summary
    const totalExpected = lines.reduce((s, l) => s + Number(l.total_units || 0), 0);
    const totalPlaced   = lines.reduce((s, l) => s + Number(l.units_placed || 0), 0);

    // Pallet labels from events
    const palletLabels = [...new Set(events.map(e => e.pallet_label).filter(Boolean))];

    // Locations placed
    const locationCodes = [...new Set(placements.map(p => p.location_code).filter(Boolean))];

    // Cases / issues
    const caseEvents = events.filter(e =>
      ['po_edited','damaged','issue','hold','partial'].some(k => (e.event_type||'').toLowerCase().includes(k))
      || (e.detail||'').toLowerCase().includes('damage')
      || (e.detail||'').toLowerCase().includes('case')
    );

    // Category from line
    const categories = [...new Set(lines.map(l => l.category).filter(Boolean))];
    const destinations = [...new Set(lines.map(l => l.destination_type).filter(Boolean))];

    // Modifications
    const modEvents = events.filter(e => e.event_type === 'po_edited');

    return json(200, {
      po,
      found: events.length > 0 || lines.length > 0,
      summary: {
        isDone,
        isPartial,
        palletLabels,
        workers,
        categories,
        destinations,
        locationCodes,
        totalExpected,
        totalPlaced,
        outstanding: Math.max(0, totalExpected - totalPlaced),
        shipmentCount: partialEvents.length + 1,
        modCount: modEvents.length,
        caseCount: caseEvents.length,
        activeOnFloor: activePallets.length > 0,
        activePallets: activePallets.map(p => ({ id: p.id, label: p.label, status: p.status })),
        lastActivity: events.length ? events[events.length - 1].event_ts : null,
        firstSeen: events.length ? events[0].event_ts : null,
      },
      events,
      lines,
      placements,
      caseEvents,
    });
  } catch(err) {
    console.error('po-lookup error:', err);
    return json(500, { error: err.message });
  }
};
