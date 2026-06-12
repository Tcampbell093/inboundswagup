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

  var state = { items: [], summary: {}, role: '', loaded: false, loading: false, includeArchived: false, activeId: null };
  var els = {};

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]; }); }
  function fmtDate(v) { if (!v) return '—'; var d = new Date(v); return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  function fmtDateTime(v) { if (!v) return '—'; var d = new Date(v); return isNaN(d.getTime()) ? '—' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  function canManage() { return state.role === 'admin' || state.role === 'manager'; }
  function canCount() { return canManage() || state.role === 'l1' || state.role === 'l2'; }
  function statusClass(s) { return s === 'In Stock' ? 'iv-in' : s === 'Low Stock' ? 'iv-low' : s === 'Out of Stock' ? 'iv-out' : 'iv-rev'; }
  function qtyText(it) { return it.quantity == null ? '—' : (Number(it.quantity) + (it.unitType ? ' ' + it.unitType : '')); }

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
      + '#inventoryPage .iv-input,#inventoryPage .iv-select{padding:9px 12px;border:1px solid #d6deea;border-radius:10px;font:inherit;background:#fff;color:#16263a;}'
      + '#inventoryPage .iv-input:focus,#inventoryPage .iv-select:focus{outline:none;border-color:#5b8fc7;box-shadow:0 0 0 3px rgba(91,143,199,.18);}'
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
      + '.iv-prev th,.iv-prev td{padding:6px 8px;border-bottom:1px solid #f2f5f9;text-align:left;white-space:nowrap;}';
    var s = document.createElement('style'); s.id = 'ivStyles'; s.textContent = c; document.head.appendChild(s);
  }

  function dl(id, values) { return '<datalist id="' + id + '">' + values.map(function (v) { return '<option value="' + esc(v) + '"></option>'; }).join('') + '</datalist>'; }

  function buildShell() {
    var root = document.getElementById('inventoryRoot');
    if (!root || root.dataset.built) return;
    root.dataset.built = '1';
    root.innerHTML =
      '<div class="iv-cards" id="ivCards"></div>'
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
      + '<th>Item</th><th>Category</th><th>Department</th><th>Location</th><th>Qty</th><th>Min</th><th>Status</th><th>Vendor</th><th>Last Counted</th>'
      + '</tr></thead><tbody id="ivBody"></tbody></table></div>'
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

    buildModal();
    updateRoleUI();
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
      if (it.location) locs[it.location] = 1;
      if (it.vendor) vends[it.vendor] = 1;
    });
    fillSelect(els.dept, Object.keys(depts).sort(), 'Any department');
    fillSelect(els.cat, Object.keys(cats).sort(), 'Any category');
    fillSelect(els.loc, Object.keys(locs).sort(), 'Any location');
    fillSelect(els.vendor, Object.keys(vends).sort(), 'Any vendor');
  }

  function renderCards() {
    var s = state.summary || {};
    els.cards.innerHTML =
      card('', 'Total Items', s.total != null ? s.total : 0, '')
      + card('low', 'Low Stock', s.low || 0, 'at or below min')
      + card('out', 'Out of Stock', s.out || 0, 'zero on hand')
      + card('rev', 'Needs Review', s.review || 0, 'unconfirmed count')
      + card('', 'Last Count', fmtDate(s.lastCount), 'most recent');
    function card(cls, lbl, val, sub) {
      return '<div class="iv-card ' + cls + '"><div class="iv-card-lbl">' + esc(lbl) + '</div><div class="iv-card-val">' + esc(val) + '</div>' + (sub ? '<div class="iv-card-sub">' + esc(sub) + '</div>' : '') + '</div>';
    }
  }

  function applyFilters() {
    var q = (els.search.value || '').trim().toLowerCase();
    var d = els.dept.value, c = els.cat.value, st = els.status.value, lo = els.loc.value, ve = els.vendor.value;
    return state.items.filter(function (it) {
      if (d && it.department !== d) return false;
      if (c && it.category !== c) return false;
      if (st && it.status !== st) return false;
      if (lo && it.location !== lo) return false;
      if (ve && it.vendor !== ve) return false;
      if (q) {
        var hay = [it.itemName, it.sku, it.category, it.department, it.location, it.vendor, it.notes].map(function (x) { return String(x || '').toLowerCase(); }).join(' ');
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
      return '<tr data-id="' + it.id + '"' + (it.archived ? ' class="iv-archived"' : '') + '>'
        + '<td class="iv-name">' + esc(it.itemName) + (it.archived ? ' <span class="iv-chip iv-rev">archived</span>' : '') + (it.sku ? '<div style="font-size:11px;color:#8aa0bb;">' + esc(it.sku) + '</div>' : '') + '</td>'
        + '<td>' + esc(it.category || '—') + '</td>'
        + '<td>' + esc(it.department || '—') + '</td>'
        + '<td>' + esc(it.location || '—') + '</td>'
        + '<td><b>' + (it.quantity == null ? '—' : Number(it.quantity)) + '</b>' + (it.unitType ? ' <span style="color:#8aa0bb;font-size:11px;">' + esc(it.unitType) + '</span>' : '') + '</td>'
        + '<td>' + (it.minStock || 0) + '</td>'
        + '<td><span class="iv-chip ' + statusClass(it.status) + '">' + esc(it.status) + '</span></td>'
        + '<td>' + esc(it.vendor || '—') + '</td>'
        + '<td>' + esc(fmtDate(it.lastCounted)) + '</td>'
        + '</tr>';
    }).join('');
    els.body.querySelectorAll('[data-id]').forEach(function (tr) { tr.addEventListener('click', function () { openDetail(Number(tr.getAttribute('data-id'))); }); });
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
      + fld('Location', '<input id="ivfLoc" list="ivLocList" value="' + esc(it.location || '') + '"/>')
      + fld('Current quantity', '<input id="ivfQty" type="number" step="any" value="' + (it.quantity == null ? '' : esc(it.quantity)) + '"/>')
      + fld('Unit type', '<input id="ivfUnit" list="ivUnitList" value="' + esc(it.unitType || '') + '"/>')
      + fld('Minimum stock level', '<input id="ivfMin" type="number" step="any" value="' + (it.minStock != null ? esc(it.minStock) : '0') + '"/>')
      + fld('Vendor / Supplier', '<input id="ivfVendor" value="' + esc(it.vendor || '') + '"/>')
      + fld('Item number / SKU', '<input id="ivfSku" value="' + esc(it.sku || '') + '"/>')
      + '</div>'
      + fld('Notes', '<textarea id="ivfNotes" rows="2">' + esc(it.notes || '') + '</textarea>');
    function fld(l, inner) { return '<div class="iv-field"><label>' + esc(l) + '</label>' + inner + '</div>'; }
  }
  function readFields() {
    return { itemName: val('ivfName').trim(), category: val('ivfCat').trim(), department: val('ivfDept').trim(),
      location: val('ivfLoc').trim(), quantity: val('ivfQty'), unitType: val('ivfUnit').trim(),
      minStock: val('ivfMin'), vendor: val('ivfVendor').trim(), sku: val('ivfSku').trim(), notes: val('ivfNotes') };
  }
  function openAddModal() {
    if (!canManage()) return;
    openModal('Add inventory item', '', fieldsHtml(null)
      + '<div class="iv-row" style="margin-top:12px;justify-content:flex-end;"><button class="iv-btn" id="ivAddCancel" type="button">Cancel</button><button class="iv-go" id="ivAddSave" type="button">Add item</button></div>');
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
    var it = state.items.filter(function (x) { return x.id === id; })[0];
    if (!it) return;
    state.activeId = id;
    var manage = canManage(), count = canCount();
    var html = ''
      + '<div class="iv-row" style="justify-content:space-between;align-items:center;">'
      + '<span class="iv-chip ' + statusClass(it.status) + '" style="font-size:13px;">' + esc(it.status) + '</span>'
      + '<span style="font-size:22px;font-weight:800;color:#16263a;">' + (it.quantity == null ? '—' : Number(it.quantity)) + ' <span style="font-size:13px;color:#8aa0bb;font-weight:600;">' + esc(it.unitType || '') + '</span></span>'
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
      + kv('Location', it.location || '—') + kv('Min stock', it.minStock || 0) + kv('Vendor', it.vendor || '—')
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
    document.getElementById('ivEditCancel').addEventListener('click', function () { openDetail(it.id); });
    document.getElementById('ivEditSave').addEventListener('click', function () {
      var f = readFields();
      if (!f.itemName) { alert('Item name is required.'); return; }
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

  // ── Import (Excel/CSV) ────────────────────────────────────
  var HEADER_MAP = (function () {
    function k(s) { return String(s).toLowerCase().replace(/[^a-z0-9]/g, ''); }
    var m = {};
    function add(field, names) { names.forEach(function (n) { m[k(n)] = field; }); }
    add('itemName', ['item', 'item name', 'name', 'description', 'item description', 'product', 'supply']);
    add('category', ['category', 'type']);
    add('department', ['department', 'dept', 'owner']);
    add('location', ['location', 'bin', 'shelf', 'area', 'rack']);
    add('quantity', ['qty', 'quantity', 'count', 'on hand', 'onhand', 'current quantity', 'current qty', 'stock']);
    add('unitType', ['unit', 'unit type', 'uom', 'units']);
    add('minStock', ['min', 'min stock', 'minimum', 'minimum stock level', 'min stock level', 'reorder point', 'reorder', 'reorder level']);
    add('vendor', ['vendor', 'supplier', 'vendor/supplier', 'vendorsupplier']);
    add('sku', ['sku', 'item number', 'item #', 'item no', 'part number', 'part #', 'item number/sku', 'itemnumbersku', 'number']);
    add('notes', ['notes', 'note', 'comment', 'comments']);
    return { lookup: function (header) { return m[k(header)] || null; } };
  })();

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
          var o = {}; for (var f in map) o[f] = r[map[f]]; return o;
        }).filter(function (r) { return String(r.itemName || '').trim(); });
        showImportPreview(rows, map);
      } catch (err) { alert('Could not read the file: ' + err.message); }
    };
    reader.onerror = function () { alert('Could not read the file.'); };
    reader.readAsArrayBuffer(file);
  }

  function showImportPreview(rows, map) {
    var fields = ['itemName', 'category', 'department', 'location', 'quantity', 'unitType', 'minStock', 'vendor', 'sku'];
    var shown = fields.filter(function (f) { return map[f]; });
    var head = '<tr>' + shown.map(function (f) { return '<th>' + esc(f) + '</th>'; }).join('') + '</tr>';
    var bodyR = rows.slice(0, 8).map(function (r) { return '<tr>' + shown.map(function (f) { return '<td>' + esc(r[f]) + '</td>'; }).join('') + '</tr>'; }).join('');
    openModal('Import inventory', rows.length + ' rows · matched columns: ' + shown.join(', '),
      '<p style="font-size:13px;color:#5a7088;">New items are added; existing ones (matched by item name + location + SKU) are updated. No duplicates.</p>'
      + '<div class="iv-prev"><table><thead>' + head + '</thead><tbody>' + bodyR + '</tbody></table></div>'
      + '<div class="iv-row" style="margin-top:14px;justify-content:flex-end;"><button class="iv-btn" id="ivImpCancel" type="button">Cancel</button><button class="iv-go" id="ivImpGo" type="button">Import ' + rows.length + ' rows</button></div>'
      + '<div id="ivImpStatus" class="iv-count" style="margin-top:8px;"></div>');
    document.getElementById('ivImpCancel').addEventListener('click', closeModal);
    document.getElementById('ivImpGo').addEventListener('click', function () { runImport(rows); });
  }

  function runImport(rows) {
    var CHUNK = 1000, i = 0, addedT = 0, updatedT = 0;
    var st = document.getElementById('ivImpStatus'); var go = document.getElementById('ivImpGo'); if (go) go.disabled = true;
    function next() {
      if (i >= rows.length) { if (st) st.textContent = 'Done — added ' + addedT + ', updated ' + updatedT + '.'; loadData(); setTimeout(closeModal, 1200); return; }
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
    var cols = [['Item', 'itemName'], ['Category', 'category'], ['Department', 'department'], ['Location', 'location'],
      ['Quantity', 'quantity'], ['Unit', 'unitType'], ['Min Stock', 'minStock'], ['Status', 'status'],
      ['Vendor', 'vendor'], ['SKU', 'sku'], ['Last Counted', 'lastCounted'], ['Last Updated By', 'lastUpdatedBy'], ['Notes', 'notes']];
    var esc2 = function (v) { var s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    var lines = [cols.map(function (c) { return c[0]; }).join(',')];
    rows.forEach(function (it) { lines.push(cols.map(function (c) { var v = it[c[1]]; if (c[1] === 'lastCounted') v = it.lastCounted ? new Date(it.lastCounted).toISOString().slice(0, 10) : ''; return esc2(v); }).join(',')); });
    var blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob); var a = document.createElement('a');
    a.href = url; a.download = 'inventory-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
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
