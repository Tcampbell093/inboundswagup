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
      if (!data.found) {
        resultsEl.innerHTML = '<div style="padding:12px;border-radius:8px;background:var(--blue1,#f0f6ff);border:1px solid var(--blue2,#d0e4ff);font-size:13px;color:var(--muted,#888);">No records found for <strong>' + esc(query) + '</strong>. This PO has not been logged in the inbound workflow yet.</div>';
        return;
      }
      resultsEl.innerHTML = renderResult(data);

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

  function mount() {
    var widget = document.getElementById('poLookupWidget');
    if (!widget) return;
    widget.innerHTML =
      '<div style="background:var(--blue1,#f0f6ff);border:1px solid var(--blue2,#d0e4ff);border-radius:10px;padding:12px 14px;margin-bottom:14px;">' +
        '<div style="display:flex;gap:8px;align-items:center;">' +
          '<span style="font-size:12px;font-weight:800;color:var(--muted,#888);white-space:nowrap;">PO Lookup</span>' +
          '<input id="poLookupInput" type="text" placeholder="Enter PO number…" ' +
            'style="flex:1;padding:7px 12px;border-radius:8px;border:1px solid var(--blue2,#d0e4ff);background:var(--bg,#fff);color:var(--text,#111);font-size:13px;" />' +
          '<button id="poLookupBtn" style="padding:7px 16px;border-radius:8px;border:none;background:#185FA5;color:#fff;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap;">Search</button>' +
          '<button id="poLookupClear" style="padding:7px 12px;border-radius:8px;border:1px solid var(--blue2,#d0e4ff);background:none;font-size:13px;color:var(--muted,#888);cursor:pointer;">Clear</button>' +
        '</div>' +
        '<div id="poLookupResults" style="margin-top:10px;"></div>' +
      '</div>';

    var input    = document.getElementById('poLookupInput');
    var btn      = document.getElementById('poLookupBtn');
    var clearBtn = document.getElementById('poLookupClear');

    btn.addEventListener('click', function() { lookupPO(input.value); });
    input.addEventListener('keydown', function(e) { if (e.key === 'Enter') lookupPO(input.value); });
    clearBtn.addEventListener('click', function() {
      input.value = '';
      document.getElementById('poLookupResults').innerHTML = '';
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }

  window.poLookup = { search: lookupPO };
})();
