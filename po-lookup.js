/* =========================================================
   po-lookup.js — Houston Control
   Rich inline PO investigation widget
   ========================================================= */
(function() {
  'use strict';

  var API = '/.netlify/functions/po-lookup';

  function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, function(m){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m];
    });
  }

  function fmtTime(ts) {
    if (!ts) return '—';
    try {
      return new Date(ts).toLocaleString('en-US', { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' });
    } catch(_) { return String(ts); }
  }

  function qty(v) { return v != null ? Number(v).toLocaleString() : '—'; }

  var EVENT_LABELS = {
    po_added:         'PO added to pallet',
    po_removed:       'PO removed',
    po_edited:        'PO updated',
    po_recv_qty:      'Receiving count updated',
    po_recv_done:     'Receiving count marked done',
    po_unrecv:        'Receiving count reopened',
    po_routed:        'PO routed',
    po_unrouted:      'Routing cleared',
    po_transfer:      'PO transferred',
    po_prior_receipt: 'Partial continuation — prior shipment',
    po_partial:       'Marked partial — awaiting remainder',
    po_prep_qty:      'Prep count updated',
    po_prep_verified: 'Prep count marked done',
    advanced:         'Pallet advanced',
    pulled_back:      'Pallet pulled back',
    created:          'Pallet created',
  };

  var EVENT_COLORS = {
    po_added:'#185FA5', po_recv_done:'#1D9E75', po_prep_verified:'#1D9E75',
    po_routed:'#185FA5', po_transfer:'#7c3aed', po_prior_receipt:'#EF9F27',
    po_partial:'#EF9F27', po_removed:'#E24B4A', po_unrecv:'#E24B4A',
    po_unrouted:'#E24B4A', po_recv_qty:'#185FA5', po_prep_qty:'#185FA5',
    advanced:'#1D9E75', pulled_back:'#EF9F27',
  };

  var OS_HISTORY_COLORS = {
    added:'#185FA5', adjust_add:'#185FA5', adjust_remove:'#EF9F27',
    kept:'#1D9E75', moved:'#7c3aed', donated:'#E24B4A', released:'#1D9E75',
    deleted:'#E24B4A', pulled:'#EF9F27', undo:'#888',
  };

  function normPo(v) { return String(v == null ? '' : v).trim().toUpperCase(); }

  // Reads the client's synced overstock data so the lookup can trace POs that
  // only ever lived in the overstock workflow (e.g. manually-typed PO numbers),
  // which the backend doesn't know about. Returns { has, html }.
  function localOverstockTrace(query) {
    var st = (window.state && window.state.data) ? window.state.data : null;
    if (!st) return { has: false, html: '' };
    var q = normPo(query);
    var entries   = (st.overstockEntries   || []).filter(function(e){ return e && normPo(e.po) === q; });
    var donations = (st.overstockDonations || []).filter(function(d){ return d && normPo(d.po) === q; });
    var events    = (st.overstockHistory   || []).filter(function(ev){ return ev && normPo(ev.po) === q; });
    if (!entries.length && !donations.length && !events.length) return { has: false, html: '' };

    var totalNow = entries.reduce(function(s, e){ return s + (Number(e.quantity) || 0); }, 0);
    var html = '<div style="border:1px solid #f1c40f;border-radius:10px;overflow:hidden;margin-top:8px;background:#fffdf5;">';
    html += '<div style="display:flex;align-items:center;gap:10px;padding:11px 14px;background:#FEF9E7;border-bottom:1px solid #f6e3a0;">';
    html += '<span style="font-size:18px;">📦</span><div style="flex:1;min-width:0;">';
    html += '<span style="font-size:13px;font-weight:800;">Overstock trace — ' + esc(query) + '</span>';
    html += '<div style="font-size:11px;color:#7a5b16;">' + entries.length + ' active line' + (entries.length === 1 ? '' : 's') + ' · ' + qty(totalNow) + ' units · ' + events.length + ' logged event' + (events.length === 1 ? '' : 's') + '</div>';
    html += '</div></div><div style="padding:12px 14px;">';

    html += section('Where it is now');
    if (entries.length) {
      entries.forEach(function(e){
        var inBox = e.containerCode ? ('📦 ' + esc(e.containerCode)) : (e.action === 'Donated' ? 'Donated (out of box)' : 'No box');
        var loc = e.location ? (' · 📍 ' + esc(e.location)) : '';
        html += '<div style="font-size:12px;padding:5px 0;border-bottom:1px solid #f3e6c0;">' + inBox + loc + ' · ' + qty(e.quantity) + ' units · ' + esc(e.category || 'Uncategorized') + (e.action ? ' · <span style="color:#7a5b16;">' + esc(e.action) + '</span>' : '') + '</div>';
      });
    } else {
      html += '<div style="font-size:12px;color:#888;padding:4px 0;">Not currently in any box.</div>';
    }

    if (donations.length) {
      html += '<div style="height:8px;"></div>' + section('Donations');
      donations.forEach(function(d){
        html += '<div style="font-size:12px;padding:5px 0;border-bottom:1px solid #f3e6c0;">🎁 ' + qty(d.quantity) + ' units from ' + esc(d.containerCode || '—') + '<div style="font-size:10px;color:#888;">' + fmtTime(d.donatedAt) + (d.donatedBy ? ' · ' + esc(d.donatedBy) : '') + '</div></div>';
      });
    }

    // Build the timeline from logged events, and backfill from existing data
    // for actions that predate logging (so older POs still trace).
    var timeline = events.slice();
    var hasType = {};
    events.forEach(function(ev){ hasType[ev.action] = true; });
    if (!hasType.added) entries.forEach(function(e){
      timeline.push({ action: 'added', label: 'Logged to overstock' + (e.containerCode ? ' · box ' + e.containerCode : ''), ts: e.createdAt || 0, by: e.associate || '' });
    });
    if (!hasType.donated) donations.forEach(function(d){
      timeline.push({ action: 'donated', label: 'Donated' + (d.containerCode ? ' from ' + d.containerCode : ''), ts: d.donatedAt || 0, by: d.donatedBy || '' });
    });
    timeline.sort(function(a, b){ return (b.ts || 0) - (a.ts || 0); });

    if (timeline.length) {
      html += '<div style="height:8px;"></div>' + section('Full history (' + timeline.length + ')');
      html += '<div style="max-height:260px;overflow-y:auto;display:flex;flex-direction:column;gap:4px;">';
      timeline.forEach(function(ev){
        var col = OS_HISTORY_COLORS[ev.action] || '#888';
        html += '<div style="display:flex;gap:9px;font-size:12px;align-items:flex-start;">';
        html += '<div style="width:7px;height:7px;border-radius:50%;background:' + col + ';margin-top:4px;flex-shrink:0;"></div>';
        html += '<div style="flex:1;"><span style="font-weight:700;">' + esc(ev.label || ev.action) + '</span>';
        html += '<div style="font-size:10px;color:#888;margin-top:1px;">' + fmtTime(ev.ts) + (ev.by ? ' · ' + esc(ev.by) : '') + '</div></div></div>';
      });
      html += '</div>';
    }

    html += '</div></div>';
    return { has: true, html: html };
  }

  async function lookupPO(query) {
    var resultsEl = document.getElementById('poLookupResults');
    if (!resultsEl) return;
    query = (query || '').trim();
    if (!query) { resultsEl.innerHTML = ''; return; }
    resultsEl.innerHTML = '<div style="padding:10px 0;font-size:13px;color:var(--muted,#888);">Searching for ' + esc(query) + '…</div>';
    try {
      var res  = await fetch(API + '?po=' + encodeURIComponent(query));
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Lookup failed');
      var local;
      try { local = localOverstockTrace(query); } catch (_) { local = { has: false, html: '' }; }
      if (!data.found) {
        if (local.has) { resultsEl.innerHTML = local.html; return; }
        resultsEl.innerHTML = '<div style="padding:12px;border-radius:8px;background:var(--blue1,#f0f6ff);border:1px solid var(--blue2,#d0e4ff);font-size:13px;color:var(--muted,#888);">No records found for <strong>' + esc(query) + '</strong>. This PO has not been logged in the inbound workflow yet.</div>';
        return;
      }
      resultsEl.innerHTML = renderResult(data) + (local.has ? local.html : '');

      // Wire expand/collapse
      var head = document.getElementById('poResultHead');
      var body = document.getElementById('poResultBody');
      var chev = document.getElementById('poResultChevron');
      if (head && body) {
        head.addEventListener('click', function() {
          var open = body.style.display !== 'none';
          body.style.display = open ? 'none' : '';
          if (chev) chev.style.transform = open ? 'rotate(-90deg)' : '';
        });
      }
    } catch(err) {
      resultsEl.innerHTML = '<div style="padding:12px 0;color:#A32D2D;font-size:13px;">Error: ' + esc(err.message) + '</div>';
    }
  }

  function renderResult(data) {
    var s  = data.summary;
    var ev = data.events || [];
    var pd = data.palletData || [];
    var ppl = data.putawayPlacements || [];
    var ptl = data.putawayLines || [];
    var oc  = data.overstockContainers || [];

    // Status color
    var allStages = ['dock','receiving','prep','putaway'];
    var lastStage = 'dock';
    allStages.forEach(function(st){ if(s.stages[st]) lastStage = st; });
    var statusColor = lastStage === 'putaway' ? '#1D9E75'
                    : lastStage === 'prep'    ? '#185FA5'
                    : lastStage === 'receiving' ? '#7c3aed'
                    : '#888';
    var statusLabel = lastStage === 'putaway' ? (s.putawayComplete ? 'Putaway complete' : 'Putaway — pending locations')
                    : lastStage === 'prep'    ? 'In prep / completed prep'
                    : lastStage === 'receiving' ? 'Receiving done'
                    : 'Dock only';

    var html = '<div style="border:1px solid var(--blue2,#ddd);border-radius:10px;overflow:hidden;margin-top:8px;">';

    // ── Header row ─────────────────────────────────────────────
    html += '<div id="poResultHead" style="display:flex;align-items:center;gap:10px;padding:11px 14px;cursor:pointer;background:var(--card,#fff);">';
    html += '<div style="width:8px;height:8px;border-radius:50%;background:' + statusColor + ';flex-shrink:0;"></div>';
    html += '<div style="flex:1;min-width:0;">';
    html += '<span style="font-size:13px;font-weight:800;">' + esc(data.po) + '</span>';
    if (s.categories.length) html += '<span style="font-size:12px;color:var(--muted,#888);margin-left:8px;">' + esc(s.categories.join(', ')) + '</span>';
    if (s.palletLabels.length) html += '<span style="font-size:12px;color:var(--muted,#888);margin-left:8px;">· ' + esc(s.palletLabels.join(', ')) + '</span>';
    html += '</div>';
    html += '<span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:999px;background:' + statusColor + '22;color:' + statusColor + ';white-space:nowrap;">' + esc(statusLabel) + '</span>';
    if (s.isPartial) html += '<span style="font-size:11px;font-weight:700;padding:3px 8px;border-radius:999px;background:#FAEEDA;color:#633806;">Partial</span>';
    if (s.pendingPutaway && s.pendingPutaway.length) html += '<span style="font-size:11px;font-weight:700;padding:3px 8px;border-radius:999px;background:#FCEBEB;color:#791F1F;">Putaway pending</span>';
    html += '<span id="poResultChevron" style="font-size:10px;color:var(--muted,#888);transition:transform .18s;">▼</span>';
    html += '</div>';

    // ── Expanded body ──────────────────────────────────────────
    html += '<div id="poResultBody" style="border-top:1px solid var(--blue2,#eee);">';

    // Stage journey strip
    html += '<div style="display:flex;align-items:center;gap:0;padding:10px 16px;border-bottom:1px solid var(--blue2,#eee);background:var(--blue1,#f9fafb);">';
    allStages.forEach(function(st, i) {
      var done = s.stages[st];
      var isLast = st === lastStage && done;
      var col = done ? statusColor : 'var(--muted,#aaa)';
      html += '<div style="display:flex;align-items:center;gap:4px;">';
      html += '<div style="width:18px;height:18px;border-radius:50%;border:2px solid ' + col + ';background:' + (done?col:'transparent') + ';display:flex;align-items:center;justify-content:center;flex-shrink:0;">';
      if (done) html += '<svg width="8" height="6" viewBox="0 0 8 6"><path d="M1 3L3 5 7 1" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>';
      html += '</div>';
      html += '<span style="font-size:11px;font-weight:700;color:' + col + ';text-transform:capitalize;">' + st + '</span>';
      if (i < allStages.length - 1) html += '<div style="width:24px;height:1.5px;background:' + (done?col:'var(--blue2,#ddd)') + ';margin:0 4px;"></div>';
      html += '</div>';
    });
    html += '</div>';

    // Three columns
    html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0;border-bottom:1px solid var(--blue2,#eee);">';

    // Col 1: Quantities
    html += '<div style="padding:14px 16px;">';
    html += section('Quantities & routing');
    html += kv('Ordered',     qty(s.orderedQty)  + ' units');
    html += kv('Received',    qty(s.receivedQty) + ' units', s.receivedQty && s.orderedQty && Number(s.receivedQty) !== Number(s.orderedQty) ? '#854F0B' : '');
    html += kv('Prep count',  qty(s.prepQty)     + ' units');
    if (s.stsQty)  html += kv('→ STS', qty(s.stsQty) + ' units', '#0C447C');
    if (s.ltsQty)  html += kv('→ LTS', qty(s.ltsQty) + ' units', '#4338ca');
    if (s.overstockQty > 0) {
      html += kv('Overstock', '+' + qty(s.overstockQty) + ' units', '#854F0B');
      if (s.overstockContainerCode) html += kv('Boxed in', esc(s.overstockContainerCode), '#1D9E75');
      else html += kv('Boxed in', 'Not assigned', '#A32D2D');
    }
    if (s.isPartial) html += kv('Shipments', String(s.shipmentCount));
    html += '</div>';

    // Col 2: Pallet journey
    html += '<div style="padding:14px 16px;border-left:1px solid var(--blue2,#eee);">';
    html += section('Pallet journey');
    if (pd.length) {
      pd.forEach(function(p) {
        html += '<div style="margin-bottom:8px;padding:6px 10px;border-radius:7px;background:var(--blue1,#f9fafb);border:1px solid var(--blue2,#eee);">';
        html += '<div style="font-size:12px;font-weight:800;">' + esc(p.palletLabel) + '</div>';
        html += '<div style="font-size:11px;color:var(--muted,#888);">' + esc(p.palletDate || '') + (p.palletStatus ? ' · ' + esc(p.palletStatus) : '') + '</div>';
        var flags = [];
        if (p.receivingDone) flags.push('<span style="color:#1D9E75;">✓ Recv</span>');
        if (p.prepVerified)  flags.push('<span style="color:#1D9E75;">✓ Prep</span>');
        if (p.destination)   flags.push('<span style="color:#185FA5;">→ ' + esc(p.destination.toUpperCase()) + '</span>');
        if (flags.length) html += '<div style="font-size:11px;margin-top:3px;">' + flags.join(' &nbsp; ') + '</div>';
        html += '</div>';
      });
    } else if (s.palletLabels.length) {
      s.palletLabels.forEach(function(l){
        html += kv('Pallet', esc(l));
      });
    }
    if (s.transfers.length) {
      html += '<div style="font-size:11px;font-weight:800;color:var(--muted,#888);text-transform:uppercase;letter-spacing:.05em;margin-top:8px;margin-bottom:4px;">Transfers</div>';
      s.transfers.forEach(function(t) {
        html += '<div style="font-size:11px;color:var(--muted,#888);margin-bottom:2px;">↔ ' + esc(t.detail) + '<br><span style="font-size:10px;">' + fmtTime(t.ts) + (t.by ? ' · ' + esc(t.by) : '') + '</span></div>';
      });
    }
    html += kv('First seen', fmtTime(s.firstSeen));
    html += kv('Last activity', fmtTime(s.lastActivity));
    html += '</div>';

    // Col 3: Putaway & people
    html += '<div style="padding:14px 16px;border-left:1px solid var(--blue2,#eee);">';
    html += section('Putaway & people');
    html += kv('Worked by', esc(s.workers.join(', ') || '—'));
    html += kv('Mods / edits', String(s.modCount));

    if (ptl.length) {
      html += '<div style="font-size:11px;font-weight:800;color:var(--muted,#888);text-transform:uppercase;letter-spacing:.05em;margin-top:8px;margin-bottom:4px;">Putaway containers</div>';
      ptl.forEach(function(l) {
        var placements = ppl.filter(function(p){ return p.po_line_id === l.id; });
        html += '<div style="margin-bottom:6px;padding:6px 10px;border-radius:7px;background:var(--blue1,#f9fafb);border:1px solid var(--blue2,#eee);">';
        html += '<div style="font-size:11px;font-weight:800;">' + esc(l.container_code || l.pallet_label || '—') + '</div>';
        html += '<div style="font-size:11px;color:var(--muted,#888);">' + esc(l.category || '—') + (l.container_status ? ' · ' + esc(l.container_status) : '') + '</div>';
        if (placements.length) {
          placements.forEach(function(p) {
            html += '<div style="font-size:11px;color:#185FA5;margin-top:3px;">📍 ' + esc(p.location_code) + (p.placed_at ? ' · ' + fmtTime(p.placed_at) : '') + '</div>';
          });
        } else {
          html += '<div style="font-size:11px;color:#A32D2D;margin-top:3px;">📍 No location assigned yet</div>';
        }
        html += '</div>';
      });
    }

    if (oc.length) {
      html += '<div style="font-size:11px;font-weight:800;color:var(--muted,#888);text-transform:uppercase;letter-spacing:.05em;margin-top:8px;margin-bottom:4px;">Overstock containers</div>';
      oc.forEach(function(c) {
        html += '<div style="font-size:11px;margin-bottom:4px;padding:5px 8px;border-radius:6px;background:#FEF9E7;border:1px solid #F1C40F;">';
        html += '📦 <strong>' + esc(c.containerCode) + '</strong>';
        if (c.qty) html += ' · ' + qty(c.qty) + ' units';
        if (c.location) html += ' · 📍 ' + esc(c.location);
        else html += ' · <span style="color:#A32D2D;">no location</span>';
        html += ' · <span style="color:var(--muted,#888);">' + esc(c.status || '') + '</span></div>';
      });
    }
    html += '</div>';

    html += '</div>'; // end three col

    // Event trail
    if (ev.length) {
      html += '<div style="padding:12px 16px;background:var(--blue1,#f9fafb);">';
      html += '<div style="font-size:11px;font-weight:800;color:var(--muted,#888);text-transform:uppercase;letter-spacing:.07em;margin-bottom:10px;">Event trail (' + ev.length + ')</div>';
      html += '<div style="max-height:240px;overflow-y:auto;display:flex;flex-direction:column;gap:4px;">';
      ev.forEach(function(e) {
        var dot   = EVENT_COLORS[e.event_type] || '#888';
        var label = EVENT_LABELS[e.event_type] || e.event_type;
        html += '<div style="display:flex;gap:10px;font-size:12px;align-items:flex-start;">';
        html += '<div style="width:7px;height:7px;border-radius:50%;background:' + dot + ';margin-top:4px;flex-shrink:0;"></div>';
        html += '<div style="flex:1;">';
        html += '<span style="font-weight:700;">' + esc(label) + '</span>';
        if (e.detail) html += ' <span style="color:var(--muted,#888);">— ' + esc(e.detail) + '</span>';
        html += '<div style="font-size:10px;color:var(--muted,#888);margin-top:1px;">' + fmtTime(e.event_ts) + (e.by_user ? ' · ' + esc(e.by_user) : '') + (e.pallet_label ? ' · ' + esc(e.pallet_label) : '') + '</div>';
        html += '</div></div>';
      });
      html += '</div></div>';
    }

    html += '</div></div>';
    return html;
  }

  function section(t) {
    return '<div style="font-size:11px;font-weight:800;color:var(--muted,#888);text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px;">' + esc(t) + '</div>';
  }

  function kv(k, v, color) {
    return '<div style="display:flex;justify-content:space-between;gap:8px;font-size:12px;padding:2px 0;">' +
      '<span style="color:var(--muted,#888);">' + esc(k) + '</span>' +
      '<span style="font-weight:700;text-align:right;' + (color?'color:'+color+';':'') + '">' + v + '</span>' +
    '</div>';
  }

  function ensureResultsModal() {
    var modal = document.getElementById('poLookupModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'poLookupModal';
    modal.className = 'po-lookup-modal';
    modal.hidden = true;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'poLookupModalTitle');
    modal.innerHTML =
      '<div class="po-lookup-modal-dialog" role="document">' +
        '<div class="po-lookup-modal-header">' +
          '<div>' +
            '<div class="po-lookup-modal-eyebrow">PO Lookup</div>' +
            '<h2 id="poLookupModalTitle">PO details</h2>' +
          '</div>' +
          '<button type="button" class="po-lookup-modal-close" aria-label="Close">&times;</button>' +
        '</div>' +
        '<div class="po-lookup-modal-body" id="poLookupResults"></div>' +
      '</div>';
    document.body.appendChild(modal);

    // Close handlers
    function close() {
      modal.hidden = true;
      document.body.style.overflow = '';
    }
    modal.querySelector('.po-lookup-modal-close').addEventListener('click', close);
    modal.addEventListener('click', function(e) {
      if (e.target === modal) close();
    });
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && !modal.hidden) close();
    });
    return modal;
  }

  function openResultsModal(title) {
    var modal = ensureResultsModal();
    var titleEl = modal.querySelector('#poLookupModalTitle');
    if (titleEl) titleEl.textContent = title || 'PO details';
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function mount() {
    var widget = document.getElementById('poLookupWidget');
    if (!widget) return;
    widget.innerHTML =
      '<div class="inb-po-lookup-inner">' +
        '<i class="inb-po-search-ico" aria-hidden="true">⌕</i>' +
        '<input id="poLookupInput" type="text" placeholder="Lookup PO number…" autocomplete="off" />' +
        '<button id="poLookupBtn" type="button">Search</button>' +
        '<button id="poLookupClear" type="button" title="Clear">✕</button>' +
      '</div>';

    // Make sure the results modal exists in the DOM, ready to receive content
    ensureResultsModal();

    var input    = document.getElementById('poLookupInput');
    var btn      = document.getElementById('poLookupBtn');
    var clearBtn = document.getElementById('poLookupClear');

    btn.addEventListener('click', function() {
      var q = (input.value || '').trim();
      if (!q) return;
      openResultsModal('PO# ' + q);
      lookupPO(q);
    });
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        var q = (input.value || '').trim();
        if (!q) return;
        openResultsModal('PO# ' + q);
        lookupPO(q);
      }
    });
    clearBtn.addEventListener('click', function() {
      input.value = '';
      var results = document.getElementById('poLookupResults');
      if (results) results.innerHTML = '';
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }

  window.poLookup = { search: lookupPO };
})();
