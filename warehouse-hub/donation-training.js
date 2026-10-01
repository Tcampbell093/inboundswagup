(() => {
  const TODAY = '2026-10-01';
  const EMBEDDED = new URLSearchParams(window.location.search).get('embed') === '1';
  document.body.classList.toggle('embedded', EMBEDDED);

  const REASONS = {
    qa_too_new: 'QA Approval was less than 10 days ago.',
    packbuilder_invalid: 'A Pack Builder exists, but its status is not Complete.',
    pack_too_new: 'The Pack Account Product has not reached 30 days from the first shipment after New Inventory.',
    bulk_stock: 'The purple Warehouse Storage Locations section still has inventory.',
    bulk_too_new: 'The bulk item has not reached 30 days from the first shipment after New Inventory.',
    bulk_no_history: 'The bulk item does not have a qualifying New Inventory → first Shipment history to verify 30 days.',
  };

  const scenarios = [
    {
      id: 'qa-too-new',
      po: 'PO-41021',
      client: 'Harbor Youth Network',
      bulkProduct: 'Harbor / Welcome Kit Water Bottle',
      qaApproved: '2026-09-25',
      packBuilder: { exists: false },
      bulk: {
        stockRows: [{ size: 'One Size', sku: 'TRAIN-101', total: 0, location: '—', quantity: 0 }],
        events: [
          { date: '2026-09-10 11:10 AM', type: 'Shipping', id: 'P-71011' },
          { date: '2026-08-01 08:35 AM', type: 'New Inventory', id: 'TR-41021' },
        ],
      },
      outcome: 'not',
      reason: 'qa_too_new',
    },
    {
      id: 'pb-pending',
      po: 'PO-41034',
      client: 'Northview Community Care',
      bulkProduct: 'Northview / Canvas Tote',
      qaApproved: '2026-09-10',
      packBuilder: {
        exists: true, status: 'Pending', name: 'PB-20041', product: 'Northview New Hire Pack',
        newInventory: '2026-07-01', firstShipment: '2026-07-10',
      },
      bulk: {
        stockRows: [{ size: 'One Size', sku: 'TRAIN-102', total: 0, location: '—', quantity: 0 }],
        events: [
          { date: '2026-07-10 09:15 AM', type: 'Shipping', id: 'P-71201' },
          { date: '2026-07-01 09:00 AM', type: 'New Inventory', id: 'TR-41034' },
        ],
      },
      outcome: 'not',
      reason: 'packbuilder_invalid',
    },
    {
      id: 'pack-too-new',
      po: 'PO-41056',
      client: 'BrightPath Learning',
      bulkProduct: 'BrightPath / Soft Touch Pen',
      qaApproved: '2026-08-28',
      packBuilder: {
        exists: true, status: 'Complete', name: 'PB-20056', product: 'BrightPath Teacher Pack',
        newInventory: '2026-09-15', firstShipment: '2026-09-16',
      },
      bulk: {
        stockRows: [{ size: 'One Size', sku: 'TRAIN-103', total: 0, location: '—', quantity: 0 }],
        events: [
          { date: '2026-08-12 09:15 AM', type: 'Shipping', id: 'P-71301' },
          { date: '2026-07-01 09:00 AM', type: 'New Inventory', id: 'TR-41056' },
        ],
      },
      outcome: 'not',
      reason: 'pack_too_new',
    },
    {
      id: 'bulk-stock',
      po: 'PO-41072',
      client: 'Civic Arts Foundation',
      bulkProduct: 'Civic Arts / Enamel Pin',
      qaApproved: '2026-08-10',
      packBuilder: { exists: false },
      bulk: {
        stockRows: [
          { size: 'One Size', sku: 'TRAIN-104', total: 14, location: 'E-12', quantity: 14 },
        ],
        events: [
          { date: '2026-08-05 01:20 PM', type: 'Shipping', id: 'P-71401' },
          { date: '2026-07-15 10:05 AM', type: 'New Inventory', id: 'TR-41072' },
        ],
      },
      outcome: 'not',
      reason: 'bulk_stock',
    },
    {
      id: 'bulk-too-new',
      po: 'PO-41083',
      client: 'Evergreen Family Services',
      bulkProduct: 'Evergreen / Phone Wallet',
      qaApproved: '2026-08-01',
      packBuilder: { exists: false },
      bulk: {
        stockRows: [{ size: 'One Size', sku: 'TRAIN-105', total: 0, location: '—', quantity: 0 }],
        events: [
          { date: '2026-09-26 02:16 PM', type: 'Shipping', id: 'P-71502' },
          { date: '2026-09-06 09:02 AM', type: 'Shipping', id: 'P-71501' },
          { date: '2026-09-05 08:41 AM', type: 'New Inventory', id: 'TR-41083' },
        ],
      },
      outcome: 'not',
      reason: 'bulk_too_new',
    },
    {
      id: 'qualifies-pack',
      po: 'PO-41102',
      client: 'Women Forward Initiative',
      bulkProduct: 'Women Forward / Performance Cap',
      qaApproved: '2026-08-11',
      packBuilder: {
        exists: true, status: 'Complete', name: 'PB-20102', product: 'Women Forward Legacy Pack',
        newInventory: '2026-08-24', firstShipment: '2026-08-25',
      },
      bulk: {
        stockRows: [{ size: 'One Size', sku: 'TRAIN-106', total: 0, location: '—', quantity: 0 }],
        events: [
          { date: '2026-09-10 11:34 AM', type: 'Shipping', id: 'P-71603' },
          { date: '2026-08-28 02:03 PM', type: 'Shipping', id: 'P-71602' },
          { date: '2026-08-06 12:11 PM', type: 'Shipping', id: 'P-71601' },
          { date: '2026-07-20 04:09 PM', type: 'New Inventory', id: 'TR-41102' },
        ],
      },
      outcome: 'donation',
    },
    {
      id: 'qualifies-no-pack',
      po: 'PO-41117',
      client: 'CareBridge Outreach',
      bulkProduct: 'CareBridge / Stress Ball',
      qaApproved: '2026-07-20',
      packBuilder: { exists: false },
      bulk: {
        stockRows: [{ size: 'One Size', sku: 'TRAIN-107', total: 0, location: '—', quantity: 0 }],
        events: [
          { date: '2026-09-10 11:30 AM', type: 'Shipping', id: 'P-71704' },
          { date: '2026-08-06 12:14 PM', type: 'Shipping', id: 'P-71702' },
          { date: '2026-07-11 10:15 AM', type: 'Shipping', id: 'P-71701' },
          { date: '2026-07-10 09:20 AM', type: 'New Inventory', id: 'TR-41117' },
        ],
      },
      outcome: 'donation',
    },
    {
      id: 'no-bulk-history',
      po: 'PO-41129',
      client: 'Summit Veterans Project',
      bulkProduct: 'Summit Veterans / Knit Cap',
      qaApproved: '2026-08-05',
      packBuilder: {
        exists: true, status: 'Complete', name: 'PB-20129', product: 'Summit Veterans Welcome Pack',
        newInventory: '2026-07-20', firstShipment: '2026-07-21',
      },
      bulk: {
        stockRows: [{ size: 'One Size', sku: 'TRAIN-108', total: 0, location: '—', quantity: 0 }],
        events: [{ date: '2025-02-21 02:20 PM', type: 'Setup', id: '' }],
      },
      outcome: 'not',
      reason: 'bulk_no_history',
    },
  ];

  const state = {
    mode: 'guided',
    order: shuffle(scenarios.map((_, i) => i)),
    pointer: 0,
    screen: 'po',
    poTab: 'details',
    productTab: 'details',
    productKind: '',
    score: 100,
    mistakes: [],
    reviewed: new Set(),
    decisionType: '',
  };

  const $ = (id) => document.getElementById(id);
  const simScreen = $('simScreen');
  const guidedCoach = $('guidedCoach');
  const coachText = $('coachText');
  const checklist = $('checklist');
  const decisionDialog = $('decisionDialog');
  const resultDialog = $('resultDialog');

  function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function shuffle(values) {
    const list = [...values];
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  }

  function current() {
    return scenarios[state.order[state.pointer % state.order.length]];
  }

  function dateOnly(value) {
    return String(value || '').slice(0, 10);
  }

  function daysBetween(from, to = TODAY) {
    const a = new Date(dateOnly(from) + 'T12:00:00Z');
    const b = new Date(dateOnly(to) + 'T12:00:00Z');
    return Math.floor((b - a) / 86400000);
  }

  function fmtDate(value) {
    const d = new Date(dateOnly(value) + 'T12:00:00Z');
    if (Number.isNaN(d.getTime())) return value || '—';
    return d.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric', timeZone:'UTC' });
  }

  function parseEventDate(value) {
    const text = String(value || '').trim();
    const match = /^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM))?/i.exec(text);
    if (!match) return new Date(dateOnly(text) + 'T12:00:00Z');
    let hour = Number(match[4] || 12);
    const minute = Number(match[5] || 0);
    const meridiem = String(match[6] || '').toUpperCase();
    if (meridiem === 'PM' && hour < 12) hour += 12;
    if (meridiem === 'AM' && hour === 12) hour = 0;
    return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), hour, minute));
  }

  function bulkFirstShipmentAfterNewInventory(sc) {
    const rows = sc.bulk.events || [];
    const newInv = [...rows]
      .filter((r) => r.type === 'New Inventory')
      .sort((a,b) => parseEventDate(a.date) - parseEventDate(b.date))[0];
    if (!newInv) return { newInventory:null, shipment:null };
    const newInventoryTime = parseEventDate(newInv.date);
    const shipment = [...rows]
      .filter((r) => r.type === 'Shipping' && parseEventDate(r.date) > newInventoryTime)
      .sort((a,b) => parseEventDate(a.date) - parseEventDate(b.date))[0];
    return { newInventory:newInv, shipment:shipment || null };
  }

  function stageInfo(sc = current()) {
    const qaDays = daysBetween(sc.qaApproved);
    if (qaDays < 10) return { key:'qa', done:0, stopReason:'qa_too_new' };

    if (sc.packBuilder.exists && sc.packBuilder.status !== 'Complete') {
      return { key:'packbuilder', done:1, stopReason:'packbuilder_invalid' };
    }

    if (sc.packBuilder.exists) {
      const packDays = daysBetween(sc.packBuilder.firstShipment);
      if (packDays < 30) return { key:'packhistory', done:2, stopReason:'pack_too_new' };
    }

    const qty = (sc.bulk.stockRows || []).reduce((n, row) => n + Number(row.total || 0), 0);
    if (qty > 0) return { key:'bulkstock', done:3, stopReason:'bulk_stock' };

    const { newInventory, shipment } = bulkFirstShipmentAfterNewInventory(sc);
    if (!newInventory || !shipment) return { key:'bulkhistory', done:4, stopReason:'bulk_no_history' };
    if (daysBetween(shipment.date) < 30) return { key:'bulkhistory', done:4, stopReason:'bulk_too_new' };

    return { key:'complete', done:5, stopReason:null };
  }

  function expectedReason() {
    return stageInfo().stopReason;
  }

  function qualificationResults(sc = current()) {
    const bulkPair = bulkFirstShipmentAfterNewInventory(sc);
    const bulkQty = (sc.bulk.stockRows || []).reduce((n, row) => n + Number(row.total || 0), 0);
    return {
      qa: daysBetween(sc.qaApproved) >= 10,
      packbuilder: !sc.packBuilder.exists || sc.packBuilder.status === 'Complete',
      packhistory: !sc.packBuilder.exists || (sc.packBuilder.status === 'Complete' && daysBetween(sc.packBuilder.firstShipment) >= 30),
      bulkstock: bulkQty === 0,
      bulkhistory: !!bulkPair.newInventory && !!bulkPair.shipment && daysBetween(bulkPair.shipment.date) >= 30,
    };
  }

  function coachMessage() {
    const sc = current();
    const results = qualificationResults(sc);
    if (state.mode === 'test') return 'No hints in Practice Test. Navigate the case, inspect the evidence, and make your decision when ready.';

    if (!state.reviewed.has('qa')) {
      return 'Open the PO’s Related tab and find the QA Approved date in Purchase Order History. Rule: at least 10 full days must have passed.';
    }
    if (!results.qa) {
      return 'You found the QA Approved date. Compare it with the training date using the 10-day rule, then make your decision.';
    }

    if (!state.reviewed.has('packbuilder')) {
      return 'Check the Pack Builder panel. Rule: no Pack Builder is acceptable; if one exists, its status must be Complete.';
    }
    if (!results.packbuilder) {
      return 'You found the Pack Builder status. Apply the rule: it must be Complete, or the Pack Builder must not exist. Then make your decision.';
    }

    if (sc.packBuilder.exists && !state.reviewed.has('packhistory')) {
      return 'Open the Pack Builder’s Product link, then Inventory/Stock. Find New Inventory and the first Shipping event after it. Rule: at least 30 full days must have passed from that first shipment.';
    }
    if (!results.packhistory) {
      return 'You found the Pack shipment history. Apply the 30-day rule to the first Shipping event after New Inventory, then make your decision.';
    }

    if (!state.reviewed.has('bulkstock')) {
      return 'Return to the PO and open the Account Product in the top-left. In Inventory/Stock, ignore Stock Status and inspect only the purple Warehouse Storage Locations section. Rule: that purple inventory must be zero.';
    }
    if (!results.bulkstock) {
      return 'You found the purple Warehouse Storage Locations inventory. Apply the zero-inventory rule, then make your decision.';
    }

    if (!state.reviewed.has('bulkhistory')) {
      return 'Now use the bulk item’s Inventory History. Find New Inventory, then the first Shipping event after it. Rule: at least 30 full days must have passed from that first shipment.';
    }
    if (!results.bulkhistory) {
      return 'You found the bulk Inventory History. Apply the 30-day rule to the first Shipping event after New Inventory, then make your decision.';
    }
    return 'You have inspected every required qualification. Use the rules above and submit your final decision.';
  }

  function renderChecklist() {
    const sc = current();
    const items = [
      ['qa','QA Approved','At least 10 days ago'],
      ['packbuilder','Pack Builder','Complete or nonexistent'],
      ['packhistory','Pack Account Product','30+ days from first shipment after New Inventory'],
      ['bulkstock','Bulk inventory','Purple Warehouse Storage Locations = 0'],
      ['bulkhistory','Bulk Inventory History','30+ days from first shipment after New Inventory'],
    ];

    if (state.mode === 'test') {
      checklist.innerHTML = items.map((item, i) => `<div class="check-item">
        <span class="num">${i+1}</span>
        <div><b>${item[1]}</b><small>${item[2]}</small></div>
      </div>`).join('');
      return;
    }

    const results = qualificationResults(sc);
    const reviewed = {
      qa: state.reviewed.has('qa'),
      packbuilder: state.reviewed.has('packbuilder'),
      packhistory: !sc.packBuilder.exists ? state.reviewed.has('packbuilder') : state.reviewed.has('packhistory'),
      bulkstock: state.reviewed.has('bulkstock'),
      bulkhistory: state.reviewed.has('bulkhistory'),
    };

    let firstFailedIndex = -1;
    items.forEach((item, i) => {
      if (firstFailedIndex < 0 && reviewed[item[0]] && !results[item[0]]) firstFailedIndex = i;
    });

    let firstPendingIndex = -1;
    items.forEach((item, i) => {
      if (firstPendingIndex < 0 && !reviewed[item[0]] && (firstFailedIndex < 0 || i <= firstFailedIndex)) firstPendingIndex = i;
    });

    checklist.innerHTML = items.map((item, i) => {
      const key = item[0];
      const blocked = firstFailedIndex >= 0 && i > firstFailedIndex;
      const passed = !blocked && reviewed[key] && results[key];
      const failed = !blocked && reviewed[key] && !results[key];
      const active = !blocked && !reviewed[key] && i === firstPendingIndex;
      const icon = passed ? '✓' : failed ? '!' : i + 1;
      const extra = key === 'packhistory' && !sc.packBuilder.exists && passed ? ' · Not required' : '';
      return `<div class="check-item${passed ? ' done' : ''}${failed ? ' failed' : ''}${active ? ' active' : ''}">
        <span class="num">${icon}</span>
        <div><b>${item[1]}</b><small>${item[2]}${extra}</small></div>
      </div>`;
    }).join('');
  }

  function renderCoach() {
    guidedCoach.style.display = state.mode === 'test' ? 'none' : '';
    coachText.textContent = coachMessage();
    renderChecklist();
    $('scorePill').textContent = `${state.score} pts`;
  }

  function crmNav(active) {
    return `<div class="crm-nav">
      <span class="crm-logo">Training CRM</span><span>Home</span><span>Search by PO</span><span class="${active==='po'?'active':''}"><b>Purchase Orders</b></span>
      <span>Sales Orders</span><span>Reports</span><span>Accounts</span><span class="${active==='product'?'active':''}"><b>Account Products</b></span>
    </div>`;
  }

  function poHistory(sc) {
    const rows = [
      { date: sc.qaApproved + ' 11:35 AM', field:'Status', original:'Item Fully Received at Warehouse', next:'QA Approved', user:'Training Associate' },
      { date: offsetDate(sc.qaApproved,-2) + ' 10:00 AM', field:'Quantity Received', original:'', next:'41', user:'Training Associate' },
      { date: offsetDate(sc.qaApproved,-4) + ' 09:12 AM', field:'Status', original:'Item Partially Received', next:'Item Fully Received at Warehouse', user:'Training Associate' },
      { date: offsetDate(sc.qaApproved,-6) + ' 02:20 PM', field:'Status', original:'Ship Date Confirmed', next:'Item Partially Received', user:'Training User' },
    ];
    return `<div class="panel">
      <div class="panel-head"><h4>Purchase Order History (10+)</h4><small>Sorted by Date · Updated a few seconds ago</small></div>
      <table class="history-table"><thead><tr><th>Date</th><th>Field</th><th>User</th><th>Original Value</th><th>New Value</th></tr></thead>
      <tbody>${rows.map((r,i)=>`<tr${i===0?' data-evidence="qa"':''}><td>${esc(fmtDateTime(r.date))}</td><td>${esc(r.field)}</td><td>${esc(r.user)}</td><td>${esc(r.original)}</td><td><b>${esc(r.next)}</b></td></tr>`).join('')}</tbody></table>
      ${state.mode==='guided' ? `<div class="callout">QA Approved: <b>${fmtDate(sc.qaApproved)}</b> · ${daysBetween(sc.qaApproved)} days before the training date.</div>` : ''}
    </div>`;
  }

  function packBuilderCard(sc) {
    if (!sc.packBuilder.exists) {
      return `<div class="side-card clickable ${hintClass('packbuilder')}" data-review="packbuilder"><h4>Pack Builder (0)</h4><div class="side-card-content"><span style="font-size:9px;color:#7f8b93">No Pack Builder exists for this PO.</span></div></div>`;
    }
    const good = sc.packBuilder.status === 'Complete';
    return `<div class="side-card clickable ${hintClass('packbuilder')}" data-review="packbuilder">
      <h4>Pack Builder (1)</h4>
      <div class="side-card-content">
        <div class="pb-row"><b>${esc(sc.packBuilder.name)}</b><button class="crm-link" data-open-pack type="button">${esc(sc.packBuilder.product)}</button><span class="status-chip ${good?'':'bad'}">${esc(sc.packBuilder.status)}</span></div>
      </div>
    </div>`;
  }

  function renderPO() {
    const sc = current();
    const related = state.poTab === 'related';
    simScreen.innerHTML = `<div class="crm ${state.mode==='guided'?'guided':''}">
      ${crmNav('po')}
      <div class="crm-title">
        <div class="product-title-row">
          <div><div class="object-type">Purchase Order</div><h3>${esc(sc.po)}</h3>
          <div style="font-size:9px;color:#667681">Account Product · <button class="crm-link ${hintClass('bulkstock')}" data-open-bulk type="button">${esc(sc.bulkProduct)}</button> &nbsp; · &nbsp; Status <b>QA Approved</b> &nbsp; · &nbsp; Client ${esc(sc.client)}</div></div>
        </div>
        <div class="crm-actions"><button>Add Tracking Information</button><button>Add to Inventory</button><button>PO Size Conf</button></div>
      </div>
      <div class="status-path"><span>PO Sent</span><span>Supplier Ack.</span><span>Shipped</span><span>Received</span><span class="current">QA Approved</span><span style="background:#e7ebee;color:#687680">PO Complete</span></div>
      <div class="crm-body">
        <div class="main-pane">
          <div class="hero-product"><div class="fake-product">TRAINING<br>PRODUCT</div></div>
          <div>
            <div class="tabs">
              <button class="tab ${!related?'active':''}" data-po-tab="details" type="button">Details</button>
              <button class="tab" type="button">Provider Invoices</button>
              <button class="tab" type="button">PO Tracking</button>
              <button class="tab" type="button">Activity</button>
              <button class="tab ${related?'active':''} clickable ${hintClass('qa')}" data-po-tab="related" type="button">Related</button>
            </div>
            ${related ? poHistory(sc) : `<div class="panel"><div class="info-grid">
              <div class="field"><span>Purchase Order Name</span><b>${esc(sc.po)}</b></div>
              <div class="field"><span>Status</span><b>QA Approved</b></div>
              <div class="field"><span>Client</span><b>${esc(sc.client)}</b></div>
              <div class="field"><span>Training note</span><b>Use Related for QA history</b></div>
            </div></div>`}
          </div>
        </div>
        <div class="side-pane">
          <div class="side-card"><h4>Stock Information</h4><div class="side-card-content"><table class="stock-table"><tr><th>Size</th><th>Stock</th><th>Storage</th></tr><tr><td>One Size</td><td>0</td><td>P3B3</td></tr></table></div></div>
          <div class="side-card"><h4>Sales Orders (1)</h4><div class="side-card-content"><button class="crm-link">SORD-51002</button></div></div>
          ${packBuilderCard(sc)}
          <div class="side-card"><h4>Barcode</h4><div class="side-card-content"><div class="barcode"></div><div style="text-align:center;font-size:10px">${esc(sc.po)}</div></div></div>
        </div>
      </div>
      <div class="training-note">Practice environment — fictional data. The layout is simplified to reinforce the real decision sequence.</div>
    </div>`;
    bindPO();
  }

  function inventoryHistoryRows(sc, kind) {
    if (kind === 'pack') {
      const rows = [
        { date: addTime(sc.packBuilder.firstShipment,'02:16 AM'), type:'Shipping', id:'P-72007' },
        { date: addTime(sc.packBuilder.newInventory,'10:41 AM'), type:'New Inventory', id:sc.packBuilder.name },
        { date: offsetDate(sc.packBuilder.newInventory,-45) + ' 02:27 PM', type:'Setup', id:'' },
      ];
      return rows;
    }
    return sc.bulk.events || [];
  }

  function renderAccountProduct(kind) {
    const sc = current();
    const isPack = kind === 'pack';
    const title = isPack ? sc.packBuilder.product : sc.bulkProduct;
    const inventory = state.productTab === 'inventory';
    const rows = inventoryHistoryRows(sc, kind);
    const purpleQty = sc.bulk.stockRows.reduce((n,r)=>n+Number(r.total||0),0);

    simScreen.innerHTML = `<div class="crm ${state.mode==='guided'?'guided':''}">
      ${crmNav('product')}
      <div class="crm-title"><div><div class="object-type">Account Product</div><h3>${esc(title)}</h3></div>
        <div class="crm-actions"><button>Follow</button><button>Re-sync with Base Product</button><button>Edit</button><button>Inventory</button></div>
      </div>
      <div class="account-layout">
        <div class="account-hero">${isPack ? `<div class="pack-visual"><i></i><i></i><i></i><i></i><i></i><i></i></div>` : '<div class="fake-product">BULK<br>ITEM</div>'}</div>
        <div class="tabs">
          <button class="tab" type="button">Related</button>
          <button class="tab" type="button">Approval History</button>
          <button class="tab" type="button">History</button>
          <button class="tab ${inventory?'active':''} clickable ${hintClass(isPack?'packhistory':'bulkstock')}" data-product-tab="inventory" type="button">Inventory/Stock</button>
          <button class="tab" type="button">Barcodes</button>
          <button class="tab ${!inventory?'active':''}" data-product-tab="details" type="button">Details</button>
        </div>

        ${inventory ? `
          <section class="inventory-section">
            <div class="inventory-title"><span class="inventory-icon blue">▦</span> Stock Status</div>
            <div style="padding:8px"><table class="stock-table"><thead><tr><th>Size</th><th>Stock</th><th>Barcode</th><th>Storage Locations</th><th>Pending Shipment</th><th>Complete Shipment</th></tr></thead>
            <tbody><tr><td>One Size</td><td>${isPack ? '2' : '0'}</td><td>TRAIN-BC</td><td>${isPack?'E11J2':'P3B3'}</td><td>0</td><td>${isPack?'12':'860'}</td></tr></tbody></table></div>
          </section>
          ${!isPack ? `<section class="inventory-section purple-panel clickable ${hintClass('bulkstock')}" data-review="bulkstock">
            <div class="inventory-title"><span class="inventory-icon purple">▦</span> Warehouse Storage Locations</div>
            <div style="padding:8px"><table class="stock-table"><thead><tr><th>Size</th><th>SKU</th><th>Total Quantity</th><th>Warehouse</th><th>Location</th><th>Quantity</th></tr></thead>
            <tbody>${sc.bulk.stockRows.map(r=>`<tr><td>${esc(r.size)}</td><td>${esc(r.sku)}</td><td><b>${Number(r.total)}</b></td><td>Training</td><td>${esc(r.location)}</td><td>${Number(r.quantity)}</td></tr>`).join('')}</tbody></table>
            ${state.mode==='guided' ? `<div class="callout warning">Use this purple section for the donation inventory check. Total Quantity = <b>${purpleQty}</b>. Ignore the Stock Status number above.</div>` : ''}
            </div></section>` : ''}
          <section class="inventory-section clickable ${hintClass(isPack?'packhistory':'bulkhistory')}" data-review="${isPack?'packhistory':'bulkhistory'}">
            <div class="inventory-title"><span class="inventory-icon blue">↺</span> Inventory History</div>
            <div style="padding:8px"><table class="history-table"><thead><tr><th>Created Date</th><th>Event Type</th><th>Event ID</th><th>Tracking ID#</th><th>WO</th></tr></thead>
            <tbody>${rows.map(r=>`<tr><td>${esc(fmtDateTime(r.date))}</td><td><b>${esc(r.type)}</b></td><td>${esc(r.id||'')}</td><td>${r.type==='Shipping'?'trk_training_...':''}</td><td>${r.type==='Shipping'?'WO-7201':''}</td></tr>`).join('')}</tbody></table>
            ${historyGuidance(sc,kind)}
            </div>
          </section>
        ` : `<div class="panel"><div class="info-grid">
          <div class="field"><span>Account Product Name</span><b>${esc(title)}</b></div>
          <div class="field"><span>Record Type</span><b>${isPack?'Pack':'Product'}</b></div>
          <div class="field"><span>Status</span><b>Approved</b></div>
          <div class="field"><span>Training task</span><b>Open Inventory/Stock</b></div>
        </div></div>`}
      </div>
      <div class="training-note"><button class="crm-link" data-back-po type="button">← Return to ${esc(sc.po)}</button> &nbsp; · &nbsp; Practice environment — fictional data.</div>
    </div>`;
    bindProduct();
  }

  function historyGuidance(sc, kind) {
    if (state.mode !== 'guided') return '';
    if (kind === 'pack') {
      const days = daysBetween(sc.packBuilder.firstShipment);
      return `<div class="callout">New Inventory: <b>${fmtDate(sc.packBuilder.newInventory)}</b>. First Shipping after it: <b>${fmtDate(sc.packBuilder.firstShipment)}</b>. That shipment was ${days} days ago.</div>`;
    }
    const pair = bulkFirstShipmentAfterNewInventory(sc);
    if (!pair.newInventory || !pair.shipment) {
      return '<div class="callout warning">A qualifying New Inventory → first Shipping sequence is not present, so the 30-day requirement cannot be confirmed.</div>';
    }
    return `<div class="callout">New Inventory: <b>${fmtDate(pair.newInventory.date)}</b>. First Shipping after it: <b>${fmtDate(pair.shipment.date)}</b>. That first shipment was ${daysBetween(pair.shipment.date)} days ago. Do not use the newest shipment.</div>`;
  }

  function hintClass(step) {
    if (state.mode !== 'guided') return '';
    const msg = coachMessage();
    const map = {
      qa:'QA Approved',
      packbuilder:'Pack Builder',
      packhistory:'Pack',
      bulkstock:'purple',
      bulkhistory:'bulk item',
    };
    return msg.includes(map[step] || '__never__') ? 'hint' : '';
  }

  function bindPO() {
    simScreen.querySelectorAll('[data-po-tab]').forEach((btn) => btn.addEventListener('click', () => {
      state.poTab = btn.dataset.poTab;
      if (state.poTab === 'related') state.reviewed.add('qa');
      renderAll();
    }));
    simScreen.querySelectorAll('[data-review="packbuilder"]').forEach((node) => node.addEventListener('click', (event) => {
      if (event.target.closest('[data-open-pack]')) return;
      state.reviewed.add('packbuilder');
      renderAll();
    }));
    simScreen.querySelector('[data-open-pack]')?.addEventListener('click', () => {
      state.reviewed.add('packbuilder');
      state.productKind = 'pack';
      state.screen = 'product';
      state.productTab = 'details';
      renderAll();
    });
    simScreen.querySelector('[data-open-bulk]')?.addEventListener('click', () => {
      state.reviewed.add('packbuilder');
      state.productKind = 'bulk';
      state.screen = 'product';
      state.productTab = 'details';
      renderAll();
    });
  }

  function bindProduct() {
    simScreen.querySelectorAll('[data-product-tab]').forEach((btn) => btn.addEventListener('click', () => {
      state.productTab = btn.dataset.productTab;
      if (state.productTab === 'inventory') {
        state.reviewed.add(state.productKind === 'pack' ? 'packhistory' : 'bulkstock');
      }
      renderAll();
    }));
    simScreen.querySelectorAll('[data-review]').forEach((node) => node.addEventListener('click', () => {
      state.reviewed.add(node.dataset.review);
      renderAll();
    }));
    simScreen.querySelector('[data-back-po]')?.addEventListener('click', () => {
      state.screen = 'po';
      state.poTab = 'details';
      state.productKind = '';
      state.productTab = 'details';
      renderAll();
    });
  }

  function renderScreen() {
    if (state.screen === 'product') renderAccountProduct(state.productKind);
    else renderPO();
  }

  function renderAll() {
    const sc = current();
    $('caseLabel').textContent = `Case ${state.pointer + 1} · ${sc.po}`;
    document.body.classList.toggle('test-mode', state.mode === 'test');
    renderCoach();
    renderScreen();
  }

  function offsetDate(value, days) {
    const d = new Date(dateOnly(value) + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0,10);
  }

  function addTime(value, time) {
    return dateOnly(value) + ' ' + time;
  }

  function fmtDateTime(value) {
    const s = String(value || '');
    const date = s.slice(0,10);
    const time = s.slice(11);
    return `${fmtDate(date)}${time ? ', ' + time : ''}`;
  }

  function openDecision(type) {
    state.decisionType = type;
    const isNot = type === 'not';
    $('decisionTitle').textContent = isNot ? 'Why is this Not Donations?' : 'Confirm Donations qualification';
    $('decisionIntro').textContent = isNot
      ? 'Choose the first rule that makes this case stop.'
      : 'Only submit Donations after every qualification has been confirmed.';
    const reasonOptions = $('reasonOptions');
    reasonOptions.style.display = isNot ? '' : 'none';
    reasonOptions.innerHTML = isNot ? Object.entries(REASONS).map(([key,label]) => `
      <label class="reason-option"><input type="radio" name="reason" value="${esc(key)}" /><span>${esc(label)}</span></label>`).join('') : '';
    $('decisionFeedback').className = 'feedback';
    $('decisionFeedback').textContent = '';
    $('submitDecisionBtn').disabled = false;
    decisionDialog.showModal();
  }

  function gradeDecision() {
    const sc = current();
    const selectedReason = decisionDialog.querySelector('input[name="reason"]:checked')?.value || '';
    const chosenDonation = state.decisionType === 'donation';
    let correct = false;
    let feedback = '';

    if (chosenDonation) {
      correct = sc.outcome === 'donation';
      feedback = correct
        ? 'Correct. All five qualifications are satisfied.'
        : `Not yet. This case should stop because: ${REASONS[sc.reason]}`;
    } else {
      if (!selectedReason) {
        const fb = $('decisionFeedback');
        fb.className = 'feedback error';
        fb.textContent = 'Choose the rule that makes you stop.';
        return;
      }
      correct = sc.outcome === 'not' && selectedReason === sc.reason;
      if (correct) feedback = 'Correct. You stopped at the first disqualifying condition.';
      else if (sc.outcome === 'donation') feedback = 'This case actually meets every qualification for Donations.';
      else feedback = `That is not the first failing rule in this case. The correct stop is: ${REASONS[sc.reason]}`;
    }

    if (!correct) {
      state.score = Math.max(0, state.score - 25);
      state.mistakes.push(feedback);
      const fb = $('decisionFeedback');
      fb.className = 'feedback error';
      fb.textContent = feedback + (state.mode === 'guided' ? ' Review the highlighted evidence and try again.' : ' You can review the case or submit another decision.');
      $('submitDecisionBtn').disabled = false;
      renderCoach();
      return;
    }

    $('decisionFeedback').className = 'feedback show';
    $('decisionFeedback').textContent = feedback;
    $('submitDecisionBtn').disabled = true;
    setTimeout(() => {
      decisionDialog.close();
      showResult();
    }, 650);
  }

  function showResult() {
    const sc = current();
    const stage = stageInfo(sc);
    $('resultTitle').textContent = sc.outcome === 'donation' ? 'Correct — qualifies for Donations' : 'Correct — stop this case';
    $('resultScore').textContent = state.score;
    $('resultSummary').textContent = sc.outcome === 'donation'
      ? 'You correctly followed the full qualification path.'
      : `You correctly stopped at: ${REASONS[sc.reason]}`;
    const qaDays = daysBetween(sc.qaApproved);
    const pbLine = !sc.packBuilder.exists
      ? 'No Pack Builder exists — allowed to continue.'
      : `Pack Builder status: ${sc.packBuilder.status}${sc.packBuilder.status==='Complete' ? '.' : ' — stop.'}`;
    const packLine = sc.packBuilder.exists && sc.packBuilder.status === 'Complete'
      ? `Pack first shipment age: ${daysBetween(sc.packBuilder.firstShipment)} days.`
      : 'Pack shipment check not required.';
    const bulkQty = sc.bulk.stockRows.reduce((n,r)=>n+Number(r.total||0),0);
    const pair = bulkFirstShipmentAfterNewInventory(sc);
    const bulkAge = pair.shipment ? `${daysBetween(pair.shipment.date)} days` : 'not verifiable';

    $('resultBreakdown').innerHTML = [
      ['QA Approved', `${qaDays} days ago`, qaDays >= 10],
      ['Pack Builder', pbLine, !sc.packBuilder.exists || sc.packBuilder.status === 'Complete'],
      ['Pack shipment', packLine, !sc.packBuilder.exists || (sc.packBuilder.status === 'Complete' && daysBetween(sc.packBuilder.firstShipment) >= 30)],
      ['Purple bulk inventory', `${bulkQty} total quantity`, bulkQty === 0],
      ['Bulk first shipment', bulkAge, !!pair.shipment && daysBetween(pair.shipment.date) >= 30],
    ].map(([label,value,ok]) => `<div class="result-line ${ok?'':'bad'}"><span>${esc(label)} · ${esc(value)}</span><strong>${ok?'✓':'STOP'}</strong></div>`).join('');

    $('nextCaseBtn').textContent = state.pointer + 1 >= state.order.length ? 'Start a new set' : 'Next practice case';
    resultDialog.showModal();
  }

  function resetCase() {
    state.screen = 'po';
    state.poTab = 'details';
    state.productTab = 'details';
    state.productKind = '';
    state.score = 100;
    state.mistakes = [];
    state.reviewed = new Set();
    state.decisionType = '';
    renderAll();
  }

  function nextCase() {
    resultDialog.close();
    state.pointer += 1;
    if (state.pointer >= state.order.length) {
      state.order = shuffle(scenarios.map((_,i)=>i));
      state.pointer = 0;
    }
    resetCase();
  }

  document.querySelectorAll('[data-mode]').forEach((btn) => btn.addEventListener('click', () => {
    state.mode = btn.dataset.mode;
    document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('active', b === btn));
    resetCase();
  }));

  $('notDonationBtn').addEventListener('click', () => openDecision('not'));
  $('donationBtn').addEventListener('click', () => openDecision('donation'));
  $('submitDecisionBtn').addEventListener('click', gradeDecision);
  $('restartCaseBtn').addEventListener('click', resetCase);
  $('reviewCaseBtn').addEventListener('click', () => resultDialog.close());
  $('nextCaseBtn').addEventListener('click', nextCase);

  renderAll();
})();