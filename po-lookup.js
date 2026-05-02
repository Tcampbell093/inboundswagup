/* =========================================================
   po-lookup.js — Houston Control
   Inline PO expander widget. Mounts wherever
   <div id="poLookupWidget"></div> exists.
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
      return new Date(ts).toLocaleString('en-US', {
        month:'short', day:'numeric',
        hour:'numeric', minute:'2-digit'
      });
    } catch(_) { return String(ts); }
  }

  var EVENT_LABELS = {
    po_added:         'PO added',
    po_removed:       'PO removed',
    po_edited:        'PO updated',
    po_received:      'PO marked received',
    po_unrecv:        'PO unmarked received',
    po_routed:        'PO routed',
    po_unrouted:      'PO destination cleared',
    po_transfer:      'PO transferred',
    po_prior_receipt: 'PO added — partial continuation',
    po_partial:       'PO marked partial — awaiting remainder',
  };

  var EVENT_COLORS = {
    po_added:         '#185FA5',
    po_received:      '#1D9E75',
    po_partial:       '#EF9F27',
    po_prior_receipt: '#EF9F27',
    po_edited:        '#7F77DD',
    po_removed:       '#E24B4A',
    po_routed:        '#185FA5',
    po_transfer:      '#185FA5',
    po_unrecv:        '#E24B4A',
    po_unrouted:      '#E24B4A',
  };

  // ── Main search function ────────────────────────────────────
  async function lookupPO(query) {
    var resultsEl = document.getElementById('poLookupResults');
    if (!resultsEl) return;

    query = (query || '').trim();
    if (!query) { resultsEl.innerHTML = ''; return; }

    resultsEl.innerHTML = renderLoading(query);

    try {
      var res  = await fetch(API + '?po=' + encodeURIComponent(query));
      var data = await res.json();

      if (!res.ok) throw new Error(data.error || 'Lookup failed');
      if (!data.found) {
        resultsEl.innerHTML = renderNotFound(query);
        return;
      }

      resultsEl.innerHTML = renderResult(data);
      // Wire expand/collapse
      var head = document.getElementById('poResultHead');
      var body = document.getElementById('poResultBody');
      if (head && body) {
        head.addEventListener('click', function() {
          var open = body.style.display !== 'none';
          body.style.display = open ? 'none' : '';
          var chev = document.getElementById('poResultChevron');
          if (chev) chev.style.transform = open ? 'rotate(-90deg)' : '';
        });
      }
    } catch(err) {
      resultsEl.innerHTML = '<div style="padding:12px 0;color:#A32D2D;font-size:13px;">Error: ' + esc(err.message) + '</div>';
    }
  }

  function renderLoading(query) {
    return '<div style="padding:12px 0;font-size:13px;color:var(--muted);">Searching for ' + esc(query) + '…</div>';
  }

  function renderNotFound(query) {
    return '<div style="padding:12px;border-radius:8px;background:var(--blue1);border:1px solid var(--blue2);font-size:13px;color:var(--muted);">' +
      'No records found for <strong>' + esc(query) + '</strong>. ' +
      'This PO has not been logged in the inbound workflow or putaway modules yet.' +
      '</div>';
  }

  function renderResult(data) {
    var s  = data.summary;
    var ev = data.events || [];
    var lines = data.lines || [];
    var placements = data.placements || [];
    var cases = data.caseEvents || [];

    // Status indicator
    var statusColor = s.isDone ? '#1D9E75' : s.isPartial ? '#EF9F27' : s.activeOnFloor ? '#185FA5' : '#888';
    var statusLabel = s.isDone ? 'Complete' : s.isPartial ? 'Partial receipt' : s.activeOnFloor ? 'Active on floor' : 'Inactive';
    var badgeBg     = s.isDone ? '#EAF3DE' : s.isPartial ? '#FAEEDA' : s.activeOnFloor ? '#E6F1FB' : 'var(--blue1)';
    var badgeColor  = s.isDone ? '#27500A' : s.isPartial ? '#633806' : s.activeOnFloor ? '#0C447C' : 'var(--muted)';

    var html = '';
    html += '<div style="border:1px solid var(--blue2);border-radius:10px;overflow:hidden;">';

    // ── Header row ────────────────────────────────────────────
    html += '<div id="poResultHead" style="display:flex;align-items:center;gap:10px;padding:11px 14px;cursor:pointer;background:var(--card);">';
    html += '<div style="width:8px;height:8px;border-radius:50%;background:' + statusColor + ';flex-shrink:0;"></div>';
    html += '<div style="flex:1;min-width:0;">';
    html += '<span style="font-size:13px;font-weight:800;">' + esc(data.po) + '</span>';
    if (s.categories.length) html += '<span style="font-size:12px;color:var(--muted);margin-left:8px;">' + esc(s.categories.join(', ')) + '</span>';
    if (s.palletLabels.length) html += '<span style="font-size:12px;color:var(--muted);margin-left:8px;">· Pallet ' + esc(s.palletLabels.join(', ')) + '</span>';
    html += '</div>';
    html += '<span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:999px;background:' + badgeBg + ';color:' + badgeColor + ';white-space:nowrap;">' + esc(statusLabel) + '</span>';
    if (cases.length) html += '<span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:999px;background:#FCEBEB;color:#791F1F;white-space:nowrap;">' + cases.length + ' case' + (cases.length>1?'s':'') + '</span>';
    html += '<span id="poResultChevron" style="font-size:11px;color:var(--muted);transition:transform .18s;">&#9660;</span>';
    html += '</div>';

    // ── Expanded body ─────────────────────────────────────────
    html += '<div id="poResultBody" style="border-top:1px solid var(--blue2);">';

    // Three-column breakdown
    html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0;border-bottom:1px solid var(--blue2);">';

    // Col 1: Receipt
    html += '<div style="padding:14px 16px;">';
    html += kv_section('Receipt');
    if (s.totalExpected) html += kv('Expected', Number(s.totalExpected).toLocaleString() + ' units');
    if (s.totalPlaced)   html += kv('Received', Number(s.totalPlaced).toLocaleString() + ' units', s.isDone?'#27500A':'');
    if (s.outstanding)   html += kv('Outstanding', Number(s.outstanding).toLocaleString() + ' units', '#854F0B');
    html += kv('Came in parts', s.isPartial ? 'Yes — ' + s.shipmentCount + ' shipments' : 'No');
    if (s.modCount) html += kv('Modifications', s.modCount + ' edit' + (s.modCount>1?'s':''));
    html += '</div>';

    // Col 2: Location
    html += '<div style="padding:14px 16px;border-left:1px solid var(--blue2);">';
    html += kv_section('Location & routing');
    if (s.palletLabels.length) html += kv('Pallet(s)', esc(s.palletLabels.join(', ')));
    if (s.destinations.length) html += kv('Routed to', esc(s.destinations.join(', ')));
    if (s.locationCodes.length) html += kv('Placed at', esc(s.locationCodes.slice(0,4).join(', ') + (s.locationCodes.length>4?' +more':'')));
    if (s.activeOnFloor) {
      var activeLabels = s.activePallets.map(function(p){ return p.label||p.id; }).join(', ');
      html += kv('Active on floor', activeLabels, '#185FA5');
    }
    if (s.firstSeen)    html += kv('First seen', fmtTime(s.firstSeen));
    if (s.lastActivity) html += kv('Last activity', fmtTime(s.lastActivity));
    html += '</div>';

    // Col 3: People & cases
    html += '<div style="padding:14px 16px;border-left:1px solid var(--blue2);">';
    html += kv_section('People & cases');
    if (s.workers.length) html += kv('Worked by', esc(s.workers.join(', ')));
    html += kv('Done?', s.isDone ? 'Yes' : 'No — ' + statusLabel, s.isDone ? '#27500A' : '#854F0B');
    if (cases.length) {
      html += '<div style="margin-top:8px;">';
      cases.slice(0, 3).forEach(function(c) {
        html += '<div style="font-size:12px;background:#FCEBEB;color:#791F1F;border-radius:6px;padding:5px 8px;margin-bottom:4px;">' +
          esc(c.detail || c.event_type) + (c.by_user ? ' · ' + esc(c.by_user) : '') + '</div>';
      });
      html += '</div>';
    } else {
      html += kv('Cases', 'None', '#27500A');
    }
    html += '</div>';

    html += '</div>'; // end three-col

    // Event trail
    if (ev.length) {
      html += '<div style="padding:12px 16px;background:var(--blue1);">';
      html += '<div style="font-size:11px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.07em;margin-bottom:10px;">Event trail (' + ev.length + ')</div>';
      html += '<div style="max-height:220px;overflow-y:auto;">';
      ev.forEach(function(e) {
        var dot   = EVENT_COLORS[e.event_type] || '#888';
        var label = EVENT_LABELS[e.event_type] || e.event_type;
        html += '<div style="display:flex;gap:10px;padding:5px 0;font-size:12px;align-items:flex-start;">';
        html += '<div style="width:7px;height:7px;border-radius:50%;background:' + dot + ';margin-top:4px;flex-shrink:0;"></div>';
        html += '<div style="flex:1;">';
        html += '<span style="font-weight:700;">' + esc(label) + '</span>';
        if (e.detail) html += ' <span style="color:var(--muted);">— ' + esc(e.detail) + '</span>';
        html += '<div style="font-size:11px;color:var(--muted);margin-top:1px;">' + fmtTime(e.event_ts) + (e.by_user ? ' · ' + esc(e.by_user) : '') + (e.pallet_label ? ' · Pallet ' + esc(e.pallet_label) : '') + '</div>';
        html += '</div></div>';
      });
      html += '</div></div>';
    }

    html += '</div>'; // end body
    html += '</div>'; // end card

    return html;
  }

  function kv_section(title) {
    return '<div style="font-size:11px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px;">' + esc(title) + '</div>';
  }

  function kv(k, v, color) {
    return '<div style="display:flex;justify-content:space-between;gap:8px;font-size:12px;padding:3px 0;">' +
      '<span style="color:var(--muted);">' + esc(k) + '</span>' +
      '<span style="font-weight:700;text-align:right;' + (color?'color:'+color+';':'') + '">' + v + '</span>' +
      '</div>';
  }

  // ── Init ───────────────────────────────────────────────────
  function mount() {
    var widget = document.getElementById('poLookupWidget');
    if (!widget) return;

    widget.innerHTML =
      '<div style="background:var(--blue1);border:1px solid var(--blue2);border-radius:10px;padding:12px 14px;margin-bottom:14px;">' +
        '<div style="display:flex;gap:8px;align-items:center;">' +
          '<span style="font-size:12px;font-weight:800;color:var(--muted);white-space:nowrap;">PO Lookup</span>' +
          '<input id="poLookupInput" type="text" placeholder="Enter PO number…" ' +
            'style="flex:1;padding:7px 12px;border-radius:8px;border:1px solid var(--blue2);background:var(--bg);color:var(--text);font-size:13px;" />' +
          '<button id="poLookupBtn" style="padding:7px 16px;border-radius:8px;border:none;background:#185FA5;color:#fff;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap;">Search</button>' +
          '<button id="poLookupClear" style="padding:7px 12px;border-radius:8px;border:1px solid var(--blue2);background:none;font-size:13px;color:var(--muted);cursor:pointer;">Clear</button>' +
        '</div>' +
        '<div id="poLookupResults" style="margin-top:10px;"></div>' +
      '</div>';

    var input   = document.getElementById('poLookupInput');
    var btn     = document.getElementById('poLookupBtn');
    var clearBtn= document.getElementById('poLookupClear');

    btn.addEventListener('click', function() {
      lookupPO(input.value);
    });
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') lookupPO(input.value);
    });
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
