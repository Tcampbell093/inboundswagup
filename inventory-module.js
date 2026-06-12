/* =========================================================
   inventory-module.js — Warehouse Supply Inventory (Command Tool)
   ---------------------------------------------------------
   Renders into #inventoryRoot (#inventoryPage). Talks only to
   /.netlify/functions/inventory. Built modular for later: barcode scan,
   reorder approvals, count history, photos, low-stock alerts.
   ========================================================= */
(function () {
  'use strict';

  var API = '/.netlify/functions/inventory';
  var PAGE_ID = 'inventoryPage';

  var DEPARTMENTS = ['Assembly', 'Fulfillment', 'Inventory', 'Receiving', 'QA', 'General Warehouse', 'Cleaning Supplies', 'Office/Admin'];
  var CATEGORIES = ['Boxes', 'Gift Boxes', 'Poly Mailers', 'Bubble Mailers', 'Bags', 'Tape', 'Labels', 'Stickers', 'Gloves',
    'Cleaning Supplies', 'Packing Materials', 'Crinkle Paper', 'Rubber Bands', 'Markers/Pens', 'Printer Supplies', 'General Supplies', 'Other'];
  var UNITS = ['each', 'box', 'case', 'carton', 'roll', 'pack', 'bag', 'sleeve', 'sheet', 'pair', 'bundle'];
  var LOCATIONS = ['Supply Rack', 'Assembly Supplies', 'Fulfillment Supplies', 'Uline Box Area', 'Cleaning Supply Area', 'Mailer Section', 'Top Rack', 'Bottom Shelf', 'Unknown'];

  var state = { items: [], summary: {}, role: '', loaded: false, loading: false, includeArchived: false, activeId: null, view: 'items', requests: [], reqLoading: false };
  var els = {};

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]; }); }
  function fmtDate(v) { if (!v) return '—'; var d = new Date(v); return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  function fmtDateTime(v) { if (!v) return '—'; var d = new Date(v); return isNaN(d.getTime()) ? '—' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  function canManage() { return state.role === 'admin' || state.role === 'manager'; }
  function canCount() { return canManage() || state.role === 'l1' || state.role === 'l2'; }
  function statusClass(s) { return s === 'In Stock' ? 'iv-in' : s === 'Low Stock' ? 'iv-low' : s === 'Out of Stock' ? 'iv-out' : 'iv-rev'; }
  function qtyText(it) { return it.quantity == null ? '—' : (Number(it.quantity) + (it.unitType ? ' ' + it.unitType : '')); }

  // Locations are stored as a comma-separated string in `location`. Any legacy
  // `spot` value is folded in so nothing is lost.
  function itemLocations(it) {
    var arr = String(it.location || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    if (it.spot && arr.map(function (x) { return x.toLowerCase(); }).indexOf(String(it.spot).toLowerCase()) === -1) arr.push(it.spot);
    return arr;
  }
  function locDisplay(arr) {
    if (!arr.length) return '<span style="color:#c0ccda;">—</span>';
    if (arr.length === 1) return esc(arr[0]);
    return esc(arr[0]) + ', ' + esc(arr[1]) + (arr.length > 2 ? ' <span style="color:#1d6fb8;font-weight:700;">+' + (arr.length - 2) + '</span>' : '');
  }

  function injectStyles() {
    if (document.getElementById('ivStyles')) return;
    var c = ''
      + '#inventoryPage .iv-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:0 0 16px;}'
      + '#inventoryPage .iv-card{background:#fff;border:1px solid #e6ecf3;border-radius:14px;padding:14px 16px;}'
      + '#inventoryPage .iv-card-lbl{font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#6b7e94;}'
      + '#inventoryPage .iv-card-val{font-size:26px;font-weight:800;color:#16263a;margin-top:4px;}'
      + '#inventoryPage .iv-card.low .iv-card-val{color:#9a5b00;} #inventoryPage .iv-card.out .iv-card-val{color:#b3261e;} #inventoryPage .iv-card.rev .iv-card-val{color:#5a7088;}'
      + '#inventoryPage .iv-card-sub{font-size:11.5px;color:#8aa0bb;margin-top:2px;}'
      + '#inventoryPage .iv-tools{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:0 0 12px;}'
      + '.iv-input,.iv-select{padding:9px 12px;border:1px solid #d6deea;border-radius:10px;font:inherit;background:#fff;color:#16263a !important;-webkit-text-fill-color:#16263a;}'
      + '.iv-input::placeholder{color:#9aa7b6;-webkit-text-fill-color:#9aa7b6;}'
      + '.iv-input:focus,.iv-select:focus{outline:none;border-color:#5b8fc7;box-shadow:0 0 0 3px rgba(91,143,199,.18);}'
      + '#inventoryPage .iv-search{flex:1;min-width:200px;}'
      + '#inventoryPage .iv-btn{border:1px solid #cdd9e6;background:#f4f8fc;color:#2f4d6b;font-weight:700;font-size:13px;border-radius:10px;padding:9px 14px;cursor:pointer;font-family:inherit;}'
      + '#inventoryPage .iv-btn:hover{background:#e8f1fb;border-color:#b6cde4;}'
      + '#inventoryPage .iv-btn-primary{background:#1d6fb8;border-color:#1d6fb8;color:#fff;}#inventoryPage .iv-btn-primary:hover{background:#195f9e;}'
      + '#inventoryPage .iv-spacer{margin-left:auto;}'
      + '#inventoryPage .iv-count{font-size:13px;color:#5a7088;font-weight:600;}'
      + '#inventoryPage .iv-tablewrap{overflow-x:auto;border:1px solid #e6ecf3;border-radius:14px;background:#fff;}'
      + '#inventoryPage table.iv-table{width:100%;border-collapse:collapse;font-size:13.5px;}'
      + '#inventoryPage .iv-table th{text-align:left;font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:#6b7e94;padding:11px 12px;border-bottom:1px solid #eef2f7;background:#f8fafc;white-space:nowrap;}'
      + '#inventoryPage .iv-table td{padding:10px 12px;border-bottom:1px solid #f2f5f9;color:#243b55;vertical-align:middle;}'
      + '#inventoryPage .iv-table tbody tr{cursor:pointer;}'
      + '#inventoryPage .iv-table tr:hover td{background:#f9fbfe;cursor:pointer;}'
      + '#inventoryPage .iv-name{font-weight:700;color:#16263a;}'
      + '#inventoryPage .iv-chip{display:inline-block;padding:3px 9px;border-radius:999px;font-size:11.5px;font-weight:700;white-space:nowrap;}'
      + '#inventoryPage .iv-in{background:#e7f7ef;color:#0a7c4e;} #inventoryPage .iv-low{background:#fff3d6;color:#9a5b00;} #inventoryPage .iv-out{background:#fdecec;color:#b3261e;} #inventoryPage .iv-rev{background:#eceff3;color:#5a7088;}'
      + '#inventoryPage .iv-archived td{opacity:.55;}'
      + '#inventoryPage .iv-empty{padding:30px;text-align:center;color:#8aa0bb;}'
      // modal
      + '.iv-modal-bd{position:fixed;inset:0;background:rgba(12,22,38,.55);display:none;align-items:flex-start;justify-content:center;z-index:9000;padding:28px 16px;overflow-y:auto;}'
      + '.iv-modal-bd.open{display:flex;}'
      + '.iv-modal{background:#fff;border-radius:16px;max-width:580px;width:100%;box-shadow:0 24px 60px rgba(10,20,35,.28);overflow:hidden;}'
      + '.iv-mhead{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:16px 18px;border-bottom:1px solid #eef2f7;}'
      + '.iv-mtitle{font-size:17px;font-weight:800;color:#16263a;}.iv-msub{font-size:12.5px;color:#6b7e94;margin-top:2px;}'
      + '.iv-x{border:none;background:#f1f4f8;border-radius:8px;width:30px;height:30px;cursor:pointer;font-size:16px;color:#5a7088;flex-shrink:0;}'
      + '.iv-mbody{padding:16px 18px;max-height:72vh;overflow-y:auto;}'
      + '.iv-field{margin-bottom:11px;} .iv-field label{display:block;font-size:11.5px;font-weight:700;color:#5a7088;margin-bottom:4px;}'
      + '.iv-field input,.iv-field select,.iv-field textarea{width:100%;box-sizing:border-box;padding:9px 11px;border:1px solid #d6deea;border-radius:10px;font:inherit;color:#16263a;background:#fff;}'
      + '.iv-grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px;}'
      + '.iv-kv{display:flex;justify-content:space-between;gap:10px;font-size:13px;padding:5px 0;border-bottom:1px solid #f4f6f9;}'
      + '.iv-kv span:first-child{color:#6b7e94;}.iv-kv span:last-child{font-weight:600;color:#16263a;text-align:right;}'
      + '.iv-sec{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:#6b7e94;margin:16px 0 8px;}'
      + '.iv-seg{display:inline-flex;border:1px solid #d6deea;border-radius:10px;overflow:hidden;}'
      + '.iv-seg button{border:none;background:#fff;color:#5a7088;font-weight:700;font-size:13px;padding:9px 14px;cursor:pointer;}'
      + '.iv-seg button.on{background:#1d6fb8;color:#fff;}'
      + '.iv-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;}'
      + '.iv-go{border:1px solid #1f9d57;background:#22a85f;color:#fff;font-weight:800;border-radius:10px;padding:10px 16px;cursor:pointer;font-size:14px;}'
      + '.iv-go:hover{background:#1f9d57;}'
      + '.iv-danger{border:1px solid #f0c9c9;background:#fff;color:#c0392b;font-weight:700;border-radius:10px;padding:9px 14px;cursor:pointer;}'
      + '.iv-prev{max-height:240px;overflow:auto;border:1px solid #eef2f7;border-radius:10px;margin-top:8px;}'
      + '.iv-prev table{width:100%;border-collapse:collapse;font-size:12px;}'
      + '.iv-prev th,.iv-prev td{padding:6px 8px;border-bottom:1px solid #f2f5f9;text-align:left;white-space:nowrap;}'
      + '#inventoryPage .iv-tabs{display:flex;gap:8px;margin:0 0 14px;flex-wrap:wrap;}'
      + '#inventoryPage .iv-tab{border:1px solid #d6deea;background:#fff;color:#5a7088;font-weight:700;font-size:14px;border-radius:10px;padding:9px 16px;cursor:pointer;}'
      + '#inventoryPage .iv-tab.on{background:#1d6fb8;border-color:#1d6fb8;color:#fff;}'
      + '#inventoryPage .iv-link{color:#1d6fb8;font-weight:700;text-decoration:none;}#inventoryPage .iv-link:hover{text-decoration:underline;}'
      + '#inventoryPage .iv-urg-Urgent,.iv-urg-Urgent{color:#b3261e;font-weight:800;}#inventoryPage .iv-urg-High,.iv-urg-High{color:#cf6b00;font-weight:800;}#inventoryPage .iv-urg-Normal,.iv-urg-Normal{color:#5a7088;}#inventoryPage .iv-urg-Low,.iv-urg-Low{color:#8aa0bb;}'
      + '.iv-olink{display:inline-block;border:1px solid #b6cde4;background:#f4f8fc;color:#1d6fb8;font-weight:700;font-size:12.5px;border-radius:9px;padding:8px 14px;text-decoration:none;}.iv-olink:hover{background:#e8f1fb;}'
      + '.iv-reqbtn{border:1px solid #e0a800;background:#fff7e0;color:#8a5a00;font-weight:800;border-radius:10px;padding:9px 14px;cursor:pointer;font-size:13px;}.iv-reqbtn:hover{background:#ffefc2;}'
      + '.iv-tags{display:flex;flex-wrap:wrap;gap:6px;}'
      + '.iv-tag{display:inline-flex;align-items:center;gap:6px;background:#eef5ff;border:1px solid #d4e4fb;color:#1d4e7a;border-radius:999px;padding:4px 10px;font-size:12.5px;font-weight:700;}'
      + '.iv-tag button{border:none;background:transparent;color:#5a7aa6;font-size:15px;line-height:1;cursor:pointer;padding:0;}'
      + '.iv-tag-ro{margin:0 0 2px 0;}'
      + '#inventoryPage .iv-namecell{display:flex;align-items:center;gap:9px;}'
      + '#inventoryPage .iv-thumb{width:36px;height:36px;border-radius:8px;object-fit:cover;border:1px solid #e6ecf3;background:#f4f8fc;flex-shrink:0;}'
      + '.iv-photo{max-width:100%;max-height:240px;border-radius:10px;border:1px solid #e6ecf3;display:block;}';
    var s = document.createElement('style'); s.id = 'ivStyles'; s.textContent = c; document.head.appendChild(s);
  }

  function dl(id, values) { return '<datalist id="' + id + '">' + values.map(function (v) { return '<option value="' + esc(v) + '"></option>'; }).join('') + '</datalist>'; }

  function buildShell() {
    var root = document.getElementById('inventoryRoot');
    if (!root || root.dataset.built) return;
    root.dataset.built = '1';
    root.innerHTML =
      '<div class="iv-cards" id="ivCards"></div>'
      + '<div class="iv-tabs"><button id="ivTabItems" class="iv-tab on" type="button">📦 Inventory</button><button id="ivTabReq" class="iv-tab" type="button">📋 Requests <span id="ivTabReqN"></span></button></div>'
      + '<div id="ivItemsView">'
      + '<div class="iv-tools">'
      + '<input id="ivSearch" class="iv-input iv-search" type="text" placeholder="Search item, SKU, e.g. tape, bubble, 4x4x4, gloves…" autocomplete="off"/>'
      + '<select id="ivDept" class="iv-select"></select>'
      + '<select id="ivCat" class="iv-select"></select>'
      + '<select id="ivStatus" class="iv-select"><option value="">Any status</option><option>In Stock</option><option>Low Stock</option><option>Out of Stock</option><option>Needs Review</option></select>'
      + '<select id="ivLoc" class="iv-select"></select>'
      + '<select id="ivVendor" class="iv-select"></select>'
      + '<label class="iv-count" style="display:flex;align-items:center;gap:5px;cursor:pointer;"><input type="checkbox" id="ivArch"/> Show archived</label>'
      + '<div class="iv-spacer"></div>'
      + '<button id="ivAdd" class="iv-btn iv-btn-primary" type="button" hidden>+ Add item</button>'
      + '<button id="ivImport" class="iv-btn" type="button" hidden>⬆ Import</button>'
      + '<input id="ivImportFile" type="file" accept=".xlsx,.xls,.csv" hidden/>'
      + '<button id="ivExport" class="iv-btn" type="button">⬇ Export</button>'
      + '<button id="ivRefresh" class="iv-btn" type="button">↻</button>'
      + '<span id="ivCount" class="iv-count"></span>'
      + '</div>'
      + '<div class="iv-tablewrap"><table class="iv-table"><thead><tr>'
      + '<th>Item</th><th>Category</th><th>Department</th><th>Location</th><th>Qty</th><th>Min</th><th>Status</th><th>Order</th><th>Last Counted</th>'
      + '</tr></thead><tbody id="ivBody"></tbody></table></div>'
      + '</div>' // end items view
      + '<div id="ivRequestsView" hidden>'
      + '<div class="iv-tools">'
      + '<input id="ivRSearch" class="iv-input iv-search" type="text" placeholder="Search requests — item, department, requester…" autocomplete="off"/>'
      + '<select id="ivRStatus" class="iv-select"><option value="open">Open requests</option><option value="">All statuses</option><option>Requested</option><option>Reviewing</option><option>Approved</option><option>Ordered</option><option>Shipped</option><option>Delivered</option><option>Denied</option><option>Canceled</option></select>'
      + '<select id="ivRUrg" class="iv-select"><option value="">Any urgency</option><option>Urgent</option><option>High</option><option>Normal</option><option>Low</option></select>'
      + '<div class="iv-spacer"></div><span id="ivRCount" class="iv-count"></span>'
      + '</div>'
      + '<div class="iv-tablewrap"><table class="iv-table"><thead><tr>'
      + '<th>Urg</th><th>Item</th><th>Department</th><th>Qty</th><th>Requested by</th><th>Date</th><th>Status</th><th>Expected</th><th>Tracking</th>'
      + '</tr></thead><tbody id="ivRBody"></tbody></table></div>'
      + '</div>' // end requests view
      + dl('ivDeptList', DEPARTMENTS) + dl('ivCatList', CATEGORIES) + dl('ivUnitList', UNITS) + dl('ivLocList', LOCATIONS);

    els.search = document.getElementById('ivSearch');
    els.dept = document.getElementById('ivDept'); els.cat = document.getElementById('ivCat');
    els.status = document.getElementById('ivStatus'); els.loc = document.getElementById('ivLoc'); els.vendor = document.getElementById('ivVendor');
    els.arch = document.getElementById('ivArch'); els.body = document.getElementById('ivBody');
    els.count = document.getElementById('ivCount'); els.cards = document.getElementById('ivCards');

    els.search.addEventListener('input', renderTable);
    [els.dept, els.cat, els.status, els.loc, els.vendor].forEach(function (s) { s.addEventListener('change', renderTable); });
    els.arch.addEventListener('change', function () { state.includeArchived = els.arch.checked; loadData(); });
    document.getElementById('ivRefresh').addEventListener('click', loadData);
    document.getElementById('ivExport').addEventListener('click', exportCsv);
    document.getElementById('ivAdd').addEventListener('click', openAddModal);

    var imp = document.getElementById('ivImport'), impFile = document.getElementById('ivImportFile');
    imp.addEventListener('click', function () { impFile.click(); });
    impFile.addEventListener('change', function () { if (impFile.files && impFile.files[0]) handleImportFile(impFile.files[0]); impFile.value = ''; });

    // Requests view refs + listeners
    els.rbody = document.getElementById('ivRBody'); els.rcount = document.getElementById('ivRCount');
    els.rsearch = document.getElementById('ivRSearch'); els.rstatus = document.getElementById('ivRStatus'); els.rurg = document.getElementById('ivRUrg');
    els.rsearch.addEventListener('input', renderRequests);
    [els.rstatus, els.rurg].forEach(function (s) { s.addEventListener('change', renderRequests); });
    document.getElementById('ivTabItems').addEventListener('click', function () { switchView('items'); });
    document.getElementById('ivTabReq').addEventListener('click', function () { switchView('requests'); });

    buildModal();
    updateRoleUI();
  }

  function switchView(v) {
    state.view = v;
    document.getElementById('ivTabItems').classList.toggle('on', v === 'items');
    document.getElementById('ivTabReq').classList.toggle('on', v === 'requests');
    document.getElementById('ivItemsView').hidden = v !== 'items';
    document.getElementById('ivRequestsView').hidden = v !== 'requests';
    if (v === 'requests') loadRequests();
  }

  function updateRoleUI() {
    var add = document.getElementById('ivAdd'), imp = document.getElementById('ivImport');
    if (add) add.hidden = !canManage();
    if (imp) imp.hidden = !canManage();
  }

  function fillSelect(sel, values, anyLabel) {
    if (!sel) return;
    var cur = sel.value;
    sel.innerHTML = '<option value="">' + anyLabel + '</option>' + values.map(function (v) { return '<option value="' + esc(v) + '">' + esc(v) + '</option>'; }).join('');
    if (values.indexOf(cur) !== -1) sel.value = cur;
  }

  function refreshFilters() {
    var depts = {}, cats = {}, locs = {}, vends = {};
    state.items.forEach(function (it) {
      if (it.department) depts[it.department] = 1;
      if (it.category) cats[it.category] = 1;
      itemLocations(it).forEach(function (l) { locs[l] = 1; });
      if (it.vendor) vends[it.vendor] = 1;
    });
    fillSelect(els.dept, Object.keys(depts).sort(), 'Any department');
    fillSelect(els.cat, Object.keys(cats).sort(), 'Any category');
    fillSelect(els.loc, Object.keys(locs).sort(), 'Any location');
    fillSelect(els.vendor, Object.keys(vends).sort(), 'Any vendor');
  }

  function renderCards() {
    var s = state.summary || {};
    var n = document.getElementById('ivTabReqN'); if (n) n.textContent = (s.openRequests ? '(' + s.openRequests + ')' : '');
    els.cards.innerHTML =
      card('', 'Total Items', s.total != null ? s.total : 0, '', 'items')
      + card('low', 'Low Stock', s.low || 0, 'at or below min', 'items')
      + card('out', 'Out of Stock', s.out || 0, 'zero on hand', 'items')
      + card('rev', 'Needs Review', s.review || 0, 'unconfirmed count', 'items')
      + card('', 'Open Requests', s.openRequests || 0, 'awaiting action', 'requests')
      + card('low', 'Urgent Requests', s.urgentRequests || 0, 'high / urgent', 'requests')
      + card('', 'Orders In Transit', s.inTransit || 0, 'ordered / shipped', 'requests')
      + card('', 'Last Count', fmtDate(s.lastCount), 'most recent', '');
    function card(cls, lbl, val, sub, go) {
      return '<div class="iv-card ' + cls + '"' + (go ? ' data-go="' + go + '" style="cursor:pointer;"' : '') + '><div class="iv-card-lbl">' + esc(lbl) + '</div><div class="iv-card-val">' + esc(val) + '</div>' + (sub ? '<div class="iv-card-sub">' + esc(sub) + '</div>' : '') + '</div>';
    }
    els.cards.querySelectorAll('[data-go]').forEach(function (c) { c.addEventListener('click', function () { switchView(c.getAttribute('data-go')); }); });
  }

  function applyFilters() {
    var q = (els.search.value || '').trim().toLowerCase();
    var d = els.dept.value, c = els.cat.value, st = els.status.value, lo = els.loc.value, ve = els.vendor.value;
    return state.items.filter(function (it) {
      if (d && it.department !== d) return false;
      if (c && it.category !== c) return false;
      if (st && it.status !== st) return false;
      if (lo && itemLocations(it).indexOf(lo) === -1) return false;
      if (ve && it.vendor !== ve) return false;
      if (q) {
        var hay = [it.itemName, it.sku, it.category, it.department, it.location, it.spot, it.vendor, it.notes].map(function (x) { return String(x || '').toLowerCase(); }).join(' ');
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  function renderTable() {
    if (!els.body) return;
    var rows = applyFilters();
    els.count.textContent = state.loading ? 'Loading…' : rows.length + ' of ' + state.items.length + ' item' + (state.items.length === 1 ? '' : 's');
    if (!state.items.length) { els.body.innerHTML = '<tr><td colspan="9" class="iv-empty">' + (state.loading ? 'Loading…' : (state.loaded ? 'No inventory yet. Add an item or import your sheet.' : 'Open this page to load inventory.')) + '</td></tr>'; return; }
    if (!rows.length) { els.body.innerHTML = '<tr><td colspan="9" class="iv-empty">No items match.</td></tr>'; return; }
    els.body.innerHTML = rows.map(function (it) {
      return '<tr data-id="' + it.id + '" role="button" tabindex="0"' + (it.archived ? ' class="iv-archived"' : '') + '>'
        + '<td><div class="iv-namecell">' + (it.photoVer ? '<img class="iv-thumb" loading="lazy" src="' + esc(photoUrl(it)) + '" alt="">' : '') + '<div><span class="iv-name">' + esc(it.itemName) + '</span>' + (it.archived ? ' <span class="iv-chip iv-rev">archived</span>' : '') + (it.sku ? '<div style="font-size:11px;color:#8aa0bb;">' + esc(it.sku) + '</div>' : '') + '</div></div></td>'
        + '<td>' + esc(it.category || '—') + '</td>'
        + '<td>' + esc(it.department || '—') + '</td>'
        + '<td title="' + esc(itemLocations(it).join(', ')) + '">' + locDisplay(itemLocations(it)) + '</td>'
        + '<td><b>' + (it.quantity == null ? '—' : Number(it.quantity)) + '</b>' + (it.unitType ? ' <span style="color:#8aa0bb;font-size:11px;">' + esc(it.unitType) + '</span>' : '') + '</td>'
        + '<td>' + (it.minStock || 0) + '</td>'
        + '<td><span class="iv-chip ' + statusClass(it.status) + '">' + esc(it.status) + '</span></td>'
        + '<td>' + (it.orderLink ? '<a class="iv-link" href="' + esc(it.orderLink) + '" target="_blank" rel="noopener" onclick="event.stopPropagation();">Order ↗</a>' : '<span style="color:#c0ccda;">—</span>') + '</td>'
        + '<td>' + esc(fmtDate(it.lastCounted)) + '</td>'
        + '</tr>';
    }).join('');
    els.body.querySelectorAll('[data-id]').forEach(function (tr) { tr.addEventListener('click', function () { openDetail(tr.getAttribute('data-id')); }); });
  }

  function loadData() {
    if (!els.body) return;
    state.loading = true; renderTable();
    fetch(API + (state.includeArchived ? '?includeArchived=1' : ''), { headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        state.loading = false;
        if (!res.ok) { state.items = []; state.loaded = true; els.body.innerHTML = '<tr><td colspan="9" class="iv-empty">Could not load (' + esc((res.j && res.j.error) || 'error') + '). Make sure you are signed in.</td></tr>'; return; }
        state.items = res.j.items || []; state.summary = res.j.summary || {}; state.role = res.j.role || ''; state.loaded = true;
        updateRoleUI(); refreshFilters(); renderCards(); renderTable();
      })
      .catch(function (e) { state.loading = false; state.loaded = true; if (els.body) els.body.innerHTML = '<tr><td colspan="9" class="iv-empty">Network error: ' + esc(e.message) + '</td></tr>'; });
  }

  // ── Modal plumbing ────────────────────────────────────────
  function buildModal() {
    if (document.getElementById('ivModal')) return;
    var bd = document.createElement('div'); bd.className = 'iv-modal-bd'; bd.id = 'ivModal';
    bd.innerHTML = '<div class="iv-modal" role="dialog" aria-modal="true"><div class="iv-mhead"><div><div class="iv-mtitle" id="ivMTitle"></div><div class="iv-msub" id="ivMSub"></div></div><button class="iv-x" id="ivMClose">✕</button></div><div class="iv-mbody" id="ivMBody"></div></div>';
    document.body.appendChild(bd);
    bd.addEventListener('click', function (e) { if (e.target === bd) closeModal(); });
    document.getElementById('ivMClose').addEventListener('click', closeModal);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });
  }
  function openModal(title, sub, html) {
    document.getElementById('ivMTitle').textContent = title;
    document.getElementById('ivMSub').textContent = sub || '';
    document.getElementById('ivMBody').innerHTML = html;
    document.getElementById('ivModal').classList.add('open');
  }
  function closeModal() { var m = document.getElementById('ivModal'); if (m) m.classList.remove('open'); state.activeId = null; }
  function val(id) { var e = document.getElementById(id); return e ? e.value : ''; }

  // ── Add item ──────────────────────────────────────────────
  function fieldsHtml(it) {
    it = it || {};
    return '<div class="iv-grid2">'
      + fld('Item name', '<input id="ivfName" value="' + esc(it.itemName || '') + '"/>')
      + fld('Category', '<input id="ivfCat" list="ivCatList" value="' + esc(it.category || '') + '"/>')
      + fld('Department', '<input id="ivfDept" list="ivDeptList" value="' + esc(it.department || '') + '"/>')
      + fld('Current quantity', '<input id="ivfQty" type="number" step="any" value="' + (it.quantity == null ? '' : esc(it.quantity)) + '"/>')
      + fld('Unit type', '<input id="ivfUnit" list="ivUnitList" value="' + esc(it.unitType || '') + '"/>')
      + fld('Minimum stock level', '<input id="ivfMin" type="number" step="any" value="' + (it.minStock != null ? esc(it.minStock) : '0') + '"/>')
      + fld('Vendor / Supplier', '<input id="ivfVendor" value="' + esc(it.vendor || '') + '"/>')
      + fld('Item number / SKU', '<input id="ivfSku" value="' + esc(it.sku || '') + '"/>')
      + '</div>'
      + fld('Locations <span style="font-weight:400;color:#8aa0bb;">(add one or more — type and press Enter)</span>', '<div class="iv-tags" id="ivfLocs"></div><input id="ivfLocInput" class="iv-input" list="ivLocList" placeholder="e.g. Assembly Supply Rack, Q12-A1…" style="width:100%;box-sizing:border-box;margin-top:6px;"/>')
      + fld('Order / Purchase link', '<input id="ivfLink" type="url" placeholder="https://www.uline.com/… (vendor reorder page)" value="' + esc(it.orderLink || '') + '"/>')
      + fld('Notes', '<textarea id="ivfNotes" rows="2">' + esc(it.notes || '') + '</textarea>');
    function fld(l, inner) { return '<div class="iv-field"><label>' + l + '</label>' + inner + '</div>'; }
  }

  function wireLocTags(arr) {
    var wrap = document.getElementById('ivfLocs'); var input = document.getElementById('ivfLocInput');
    if (!wrap || !input) return;
    function exists(v) { return [].slice.call(wrap.querySelectorAll('[data-loc]')).some(function (e) { return e.getAttribute('data-loc').toLowerCase() === v.toLowerCase(); }); }
    function chip(v) {
      var s = document.createElement('span'); s.className = 'iv-tag'; s.setAttribute('data-loc', v);
      s.innerHTML = esc(v) + ' <button type="button" aria-label="Remove">×</button>';
      s.querySelector('button').addEventListener('click', function () { s.remove(); });
      wrap.appendChild(s);
    }
    wrap.innerHTML = ''; (arr || []).forEach(function (v) { if (v) chip(v); });
    function addFromInput() { (input.value || '').split(',').forEach(function (p) { var v = p.trim(); if (v && !exists(v)) chip(v); }); input.value = ''; }
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addFromInput(); } });
    input.addEventListener('blur', addFromInput);
  }
  function readLocTags() { var wrap = document.getElementById('ivfLocs'); return wrap ? [].slice.call(wrap.querySelectorAll('[data-loc]')).map(function (e) { return e.getAttribute('data-loc'); }) : []; }

  function readFields() {
    return { itemName: val('ivfName').trim(), category: val('ivfCat').trim(), department: val('ivfDept').trim(),
      location: readLocTags().join(', '), spot: '', quantity: val('ivfQty'), unitType: val('ivfUnit').trim(),
      minStock: val('ivfMin'), vendor: val('ivfVendor').trim(), sku: val('ivfSku').trim(), orderLink: val('ivfLink').trim(), notes: val('ivfNotes') };
  }
  function openAddModal() {
    if (!canManage()) return;
    openModal('Add inventory item', '', fieldsHtml(null)
      + '<div class="iv-row" style="margin-top:12px;justify-content:flex-end;"><button class="iv-btn" id="ivAddCancel" type="button">Cancel</button><button class="iv-go" id="ivAddSave" type="button">Add item</button></div>');
    wireLocTags([]);
    document.getElementById('ivAddCancel').addEventListener('click', closeModal);
    document.getElementById('ivAddSave').addEventListener('click', function () { saveAdd(false); });
  }
  function saveAdd(force) {
    var item = readFields();
    if (!item.itemName) { alert('Item name is required.'); return; }
    post({ action: 'add', item: item, force: force }, function (res) {
      if (res.duplicate) {
        if (confirm('A similar item already exists:\n\n' + res.duplicate.itemName + ' · ' + (res.duplicate.department || '—') + ' · ' + (res.duplicate.location || '—') + ' (' + (res.duplicate.quantity == null ? '—' : res.duplicate.quantity) + ')\n\nAdd as a separate item anyway?')) saveAdd(true);
        return;
      }
      closeModal(); loadData();
    });
  }

  // ── Detail / edit / count ─────────────────────────────────
  function openDetail(id) {
    var it = state.items.filter(function (x) { return String(x.id) === String(id); })[0];
    if (!it) return;
    state.activeId = id;
    var manage = canManage(), count = canCount();
    var html = ''
      + '<div class="iv-row" style="justify-content:space-between;align-items:center;">'
      + '<span class="iv-chip ' + statusClass(it.status) + '" style="font-size:13px;">' + esc(it.status) + '</span>'
      + '<span style="font-size:22px;font-weight:800;color:#16263a;">' + (it.quantity == null ? '—' : Number(it.quantity)) + ' <span style="font-size:13px;color:#8aa0bb;font-weight:600;">' + esc(it.unitType || '') + '</span></span>'
      + '</div>';

    // Photo
    html += '<div style="margin-top:12px;">'
      + (it.photoVer ? '<img class="iv-photo" src="' + esc(photoUrl(it)) + '" alt="' + esc(it.itemName) + '">' : '')
      + (count ? '<div class="iv-row" style="margin-top:8px;">'
          + '<button class="iv-btn" id="ivPhotoSet" type="button">📷 ' + (it.photoVer ? 'Replace photo' : 'Add photo') + '</button>'
          + (it.photoVer ? '<button class="iv-btn" id="ivPhotoDel" type="button">Remove photo</button>' : '')
          + '</div>' : (it.photoVer ? '' : '<div style="font-size:12.5px;color:#9aa7b6;margin-top:6px;">No photo</div>'))
      + '</div>';

    // Reorder + request actions
    html += '<div class="iv-row" style="margin-top:12px;">'
      + (it.orderLink ? '<a class="iv-olink" href="' + esc(it.orderLink) + '" target="_blank" rel="noopener">🛒 Open order link</a>' : '<span style="font-size:12.5px;color:#9aa7b6;">No order link added</span>')
      + '<button class="iv-reqbtn" id="ivReqMore" type="button">📋 Request more</button>'
      + '</div>';

    if (count) {
      html += '<div class="iv-sec">Update count</div>'
        + '<div class="iv-row"><div class="iv-seg" id="ivCntSeg"><button data-m="set" class="on">Set exact</button><button data-m="add">+ Add</button><button data-m="remove">− Remove</button></div>'
        + '<input id="ivCntAmt" class="iv-input" type="number" step="any" style="width:110px;" placeholder="0"/></div>'
        + '<div class="iv-field" style="margin-top:8px;"><input id="ivCntNote" class="iv-input" style="width:100%;box-sizing:border-box;" placeholder="Optional note (kept in history)"/></div>'
        + '<div class="iv-row"><button class="iv-go" id="ivCntSave" type="button">Save count</button>'
        + (it.needsReview ? '<button class="iv-btn" id="ivReview" type="button">Mark reviewed</button>' : '')
        + '</div>';
    }

    html += '<div class="iv-sec">Details</div>'
      + kv('Item', it.itemName) + kv('Category', it.category || '—') + kv('Department', it.department || '—')
      + '<div class="iv-kv"><span>Locations</span><span>' + (itemLocations(it).length ? itemLocations(it).map(function (l) { return '<span class="iv-tag iv-tag-ro">' + esc(l) + '</span>'; }).join(' ') : '—') + '</span></div>'
      + kv('Min stock', it.minStock || 0) + kv('Vendor', it.vendor || '—')
      + kv('SKU', it.sku || '—') + kv('Last counted', fmtDateTime(it.lastCounted)) + kv('Last updated by', it.lastUpdatedBy || '—')
      + kv('Created', fmtDate(it.createdAt) + (it.createdBy ? ' · ' + it.createdBy : ''))
      + (it.notes ? '<div class="iv-sec">Notes</div><div style="white-space:pre-wrap;font-size:12.5px;color:#243b55;">' + esc(it.notes) + '</div>' : '');

    if (manage) {
      html += '<div class="iv-sec">Manage</div><div class="iv-row">'
        + '<button class="iv-btn" id="ivEdit" type="button">Edit fields</button>'
        + '<button class="iv-danger" id="ivArchBtn" type="button">' + (it.archived ? 'Unarchive' : 'Archive') + '</button>'
        + '</div>';
    }

    openModal(it.itemName, (it.category || 'Uncategorized') + ' · ' + (it.department || 'No dept') + ' · ' + (it.location || 'No location'), html);

    document.getElementById('ivReqMore').addEventListener('click', function () { openRequestForm(it); });
    var pSet = document.getElementById('ivPhotoSet'); if (pSet) pSet.addEventListener('click', function () { pickPhoto(it.id); });
    var pDel = document.getElementById('ivPhotoDel'); if (pDel) pDel.addEventListener('click', function () { if (confirm('Remove the photo for "' + it.itemName + '"?')) post({ action: 'removePhoto', itemId: it.id }, function () { loadData(); openDetailAfter(it.id); }); });

    if (count) {
      var mode = 'set';
      var seg = document.getElementById('ivCntSeg');
      seg.querySelectorAll('button').forEach(function (b) { b.addEventListener('click', function () { mode = b.getAttribute('data-m'); seg.querySelectorAll('button').forEach(function (x) { x.classList.remove('on'); }); b.classList.add('on'); }); });
      document.getElementById('ivCntSave').addEventListener('click', function () {
        var amt = Number(document.getElementById('ivCntAmt').value);
        if (!isFinite(amt)) { alert('Enter a number.'); return; }
        post({ action: 'count', id: id, mode: mode, amount: amt, note: document.getElementById('ivCntNote').value }, function () { loadData(); openDetailAfter(id); });
      });
      var rv = document.getElementById('ivReview'); if (rv) rv.addEventListener('click', function () { post({ action: 'review', id: id }, function () { loadData(); openDetailAfter(id); }); });
    }
    if (manage) {
      document.getElementById('ivEdit').addEventListener('click', function () { openEdit(it); });
      document.getElementById('ivArchBtn').addEventListener('click', function () {
        var act = it.archived ? 'unarchive' : 'archive';
        if (act === 'archive' && !confirm('Archive "' + it.itemName + '"? It will be hidden but not deleted.')) return;
        post({ action: act, id: id }, function () { closeModal(); loadData(); });
      });
    }
  }
  // Reload then reopen detail (so the modal reflects the new count).
  function openDetailAfter(id) {
    fetch(API + (state.includeArchived ? '?includeArchived=1' : ''), { headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (j) { state.items = j.items || []; state.summary = j.summary || {}; refreshFilters(); renderCards(); renderTable(); if (document.getElementById('ivModal').classList.contains('open')) openDetail(id); });
  }

  function openEdit(it) {
    openModal('Edit ' + it.itemName, 'Change details', fieldsHtml(it)
      + '<div class="iv-row" style="margin-top:12px;justify-content:flex-end;"><button class="iv-btn" id="ivEditCancel" type="button">Cancel</button><button class="iv-go" id="ivEditSave" type="button">Save</button></div>');
    wireLocTags(itemLocations(it));
    document.getElementById('ivEditCancel').addEventListener('click', function () { openDetail(it.id); });
    document.getElementById('ivEditSave').addEventListener('click', function () {
      var f = readFields();
      if (!f.itemName) { alert('Item name is required.'); return; }
      // Only send quantity if it actually changed (avoids resetting last-counted
      // when editing other fields).
      if (String(f.quantity).trim() === (it.quantity == null ? '' : String(it.quantity))) delete f.quantity;
      post({ action: 'update', id: it.id, fields: f }, function () { loadData(); openDetailAfter(it.id); });
    });
  }

  function kv(k, v) { return '<div class="iv-kv"><span>' + esc(k) + '</span><span>' + esc(v) + '</span></div>'; }

  function post(payload, done) {
    fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify(payload) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) { if (!res.ok) { alert('Could not save: ' + ((res.j && res.j.error) || 'error')); return; } if (done) done(res.j); })
      .catch(function (e) { alert('Network error: ' + e.message); });
  }

  // ── Photos (thumbnail per item) ───────────────────────────
  function photoUrl(it) { return API + '?photo=' + encodeURIComponent(it.id) + '&img=1&v=' + (it.photoVer || 0); }
  function resizeImage(file, maxDim, cb) {
    var reader = new FileReader();
    reader.onload = function (e) {
      var img = new Image();
      img.onload = function () {
        var scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        var cw = Math.max(1, Math.round(img.width * scale)), ch = Math.max(1, Math.round(img.height * scale));
        var canvas = document.createElement('canvas'); canvas.width = cw; canvas.height = ch;
        canvas.getContext('2d').drawImage(img, 0, 0, cw, ch);
        try { cb(canvas.toDataURL('image/jpeg', 0.72)); } catch (_) { alert('Could not process that image.'); }
      };
      img.onerror = function () { alert('That file is not a readable image.'); };
      img.src = e.target.result;
    };
    reader.onerror = function () { alert('Could not read the file.'); };
    reader.readAsDataURL(file);
  }
  function pickPhoto(itemId) {
    var input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*'; input.setAttribute('capture', 'environment'); input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', function () {
      var f = input.files && input.files[0];
      if (f) resizeImage(f, 280, function (dataUrl) { post({ action: 'setPhoto', itemId: itemId, photoData: dataUrl }, function () { loadData(); openDetailAfter(itemId); }); });
      input.remove();
    });
    input.click();
  }

  // ── Import (Excel/CSV) — flexible header matching ─────────
  var HEADER_MAP = { lookup: function (header) {
    var h = String(header == null ? '' : header).toLowerCase().trim();
    if (!h) return null;
    // SKU / item number first (so "Item #" doesn't get caught as the name).
    if (/\bsku\b/.test(h) || h.indexOf('item #') >= 0 || h.indexOf('item#') >= 0 || /item\s*(no|num|number)/.test(h) || /\bpart\b/.test(h) || h === 'item #' || /^item\s*#?$/.test(h) && h.indexOf('#') >= 0) return 'sku';
    if (h.indexOf('order link') >= 0 || h.indexOf('purchase link') >= 0 || h.indexOf('vendor link') >= 0 || /\b(link|url)\b/.test(h)) return 'orderLink';
    if (h.indexOf('description') >= 0 || h === 'item' || h === 'name' || h === 'product' || h === 'supply') return 'itemName';
    if ((h.indexOf('on hand') >= 0 || h === 'qty' || h === 'quantity' || h === 'count' || h === 'qoh' || h.indexOf('current qty') >= 0 || h.indexOf('current quantity') >= 0) && !/max|order/.test(h)) return 'quantity';
    if (h.indexOf('threshold') >= 0 || /\bmin\b/.test(h) || h.indexOf('minimum') >= 0 || h.indexOf('reorder point') >= 0 || h.indexOf('reorder level') >= 0) return 'minStock';
    if (h.indexOf('category') >= 0 || h === 'type') return 'category';
    if (h.indexOf('department') >= 0 || h.indexOf('dept') >= 0 || h === 'owner') return 'department';
    if (h.indexOf('specific') >= 0 || h.indexOf('spot') >= 0 || h.indexOf('bin') >= 0) return 'spot';
    if (h.indexOf('location') >= 0 || h.indexOf('shelf') >= 0 || h.indexOf('area') >= 0 || h.indexOf('rack') >= 0) return 'location';
    if (h.indexOf('unit') >= 0 || h.indexOf('uom') >= 0) return 'unitType';
    if (h.indexOf('vendor') >= 0 || h.indexOf('supplier') >= 0) return 'vendor';
    if (h.indexOf('note') >= 0 || h.indexOf('comment') >= 0) return 'notes';
    return null;
  } };

  // Build a vendor reorder link from a Uline-style model code (S-####, H-####…).
  function ulineLink(code) {
    var c = String(code == null ? '' : code).replace(/\s+/g, '').toUpperCase();
    return /^[A-Z]{1,3}-\d+[A-Z0-9-]*$/.test(c) ? 'https://www.uline.com/Search?keywords=' + encodeURIComponent(c) : '';
  }
  // Best-effort category guess from the item description.
  function guessCategory(name) {
    var n = String(name || '').toLowerCase();
    if (/gift box/.test(n)) return 'Gift Boxes';
    if (/crinkle/.test(n)) return 'Crinkle Paper';
    if (/bubble/.test(n)) return 'Bubble Mailers';
    if (/poly ?mailer|polyethylene mailer|indestructo|easy-fold mailer|mailer/.test(n)) return 'Poly Mailers';
    if (/sticker/.test(n)) return 'Stickers';
    if (/label/.test(n)) return 'Labels';
    if (/\btape\b|handwrap|stretch|shrink|wrap/.test(n)) return 'Tape';
    if (/marker|pen\b/.test(n)) return 'Markers/Pens';
    if (/glove|gription/.test(n)) return 'Gloves';
    if (/rubber ?band/.test(n)) return 'Rubber Bands';
    if (/trash bag|broom|dust pan|microfiber|rag|cleaner|clean/.test(n)) return 'Cleaning Supplies';
    if (/printer|thermal|paper/.test(n)) return 'Printer Supplies';
    if (/box|corrugated|gaylord/.test(n)) return 'Boxes';
    if (/bag|envelope/.test(n)) return 'Bags';
    if (/blade|cutter|staple|knife/.test(n)) return 'General Supplies';
    return '';
  }

  function handleImportFile(file) {
    if (typeof XLSX === 'undefined') { alert('Spreadsheet reader not loaded — refresh and try again.'); return; }
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
        var ws = wb.Sheets[wb.SheetNames[0]];
        var raw = XLSX.utils.sheet_to_json(ws, { defval: '' });
        if (!raw.length) { alert('No rows found in that file.'); return; }
        // Build header→field map from the first row's keys.
        var map = {}; Object.keys(raw[0]).forEach(function (h) { var f = HEADER_MAP.lookup(h); if (f && !map[f]) map[f] = h; });
        if (!map.itemName) { alert('Could not find an item/name column. Headers seen: ' + Object.keys(raw[0]).join(', ')); return; }
        var rows = raw.map(function (r) {
          var o = {}; for (var f in map) o[f] = r[map[f]];
          if (o.sku) o.sku = String(o.sku).replace(/\s+/g, ' ').trim();
          // Generate a Uline reorder link from the code if none was provided.
          if (!o.orderLink && o.sku) { var l = ulineLink(o.sku); if (l) o.orderLink = l; }
          // Infer a category from the description if the sheet has none.
          if (!o.category && o.itemName) { var g = guessCategory(o.itemName); if (g) o.category = g; }
          return o;
        }).filter(function (r) { return String(r.itemName || '').trim() && !/^#?REF/i.test(String(r.itemName).trim()); });
        showImportPreview(rows, map);
      } catch (err) { alert('Could not read the file: ' + err.message); }
    };
    reader.onerror = function () { alert('Could not read the file.'); };
    reader.readAsArrayBuffer(file);
  }

  function showImportPreview(rows, map) {
    var fields = ['itemName', 'sku', 'category', 'department', 'minStock', 'quantity', 'orderLink'];
    var shown = fields.filter(function (f) { return map[f] || (f === 'orderLink' && rows.some(function (r) { return r.orderLink; })) || (f === 'category' && rows.some(function (r) { return r.category; })); });
    var head = '<tr>' + shown.map(function (f) { return '<th>' + esc(f) + '</th>'; }).join('') + '</tr>';
    var bodyR = rows.slice(0, 8).map(function (r) { return '<tr>' + shown.map(function (f) { var v = r[f]; if (f === 'orderLink' && v) v = '✓ link'; return '<td>' + esc(v) + '</td>'; }).join('') + '</tr>'; }).join('');
    var hasQty = !!map.quantity;
    openModal('Import inventory', rows.length + ' rows · matched: ' + Object.keys(map).join(', '),
      '<p style="font-size:13px;color:#5a7088;">New items are added; existing ones (matched by name + SKU) are updated — no duplicates. A Location column with comma-separated values imports as multiple locations. Uline order links are auto-built from item codes, and categories are guessed from the description.</p>'
      + (hasQty ? '<label class="iv-count" style="display:flex;align-items:center;gap:6px;margin:6px 0;cursor:pointer;"><input type="checkbox" id="ivImpQty"/> Also import the current quantities (off = items start as “Needs Review” for a fresh count)</label>' : '')
      + '<div class="iv-prev"><table><thead>' + head + '</thead><tbody>' + bodyR + '</tbody></table></div>'
      + '<div class="iv-row" style="margin-top:14px;justify-content:flex-end;"><button class="iv-btn" id="ivImpCancel" type="button">Cancel</button><button class="iv-go" id="ivImpGo" type="button">Import ' + rows.length + ' rows</button></div>'
      + '<div id="ivImpStatus" class="iv-count" style="margin-top:8px;"></div>');
    document.getElementById('ivImpCancel').addEventListener('click', closeModal);
    document.getElementById('ivImpGo').addEventListener('click', function () {
      var keepQty = hasQty && document.getElementById('ivImpQty').checked;
      var send = keepQty ? rows : rows.map(function (r) { var o = {}; for (var k in r) { if (k !== 'quantity') o[k] = r[k]; } return o; });
      runImport(send);
    });
  }

  function runImport(rows) {
    var CHUNK = 1000, i = 0, addedT = 0, updatedT = 0;
    var st = document.getElementById('ivImpStatus'); var go = document.getElementById('ivImpGo'); if (go) go.disabled = true;
    function next() {
      if (i >= rows.length) { if (st) st.textContent = 'Done — added ' + addedT + ', updated ' + updatedT + '.'; loadData(); setTimeout(closeModal, 1400); return; }
      var chunk = rows.slice(i, i + CHUNK); i += CHUNK;
      if (st) st.textContent = 'Importing ' + Math.min(i, rows.length) + ' / ' + rows.length + '…';
      post({ action: 'import', rows: chunk }, function (res) { addedT += (res.added || 0); updatedT += (res.updated || 0); next(); });
    }
    next();
  }

  // ── Export ────────────────────────────────────────────────
  function exportCsv() {
    var rows = applyFilters();
    if (!rows.length) { alert('Nothing to export.'); return; }
    var cols = [['Item', 'itemName'], ['Category', 'category'], ['Department', 'department'], ['Locations', '_locations'],
      ['Quantity', 'quantity'], ['Unit', 'unitType'], ['Min Stock', 'minStock'], ['Status', 'status'],
      ['Vendor', 'vendor'], ['SKU', 'sku'], ['Last Counted', 'lastCounted'], ['Last Updated By', 'lastUpdatedBy'], ['Notes', 'notes']];
    var esc2 = function (v) { var s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    var lines = [cols.map(function (c) { return c[0]; }).join(',')];
    rows.forEach(function (it) { lines.push(cols.map(function (c) { var v = it[c[1]]; if (c[1] === '_locations') v = itemLocations(it).join('; '); else if (c[1] === 'lastCounted') v = it.lastCounted ? new Date(it.lastCounted).toISOString().slice(0, 10) : ''; return esc2(v); }).join(',')); });
    var blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob); var a = document.createElement('a');
    a.href = url; a.download = 'inventory-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  // ── Request: create form (pre-filled from an item) ────────
  function openRequestForm(it) {
    it = it || {};
    var html = '<p style="font-size:13px;color:#5a7088;margin-top:0;">Requesting <b>' + esc(it.itemName || '') + '</b>' + (it.department ? ' for <b>' + esc(it.department) + '</b>' : '') + '. The office manager will review it.</p>'
      + '<div class="iv-grid2">'
      + '<div class="iv-field"><label>Quantity needed</label><input id="ivrQty" type="number" step="any" placeholder="e.g. 10"/></div>'
      + '<div class="iv-field"><label>Urgency</label><select id="ivrUrg"><option>Low</option><option selected>Normal</option><option>High</option><option>Urgent</option></select></div>'
      + '</div>'
      + '<div class="iv-field"><label>Reason / note</label><textarea id="ivrReason" rows="2" placeholder="Why is it needed?"></textarea></div>'
      + '<div class="iv-row" style="justify-content:flex-end;margin-top:10px;"><button class="iv-btn" id="ivrCancel" type="button">Cancel</button><button class="iv-go" id="ivrSave" type="button">Submit request</button></div>';
    openModal('Request more', it.itemName || '', html);
    document.getElementById('ivrCancel').addEventListener('click', function () { if (it.id) openDetail(it.id); else closeModal(); });
    document.getElementById('ivrSave').addEventListener('click', function () {
      var qty = document.getElementById('ivrQty').value;
      if (!String(qty).trim()) { alert('Enter a quantity.'); return; }
      post({ action: 'requestCreate', request: {
        itemId: it.id || null, itemName: it.itemName || '', category: it.category || '', department: it.department || '',
        orderLink: it.orderLink || '', quantity: qty, urgency: document.getElementById('ivrUrg').value, reason: document.getElementById('ivrReason').value
      } }, function () { closeModal(); loadData(); alert('Request submitted.'); });
    });
  }

  // ── Requests view ─────────────────────────────────────────
  function loadRequests() {
    if (!els.rbody) return;
    state.reqLoading = true; els.rbody.innerHTML = '<tr><td colspan="9" class="iv-empty">Loading…</td></tr>';
    fetch(API + '?requests=1', { headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) { state.reqLoading = false; if (!res.ok) { els.rbody.innerHTML = '<tr><td colspan="9" class="iv-empty">Could not load (' + esc((res.j && res.j.error) || 'error') + ').</td></tr>'; return; } state.requests = res.j.requests || []; renderRequests(); })
      .catch(function (e) { state.reqLoading = false; els.rbody.innerHTML = '<tr><td colspan="9" class="iv-empty">Network error: ' + esc(e.message) + '</td></tr>'; });
  }
  var REQ_OPEN_C = ['Requested', 'Reviewing', 'Approved', 'Ordered', 'Shipped'];
  function renderRequests() {
    if (!els.rbody) return;
    var q = (els.rsearch.value || '').trim().toLowerCase(), st = els.rstatus.value, ur = els.rurg.value;
    var rows = state.requests.filter(function (r) {
      if (st === 'open') { if (REQ_OPEN_C.indexOf(r.status) === -1) return false; }
      else if (st && r.status !== st) return false;
      if (ur && r.urgency !== ur) return false;
      if (q) { var hay = [r.itemName, r.department, r.requestedBy, r.status, r.reason, r.tracking].map(function (x) { return String(x || '').toLowerCase(); }).join(' '); if (hay.indexOf(q) === -1) return false; }
      return true;
    });
    els.rcount.textContent = rows.length + ' request' + (rows.length === 1 ? '' : 's');
    if (!rows.length) { els.rbody.innerHTML = '<tr><td colspan="9" class="iv-empty">' + (state.reqLoading ? 'Loading…' : 'No requests.') + '</td></tr>'; return; }
    els.rbody.innerHTML = rows.map(function (r) {
      return '<tr data-rid="' + r.id + '" role="button" tabindex="0">'
        + '<td class="iv-urg-' + esc(r.urgency) + '">' + esc(r.urgency) + '</td>'
        + '<td class="iv-name">' + esc(r.itemName) + '</td>'
        + '<td>' + esc(r.department || '—') + '</td>'
        + '<td>' + (r.quantity == null ? '—' : Number(r.quantity)) + '</td>'
        + '<td>' + esc(r.requestedBy || '—') + '</td>'
        + '<td>' + esc(fmtDate(r.createdAt)) + '</td>'
        + '<td><span class="iv-chip ' + reqStatusClass(r.status) + '">' + esc(r.status) + '</span></td>'
        + '<td>' + esc(r.expectedDate ? fmtDate(r.expectedDate) : '—') + '</td>'
        + '<td>' + esc(r.tracking || '—') + '</td>'
        + '</tr>';
    }).join('');
    els.rbody.querySelectorAll('[data-rid]').forEach(function (tr) { tr.addEventListener('click', function () { openRequestManage(tr.getAttribute('data-rid')); }); });
  }
  function reqStatusClass(s) { return s === 'Delivered' ? 'iv-in' : (s === 'Denied' || s === 'Canceled') ? 'iv-out' : (s === 'Ordered' || s === 'Shipped') ? 'iv-low' : 'iv-rev'; }

  // ── Request: manage (office manager / admin) ──────────────
  function openRequestManage(rid) {
    var r = state.requests.filter(function (x) { return String(x.id) === String(rid); })[0];
    if (!r) return;
    var manage = canManage();
    var html = kv('Item', r.itemName) + kv('Department', r.department || '—') + kv('Quantity', r.quantity == null ? '—' : Number(r.quantity))
      + kv('Urgency', r.urgency) + kv('Requested by', r.requestedBy || '—') + kv('Requested', fmtDateTime(r.createdAt))
      + (r.reason ? kv('Reason', r.reason) : '')
      + (r.orderLink ? '<div class="iv-row" style="margin:8px 0;"><a class="iv-olink" href="' + esc(r.orderLink) + '" target="_blank" rel="noopener">🛒 Open order link</a></div>' : '');

    if (manage) {
      html += '<div class="iv-sec">Manage request</div>'
        + '<div class="iv-grid2">'
        + '<div class="iv-field"><label>Status</label><select id="ivmStatus">' + ['Requested', 'Reviewing', 'Approved', 'Ordered', 'Shipped', 'Delivered', 'Denied', 'Canceled'].map(function (s) { return '<option' + (s === r.status ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></div>'
        + '<div class="iv-field"><label>Assigned to</label><input id="ivmOwner" value="' + esc(r.assignedTo || '') + '" placeholder="Office manager"/></div>'
        + '<div class="iv-field"><label>Expected shipment date</label><input id="ivmDate" type="date" value="' + esc(r.expectedDate ? String(r.expectedDate).slice(0, 10) : '') + '"/></div>'
        + '<div class="iv-field"><label>Tracking number</label><input id="ivmTrack" value="' + esc(r.tracking || '') + '"/></div>'
        + '</div>'
        + '<div class="iv-field"><label>Notes</label><textarea id="ivmNotes" rows="2">' + esc(r.notes || '') + '</textarea></div>'
        + '<div class="iv-row" style="justify-content:flex-end;"><button class="iv-go" id="ivmSave" type="button">Save</button></div>';
    } else {
      html += '<div class="iv-sec">Status</div>' + kv('Status', r.status) + (r.expectedDate ? kv('Expected', fmtDate(r.expectedDate)) : '') + (r.tracking ? kv('Tracking', r.tracking) : '') + (r.notes ? '<div class="iv-sec">Notes</div><div style="white-space:pre-wrap;font-size:12.5px;">' + esc(r.notes) + '</div>' : '');
    }
    openModal('Request: ' + r.itemName, r.status + ' · ' + r.urgency, html);

    if (manage) {
      document.getElementById('ivmSave').addEventListener('click', function () {
        var newStatus = document.getElementById('ivmStatus').value;
        var fields = { status: newStatus, assignedTo: document.getElementById('ivmOwner').value, expectedDate: document.getElementById('ivmDate').value, tracking: document.getElementById('ivmTrack').value, notes: document.getElementById('ivmNotes').value };
        post({ action: 'requestUpdate', id: rid, fields: fields }, function () {
          // On Delivered, optionally bump the linked item's stock.
          if (newStatus === 'Delivered' && r.itemId && r.quantity != null && r.status !== 'Delivered') {
            if (confirm('Marked delivered. Add ' + Number(r.quantity) + ' to "' + r.itemName + '" inventory now?')) {
              post({ action: 'count', id: r.itemId, mode: 'add', amount: Number(r.quantity), note: 'Received from request #' + rid }, function () { closeModal(); loadData(); loadRequests(); });
              return;
            }
          }
          closeModal(); loadData(); loadRequests();
        });
      });
    }
  }

  // ── Activation ────────────────────────────────────────────
  function isActive() { var p = document.getElementById(PAGE_ID); return !!(p && (p.classList.contains('active') || window.location.hash === '#' + PAGE_ID)); }
  function onMaybeActivate() { if (els.body && isActive()) loadData(); }

  function init() {
    injectStyles();
    buildShell();
    if (isActive()) loadData();
    document.addEventListener('click', function (e) { var b = e.target && e.target.closest && e.target.closest('.nav-btn[data-page="' + PAGE_ID + '"]'); if (b) setTimeout(onMaybeActivate, 0); }, true);
    window.addEventListener('hashchange', function () { if (window.location.hash === '#' + PAGE_ID) onMaybeActivate(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.inventoryModule = { reload: loadData };
})();
