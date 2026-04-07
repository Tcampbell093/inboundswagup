/* ================================================================
   CYCLE COUNT MODULE  —  cycle-count.js
   Houston Control Warehouse Operations Hub
   ================================================================ */

(function () {
  'use strict';

  /* ── Storage key ── */
  const CC_KEY = 'ops_hub_cycle_count_v1';

  /* ── Helpers ── */
  function ccId()       { return 'cc' + Math.random().toString(36).slice(2, 10); }
  function ccNow()      { return Date.now(); }
  function ccToday()    { return new Date().toISOString().slice(0, 10); }
  function ccEsc(v)     { return String(v || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function ccFmtDate(iso) {
    if (!iso) return '—';
    const [y,m,d] = iso.split('-');
    return `${parseInt(m,10)}/${parseInt(d,10)}/${y}`;
  }
  function ccFmtDT(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleString([], { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' });
  }
  function ccClone(o)   { return JSON.parse(JSON.stringify(o)); }

  /* ── Employee list from main app ── */
  function ccGetEmployees() {
    try {
      const raw = localStorage.getItem('ops_hub_employees_v1');
      if (raw) {
        const list = JSON.parse(raw);
        if (Array.isArray(list)) return list.filter(e => e.active !== false).map(e => e.name).filter(Boolean);
      }
    } catch(e) {}
    return ['Maria G.','Carmen R.','Linda T.','Rosa M.','Ana F.','Sandra K.','Patricia L.','Gloria H.'];
  }

  /* ── Location generator ── */
  let _allLocations = null;
  function ccAllLocations() {
    if (_allLocations) return _allLocations;
    const locs = [];
    const aisles = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    const levels = ['A','B','C','D','E'];
    for (const aisle of aisles) {
      for (let bay = 1; bay <= 13; bay++) {
        for (const level of levels) {
          locs.push(`${aisle}${bay}${level}1`);
          locs.push(`${aisle}${bay}${level}2`);
        }
      }
    }
    for (let i = 1; i <= 200; i++) {
      locs.push('EP' + String(i).padStart(3,'0'));
    }
    _allLocations = locs;
    return locs;
  }

  /* ── Scoped location list for a given assignment ──
     Returns only locations that fall within the assignment's area.
     - Assignment has aisle A, no bay  → all A* locations (A1A1, A1A2 … A13E2)
     - Assignment has aisle A, bay 1   → only A1* (A1A1, A1A2 … A1E2)
     - Assignment has aisle A, bay 1, level B → only A1B1, A1B2
     - EP assignment                   → EP001–EP200 + custom EP locs
     - No aisle (broad assignment)     → full list
  ── */
  function ccScopedLocations(assignment) {
    const all = [...ccAllLocations(), ...(ccData.settings.customLocations || [])];
    if (!assignment || !assignment.aisle) return all;

    const { aisle, bay, level, side, epStart, epEnd } = assignment;

    if (aisle === 'EP') {
      const epLocs = all.filter(l => l.startsWith('EP'));
      if (!epStart && !epEnd) return epLocs;
      const from = epStart ? parseInt(epStart.slice(2), 10) : 1;
      const to   = epEnd   ? parseInt(epEnd.slice(2),   10) : 200;
      return epLocs.filter(l => {
        const n = parseInt(l.slice(2), 10);
        return n >= from && n <= to;
      });
    }

    // Standard aisle: build prefix progressively
    let prefix = aisle;
    if (bay)   prefix += bay;
    if (level) prefix += level;
    if (side)  prefix += side;

    return all.filter(l => l.startsWith(prefix));
  }
  function ccDefaultSettings() {
    return {
      discrepancyReasons: [
        'Wrong pick','Item moved','System off','Associate miscount',
        'Return not processed','Found in another location','Other'
      ],
      dailyGoal: 95,
      customLocations: [],
    };
  }

  /* ── Load / save ── */
  function ccLoad() {
    try {
      const raw = localStorage.getItem(CC_KEY);
      if (raw) return JSON.parse(raw);
    } catch(e) {}
    return { assignments:[], counts:[], settings: ccDefaultSettings() };
  }
  function ccSave(data) {
    try { localStorage.setItem(CC_KEY, JSON.stringify(data)); } catch(e) {}
  }

  /* ── State ── */
  let ccData = ccLoad();
  if (!ccData.settings) ccData.settings = ccDefaultSettings();
  if (!Array.isArray(ccData.settings.discrepancyReasons)) ccData.settings.discrepancyReasons = ccDefaultSettings().discrepancyReasons;
  if (!ccData.settings.customLocations) ccData.settings.customLocations = [];
  if (!ccData.settings.dailyGoal) ccData.settings.dailyGoal = 95;

  let ccActiveName = localStorage.getItem('cc_active_name') || '';
  let ccActiveAssignmentId = null;
  let ccBatchRows = []; // [{id, sku, qty, note}]
  let ccActiveTab = 'my-work';


  /* ── Count-thread helpers ── */
  function ccEnsureAttemptBatches(countRec) {
    if (!countRec) return [];
    if (!Array.isArray(countRec.attemptBatches)) countRec.attemptBatches = [];
    if (!countRec.attemptBatches.length && Array.isArray(countRec.entries) && countRec.entries.length) {
      countRec.attemptBatches.push({
        id: countRec.id + '_orig',
        kind: 'original',
        assignmentId: countRec.assignmentId,
        associate: countRec.associate,
        date: countRec.date,
        submittedAt: countRec.submittedAt || ccNow(),
        entries: ccClone(countRec.entries),
      });
    }
    return countRec.attemptBatches;
  }
  function ccMakeAttemptBatch(assignRec, rows, kind) {
    return {
      id: ccId(),
      kind: kind || (assignRec.type === 'Recount' ? 'recount' : 'original'),
      assignmentId: assignRec.id,
      associate: assignRec.associate,
      date: assignRec.date,
      submittedAt: ccNow(),
      note: assignRec.note || '',
      entries: rows.map(r => ({
        id: ccId(),
        sku: String(r.sku).toUpperCase(),
        qty: Number(r.qty),
        location: String(r.location || '').toUpperCase(),
        note: r.note || '',
        enteredAt: ccNow(),
        enteredBy: ccActiveName,
      })),
    };
  }
  function ccGetRootCountForAssignment(assignRec) {
    if (!assignRec) return null;
    if (assignRec.recountOfCountId) return ccData.counts.find(c => c.id === assignRec.recountOfCountId) || null;
    return ccData.counts.find(c => c.assignmentId === assignRec.id) || null;
  }
  function ccGetAllEntries(countRec) {
    if (!countRec) return [];
    const batches = ccEnsureAttemptBatches(countRec);
    if (batches.length) return batches.flatMap(b => b.entries || []);
    return countRec.entries || [];
  }
  function ccGetLatestBatch(countRec) {
    const batches = ccEnsureAttemptBatches(countRec);
    return batches.length ? batches[batches.length - 1] : null;
  }
  function ccGetLatestTotal(countRec) {
    const batch = ccGetLatestBatch(countRec);
    const rows = batch ? (batch.entries || []) : (countRec?.entries || []);
    return rows.reduce((s, e) => s + (Number(e.qty) || 0), 0);
  }

  /* ── DOM refs ── */
  const page = document.getElementById('cycleCountPage');
  if (!page) return;

  /* ── Tabs ── */
  function ccSwitchTab(tab) {
    ccActiveTab = tab;
    page.querySelectorAll('.cc-tab').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
    page.querySelectorAll('.cc-panel').forEach(p => p.classList.toggle('active', p.dataset.panel === tab));
    if (tab === 'my-work') ccRenderMyWork();
    if (tab === 'assignments') ccRenderAssignments();
    if (tab === 'review') ccRenderReview();
    if (tab === 'history') ccRenderHistory();
    if (tab === 'kpi') ccRenderKPI();
    if (tab === 'settings') ccRenderSettings();
    ccUpdateTabBadges();
  }

  /* ── Tab badge counts ── */
  function ccUpdateTabBadges() {
    const pending = ccData.counts.filter(c => c.status === 'submitted').length;
    const recount = ccData.counts.filter(c => c.status === 'recount').length;
    const reviewBadge = page.querySelector('[data-tab="review"] .cc-tab-badge');
    if (reviewBadge) reviewBadge.textContent = pending + recount;

    const myWorkBadge = page.querySelector('[data-tab="my-work"] .cc-tab-badge');
    if (myWorkBadge && ccActiveName) {
      const mine = ccData.assignments.filter(a =>
        a.associate === ccActiveName &&
        (a.status === 'assigned' || a.status === 'inprogress')
      ).length;
      myWorkBadge.textContent = mine;
    }
  }

  /* ── Render Assignments tab (manager view) ── */
  function ccRenderAssignments() {
    const panel = page.querySelector('[data-panel="assignments"]');
    if (!panel) return;
    const today = ccToday();
    const todayItems = ccData.assignments.filter(a => a.date === today);
    const otherItems = ccData.assignments.filter(a => a.date !== today);

    panel.innerHTML = `
      <div class="cc-section-head">
        <div><h3>Assignments</h3><p>Manage and create daily count assignments for your team.</p></div>
        <button class="btn" type="button" id="ccOpenNewAssignBtn">+ New Assignment</button>
      </div>
      <div style="margin-bottom:10px">
        <span class="eyebrow" style="font-size:11px">Today — ${ccFmtDate(today)}</span>
      </div>
      <div class="cc-work-grid" id="ccAssignGrid">
        ${todayItems.length ? '' : '<div class="cc-empty"><div class="cc-empty-icon">📋</div><p>No assignments for today yet.</p></div>'}
        ${todayItems.map(a => ccAssignCard(a)).join('')}
      </div>
      ${otherItems.length ? `
        <div style="margin-top:20px;margin-bottom:10px"><span class="eyebrow" style="font-size:11px">Earlier / Other Dates</span></div>
        <div class="cc-work-grid">
          ${otherItems.map(a => ccAssignCard(a)).join('')}
        </div>` : ''}
    `;

    panel.querySelector('#ccOpenNewAssignBtn')?.addEventListener('click', () => ccOpenAssignModal());
    panel.querySelectorAll('.cc-work-card[data-aid]').forEach(card => {
      card.addEventListener('click', () => ccOpenAssignModal(card.dataset.aid));
    });
  }

  function ccAssignCard(a) {
    const statusClass = `cc-status-${a.status || 'assigned'}`;
    const statusLabel = { assigned:'Assigned', inprogress:'In Progress', submitted:'Submitted', confirmed:'Confirmed', discrepancy:'Discrepancy', recount:'Recount' }[a.status] || a.status;
    return `
      <div class="cc-work-card" data-aid="${ccEsc(a.id)}">
        <span class="cc-work-card-status ${statusClass}">${ccEsc(statusLabel)}</span>
        <div class="cc-work-card-area">${ccEsc(a.area || '—')}</div>
        <div class="cc-work-card-type">${ccEsc(a.type || 'Standard Count')}</div>
        <div class="cc-work-card-meta">
          <strong>${ccEsc(a.associate || 'Unassigned')}</strong><br>
          ${ccFmtDate(a.date)}&nbsp;·&nbsp;Due ${ccFmtDate(a.dueDate) || '—'}<br>
          <span class="cc-created-at">Created ${ccFmtDT(a.createdAt)}</span>${a.locationRange ? `<br><span class="cc-loc-range">${ccEsc(a.locationRange)}</span>` : ''}
        </div>
        <div class="cc-work-card-action">Edit →</div>
      </div>`;
  }

  /* ── Render My Work tab ── */
  function ccRenderMyWork() {
    const panel = page.querySelector('[data-panel="my-work"]');
    if (!panel) return;

    // ── Who bar ──
    const whoBar = document.createElement('div');
    whoBar.className = 'cc-who-bar';

    if (ccActiveName) {
      const cur = document.createElement('div');
      cur.className = 'cc-who-current';
      cur.innerHTML = `<div class="cc-who-avatar">${ccEsc(ccActiveName.charAt(0))}</div><span>${ccEsc(ccActiveName)}</span>`;
      const changeBtn = document.createElement('button');
      changeBtn.className = 'cc-who-change';
      changeBtn.type = 'button';
      changeBtn.textContent = 'Change';
      changeBtn.addEventListener('click', () => {
        ccActiveName = '';
        ccActiveAssignmentId = null;
        ccBatchRows = [];
        localStorage.removeItem('cc_active_name');
        ccRenderMyWork();
        ccUpdateTabBadges();
      });
      whoBar.appendChild(cur);
      whoBar.appendChild(changeBtn);
    } else {
      const lbl = document.createElement('span');
      lbl.className = 'cc-who-label';
      lbl.textContent = 'Who are you?';
      const sel = document.createElement('select');
      sel.className = 'cc-who-select';
      const blank = document.createElement('option');
      blank.value = ''; blank.textContent = '— Choose your name —';
      sel.appendChild(blank);
      ccGetEmployees().forEach(n => {
        const o = document.createElement('option');
        o.value = o.textContent = n;
        sel.appendChild(o);
      });
      const confirmBtn = document.createElement('button');
      confirmBtn.className = 'cc-who-confirm';
      confirmBtn.type = 'button';
      confirmBtn.textContent = 'This is me →';
      confirmBtn.addEventListener('click', () => {
        if (sel.value) {
          ccActiveName = sel.value;
          localStorage.setItem('cc_active_name', ccActiveName);
          ccRenderMyWork();
          ccUpdateTabBadges();
        }
      });
      whoBar.appendChild(lbl);
      whoBar.appendChild(sel);
      whoBar.appendChild(confirmBtn);
    }

    // ── Build full panel with createElement ──
    panel.innerHTML = '';
    panel.appendChild(whoBar);

    if (!ccActiveName) return;

    // ── Active count block (built with DOM, not innerHTML, so inputs persist) ──
    if (ccActiveAssignmentId) {
      panel.appendChild(ccBuildActiveBlock());
    }

    // ── Work cards ──
    const myWork = ccData.assignments.filter(a => a.associate === ccActiveName);
    const open   = myWork.filter(a => a.status === 'assigned' || a.status === 'inprogress');
    const done   = myWork.filter(a => a.status === 'submitted' || a.status === 'confirmed');

    if (!myWork.length) {
      const empty = document.createElement('div');
      empty.className = 'cc-empty';
      empty.innerHTML = `<div class="cc-empty-icon">🎉</div><p>No assignments found for <strong>${ccEsc(ccActiveName)}</strong>. Check with your manager.</p>`;
      panel.appendChild(empty);
      return;
    }

    const sectionHead = document.createElement('div');
    sectionHead.className = 'cc-section-head';
    sectionHead.style.marginTop = '16px';
    sectionHead.innerHTML = `<div><h3>Your Work — ${ccEsc(ccActiveName)}</h3><p>Choose a work block to begin counting.</p></div>`;
    panel.appendChild(sectionHead);

    const openGrid = document.createElement('div');
    openGrid.className = 'cc-work-grid';
    if (open.length) {
      open.forEach(a => {
        // When this assignment is the active one, show a compact "counting now" tile instead
        // of the full clickable card — this prevents any re-render trigger from card clicks
        if (a.id === ccActiveAssignmentId) {
          const tile = document.createElement('div');
          tile.style.cssText = [
            'background:linear-gradient(135deg,#eff6ff,#dbeafe)',
            'border:2px solid #2563eb',
            'border-radius:18px',
            'padding:16px 18px',
            'display:flex',
            'align-items:center',
            'gap:10px',
          ].join(';');
          tile.innerHTML = `
            <div style="width:10px;height:10px;border-radius:50%;background:#2563eb;flex-shrink:0;animation:ccPulse 1.4s ease-in-out infinite"></div>
            <div>
              <div style="font-size:13px;font-weight:800;color:#1d4ed8">Counting now: ${ccEsc(a.area)}</div>
              <div style="font-size:11px;color:#3b82f6;margin-top:2px">Scroll up to enter your counts</div>
            </div>`;
          openGrid.appendChild(tile);
        } else {
          openGrid.appendChild(ccMakeWorkCard(a));
        }
      });
    } else {
      const e = document.createElement('div');
      e.className = 'cc-empty';
      e.style.gridColumn = '1/-1';
      e.innerHTML = '<p>No open assignments right now.</p>';
      openGrid.appendChild(e);
    }
    panel.appendChild(openGrid);

    if (done.length) {
      const doneLbl = document.createElement('div');
      doneLbl.style.cssText = 'margin-top:18px;margin-bottom:10px';
      doneLbl.innerHTML = '<span class="eyebrow" style="font-size:11px">Already Submitted</span>';
      panel.appendChild(doneLbl);
      const doneGrid = document.createElement('div');
      doneGrid.className = 'cc-work-grid';
      done.forEach(a => doneGrid.appendChild(ccMakeWorkCard(a)));
      panel.appendChild(doneGrid);
    }
  }

  /* Build a work card as a real DOM element */
  function ccMakeWorkCard(a) {
    const isActive = a.id === ccActiveAssignmentId;
    const statusLabel = { assigned:'Assigned', inprogress:'In Progress', submitted:'Submitted', confirmed:'Confirmed', discrepancy:'Discrepancy', recount:'Recount' }[a.status] || a.status;
    const existingCount = ccGetRootCountForAssignment(a);
    const existingBatch = a.type === 'Recount' && existingCount ? (ccEnsureAttemptBatches(existingCount).find(b => b.assignmentId === a.id) || null) : null;
    const skuCount = existingBatch ? (existingBatch.entries || []).length : (existingCount ? ccGetAllEntries(existingCount).length : 0);

    const card = document.createElement('div');
    card.className = 'cc-work-card' + (isActive ? ' selected' : '');
    card.dataset.aid = a.id;

    const statusBadge = document.createElement('span');
    statusBadge.className = `cc-work-card-status cc-status-${a.status || 'assigned'}`;
    statusBadge.textContent = statusLabel;

    const areaDiv = document.createElement('div');
    areaDiv.className = 'cc-work-card-area';
    areaDiv.textContent = a.area || '—';

    const typeDiv = document.createElement('div');
    typeDiv.className = 'cc-work-card-type';
    typeDiv.textContent = a.type || 'Standard Count';

    const metaDiv = document.createElement('div');
    metaDiv.className = 'cc-work-card-meta';
    let metaHtml = '';
    if (a.locationRange) metaHtml += `<span class="cc-loc-range">${ccEsc(a.locationRange)}</span><br>`;
    metaHtml += ccFmtDate(a.date);
    if (skuCount) metaHtml += ` · <strong>${skuCount} SKUs entered</strong>`;
    // Show recount context — who originally counted and what count it's re-checking
    if (a.type === 'Recount' && a.originalAssociate) {
      metaHtml += `<br><span style="color:#b45309;font-weight:700">↩ Recount of ${ccEsc(a.originalAssociate)}'s count</span>`;
    }
    if (a.note) metaHtml += `<br><em>${ccEsc(a.note)}</em>`;
    metaDiv.innerHTML = metaHtml;

    // Recount assignments get an accent strip at the top
    if (a.type === 'Recount') {
      const recountBanner = document.createElement('div');
      recountBanner.style.cssText = [
        'background:#fef9c3','border:1px solid #fde68a','border-radius:8px',
        'padding:5px 10px','font-size:11px','font-weight:800',
        'color:#854d0e','margin-bottom:10px','display:flex',
        'align-items:center','gap:6px',
      ].join(';');
      recountBanner.innerHTML = '<span>↩</span> Recount Assignment';
      card.insertBefore(recountBanner, card.firstChild);
    }

    const actionDiv = document.createElement('div');
    actionDiv.className = 'cc-work-card-action';
    actionDiv.textContent = isActive ? '▲ Close' : '▶ Open to Count';

    card.appendChild(statusBadge);
    card.appendChild(areaDiv);
    card.appendChild(typeDiv);
    card.appendChild(metaDiv);
    card.appendChild(actionDiv);

    card.addEventListener('click', () => {
      if (ccActiveAssignmentId === a.id) {
        // Flush current input values before closing
        ccFlushBatchInputs();
        ccActiveAssignmentId = null;
        ccBatchRows = [];
      } else {
        ccActiveAssignmentId = a.id;
        ccBatchRows = [ccNewBatchRow()];
      }
      ccRenderMyWork();
    });

    return card;
  }

  /* Flush live input values from the DOM into ccBatchRows before any re-render */
  function ccFlushBatchInputs() {
    const block = document.getElementById('ccActiveBlock');
    if (!block) return;
    block.querySelectorAll('tr[data-rowid]').forEach(tr => {
      const row = ccBatchRows.find(r => r.id === tr.dataset.rowid);
      if (!row) return;
      if (!row.locked) {
        const skuEl = tr.querySelector('[data-field="sku"]');
        if (skuEl) row.sku = skuEl.value.trim().toUpperCase();
      }
      const locEl  = tr.querySelector('[data-field="location"]');
      const qtyEl  = tr.querySelector('[data-field="qty"]');
      const noteEl = tr.querySelector('[data-field="note"]');
      if (locEl)  row.location = locEl.value.trim().toUpperCase();
      if (qtyEl)  row.qty      = qtyEl.value;
      if (noteEl) row.note     = noteEl.value;
    });
  }

  /* Build the active count block entirely with createElement — NO innerHTML for inputs */
  function ccBuildActiveBlock() {
    const a = ccData.assignments.find(x => x.id === ccActiveAssignmentId);
    if (!a) return document.createTextNode('');

    const block = document.createElement('div');
    block.className = 'cc-active-block';
    block.id = 'ccActiveBlock';

    // Header
    const hdr = document.createElement('div');
    hdr.className = 'cc-active-header';

    const titleWrap = document.createElement('div');
    const titleEl = document.createElement('div');
    titleEl.className = 'cc-active-title';
    titleEl.textContent = (a.type === 'Recount' ? '↩ Recounting: ' : 'Counting: ') + a.area;
    const metaEl = document.createElement('div');
    metaEl.className = 'cc-active-meta';
    metaEl.textContent = `${a.type || 'Standard Count'} · ${ccFmtDate(a.date)}`;
    if (a.locationRange) {
      const loc = document.createElement('span');
      loc.className = 'cc-loc-range';
      loc.style.marginLeft = '8px';
      loc.textContent = a.locationRange;
      metaEl.appendChild(loc);
    }
    titleWrap.appendChild(titleEl);
    titleWrap.appendChild(metaEl);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn secondary';
    closeBtn.type = 'button';
    closeBtn.textContent = '✕ Close';
    closeBtn.addEventListener('click', () => {
      ccFlushBatchInputs();
      ccActiveAssignmentId = null;
      ccBatchRows = [];
      ccRenderMyWork();
    });

    hdr.appendChild(titleWrap);
    hdr.appendChild(closeBtn);
    block.appendChild(hdr);

    // Body
    const body = document.createElement('div');
    body.className = 'cc-active-body';

    // ── RECOUNT CONTEXT PANEL ──
    // If this is a recount assignment, show the original SKUs that need to be recounted
    if (a.type === 'Recount' && a.recountOfCountId) {
      const origCount = ccData.counts.find(c => c.id === a.recountOfCountId);
      if (origCount && origCount.entries && origCount.entries.length) {
        const contextPanel = document.createElement('div');
        contextPanel.style.cssText = [
          'background:#fffbeb',
          'border:2px solid #fbbf24',
          'border-radius:14px',
          'margin-bottom:18px',
          'overflow:hidden',
        ].join(';');

        // Panel header
        const ctxHdr = document.createElement('div');
        ctxHdr.style.cssText = [
          'background:#fef3c7',
          'border-bottom:1px solid #fde68a',
          'padding:12px 16px',
          'display:flex',
          'align-items:center',
          'justify-content:space-between',
          'gap:10px',
          'flex-wrap:wrap',
        ].join(';');

        const ctxTitle = document.createElement('div');
        ctxTitle.style.cssText = 'font-size:13px;font-weight:800;color:#854d0e;display:flex;align-items:center;gap:8px';
        ctxTitle.innerHTML = `<span style="font-size:16px">↩</span> SKUs to Recount — original count by <strong>${ccEsc(a.originalAssociate || origCount.associate)}</strong>`;

        const ctxMeta = document.createElement('div');
        ctxMeta.style.cssText = 'font-size:11px;color:#b45309;font-weight:700';
        ctxMeta.textContent = `${origCount.entries.length} SKU${origCount.entries.length !== 1 ? 's' : ''} · counted ${ccFmtDate(origCount.date)}`;

        ctxHdr.appendChild(ctxTitle);
        ctxHdr.appendChild(ctxMeta);
        contextPanel.appendChild(ctxHdr);

        // SKU rows — one per original entry
        const skuList = document.createElement('div');
        skuList.style.cssText = 'padding:10px 12px;display:flex;flex-direction:column;gap:6px';

        origCount.entries.forEach((entry, i) => {
          const row = document.createElement('div');
          row.style.cssText = [
            'display:flex',
            'align-items:center',
            'gap:12px',
            'background:#fff',
            'border:1px solid #fde68a',
            'border-radius:10px',
            'padding:10px 14px',
            'flex-wrap:wrap',
          ].join(';');

          // Row number
          const num = document.createElement('div');
          num.style.cssText = 'width:22px;height:22px;border-radius:50%;background:#fef3c7;font-size:11px;font-weight:900;color:#b45309;display:flex;align-items:center;justify-content:center;flex-shrink:0';
          num.textContent = i + 1;

          // SKU chip — no original qty shown so counter isn't influenced
          const skuChip = document.createElement('div');
          skuChip.style.cssText = 'font-family:"Courier New",monospace;font-size:16px;font-weight:900;color:#1d1d1d;flex:1;min-width:100px';
          skuChip.textContent = entry.sku;

          // Note if present
          if (entry.note) {
            const noteEl = document.createElement('div');
            noteEl.style.cssText = 'width:100%;font-size:12px;color:#b45309;font-style:italic;margin-top:2px;padding-top:6px;border-top:1px solid #fde68a';
            noteEl.textContent = 'Note: ' + entry.note;
            row.appendChild(num);
            row.appendChild(skuChip);
            row.appendChild(noteEl);
          } else {
            row.appendChild(num);
            row.appendChild(skuChip);
          }

          skuList.appendChild(row);
        });

        contextPanel.appendChild(skuList);

        // Footer hint
        const ctxFooter = document.createElement('div');
        ctxFooter.style.cssText = 'padding:10px 16px;background:#fef9c3;border-top:1px solid #fde68a;font-size:12px;font-weight:700;color:#b45309;text-align:center';
        ctxFooter.textContent = '↓ Enter your recount quantities below — use the same SKU numbers';
        contextPanel.appendChild(ctxFooter);

        body.appendChild(contextPanel);

        // Pre-populate batch rows with the same SKUs so the associate
        // doesn't have to retype them — qty starts blank for fresh count
        if (ccBatchRows.length === 1 && !ccBatchRows[0].sku) {
          ccBatchRows = origCount.entries.map(e => ({
            id:       ccId(),
            sku:      e.sku,
            qty:      '',
            location: '',   // fresh — associate picks their own exact location
            note:     '',
            locked:   true,
          }));
        }
      }
    }

    // Table
    const table = document.createElement('table');
    table.className = 'cc-batch-table';
    table.id = 'ccBatchTable';

    const thead = document.createElement('thead');
    thead.innerHTML = `<tr>
      <th style="width:28px">#</th>
      <th>SKU Number</th>
      <th>Exact Location</th>
      <th style="width:100px">Qty Counted</th>
      <th>Note (optional)</th>
      <th style="width:36px"></th>
    </tr>`;
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    tbody.id = 'ccBatchBody';
    ccBatchRows.forEach((row, i) => tbody.appendChild(ccMakeBatchRow(row, i)));
    table.appendChild(tbody);
    body.appendChild(table);

    // Action row
    const actions = document.createElement('div');
    actions.className = 'cc-batch-actions';

    const addBtn = document.createElement('button');
    addBtn.className = 'cc-add-row-btn';
    addBtn.type = 'button';
    addBtn.textContent = '+ Add Row';
    addBtn.addEventListener('click', () => {
      ccFlushBatchInputs();
      ccBatchRows.push(ccNewBatchRow());
      tbody.appendChild(ccMakeBatchRow(ccBatchRows[ccBatchRows.length - 1], ccBatchRows.length - 1));
      updateRowNumbers(tbody);
      updateRowCount(countSpan);
      const newRow = tbody.lastElementChild;
      newRow?.querySelector('[data-field="sku"]')?.focus();
    });

    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn secondary';
    saveBtn.type = 'button';
    saveBtn.textContent = 'Save Batch';
    saveBtn.addEventListener('click', () => {
      ccFlushBatchInputs();
      ccSaveBatch();
    });

    const countSpan = document.createElement('span');
    countSpan.style.cssText = 'font-size:12px;color:var(--muted)';
    updateRowCount(countSpan);

    actions.appendChild(addBtn);
    actions.appendChild(saveBtn);
    actions.appendChild(countSpan);
    body.appendChild(actions);
    block.appendChild(body);

    return block;
  }

  function updateRowNumbers(tbody) {
    tbody.querySelectorAll('tr').forEach((tr, i) => {
      const numEl = tr.querySelector('.cc-row-num');
      if (numEl) numEl.textContent = i + 1;
    });
  }

  function updateRowCount(span) {
    span.textContent = `${ccBatchRows.length} row${ccBatchRows.length !== 1 ? 's' : ''} ready`;
  }

  /* Build a single batch row as DOM — inputs are real elements, never string-injected */
  function ccMakeBatchRow(row, i) {
    const tr = document.createElement('tr');
    tr.dataset.rowid = row.id;

    // # cell
    const numTd = document.createElement('td');
    const numSpan = document.createElement('span');
    numSpan.className = 'cc-row-num';
    numSpan.textContent = i + 1;
    numTd.appendChild(numSpan);
    tr.appendChild(numTd);

    // SKU cell — locked rows show a read-only chip; unlocked rows show the normal input
    const skuTd = document.createElement('td');
    if (row.locked) {
      // Read-only SKU display — styled chip, not an input
      const skuChip = document.createElement('div');
      skuChip.style.cssText = [
        'font-family:"Courier New",monospace',
        'font-size:14px',
        'font-weight:900',
        'color:#1d4ed8',
        'background:#eff6ff',
        'border:1.5px solid #bfdbfe',
        'border-radius:8px',
        'padding:9px 12px',
        'display:inline-block',
        'user-select:text',
        'cursor:default',
      ].join(';');
      skuChip.textContent = row.sku;
      skuChip.title = 'SKU set by recount assignment — not editable';
      skuTd.appendChild(skuChip);
    } else {
      const skuInput = document.createElement('input');
      skuInput.className = 'cc-batch-input sku-input';
      skuInput.type = 'text';
      skuInput.placeholder = 'e.g. 100421';
      skuInput.value = row.sku || '';
      skuInput.dataset.field = 'sku';
      skuInput.autocomplete = 'off';
      skuInput.setAttribute('autocorrect', 'off');
      skuInput.setAttribute('autocapitalize', 'characters');
      skuInput.setAttribute('spellcheck', 'false');
      skuInput.addEventListener('click',     e => e.stopPropagation());
      skuInput.addEventListener('mousedown', e => e.stopPropagation());
      skuInput.addEventListener('focus',     e => e.stopPropagation());
      skuInput.addEventListener('input', () => {
        row.sku = skuInput.value.toUpperCase();
        skuInput.value = row.sku;
      });
      skuTd.appendChild(skuInput);
    }
    tr.appendChild(skuTd);

    // Location cell — scoped typeahead inline in the table
    const locTd = document.createElement('td');
    locTd.style.position = 'relative';

    const locInput = document.createElement('input');
    locInput.className = 'cc-batch-input';
    locInput.type = 'text';
    locInput.placeholder = 'e.g. A1B1';
    locInput.dataset.field = 'location';
    locInput.value = row.location || '';
    locInput.style.cssText = locInput.style.cssText + ';font-family:"Courier New",monospace;text-transform:uppercase;min-width:90px';
    locInput.setAttribute('autocomplete', 'off');
    locInput.setAttribute('spellcheck', 'false');

    // Inline dropdown for scoped locations
    const locDrop = document.createElement('div');
    locDrop.style.cssText = [
      'position:fixed',         // fixed so it escapes any overflow:hidden ancestor
      'background:#fff',
      'border:1.5px solid #c9d7e6',
      'border-radius:10px',
      'z-index:3000',
      'max-height:180px',
      'overflow-y:auto',
      'box-shadow:0 8px 20px rgba(29,73,111,.14)',
      'display:none',
      'min-width:120px',
    ].join(';');
    document.body.appendChild(locDrop);

    function positionLocDrop() {
      const rect = locInput.getBoundingClientRect();
      locDrop.style.top  = (rect.bottom + 4) + 'px';
      locDrop.style.left = rect.left + 'px';
      locDrop.style.width = Math.max(rect.width, 140) + 'px';
    }

    // Cleanup function to remove dropdown from body when row is removed
    locInput._destroyDrop = () => {
      if (locDrop.parentNode) locDrop.parentNode.removeChild(locDrop);
    };

    locInput.addEventListener('click',     e => e.stopPropagation());
    locInput.addEventListener('mousedown', e => e.stopPropagation());
    locInput.addEventListener('focus',     e => e.stopPropagation());

    locInput.addEventListener('input', () => {
      row.location = locInput.value.toUpperCase();
      locInput.value = row.location;

      const q = row.location;
      const activeAssign = ccData.assignments.find(x => x.id === ccActiveAssignmentId);
      const scopedLocs = ccScopedLocations(activeAssign);

      if (!q) { locDrop.style.display = 'none'; return; }
      const matches = scopedLocs.filter(l => l.startsWith(q)).slice(0, 25);
      if (!matches.length) { locDrop.style.display = 'none'; return; }

      locDrop.innerHTML = '';
      matches.forEach(loc => {
        const opt = document.createElement('div');
        opt.style.cssText = 'padding:8px 12px;font-size:13px;font-weight:700;font-family:"Courier New",monospace;cursor:pointer;transition:background .1s';
        opt.textContent = loc;
        opt.addEventListener('mouseenter', () => opt.style.background = '#eaf6ff');
        opt.addEventListener('mouseleave', () => opt.style.background = '');
        opt.addEventListener('mousedown', e => {
          e.preventDefault(); // prevent blur before click registers
          locInput.value = loc;
          row.location = loc;
          locDrop.style.display = 'none';
          // Move focus to qty input in same row
          tr.querySelector('[data-field="qty"]')?.focus();
        });
        locDrop.appendChild(opt);
      });
      positionLocDrop();
      locDrop.style.display = 'block';
    });

    locInput.addEventListener('keydown', e => {
      if (e.key === 'Escape') { locDrop.style.display = 'none'; }
    });

    locInput.addEventListener('blur', () => {
      setTimeout(() => { locDrop.style.display = 'none'; }, 150);
    });

    window.addEventListener('scroll', positionLocDrop, { passive: true });
    window.addEventListener('resize', positionLocDrop, { passive: true });

    locTd.appendChild(locInput);
    tr.appendChild(locTd);
    const qtyTd = document.createElement('td');
    const qtyInput = document.createElement('input');
    qtyInput.className = 'cc-batch-input qty-input';
    qtyInput.type = 'number';
    qtyInput.min = '0';
    qtyInput.placeholder = '0';
    qtyInput.dataset.field = 'qty';
    if (row.qty !== '') qtyInput.value = row.qty;
    qtyInput.addEventListener('click',     e => e.stopPropagation());
    qtyInput.addEventListener('mousedown', e => e.stopPropagation());
    qtyInput.addEventListener('focus',     e => e.stopPropagation());
    qtyInput.addEventListener('input', () => { row.qty = qtyInput.value; });
    // Enter on qty → focus next SKU or add new row
    qtyInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const tbody = tr.closest('tbody');
        const rows = [...tbody.querySelectorAll('tr')];
        const idx  = rows.indexOf(tr);
        if (idx === rows.length - 1) {
          // Last row — add new row and focus its SKU
          ccFlushBatchInputs();
          const newRow = ccNewBatchRow();
          ccBatchRows.push(newRow);
          const newTr = ccMakeBatchRow(newRow, ccBatchRows.length - 1);
          tbody.appendChild(newTr);
          updateRowNumbers(tbody);
          const countSpan = tr.closest('#ccActiveBlock')?.querySelector('.cc-batch-actions span');
          if (countSpan) updateRowCount(countSpan);
          newTr.querySelector('[data-field="sku"]')?.focus();
        } else {
          rows[idx + 1]?.querySelector('[data-field="sku"]')?.focus();
        }
      }
    });
    qtyTd.appendChild(qtyInput);
    tr.appendChild(qtyTd);

    // Note cell
    const noteTd = document.createElement('td');
    const noteInput = document.createElement('input');
    noteInput.className = 'cc-batch-input';
    noteInput.type = 'text';
    noteInput.placeholder = 'optional note';
    noteInput.dataset.field = 'note';
    noteInput.value = row.note || '';
    noteInput.addEventListener('click',     e => e.stopPropagation());
    noteInput.addEventListener('mousedown', e => e.stopPropagation());
    noteInput.addEventListener('focus',     e => e.stopPropagation());
    noteInput.addEventListener('input', () => { row.note = noteInput.value; });
    noteTd.appendChild(noteInput);
    tr.appendChild(noteTd);

    // Remove cell
    const removeTd = document.createElement('td');
    const removeBtn = document.createElement('button');
    removeBtn.className = 'cc-batch-remove';
    removeBtn.type = 'button';
    removeBtn.title = 'Remove row';
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => {
      // Clean up the floating location dropdown
      const locEl = tr.querySelector('[data-field="location"]');
      if (locEl?._destroyDrop) locEl._destroyDrop();

      ccBatchRows = ccBatchRows.filter(r => r.id !== row.id);
      if (!ccBatchRows.length) {
        const fresh = ccNewBatchRow();
        ccBatchRows.push(fresh);
        const tbody = tr.closest('tbody');
        tr.remove();
        tbody.appendChild(ccMakeBatchRow(fresh, 0));
      } else {
        tr.remove();
      }
      const tbody = tr.closest('tbody') || document.getElementById('ccBatchBody');
      if (tbody) updateRowNumbers(tbody);
      const countSpan = document.querySelector('#ccActiveBlock .cc-batch-actions span');
      if (countSpan) updateRowCount(countSpan);
    });
    removeTd.appendChild(removeBtn);
    tr.appendChild(removeTd);

    return tr;
  }

  function ccNewBatchRow() { return { id: ccId(), sku: '', qty: '', location: '', note: '' }; }

  function ccSaveBatch() {
    // Flush any in-progress input values into the data model first
    ccFlushBatchInputs();

    const a = ccData.assignments.find(x => x.id === ccActiveAssignmentId);
    if (!a) return;

    // Filter out blank rows
    const validRows = ccBatchRows.filter(r => r.sku && r.qty !== '' && r.qty !== null);
    if (!validRows.length) {
      alert('Please enter at least one SKU and quantity before saving.');
      return;
    }

    const newBatch = ccMakeAttemptBatch(a, validRows);

    // Original assignments own the root count thread; recount assignments append to it
    let countRec = ccGetRootCountForAssignment(a);
    if (!countRec) {
      countRec = {
        id: ccId(),
        assignmentId: a.id,
        area: a.area,
        type: a.type,
        date: a.date,
        locationRange: a.locationRange,
        associate: a.associate,
        submittedAt: newBatch.submittedAt,
        status: 'submitted',
        entries: ccClone(newBatch.entries),
        attemptBatches: [ccClone(newBatch)],
        verificationAttempts: [],
        systemQty: null,
        finalQty: null,
        finalStatus: null,
        confirmer: null,
        confirmedAt: null,
        discrepancyReason: null,
        notes: '',
      };
      ccData.counts.push(countRec);
    } else {
      const batches = ccEnsureAttemptBatches(countRec);
      const existingIdx = batches.findIndex(b => b.assignmentId === a.id);
      if (existingIdx >= 0) {
        batches[existingIdx] = newBatch;
      } else {
        batches.push(newBatch);
      }
      // Keep original flat entries for backward compatibility, but make them mirror the latest submitted batch
      countRec.entries = ccClone(newBatch.entries);
      countRec.submittedAt = newBatch.submittedAt;
      countRec.status = 'submitted';
      countRec.finalQty = null;
      countRec.finalStatus = null;
      countRec.confirmedAt = null;
      countRec.recountAssignedTo = null;
      countRec.recountAssignedAt = null;
    }

    // Update assignment status
    a.status = 'submitted';

    ccSave(ccData);
    ccActiveAssignmentId = null;
    ccBatchRows = [];

    ccShowToast(`✓ Batch saved — ${validRows.length} SKU${validRows.length !== 1 ? 's' : ''} submitted for review.`);
    ccRenderMyWork();
    ccUpdateTabBadges();
  }

  /* ── Render Review tab ── */
  function ccRenderReview() {
    const panel = page.querySelector('[data-panel="review"]');
    if (!panel) return;

    const pending = ccData.counts.filter(c => c.status === 'submitted');
    const recount  = ccData.counts.filter(c => c.status === 'recount');
    const resolved = ccData.counts.filter(c => c.status === 'confirmed' || c.status === 'discrepancy').slice(0,20);

    panel.innerHTML = `
      <div class="cc-section-head">
        <div><h3>Review &amp; Verification Queue</h3><p>Confirm counts, compare to system quantities, and manage discrepancies.</p></div>
      </div>

      ${pending.length ? `
        <div class="eyebrow" style="font-size:11px;margin-bottom:10px">Awaiting Review (${pending.length})</div>
        <div class="cc-review-list" id="ccReviewList">
          ${pending.map(c => ccReviewCardHtml(c, false)).join('')}
        </div>` : '<div class="cc-empty" style="margin-bottom:16px"><p>No submissions waiting for review.</p></div>'}

      ${recount.length ? `
        <div class="eyebrow" style="font-size:11px;margin:16px 0 10px">Sent for Recount (${recount.length})</div>
        <div class="cc-review-list">
          ${recount.map(c => ccReviewCardHtml(c, true)).join('')}
        </div>` : ''}

      ${resolved.length ? `
        <div class="eyebrow" style="font-size:11px;margin:16px 0 10px">Recently Resolved</div>
        <div class="cc-review-list">
          ${resolved.map(c => ccReviewCardHtml(c, false)).join('')}
        </div>` : ''}
    `;

    panel.querySelectorAll('.cc-review-card[data-cid]').forEach(card => {
      card.addEventListener('click', () => ccOpenVerifyModal(card.dataset.cid));
    });
  }

  function ccReviewCardHtml(c, isRecount) {
    const a = ccData.assignments.find(x => x.id === c.assignmentId) || {};
    const allEntries = ccGetAllEntries(c);
    const latestBatch = ccGetLatestBatch(c);
    const latestEntries = latestBatch ? (latestBatch.entries || []) : (c.entries || []);
    const entryCnt = latestEntries.length;
    const totalUnits = latestEntries.reduce((s, e) => s + (Number(e.qty)||0), 0);
    const statusClass = `cc-status-${c.status}`;
    const statusLabel = { submitted:'Awaiting Review', recount:'Needs Recount', confirmed:'Confirmed', discrepancy:'Discrepancy' }[c.status] || c.status;
    const attempts = c.verificationAttempts || [];
    const lastAttempt = attempts[attempts.length - 1];

    let countDisplay = '';
    if (c.systemQty !== null && c.systemQty !== undefined) {
      const diff = totalUnits - Number(c.systemQty);
      const cls  = diff === 0 ? 'match' : 'diff';
      countDisplay = `
        <div class="cc-review-counts">
          <div class="cc-count-pill"><div class="cc-count-pill-label">Counted</div><div class="cc-count-pill-val">${totalUnits}</div></div>
          <div class="cc-count-pill"><div class="cc-count-pill-label">System</div><div class="cc-count-pill-val">${c.systemQty}</div></div>
          <div class="cc-count-pill"><div class="cc-count-pill-label">Diff</div><div class="cc-count-pill-val ${cls}">${diff >= 0 ? '+' : ''}${diff}</div></div>
        </div>`;
    }

    return `
      <div class="cc-review-card${isRecount ? ' recount-flag' : ''}" data-cid="${ccEsc(c.id)}">
        <div class="cc-review-area">${ccEsc(a.area || c.area || '—')}</div>
        <div class="cc-review-details">
          <strong>${ccEsc((latestBatch && latestBatch.associate) || c.associate)} · ${ccFmtDate((latestBatch && latestBatch.date) || c.date)}</strong>
          <span>${entryCnt} SKU${entryCnt !== 1 ? 's' : ''} · ${totalUnits} units
            ${ccEnsureAttemptBatches(c).length ? ` · ${ccEnsureAttemptBatches(c).length} submission${ccEnsureAttemptBatches(c).length !== 1 ? 's' : ''}` : ''}
            ${attempts.length ? ` · ${attempts.length} verify log${attempts.length !== 1 ? 's' : ''}` : ''}
            ${lastAttempt ? ` · Last by ${ccEsc(lastAttempt.by)}` : ''}
            ${c.recountAssignedTo ? ` · <span style="color:#b45309;font-weight:700">↩ Recount → ${ccEsc(c.recountAssignedTo)}</span>` : ''}
          </span>
          <span class="cc-work-card-status ${statusClass}" style="position:static;display:inline-block;margin-top:4px">${ccEsc(statusLabel)}</span>
        </div>
        ${countDisplay}
      </div>`;
  }

  /* ── Render History tab ── */
  function ccRenderHistory(filter) {
    const panel = page.querySelector('[data-panel="history"]');
    if (!panel) return;

    const skuFilter  = filter?.sku  || panel.querySelector('#ccHistSku')?.value.trim().toUpperCase() || '';
    const locFilter  = filter?.loc  || panel.querySelector('#ccHistLoc')?.value.trim().toUpperCase() || '';
    const assocFilt  = filter?.assoc || panel.querySelector('#ccHistAssoc')?.value || '';
    const dateFilter = filter?.date  || panel.querySelector('#ccHistDate')?.value || '';

    // Flatten entries across all count records and all recount batches
    const rows = [];
    ccData.counts.forEach(c => {
      const rootAssign = ccData.assignments.find(x => x.id === c.assignmentId) || {};
      const batches = ccEnsureAttemptBatches(c);
      (batches.length ? batches : [{ assignmentId: c.assignmentId, associate: c.associate, date: c.date, entries: c.entries || [] }]).forEach(batch => {
        const batchAssign = ccData.assignments.find(x => x.id === batch.assignmentId) || rootAssign;
        (batch.entries || []).forEach(entry => {
          if (skuFilter && !entry.sku.toUpperCase().includes(skuFilter)) return;
          if (locFilter && !(batchAssign.area||c.area||'').toUpperCase().includes(locFilter) && !(batchAssign.locationRange||c.locationRange||'').toUpperCase().includes(locFilter) && !(entry.location||'').toUpperCase().includes(locFilter)) return;
          if (assocFilt && (batch.associate || c.associate) !== assocFilt) return;
          if (dateFilter && (batch.date || c.date) !== dateFilter) return;
          rows.push({ entry, count: c, assign: batchAssign, batch });
        });
      });
    });
    rows.sort((a, b) => (b.entry.enteredAt || 0) - (a.entry.enteredAt || 0));

    const employeeOptions = ccGetEmployees().map(n => `<option value="${ccEsc(n)}"${n === assocFilt ? ' selected' : ''}>${ccEsc(n)}</option>`).join('');

    panel.innerHTML = `
      <div class="cc-section-head">
        <div><h3>History &amp; Search</h3><p>Search all count records. Most useful search: by SKU number.</p></div>
      </div>
      <div class="cc-history-filters">
        <input id="ccHistSku" type="text" placeholder="🔍 SKU number" value="${ccEsc(skuFilter)}" autocomplete="off" style="font-family:'Courier New',monospace;font-weight:700">
        <input id="ccHistLoc" type="text" placeholder="Location / aisle" value="${ccEsc(locFilter)}">
        <select id="ccHistAssoc"><option value="">All associates</option>${employeeOptions}</select>
        <input id="ccHistDate" type="date" value="${ccEsc(dateFilter)}">
        <button class="btn secondary" type="button" id="ccHistClear">Clear</button>
      </div>
      <div class="cc-history-table-wrap">
        <table class="cc-history-table">
          <thead><tr>
            <th>SKU</th><th>Location</th><th>Qty</th><th>Area</th><th>Associate</th>
            <th>Date</th><th>Status</th><th>Final Qty</th><th>Discrepancy</th><th>Note</th>
          </tr></thead>
          <tbody>
            ${rows.length ? rows.map(({ entry, count, assign, batch }) => {
              const statusLabel = { submitted:'Pending', recount:'Recount', confirmed:'Confirmed', discrepancy:'Discrepancy' }[count.status] || count.status;
              const discClass = count.status === 'discrepancy' ? 'color:#b91c1c' : count.status === 'confirmed' ? 'color:#15803d' : '';
              return `<tr>
                <td class="sku-cell">${ccEsc(entry.sku)}</td>
                <td><span class="cc-loc-range" style="font-size:12px">${ccEsc(entry.location || '—')}</span></td>
                <td style="font-weight:800">${entry.qty}</td>
                <td><strong>${ccEsc(assign.area || count.area || '—')}</strong></td>
                <td>${ccEsc((batch && batch.associate) || count.associate)}</td>
                <td>${ccFmtDate((batch && batch.date) || count.date)}</td>
                <td><span style="${discClass};font-weight:700;font-size:12px">${ccEsc(statusLabel)}</span></td>
                <td style="font-weight:800">${count.finalQty !== null && count.finalQty !== undefined ? count.finalQty : '—'}</td>
                <td style="font-size:12px;color:var(--muted)">${ccEsc(count.discrepancyReason || '')}</td>
                <td style="font-size:12px;color:var(--muted)">${ccEsc(entry.note || '')}</td>
              </tr>`;
            }).join('') : `<tr><td colspan="10" class="empty">No records match your search.</td></tr>`}
          </tbody>
        </table>
      </div>`;

    // Bind filters
    ['#ccHistSku','#ccHistLoc','#ccHistAssoc','#ccHistDate'].forEach(sel => {
      panel.querySelector(sel)?.addEventListener('input', () => ccRenderHistory());
    });
    panel.querySelector('#ccHistClear')?.addEventListener('click', () => {
      ['#ccHistSku','#ccHistLoc','#ccHistDate'].forEach(sel => { const el = panel.querySelector(sel); if(el) el.value=''; });
      const assocSel = panel.querySelector('#ccHistAssoc'); if(assocSel) assocSel.value='';
      ccRenderHistory();
    });
  }

  /* ── Render KPI tab ── */
  function ccRenderKPI() {
    const panel = page.querySelector('[data-panel="kpi"]');
    if (!panel) return;
    const today = ccToday();
    const goal  = ccData.settings.dailyGoal || 95;

    const todayCounts  = ccData.counts.filter(c => c.date === today);
    const todayAssigns = ccData.assignments.filter(a => a.date === today);
    const confirmed    = ccData.counts.filter(c => c.status === 'confirmed');
    const todayConf    = confirmed.filter(c => c.date === today);
    const allEntries   = ccData.counts.flatMap(c => c.entries || []);
    const todayEntries = todayCounts.flatMap(c => c.entries || []);

    const totalUnitsToday = todayEntries.reduce((s, e) => s + (Number(e.qty)||0), 0);
    const totalUnitsAll   = allEntries.reduce((s, e) => s + (Number(e.qty)||0), 0);
    const discrepCount    = ccData.counts.filter(c => c.status === 'discrepancy').length;
    const todayDisc       = todayCounts.filter(c => c.status === 'discrepancy').length;

    const resolvedCounts = ccData.counts.filter(c => c.status === 'confirmed' || c.status === 'discrepancy');
    const totalSkuCount  = resolvedCounts.reduce((sum, c) => {
      const batch = ccGetLatestBatch(c);
      const entries = batch ? (batch.entries || []) : (c.entries || []);
      return sum + entries.length;
    }, 0);
    const discrepSkuCount = resolvedCounts
      .filter(c => c.status === 'discrepancy')
      .reduce((sum, c) => {
        const batch = ccGetLatestBatch(c);
        const entries = batch ? (batch.entries || []) : (c.entries || []);
        return sum + entries.length;
      }, 0);
    const correctSkuCount = Math.max(0, totalSkuCount - discrepSkuCount);
    const accuracy        = totalSkuCount ? Math.round((correctSkuCount / totalSkuCount) * 100) : 100;

    const locDone    = todayConf.length;
    const pct        = Math.min(100, Math.round((locDone / goal) * 100));
    const onTrack    = locDone >= Math.round(goal * 0.9);

    // Per-associate stats today
    const assocMap = {};
    todayCounts.forEach(c => {
      if (!assocMap[c.associate]) assocMap[c.associate] = { skus:0, units:0, confirmed:0, disc:0 };
      assocMap[c.associate].skus   += (c.entries||[]).length;
      assocMap[c.associate].units  += (c.entries||[]).reduce((s,e)=>s+(Number(e.qty)||0),0);
      if (c.status === 'confirmed')   assocMap[c.associate].confirmed++;
      if (c.status === 'discrepancy') assocMap[c.associate].disc++;
    });

    panel.innerHTML = `
      <div class="cc-section-head">
        <div><h3>Performance &amp; KPIs</h3><p>Daily goal: <strong>${goal} locations</strong>. Accuracy is based on correct SKU lines after discrepancies are removed.</p></div>
        <button class="btn secondary" type="button" id="ccSetGoalBtn">⚙ Set Daily Goal</button>
      </div>

      <div class="cc-kpi-strip" style="margin-bottom:18px">
        <div class="cc-kpi-card highlight">
          <div class="cc-kpi-label">Locations Done Today</div>
          <div class="cc-kpi-value">${locDone}</div>
          <div class="cc-kpi-sub">Goal: ${goal}</div>
          <div class="cc-progress-wrap" style="margin-top:8px">
            <div class="cc-progress-bar${onTrack ? ' on-track' : ''}" style="width:${pct}%"></div>
          </div>
        </div>
        <div class="cc-kpi-card ${accuracy >= 95 ? 'good' : accuracy >= 85 ? 'warn' : 'danger'}">
          <div class="cc-kpi-label">Accuracy</div>
          <div class="cc-kpi-value">${accuracy}%</div>
          <div class="cc-kpi-sub">${correctSkuCount} correct SKUs / ${totalSkuCount} total SKUs</div>
        </div>
        <div class="cc-kpi-card">
          <div class="cc-kpi-label">SKUs Today</div>
          <div class="cc-kpi-value">${todayEntries.length}</div>
          <div class="cc-kpi-sub">${totalUnitsToday.toLocaleString()} units</div>
        </div>
        <div class="cc-kpi-card ${todayDisc > 0 ? 'warn' : 'good'}">
          <div class="cc-kpi-label">Discrepancies Today</div>
          <div class="cc-kpi-value">${todayDisc}</div>
          <div class="cc-kpi-sub">${discrepCount} total all time</div>
        </div>
        <div class="cc-kpi-card">
          <div class="cc-kpi-label">Pending Review</div>
          <div class="cc-kpi-value">${ccData.counts.filter(c=>c.status==='submitted'||c.status==='recount').length}</div>
          <div class="cc-kpi-sub">Need confirmation</div>
        </div>
        <div class="cc-kpi-card">
          <div class="cc-kpi-label">Total Units (All)</div>
          <div class="cc-kpi-value">${totalUnitsAll.toLocaleString()}</div>
          <div class="cc-kpi-sub">Across all counts</div>
        </div>
      </div>

      ${Object.keys(assocMap).length ? `
        <div class="cc-section-head"><div><h3>Today by Associate</h3></div></div>
        <div class="cc-kpi-strip">
          ${Object.entries(assocMap).map(([name, stats]) => `
            <div class="cc-kpi-card">
              <div class="cc-kpi-label" style="display:flex;align-items:center;gap:6px">
                <div class="cc-who-avatar" style="width:22px;height:22px;font-size:10px">${ccEsc(name.charAt(0))}</div>
                ${ccEsc(name.split(' ')[0])}
              </div>
              <div class="cc-kpi-value" style="font-size:22px">${stats.skus}</div>
              <div class="cc-kpi-sub">${stats.units.toLocaleString()} units · ${stats.confirmed} conf · ${stats.disc} disc</div>
            </div>`).join('')}
        </div>` : ''}
    `;

    panel.querySelector('#ccSetGoalBtn')?.addEventListener('click', () => {
      const newGoal = prompt('Set daily location goal:', ccData.settings.dailyGoal);
      const parsed = parseInt(newGoal, 10);
      if (parsed > 0) {
        ccData.settings.dailyGoal = parsed;
        ccSave(ccData);
        ccRenderKPI();
      }
    });
  }

  /* ── Render Settings tab ── */
  function ccRenderSettings() {
    const panel = page.querySelector('[data-panel="settings"]');
    if (!panel) return;
    const reasons = ccData.settings.discrepancyReasons || [];
    const custom  = ccData.settings.customLocations || [];

    panel.innerHTML = `
      <div class="cc-section-head">
        <div><h3>Settings &amp; Setup</h3><p>Manage discrepancy reasons and custom locations.</p></div>
      </div>

      <div class="cc-settings-block">
        <h4>Discrepancy Reasons</h4>
        <div class="cc-tag-list" id="ccReasonTags">
          ${reasons.map((r, i) => `
            <div class="cc-tag">
              ${ccEsc(r)}
              <button class="cc-tag-remove" data-idx="${i}" type="button" title="Remove">×</button>
            </div>`).join('')}
        </div>
        <div class="cc-add-tag-row">
          <input id="ccNewReasonInput" type="text" placeholder="Add reason…">
          <button class="btn secondary" type="button" id="ccAddReasonBtn">Add</button>
        </div>
      </div>

      <div class="cc-settings-block">
        <h4>Custom Locations</h4>
        <p style="font-size:13px;color:var(--muted);margin:0 0 10px">Standard locations A1A1–Z13E2 and EP001–EP200 are built in. Add custom here.</p>
        <div class="cc-tag-list" id="ccCustomLocTags">
          ${custom.map((r, i) => `
            <div class="cc-tag">
              ${ccEsc(r)}
              <button class="cc-tag-remove" data-idx="${i}" type="button" title="Remove">×</button>
            </div>`).join('')}
          ${!custom.length ? '<span style="color:var(--muted);font-size:13px">No custom locations added.</span>' : ''}
        </div>
        <div class="cc-add-tag-row">
          <input id="ccNewLocInput" type="text" placeholder="e.g. OVERFLOW-1" style="text-transform:uppercase">
          <button class="btn secondary" type="button" id="ccAddLocBtn">Add</button>
        </div>
      </div>

      <div class="cc-settings-block">
        <h4>Daily Goal</h4>
        <p style="font-size:13px;color:var(--muted);margin:0 0 10px">Target completed locations per day.</p>
        <div class="cc-add-tag-row">
          <input id="ccGoalInput" type="number" min="1" value="${ccData.settings.dailyGoal}" style="max-width:100px">
          <button class="btn secondary" type="button" id="ccSaveGoalBtn">Save</button>
        </div>
      </div>

      <div class="cc-settings-block">
        <h4>Data Management</h4>
        <p style="font-size:13px;color:var(--muted);margin:0 0 12px">Export all cycle count data as JSON for backup, or reset it while you test.</p>
        <div class="cc-add-tag-row" style="justify-content:flex-start;gap:10px;flex-wrap:wrap">
          <button class="btn secondary" type="button" id="ccExportBtn">Export Data (JSON)</button>
          <button class="btn secondary" type="button" id="ccResetTestBtn" style="border-color:#fecaca;color:#b91c1c;background:#fff5f5">Reset Test Data</button>
        </div>
        <p style="font-size:12px;color:#b91c1c;margin:10px 0 0">Reset will clear assignments, count rows, review history, and your selected active worker for this module only. It will not touch the rest of Houston Control.</p>
      </div>
    `;

    // Reason tags remove
    panel.querySelector('#ccReasonTags')?.addEventListener('click', e => {
      const btn = e.target.closest('.cc-tag-remove');
      if (!btn) return;
      ccData.settings.discrepancyReasons.splice(parseInt(btn.dataset.idx, 10), 1);
      ccSave(ccData);
      ccRenderSettings();
    });
    panel.querySelector('#ccAddReasonBtn')?.addEventListener('click', () => {
      const val = panel.querySelector('#ccNewReasonInput')?.value.trim();
      if (val && !ccData.settings.discrepancyReasons.includes(val)) {
        ccData.settings.discrepancyReasons.push(val);
        ccSave(ccData);
        ccRenderSettings();
      }
    });

    // Custom loc remove
    panel.querySelector('#ccCustomLocTags')?.addEventListener('click', e => {
      const btn = e.target.closest('.cc-tag-remove');
      if (!btn) return;
      ccData.settings.customLocations.splice(parseInt(btn.dataset.idx, 10), 1);
      _allLocations = null;
      ccSave(ccData);
      ccRenderSettings();
    });
    panel.querySelector('#ccAddLocBtn')?.addEventListener('click', () => {
      const val = (panel.querySelector('#ccNewLocInput')?.value.trim() || '').toUpperCase();
      if (val && !ccData.settings.customLocations.includes(val)) {
        ccData.settings.customLocations.push(val);
        _allLocations = null;
        ccSave(ccData);
        ccRenderSettings();
      }
    });

    panel.querySelector('#ccSaveGoalBtn')?.addEventListener('click', () => {
      const val = parseInt(panel.querySelector('#ccGoalInput')?.value, 10);
      if (val > 0) { ccData.settings.dailyGoal = val; ccSave(ccData); ccShowToast('Goal saved.'); }
    });

    panel.querySelector('#ccExportBtn')?.addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(ccData, null, 2)], {type:'application/json'});
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = `cycle-count-export-${ccToday()}.json`; a.click();
      URL.revokeObjectURL(url);
    });

    panel.querySelector('#ccResetTestBtn')?.addEventListener('click', () => {
      const first = confirm('Reset all Cycle Count test data? This will clear assignments, count rows, review history, and KPI totals for this module only.');
      if (!first) return;
      const second = confirm('Final check: do you want to wipe the Cycle Count module data now?');
      if (!second) return;

      ccData = { assignments: [], counts: [], settings: ccClone(ccDefaultSettings()) };
      ccActiveName = '';
      ccActiveAssignmentId = null;
      ccBatchRows = [];
      _allLocations = null;

      try { localStorage.removeItem(CC_KEY); } catch(e) {}
      try { localStorage.removeItem('cc_active_name'); } catch(e) {}
      ccSave(ccData);

      ccRenderSettings();
      ccUpdateTabBadges();
      ccShowToast('Cycle Count test data reset.');
    });
  }

  /* ══════════════════════════════════════════
     MODALS
  ══════════════════════════════════════════ */

  /* ── Assignment create/edit modal ── */
  /* Built with DOM methods (not innerHTML) for the interactive parts so inputs
     are real elements that always accept text/focus without event-capture issues. */
  function ccOpenAssignModal(id) {
    const existing = id ? ccData.assignments.find(a => a.id === id) : null;
    const today    = ccToday();
    const emps     = ccGetEmployees();

    /* ── Build backdrop + shell ── */
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.style.cssText = 'display:flex;z-index:2000;';

    const box = document.createElement('div');
    box.style.cssText = [
      'background:#fff','border-radius:24px',
      'box-shadow:0 22px 60px rgba(23,50,74,.22)',
      'border:1px solid #d7e9f6','width:min(660px,100%)',
      'max-height:92vh','display:flex','flex-direction:column',
      'overflow:hidden','position:relative',
    ].join(';');

    /* Header */
    const hdr = document.createElement('div');
    hdr.style.cssText = 'display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:20px 22px 16px;border-bottom:1px solid #d7e9f6;flex-shrink:0';
    hdr.innerHTML = `
      <div>
        <div class="eyebrow">Cycle Count</div>
        <h2 style="margin:4px 0 2px;font-size:22px;font-weight:900">${existing ? 'Edit Assignment' : 'New Assignment'}</h2>
        <p style="margin:0;font-size:13px;color:var(--muted)">${existing ? 'Update or delete this assignment.' : 'Create a new count assignment for an associate.'}</p>
      </div>`;
    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn secondary';
    closeBtn.style.cssText = 'flex-shrink:0;padding:8px 14px';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', () => ccCloseModal(backdrop));
    hdr.appendChild(closeBtn);

    /* Scrollable body */
    const body = document.createElement('div');
    body.style.cssText = 'padding:20px 22px;overflow-y:auto;flex:1';

    /* ── Helper: make a labeled field ── */
    function mkField(labelText, inputEl, fullWidth) {
      const wrap = document.createElement('div');
      wrap.className = 'cc-field' + (fullWidth ? ' cc-form-full' : '');
      const lbl = document.createElement('label');
      lbl.textContent = labelText;
      wrap.appendChild(lbl);
      wrap.appendChild(inputEl);
      return wrap;
    }

    /* ── Row 1: Date + Type ── */
    const row1 = document.createElement('div');
    row1.className = 'cc-form-2col';
    row1.style.marginBottom = '14px';

    const dateInput = document.createElement('input');
    dateInput.type = 'date';
    dateInput.value = existing?.date || today;
    row1.appendChild(mkField('Date', dateInput));

    const typeSelect = document.createElement('select');
    ['Standard Count','Full Aisle','Spot Check','Recount','EP Area'].forEach(t => {
      const o = document.createElement('option');
      o.value = o.textContent = t;
      if ((existing?.type || 'Standard Count') === t) o.selected = true;
      typeSelect.appendChild(o);
    });
    row1.appendChild(mkField('Count Type', typeSelect));
    body.appendChild(row1);

    /* ── Row 2: Associate + Due Date ── */
    const row2 = document.createElement('div');
    row2.className = 'cc-form-2col';
    row2.style.marginBottom = '14px';

    const assocSelect = document.createElement('select');
    const blankOpt = document.createElement('option');
    blankOpt.value = ''; blankOpt.textContent = '— Assign to —';
    assocSelect.appendChild(blankOpt);
    emps.forEach(n => {
      const o = document.createElement('option');
      o.value = o.textContent = n;
      if (existing?.associate === n) o.selected = true;
      assocSelect.appendChild(o);
    });
    row2.appendChild(mkField('Associate', assocSelect));

    const dueDateInput = document.createElement('input');
    dueDateInput.type = 'date';
    dueDateInput.value = existing?.dueDate || today;
    row2.appendChild(mkField('Due Date', dueDateInput));
    body.appendChild(row2);

    /* ── Location Picker section ── */
    const locSection = document.createElement('div');
    locSection.style.cssText = 'background:var(--blue1);border:1px solid var(--line);border-radius:16px;padding:16px 18px;margin-bottom:14px';

    const locTitle = document.createElement('div');
    locTitle.style.cssText = 'font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:12px';
    locTitle.textContent = 'Location Assignment';
    locSection.appendChild(locTitle);

    /* Aisle picker — A through Z + EP */
    const aisleRow = document.createElement('div');
    aisleRow.style.cssText = 'margin-bottom:12px';
    const aisleLabel = document.createElement('div');
    aisleLabel.style.cssText = 'font-size:12px;font-weight:700;color:var(--muted);margin-bottom:8px';
    aisleLabel.textContent = 'Step 1 — Pick Aisle';
    aisleRow.appendChild(aisleLabel);

    const aisleGrid = document.createElement('div');
    aisleGrid.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px';

    const aisles = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    let selectedAisle = existing?.aisle || '';
    let selectedBay   = existing?.bay   || '';
    let selectedLevel = existing?.level || '';
    let selectedSide  = existing?.side  || '';

    // Parse existing area into components if possible
    if (existing?.area && !existing?.aisle) {
      const m = existing.area.match(/^([A-Z])(\d{1,2})?([A-E])?([12])?$/);
      if (m) {
        selectedAisle = m[1] || '';
        selectedBay   = m[2] || '';
        selectedLevel = m[3] || '';
        selectedSide  = m[4] || '';
      } else if (existing.area === 'EP') {
        selectedAisle = 'EP';
      }
    }

    /* Build aisle buttons */
    function buildAisleBtns() {
      aisleGrid.innerHTML = '';
      [...aisles, 'EP'].forEach(a => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = a;
        btn.style.cssText = [
          'min-width:36px','padding:6px 10px','border-radius:8px',
          'font-size:13px','font-weight:800','cursor:pointer',
          'border:1.5px solid ' + (selectedAisle === a ? '#2563eb' : '#c9d7e6'),
          'background:' + (selectedAisle === a ? '#dbeafe' : '#fff'),
          'color:' + (selectedAisle === a ? '#1d4ed8' : 'var(--text)'),
          'transition:all .12s',
        ].join(';');
        btn.addEventListener('click', () => {
          selectedAisle = a;
          selectedBay = ''; selectedLevel = ''; selectedSide = '';
          buildAisleBtns();
          buildBayRow();
          buildLevelRow();
          buildSideRow();
          updateAreaPreview();
        });
        aisleGrid.appendChild(btn);
      });
    }
    aisleRow.appendChild(aisleGrid);
    locSection.appendChild(aisleRow);

    /* Bay picker (1–13) — only shows when an aisle is selected and not EP */
    const bayRow = document.createElement('div');
    bayRow.style.marginBottom = '12px';

    function buildBayRow() {
      bayRow.innerHTML = '';
      if (!selectedAisle || selectedAisle === 'EP') return;

      const lbl = document.createElement('div');
      lbl.style.cssText = 'font-size:12px;font-weight:700;color:var(--muted);margin-bottom:8px';
      lbl.textContent = 'Step 2 — Pick Bay (optional — leave blank for full aisle)';
      bayRow.appendChild(lbl);

      const grid = document.createElement('div');
      grid.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px';

      // "Any bay" clear button
      const anyBtn = document.createElement('button');
      anyBtn.type = 'button';
      anyBtn.textContent = 'Any';
      anyBtn.style.cssText = [
        'min-width:44px','padding:6px 10px','border-radius:8px',
        'font-size:12px','font-weight:800','cursor:pointer',
        'border:1.5px solid ' + (!selectedBay ? '#2563eb' : '#c9d7e6'),
        'background:' + (!selectedBay ? '#dbeafe' : '#fff'),
        'color:' + (!selectedBay ? '#1d4ed8' : 'var(--text)'),
      ].join(';');
      anyBtn.addEventListener('click', () => {
        selectedBay = ''; selectedLevel = ''; selectedSide = '';
        buildBayRow(); buildLevelRow(); buildSideRow(); updateAreaPreview();
      });
      grid.appendChild(anyBtn);

      for (let b = 1; b <= 13; b++) {
        const bStr = String(b);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = bStr;
        btn.style.cssText = [
          'min-width:36px','padding:6px 10px','border-radius:8px',
          'font-size:13px','font-weight:800','cursor:pointer',
          'border:1.5px solid ' + (selectedBay === bStr ? '#2563eb' : '#c9d7e6'),
          'background:' + (selectedBay === bStr ? '#dbeafe' : '#fff'),
          'color:' + (selectedBay === bStr ? '#1d4ed8' : 'var(--text)'),
        ].join(';');
        btn.addEventListener('click', () => {
          selectedBay = bStr; selectedLevel = ''; selectedSide = '';
          buildBayRow(); buildLevelRow(); buildSideRow(); updateAreaPreview();
        });
        grid.appendChild(btn);
      }
      bayRow.appendChild(grid);
    }
    locSection.appendChild(bayRow);

    /* Level picker (A–E) — only when bay is selected */
    const levelRow = document.createElement('div');
    levelRow.style.marginBottom = '12px';

    function buildLevelRow() {
      levelRow.innerHTML = '';
      if (!selectedBay) return;

      const lbl = document.createElement('div');
      lbl.style.cssText = 'font-size:12px;font-weight:700;color:var(--muted);margin-bottom:8px';
      lbl.textContent = 'Step 3 — Pick Level (A = bottom, E = top)';
      levelRow.appendChild(lbl);

      const grid = document.createElement('div');
      grid.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';

      const anyBtn = document.createElement('button');
      anyBtn.type = 'button'; anyBtn.textContent = 'Any';
      anyBtn.style.cssText = [
        'min-width:44px','padding:6px 10px','border-radius:8px',
        'font-size:12px','font-weight:800','cursor:pointer',
        'border:1.5px solid ' + (!selectedLevel ? '#2563eb' : '#c9d7e6'),
        'background:' + (!selectedLevel ? '#dbeafe' : '#fff'),
        'color:' + (!selectedLevel ? '#1d4ed8' : 'var(--text)'),
      ].join(';');
      anyBtn.addEventListener('click', () => {
        selectedLevel = ''; selectedSide = '';
        buildLevelRow(); buildSideRow(); updateAreaPreview();
      });
      grid.appendChild(anyBtn);

      ['A','B','C','D','E'].forEach(l => {
        const btn = document.createElement('button');
        btn.type = 'button'; btn.textContent = l;
        btn.style.cssText = [
          'min-width:44px','padding:6px 10px','border-radius:8px',
          'font-size:14px','font-weight:800','cursor:pointer',
          'border:1.5px solid ' + (selectedLevel === l ? '#2563eb' : '#c9d7e6'),
          'background:' + (selectedLevel === l ? '#dbeafe' : '#fff'),
          'color:' + (selectedLevel === l ? '#1d4ed8' : 'var(--text)'),
        ].join(';');
        btn.addEventListener('click', () => {
          selectedLevel = l; selectedSide = '';
          buildLevelRow(); buildSideRow(); updateAreaPreview();
        });
        grid.appendChild(btn);
      });
      levelRow.appendChild(grid);
    }
    locSection.appendChild(levelRow);

    /* Side picker (1 = left, 2 = right) — only when level selected */
    const sideRow = document.createElement('div');
    sideRow.style.marginBottom = '8px';

    function buildSideRow() {
      sideRow.innerHTML = '';
      if (!selectedLevel) return;

      const lbl = document.createElement('div');
      lbl.style.cssText = 'font-size:12px;font-weight:700;color:var(--muted);margin-bottom:8px';
      lbl.textContent = 'Step 4 — Pick Side (1 = left, 2 = right)';
      sideRow.appendChild(lbl);

      const grid = document.createElement('div');
      grid.style.cssText = 'display:flex;gap:6px';

      const anyBtn = document.createElement('button');
      anyBtn.type = 'button'; anyBtn.textContent = 'Both';
      anyBtn.style.cssText = [
        'min-width:60px','padding:8px 14px','border-radius:8px',
        'font-size:13px','font-weight:800','cursor:pointer',
        'border:1.5px solid ' + (!selectedSide ? '#2563eb' : '#c9d7e6'),
        'background:' + (!selectedSide ? '#dbeafe' : '#fff'),
        'color:' + (!selectedSide ? '#1d4ed8' : 'var(--text)'),
      ].join(';');
      anyBtn.addEventListener('click', () => {
        selectedSide = ''; buildSideRow(); updateAreaPreview();
      });
      grid.appendChild(anyBtn);

      ['1','2'].forEach(s => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = s === '1' ? '1 — Left' : '2 — Right';
        btn.style.cssText = [
          'padding:8px 16px','border-radius:8px',
          'font-size:13px','font-weight:800','cursor:pointer',
          'border:1.5px solid ' + (selectedSide === s ? '#2563eb' : '#c9d7e6'),
          'background:' + (selectedSide === s ? '#dbeafe' : '#fff'),
          'color:' + (selectedSide === s ? '#1d4ed8' : 'var(--text)'),
        ].join(';');
        btn.addEventListener('click', () => {
          selectedSide = s; buildSideRow(); updateAreaPreview();
        });
        grid.appendChild(btn);
      });
      sideRow.appendChild(grid);
    }
    locSection.appendChild(sideRow);

    /* EP sub-picker: EP001–EP200 */
    const epRow = document.createElement('div');
    epRow.style.marginBottom = '8px';
    let selectedEPStart = existing?.epStart || '';
    let selectedEPEnd   = existing?.epEnd   || '';

    function buildEPRow() {
      epRow.innerHTML = '';
      if (selectedAisle !== 'EP') return;

      const lbl = document.createElement('div');
      lbl.style.cssText = 'font-size:12px;font-weight:700;color:var(--muted);margin-bottom:8px';
      lbl.textContent = 'EP Location Range (EP001 – EP200)';
      epRow.appendChild(lbl);

      const grid = document.createElement('div');
      grid.style.cssText = 'display:flex;gap:10px;align-items:center;flex-wrap:wrap';

      const mkEPSel = (labelText, currentVal, onChange) => {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;flex-direction:column;gap:4px';
        const l = document.createElement('div');
        l.style.cssText = 'font-size:11px;font-weight:700;color:var(--muted)';
        l.textContent = labelText;
        const sel = document.createElement('select');
        sel.style.cssText = 'border:1.5px solid #c9d7e6;border-radius:10px;padding:8px 12px;font-size:13px;font-weight:700;font-family:"Courier New",monospace;background:#fff;color:var(--text)';
        const blank = document.createElement('option');
        blank.value = ''; blank.textContent = '— Any —';
        sel.appendChild(blank);
        for (let i = 1; i <= 200; i++) {
          const v = 'EP' + String(i).padStart(3,'0');
          const o = document.createElement('option');
          o.value = o.textContent = v;
          if (v === currentVal) o.selected = true;
          sel.appendChild(o);
        }
        sel.addEventListener('change', () => onChange(sel.value));
        wrap.appendChild(l); wrap.appendChild(sel);
        return wrap;
      };

      grid.appendChild(mkEPSel('From', selectedEPStart, v => { selectedEPStart = v; updateAreaPreview(); }));
      const dash = document.createElement('span');
      dash.textContent = '→';
      dash.style.cssText = 'font-size:18px;font-weight:900;color:var(--muted);margin-top:18px';
      grid.appendChild(dash);
      grid.appendChild(mkEPSel('To', selectedEPEnd, v => { selectedEPEnd = v; updateAreaPreview(); }));
      epRow.appendChild(grid);
    }
    locSection.appendChild(epRow);

    /* Preview chip */
    const previewWrap = document.createElement('div');
    previewWrap.style.cssText = 'margin-top:12px;padding-top:12px;border-top:1px solid var(--line)';
    const previewLabel = document.createElement('div');
    previewLabel.style.cssText = 'font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:6px';
    previewLabel.textContent = 'Location Summary';
    const previewChip = document.createElement('div');
    previewChip.style.cssText = 'font-family:"Courier New",monospace;font-size:15px;font-weight:800;color:#24598b;background:#fff;border:1.5px solid #c9d7e6;border-radius:10px;padding:10px 14px;min-height:40px;display:inline-block;min-width:160px';

    function buildLocation() {
      // Returns { area, locationRange, aisle, bay, level, side, epStart, epEnd }
      if (!selectedAisle) return { area:'', locationRange:'', aisle:'', bay:'', level:'', side:'', epStart:'', epEnd:'' };
      if (selectedAisle === 'EP') {
        const range = selectedEPStart && selectedEPEnd ? `${selectedEPStart} → ${selectedEPEnd}` :
                      selectedEPStart ? `${selectedEPStart}+` : 'EP Area (all)';
        return { area:'EP', locationRange: range, aisle:'EP', bay:'', level:'', side:'', epStart:selectedEPStart, epEnd:selectedEPEnd };
      }
      // Standard: build location string progressively
      let area = selectedAisle;
      let full  = selectedAisle;
      if (selectedBay) { area += selectedBay; full += selectedBay; }
      if (selectedLevel) { area += selectedLevel; full += selectedLevel; }
      if (selectedSide) { area += selectedSide; full += selectedSide; }
      return { area, locationRange: full, aisle: selectedAisle, bay: selectedBay, level: selectedLevel, side: selectedSide, epStart:'', epEnd:'' };
    }

    function updateAreaPreview() {
      buildEPRow();
      const loc = buildLocation();
      if (!loc.area) {
        previewChip.textContent = '—  No location selected';
        previewChip.style.color = 'var(--muted)';
      } else if (selectedAisle === 'EP') {
        const range = loc.locationRange;
        previewChip.textContent = range || 'EP Area';
        previewChip.style.color = '#24598b';
      } else {
        let txt = `Aisle ${selectedAisle}`;
        if (selectedBay) txt += `  ›  Bay ${selectedBay}`;
        if (selectedLevel) txt += `  ›  Level ${selectedLevel}`;
        if (selectedSide) txt += `  ›  Side ${selectedSide} (${selectedSide==='1'?'Left':'Right'})`;
        else if (selectedLevel) txt += '  ›  Both sides';
        previewChip.innerHTML = txt + `<br><span style="font-size:11px;opacity:.65">Code: ${loc.locationRange}</span>`;
        previewChip.style.color = '#24598b';
      }
    }

    previewWrap.appendChild(previewLabel);
    previewWrap.appendChild(previewChip);
    locSection.appendChild(previewWrap);
    body.appendChild(locSection);

    /* ── Note field ── */
    const noteInput = document.createElement('textarea');
    noteInput.rows = 2;
    noteInput.placeholder = 'Optional instructions for the associate…';
    noteInput.style.cssText = 'border:1.5px solid #c9d7e6;border-radius:12px;padding:10px 14px;font-size:14px;background:#fff;color:var(--text);width:100%;resize:vertical;font-family:inherit';
    noteInput.value = existing?.note || '';
    const noteField = mkField('Assignment Note', noteInput, true);
    body.appendChild(noteField);

    /* Footer */
    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:14px 22px;border-top:1px solid #d7e9f6;flex-shrink:0;gap:10px;flex-wrap:wrap';

    if (existing) {
      const delBtn = document.createElement('button');
      delBtn.className = 'btn danger'; delBtn.type = 'button'; delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', () => {
        if (!confirm('Delete this assignment? Count records will be kept.')) return;
        ccData.assignments = ccData.assignments.filter(a => a.id !== id);
        ccSave(ccData);
        ccCloseModal(backdrop);
        ccRenderAssignments();
        ccUpdateTabBadges();
      });
      footer.appendChild(delBtn);
    } else {
      footer.appendChild(document.createElement('span')); // spacer
    }

    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn'; saveBtn.type = 'button';
    saveBtn.textContent = existing ? 'Save Changes' : 'Create Assignment';
    saveBtn.addEventListener('click', () => {
      const loc = buildLocation();
      if (!loc.area) { alert('Please choose a location (at least pick an aisle).'); return; }
      if (!assocSelect.value) { alert('Please choose an associate.'); return; }
      const vals = {
        date:          dateInput.value || today,
        type:          typeSelect.value || 'Standard Count',
        associate:     assocSelect.value,
        area:          loc.area,
        locationRange: loc.locationRange,
        aisle:         loc.aisle,
        bay:           loc.bay,
        level:         loc.level,
        side:          loc.side,
        epStart:       loc.epStart,
        epEnd:         loc.epEnd,
        dueDate:       dueDateInput.value || today,
        note:          noteInput.value || '',
      };
      if (existing) {
        Object.assign(existing, vals);
      } else {
        ccData.assignments.unshift({ id: ccId(), status:'assigned', createdAt: ccNow(), ...vals });
      }
      ccSave(ccData);
      ccCloseModal(backdrop);
      ccRenderAssignments();
      ccUpdateTabBadges();
      ccShowToast(existing ? '✓ Assignment updated.' : '✓ Assignment created.');
    });

    if (!existing) {
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'btn secondary'; cancelBtn.type = 'button'; cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', () => ccCloseModal(backdrop));
      footer.appendChild(cancelBtn);
    }
    footer.appendChild(saveBtn);

    box.appendChild(hdr);
    box.appendChild(body);
    box.appendChild(footer);
    backdrop.appendChild(box);

    /* Close on backdrop click */
    backdrop.addEventListener('click', e => { if (e.target === backdrop) ccCloseModal(backdrop); });

    document.body.appendChild(backdrop);
    requestAnimationFrame(() => backdrop.classList.add('show'));

    /* Initial render */
    buildAisleBtns();
    buildBayRow();
    buildLevelRow();
    buildSideRow();
    buildEPRow();
    updateAreaPreview();
  }

  /* ── Verification / review modal ── */
  function ccOpenVerifyModal(countId) {
    const c = ccData.counts.find(x => x.id === countId);
    if (!c) return;
    const a = ccData.assignments.find(x => x.id === c.assignmentId) || {};
    const emps    = ccGetEmployees();
    const reasons = ccData.settings.discrepancyReasons || [];
    const attemptBatches = ccEnsureAttemptBatches(c);
    const latestBatch = ccGetLatestBatch(c);
    const entries = latestBatch ? (latestBatch.entries || []) : (c.entries || []);
    const attempts = c.verificationAttempts || [];

    const totalCounted = entries.reduce((s, e) => s + (Number(e.qty)||0), 0);

    const entriesHtml = entries.length ? `
      <div style="overflow:auto;max-height:200px;border:1px solid var(--line);border-radius:12px;margin-bottom:14px">
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr>
            <th style="padding:8px 12px;background:#fbfeff;color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.07em;text-align:left;white-space:nowrap">SKU</th>
            <th style="padding:8px 12px;background:#fbfeff;color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.07em;text-align:left">Location</th>
            <th style="padding:8px 12px;background:#fbfeff;color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.07em;text-align:left">Qty</th>
            <th style="padding:8px 12px;background:#fbfeff;color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.07em;text-align:left">By</th>
            <th style="padding:8px 12px;background:#fbfeff;color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.07em;text-align:left">Note</th>
          </tr></thead>
          <tbody>${entries.map(e => `
            <tr style="border-top:1px solid #edf4fa">
              <td style="padding:7px 12px;font-family:'Courier New',monospace;font-weight:700;color:#24598b">${ccEsc(e.sku)}</td>
              <td style="padding:7px 12px;font-family:'Courier New',monospace;font-weight:700;color:#1d4ed8">${ccEsc(e.location||'—')}</td>
              <td style="padding:7px 12px;font-weight:800">${e.qty}</td>
              <td style="padding:7px 12px;color:var(--muted)">${ccEsc(e.enteredBy||'—')}</td>
              <td style="padding:7px 12px;color:var(--muted)">${ccEsc(e.note||'')}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>` : '<p style="color:var(--muted);font-size:13px">No entries recorded.</p>';

    const submissionHistoryHtml = attemptBatches.length ? `
      <div style="margin-bottom:14px">
        <div style="margin-bottom:6px"><span class="eyebrow" style="font-size:10px">Count Submissions Tied to This Assignment</span></div>
        <div class="cc-attempt-list">
          ${attemptBatches.map((batch, i) => {
            const batchTotal = (batch.entries || []).reduce((s, e) => s + (Number(e.qty)||0), 0);
            const diff = c.systemQty !== null && c.systemQty !== undefined ? batchTotal - Number(c.systemQty) : null;
            return `
              <div class="cc-attempt-row" style="align-items:flex-start">
                <div class="cc-attempt-num">${i + 1}</div>
                <div class="cc-attempt-detail">
                  <strong>${ccEsc(batch.associate || '—')}</strong> counted <strong>${batchTotal}</strong> units across <strong>${(batch.entries || []).length}</strong> SKUs
                  <span>${ccFmtDate(batch.date || c.date)} · ${ccFmtDT(batch.submittedAt)}${diff !== null ? ` · Diff vs system: ${diff >= 0 ? '+' : ''}${diff}` : ''}</span>
                </div>
              </div>`;
          }).join('')}
        </div>
      </div>` : '';

    const attemptsHtml = attempts.length ? `
      <div class="cc-attempt-list" style="margin-bottom:14px">
        ${attempts.map((att, i) => `
          <div class="cc-attempt-row">
            <div class="cc-attempt-num">${i + 1}</div>
            <div class="cc-attempt-detail">
              <strong>${att.qty}</strong> units
              <span>By ${ccEsc(att.by)} · ${ccFmtDT(att.ts)}${att.note ? ` · ${ccEsc(att.note)}` : ''}</span>
            </div>
          </div>`).join('')}
      </div>` : '';

    const modal = ccCreateModal('cc-modal-wide',
      `Verify: ${ccEsc(a.area || c.area || '—')}`,
      `${ccEsc((latestBatch && latestBatch.associate) || c.associate)} · ${ccFmtDate((latestBatch && latestBatch.date) || c.date)} · ${entries.length} SKUs · ${totalCounted} units`,
      `
        <div class="cc-form-2col" style="margin-bottom:14px">
          <div class="cc-kpi-card" style="border:1px solid var(--line)">
            <div class="cc-kpi-label">Total Counted</div>
            <div class="cc-kpi-value">${totalCounted}</div>
            <div class="cc-kpi-sub">${entries.length} SKUs by ${ccEsc((latestBatch && latestBatch.associate) || c.associate)}</div>
          </div>
          <div class="cc-kpi-card" style="border:1px solid var(--line)">
            <div class="cc-kpi-label">System Qty</div>
            <input type="number" id="vfSystemQty" value="${c.systemQty !== null && c.systemQty !== undefined ? c.systemQty : ''}" placeholder="Enter system quantity" style="font-size:20px;font-weight:900;border:1.5px solid #c9d7e6;border-radius:10px;padding:6px 10px;width:100%;margin-top:6px">
          </div>
        </div>

        <details style="margin-bottom:14px">
          <summary style="font-size:13px;font-weight:700;color:#24598b;cursor:pointer;padding:4px 0">View ${entries.length} counted SKUs</summary>
          ${entriesHtml}
        </details>

        ${submissionHistoryHtml}
        ${attemptsHtml ? `<div style="margin-bottom:6px"><span class="eyebrow" style="font-size:10px">Verification Notes / Checks</span></div>${attemptsHtml}` : ''}

        <div style="margin-bottom:14px">
          <span class="eyebrow" style="font-size:10px;display:block;margin-bottom:8px">Add Verification Attempt</span>
          <div class="cc-form-3col">
            <div class="cc-field">
              <label>Counted By</label>
              <select id="vfWho">
                <option value="">— Select —</option>
                ${emps.map(n => `<option value="${ccEsc(n)}">${ccEsc(n)}</option>`).join('')}
              </select>
            </div>
            <div class="cc-field">
              <label>Qty Found</label>
              <input type="number" id="vfQty" min="0" placeholder="0">
            </div>
            <div class="cc-field">
              <label>Note</label>
              <input type="text" id="vfNote" placeholder="optional">
            </div>
          </div>
          <button class="btn secondary" type="button" id="vfAddAttemptBtn" style="margin-top:8px">+ Log Attempt</button>
        </div>

        <div class="cc-form-2col" style="margin-bottom:10px">
          <div class="cc-field">
            <label>Discrepancy Reason</label>
            <select id="vfReason">
              <option value="">— None —</option>
              ${reasons.map(r => `<option value="${ccEsc(r)}"${c.discrepancyReason===r?' selected':''}>${ccEsc(r)}</option>`).join('')}
            </select>
          </div>
          <div class="cc-field">
            <label>Confirmer Name</label>
            <select id="vfConfirmer">
              <option value="">— Select —</option>
              ${emps.map(n => `<option value="${ccEsc(n)}"${c.confirmer===n?' selected':''}>${ccEsc(n)}</option>`).join('')}
            </select>
          </div>
          <div class="cc-field cc-form-full">
            <label>Notes / Investigation</label>
            <textarea id="vfNotes" rows="2" placeholder="Investigation notes, root cause, follow-up…">${ccEsc(c.notes||'')}</textarea>
          </div>
        </div>
      `,
      [
        { label:'Send for Recount',  cls:'btn warn',    id:'vfRecountBtn'  },
        { label:'Confirm Resolution', cls:'btn',        id:'vfConfirmBtn'  },
      ]
    );

    document.body.appendChild(modal);
    requestAnimationFrame(() => modal.classList.add('show'));

    function ccReadVerifyForm() {
      return {
        systemQty:          modal.querySelector('#vfSystemQty')?.value !== '' ? Number(modal.querySelector('#vfSystemQty').value) : null,
        discrepancyReason:  modal.querySelector('#vfReason')?.value || null,
        confirmer:          modal.querySelector('#vfConfirmer')?.value || null,
        notes:              modal.querySelector('#vfNotes')?.value || '',
      };
    }

    modal.querySelector('#vfAddAttemptBtn')?.addEventListener('click', () => {
      const who = modal.querySelector('#vfWho')?.value;
      const qty = modal.querySelector('#vfQty')?.value;
      const note= modal.querySelector('#vfNote')?.value || '';
      if (!who) { alert('Choose who did this count.'); return; }
      if (qty === '' || qty === null) { alert('Enter the quantity found.'); return; }
      if (!c.verificationAttempts) c.verificationAttempts = [];
      c.verificationAttempts.push({ id:ccId(), by:who, qty:Number(qty), note, ts:ccNow() });
      Object.assign(c, ccReadVerifyForm());
      ccSave(ccData);
      ccCloseModal(modal);
      ccOpenVerifyModal(countId); // reopen refreshed
    });

    modal.querySelector('#vfConfirmBtn')?.addEventListener('click', () => {
      const vals = ccReadVerifyForm();
      if (!vals.confirmer) { alert('Please select who is confirming this.'); return; }
      if (vals.systemQty === null || Number.isNaN(vals.systemQty)) { alert('Please enter the system quantity first.'); return; }

      const isMatch = Number(totalCounted) === Number(vals.systemQty);
      Object.assign(c, vals, {
        status: isMatch ? 'confirmed' : 'discrepancy',
        finalQty: totalCounted,
        finalStatus: isMatch ? 'correct' : 'discrepancy',
        confirmedAt: ccNow(),
      });
      const assign = ccData.assignments.find(x => x.id === c.assignmentId);
      if (assign) assign.status = isMatch ? 'confirmed' : 'discrepancy';
      ccSave(ccData);
      ccCloseModal(modal);
      ccRenderReview();
      ccUpdateTabBadges();
      ccShowToast(isMatch ? '✓ Count confirmed — matches system.' : '⚠ Count confirmed as discrepancy — latest count does not match system.');
    });

    modal.querySelector('#vfRecountBtn')?.addEventListener('click', () => {
      // Save any form changes first, then open the assign-recount modal
      const vals = ccReadVerifyForm();
      Object.assign(c, vals);
      ccSave(ccData);
      ccCloseModal(modal);
      ccOpenAssignRecountModal(c);
    });

    modal.addEventListener('click', e => { if (e.target === modal) ccCloseModal(modal); });
  }

  /* ── Assign Recount Modal ── */
  /* Opens after "Send for Recount" — lets the reviewer pick who should recount
     and creates a new assignment that appears in that person's My Work tab. */
  function ccOpenAssignRecountModal(countRec) {
    const origAssign = ccData.assignments.find(x => x.id === countRec.assignmentId) || {};
    const emps = ccGetEmployees();
    const today = ccToday();

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.style.cssText = 'display:flex;z-index:2100;';

    const box = document.createElement('div');
    box.style.cssText = [
      'background:#fff', 'border-radius:24px',
      'box-shadow:0 22px 60px rgba(23,50,74,.26)',
      'border:1px solid #d7e9f6', 'width:min(480px,100%)',
      'max-height:90vh', 'display:flex', 'flex-direction:column',
      'overflow:hidden',
    ].join(';');

    // Header
    const hdr = document.createElement('div');
    hdr.style.cssText = 'display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:20px 22px 16px;border-bottom:1px solid #d7e9f6;flex-shrink:0';
    hdr.innerHTML = `
      <div>
        <div class="eyebrow">Cycle Count — Recount</div>
        <h2 style="margin:4px 0 2px;font-size:20px;font-weight:900">Assign Recount</h2>
        <p style="margin:0;font-size:13px;color:var(--muted)">
          Area: <strong>${ccEsc(origAssign.area || countRec.area || '—')}</strong>
          &nbsp;·&nbsp; Original count by <strong>${ccEsc(countRec.associate)}</strong>
        </p>
      </div>`;
    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn secondary';
    closeBtn.style.cssText = 'flex-shrink:0;padding:8px 14px';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', () => ccCloseModal(backdrop));
    hdr.appendChild(closeBtn);
    box.appendChild(hdr);

    // Body
    const body = document.createElement('div');
    body.style.cssText = 'padding:20px 22px;overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:14px';

    // Info card showing what's being recounted
    const infoCard = document.createElement('div');
    infoCard.style.cssText = 'background:var(--blue1);border:1px solid var(--line);border-radius:14px;padding:14px 16px;display:flex;gap:14px;flex-wrap:wrap';
    const entries = countRec.entries || [];
    const totalUnits = entries.reduce((s, e) => s + (Number(e.qty) || 0), 0);
    infoCard.innerHTML = `
      <div style="flex:1;min-width:120px">
        <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:4px">Area</div>
        <div style="font-size:20px;font-weight:900;color:var(--text)">${ccEsc(origAssign.area || countRec.area || '—')}</div>
        ${origAssign.locationRange ? `<span class="cc-loc-range" style="margin-top:4px;display:inline-block">${ccEsc(origAssign.locationRange)}</span>` : ''}
      </div>
      <div style="flex:1;min-width:120px">
        <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:4px">Original Count</div>
        <div style="font-size:16px;font-weight:800;color:var(--text)">${entries.length} SKUs · ${totalUnits} units</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px">by ${ccEsc(countRec.associate)} on ${ccFmtDate(countRec.date)}</div>
      </div>`;
    body.appendChild(infoCard);

    // Who should recount
    function mkLbl(text) {
      const l = document.createElement('div');
      l.style.cssText = 'font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:6px';
      l.textContent = text;
      return l;
    }

    const whoWrap = document.createElement('div');
    whoWrap.appendChild(mkLbl('Who should recount this?'));
    const whoSelect = document.createElement('select');
    whoSelect.style.cssText = 'width:100%;border:1.5px solid #c9d7e6;border-radius:12px;padding:12px 14px;font-size:15px;font-weight:700;background:#fff;color:var(--text)';
    const blank = document.createElement('option');
    blank.value = ''; blank.textContent = '— Choose associate —';
    whoSelect.appendChild(blank);
    emps.forEach(n => {
      const o = document.createElement('option');
      o.value = o.textContent = n;
      // Default to someone other than the original counter if possible
      if (n === countRec.associate) o.style.color = 'var(--muted)';
      whoSelect.appendChild(o);
    });
    whoWrap.appendChild(whoSelect);
    body.appendChild(whoWrap);

    // Due date
    const dateWrap = document.createElement('div');
    dateWrap.appendChild(mkLbl('Due Date'));
    const dateInput = document.createElement('input');
    dateInput.type = 'date';
    dateInput.value = today;
    dateInput.style.cssText = 'width:100%;border:1.5px solid #c9d7e6;border-radius:12px;padding:11px 14px;font-size:14px;background:#fff;color:var(--text)';
    dateWrap.appendChild(dateInput);
    body.appendChild(dateWrap);

    // Recount note
    const noteWrap = document.createElement('div');
    noteWrap.appendChild(mkLbl('Note for the associate (optional)'));
    const noteInput = document.createElement('textarea');
    noteInput.rows = 2;
    noteInput.placeholder = 'e.g. Check shelf carefully, system shows 12 units...';
    noteInput.style.cssText = 'width:100%;border:1.5px solid #c9d7e6;border-radius:12px;padding:11px 14px;font-size:14px;background:#fff;color:var(--text);resize:vertical;font-family:inherit';
    noteInput.addEventListener('click', e => e.stopPropagation());
    noteInput.addEventListener('mousedown', e => e.stopPropagation());
    noteWrap.appendChild(noteInput);
    body.appendChild(noteWrap);

    // Warning if assigning back to original counter
    const warnDiv = document.createElement('div');
    warnDiv.style.cssText = 'font-size:12px;color:#b45309;background:#fef9c3;border:1px solid #fde68a;border-radius:10px;padding:10px 14px;display:none';
    warnDiv.textContent = `Note: You're assigning this back to ${countRec.associate}, who did the original count.`;
    body.appendChild(warnDiv);
    whoSelect.addEventListener('change', () => {
      warnDiv.style.display = whoSelect.value === countRec.associate ? 'block' : 'none';
    });

    box.appendChild(body);

    // Footer
    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;justify-content:flex-end;align-items:center;gap:10px;padding:14px 22px;border-top:1px solid #d7e9f6;flex-shrink:0;flex-wrap:wrap';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn secondary';
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => ccCloseModal(backdrop));

    const assignBtn = document.createElement('button');
    assignBtn.className = 'btn';
    assignBtn.type = 'button';
    assignBtn.textContent = 'Assign Recount →';
    assignBtn.addEventListener('click', () => {
      if (!whoSelect.value) {
        whoSelect.style.borderColor = '#ef4444';
        whoSelect.focus();
        return;
      }
      whoSelect.style.borderColor = '';

      // Mark the root count thread as awaiting a recount submission
      countRec.status = 'recount';
      countRec.recountAssignedTo = whoSelect.value;
      countRec.recountAssignedAt = ccNow();

      // Mark the original assignment as recount
      const origA = ccData.assignments.find(x => x.id === countRec.assignmentId);
      if (origA) origA.status = 'recount';

      // Create a brand-new assignment for the chosen associate
      const recountAssign = {
        id:            ccId(),
        status:        'assigned',
        createdAt:     ccNow(),
        date:          dateInput.value || today,
        dueDate:       dateInput.value || today,
        type:          'Recount',
        associate:     whoSelect.value,
        area:          origAssign.area  || countRec.area  || '—',
        locationRange: origAssign.locationRange || '',
        aisle:         origAssign.aisle || '',
        bay:           origAssign.bay   || '',
        level:         origAssign.level || '',
        side:          origAssign.side  || '',
        epStart:       origAssign.epStart || '',
        epEnd:         origAssign.epEnd   || '',
        note:          noteInput.value || '',
        // Link back so reviewers can trace the chain
        recountOfCountId:      countRec.id,
        recountOfAssignmentId: countRec.assignmentId,
        originalAssociate:     countRec.associate,
      };
      ccData.assignments.unshift(recountAssign);

      ccSave(ccData);
      ccCloseModal(backdrop);
      ccRenderReview();
      ccUpdateTabBadges();
      ccShowToast(`↩ Recount assigned to ${whoSelect.value}.`);
    });

    footer.appendChild(cancelBtn);
    footer.appendChild(assignBtn);
    box.appendChild(footer);

    backdrop.appendChild(box);
    backdrop.addEventListener('click', e => { if (e.target === backdrop) ccCloseModal(backdrop); });
    document.body.appendChild(backdrop);
    requestAnimationFrame(() => backdrop.classList.add('show'));
  }

  /* ── Generic modal builder ── */
  /* Uses .cc-modal-box (not .modal) for the inner container so base.css overflow:auto
     doesn't create a clipping context that breaks inputs and position:fixed dropdowns. */
  function ccCreateModal(sizeClass, title, subtitle, bodyHtml, footerBtns) {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.style.cssText = 'display:flex;z-index:2000;';

    const box = document.createElement('div');
    box.className = 'cc-modal-box ' + (sizeClass || '');
    box.style.cssText = [
      'background:#fff',
      'border-radius:24px',
      'box-shadow:0 22px 60px rgba(23,50,74,.22)',
      'border:1px solid #d7e9f6',
      'width:min(700px,100%)',
      'max-height:90vh',
      'display:flex',
      'flex-direction:column',
      'overflow:hidden',
      'position:relative',
    ].join(';');

    // Header
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:20px 22px 16px;border-bottom:1px solid #d7e9f6;flex-shrink:0';
    header.innerHTML = `
      <div>
        <div class="eyebrow">Cycle Count</div>
        <h2 style="margin:4px 0 2px;font-size:22px;font-weight:900">${title}</h2>
        ${subtitle ? `<p style="margin:0;font-size:13px;color:var(--muted)">${subtitle}</p>` : ''}
      </div>
      <button class="btn secondary cc-modal-close-btn" type="button" style="flex-shrink:0">✕</button>`;

    // Body — scrollable, no overflow:hidden so dropdowns work
    const body = document.createElement('div');
    body.style.cssText = 'padding:20px 22px;overflow-y:auto;flex:1;overflow-x:visible';
    body.innerHTML = bodyHtml;

    // Footer
    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;justify-content:flex-end;align-items:center;gap:10px;padding:14px 22px;border-top:1px solid #d7e9f6;flex-shrink:0;flex-wrap:wrap';
    (footerBtns || []).forEach(b => {
      const btn = document.createElement('button');
      btn.className = b.cls;
      btn.type = 'button';
      btn.id = b.id;
      btn.textContent = b.label;
      footer.appendChild(btn);
    });

    box.appendChild(header);
    box.appendChild(body);
    box.appendChild(footer);
    backdrop.appendChild(box);

    header.querySelector('.cc-modal-close-btn')?.addEventListener('click', () => ccCloseModal(backdrop));
    return backdrop;
  }

  function ccCloseModal(modal) {
    modal.classList.remove('show');
    setTimeout(() => { if (modal.parentNode) modal.parentNode.removeChild(modal); }, 200);
  }

  /* ── Toast ── */
  function ccShowToast(msg) {
    let toast = document.getElementById('ccToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'ccToast';
      toast.style.cssText = 'position:fixed;bottom:28px;left:50%;transform:translateX(-50%);background:#1d3a5c;color:#fff;padding:12px 22px;border-radius:14px;font-size:14px;font-weight:700;z-index:9999;box-shadow:0 8px 24px rgba(0,0,0,.22);pointer-events:none;opacity:0;transition:opacity .2s';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = '1';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { toast.style.opacity = '0'; }, 2800);
  }

  /* ══════════════════════════════════════════
     INIT
  ══════════════════════════════════════════ */
  function ccInit() {
    // Bind tabs
    page.querySelectorAll('.cc-tab').forEach(btn => {
      btn.addEventListener('click', () => ccSwitchTab(btn.dataset.tab));
    });

    // Initial render
    ccSwitchTab('my-work');
  }

  // Wait for DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ccInit);
  } else {
    ccInit();
  }

})();
