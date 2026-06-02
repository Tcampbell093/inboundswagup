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
  // Per-section page tracking. Each section paginates independently so the
  // 25/50/100/All selector applies per-section, not across the full list.
  // Keys match _qStatus values plus 'urgent' (which is split out of
  // ready/pending in renderPage).
  var QCC_PAGES     = { ready:1, urgent:1, hold:1, pending:1, scheduled:1 };
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

  function fmtMoneyFull(n) {
    return '$' + Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
  }

  function rowRevenue(row) {
    if (!row) return 0;
    if (typeof getEffectiveSubtotalForRow === 'function') return Number(getEffectiveSubtotalForRow(row) || 0);
    return Number(row.revenue || row.subtotal || 0);
  }

  function selectedScheduleRows() {
    return Array.from(QCC_SELECTED).map(function(id) {
      return (window.availableQueueRows||[]).find(function(r){ return String(r.id)===String(id); }) ||
        (window.incompleteQueueRows||[]).find(function(r){ return String(r.id)===String(id); }) ||
        null;
    }).filter(Boolean);
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
        return rowRevenue(b) - rowRevenue(a);
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
    // Reset every section to page 1 on filter/search change
    QCC_PAGES = { ready:1, urgent:1, hold:1, pending:1, scheduled:1 };
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
  // Each section paginates independently. The page-size selector is applied
  // PER SECTION, not globally. Urgent rows are split out from ready/pending
  // into their own bucket. Section order: ready → urgent → hold → pending →
  // scheduled. Filter pills still hide entire sections; the urgent pill
  // shows only the urgent section.
  function renderPage() {
    var psRaw = (el('qccPageSize') || {}).value || '25';

    // Group the FULL filtered set by section. A ready/pending row with
    // isUrgent() === true is reclassified into the 'urgent' bucket so it
    // doesn't appear in both Ready and Urgent sections.
    var totalGroups = { ready:[], urgent:[], hold:[], pending:[], scheduled:[] };
    QCC_FILTERED.forEach(function(r) {
      var key = r._qStatus;
      if ((key === 'ready' || key === 'pending') && isUrgent(r)) key = 'urgent';
      if (totalGroups[key]) totalGroups[key].push(r);
    });

    // Filter pill controls which sections render at all.
    var order;
    if (QCC_FILTER === 'all') {
      order = ['ready','urgent','hold','pending','scheduled'];
    } else if (QCC_FILTER === 'urgent') {
      order = ['urgent'];
    } else {
      order = [QCC_FILTER];
    }

    var STATUS_LABEL = { scheduled:'Scheduled', hold:'On hold', ready:'Ready to schedule', pending:'Pending / incomplete', urgent:'Urgent (IHD ≤ 2 days)' };
    var STATUS_COLOR = { scheduled:'#0C447C', hold:'#A32D2D', ready:'#27500A', pending:'#633806', urgent:'#A32D2D' };
    var STATUS_REV_COLOR = { scheduled:'#185FA5', hold:'#A32D2D', ready:'#0F6E56', pending:'#854F0B', urgent:'#A32D2D' };
    // Urgent rows get the badge of their original status (ready or pending),
    // not 'urgent' — the section header is enough to communicate urgency.
    var BADGE_CLS   = { ready:'qcc-b-r', hold:'qcc-b-h', scheduled:'qcc-b-s', pending:'qcc-b-p' };
    var BADGE_LABEL = { ready:'Ready', hold:'Hold', scheduled:'Sched', pending:'Pending' };

    var totalShownAcrossAll = 0;
    var html = '';
    order.forEach(function(st) {
      var rowsTotal = totalGroups[st] || [];
      if (!rowsTotal.length) return;

      // Per-section page math
      var ps = psRaw === 'all' ? rowsTotal.length : parseInt(psRaw);
      if (!ps || ps < 1) ps = 25;
      var totalInGroup = rowsTotal.length;
      var totalPages = Math.max(1, Math.ceil(totalInGroup / ps));
      var page = QCC_PAGES[st] || 1;
      if (page > totalPages) { page = 1; QCC_PAGES[st] = 1; }
      var start = (page - 1) * ps;
      var end   = Math.min(start + ps, totalInGroup);
      var rowsOnPage = rowsTotal.slice(start, end);
      totalShownAcrossAll += rowsOnPage.length;

      var collapsed = QCC_COLLAPSED[st];
      var groupRev  = rowsTotal.reduce(function(s,r){ return s + rowRevenue(r); }, 0);
      var col       = STATUS_COLOR[st] || 'var(--muted)';
      var revCol    = STATUS_REV_COLOR[st] || 'var(--muted)';

      // ── Section header ─────────────────────────────────────────
      html += '<div class="qcc-section-head" onclick="window.qcc.toggleSection(\'' + st + '\')">';
      html += '<span class="qcc-chevron' + (collapsed?' closed':'') + '" id="qcc-ch-' + st + '">&#9660;</span>';
      html += '<span class="qcc-section-label" style="color:' + col + '">' + STATUS_LABEL[st] + '</span>';
      // Show "X of Y" only if a page is hiding some rows in this section.
      var countText = (rowsOnPage.length < totalInGroup)
        ? (start + 1) + '–' + end + ' of ' + totalInGroup
        : String(totalInGroup);
      html += '<span class="qcc-section-count">' + countText + '</span>';
      if (groupRev > 0) html += '<span class="qcc-section-rev" style="color:' + revCol + '">' + fmtRevTotal(groupRev) + '</span>';
      html += '</div>';

      // ── Rows + per-section pager ───────────────────────────────
      if (!collapsed) {
        rowsOnPage.forEach(function(r) {
          var sid  = String(r.id);
          // Urgent rows are still styled with their underlying severity
          var rowCls = 'qcc-row' + (st === 'urgent' ? ' qcc-urgent' :
                                    r._qStatus==='hold' ? ' qcc-hold-r' :
                                    r._qStatus==='pending' ? ' qcc-warn' : '')
                                 + (QCC_SELECTED.has(sid)?' qcc-sel':'');
          var initials = getInitials(r);
          var rev = rowRevenue(r);
          var cbKey = esc(r.pbId || r.so || '');
          var issue = r.issueType || r.holdNote || '';

          html += '<div class="' + rowCls + '" data-id="' + esc(sid) + '" data-cbkey="' + cbKey + '">';
          if (r._qStatus === 'ready' || r._qStatus === 'pending') {
            html += '<div class="qcc-chk' + (QCC_SELECTED.has(sid)?' on':'') + '" onclick="event.stopPropagation();window.qcc.toggleSelect(\'' + esc(sid) + '\')"></div>';
          } else {
            html += '<div class="qcc-chk qcc-chk-disabled"></div>';
          }
          html += '<div class="qcc-av">' + esc(initials) + '</div>';
          html += '<div style="flex:1;min-width:0;">';
          html += '<div class="qcc-pb">' + (typeof window.renderPbLink === 'function' ? window.renderPbLink(r.pb || r.so || '—', r.pbId, r.pdfUrl) : esc(r.pb || r.so || '—')) + (r.priority ? ' &#11088;' : '') + '</div>';
          html += '<div class="qcc-info">' + esc(r.account || '—') + (r.units ? ' &nbsp;·&nbsp; ' + Number(r.units).toLocaleString() + 'u' : '') + (r.so ? ' &nbsp;·&nbsp; ' + esc(r.so) : '') + (issue ? ' &nbsp;·&nbsp; <span style="color:#A32D2D">' + esc(issue) + '</span>' : '') + (r.scheduledFor ? ' &nbsp;·&nbsp; <span style="color:#0C447C">Sched: ' + esc(r.scheduledFor) + '</span>' : '') + '</div>';
          html += '</div>';
          html += '<div style="min-width:60px;text-align:right;font-size:11px;">' + fmtIhd(r) + '</div>';
          html += '<div style="min-width:48px;text-align:right;font-size:11px;color:var(--muted);">' + fmtRev(rev) + '</div>';
          // Badge reflects the underlying status, not 'urgent'
          var badgeKey = r._qStatus;
          html += '<span class="qcc-badge ' + (BADGE_CLS[badgeKey]||'qcc-b-p') + '">' + (BADGE_LABEL[badgeKey]||badgeKey) + '</span>';

          // Action buttons
          var link = typeof buildSalesforcePbLink === 'function' ? buildSalesforcePbLink(r.pbId, r.pdfUrl) : '';
          if (r._qStatus === 'ready') {
            html += '<button class="qcc-act" onclick="event.stopPropagation();scheduleQueueRow(\'' + esc(String(r.id)) + '\',\'ready\')">Schedule</button>';
            html += '<button class="qcc-act" onclick="event.stopPropagation();openIssueHoldModal(\'' + esc(String(r.id)) + '\',\'ready\')" style="color:#791F1F;">Hold</button>';
          } else if (r._qStatus === 'pending') {
            html += '<button class="qcc-act" onclick="event.stopPropagation();scheduleQueueRow(\'' + esc(String(r.id)) + '\',\'incomplete\')">Schedule</button>';
            html += '<button class="qcc-act" onclick="event.stopPropagation();openIssueHoldModal(\'' + esc(String(r.id)) + '\',\'incomplete\')" style="color:#791F1F;">Hold</button>';
          } else if (r._qStatus === 'scheduled') {
            html += '<button class="qcc-act" onclick="event.stopPropagation();viewScheduledInAssembly(\'' + esc(String(r.id)) + '\')">In Assembly</button>';
            html += '<button class="qcc-act" onclick="event.stopPropagation();openIssueHoldModal(\'' + esc(String(r.id)) + '\',\'scheduled\')" style="color:#791F1F;">Hold</button>';
            html += '<button class="qcc-act" onclick="event.stopPropagation();unscheduleQueueRow(\'' + esc(String(r.id)) + '\')" style="color:#e74c3c;">Unschedule</button>';
          } else if (r._qStatus === 'hold') {
            html += '<button class="qcc-act" onclick="event.stopPropagation();releaseIssueHoldRow(\'' + esc(String(r.id)) + '\')" style="color:#1A6B2A;">Release</button>';
          }
          if (link) {
            html += '<a class="qcc-act" href="' + esc(link) + '" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation();" style="text-decoration:none;">SF &#8599;</a>';
          }

          // Comment badge
          html += '<span class="cb-cell cb-badge cb-loading" data-cbkey="' + cbKey + '" style="cursor:pointer;flex-shrink:0;"></span>';

          html += '</div>';
        });

        // Per-section pager — only render when this section has multiple pages
        if (totalPages > 1 && psRaw !== 'all') {
          html += '<div class="qcc-section-pager" style="display:flex;align-items:center;justify-content:flex-end;gap:4px;padding:8px 14px 14px;border-bottom:1px solid var(--border);">';
          html += '<span style="font-size:11px;color:var(--muted);margin-right:6px;">Page ' + page + ' of ' + totalPages + '</span>';
          html += '<button class="qcc-pager-btn" onclick="window.qcc.goPage(\'' + st + '\',' + (page-1) + ')"' + (page<=1?' disabled':'') + '>&#8592;</button>';
          for (var p = 1; p <= totalPages; p++) {
            if (totalPages > 7 && p > 3 && p < totalPages - 2 && Math.abs(p - page) > 1) {
              if (p === 4 || p === totalPages - 3) html += '<span style="padding:0 4px;color:var(--muted)">…</span>';
              continue;
            }
            html += '<button class="qcc-pager-btn' + (p===page?' on':'') + '" onclick="window.qcc.goPage(\'' + st + '\',' + p + ')">' + p + '</button>';
          }
          html += '<button class="qcc-pager-btn" onclick="window.qcc.goPage(\'' + st + '\',' + (page+1) + ')"' + (page>=totalPages?' disabled':'') + '>&#8594;</button>';
          html += '</div>';
        }
      }
    });

    var listEl = el('qccList');
    if (listEl) listEl.innerHTML = html || '<div style="text-align:center;padding:32px;color:var(--muted);font-size:13px;">No builders match this filter.</div>';

    // Wire comment badges after render
    if (typeof renderAssemblyCommentBadges === 'function') {
      setTimeout(renderAssemblyCommentBadges, 100);
    }

    // The global pager at the bottom is no longer used — clear it. Per-section
    // pagers live inside each section now.
    var infoEl = el('qccPagerInfo');
    if (infoEl) infoEl.textContent = '';
    var btnsEl = el('qccPagerBtns');
    if (btnsEl) btnsEl.innerHTML = '';
  }

  // ── Stats bar ────────────────────────────────────────────────
  function updateStats() {
    var all      = getAllRows();
    var ready    = all.filter(function(r){ return r._qStatus==='ready'; });
    var hold     = all.filter(function(r){ return r._qStatus==='hold'; });
    var pending  = all.filter(function(r){ return r._qStatus==='pending'; });
    var scheduled= all.filter(function(r){ return r._qStatus==='scheduled'; });
    var readyRev = ready.reduce(function(s,r){ return s+rowRevenue(r); }, 0);
    var pendingRev = pending.reduce(function(s,r){ return s+rowRevenue(r); }, 0);
    var scheduledRev = scheduled.reduce(function(s,r){ return s+rowRevenue(r); }, 0);
    var holdRev = hold.reduce(function(s,r){ return s+rowRevenue(r); }, 0);
    var totalRev = readyRev + pendingRev + scheduledRev + holdRev;
    var nextIhd  = ready.concat(all.filter(isUrgent)).sort(function(a,b){
      var ai = typeof getEffectiveIhdForRow==='function'?getEffectiveIhdForRow(a):(a.ihd||'');
      var bi = typeof getEffectiveIhdForRow==='function'?getEffectiveIhdForRow(b):(b.ihd||'');
      return (ai||'zzz').localeCompare(bi||'zzz');
    })[0];

    var setN = function(id, val) { var e=el(id); if(e) e.textContent=val; };
    setN('qccTotal', all.length.toLocaleString());
    setN('qccReady', ready.length);
    setN('qccHold',  hold.length);
    setN('qccRev',   fmtRevTotal(totalRev) || '$0');
    setN('qccReadyRev', fmtRevTotal(readyRev) || '$0');
    setN('qccPendingRev', fmtRevTotal(pendingRev) || '$0');
    setN('qccScheduledRev', fmtRevTotal(scheduledRev) || '$0');
    setN('qccHoldRev', fmtRevTotal(holdRev) || '$0');
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
    var sid = String(id);
    if (QCC_SELECTED.has(sid)) QCC_SELECTED.delete(sid);
    else QCC_SELECTED.add(sid);

    // Update just the affected row in-place — no full re-render to prevent layout shift
    var row = document.querySelector('.qcc-row[data-id="' + sid + '"]');
    if (row) {
      var chk = row.querySelector('.qcc-chk');
      var isNowSelected = QCC_SELECTED.has(sid);
      if (chk) chk.classList.toggle('on', isNowSelected);
      row.classList.toggle('qcc-sel', isNowSelected);
    }

    updateBulkBar();
  }

  function clearSelection() {
    QCC_SELECTED.clear();
    // Also close bulk modal if open
    if (typeof window.closeBulkScheduleModal === 'function') window.closeBulkScheduleModal();
    renderPage();
    updateBulkBar();
  }

  function updateBulkBar() {
    var bar = el('qccBulkBar');
    var cnt = el('qccBulkCount');
    var val = el('qccBulkValue');
    if (!bar) return;
    if (QCC_SELECTED.size > 0) {
      var selectedRows = selectedScheduleRows();
      var selectedRevenue = selectedRows.reduce(function(s,r){ return s + rowRevenue(r); }, 0);
      bar.style.display = 'flex';
      if (cnt) cnt.textContent = QCC_SELECTED.size + ' builder' + (QCC_SELECTED.size>1?'s':'') + ' selected';
      if (val) val.textContent = selectedRows.length
        ? fmtMoneyFull(selectedRevenue) + ' schedule value'
        : 'Select ready or pending builders to schedule';
    } else {
      bar.style.display = 'none';
    }
  }

  function bulkSchedule() {
    var ids = Array.from(QCC_SELECTED);
    if (!ids.length) return;

    // Build items array for bulk modal
    var items = [];
    ids.forEach(function(id) {
      var readyRow   = (window.availableQueueRows||[]).find(function(r){ return String(r.id)===String(id); });
      var pendingRow = (window.incompleteQueueRows||[]).find(function(r){ return String(r.id)===String(id); });
      if (readyRow)   items.push({ id: String(id), source: 'ready' });
      else if (pendingRow) items.push({ id: String(id), source: 'incomplete' });
    });

    if (!items.length) return;

    // Single PB — use existing single modal
    if (items.length === 1) {
      scheduleQueueRow(items[0].id, items[0].source);
      QCC_SELECTED.clear();
      updateBulkBar();
      return;
    }

    // Multiple PBs — open bulk modal
    if (typeof window.openBulkScheduleModal === 'function') {
      // Patch confirmBulkSchedule to clear selection + refresh QCC after confirming
      var origConfirm = window.confirmBulkSchedule;
      window.confirmBulkSchedule = function() {
        origConfirm();
        QCC_SELECTED.clear();
        updateBulkBar();
        applyFilters();
        window.confirmBulkSchedule = origConfirm; // restore
      };
      window.openBulkScheduleModal(items);
      // Do NOT clear QCC_SELECTED here — only clear on confirm or explicit cancel
    }
  }

  // ── Collapsible sections ────────────────────────────────────
  function toggleSection(st) {
    QCC_COLLAPSED[st] = !QCC_COLLAPSED[st];
    renderPage();
  }

  // ── Pagination (per section) ─────────────────────────────────
  function goPage(section, p) {
    if (!section || typeof section !== 'string') return;
    if (!QCC_PAGES.hasOwnProperty(section)) return;
    p = parseInt(p, 10);
    if (!p || p < 1) return;
    QCC_PAGES[section] = p;
    renderPage();
    // Don't auto-scroll on pagination — staying in context is more useful
    // than jumping to the top of the list when paging mid-screen.
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

  // ── Hook into renderQueue (now exported on window by queue.js) ─
  function hookRenderQueue() {
    if (typeof window.renderQueue !== 'function') {
      setTimeout(hookRenderQueue, 200);
      return;
    }
    var orig = window.renderQueue;
    window.renderQueue = function() {
      orig.apply(this, arguments);
      applyFilters();
    };
    // Also patch renderIssueHoldSection if it exists
    if (typeof window.renderIssueHoldSection === 'function') {
      var origHold = window.renderIssueHoldSection;
      window.renderIssueHoldSection = function() {
        origHold.apply(this, arguments);
        applyFilters();
      };
    }
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
