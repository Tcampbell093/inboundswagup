/* =========================================================
   queue-command-center.js — Houston Control
   Command Center UI layer on top of queue.js data.
   Reads: availableQueueRows, incompleteQueueRows,
          scheduledQueueRows, issueHoldQueueRows
   Calls: scheduleQueueRow, unscheduleQueueRow,
          openIssueHoldModal, viewScheduledInAssembly,
          toggleQueuePriority, buildSalesforcePbLink,
          getEffectiveIhdForRow, renderQueueFlags
   ========================================================= */
(function() {
  'use strict';

  var QCC_COLLAPSED = {};
  var QCC_SELECTED  = new Set();
  var QCC_FILTER    = 'all';
  var QCC_PAGE      = 1;
  var QCC_FILTERED  = [];

  function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, function(m) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m];
    });
  }

  function el(id) { return document.getElementById(id); }

  // ── Get all rows with unified status ────────────────────────
  function getAllRows() {
    var rows = [];
    (window.availableQueueRows   || []).forEach(function(r) { rows.push(Object.assign({}, r, {_qStatus:'ready'})); });
    (window.incompleteQueueRows  || []).forEach(function(r) { rows.push(Object.assign({}, r, {_qStatus:'pending'})); });
    (window.scheduledQueueRows   || []).forEach(function(r) { rows.push(Object.assign({}, r, {_qStatus:'scheduled'})); });
    (window.issueHoldQueueRows   || []).forEach(function(r) { rows.push(Object.assign({}, r, {_qStatus:'hold'})); });
    return rows;
  }

  function isUrgent(row) {
    if (row._qStatus === 'scheduled' || row._qStatus === 'hold') return false;
    var ihd = typeof getEffectiveIhdForRow === 'function' ? getEffectiveIhdForRow(row) : (row.ihd || '');
    if (!ihd) return false;
    var diff = (new Date(ihd + 'T00:00:00') - new Date()) / 86400000;
    return diff < 2;
  }

  function fmtIhd(row) {
    var ihd = typeof getEffectiveIhdForRow === 'function' ? getEffectiveIhdForRow(row) : (row.ihd || '');
    if (!ihd) return '<span style="color:var(--muted)">—</span>';
    var d = new Date(ihd + 'T00:00:00');
    if (isNaN(d)) return esc(ihd);
    var diff = Math.round((d - new Date()) / 86400000);
    var label = d.toLocaleDateString('en-US', {month:'short', day:'numeric'});
    if (diff < 0)  return '<span style="color:#A32D2D;font-weight:800;">' + label + '</span>';
    if (diff <= 2) return '<span style="color:#854F0B;font-weight:800;">' + label + '</span>';
    return '<span style="color:var(--muted)">' + label + '</span>';
  }

  function fmtRev(n) {
    var v = Number(n || 0);
    if (v >= 1000000) return '$' + (v/1000000).toFixed(1) + 'M';
    if (v >= 1000)    return '$' + Math.round(v/1000) + 'k';
    return v > 0 ? '$' + v : '—';
  }

  function fmtRevTotal(n) {
    var v = Number(n || 0);
    if (v >= 1000000) return '$' + (v/1000000).toFixed(1) + 'M';
    if (v >= 1000)    return '$' + Math.round(v/1000) + 'k';
    return v > 0 ? '$' + Math.round(v) : '';
  }

  function getInitials(row) {
    var acc = row.account || row.pb || '?';
    return acc.trim().split(/\s+/).slice(0,2).map(function(w){ return w[0]||''; }).join('').toUpperCase() || '?';
  }

  // ── Sorting ──────────────────────────────────────────────────
  function sortRows(rows) {
    var s = (el('qccSort') || {}).value || 'ihd';
    return rows.slice().sort(function(a, b) {
      if (s === 'rev') {
        return Number(b.revenue || b.subtotal || 0) - Number(a.revenue || a.subtotal || 0);
      }
      if (s === 'units') {
        return Number(b.units || 0) - Number(a.units || 0);
      }
      if (s === 'acc') {
        return String(a.account || '').localeCompare(String(b.account || ''));
      }
      if (s === 'pb') {
        return String(a.pb || '').localeCompare(String(b.pb || ''));
      }
      // default: ihd
      var ai = typeof getEffectiveIhdForRow === 'function' ? getEffectiveIhdForRow(a) : (a.ihd || '');
      var bi = typeof getEffectiveIhdForRow === 'function' ? getEffectiveIhdForRow(b) : (b.ihd || '');
      if (!ai && !bi) return 0;
      if (!ai) return 1;
      if (!bi) return -1;
      return ai.localeCompare(bi);
    });
  }

  // ── Filter + render ──────────────────────────────────────────
  function applyFilters() {
    var q = ((el('qccSearch') || {}).value || '').toLowerCase();
    var f = QCC_FILTER;
    var all = getAllRows();

    QCC_FILTERED = all.filter(function(r) {
      if (f === 'ready'     && r._qStatus !== 'ready')     return false;
      if (f === 'hold'      && r._qStatus !== 'hold')      return false;
      if (f === 'pending'   && r._qStatus !== 'pending')   return false;
      if (f === 'scheduled' && r._qStatus !== 'scheduled') return false;
      if (f === 'urgent'    && !isUrgent(r))               return false;
      if (q) {
        var haystack = [r.pb, r.so, r.account, r.accountOwner, r.status, r.issueType, r.holdNote]
          .map(function(x){ return String(x||'').toLowerCase(); }).join(' ');
        if (!haystack.includes(q)) return false;
      }
      return true;
    });

    QCC_FILTERED = sortRows(QCC_FILTERED);
    QCC_PAGE = 1;
    QCC_SELECTED.clear();

    var matchEl = el('qccMatchCount');
    if (matchEl) matchEl.textContent = QCC_FILTERED.length.toLocaleString() + ' builders';

    renderPage();
    updateStats();
    updateBulkBar();
  }

  function setFilter(f) {
    QCC_FILTER = f;
    document.querySelectorAll('.qcc-pill').forEach(function(b) {
      b.classList.toggle('qcc-pill-on', b.getAttribute('data-f') === f);
    });
    applyFilters();
  }

  // ── Page render ──────────────────────────────────────────────
  function renderPage() {
    var psRaw = (el('qccPageSize') || {}).value || '25';
    var ps    = psRaw === 'all' ? QCC_FILTERED.length : parseInt(psRaw);
    var total = QCC_FILTERED.length;
    var totalPages = Math.max(1, Math.ceil(total / ps));
    if (QCC_PAGE > totalPages) QCC_PAGE = 1;
    var start = (QCC_PAGE - 1) * ps;
    var end   = Math.min(start + ps, total);
    var slice = QCC_FILTERED.slice(start, end);

    // Group by status — section order: scheduled, hold, ready, pending
    var groups = { scheduled:[], hold:[], ready:[], pending:[] };
    slice.forEach(function(r) { if (groups[r._qStatus]) groups[r._qStatus].push(r); });
    var order = QCC_FILTER !== 'all' ? [QCC_FILTER] : ['scheduled','hold','ready','pending'];

    var STATUS_LABEL = { scheduled:'Scheduled', hold:'On hold', ready:'Ready to schedule', pending:'Pending / incomplete' };
    var STATUS_COLOR = { scheduled:'#0C447C', hold:'#A32D2D', ready:'#27500A', pending:'#633806' };
    var STATUS_REV_COLOR = { scheduled:'#185FA5', hold:'#A32D2D', ready:'#0F6E56', pending:'#854F0B' };
    var BADGE_CLS   = { ready:'qcc-b-r', hold:'qcc-b-h', scheduled:'qcc-b-s', pending:'qcc-b-p' };
    var BADGE_LABEL = { ready:'Ready', hold:'Hold', scheduled:'Sched', pending:'Pending' };
    var ACTION_LBL  = { ready:'Schedule', hold:'Resolve', scheduled:'View', pending:'Details' };

    var html = '';
    order.forEach(function(st) {
      var rows = groups[st];
      if (!rows || !rows.length) return;
      var collapsed = QCC_COLLAPSED[st];
      var groupRev  = rows.reduce(function(s,r){ return s + Number(r.revenue || r.subtotal || 0); }, 0);
      var col       = STATUS_COLOR[st] || 'var(--muted)';
      var revCol    = STATUS_REV_COLOR[st] || 'var(--muted)';

      html += '<div class="qcc-section-head" onclick="window.qcc.toggleSection(\'' + st + '\')">';
      html += '<span class="qcc-chevron' + (collapsed?' closed':'') + '" id="qcc-ch-' + st + '">&#9660;</span>';
      html += '<span class="qcc-section-label" style="color:' + col + '">' + STATUS_LABEL[st] + '</span>';
      html += '<span class="qcc-section-count">' + rows.length + '</span>';
      if (groupRev > 0) html += '<span class="qcc-section-rev" style="color:' + revCol + '">' + fmtRevTotal(groupRev) + '</span>';
      html += '</div>';

      if (!collapsed) {
        rows.forEach(function(r) {
          var urg  = isUrgent(r);
          var rowCls = 'qcc-row' + (urg?' qcc-urgent':r._qStatus==='hold'?' qcc-hold-r':r._qStatus==='pending'?' qcc-warn':'') + (QCC_SELECTED.has(r.id)?' qcc-sel':'');
          var initials = getInitials(r);
          var rev = r.revenue || r.subtotal || 0;
          var cbKey = esc(r.pbId || r.so || '');
          var issue = r.issueType || r.holdNote || '';

          html += '<div class="' + rowCls + '" data-id="' + r.id + '" data-cbkey="' + cbKey + '">';
          html += '<div class="qcc-chk' + (QCC_SELECTED.has(r.id)?' on':'') + '" onclick="event.stopPropagation();window.qcc.toggleSelect(\'' + r.id + '\')"></div>';
          html += '<div class="qcc-av">' + esc(initials) + '</div>';
          html += '<div style="flex:1;min-width:0;">';
          html += '<div class="qcc-pb">' + esc(r.pb || r.so || '—') + (r.priority ? ' &#11088;' : '') + '</div>';
          html += '<div class="qcc-info">' + esc(r.account || '—') + (r.units ? ' &nbsp;·&nbsp; ' + Number(r.units).toLocaleString() + 'u' : '') + (r.so ? ' &nbsp;·&nbsp; ' + esc(r.so) : '') + (issue ? ' &nbsp;·&nbsp; <span style="color:#A32D2D">' + esc(issue) + '</span>' : '') + (r.scheduledFor ? ' &nbsp;·&nbsp; <span style="color:#0C447C">Sched: ' + esc(r.scheduledFor) + '</span>' : '') + '</div>';
          html += '</div>';
          html += '<div style="min-width:60px;text-align:right;font-size:11px;">' + fmtIhd(r) + '</div>';
          html += '<div style="min-width:48px;text-align:right;font-size:11px;color:var(--muted);">' + fmtRev(rev) + '</div>';
          html += '<span class="qcc-badge ' + (BADGE_CLS[r._qStatus]||'qcc-b-p') + '">' + (BADGE_LABEL[r._qStatus]||r._qStatus) + '</span>';

          // Action buttons
          if (r._qStatus === 'ready') {
            html += '<button class="qcc-act" onclick="event.stopPropagation();scheduleQueueRow(\'' + esc(String(r.id)) + '\',\'ready\')">Schedule</button>';
          } else if (r._qStatus === 'pending') {
            html += '<button class="qcc-act" onclick="event.stopPropagation();scheduleQueueRow(\'' + esc(String(r.id)) + '\',\'incomplete\')">Schedule</button>';
          } else if (r._qStatus === 'scheduled') {
            html += '<button class="qcc-act" onclick="event.stopPropagation();viewScheduledInAssembly(\'' + esc(String(r.id)) + '\')">In Assembly</button>';
            html += '<button class="qcc-act" onclick="event.stopPropagation();unscheduleQueueRow(\'' + esc(String(r.id)) + '\')" style="color:#e74c3c;">Unschedule</button>';
          } else if (r._qStatus === 'hold') {
            html += '<button class="qcc-act" onclick="event.stopPropagation();openIssueHoldModal(\'' + esc(String(r.id)) + '\',\'hold\')" style="color:#791F1F;">View hold</button>';
          }

          // Comment badge
          html += '<span class="cb-cell cb-badge cb-loading" data-cbkey="' + cbKey + '" style="cursor:pointer;flex-shrink:0;"></span>';

          html += '</div>';
        });
      }
    });

    var listEl = el('qccList');
    if (listEl) listEl.innerHTML = html || '<div style="text-align:center;padding:32px;color:var(--muted);font-size:13px;">No builders match this filter.</div>';

    // Wire comment badges after render
    if (typeof renderAssemblyCommentBadges === 'function') {
      setTimeout(renderAssemblyCommentBadges, 100);
    }

    // Pager
    var infoEl = el('qccPagerInfo');
    if (infoEl) infoEl.textContent = total ? 'Showing ' + (start+1) + '–' + end + ' of ' + total.toLocaleString() + ' builders' : '';

    var btnsEl = el('qccPagerBtns');
    if (btnsEl && psRaw !== 'all') {
      var btns = '<button class="qcc-pager-btn" onclick="window.qcc.goPage(' + (QCC_PAGE-1) + ')"' + (QCC_PAGE<=1?' disabled':'') + '>&#8592;</button>';
      for (var p = 1; p <= totalPages; p++) {
        if (totalPages > 7 && p > 3 && p < totalPages - 2 && Math.abs(p - QCC_PAGE) > 1) {
          if (p === 4 || p === totalPages - 3) btns += '<span style="padding:0 4px;color:var(--muted)">…</span>';
          continue;
        }
        btns += '<button class="qcc-pager-btn' + (p===QCC_PAGE?' on':'') + '" onclick="window.qcc.goPage(' + p + ')">' + p + '</button>';
      }
      btns += '<button class="qcc-pager-btn" onclick="window.qcc.goPage(' + (QCC_PAGE+1) + ')"' + (QCC_PAGE>=totalPages?' disabled':'') + '>&#8594;</button>';
      btnsEl.innerHTML = btns;
    } else if (btnsEl) {
      btnsEl.innerHTML = '';
    }
  }

  // ── Stats bar ────────────────────────────────────────────────
  function updateStats() {
    var all      = getAllRows();
    var ready    = all.filter(function(r){ return r._qStatus==='ready'; });
    var hold     = all.filter(function(r){ return r._qStatus==='hold'; });
    var readyRev = ready.reduce(function(s,r){ return s+Number(r.revenue||r.subtotal||0); }, 0);
    var nextIhd  = ready.concat(all.filter(isUrgent)).sort(function(a,b){
      var ai = typeof getEffectiveIhdForRow==='function'?getEffectiveIhdForRow(a):(a.ihd||'');
      var bi = typeof getEffectiveIhdForRow==='function'?getEffectiveIhdForRow(b):(b.ihd||'');
      return (ai||'zzz').localeCompare(bi||'zzz');
    })[0];

    var setN = function(id, val) { var e=el(id); if(e) e.textContent=val; };
    setN('qccTotal', all.length.toLocaleString());
    setN('qccReady', ready.length);
    setN('qccHold',  hold.length);
    setN('qccRev',   fmtRevTotal(readyRev));
    setN('qccIhd',   nextIhd
      ? (function(){
          var i = typeof getEffectiveIhdForRow==='function'?getEffectiveIhdForRow(nextIhd):(nextIhd.ihd||'');
          if (!i) return '—';
          var d = new Date(i+'T00:00:00');
          return isNaN(d)?i:d.toLocaleDateString('en-US',{month:'short',day:'numeric'});
        })()
      : '—'
    );
  }

  // ── Selection ────────────────────────────────────────────────
  function toggleSelect(id) {
    if (QCC_SELECTED.has(id)) QCC_SELECTED.delete(id);
    else QCC_SELECTED.add(id);
    renderPage();
    updateBulkBar();
  }

  function clearSelection() {
    QCC_SELECTED.clear();
    renderPage();
    updateBulkBar();
  }

  function updateBulkBar() {
    var bar = el('qccBulkBar');
    var cnt = el('qccBulkCount');
    if (!bar) return;
    if (QCC_SELECTED.size > 0) {
      bar.style.display = 'flex';
      if (cnt) cnt.textContent = QCC_SELECTED.size + ' builder' + (QCC_SELECTED.size>1?'s':'') + ' selected';
    } else {
      bar.style.display = 'none';
    }
  }

  function bulkSchedule() {
    var ids = Array.from(QCC_SELECTED);
    if (!ids.length) return;
    var count = 0;
    ids.forEach(function(id) {
      // Find which pool this row is in
      var readyRow    = (window.availableQueueRows||[]).find(function(r){ return String(r.id)===String(id); });
      var pendingRow  = (window.incompleteQueueRows||[]).find(function(r){ return String(r.id)===String(id); });
      if (readyRow   && typeof scheduleQueueRow==='function') { scheduleQueueRow(String(id),'ready'); count++; }
      if (pendingRow && typeof scheduleQueueRow==='function') { scheduleQueueRow(String(id),'incomplete'); count++; }
    });
    QCC_SELECTED.clear();
    updateBulkBar();
    if (count > 0) applyFilters();
  }

  // ── Collapsible sections ────────────────────────────────────
  function toggleSection(st) {
    QCC_COLLAPSED[st] = !QCC_COLLAPSED[st];
    renderPage();
  }

  // ── Pagination ───────────────────────────────────────────────
  function goPage(p) {
    var psRaw = (el('qccPageSize')||{}).value || '25';
    var ps    = psRaw==='all' ? QCC_FILTERED.length : parseInt(psRaw);
    var total = QCC_FILTERED.length;
    var totalPages = Math.max(1, Math.ceil(total/ps));
    if (p < 1 || p > totalPages) return;
    QCC_PAGE = p;
    renderPage();
    var listEl = el('qccList');
    if (listEl) listEl.scrollIntoView({behavior:'smooth', block:'start'});
  }

  // ── Legacy toggle ────────────────────────────────────────────
  function initLegacyToggle() {
    var btn = el('qccLegacyToggle');
    if (!btn) return;
    btn.addEventListener('click', function() {
      var cc  = el('queueCommandCenter');
      var leg = el('queueLegacyView');
      if (!cc || !leg) return;
      var isLegacy = leg.style.display !== 'none';
      cc.style.display  = isLegacy ? '' : 'none';
      leg.style.display = isLegacy ? 'none' : '';
      btn.textContent   = isLegacy ? 'Legacy View' : 'New View';
    });
  }

  // ── Filter pill wiring ───────────────────────────────────────
  function initPills() {
    document.querySelectorAll('.qcc-pill').forEach(function(btn) {
      btn.addEventListener('click', function() {
        setFilter(btn.getAttribute('data-f'));
      });
    });
  }

  // ── Hook: watch hidden tbody for DOM changes → refresh UI ───
  function hookRenderQueue() {
    // Wait for the tbody element to exist
    var tbody = document.getElementById('queueTableBody');
    if (!tbody) { setTimeout(hookRenderQueue, 300); return; }

    var debounce = null;
    var observer = new MutationObserver(function() {
      clearTimeout(debounce);
      debounce = setTimeout(function() {
        applyFilters();
      }, 80);
    });
    observer.observe(tbody, { childList: true, subtree: true });

    // Also watch issueHoldQueueTableBody
    var holdTbody = document.getElementById('issueHoldQueueTableBody');
    if (holdTbody) observer.observe(holdTbody, { childList: true, subtree: true });

    // Initial render
    applyFilters();
  }

  // ── Init ─────────────────────────────────────────────────────
  function init() {
    initPills();
    initLegacyToggle();
    hookRenderQueue();
  }

  // ── Public API ───────────────────────────────────────────────
  window.qcc = {
    applyFilters: applyFilters,
    setFilter:    setFilter,
    toggleSection:toggleSection,
    toggleSelect: toggleSelect,
    clearSelection: clearSelection,
    bulkSchedule: bulkSchedule,
    goPage:       goPage,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
