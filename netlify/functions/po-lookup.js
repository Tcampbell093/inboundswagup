/* =========================================================
   po-lookup.js — Houston Control
   Rich PO investigation endpoint.
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
    // 1. All pallet events for this PO
    const eventsRes = await pool.query(`
      SELECT id, pallet_id, pallet_label, event_type, detail, po_num, by_user, event_ts
      FROM pallet_events
      WHERE po_num ILIKE $1
      ORDER BY event_ts ASC
    `, [term]);
    const events = eventsRes.rows;

    // 2. Live workflow state — get PO data from all pallets
    const stateRes = await pool.query(
      `SELECT data_json FROM workflow_sync_state WHERE state_key='default' LIMIT 1`
    );
    const state = stateRes.rows[0]?.data_json || {};
    const allPallets = Array.isArray(state.pallets) ? state.pallets : [];

    // Find all pallets (past and present) that have/had this PO
    const palletLabelsFromEvents = [...new Set(events.map(e => e.pallet_label).filter(Boolean))];
    const matchingPallets = allPallets.filter(p =>
      p && Array.isArray(p.pos) && p.pos.some(poEntry =>
        String(poEntry.poNum || poEntry.po || poEntry.id || '').toUpperCase().includes(po.toUpperCase())
      )
    );

    // Build per-pallet PO data
    const palletData = matchingPallets.map(p => {
      const poEntry = p.pos.find(pe =>
        String(pe.poNum || pe.po || pe.id || '').toUpperCase().includes(po.toUpperCase())
      );
      return {
        palletId:       p.id,
        palletLabel:    p.label || p.id,
        palletStatus:   p.status,
        palletDate:     p.date || '',
        orderedQty:     poEntry?.orderedQty ?? null,
        receivedQty:    poEntry?.receivedQty ?? null,
        prepQty:        poEntry?.prepReceivedQty ?? null,
        stsQty:         poEntry?.stsQty ?? null,
        ltsQty:         poEntry?.ltsQty ?? null,
        destination:    poEntry?.destination ?? null,
        overstockQty:   (poEntry?.prepReceivedQty != null && poEntry?.orderedQty != null)
                          ? Math.max(0, Number(poEntry.prepReceivedQty) - Number(poEntry.orderedQty))
                          : null,
        overstockContainerCode: poEntry?.overstockContainerCode ?? null,
        overstockContainerId:   poEntry?.overstockContainerId ?? null,
        category:       poEntry?.category ?? null,
        prepVerified:   poEntry?.prepVerified ?? false,
        receivingDone:  poEntry?.receivingDone ?? false,
        boxes:          poEntry?.boxes ?? null,
        poId:           poEntry?.id,
      };
    });

    // 3. Putaway lines & placements
    let putawayLines = [], putawayPlacements = [];
    try {
      const linesRes = await pool.query(`
        SELECT l.*, c.pallet_label, c.pallet_date, c.status AS container_status,
               c.label AS container_label, c.code AS container_code
        FROM putaway_po_lines l
        JOIN putaway_containers c ON c.id = l.container_id
        WHERE l.po_number ILIKE $1
        ORDER BY c.created_at DESC
      `, [term]);
      putawayLines = linesRes.rows;

      if (putawayLines.length) {
        const lineIds = putawayLines.map(r => r.id);
        const pRes = await pool.query(
          `SELECT p.*, pl.location_code AS loc_code
           FROM putaway_placements p
           LEFT JOIN putaway_locations pl ON pl.location_code = p.location_code
           WHERE p.po_line_id = ANY($1)
           ORDER BY p.placed_at DESC`,
          [lineIds]
        );
        putawayPlacements = pRes.rows;
      }
    } catch(_) {}

    // 4. Overstock containers from live state
    const overstockContainers = [];
    if (Array.isArray(state.data?.overstockContainers)) {
      state.data.overstockContainers.forEach(c => {
        if (c && Array.isArray(c.items)) {
          c.items.forEach(item => {
            if (String(item.poNum || item.po || '').toUpperCase().includes(po.toUpperCase())) {
              overstockContainers.push({
                containerCode: c.code,
                containerId:   c.id,
                status:        c.status,
                qty:           item.qty,
                location:      c.location || null,
              });
            }
          });
        }
      });
    }

    // 5. Derive comprehensive summary
    const workers = [...new Set(events.map(e => e.by_user).filter(Boolean))];
    const isPartial = events.some(e => e.event_type === 'po_prior_receipt' || e.event_type === 'po_partial');
    const receivedEvents = events.filter(e => e.event_type === 'po_recv_done');
    const prepVerifiedEvents = events.filter(e => e.event_type === 'po_prep_verified');
    const routedEvents = events.filter(e => e.event_type === 'po_routed');
    const transferEvents = events.filter(e => e.event_type === 'po_transfer');
    const modEvents = events.filter(e => e.event_type === 'po_edited' || e.event_type === 'po_prep_qty' || e.event_type === 'po_recv_qty');

    // Stage progress from events
    const stages = {
      dock:      events.some(e => e.event_type === 'po_added'),
      receiving: receivedEvents.length > 0,
      prep:      prepVerifiedEvents.length > 0,
      putaway:   putawayLines.some(l => l.status === 'complete') || putawayPlacements.length > 0,
    };

    // Pending putaway check
    const pendingPutaway = putawayLines.filter(l => l.status !== 'complete');

    // STS/LTS totals across all pallets
    const totalSts = palletData.reduce((s, p) => s + Number(p.stsQty || 0), 0);
    const totalLts = palletData.reduce((s, p) => s + Number(p.ltsQty || 0), 0);
    const totalOverstock = palletData.reduce((s, p) => s + Number(p.overstockQty || 0), 0);
    const allCategories = [...new Set(palletData.map(p => p.category).filter(Boolean))];
    const locationCodes = [...new Set(putawayPlacements.map(p => p.location_code).filter(Boolean))];

    const latestPalletData = palletData[0] || null;

    return json(200, {
      po,
      found: events.length > 0 || palletData.length > 0,
      summary: {
        // Stage journey
        stages,
        palletLabels:  palletLabelsFromEvents.length ? palletLabelsFromEvents
                       : palletData.map(p => p.palletLabel),
        activePallets: matchingPallets.filter(p => p.status !== 'done').map(p => ({
          label: p.label, status: p.status, date: p.date
        })),
        categories:    allCategories,
        workers,
        isPartial,
        shipmentCount: events.filter(e => e.event_type === 'po_added' || e.event_type === 'po_prior_receipt').length,
        modCount:      modEvents.length,
        transfers:     transferEvents.map(e => ({ detail: e.detail, ts: e.event_ts, by: e.by_user, pallet: e.pallet_label })),
        // Quantities
        orderedQty:    latestPalletData?.orderedQty ?? null,
        receivedQty:   latestPalletData?.receivedQty ?? null,
        prepQty:       latestPalletData?.prepQty ?? null,
        stsQty:        totalSts || latestPalletData?.stsQty || null,
        ltsQty:        totalLts || latestPalletData?.ltsQty || null,
        overstockQty:  totalOverstock,
        destination:   latestPalletData?.destination ?? null,
        // Overstock containers
        overstockContainers,
        overstockContainerCode: latestPalletData?.overstockContainerCode ?? null,
        // Putaway
        locationCodes,
        putawayComplete:  putawayLines.length > 0 && pendingPutaway.length === 0,
        pendingPutaway:   pendingPutaway.map(l => ({ poLine: l.po_number, category: l.category, container: l.container_label || l.container_code })),
        // Status
        firstSeen:     events.length ? events[0].event_ts : null,
        lastActivity:  events.length ? events[events.length-1].event_ts : null,
      },
      events,
      palletData,
      putawayLines,
      putawayPlacements,
      overstockContainers,
    });
  } catch(err) {
    console.error('po-lookup error:', err);
    return json(500, { error: err.message });
  }
};
