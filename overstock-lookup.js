/* =========================================================
   overstock-lookup.js — Overstock Lookup viewer (office / external)
   ---------------------------------------------------------
   A read-only-ish viewer for non-warehouse users: search overstock, place a
   Hold / Do Not Donate, and comment. It NEVER edits warehouse counts or the
   warehouse workflow — it talks only to /.netlify/functions/overstock-holds,
   which reads overstock entries (projected) and owns the holds/comments store.
   Rendered into #osLookupRoot inside #overstockLookupPage (index.html portal).
   ========================================================= */
(function () {
  'use strict';

  var API = '/.netlify/functions/overstock-holds';
  var PAGE_ID = 'overstockLookupPage';

  var state = { items: [], loaded: false, loading: false, activeId: null };
  var els = {};

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }
  function fmtDate(v) {
    if (!v) return '—';
    var d = (typeof v === 'number') ? new Date(v) : new Date(v);
    if (isNaN(d.getTime())) return String(v);
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  function holdClass(s) {
    return s === 'Do Not Donate' ? 'osl-hold-dnd'
      : s === 'On Hold' ? 'osl-hold-on'
      : s === 'Released' ? 'osl-hold-rel'
      : 'osl-hold-av';
  }

  function injectStyles() {
    if (document.getElementById('oslStyles')) return;
    var css = ''
      + '#overstockLookupPage .osl-tools{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:0 0 14px;}'
      + '#overstockLookupPage .osl-search{flex:1;min-width:220px;}'
      + '#overstockLookupPage .osl-input,#overstockLookupPage .osl-select{padding:9px 12px;border:1px solid #d6deea;border-radius:10px;font:inherit;background:#fff;color:#16263a;}'
      + '#overstockLookupPage .osl-input:focus,#overstockLookupPage .osl-select:focus{outline:none;border-color:#5b8fc7;box-shadow:0 0 0 3px rgba(91,143,199,.18);}'
      + '#overstockLookupPage .osl-count{margin-left:auto;font-size:13px;color:#5a7088;font-weight:600;}'
      + '#overstockLookupPage .osl-tablewrap{overflow-x:auto;border:1px solid #e6ecf3;border-radius:14px;background:#fff;}'
      + '#overstockLookupPage table.osl-table{width:100%;border-collapse:collapse;font-size:13.5px;}'
      + '#overstockLookupPage .osl-table th{text-align:left;font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:#6b7e94;padding:11px 12px;border-bottom:1px solid #eef2f7;background:#f8fafc;white-space:nowrap;position:sticky;top:0;}'
      + '#overstockLookupPage .osl-table td{padding:10px 12px;border-bottom:1px solid #f2f5f9;color:#243b55;vertical-align:middle;}'
      + '#overstockLookupPage .osl-table tr:hover td{background:#f9fbfe;}'
      + '#overstockLookupPage .osl-po{font-weight:800;color:#16263a;}'
      + '#overstockLookupPage .osl-chip{display:inline-block;padding:3px 9px;border-radius:999px;font-size:11.5px;font-weight:700;white-space:nowrap;}'
      + '#overstockLookupPage .osl-hold-av{background:#e7f7ef;color:#0a7c4e;}'
      + '#overstockLookupPage .osl-hold-on{background:#fff3d6;color:#9a5b00;}'
      + '#overstockLookupPage .osl-hold-dnd{background:#fdecec;color:#b3261e;}'
      + '#overstockLookupPage .osl-hold-rel{background:#eceff3;color:#5a7088;}'
      + '#overstockLookupPage .osl-btn{border:1px solid #cdd9e6;background:#f4f8fc;color:#2f4d6b;font-weight:700;font-size:12.5px;border-radius:9px;padding:7px 12px;cursor:pointer;}'
      + '#overstockLookupPage .osl-btn:hover{background:#e8f1fb;border-color:#b6cde4;}'
      + '#overstockLookupPage .osl-empty{padding:30px;text-align:center;color:#8aa0bb;}'
      + '#overstockLookupPage .osl-cmtn{display:inline-block;margin-left:6px;font-size:11px;color:#5a7088;}'
      // modal
      + '.osl-modal-bd{position:fixed;inset:0;background:rgba(12,22,38,.55);display:none;align-items:flex-start;justify-content:center;z-index:9000;padding:32px 16px;overflow-y:auto;}'
      + '.osl-modal-bd.open{display:flex;}'
      + '.osl-modal{background:#fff;border-radius:16px;max-width:560px;width:100%;box-shadow:0 24px 60px rgba(10,20,35,.28);overflow:hidden;}'
      + '.osl-modal-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:16px 18px;border-bottom:1px solid #eef2f7;}'
      + '.osl-modal-title{font-size:17px;font-weight:800;color:#16263a;}'
      + '.osl-modal-sub{font-size:12.5px;color:#6b7e94;margin-top:2px;}'
      + '.osl-x{border:none;background:#f1f4f8;border-radius:8px;width:30px;height:30px;cursor:pointer;font-size:16px;color:#5a7088;flex-shrink:0;}'
      + '.osl-modal-body{padding:16px 18px;max-height:70vh;overflow-y:auto;}'
      + '.osl-kv{display:flex;justify-content:space-between;gap:10px;font-size:13px;padding:5px 0;border-bottom:1px solid #f4f6f9;}'
      + '.osl-kv span:first-child{color:#6b7e94;}.osl-kv span:last-child{font-weight:600;color:#16263a;text-align:right;}'
      + '.osl-sec{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:#6b7e94;margin:16px 0 8px;}'
      + '.osl-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;}'
      + '.osl-cmt{border:1px solid #eef2f7;border-radius:10px;padding:9px 11px;margin-bottom:7px;background:#fbfdff;}'
      + '.osl-cmt-t{font-size:13px;color:#243b55;}.osl-cmt-m{font-size:10.5px;color:#8aa0bb;margin-top:3px;}'
      + '.osl-cmt-empty{font-size:12.5px;color:#9aa7b6;padding:6px 0;}'
      + '.osl-go{border:1px solid #1f9d57;background:#22a85f;color:#fff;font-weight:800;border-radius:9px;padding:9px 16px;cursor:pointer;font-size:13px;}'
      + '.osl-go:hover{background:#1f9d57;}';
    var st = document.createElement('style');
    st.id = 'oslStyles';
    st.textContent = css;
    document.head.appendChild(st);
  }

  function buildShell() {
    var root = document.getElementById('osLookupRoot');
    if (!root || root.dataset.built) return;
    root.dataset.built = '1';
    root.innerHTML =
      '<div class="osl-tools">'
      + '<input id="oslSearch" class="osl-input osl-search" type="text" placeholder="Search PO, category, status…" autocomplete="off"/>'
      + '<select id="oslCat" class="osl-select" aria-label="Category"></select>'
      + '<select id="oslStatus" class="osl-select" aria-label="Status"></select>'
      + '<select id="oslHold" class="osl-select" aria-label="Hold status">'
      + '<option value="">Any hold status</option><option>Available</option><option>On Hold</option><option>Do Not Donate</option><option>Released</option>'
      + '</select>'
      + '<button id="oslRefresh" class="osl-btn" type="button">↻ Refresh</button>'
      + '<span id="oslCount" class="osl-count"></span>'
      + '</div>'
      + '<div class="osl-tablewrap"><table class="osl-table"><thead><tr>'
      + '<th>PO</th><th>Item / Category</th><th>Qty</th><th>Status</th><th>Hold</th><th>Last Updated</th><th></th>'
      + '</tr></thead><tbody id="oslBody"></tbody></table></div>';

    els.search = document.getElementById('oslSearch');
    els.cat = document.getElementById('oslCat');
    els.status = document.getElementById('oslStatus');
    els.hold = document.getElementById('oslHold');
    els.body = document.getElementById('oslBody');
    els.count = document.getElementById('oslCount');

    els.search.addEventListener('input', renderTable);
    [els.cat, els.status, els.hold].forEach(function (s) { s.addEventListener('change', renderTable); });
    document.getElementById('oslRefresh').addEventListener('click', loadList);

    buildModal();
  }

  function fillSelect(sel, values, anyLabel) {
    var cur = sel.value;
    sel.innerHTML = '<option value="">' + anyLabel + '</option>' + values.map(function (v) {
      return '<option value="' + esc(v) + '">' + esc(v) + '</option>';
    }).join('');
    if (values.indexOf(cur) !== -1) sel.value = cur;
  }

  function refreshFilterOptions() {
    var cats = {}, stats = {};
    state.items.forEach(function (it) {
      if (it.category) cats[it.category] = 1;
      if (it.status) stats[it.status] = 1;
    });
    fillSelect(els.cat, Object.keys(cats).sort(), 'Any category');
    fillSelect(els.status, Object.keys(stats).sort(), 'Any status');
  }

  function applyFilters() {
    var q = (els.search.value || '').trim().toLowerCase();
    var cat = els.cat.value, stat = els.status.value, hold = els.hold.value;
    return state.items.filter(function (it) {
      if (cat && it.category !== cat) return false;
      if (stat && it.status !== stat) return false;
      if (hold && (it.holdStatus || 'Available') !== hold) return false;
      if (q) {
        var hay = [it.po, it.category, it.status, it.holdStatus]
          .map(function (x) { return String(x || '').toLowerCase(); }).join(' ');
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  function renderTable() {
    if (!els.body) return;
    var rows = applyFilters();
    els.count.textContent = state.loading ? 'Loading…'
      : rows.length + ' of ' + state.items.length + ' item' + (state.items.length === 1 ? '' : 's');
    if (!state.items.length) {
      els.body.innerHTML = '<tr><td colspan="7" class="osl-empty">' + (state.loading ? 'Loading overstock…' : (state.loaded ? 'No overstock found.' : 'Open this page to load overstock.')) + '</td></tr>';
      return;
    }
    if (!rows.length) { els.body.innerHTML = '<tr><td colspan="7" class="osl-empty">No items match your search.</td></tr>'; return; }
    els.body.innerHTML = rows.map(function (it) {
      var hs = it.holdStatus || 'Available';
      var cmt = it.commentCount ? '<span class="osl-cmtn">💬 ' + it.commentCount + '</span>' : '';
      return '<tr>'
        + '<td class="osl-po">' + esc(it.po || '—') + '</td>'
        + '<td>' + esc(it.category || 'Uncategorized') + cmt + '</td>'
        + '<td>' + Number(it.quantity || 0) + '</td>'
        + '<td>' + esc(it.status || '—') + '</td>'
        + '<td><span class="osl-chip ' + holdClass(hs) + '">' + esc(hs) + '</span></td>'
        + '<td>' + esc(fmtDate(it.updatedAt)) + '</td>'
        + '<td><button class="osl-btn" type="button" data-detail="' + esc(it.id) + '">Details</button></td>'
        + '</tr>';
    }).join('');
    els.body.querySelectorAll('[data-detail]').forEach(function (b) {
      b.addEventListener('click', function () { openDetail(b.getAttribute('data-detail')); });
    });
  }

  function loadList() {
    if (!els.body) return;
    state.loading = true; renderTable();
    fetch(API, { headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        state.loading = false;
        if (!res.ok) { state.items = []; state.loaded = true; els.body.innerHTML = '<tr><td colspan="8" class="osl-empty">Could not load (' + esc((res.j && res.j.error) || 'error') + '). Make sure you are signed in.</td></tr>'; return; }
        state.items = Array.isArray(res.j.items) ? res.j.items : [];
        state.loaded = true;
        refreshFilterOptions();
        renderTable();
      })
      .catch(function (e) {
        state.loading = false; state.loaded = true; state.items = [];
        if (els.body) els.body.innerHTML = '<tr><td colspan="8" class="osl-empty">Network error: ' + esc(e.message) + '</td></tr>';
      });
  }

  // ── Detail modal ──────────────────────────────────────────
  function buildModal() {
    if (document.getElementById('oslModal')) return;
    var bd = document.createElement('div');
    bd.className = 'osl-modal-bd';
    bd.id = 'oslModal';
    bd.innerHTML =
      '<div class="osl-modal" role="dialog" aria-modal="true">'
      + '<div class="osl-modal-head"><div><div class="osl-modal-title" id="oslMTitle">PO</div><div class="osl-modal-sub" id="oslMSub"></div></div><button class="osl-x" id="oslMClose" aria-label="Close">✕</button></div>'
      + '<div class="osl-modal-body" id="oslMBody"></div>'
      + '</div>';
    document.body.appendChild(bd);
    bd.addEventListener('click', function (e) { if (e.target === bd) closeModal(); });
    document.getElementById('oslMClose').addEventListener('click', closeModal);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });
  }
  function closeModal() { var m = document.getElementById('oslModal'); if (m) m.classList.remove('open'); state.activeId = null; }

  function openDetail(id) {
    var it = state.items.filter(function (x) { return x.id === id; })[0];
    if (!it) return;
    state.activeId = id;
    document.getElementById('oslMTitle').textContent = 'PO# ' + (it.po || '—');
    document.getElementById('oslMSub').textContent = (it.category || 'Uncategorized') + ' · ' + Number(it.quantity || 0) + ' units';
    var body = document.getElementById('oslMBody');
    body.innerHTML = '<div class="osl-kv-loading" style="color:#8aa0bb;font-size:13px;">Loading…</div>';
    document.getElementById('oslModal').classList.add('open');

    fetch(API + '?item=' + encodeURIComponent(id), { headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (d) { renderDetail(it, d.hold || { status: 'Available' }, d.comments || []); })
      .catch(function () { renderDetail(it, { status: it.holdStatus || 'Available', reason: it.holdReason, by: it.holdBy, at: it.holdAt }, []); });
  }

  function renderDetail(it, hold, comments) {
    if (state.activeId !== it.id) return;
    var body = document.getElementById('oslMBody');
    var hs = hold.status || 'Available';
    var html = ''
      + kv('PO', it.po || '—') + kv('Category', it.category || 'Uncategorized')
      + kv('Quantity', Number(it.quantity || 0))
      + kv('Status', it.status || '—') + kv('Action', it.action || '—')
      + kv('Last updated', fmtDate(it.updatedAt))
      + '<div class="osl-sec">Hold / Do Not Donate</div>'
      + '<div class="osl-kv"><span>Current</span><span><span class="osl-chip ' + holdClass(hs) + '">' + esc(hs) + '</span></span></div>'
      + (hold.by ? kv('Placed by', hold.by) : '')
      + (hold.at ? kv('Placed', fmtDate(hold.at)) : '')
      + (hold.reason ? kv('Reason', hold.reason) : '')
      + '<div class="osl-row" style="margin-top:10px;">'
      + '<select id="oslSetStatus" class="osl-select"><option' + (hs === 'Available' ? ' selected' : '') + '>Available</option><option' + (hs === 'On Hold' ? ' selected' : '') + '>On Hold</option><option' + (hs === 'Do Not Donate' ? ' selected' : '') + '>Do Not Donate</option><option' + (hs === 'Released' ? ' selected' : '') + '>Released</option></select>'
      + '<input id="oslSetReason" class="osl-input" style="flex:1;min-width:160px;" placeholder="Reason / note (optional)" value="' + esc(hold.reason || '') + '"/>'
      + '<button id="oslSetGo" class="osl-go" type="button">Update hold</button>'
      + '</div>'
      + '<div class="osl-sec">Comments</div>'
      + '<div id="oslCmts">' + renderComments(comments) + '</div>'
      + '<div class="osl-row" style="margin-top:8px;">'
      + '<input id="oslCmtText" class="osl-input" style="flex:1;min-width:200px;" placeholder="Add a comment…"/>'
      + '<button id="oslCmtGo" class="osl-go" type="button">Comment</button>'
      + '</div>';
    body.innerHTML = html;

    document.getElementById('oslSetGo').addEventListener('click', function () {
      var status = document.getElementById('oslSetStatus').value;
      var reason = document.getElementById('oslSetReason').value;
      post({ action: 'setHold', itemId: it.id, status: status, reason: reason }, function (res) {
        // reflect in the list immediately
        it.holdStatus = status; it.holdReason = reason;
        if (res && res.hold) { it.holdBy = res.hold.by; it.holdAt = res.hold.at; }
        renderTable();
        openDetail(it.id); // reload detail
      });
    });
    document.getElementById('oslCmtGo').addEventListener('click', function () {
      var t = document.getElementById('oslCmtText').value.trim();
      if (!t) return;
      post({ action: 'comment', itemId: it.id, text: t }, function () {
        it.commentCount = (it.commentCount || 0) + 1;
        renderTable();
        openDetail(it.id);
      });
    });
  }

  function renderComments(comments) {
    if (!comments || !comments.length) return '<div class="osl-cmt-empty">No comments yet.</div>';
    return comments.map(function (c) {
      return '<div class="osl-cmt"><div class="osl-cmt-t">' + esc(c.text) + '</div><div class="osl-cmt-m">' + esc(c.by || 'unknown') + ' · ' + esc(fmtDate(c.at)) + '</div></div>';
    }).join('');
  }
  function kv(k, v) { return '<div class="osl-kv"><span>' + esc(k) + '</span><span>' + esc(v) + '</span></div>'; }

  function post(payload, done) {
    fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify(payload) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok) { alert('Could not save: ' + ((res.j && res.j.error) || 'error') + (res.j && res.j.error === 'Authentication required' ? '. Please sign in again.' : '')); return; }
        if (done) done(res.j);
      })
      .catch(function (e) { alert('Network error: ' + e.message); });
  }

  // ── Activation: load when the page is shown ───────────────
  function isActive() {
    var p = document.getElementById(PAGE_ID);
    return !!(p && (p.classList.contains('active') || window.location.hash === '#' + PAGE_ID));
  }
  function onMaybeActivate() {
    if (!els.body) return;
    if (isActive()) loadList();
  }

  function init() {
    injectStyles();
    buildShell();
    // Load now if already on the page; otherwise load when navigated to.
    if (isActive()) loadList();
    document.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest && e.target.closest('.nav-btn[data-page="' + PAGE_ID + '"]');
      if (btn) setTimeout(onMaybeActivate, 0);
    }, true);
    window.addEventListener('hashchange', function () { if (window.location.hash === '#' + PAGE_ID) onMaybeActivate(); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.overstockLookup = { reload: loadList };
})();
