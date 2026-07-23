/* =========================================================================
   demo-mode.js — Isolated synthetic-data IT demo mode for Houston Control.

   Loads FIRST (before the pre-render auth script, auth-fetch, and all modules).
   Activates ONLY when explicitly requested (?demo=1 or a persisted flag), so
   production behavior is unchanged when HOUSTON_DEMO_MODE is not enabled.

   When active it:
     - sets window.HOUSTON_DEMO_MODE = true
     - seeds obviously-fictional data into browser storage before modules read it
     - signs in a synthetic Manager ("Alex Rivera") with no real login
     - blocks/stubs ALL /.netlify/functions/*, Netlify Identity, Google auth,
       email, and other backend calls (nothing leaves the browser)
     - shows a persistent DEMO banner and disables the destructive system reset
   No secrets, tokens, real names, real companies, or connection strings.
   ========================================================================= */
(function () {
  'use strict';

  // ── Activation gate ──────────────────────────────────────────────────────
  function requested() {
    try {
      var q = (location.search || '') + ' ' + (location.hash || '');
      // Explicit off-switch clears the persisted flag and stays in normal mode.
      if (/[?&#]demo=(0|off|false|no)\b/i.test(q)) { try { localStorage.removeItem('houston_demo_mode'); } catch (_) {} return false; }
      if (/[?&#]demo=(1|true|on|yes)\b/i.test(q)) return true;
      if (localStorage.getItem('houston_demo_mode') === '1') return true;
    } catch (_) {}
    return false;
  }
  if (!requested()) { window.HOUSTON_DEMO_MODE = false; return; }
  window.HOUSTON_DEMO_MODE = true;
  try { localStorage.setItem('houston_demo_mode', '1'); } catch (_) {}

  // ── Helpers ──────────────────────────────────────────────────────────────
  function setJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} }
  var TODAY = new Date();
  function iso(d) { return new Date(d).toISOString().slice(0, 10); }
  function addDays(n) { var d = new Date(TODAY); d.setDate(d.getDate() + n); return iso(d); }
  var id = 1000; function nextId() { return ++id; }

  // ── Fictional constants (obviously synthetic — no real people/clients) ────
  var COMPANIES = ['Northstar Labs', 'Atlas Health Group', 'Harbor Creative', 'Redwood Systems', 'Blue Peak Partners', 'Summit Works'];
  var ROSTER = [
    { name: 'Alex Rivera',  department: 'Assembly' },
    { name: 'Jordan Lee',   department: 'Receiving' },
    { name: 'Morgan Patel', department: 'Prepping' },
    { name: 'Taylor Brooks',department: 'Fulfillment' },
    { name: 'Casey Nguyen', department: 'Inventory' },
    { name: 'Jamie Carter', department: 'Assembly' },
    { name: 'Riley Morgan', department: 'Prepping' },
    { name: 'Sam Okafor',   department: 'Receiving' },
    { name: 'Devon Cruz',   department: 'Fulfillment' }
  ];

  // ── Synthetic Manager user (no real login / no token verification) ────────
  var DEMO_USER = {
    id: 'demo-alex-rivera', email: 'alex.rivera@demo.local', name: 'Alex Rivera',
    role: 'manager', overrides: {}, tempAdmin: false, tempAdminExpiry: null,
    suspended: false, token: 'demo-session-token'
  };
  setJSON('hcAuthUser', DEMO_USER);
  try { localStorage.setItem('qaWorkflowCurrentUserV2', 'Alex Rivera'); } catch (_) {}
  try { localStorage.setItem('ops_hub_active_page', 'homePage'); } catch (_) {}
  function currentUser() {
    return { id: DEMO_USER.id, email: DEMO_USER.email, name: DEMO_USER.name, role: 'manager',
             overrides: {}, tempAdmin: false, tempAdminExpiry: null, token: DEMO_USER.token };
  }
  window.hcCurrentUser = currentUser();
  // Called by auth.js (guarded by HOUSTON_DEMO_MODE) instead of network login.
  window.__houstonDemoApplyUser = function () {
    window.hcCurrentUser = currentUser();
    var ov = document.getElementById('hcLoginOverlay');
    if (ov) { ov.hidden = true; ov.style.display = 'none'; }
    if (document.body) document.body.style.overflow = '';
    var ud = document.getElementById('hcUserDisplay');
    if (ud) { ud.textContent = 'Alex Rivera · Manager'; ud.hidden = false; }
    try { if (window.hcAccess && window.hcAccess.applyGuards) window.hcAccess.applyGuards(); } catch (_) {}
  };

  // ── Seed synthetic operational data (before modules initialize) ──────────
  // Employees across the five departments. Define EMP_SEED first, THEN save it
  // (the previous order saved it before assignment, storing "undefined").
  var EMP_SEED = ROSTER.map(function (r) {
    return { name: r.name, adpName: '', department: r.department, birthday: '', size: '', active: true };
  });
  setJSON('ops_hub_employees_v1', EMP_SEED);

  // Attendance — today, a reasonable mix (no severe discipline).
  var MARKS = { present: 'Present', late: 'Late', excused: 'Excused', callout: 'Call Out' };
  var attendance = [
    { employeeName: 'Alex Rivera',  department: 'Assembly',    mark: MARKS.present },
    { employeeName: 'Jamie Carter', department: 'Assembly',    mark: MARKS.present },
    { employeeName: 'Jordan Lee',   department: 'Receiving',   mark: MARKS.late },
    { employeeName: 'Sam Okafor',   department: 'Receiving',   mark: MARKS.present },
    { employeeName: 'Morgan Patel', department: 'Prepping',    mark: MARKS.present },
    { employeeName: 'Riley Morgan', department: 'Prepping',    mark: MARKS.excused },
    { employeeName: 'Casey Nguyen', department: 'Inventory',   mark: MARKS.present },
    { employeeName: 'Taylor Brooks',department: 'Fulfillment', mark: MARKS.present },
    { employeeName: 'Devon Cruz',   department: 'Fulfillment', mark: MARKS.callout }
  ].map(function (a) {
    var dem = a.mark === 'Late' ? 1 : (a.mark === 'Call Out' ? 2 : 0);
    return { id: nextId(), employeeName: a.employeeName, department: a.department, date: iso(TODAY), mark: a.mark, demerits: dem };
  });
  var ATT_SEED = attendance;
  setJSON('ops_hub_attendance_records_v2', ATT_SEED);
  setJSON('ops_hub_attendance_moves_v1', []);

  // Warehouse errors — 2-3 fictional records.
  setJSON('ops_hub_errors_records_v2', [
    { id: nextId(), date: addDays(-1), department: 'Receiving',   associate: 'Jordan Lee',   proofed: 'Yes', poNumber: 'DEMO-PO-3101', linkedId: '', category: 'Apparel', palletLocation: 'R-12', expectedQty: 500, receivedQty: 480, errorType: 'Short Quantity', notes: 'Short 20 units vs packing list' },
    { id: nextId(), date: addDays(-2), department: 'Prepping',    associate: 'Morgan Patel', proofed: 'Yes', poNumber: 'DEMO-PO-3102', linkedId: '', category: 'Drinkware', palletLocation: 'P-04', expectedQty: 300, receivedQty: 300, errorType: 'Mislabel', notes: 'Wrong SKU label applied on one carton' },
    { id: nextId(), date: addDays(-3), department: 'Fulfillment', associate: 'Taylor Brooks',proofed: 'No',  poNumber: 'DEMO-PO-3103', linkedId: '', category: 'Bags', palletLocation: 'F-09', expectedQty: 240, receivedQty: 236, errorType: 'Damaged Carton', notes: '4 units damaged in transit' }
  ]);

  // Calendar / Mission Control events.
  setJSON('ops_hub_calendar_events_v1', [
    { id: 'demo-cal-1', date: iso(TODAY),   time: '08:30', title: 'Morning Huddle',        type: 'meeting', note: 'Daily standup', createdAt: Date.now() },
    { id: 'demo-cal-2', date: iso(TODAY),   time: '14:00', title: 'Carrier Pickup Window', type: 'shipping',note: 'Outbound trailers', createdAt: Date.now() },
    { id: 'demo-cal-3', date: addDays(1),   time: '10:00', title: 'Inventory Cycle Count',  type: 'inventory', note: 'Packaging aisle', createdAt: Date.now() },
    { id: 'demo-cal-4', date: addDays(2),   time: '16:00', title: 'Assembly Deadline',      type: 'deadline', note: 'Northstar Labs order', createdAt: Date.now() }
  ]);

  // ── Assembly board (6-8 orders across stages) ────────────────────────────
  // stages: aa(Available) print(Printed) picked(Picked) line(In Line) dpmo(DPMO) done(Done)
  function pb(n) { return 'DEMO-PB-' + n; }
  function so(n) { return 'DEMO-SO-' + n; }
  function boardRow(o) {
    var qty = o.qty, products = o.products;
    return {
      id: nextId(), date: iso(TODAY), pb: pb(o.pb), so: so(o.so), account: o.account,
      qty: qty, products: products, units: qty * products,
      status: o.status || 'On Track', ihd: o.ihd, subtotal: o.subtotal, revenue: o.subtotal,
      stage: o.stage, rescheduleNote: o.note || '', pbId: '', pdfUrl: '', externalLink: '',
      workType: 'pack_builder', isPartial: !!o.partial, fullQty: o.fullQty || qty,
      accountOwner: 'Demo Team', priority: !!o.priority, sourceQueue: 'ready', sourceStatus: o.status || ''
    };
  }
  setJSON('ops_hub_assembly_board_v2', [
    boardRow({ pb: 1001, so: 2401, account: 'Northstar Labs',     qty: 120, products: 4, ihd: addDays(2),  subtotal: 8450.00,  stage: 'aa',     priority: true,  status: 'Priority' }),
    boardRow({ pb: 1002, so: 2402, account: 'Atlas Health Group', qty: 80,  products: 3, ihd: addDays(-1), subtotal: 5210.50,  stage: 'print',  status: 'At Risk' }),
    boardRow({ pb: 1003, so: 2403, account: 'Harbor Creative',    qty: 200, products: 6, ihd: addDays(4),  subtotal: 12980.00, stage: 'picked', status: 'On Track' }),
    boardRow({ pb: 1004, so: 2404, account: 'Redwood Systems',    qty: 60,  products: 2, ihd: addDays(3),  subtotal: 3120.00,  stage: 'line',   status: 'On Track', partial: true, fullQty: 150 }),
    boardRow({ pb: 1005, so: 2405, account: 'Blue Peak Partners', qty: 45,  products: 5, ihd: addDays(1),  subtotal: 2760.75,  stage: 'dpmo',   status: 'QA Check' }),
    boardRow({ pb: 1006, so: 2406, account: 'Summit Works',       qty: 150, products: 4, ihd: addDays(-2), subtotal: 9600.00,  stage: 'done',   status: 'Completed' }),
    boardRow({ pb: 1007, so: 2407, account: 'Northstar Labs',     qty: 90,  products: 3, ihd: addDays(5),  subtotal: 4380.00,  stage: 'aa',     status: 'On Track' })
  ]);

  // ── Queues ───────────────────────────────────────────────────────────────
  function qRow(o) {
    return { id: nextId(), priority: !!o.priority, pb: pb(o.pb), pbId: '', so: so(o.so), account: o.account,
      qty: o.qty, products: o.products, units: o.qty * o.products, ihd: o.ihd, accountOwner: 'Demo Team',
      pdfUrl: '', status: o.status || 'Ready', subtotal: o.subtotal, revenue: o.subtotal };
  }
  setJSON('ops_hub_available_queue_v1', [
    qRow({ pb: 1101, so: 2501, account: 'Harbor Creative',    qty: 110, products: 3, ihd: addDays(3), subtotal: 6100.00, status: 'Ready', priority: true }),
    qRow({ pb: 1102, so: 2502, account: 'Redwood Systems',    qty: 75,  products: 2, ihd: addDays(4), subtotal: 3550.00, status: 'Ready' }),
    qRow({ pb: 1103, so: 2503, account: 'Blue Peak Partners', qty: 130, products: 5, ihd: addDays(6), subtotal: 7420.00, status: 'Ready' })
  ]);
  setJSON('ops_hub_scheduled_queue_v1', [
    (function () { var r = qRow({ pb: 1104, so: 2504, account: 'Atlas Health Group', qty: 95, products: 4, ihd: addDays(2), subtotal: 5240.00, status: 'Scheduled' });
      r.scheduledFor = addDays(1); r.scheduledAt = '09:00'; r.scheduleNote = 'AM line'; r.sourceQueue = 'ready'; r.sourceStatus = 'Ready'; return r; })()
  ]);
  setJSON('ops_hub_incomplete_queue_v1', [
    qRow({ pb: 1105, so: 2505, account: 'Summit Works', qty: 50, products: 2, ihd: addDays(1), subtotal: 2100.00, status: 'Held — Missing Items' })
  ]);
  setJSON('ops_hub_revenue_reference_v1', [
    { id: nextId(), salesOrder: so(2401), originalSubtotal: 8450.00,  ihd: addDays(2), account: 'Northstar Labs' },
    { id: nextId(), salesOrder: so(2403), originalSubtotal: 12980.00, ihd: addDays(4), account: 'Harbor Creative' },
    { id: nextId(), salesOrder: so(2406), originalSubtotal: 9600.00,  ihd: addDays(-2), account: 'Summit Works' }
  ]);

  // ── Synthetic inventory (served via network intercept; no local fallback) ─
  function invItem(o) {
    return { id: nextId(), itemName: o.name, category: o.category || 'Packaging', department: o.dept || 'Inventory',
      location: o.loc || 'Aisle 3', spot: o.spot || '', quantity: o.qty, unitType: o.unit || 'each',
      minStock: o.min, vendor: 'Demo Supply Co', sku: o.sku, orderLink: '', notes: '', productKey: '',
      needsReview: false, archived: false, status: o.qty <= 0 ? 'Out of Stock' : (o.qty <= o.min ? 'Low Stock' : 'In Stock'),
      lastCounted: iso(TODAY), lastUpdatedBy: 'Alex Rivera', createdBy: 'Demo', createdAt: iso(TODAY), updatedAt: iso(TODAY) };
  }
  var INVENTORY = [
    invItem({ name: '12 × 10 × 6 Shipping Boxes', qty: 640, min: 200, sku: 'DEMO-BOX-12106', unit: 'each' }),
    invItem({ name: 'Poly Mailers (10 × 13)',      qty: 150, min: 200, sku: 'DEMO-POLY-1013', unit: 'each' }),
    invItem({ name: 'Packing Tape (2" clear)',     qty: 0,   min: 24,  sku: 'DEMO-TAPE-2CL',  unit: 'roll' }),
    invItem({ name: 'Zebra Labels (4 × 6)',        qty: 3200,min: 1000,sku: 'DEMO-LBL-46',    unit: 'label' }),
    invItem({ name: 'Nitrile Gloves (M)',          qty: 45,  min: 60,  sku: 'DEMO-GLV-M',     unit: 'box' }),
    invItem({ name: 'Cleaning Wipes',              qty: 210, min: 40,  sku: 'DEMO-WIPE',      unit: 'canister' })
  ];
  var INV_SUMMARY = {
    total: INVENTORY.length,
    inStock: INVENTORY.filter(function (i) { return i.status === 'In Stock'; }).length,
    low: INVENTORY.filter(function (i) { return i.status === 'Low Stock'; }).length,
    out: INVENTORY.filter(function (i) { return i.status === 'Out of Stock'; }).length,
    review: 0, openRequests: 0
  };

  // ── Network kill-switch ──────────────────────────────────────────────────
  // Intercept anything that would reach a backend, auth provider, email, or LLM.
  var BLOCK = /(\/\.netlify\/(functions|identity))|identity\.netlify\.com|googleapis\.com|accounts\.google|gstatic\.com\/.*identity|api\.resend\.com|generativelanguage/i;
  function resp(obj, status) {
    try { return new Response(JSON.stringify(obj), { status: status || 200, headers: { 'Content-Type': 'application/json' } }); }
    catch (_) { return { ok: (status || 200) < 400, status: status || 200, json: function () { return Promise.resolve(obj); }, text: function () { return Promise.resolve(JSON.stringify(obj)); } }; }
  }
  function routeFor(url, init) {
    var method = ((init && init.method) || 'GET').toUpperCase();
    var u = String(url).toLowerCase();
    if (u.indexOf('/.netlify/identity/user') > -1) return resp({ id: 'demo-alex-rivera', email: 'alex.rivera@demo.local', user_metadata: { full_name: 'Alex Rivera' }, app_metadata: { role: 'manager' } }, 200);
    if (u.indexOf('/.netlify/identity') > -1) return resp({}, 200); // authorize/logout/token
    if (u.indexOf('/functions/inventory') > -1) return resp({ items: INVENTORY, summary: INV_SUMMARY, role: 'manager', ok: true }, 200);
    // Employees & attendance are served as synthetic SUCCESS so the app's
    // loaders populate their in-memory state directly (robust against any
    // init-time reset of the seeded localStorage copy).
    if (u.indexOf('/functions/employees') > -1) return resp({ employees: EMP_SEED, updated_at: null, ok: true }, 200);
    if (u.indexOf('/functions/attendance') > -1) return resp({ records: ATT_SEED, moves: [], updated_at: null, ok: true }, 200);
    if (u.indexOf('/functions/chat') > -1) return resp({ users: [], messages: [], unread: {}, maxId: 0 }, 200);
    if (u.indexOf('/functions/notifications') > -1) return resp({ notifications: [], ok: true }, 200);
    if (u.indexOf('/functions/flight-tracker-comments') > -1) return resp({ count: 0, comments: [] }, 200);
    if (u.indexOf('/functions/flight-tracker-photos') > -1) return resp({ photos: [], counts: {} }, 200);
    if (u.indexOf('/functions/users') > -1) return resp({ role: 'manager', name: 'Alex Rivera', overrides: {}, tempAdmin: false, suspended: false, users: [{ id: 'demo-alex-rivera', email: 'alex.rivera@demo.local', name: 'Alex Rivera', role: 'manager', suspended: false }], entries: [] }, 200);
    if (u.indexOf('/functions/') > -1) {
      // Sync GETs fail cleanly so each module falls back to seeded local data;
      // writes are accepted as harmless no-ops (nothing leaves the browser).
      if (method === 'GET') return resp({ error: 'demo-offline', __demo: true }, 503);
      return resp({ ok: true, __demo: true }, 200);
    }
    return resp({ ok: true, __demo: true }, 200); // google/resend/gemini → benign
  }
  if (typeof window.fetch === 'function') {
    var _fetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      var url = '';
      try { url = (typeof input === 'string') ? input : (input && input.url) ? input.url : (input && input.href) ? input.href : String(input); } catch (_) {}
      try { if (url && BLOCK.test(url)) return Promise.resolve(routeFor(url, init)); } catch (_) {}
      return _fetch(input, init);
    };
  }
  if (navigator && typeof navigator.sendBeacon === 'function') {
    var _beacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function (u, d) { try { if (BLOCK.test(String(u))) return true; } catch (_) {} return _beacon(u, d); };
  }
  if (window.XMLHttpRequest) {
    var _open = XMLHttpRequest.prototype.open, _send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (m, u) { try { this.__demoBlocked = (typeof u === 'string' && BLOCK.test(u)); } catch (_) {} return _open.apply(this, arguments); };
    XMLHttpRequest.prototype.send = function () {
      if (this.__demoBlocked) {
        var self = this;
        setTimeout(function () {
          try { Object.defineProperty(self, 'readyState', { value: 4, configurable: true }); } catch (_) {}
          try { Object.defineProperty(self, 'status', { value: 503, configurable: true }); } catch (_) {}
          try { Object.defineProperty(self, 'responseText', { value: '{"error":"demo-offline"}', configurable: true }); } catch (_) {}
          if (typeof self.onreadystatechange === 'function') { try { self.onreadystatechange(); } catch (_) {} }
          if (typeof self.onload === 'function') { try { self.onload(); } catch (_) {} }
        }, 0);
        return;
      }
      return _send.apply(this, arguments);
    };
  }

  // ── Banner + destructive-control disable (on DOM ready) ──────────────────
  var IS_TOP = (function () { try { return window.top === window.self; } catch (_) { return true; } })();
  function onReady(fn) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn); else fn(); }
  onReady(function () {
    // Banner + reset-disable only in the top-level window (not inside iframes,
    // which load this file solely for the network kill-switch).
    if (!IS_TOP) { try { window.__houstonDemoApplyUser(); } catch (_) {} return; }
    if (!document.getElementById('houstonDemoBanner')) {
      var bar = document.createElement('div');
      bar.id = 'houstonDemoBanner';
      bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#b91c1c;color:#fff;' +
        'padding:6px 14px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.35);' +
        'font:600 13px/1.25 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;pointer-events:none;';
      var line1 = document.createElement('div');
      line1.textContent = 'DEMO MODE — SYNTHETIC DATA — NOT CONNECTED TO LIVE SYSTEMS';
      var line2 = document.createElement('div');
      line2.textContent = 'Changes you make during this demo stay only in this browser session / local demo storage.';
      line2.style.cssText = 'font-weight:400;font-size:11px;opacity:.92;margin-top:1px;';
      bar.appendChild(line1); bar.appendChild(line2);
      document.body.appendChild(bar);
      var h = bar.offsetHeight || 36;
      try { document.body.style.paddingTop = h + 'px'; } catch (_) {}
    }
    // Re-assert the synthetic user (belt-and-suspenders with auth.js short-circuit).
    try { window.__houstonDemoApplyUser(); } catch (_) {}
    // Never offer a backend-connected destructive reset in demo mode.
    window.hcReset = {
      openModal: function () { try { alert('System reset is disabled in demo mode.'); } catch (_) {} },
      closeModal: function () {}, confirmStep: function () {}
    };
  });

  try { console.info('[Houston] DEMO MODE active — synthetic data, no live backend.'); } catch (_) {}
})();
