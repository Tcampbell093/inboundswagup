/**
 * huddle-module.js
 * Daily Brief / Huddle Dashboard
 * Reads from existing shared state (window.__sordState, assemblyBoardRows,
 * attendanceRecords, etc.) and persists recap notes + SORD snapshots via
 * /.netlify/functions/huddle-sync
 */
(function () {
  'use strict';

  const HUDDLE_API = '/.netlify/functions/huddle-sync';
  const RECAP_CACHE_KEY = 'ops_hub_huddle_recaps_v1';

  // ── tiny helpers ──────────────────────────────────────────────────────────
  function qs(sel, root) { return (root || document).querySelector(sel); }
  function isoToday() { return new Date().toISOString().slice(0, 10); }
  function safeNum(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
  function fmtInt(v) { return safeNum(v).toLocaleString(); }
  function esc(v) { return typeof escapeHtml === 'function' ? escapeHtml(v) : String(v ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }
  function dateLabel(iso) {
    if (!iso) return '—';
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }
  function daysUntil(isoStr) {
    if (!isoStr) return null;
    const today = new Date(isoToday() + 'T00:00:00');
    const target = new Date(isoStr + 'T00:00:00');
    return Math.round((target - today) / 86400000);
  }

  // ── SORD data bridge ──────────────────────────────────────────────────────
  function getSordDataset() {
    try { return (window.__sordState && Array.isArray(window.__sordState.dataset)) ? window.__sordState.dataset : []; }
    catch (_) { return []; }
  }

  function getSordDetailRows() {
    try {
      return (window.__sordState && window.__sordState.imports && Array.isArray(window.__sordState.imports.eomRows))
        ? window.__sordState.imports.eomRows
        : [];
    } catch (_) {
      return [];
    }
  }

  function moneyFromRow(row, qtyOverride) {
    const qty = Math.max(safeNum(qtyOverride), 0);
    const orderedQty = Math.max(safeNum(row.quantity || row.totalQty), 0);
    const receivedQty = Math.max(safeNum(row.quantityReceived), 0);

    const unitCandidates = [
      safeNum(row.unitPrice),
      orderedQty > 0 ? safeNum(row.lineItemPrice) / orderedQty : 0,
      orderedQty > 0 ? safeNum(row.subtotal) / orderedQty : 0,
      orderedQty > 0 ? safeNum(row.originalSubtotal) / orderedQty : 0,
      orderedQty > 0 ? safeNum(row.invoiceTotal) / orderedQty : 0,
      receivedQty > 0 ? safeNum(row.floorValue) / receivedQty : 0,
      0,
    ];
    const unit = unitCandidates.find(v => v > 0) || 0;
    if (qty > 0 && unit > 0) return qty * unit;

    const direct = safeNum(row.floorValue || row.lineItemPrice || row.invoiceTotal || row.subtotal || row.originalSubtotal);
    return direct > 0 ? direct : 0;
  }

  function getFloorStats() {
    const detailRows = getSordDetailRows();
    if (detailRows.length) {
      const receivingKeys = new Set();
      const prepKeys = new Set();
      let receivingUnits = 0;
      let prepUnits = 0;
      let receivingOrderedUnits = 0;
      let prepOrderedUnits = 0;
      let receivingReceivedUnits = 0;
      let prepReceivedUnits = 0;
      let receivingValue = 0;
      let prepValue = 0;
      let newestReceivedAt = '';

      detailRows.forEach(row => {
        const statuses = [row.status, row.poStatus].filter(Boolean).join(' ').toLowerCase();
        const orderedQty = Math.max(safeNum(row.quantity || row.totalQty), 0);
        const qtyReceived = Math.max(safeNum(row.quantityReceived || row.quantity_received || row.received_quantity), 0);
        const potentialQty = Math.max(orderedQty - qtyReceived, 0);
        const poKey = row.purchaseOrderId || row.purchaseOrderName || row.sord || row.salesOrderId || '';
        const receivedAt = String(row.itemReceivedAtWarehouseDate || row.receivedAtWarehouseDate || row.itemReceivedDate || '').trim();
        if (receivedAt && (!newestReceivedAt || new Date(receivedAt) > new Date(newestReceivedAt))) newestReceivedAt = receivedAt;

        if (statuses.includes('partially received')) {
          if (poKey) receivingKeys.add(poKey);
          receivingOrderedUnits += orderedQty;
          receivingReceivedUnits += qtyReceived;
          receivingUnits += potentialQty;
          receivingValue += moneyFromRow(row, potentialQty);
        }
        if (statuses.includes('fully received')) {
          if (poKey) prepKeys.add(poKey);
          prepOrderedUnits += orderedQty;
          prepReceivedUnits += qtyReceived;
          prepUnits += potentialQty;
          prepValue += moneyFromRow(row, potentialQty);
        }
      });

      return {
        receivingPOs: receivingKeys.size,
        receivingUnits,
        receivingOrderedUnits,
        receivingReceivedUnits,
        receivingValue,
        prepPOs: prepKeys.size,
        prepUnits,
        prepOrderedUnits,
        prepReceivedUnits,
        prepValue,
        newestReceivedAt,
        source: 'detail'
      };
    }

    const dataset = getSordDataset();
    const qaReceiving = dataset.filter(item => {
      const s = [item.status, item.poStatus].filter(Boolean).join(' ').toLowerCase();
      return s.includes('partially received');
    });
    const qaPrep = dataset.filter(item => {
      const s = [item.status, item.poStatus].filter(Boolean).join(' ').toLowerCase();
      return s.includes('fully received') || s.includes('fully received at warehouse') || s.includes('item fully received');
    });
    const receivingUnits = qaReceiving.reduce((s, i) => s + safeNum(i.totalQty), 0);
    const prepUnits = qaPrep.reduce((s, i) => s + safeNum(i.totalQty), 0);
    const receivingValue = qaReceiving.reduce((s, i) => s + safeNum(i.subtotal || i.invoiceTotal || i.originalSubtotal), 0);
    const prepValue = qaPrep.reduce((s, i) => s + safeNum(i.subtotal || i.invoiceTotal || i.originalSubtotal), 0);

    return {
      receivingPOs: qaReceiving.length,
      receivingUnits,
      receivingOrderedUnits: receivingUnits,
      receivingReceivedUnits: 0,
      receivingValue,
      prepPOs: qaPrep.length,
      prepUnits,
      prepOrderedUnits: prepUnits,
      prepReceivedUnits: 0,
      prepValue,
      newestReceivedAt: '',
      source: 'summary'
    };
  }

  function getIncomingPotential() {
    const dataset = getSordDataset();
    const today = isoToday();
    const d1 = new Date(today + 'T00:00:00'); d1.setDate(d1.getDate() + 1);
    const d3 = new Date(today + 'T00:00:00'); d3.setDate(d3.getDate() + 3);
    const iso1 = d1.toISOString().slice(0, 10);
    const iso3 = d3.toISOString().slice(0, 10);

    const incomingStatuses = new Set([
      'ship date confirmed',
      'item shipped from supplier',
      'shipping from supplier',
      'shipped from supplier',
    ]);

    const incoming = dataset.filter(item => {
      const s = String(item.status || item.poStatus || '').toLowerCase();
      return incomingStatuses.has(s) || s.includes('ship date confirmed') || s.includes('shipped from supplier') || s.includes('shipping from supplier');
    });

    const buckets = { today: [], tomorrow: [], within3: [], later: [] };
    incoming.forEach(item => {
      const eta = item.earliestEta || item.earliestIhd || '';
      const du = eta ? daysUntil(eta) : null;
      if (du === null) { buckets.later.push(item); return; }
      if (du <= 0) buckets.today.push(item);
      else if (du === 1) buckets.tomorrow.push(item);
      else if (du <= 3) buckets.within3.push(item);
      else buckets.later.push(item);
    });
    return buckets;
  }

  function getAssemblyBrief() {
    const today = isoToday();
    const boardRows = (typeof assemblyBoardRows !== 'undefined' && Array.isArray(assemblyBoardRows))
      ? assemblyBoardRows : [];
    const todayRows = boardRows.filter(r => String(r.date || '') === today);
    const totalUnits = todayRows.reduce((s, r) => s + safeNum(r.qty) * safeNum(r.products), 0);
    const totalPacks = todayRows.reduce((s, r) => s + safeNum(r.qty), 0);
    const doneUnits = todayRows.filter(r => r.stage === 'done').reduce((s, r) => s + safeNum(r.qty) * safeNum(r.products), 0);
    const donePacks = todayRows.filter(r => r.stage === 'done').reduce((s, r) => s + safeNum(r.qty), 0);
    const doneRows = todayRows.filter(r => r.stage === 'done').length;

    // Available (unscheduled ready-to-pack backup)
    const availRows = (typeof availableQueueRows !== 'undefined' && Array.isArray(availableQueueRows))
      ? availableQueueRows : [];
    const backupUnits = availRows.reduce((s, r) => s + safeNum(r.units || r.qty * r.products), 0);
    const backupPacks = availRows.reduce((s, r) => s + safeNum(r.qty), 0);

    return {
      scheduledPBs: todayRows.length,
      totalUnits,
      totalPacks,
      doneUnits,
      donePacks,
      doneRows,
      backupPBs: availRows.length,
      backupUnits,
      backupPacks,
    };
  }

  function getAttendanceBrief() {
    const today = isoToday();
    const records = (typeof attendanceRecords !== 'undefined' && Array.isArray(attendanceRecords))
      ? attendanceRecords : [];
    const todayRecs = records.filter(r => r.date === today);
    const present = todayRecs.filter(r => r.mark === 'Present' || r.mark === 'Late').length;
    const late = todayRecs.filter(r => r.mark === 'Late').length;
    const absent = todayRecs.filter(r => ['Absent', 'Call Out', 'No Call No Show'].includes(r.mark)).length;
    return { present, late, absent, total: todayRecs.length };
  }

  // ── API helpers ───────────────────────────────────────────────────────────
  async function apiGet(qs_extra) {
    const url = HUDDLE_API + (qs_extra ? '?' + qs_extra : '');
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (!res.ok) throw new Error(data?.error || `Huddle API error (${res.status})`);
    return data;
  }

  async function apiPost(body) {
    const res = await fetch(HUDDLE_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (!res.ok) throw new Error(data?.error || `Huddle API error (${res.status})`);
    return data;
  }

  // ── State ─────────────────────────────────────────────────────────────────
  const state = {
    recaps: [],           // from Neon
    snapshotDates: [],    // dates we have SORD history for
    recapDate: isoToday(),
    recapDraft: null,     // currently editing
    syncEnabled: false,
    loaded: false,
    historyDate: '',
    historyRows: [],
  };

  // ── Load from backend ─────────────────────────────────────────────────────
  async function loadFromBackend() {
    try {
      const data = await apiGet();
      if (Array.isArray(data.recaps)) {
        state.recaps = data.recaps;
        try { localStorage.setItem(RECAP_CACHE_KEY, JSON.stringify(state.recaps)); } catch (_) {}
      }
      if (Array.isArray(data.snapshotDates)) state.snapshotDates = data.snapshotDates;
      state.syncEnabled = true;
    } catch (err) {
      console.warn('Huddle sync unavailable, using cache.', err);
      try {
        const cached = localStorage.getItem(RECAP_CACHE_KEY);
        if (cached) state.recaps = JSON.parse(cached);
      } catch (_) {}
      state.syncEnabled = false;
    } finally {
      state.loaded = true;
    }
  }

  // ── Save recap ────────────────────────────────────────────────────────────
  async function saveRecap(recap) {
    if (!state.syncEnabled) {
      // Optimistic local save
      const idx = state.recaps.findIndex(r => r.date === recap.date);
      if (idx >= 0) state.recaps[idx] = { ...state.recaps[idx], ...recap };
      else state.recaps.unshift(recap);
      try { localStorage.setItem(RECAP_CACHE_KEY, JSON.stringify(state.recaps)); } catch (_) {}
      return;
    }
    try {
      const data = await apiPost({ recap });
      if (Array.isArray(data.recaps)) {
        state.recaps = data.recaps;
        try { localStorage.setItem(RECAP_CACHE_KEY, JSON.stringify(state.recaps)); } catch (_) {}
      }
    } catch (err) {
      console.error('Recap save failed', err);
      throw err;
    }
  }

  // ── Save SORD snapshot (called externally) ────────────────────────────────
  window.huddleSaveSordSnapshot = async function huddleSaveSordSnapshot(dataset, importedAt) {
    if (!dataset || !dataset.length) return;
    try {
      const snapshotDate = isoToday();
      const snapshot = dataset.map(item => ({
        sordId: item.sord || item.salesOrderId || '',
        salesOrderId: item.salesOrderId || '',
        account: item.account || '',
        status: item.status || '',
        poStatus: item.poStatus || '',
        units: safeNum(item.totalQty),
        packs: safeNum(item.pbCount),
        subtotal: safeNum(item.subtotal),
        earliestIhd: item.earliestIhd || null,
        latestIhd: item.latestIhd || null,
        earliestEta: item.earliestEta || null,
        readiness: item.readiness || '',
        complexity: item.complexity || '',
        poCount: safeNum(item.poCount),
        supplierCount: safeNum(item.supplierCount),
        pbCount: safeNum(item.pbCount),
        flagCount: safeNum(item.flagCount),
        meta: {},
      }));
      const data = await apiPost({ snapshot, snapshotDate, importedAt: importedAt || new Date().toISOString() });
      if (Array.isArray(data.snapshotDates)) state.snapshotDates = data.snapshotDates;
      console.info(`[Huddle] Snapshot saved for ${snapshotDate}: ${snapshot.length} SORD rows.`);
    } catch (err) {
      console.warn('[Huddle] Snapshot save failed (non-fatal):', err);
    }
  };

  // ── Render helpers ────────────────────────────────────────────────────────
  function statusChip(status, label) {
    const cls = status === 'good' ? 'mc-status-good' : status === 'risk' ? 'mc-status-risk' : 'mc-status-watch';
    return `<span class="mc-status-chip ${cls}">${label || status}</span>`;
  }

  function floorCard(title, metric, sub, pills, status) {
    const cls = status === 'good' ? 'mc-status-good' : status === 'risk' ? 'mc-status-risk' : 'mc-status-watch';
    const statusLabel = status === 'good' ? 'Ready' : status === 'risk' ? 'Empty' : 'Pending';
    return `<article class="mc-dept-card huddle-floor-card">
      <div class="mc-dept-top">
        <div class="eyebrow">${esc(title)}</div>
        <span class="mc-status-chip ${cls}">${statusLabel}</span>
      </div>
      <div class="mc-dept-metric">${metric}</div>
      <div class="mc-dept-sub">${sub}</div>
      <div class="mc-mini-list">${pills.map(p => `<span class="mc-mini-pill">${p}</span>`).join('')}</div>
    </article>`;
  }

  function incomingBucket(label, items, urgency) {
    const units = items.reduce((s, i) => s + safeNum(i.totalQty), 0);
    const cls = urgency === 'high' ? 'huddle-bucket-high' : urgency === 'med' ? 'huddle-bucket-med' : 'huddle-bucket-low';
    return `<article class="huddle-incoming-bucket ${cls}">
      <div class="huddle-bucket-label">${esc(label)}</div>
      <div class="huddle-bucket-metric">${items.length} <span class="huddle-bucket-unit">POs</span></div>
      <div class="mc-dept-sub">${fmtInt(units)} units</div>
      ${items.slice(0, 4).map(i => `<div class="huddle-bucket-row">
        <span>${esc(i.sord || i.salesOrderId || '—')}</span>
        <span class="huddle-bucket-meta">${esc(i.account || '')}${i.earliestEta ? ` · ETA ${dateLabel(i.earliestEta)}` : ''}</span>
      </div>`).join('')}
      ${items.length > 4 ? `<div class="huddle-bucket-more">+${items.length - 4} more</div>` : ''}
    </article>`;
  }

  // ── Render full page ──────────────────────────────────────────────────────
  function render() {
    const root = document.getElementById('huddlePage');
    if (!root) return;

    const floor = getFloorStats();
    const asm = getAssemblyBrief();
    const att = getAttendanceBrief();
    const incoming = getIncomingPotential();
    const today = isoToday();

    // ── Floor Now ────────────────────────────────────────────
    const floorNow = qs('#huddleFloorNow');
    if (floorNow) {
      // workable = ordered − received (units we can actually touch)
      const rcvWorkable = Math.max(0, floor.receivingOrderedUnits - floor.receivingReceivedUnits);
      const prepWorkable = Math.max(0, floor.prepOrderedUnits - floor.prepReceivedUnits);
      const rcvHasData   = floor.receivingOrderedUnits > 0 || floor.receivingReceivedUnits > 0;
      const prepHasData  = floor.prepOrderedUnits > 0     || floor.prepReceivedUnits > 0;

      floorNow.innerHTML = [
        floorCard(
          'QA Receiving',
          fmtInt(floor.receivingPOs) + ' POs',
          rcvHasData
            ? `${fmtInt(rcvWorkable)} workable units`
            : `${fmtInt(floor.receivingUnits)} units on floor`,
          rcvHasData
            ? [
                `Ordered: ${fmtInt(floor.receivingOrderedUnits)}`,
                `Received so far: ${fmtInt(floor.receivingReceivedUnits)}`,
                `Workable: ${fmtInt(rcvWorkable)}`
              ]
            : [`Items Partially Received`],
          floor.receivingPOs > 0 ? 'good' : 'risk'
        ),
        floorCard(
          'QA Prep',
          fmtInt(floor.prepPOs) + ' POs',
          prepHasData
            ? `${fmtInt(prepWorkable)} workable units`
            : `${fmtInt(floor.prepUnits)} units ready`,
          prepHasData
            ? [
                `Ordered: ${fmtInt(floor.prepOrderedUnits)}`,
                `Received so far: ${fmtInt(floor.prepReceivedUnits)}`,
                `Workable: ${fmtInt(prepWorkable)}`
              ]
            : [`Items Fully Received`],
          floor.prepPOs > 0 ? 'good' : 'risk'
        ),
        floorCard(
          'Assembly Today',
          fmtInt(asm.scheduledPBs) + ' PBs',
          `${fmtInt(asm.totalUnits)} units scheduled • ${fmtInt(asm.totalPacks)} packs`,
          [`Done: ${fmtInt(asm.doneUnits)} units • ${fmtInt(asm.donePacks)} packs`, `PBs done: ${asm.doneRows}`],
          asm.scheduledPBs > 0 ? 'good' : 'risk'
        ),
        floorCard(
          'Backup / Available',
          fmtInt(asm.backupPBs) + ' PBs',
          `${fmtInt(asm.backupUnits)} units ready-to-pack • ${fmtInt(asm.backupPacks)} packs`,
          [`Unscheduled queue`],
          asm.backupPBs > 0 ? 'watch' : 'risk'
        ),
      ].join('');
    }

    // ── Attendance strip ─────────────────────────────────────
    const attStrip = qs('#huddleAttendance');
    if (attStrip) {
      const ratio = att.present / Math.max(att.total, 1);
      const cls = ratio >= 0.9 && att.absent === 0 ? 'mc-status-good' : ratio >= 0.75 ? 'mc-status-watch' : 'mc-status-risk';
      attStrip.innerHTML = `
        <span class="mc-status-chip ${cls}">${att.present} present</span>
        ${att.late ? `<span class="mc-mini-pill">⚠ ${att.late} late</span>` : ''}
        ${att.absent ? `<span class="mc-mini-pill" style="background:#ffe3e3;color:#b42318;">✖ ${att.absent} absent/call-out</span>` : ''}
        ${!att.total ? '<span class="mc-mini-pill">No attendance logged today</span>' : ''}
      `;
    }

    // ── Incoming potential ───────────────────────────────────
    const incomingEl = qs('#huddleIncoming');
    if (incomingEl) {
      const totalIncoming = incoming.today.length + incoming.tomorrow.length + incoming.within3.length + incoming.later.length;
      if (!totalIncoming) {
        incomingEl.innerHTML = '<div class="mc-empty">No confirmed ship-date or shipping-from-supplier records found in current SORD data. Import a SORD Summary to populate this.</div>';
      } else {
        incomingEl.innerHTML = [
          incomingBucket('Arriving Today', incoming.today, 'high'),
          incomingBucket('Arriving Tomorrow', incoming.tomorrow, 'med'),
          incomingBucket('Next 3 Days', incoming.within3, 'low'),
          incomingBucket('Later / No Date', incoming.later, 'low'),
        ].join('');
      }
    }

    // ── Today's Execution ────────────────────────────────────
    const exec = qs('#huddleTodayExec');
    if (exec) {
      const sordLoaded = getSordDataset().length > 0;
      const rcvWorkable  = Math.max(0, floor.receivingOrderedUnits - floor.receivingReceivedUnits);
      const prepWorkable = Math.max(0, floor.prepOrderedUnits - floor.prepReceivedUnits);
      const rcvHasData   = floor.receivingOrderedUnits > 0 || floor.receivingReceivedUnits > 0;
      const prepHasData  = floor.prepOrderedUnits > 0     || floor.prepReceivedUnits > 0;
      exec.innerHTML = `
        <div class="huddle-exec-grid">
          <article class="huddle-exec-card">
            <div class="eyebrow">QA Receiving</div>
            <strong>${fmtInt(floor.receivingPOs)} POs</strong>
            <p>${rcvHasData
              ? `${fmtInt(floor.receivingOrderedUnits)} ordered · ${fmtInt(floor.receivingReceivedUnits)} received · <strong>${fmtInt(rcvWorkable)} workable</strong>`
              : `${fmtInt(floor.receivingUnits)} units on floor`}</p>
          </article>
          <article class="huddle-exec-card">
            <div class="eyebrow">QA Prep</div>
            <strong>${fmtInt(floor.prepPOs)} POs</strong>
            <p>${prepHasData
              ? `${fmtInt(floor.prepOrderedUnits)} ordered · ${fmtInt(floor.prepReceivedUnits)} received · <strong>${fmtInt(prepWorkable)} workable</strong>`
              : `${fmtInt(floor.prepUnits)} units ready`}</p>
          </article>
          <article class="huddle-exec-card">
            <div class="eyebrow">Assembly</div>
            <strong>${fmtInt(asm.doneUnits)} units • ${fmtInt(asm.donePacks)} packs</strong>
            <p>${asm.doneRows} PBs done of ${asm.scheduledPBs} scheduled · ${fmtInt(asm.totalPacks)} packs on today's schedule</p>
          </article>
          <article class="huddle-exec-card">
            <div class="eyebrow">Staffing</div>
            <strong>${att.present}</strong>
            <p>${att.late} late · ${att.absent} absent</p>
          </article>
        </div>
        ${!sordLoaded ? '<div class="mc-empty" style="margin-top:10px;">Import the SORD / PO detail report to enrich floor data.</div>' : (floor.newestReceivedAt ? `<div class="mc-empty" style="margin-top:10px;">Latest warehouse receipt in import: ${esc(floor.newestReceivedAt)}</div>` : '')}
      `;
    }

    // ── EOD Recap form ───────────────────────────────────────
    renderRecapForm();

    // ── History tab ──────────────────────────────────────────
    renderRecapHistory();

    // ── Snapshot history ─────────────────────────────────────
    renderSnapshotPanel();
  }

  function renderRecapForm() {
    const form = qs('#huddleRecapForm');
    if (!form) return;
    const existing = state.recaps.find(r => r.date === state.recapDate) || {};
    const d = state.recapDraft || {
      date: state.recapDate,
      whatWorked: existing.whatWorked || '',
      whatDidnt: existing.whatDidnt || '',
      biggestBlocker: existing.biggestBlocker || '',
      laborMoves: existing.laborMoves || '',
      rollsTomorrow: existing.rollsTomorrow || '',
      specialNotes: existing.specialNotes || '',
    };
    if (!state.recapDraft) state.recapDraft = { ...d };

    form.innerHTML = `
      <div class="huddle-recap-datebar">
        <button class="btn secondary" id="recapPrevDay" type="button">◀</button>
        <input type="date" id="recapDateInput" value="${esc(state.recapDate)}" class="huddle-date-input" />
        <button class="btn secondary" id="recapTodayBtn" type="button">Today</button>
        <button class="btn secondary" id="recapNextDay" type="button">▶</button>
        ${existing.updatedAt ? `<span class="mc-mini-pill">Last saved ${new Date(existing.updatedAt).toLocaleString()}</span>` : '<span class="mc-mini-pill">Not yet saved</span>'}
      </div>
      <div class="huddle-recap-grid">
        ${recapField('recapWhatWorked', '✅ What Worked', d.whatWorked, 'What went well today?')}
        ${recapField('recapWhatDidnt', '❌ What Didn\'t Work', d.whatDidnt, 'What fell short or broke down?')}
        ${recapField('recapBiggestBlocker', '🚧 Biggest Blocker', d.biggestBlocker, 'What was the #1 obstacle?')}
        ${recapField('recapLaborMoves', '🔄 Labor Moves', d.laborMoves, 'Who moved departments and why?')}
        ${recapField('recapRollsTomorrow', '➡️ Rolls to Tomorrow', d.rollsTomorrow, 'What is carrying over?')}
        ${recapField('recapSpecialNotes', '📌 Special Notes', d.specialNotes, 'Anything else leadership should know?')}
      </div>
      <div class="toolbar" style="margin-top:14px;justify-content:flex-end">
        <button class="btn" id="recapSaveBtn" type="button">Save Recap</button>
        <button class="btn secondary" id="recapClearBtn" type="button">Clear</button>
      </div>
      <div id="recapSaveStatus" style="min-height:20px;font-size:13px;color:#2b6cb0;margin-top:8px;"></div>
    `;

    // Wire events
    qs('#recapDateInput', form).addEventListener('change', e => {
      state.recapDate = e.target.value || isoToday();
      state.recapDraft = null;
      renderRecapForm();
    });
    qs('#recapPrevDay', form).addEventListener('click', () => {
      const d = new Date(state.recapDate + 'T00:00:00');
      d.setDate(d.getDate() - 1);
      state.recapDate = d.toISOString().slice(0, 10);
      state.recapDraft = null;
      renderRecapForm();
    });
    qs('#recapNextDay', form).addEventListener('click', () => {
      const d = new Date(state.recapDate + 'T00:00:00');
      d.setDate(d.getDate() + 1);
      state.recapDate = d.toISOString().slice(0, 10);
      state.recapDraft = null;
      renderRecapForm();
    });
    qs('#recapTodayBtn', form).addEventListener('click', () => {
      state.recapDate = isoToday();
      state.recapDraft = null;
      renderRecapForm();
    });

    ['recapWhatWorked', 'recapWhatDidnt', 'recapBiggestBlocker', 'recapLaborMoves', 'recapRollsTomorrow', 'recapSpecialNotes'].forEach(id => {
      const el = qs(`#${id}`, form);
      if (!el) return;
      el.addEventListener('input', () => {
        if (!state.recapDraft) state.recapDraft = {};
        const map = {
          recapWhatWorked: 'whatWorked', recapWhatDidnt: 'whatDidnt',
          recapBiggestBlocker: 'biggestBlocker', recapLaborMoves: 'laborMoves',
          recapRollsTomorrow: 'rollsTomorrow', recapSpecialNotes: 'specialNotes',
        };
        state.recapDraft[map[id]] = el.value;
      });
    });

    qs('#recapSaveBtn', form).addEventListener('click', async () => {
      const statusEl = qs('#recapSaveStatus', form);
      const recap = {
        date: state.recapDate,
        whatWorked: (qs('#recapWhatWorked', form) || {}).value || '',
        whatDidnt: (qs('#recapWhatDidnt', form) || {}).value || '',
        biggestBlocker: (qs('#recapBiggestBlocker', form) || {}).value || '',
        laborMoves: (qs('#recapLaborMoves', form) || {}).value || '',
        rollsTomorrow: (qs('#recapRollsTomorrow', form) || {}).value || '',
        specialNotes: (qs('#recapSpecialNotes', form) || {}).value || '',
      };
      if (statusEl) statusEl.textContent = 'Saving…';
      try {
        await saveRecap(recap);
        state.recapDraft = null;
        if (statusEl) statusEl.textContent = `✅ Saved at ${new Date().toLocaleTimeString()}`;
        renderRecapHistory();
      } catch (err) {
        if (statusEl) statusEl.textContent = `❌ Save failed: ${err.message}`;
      }
    });

    qs('#recapClearBtn', form).addEventListener('click', () => {
      if (!confirm('Clear this recap draft? Saved recaps are not deleted.')) return;
      state.recapDraft = null;
      renderRecapForm();
    });
  }

  function recapField(id, label, value, placeholder) {
    return `<div class="field">
      <label for="${id}">${label}</label>
      <textarea id="${id}" placeholder="${esc(placeholder)}" rows="3">${esc(value)}</textarea>
    </div>`;
  }

  function renderRecapHistory() {
    const hist = qs('#huddleRecapHistory');
    if (!hist) return;
    if (!state.recaps.length) {
      hist.innerHTML = '<div class="mc-empty">No recap notes saved yet. Use the End-of-Day Recap above to start building history.</div>';
      return;
    }
    hist.innerHTML = state.recaps.slice(0, 30).map(r => `
      <article class="huddle-history-card">
        <div class="huddle-history-head">
          <strong>${dateLabel(r.date)}</strong>
          <button class="btn secondary" style="font-size:12px;padding:5px 10px;" onclick="huddleEditRecap('${esc(r.date)}')">Edit</button>
        </div>
        ${r.whatWorked ? `<div class="huddle-history-row"><span class="huddle-history-label">✅ Worked</span><span>${esc(r.whatWorked)}</span></div>` : ''}
        ${r.whatDidnt ? `<div class="huddle-history-row"><span class="huddle-history-label">❌ Didn't Work</span><span>${esc(r.whatDidnt)}</span></div>` : ''}
        ${r.biggestBlocker ? `<div class="huddle-history-row"><span class="huddle-history-label">🚧 Blocker</span><span>${esc(r.biggestBlocker)}</span></div>` : ''}
        ${r.laborMoves ? `<div class="huddle-history-row"><span class="huddle-history-label">🔄 Moves</span><span>${esc(r.laborMoves)}</span></div>` : ''}
        ${r.rollsTomorrow ? `<div class="huddle-history-row"><span class="huddle-history-label">➡️ Tomorrow</span><span>${esc(r.rollsTomorrow)}</span></div>` : ''}
        ${r.specialNotes ? `<div class="huddle-history-row"><span class="huddle-history-label">📌 Notes</span><span>${esc(r.specialNotes)}</span></div>` : ''}
      </article>
    `).join('');
  }

  function renderSnapshotPanel() {
    const panel = qs('#huddleSnapshotPanel');
    if (!panel) return;
    if (!state.snapshotDates.length) {
      panel.innerHTML = '<div class="mc-empty">No SORD history snapshots yet. Snapshots are created automatically when you import a SORD Summary report.</div>';
      return;
    }
    const dateButtons = state.snapshotDates.slice(0, 20).map(d =>
      `<button class="mc-mini-pill huddle-snap-date-btn${state.historyDate === d ? ' huddle-snap-active' : ''}" data-snap-date="${esc(d)}">${dateLabel(d)}</button>`
    ).join('');

    const historyContent = state.historyDate && state.historyRows.length
      ? `<div class="huddle-snap-table-wrap">
          <table class="huddle-snap-table">
            <thead><tr><th>SORD</th><th>Account</th><th>Status</th><th>Units</th><th>Readiness</th><th>Earliest IHD</th></tr></thead>
            <tbody>${state.historyRows.map(r => `<tr>
              <td>${esc(r.sordId || r.salesOrderId || '—')}</td>
              <td>${esc(r.account || '—')}</td>
              <td>${esc(r.status || r.poStatus || '—')}</td>
              <td>${fmtInt(r.units)}</td>
              <td>${esc(r.readiness || '—')}</td>
              <td>${r.earliestIhd ? dateLabel(String(r.earliestIhd).slice(0, 10)) : '—'}</td>
            </tr>`).join('')}</tbody>
          </table>
        </div>`
      : (state.historyDate ? '<div class="mc-empty">Loading…</div>' : '<div class="mc-empty">Select a date above to view that day\'s snapshot.</div>');

    panel.innerHTML = `
      <div class="huddle-snap-dates">${dateButtons}</div>
      ${historyContent}
    `;

    panel.querySelectorAll('.huddle-snap-date-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const date = btn.dataset.snapDate;
        if (state.historyDate === date) return;
        state.historyDate = date;
        state.historyRows = [];
        renderSnapshotPanel();
        try {
          const data = await apiGet(`action=snapshot&date=${encodeURIComponent(date)}`);
          state.historyRows = data.rows || [];
        } catch (err) {
          state.historyRows = [];
          console.warn('Snapshot fetch failed', err);
        }
        renderSnapshotPanel();
      });
    });
  }

  // ── Global helpers called from inline HTML ────────────────────────────────
  window.huddleEditRecap = function (date) {
    state.recapDate = date;
    state.recapDraft = null;
    // Scroll to recap section
    const panel = qs('#huddleRecapPanel');
    if (panel) panel.scrollIntoView({ behavior: 'smooth' });
    renderRecapForm();
  };

  // ── Init ──────────────────────────────────────────────────────────────────
  async function init() {
    const root = document.getElementById('huddlePage');
    if (!root) return;

    await loadFromBackend();
    render();

    // Re-render when the huddle page becomes active
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.page === 'huddlePage') setTimeout(render, 50);
      });
    });

    // Also respond to direct activatePage calls via a MutationObserver on the page class
    const obs = new MutationObserver(() => {
      if (root.classList.contains('active')) render();
    });
    obs.observe(root, { attributes: true, attributeFilter: ['class'] });

    // Expose refresh for external callers
    window.huddleRefresh = render;
  }

  init();
})();
