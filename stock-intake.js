/* ═══════════════════════════════════════════════════════════════════════
   STOCK INTAKE — Container-first fast intake for bulk on-shelf cataloging.

   USE CASE
   --------
   A team of associates walks the warehouse with tablets. For each container
   they find, they enter the container code (or create a new one), then add
   every PO inside it as a rapid sequence. Container assignment is required;
   each entry is tagged sourceType:'stock-intake' so the batch can be filtered
   later in reports.

   ARCHITECTURE
   ------------
   - Pure DOM module, no framework dependencies
   - Uses existing app.js globals: createOverstockContainer, state.data,
     persistData, getOverstockContainerItems, normalizeOverstockContainerScan
   - Maintains its own session state in module-local vars (NOT persisted —
     "session" means current modal open; closing resets stats)
   - All entries write through state.data.overstockEntries so sync-to-backend
     happens automatically via persistData()

   IPAD ERGONOMICS
   ---------------
   - All tap targets ≥48px (Apple HIG)
   - inputmode="numeric" on PO + qty for numeric keyboard
   - autocapitalize="characters" on container code for OSC- codes
   - Large fonts on inputs (18px+) so they're readable from a tablet held at
     working distance
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // ── Module-local session state ─────────────────────────────────────────
  // Lives only while the modal is open. Counters reset on each session.
  let session = {
    activeContainerId: null,
    activeContainerCode: '',
    activeContainerLocation: '',
    recentEntries: [],         // [{id, po, qty, category, containerCode, ts}]
    itemsAdded: 0,
    containersTouched: new Set(),
    startedAt: null,
  };

  // ── Element refs (resolved lazily) ─────────────────────────────────────
  function el(id) { return document.getElementById(id); }

  // ── Helpers ────────────────────────────────────────────────────────────
  function showToast(msg, type) {
    // Reuse the app's existing toast system if available
    if (typeof window.showToast === 'function') return window.showToast(msg, type);
    console.log('[stock-intake]', type || 'info', msg);
  }

  function isApparel(cat) {
    return String(cat || '').trim().toLowerCase() === 'apparel';
  }

  function fmtTimeShort(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  // Pull categories from the app's master list, with a sensible fallback
  function getCategories() {
    try {
      if (window.state && Array.isArray(window.state.masters?.categories) && window.state.masters.categories.length) {
        return window.state.masters.categories;
      }
    } catch (_) {}
    return ['Drinkware', 'Apparel', 'Electronics', 'Kitchen', 'Toys', 'Misc'];
  }

  // Pull the same E-1 through E-24 list used by the regular overstock form.
  // We read it from the DOM rather than from a global so we stay in sync if
  // the canonical list ever changes — the regular form's #overstockEntryLocation
  // <select> is populated by app.js with the official list.
  function getLocationSuggestions() {
    // Primary source: scrape from the existing overstock form's location select
    try {
      const select = document.getElementById('overstockEntryLocation');
      if (select) {
        const opts = Array.from(select.options)
          .map(o => o.value)
          .filter(v => v && v.trim()); // drop the placeholder empty option
        if (opts.length) return opts;
      }
    } catch (_) {}
    // Secondary: master list (in case overstock form hasn't been touched yet)
    try {
      const fromMaster = window.state?.masters?.locations;
      if (Array.isArray(fromMaster) && fromMaster.length) return fromMaster;
    } catch (_) {}
    // Last-resort fallback — scrape what exists today
    const set = new Set();
    try {
      (window.state?.data?.overstockContainers || []).forEach(c => {
        if (c.currentLocation) set.add(c.currentLocation);
      });
      (window.state?.data?.overstockEntries || []).forEach(r => {
        if (r.location) set.add(r.location);
      });
    } catch (_) {}
    return [...set].sort();
  }

  function getCurrentUser() {
    // For Stock Intake we prefer the per-tablet temp identity if set —
    // that's the name the associate picked when they started using the
    // tablet. Falls back to the authenticated user.
    try {
      const temp = localStorage.getItem(TEMP_IDENTITY_KEY);
      if (temp && temp.trim()) return temp.trim();
    } catch (_) {}
    try {
      return window.state?.currentUser || JSON.parse(localStorage.getItem('hcAuthUser') || '{}').name || '';
    } catch (_) { return ''; }
  }

  // ── Temp identity (per-tablet) ─────────────────────────────────────────
  // The intake push uses one shared login across many tablets. Each tablet
  // picks a "who am I today" identity that gets tagged on every entry, so
  // we know which associate actually logged each PO.
  const TEMP_IDENTITY_KEY = 'hc_stock_intake_temp_identity_v1';
  function getTempIdentity() {
    try { return (localStorage.getItem(TEMP_IDENTITY_KEY) || '').trim(); }
    catch (_) { return ''; }
  }
  function setTempIdentity(name) {
    const clean = String(name || '').trim();
    if (!clean) return;
    try { localStorage.setItem(TEMP_IDENTITY_KEY, clean); } catch (_) {}
  }
  function clearTempIdentity() {
    try { localStorage.removeItem(TEMP_IDENTITY_KEY); } catch (_) {}
  }
  // Pull the master associate list (same source the attendance / regular
  // overstock form uses), with a fallback.
  function getIdentityCandidates() {
    try {
      const fromMaster = window.state?.masters?.associates;
      if (Array.isArray(fromMaster) && fromMaster.length) return fromMaster;
    } catch (_) {}
    return [];
  }
  function renderIdentityGrid() {
    const grid = el('stockIntakeIdentityGrid');
    if (!grid) return;
    const names = getIdentityCandidates();
    if (!names.length) {
      grid.innerHTML = `<div class="si-identity-empty">No names in the roster. Type one below.</div>`;
      return;
    }
    grid.innerHTML = names.map(n => `
      <button type="button" class="si-identity-btn" data-identity="${escapeHtml(n)}">${escapeHtml(n)}</button>
    `).join('');
    grid.querySelectorAll('[data-identity]').forEach(btn => {
      btn.addEventListener('click', () => {
        const name = btn.getAttribute('data-identity');
        applyIdentity(name);
      });
    });
  }
  function applyIdentity(name) {
    const clean = String(name || '').trim();
    if (!clean) { showToast('Please enter a name.', 'error'); return; }
    setTempIdentity(clean);
    updateActiveUserChip();
    showStep('container');
    setTimeout(() => el('stockIntakeContainerInput')?.focus(), 80);
  }
  function updateActiveUserChip() {
    const chip = el('stockIntakeActiveUser');
    const nameEl = el('stockIntakeActiveUserName');
    const name = getTempIdentity();
    if (!chip || !nameEl) return;
    if (name) {
      nameEl.textContent = name;
      chip.hidden = false;
    } else {
      chip.hidden = true;
    }
  }

  // ── Session ledger persistence ──────────────────────────────────────────
  // The session lives in module-local memory by default, which means
  // refreshing the tablet wipes the "Recent entries" list. For a long
  // intake day, that's annoying — associates want to verify what they've
  // done. Persist to localStorage so the ledger survives reload.
  // Each tablet has its own ledger (keyed by current user) so two tablets
  // don't show each other's session counts.
  const SESSION_KEY_PREFIX = 'hc_stock_intake_session_v1::';
  function sessionKey() {
    const u = getCurrentUser() || 'anon';
    return SESSION_KEY_PREFIX + u;
  }
  function persistSessionLedger() {
    try {
      const data = {
        startedAt: session.startedAt,
        itemsAdded: session.itemsAdded,
        containersTouched: Array.from(session.containersTouched),
        recentEntries: session.recentEntries,
        activeContainerId: session.activeContainerId,
        activeContainerCode: session.activeContainerCode,
        activeContainerLocation: session.activeContainerLocation,
      };
      localStorage.setItem(sessionKey(), JSON.stringify(data));
    } catch (_) {}
  }
  function loadSessionLedger() {
    try {
      const raw = localStorage.getItem(sessionKey());
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      // Stale-session guard — if the saved session is older than 12 hours,
      // discard it. Probably yesterday's work.
      if (parsed.startedAt && Date.now() - parsed.startedAt > 12 * 60 * 60 * 1000) {
        return null;
      }
      return parsed;
    } catch (_) { return null; }
  }
  function clearSessionLedger() {
    try { localStorage.removeItem(sessionKey()); } catch (_) {}
  }

  // ── Container resolution ───────────────────────────────────────────────
  // Look up a container by normalized code. Returns null if not found.
  function findContainerByCode(code) {
    const containers = window.state?.data?.overstockContainers || [];
    const norm = String(code || '').trim().toUpperCase();
    return containers.find(c => {
      return String(c.code || '').toUpperCase() === norm
          || String(c.barcode || '').toUpperCase() === norm;
    }) || null;
  }

  // ── Step transitions ───────────────────────────────────────────────────
  function showStep(which) {
    const stepId = el('stockIntakeStepIdentity');
    const stepC  = el('stockIntakeStepContainer');
    const stepI  = el('stockIntakeStepItems');
    if (!stepC || !stepI) return;
    if (which === 'identity') {
      if (stepId) stepId.hidden = false;
      stepC.hidden = true;
      stepI.hidden = true;
      setTimeout(() => el('stockIntakeIdentityCustom')?.focus({ preventScroll: true }), 50);
    } else if (which === 'items') {
      if (stepId) stepId.hidden = true;
      stepC.hidden = true;
      stepI.hidden = false;
      setTimeout(() => el('stockIntakeItemPo')?.focus(), 50);
    } else {
      if (stepId) stepId.hidden = true;
      stepC.hidden = false;
      stepI.hidden = true;
      setTimeout(() => el('stockIntakeContainerInput')?.focus(), 50);
    }
  }

  // ── Render: container info preview (when typing matches existing) ──────
  function renderContainerInfoPreview(container) {
    const box = el('stockIntakeContainerInfo');
    if (!box) return;
    if (!container) { box.hidden = true; box.innerHTML = ''; return; }
    let itemCount = 0;
    try {
      itemCount = (window.state?.data?.overstockEntries || [])
        .filter(r => r.containerId === container.id).length;
    } catch (_) {}
    box.hidden = false;
    box.innerHTML = `
      <div class="si-container-info-row">
        <span class="si-container-info-tag">EXISTING</span>
        <strong>${escapeHtml(container.code)}</strong>
        <span class="si-container-info-meta">${itemCount} item${itemCount === 1 ? '' : 's'} · ${escapeHtml(container.currentLocation || 'no location')} · ${escapeHtml(container.status || 'Open')}</span>
      </div>
    `;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ── Render: active container banner ────────────────────────────────────
  function renderActiveBanner() {
    const banner = el('stockIntakeActiveBanner');
    if (!banner || !session.activeContainerId) return;
    const itemsInContainer = (window.state?.data?.overstockEntries || [])
      .filter(r => r.containerId === session.activeContainerId).length;
    banner.innerHTML = `
      <div class="si-active-left">
        <div class="si-active-code">${escapeHtml(session.activeContainerCode)}</div>
        <div class="si-active-loc">📍 ${escapeHtml(session.activeContainerLocation || 'No location')}</div>
      </div>
      <div class="si-active-count">
        <span class="si-active-num">${itemsInContainer}</span>
        <span class="si-active-lbl">items in container</span>
      </div>
    `;
  }

  // ── Render: stats banner ───────────────────────────────────────────────
  function renderStats() {
    const items = el('siStatItems');
    const cont  = el('siStatContainers');
    const start = el('siStatStartedAt');
    if (items) items.textContent = String(session.itemsAdded);
    if (cont)  cont.textContent  = String(session.containersTouched.size);
    if (start) start.textContent = session.startedAt ? fmtTimeShort(session.startedAt) : '—';
  }

  // ── Render: recent entries list ────────────────────────────────────────
  function renderRecentList() {
    const list = el('stockIntakeRecentList');
    if (!list) return;
    if (!session.recentEntries.length) {
      list.innerHTML = '<li class="si-recent-empty">No items added yet — start typing a PO above.</li>';
      return;
    }
    // Show last 10, newest first
    const recent = session.recentEntries.slice(-10).reverse();
    list.innerHTML = recent.map(e => `
      <li class="si-recent-item" data-entry-id="${escapeHtml(e.id)}">
        <div class="si-recent-main">
          <span class="si-recent-po">PO# ${escapeHtml(e.po)}</span>
          <span class="si-recent-qty" data-qty-display="${escapeHtml(e.id)}">${e.qty} ${e.qty === 1 ? 'unit' : 'units'}</span>
          ${e.category ? `<span class="si-recent-cat">${escapeHtml(e.category)}</span>` : ''}
        </div>
        <div class="si-recent-meta">
          <span class="si-recent-cont">${escapeHtml(e.containerCode)}</span>
          <span class="si-recent-time">${fmtTimeShort(e.ts)}</span>
          <button type="button" class="si-recent-edit" data-edit-id="${escapeHtml(e.id)}" aria-label="Edit quantity" title="Edit quantity">✎</button>
          <button type="button" class="si-recent-del" data-del-id="${escapeHtml(e.id)}" aria-label="Remove this entry">×</button>
        </div>
      </li>
    `).join('');

    // Wire delete buttons
    list.querySelectorAll('[data-del-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-del-id');
        deleteEntry(id);
      });
    });
    // Wire edit buttons (inline qty edit — most common correction)
    list.querySelectorAll('[data-edit-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-edit-id');
        startInlineEdit(id);
      });
    });
  }

  // ── Inline edit a recent entry (qty only — the most common correction) ─
  // Replaces the qty display with an input + Save/Cancel. Updates both the
  // session list and state.data.overstockEntries on save.
  function startInlineEdit(entryId) {
    if (!entryId) return;
    const sessionEntry = session.recentEntries.find(e => e.id === entryId);
    if (!sessionEntry) return;

    const li = document.querySelector(`.si-recent-item[data-entry-id="${entryId}"]`);
    if (!li) return;

    // Build an editor inside the row
    const main = li.querySelector('.si-recent-main');
    if (!main) return;
    const originalHTML = main.innerHTML;

    main.innerHTML = `
      <span class="si-recent-po">PO# ${escapeHtml(sessionEntry.po)}</span>
      <input type="number" class="si-recent-qty-input" inputmode="numeric" min="1" step="1" value="${escapeHtml(sessionEntry.qty)}" aria-label="New quantity" />
      <button type="button" class="si-recent-save">Save</button>
      <button type="button" class="si-recent-cancel">Cancel</button>
    `;
    const input  = main.querySelector('.si-recent-qty-input');
    const save   = main.querySelector('.si-recent-save');
    const cancel = main.querySelector('.si-recent-cancel');
    if (input) { input.focus(); input.select(); }

    function commit() {
      const newQty = Math.max(0, Math.floor(Number(input?.value || 0)));
      if (!newQty) { showToast('Quantity must be at least 1.', 'error'); input?.focus(); return; }
      if (newQty === sessionEntry.qty) { main.innerHTML = originalHTML; return; }

      // Update state.data.overstockEntries
      try {
        const arr = window.state?.data?.overstockEntries || [];
        const row = arr.find(r => r.id === entryId);
        if (row) {
          const oldQty = row.quantity;
          row.quantity = newQty;
          row.updatedAt = Date.now();
          // If sizes were set previously, they may no longer match — clear them
          // since a manual qty edit invalidates the breakdown.
          if (row.sizeBreakdown && Object.keys(row.sizeBreakdown).length) {
            const total = Object.values(row.sizeBreakdown).reduce((s, n) => s + Number(n || 0), 0);
            if (total !== newQty) {
              row.sizeBreakdown = undefined;
            }
          }
          // Log the edit for audit
          if (typeof window.osLogDelete === 'function') {
            // Reuse the existing audit log writer for edits too
          }
          try {
            const KEY = 'hc_overstock_delete_log_v1';
            const log = JSON.parse(localStorage.getItem(KEY) || '[]');
            log.unshift({
              ts: Date.now(),
              by: getCurrentUser() || 'unknown',
              kind: 'edit-qty',
              payload: { id: entryId, po: row.po, containerCode: row.containerCode, from: oldQty, to: newQty },
            });
            localStorage.setItem(KEY, JSON.stringify(log.slice(0, 500)));
          } catch (_) {}

          if (typeof window.persistData === 'function') window.persistData();
        }
      } catch (_) {}

      // Update session
      sessionEntry.qty = newQty;
      persistSessionLedger();

      // Refresh UI
      renderActiveBanner();
      renderRecentList();
      if (typeof window.renderOverstockPage === 'function') {
        try { window.renderOverstockPage(); } catch (_) {}
      }
    }

    save?.addEventListener('click', commit);
    cancel?.addEventListener('click', () => { main.innerHTML = originalHTML; renderRecentList(); });
    input?.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter')  { ev.preventDefault(); commit(); }
      if (ev.key === 'Escape') { ev.preventDefault(); main.innerHTML = originalHTML; renderRecentList(); }
    });
  }

  // ── Step 1: resolve container code (load existing OR create new) ───────
  function handleContainerSubmit(ev) {
    ev.preventDefault();
    const codeInput = el('stockIntakeContainerInput');
    const locInput  = el('stockIntakeContainerLocation');
    const rawCode = (codeInput?.value || '').trim();
    const rawLoc  = (locInput?.value || '').trim();

    if (!rawCode) {
      showToast('Enter a container code first.', 'error');
      codeInput?.focus();
      return;
    }
    if (!rawLoc) {
      showToast('Enter the container location.', 'error');
      locInput?.focus();
      return;
    }

    // Normalize the code to OSC-XXXX format if it looks numeric, otherwise
    // keep as-typed for non-OSC barcodes.
    let normalized = rawCode.toUpperCase();
    try {
      if (typeof window.normalizeOverstockContainerScan === 'function') {
        const n = window.normalizeOverstockContainerScan(rawCode);
        if (n) normalized = n;
      }
    } catch (_) {}

    // Look up existing
    let container = findContainerByCode(normalized);

    if (!container) {
      // Confirm before creating
      const confirmCreate = confirm(`Container "${normalized}" doesn't exist yet.\n\nCreate it with location "${rawLoc}"?`);
      if (!confirmCreate) return;

      if (typeof window.createOverstockContainer !== 'function') {
        showToast('Container creation is unavailable in this build.', 'error');
        return;
      }
      try {
        // Create the container WITH its final code + location in one step.
        // The typed code IS the code — OSC-001, AWD-001, anything — so it never
        // gets swapped for an auto code on the next step.
        container = window.createOverstockContainer({
          status: 'Stored',
          currentLocation: rawLoc,
          code: normalized,
        });
      } catch (e) {
        showToast('Failed to create container: ' + e.message, 'error');
        return;
      }
    } else {
      // Existing container — count what's actually in it. If the count looks
      // suspicious (e.g., associate is trying to "redo" a known-bad container),
      // give them an explicit "wipe and restart" option. This avoids the
      // confusing situation where deleting + recreating doesn't work due to
      // tombstone/sync drift.
      const existingEntries = (window.state?.data?.overstockEntries || [])
        .filter(r => r.containerId === container.id);
      const existingCount = existingEntries.length;

      if (existingCount > 0) {
        const choice = confirm(
          `Container "${container.code}" already exists with ${existingCount} ` +
          `PO entr${existingCount === 1 ? 'y' : 'ies'} at ${container.currentLocation || 'no location'}.\n\n` +
          `Click OK to ADD to the existing container.\n` +
          `Click Cancel to back out and decide what to do.`
        );
        if (!choice) {
          // Offer the wipe option as a separate explicit step
          const reset = confirm(
            `Do you want to WIPE this container and start fresh?\n\n` +
            `This will permanently delete all ${existingCount} existing PO entr${existingCount === 1 ? 'y' : 'ies'} ` +
            `in "${container.code}" so you can re-enter them from scratch.\n\n` +
            `OK = Wipe and start fresh\n` +
            `Cancel = Back out, don't touch anything`
          );
          if (!reset) return;

          // Cascade-delete every entry tied to this container, then recreate
          // the container under the same code/location. This uses the existing
          // delete helper which tombstones properly so the next sync removes
          // the entries server-side too.
          if (typeof window.deleteOverstockContainer === 'function') {
            const result = window.deleteOverstockContainer(container.id, { force: true });
            if (!result.ok) {
              showToast('Failed to wipe: ' + (result.reason || 'unknown'), 'error');
              return;
            }
          } else {
            showToast('Wipe failed: delete helper unavailable.', 'error');
            return;
          }
          // Now create a fresh container under the same code + location — again
          // with the final code up front (no create-then-rename).
          try {
            container = window.createOverstockContainer({
              status: 'Stored',
              currentLocation: rawLoc,
              code: normalized,
            });
            showToast(`Wiped "${normalized}" — start fresh.`, 'success');
          } catch (e) {
            showToast('Failed to recreate container: ' + e.message, 'error');
            return;
          }
        } else {
          // User chose ADD — keep container as-is, ensure status/location are fresh
          const updates = {};
          if (rawLoc && container.currentLocation !== rawLoc) updates.currentLocation = rawLoc;
          if (container.status !== 'Stored' && container.status !== 'Full' && container.status !== 'Closed') {
            updates.status = 'Stored';
          }
          if (Object.keys(updates).length && typeof window.updateOverstockContainer === 'function') {
            window.updateOverstockContainer(container.id, updates);
          }
        }
      } else {
        // Empty container — just open it. Update location/status if needed.
        const updates = {};
        if (rawLoc && container.currentLocation !== rawLoc) updates.currentLocation = rawLoc;
        if (container.status !== 'Stored' && container.status !== 'Full' && container.status !== 'Closed') {
          updates.status = 'Stored';
        }
        if (Object.keys(updates).length && typeof window.updateOverstockContainer === 'function') {
          window.updateOverstockContainer(container.id, updates);
        }
      }
    }

    // Re-read the container from state in case updateOverstockContainer
    // changed properties we care about (it does mutate in-place, but reading
    // fresh from state guarantees we have the canonical version).
    container = (window.state?.data?.overstockContainers || []).find(c => c.id === container.id) || container;

    // Activate this container in the session
    session.activeContainerId = container.id;
    session.activeContainerCode = container.code || normalized;
    session.activeContainerLocation = container.currentLocation || rawLoc;
    session.containersTouched.add(container.id);
    if (!session.startedAt) session.startedAt = Date.now();
    persistSessionLedger();

    renderActiveBanner();
    renderStats();
    renderRecentList();
    showStep('items');
  }

  // ── Step 2: add an item to the active container ────────────────────────
  function handleItemSubmit(ev) {
    ev.preventDefault();
    if (!session.activeContainerId) {
      showToast('Pick a container first.', 'error');
      showStep('container');
      return;
    }

    const poInput   = el('stockIntakeItemPo');
    const qtyInput  = el('stockIntakeItemQty');
    const catInput  = el('stockIntakeItemCategory');
    const statusInput = el('stockIntakeItemStatus');
    const actionInput = el('stockIntakeItemAction');
    const po       = (poInput?.value || '').trim();
    const qty      = Math.max(0, Math.floor(Number(qtyInput?.value || 0)));
    const category = catInput?.value || '';
    const status   = statusInput?.value || 'Not Donation';
    const action   = actionInput?.value || 'Required';

    if (!po) { showToast('Enter a PO number.', 'error'); poInput?.focus(); return; }
    if (!qty) { showToast('Enter a quantity.', 'error'); qtyInput?.focus(); return; }

    // Duplicate-in-container check. Warn (don't block) if this PO already
    // exists in the active container — protects against accidental double-Add
    // taps and the "did I already do this one?" mistake. Looks at the live
    // data layer, not just the session, so it works across reloads too.
    try {
      const existing = (window.state?.data?.overstockEntries || []).find(r =>
        r.containerId === session.activeContainerId &&
        String(r.po).trim().toUpperCase() === po.toUpperCase()
      );
      if (existing) {
        const proceed = confirm(
          `PO# ${po} is already in this container with ${existing.quantity} units.\n\n` +
          `Click OK to add another ${qty}-unit entry anyway (will become a separate line),\n` +
          `or Cancel to back out.\n\n` +
          `If you meant to CHANGE the quantity, cancel and use the pencil icon ✎ on the existing entry instead.`
        );
        if (!proceed) { poInput?.focus(); poInput?.select(); return; }
      }
    } catch (_) {}

    // Build size breakdown if Apparel
    let sizeBreakdown;
    if (isApparel(category)) {
      sizeBreakdown = {};
      let total = 0;
      document.querySelectorAll('[data-si-size]').forEach(inp => {
        const sz = inp.getAttribute('data-si-size');
        const n  = Math.max(0, Math.floor(Number(inp.value || 0)));
        if (n > 0) { sizeBreakdown[sz] = n; total += n; }
      });
      // If sizes provided but don't sum to qty, warn but don't block
      if (total > 0 && total !== qty) {
        if (!confirm(`Size totals (${total}) don't match qty (${qty}). Save anyway?`)) return;
      }
      if (total === 0) sizeBreakdown = undefined;
    }

    // Build the entry. Mirrors addPalletCandidateToOverstockContainer's
    // shape so the data flows through the same reporting paths, but with
    // sourceType:'stock-intake' so the batch can be filtered later.
    const entryId = (typeof window.makeId === 'function' ? window.makeId() : 'si_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now());
    const entry = {
      id: entryId,
      date: new Date().toISOString().slice(0, 10),
      po,
      quantity: qty,
      category,
      status,
      action,
      location: session.activeContainerLocation,
      associate: getCurrentUser(),
      sourceType: 'stock-intake',
      containerId: session.activeContainerId,
      containerCode: session.activeContainerCode,
      sizeBreakdown,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    try {
      if (!Array.isArray(window.state.data.overstockEntries)) window.state.data.overstockEntries = [];
      window.state.data.overstockEntries.unshift(entry);
      if (typeof window.persistData === 'function') window.persistData();
    } catch (e) {
      showToast('Failed to save entry: ' + e.message, 'error');
      return;
    }

    // Update session, re-render
    session.itemsAdded += 1;
    session.recentEntries.push({
      id: entryId, po, qty, category,
      containerCode: session.activeContainerCode,
      ts: Date.now(),
    });
    persistSessionLedger();
    renderActiveBanner();
    renderStats();
    renderRecentList();

    // Re-render the overstock page in the background so the main table
    // updates if it's visible
    if (typeof window.renderOverstockPage === 'function') {
      try { window.renderOverstockPage(); } catch (_) {}
    }

    // Reset the form, refocus PO for next entry
    poInput.value = '';
    qtyInput.value = '';
    if (catInput) catInput.value = '';
    // Reset status/action to the safe defaults so each PO starts neutral and
    // "Donation" is a deliberate per-PO choice.
    if (statusInput) statusInput.value = 'Not Donation';
    if (actionInput) actionInput.value = 'Required';
    document.querySelectorAll('[data-si-size]').forEach(inp => { inp.value = ''; });
    el('stockIntakeItemSizesRow')?.setAttribute('hidden', '');
    poInput.focus();
  }

  // ── Delete an entry (from recent list) ─────────────────────────────────
  function deleteEntry(entryId) {
    if (!entryId) return;
    if (!confirm('Remove this entry from the system?')) return;
    try {
      const arr = window.state.data.overstockEntries || [];
      const idx = arr.findIndex(r => r.id === entryId);
      if (idx === -1) {
        // Already gone from data; just clean session
      } else {
        arr.splice(idx, 1);
        if (typeof window.persistData === 'function') window.persistData();
      }
    } catch (e) {
      showToast('Failed to remove entry: ' + e.message, 'error');
      return;
    }

    // Remove from session recent list
    const sIdx = session.recentEntries.findIndex(e => e.id === entryId);
    if (sIdx !== -1) {
      session.recentEntries.splice(sIdx, 1);
      session.itemsAdded = Math.max(0, session.itemsAdded - 1);
    }
    persistSessionLedger();
    renderActiveBanner();
    renderStats();
    renderRecentList();
    if (typeof window.renderOverstockPage === 'function') {
      try { window.renderOverstockPage(); } catch (_) {}
    }
  }

  // ── Modal open / close ─────────────────────────────────────────────────
  // prefill (optional): { code, location } — used when launched from the Scan
  // card's "Add items" choice so the box is pre-loaded. Note the open trigger
  // passes a click Event here; the typeof/.code guard below ignores that.
  function openIntakeModal(prefill) {
    const overlay = el('stockIntakeOverlay');
    if (!overlay) return;

    // Make sure the regular overstock form is populated first, so when we
    // scrape its location select for the canonical E-1..E-24 list, the
    // options actually exist. If the user opens the intake modal before
    // ever scrolling to the overstock entry form, the dropdown could be
    // empty otherwise.
    try {
      if (typeof window.renderOverstockPage === 'function') {
        window.renderOverstockPage();
      }
    } catch (_) {}

    // Reset session, then try to resume from a saved ledger
    session = {
      activeContainerId: null,
      activeContainerCode: '',
      activeContainerLocation: '',
      recentEntries: [],
      itemsAdded: 0,
      containersTouched: new Set(),
      startedAt: null,
    };

    // If a saved session exists (same user, within 12 hours), offer to resume.
    // This solves: the tablet got refreshed mid-day, the team wants to keep
    // their running totals + recent entries visible.
    const saved = loadSessionLedger();
    if (saved && Array.isArray(saved.recentEntries) && saved.recentEntries.length) {
      const startedTxt = saved.startedAt ? fmtTimeShort(saved.startedAt) : 'earlier';
      const resume = confirm(
        `Resume your in-progress session?\n\n` +
        `You have ${saved.itemsAdded || 0} item${saved.itemsAdded === 1 ? '' : 's'} added across ` +
        `${(saved.containersTouched || []).length} container${(saved.containersTouched || []).length === 1 ? '' : 's'} ` +
        `since ${startedTxt}.\n\n` +
        `OK = Resume.  Cancel = Start fresh.`
      );
      if (resume) {
        session.startedAt = saved.startedAt || Date.now();
        session.itemsAdded = saved.itemsAdded || 0;
        session.containersTouched = new Set(saved.containersTouched || []);
        // Filter the recent entries to only those that still exist in the data
        // layer — protects against showing zombie entries that were removed.
        const liveIds = new Set((window.state?.data?.overstockEntries || []).map(r => r.id));
        session.recentEntries = (saved.recentEntries || []).filter(e => liveIds.has(e.id));
        // If we lost some entries to filtering, inform the user honestly
        const lost = (saved.recentEntries || []).length - session.recentEntries.length;
        if (lost > 0) {
          setTimeout(() => alert(`Note: ${lost} entr${lost === 1 ? 'y' : 'ies'} from your saved session ${lost === 1 ? 'is' : 'are'} no longer in the system (deleted elsewhere or lost in sync). Your stats have been corrected.`), 100);
          session.itemsAdded = Math.max(0, session.itemsAdded - lost);
        }
      } else {
        clearSessionLedger();
      }
    }

    // Populate dropdowns (categories + location suggestions)
    const catSel = el('stockIntakeItemCategory');
    if (catSel) {
      catSel.innerHTML = '<option value="">— Category (optional) —</option>' +
        getCategories().map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    }
    const locSel = el('stockIntakeContainerLocation');
    if (locSel) {
      const locs = getLocationSuggestions();
      locSel.innerHTML = '<option value="">— Select location —</option>' +
        locs.map(l => `<option value="${escapeHtml(l)}">${escapeHtml(l)}</option>`).join('');
    }

    // Reset form fields
    ['stockIntakeContainerInput', 'stockIntakeContainerLocation',
     'stockIntakeItemPo', 'stockIntakeItemQty'].forEach(id => {
      const e = el(id); if (e) e.value = '';
    });
    document.querySelectorAll('[data-si-size]').forEach(i => { i.value = ''; });
    el('stockIntakeItemSizesRow')?.setAttribute('hidden', '');
    el('stockIntakeContainerInfo')?.setAttribute('hidden', '');

    // Optional prefill from the Scan card's "Add items" choice.
    if (prefill && typeof prefill === 'object' && typeof prefill.code === 'string' && prefill.code) {
      const ci = el('stockIntakeContainerInput'); if (ci) ci.value = prefill.code;
      const li = el('stockIntakeContainerLocation'); if (li && prefill.location) li.value = prefill.location;
    }

    showStep('container');
    renderStats();
    renderRecentList();
    updateActiveUserChip();
    renderIdentityGrid();

    // If no temp identity has been picked yet on this tablet, gate the user
    // to the identity step first. They MUST pick a name before they can add
    // entries — this is what powers accountability for the bulk intake push.
    if (!getTempIdentity()) {
      showStep('identity');
    }

    overlay.hidden = false;
    document.body.style.overflow = 'hidden';

    // Pause the workflow poll while the intake modal is open. The 20s poll
    // can pull down server state and overwrite a freshly-added container or
    // its entries before the debounced upstream sync flushes. Pausing
    // eliminates the race; closeIntakeModal resumes polling.
    try { if (typeof window.stopWorkflowPoll === 'function') window.stopWorkflowPoll(); } catch (_) {}

    setTimeout(() => el('stockIntakeContainerInput')?.focus(), 80);
  }

  function endSession() {
    if (session.itemsAdded > 0) {
      if (!confirm(`End session?\n\nYou added ${session.itemsAdded} item${session.itemsAdded === 1 ? '' : 's'} across ${session.containersTouched.size} container${session.containersTouched.size === 1 ? '' : 's'}.\n\nThis will clear your "Recent entries" ledger. Your data stays saved.`)) return;
      showToast(`Session ended — ${session.itemsAdded} items saved.`, 'success');
    }
    clearSessionLedger();
    closeIntakeModal();
  }

  async function closeIntakeModal() {
    const overlay = el('stockIntakeOverlay');
    if (!overlay) return;
    overlay.hidden = true;
    document.body.style.overflow = '';
    // Force a final upstream sync of any locally-buffered changes BEFORE
    // resuming the poll. We AWAIT the sync (not fire-and-forget) because
    // resuming the poll while the POST is in flight could result in the
    // poll's first GET racing the POST and pulling stale state.
    try {
      if (typeof window.syncWorkflowState === 'function') {
        await window.syncWorkflowState();
      }
    } catch (_) {}
    try {
      if (typeof window.startWorkflowPoll === 'function') window.startWorkflowPoll();
    } catch (_) {}
  }

  // ── Wire events ────────────────────────────────────────────────────────
  function init() {
    // Open trigger
    const openBtn = el('overstockStockIntakeBtn');
    if (openBtn && !openBtn.dataset.siBound) {
      openBtn.dataset.siBound = '1';
      openBtn.addEventListener('click', openIntakeModal);
    }

    // End-session button
    el('stockIntakeEndBtn')?.addEventListener('click', endSession);

    // Identity: custom name entry
    el('stockIntakeIdentityCustomBtn')?.addEventListener('click', () => {
      const input = el('stockIntakeIdentityCustom');
      applyIdentity(input?.value || '');
    });
    el('stockIntakeIdentityCustom')?.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        applyIdentity(ev.target.value || '');
      }
    });

    // Switch user — clears the tablet's temp identity and returns to Step 0.
    // Use case: associate hands the tablet off to a colleague.
    el('stockIntakeSwitchUserBtn')?.addEventListener('click', () => {
      if (!confirm('Switch the tablet to a different associate?\n\nThis will end your current session and the next person will pick their own name.')) return;
      clearTempIdentity();
      // Treat this like an End Session — flush + clear ledger, then re-show identity
      clearSessionLedger();
      session = {
        activeContainerId: null, activeContainerCode: '', activeContainerLocation: '',
        recentEntries: [], itemsAdded: 0, containersTouched: new Set(), startedAt: null,
      };
      updateActiveUserChip();
      renderStats();
      renderRecentList();
      renderIdentityGrid();
      showStep('identity');
    });

    // Switch container — return to Step 1 (session stays intact)
    el('stockIntakeSwitchContainerBtn')?.addEventListener('click', () => {
      const codeInput = el('stockIntakeContainerInput');
      const locInput = el('stockIntakeContainerLocation');
      if (codeInput) codeInput.value = '';
      if (locInput) locInput.value = '';
      el('stockIntakeContainerInfo')?.setAttribute('hidden', '');
      showStep('container');
    });

    // Container form submission
    el('stockIntakeContainerForm')?.addEventListener('submit', handleContainerSubmit);

    // Live preview of existing container as user types
    el('stockIntakeContainerInput')?.addEventListener('input', (ev) => {
      const v = (ev.target.value || '').trim();
      if (v.length < 3) {
        renderContainerInfoPreview(null);
        return;
      }
      let norm = v.toUpperCase();
      try {
        if (typeof window.normalizeOverstockContainerScan === 'function') {
          const n = window.normalizeOverstockContainerScan(v);
          if (n) norm = n;
        }
      } catch (_) {}
      const existing = findContainerByCode(norm);
      renderContainerInfoPreview(existing);
      // If the container has a known location, pre-fill it so the user doesn't
      // have to retype every time they revisit a container.
      if (existing && existing.currentLocation) {
        const locInput = el('stockIntakeContainerLocation');
        if (locInput && !locInput.value.trim()) {
          locInput.value = existing.currentLocation;
        }
      }
    });

    // Item form submission
    el('stockIntakeItemForm')?.addEventListener('submit', handleItemSubmit);

    // Show/hide size row when Apparel selected
    el('stockIntakeItemCategory')?.addEventListener('change', (ev) => {
      const sizesRow = el('stockIntakeItemSizesRow');
      if (!sizesRow) return;
      if (isApparel(ev.target.value)) sizesRow.hidden = false;
      else sizesRow.hidden = true;
    });

    // Escape closes modal (but confirms if entries added)
    document.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Escape') return;
      const overlay = el('stockIntakeOverlay');
      if (!overlay || overlay.hidden) return;
      endSession();
    });
  }

  // Public API for debugging / external triggers
  window.hcStockIntake = {
    open:  openIntakeModal,
    close: closeIntakeModal,
  };

  // Bootstrap when DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
