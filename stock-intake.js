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

  // Pull location list (master list of warehouse locations) so the datalist
  // can autocomplete. Falls back to extracting unique existing locations.
  function getLocationSuggestions() {
    try {
      const fromMaster = window.state?.masters?.locations;
      if (Array.isArray(fromMaster) && fromMaster.length) return fromMaster;
    } catch (_) {}
    // Fall back: scrape unique locations from existing containers + entries
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
    try {
      return window.state?.currentUser || JSON.parse(localStorage.getItem('hcAuthUser') || '{}').name || '';
    } catch (_) { return ''; }
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
    const stepC = el('stockIntakeStepContainer');
    const stepI = el('stockIntakeStepItems');
    if (!stepC || !stepI) return;
    if (which === 'items') {
      stepC.hidden = true;
      stepI.hidden = false;
      setTimeout(() => el('stockIntakeItemPo')?.focus(), 50);
    } else {
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
          <span class="si-recent-qty">${e.qty} ${e.qty === 1 ? 'unit' : 'units'}</span>
          ${e.category ? `<span class="si-recent-cat">${escapeHtml(e.category)}</span>` : ''}
        </div>
        <div class="si-recent-meta">
          <span class="si-recent-cont">${escapeHtml(e.containerCode)}</span>
          <span class="si-recent-time">${fmtTimeShort(e.ts)}</span>
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
        container = window.createOverstockContainer({ status: 'Open' });
        // Override the auto-generated code with what the user typed, if it
        // looks like a custom non-OSC barcode. Otherwise leave the OSC code
        // the system generated and store the typed value as the barcode.
        if (/^OSC-\d+$/i.test(normalized)) {
          container.code = normalized;
        } else {
          container.barcode = normalized;
        }
        container.currentLocation = rawLoc;
        container.updatedAt = Date.now();
        if (typeof window.persistData === 'function') window.persistData();
      } catch (e) {
        showToast('Failed to create container: ' + e.message, 'error');
        return;
      }
    } else {
      // Existing — sync location if user provided a different one
      if (rawLoc && container.currentLocation !== rawLoc) {
        if (typeof window.updateOverstockContainer === 'function') {
          window.updateOverstockContainer(container.id, { currentLocation: rawLoc });
        }
      }
    }

    // Activate this container in the session
    session.activeContainerId = container.id;
    session.activeContainerCode = container.code || normalized;
    session.activeContainerLocation = container.currentLocation || rawLoc;
    session.containersTouched.add(container.id);
    if (!session.startedAt) session.startedAt = Date.now();

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
    const po       = (poInput?.value || '').trim();
    const qty      = Math.max(0, Math.floor(Number(qtyInput?.value || 0)));
    const category = catInput?.value || '';

    if (!po) { showToast('Enter a PO number.', 'error'); poInput?.focus(); return; }
    if (!qty) { showToast('Enter a quantity.', 'error'); qtyInput?.focus(); return; }

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
      status: 'Not Donation',
      action: 'Required',
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
    renderActiveBanner();
    renderStats();
    renderRecentList();
    if (typeof window.renderOverstockPage === 'function') {
      try { window.renderOverstockPage(); } catch (_) {}
    }
  }

  // ── Modal open / close ─────────────────────────────────────────────────
  function openIntakeModal() {
    const overlay = el('stockIntakeOverlay');
    if (!overlay) return;

    // Reset session
    session = {
      activeContainerId: null,
      activeContainerCode: '',
      activeContainerLocation: '',
      recentEntries: [],
      itemsAdded: 0,
      containersTouched: new Set(),
      startedAt: null,
    };

    // Populate dropdowns (categories + location suggestions)
    const catSel = el('stockIntakeItemCategory');
    if (catSel) {
      catSel.innerHTML = '<option value="">— Category (optional) —</option>' +
        getCategories().map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    }
    const locList = el('stockIntakeLocationList');
    if (locList) {
      locList.innerHTML = getLocationSuggestions()
        .map(l => `<option value="${escapeHtml(l)}"></option>`).join('');
    }

    // Reset form fields
    ['stockIntakeContainerInput', 'stockIntakeContainerLocation',
     'stockIntakeItemPo', 'stockIntakeItemQty'].forEach(id => {
      const e = el(id); if (e) e.value = '';
    });
    document.querySelectorAll('[data-si-size]').forEach(i => { i.value = ''; });
    el('stockIntakeItemSizesRow')?.setAttribute('hidden', '');
    el('stockIntakeContainerInfo')?.setAttribute('hidden', '');

    showStep('container');
    renderStats();
    renderRecentList();

    overlay.hidden = false;
    document.body.style.overflow = 'hidden';
    setTimeout(() => el('stockIntakeContainerInput')?.focus(), 80);
  }

  function endSession() {
    if (session.itemsAdded > 0) {
      if (!confirm(`End session?\n\nYou added ${session.itemsAdded} item${session.itemsAdded === 1 ? '' : 's'} across ${session.containersTouched.size} container${session.containersTouched.size === 1 ? '' : 's'}.`)) return;
      showToast(`Session ended — ${session.itemsAdded} items saved.`, 'success');
    }
    closeIntakeModal();
  }

  function closeIntakeModal() {
    const overlay = el('stockIntakeOverlay');
    if (!overlay) return;
    overlay.hidden = true;
    document.body.style.overflow = '';
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
