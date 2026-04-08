(() => {
  if (!document.getElementById('fulfillmentScanPage')) return;

  const STORAGE_KEY = 'houston_control_fulfillment_scan_prototype_v2_manual_carriers';
  const FULFILLMENT_API_BASE = '/.netlify/functions/fulfillment-sync';
  let fspSyncEnabled = false;
  let fspSyncLoaded = false;
  let fspSyncInFlight = false;
  let fspSyncQueued = false;
  let fspSyncTimer = null;
  const MASTER_KEY = 'qaBlueSheetMastersV5';
  const CURRENT_USER_KEY = 'qaWorkflowCurrentUserV2';
  const EMPLOYEES_STORAGE_KEY = 'ops_hub_employees_v1';
  const DEFAULT_CARRIERS = ['UPS', 'FedEx', 'USPS', 'OSM', 'Passport'];
  const SCANNER_MODE = 'enter-suffix';
  const MIN_TRACKING_LENGTH = 12;
  const DEFAULT_BUCKET_MINUTES = 15;
  const SCANNER_CHAR_GAP_MS = 60;

  let scannerBuffer = '';
  let scannerLastKeyAt = 0;

  const el = {
    operatorInput: document.getElementById('fspOperatorInput'),
    operatorOptions: document.getElementById('fspOperatorOptions'),
    dateInput: document.getElementById('fspDateInput'),
    sessionNoteInput: document.getElementById('fspSessionNoteInput'),
    statusPill: document.getElementById('fspStatusPill'),
    openPalletSummary: document.getElementById('fspOpenPalletSummary'),
    liveStrip: document.getElementById('fspLiveStrip'),
    scanInput: document.getElementById('fspScanInput'),
    processScanBtn: document.getElementById('fspProcessScanBtn'),
    alertArea: document.getElementById('fspAlertArea'),
    currentScanBody: document.getElementById('fspCurrentScanBody'),
    eventLogBody: document.getElementById('fspEventLogBody'),
    palletHistoryBody: document.getElementById('fspPalletHistoryBody'),
    rejectedBody: document.getElementById('fspRejectedBody'),
    trafficSummary: document.getElementById('fspTrafficSummary'),
    trafficChart: document.getElementById('fspTrafficChart'),
    trafficBody: document.getElementById('fspTrafficBody'),
    bucketSizeSelect: document.getElementById('fspBucketSizeSelect'),
    statsGrid: document.getElementById('fspStatsGrid'),
    lookupInput: document.getElementById('fspLookupInput'),
    lookupBtn: document.getElementById('fspLookupBtn'),
    lookupClearBtn: document.getElementById('fspLookupClearBtn'),
    lookupResult: document.getElementById('fspLookupResult'),
    undoBtn: document.getElementById('fspUndoBtn'),
    exportBtn: document.getElementById('fspExportBtn'),
    resetBtn: document.getElementById('fspResetBtn'),
    carrierSelect: document.getElementById('fspCarrierSelect'),
    startSelectedBtn: document.getElementById('fspStartSelectedBtn'),
    endPalletBtn: document.getElementById('fspEndPalletBtn'),
    quickStartArea: document.getElementById('fspQuickStartArea'),
    newCarrierInput: document.getElementById('fspNewCarrierInput'),
    addCarrierBtn: document.getElementById('fspAddCarrierBtn'),
    carrierList: document.getElementById('fspCarrierList'),
    selectedCarrierText: document.getElementById('fspSelectedCarrierText'),
    openCarrierPickerBtn: document.getElementById('fspOpenCarrierPickerBtn'),
    openCarrierSetupBtn: document.getElementById('fspOpenCarrierSetupBtn'),
    carrierPickerModal: document.getElementById('fspCarrierPickerModal'),
    carrierSetupModal: document.getElementById('fspCarrierSetupModal'),
    infoModal: document.getElementById('fspInfoModal'),
    infoModalTitle: document.getElementById('fspInfoModalTitle'),
    infoModalValue: document.getElementById('fspInfoModalValue')
  };


  function readAttendanceEmployees() {
    try {
      if (typeof window.getActiveEmployees === 'function') {
        const active = window.getActiveEmployees();
        if (Array.isArray(active) && active.length) return active;
      }
    } catch {}
    try {
      if (Array.isArray(window.employees) && window.employees.length) return window.employees;
    } catch {}
    try {
      const raw = JSON.parse(localStorage.getItem(EMPLOYEES_STORAGE_KEY) || '[]');
      if (Array.isArray(raw)) return raw;
    } catch {}
    return [];
  }

  function readMasterAssociates() {
    try {
      if (window.state?.masters?.associates && Array.isArray(window.state.masters.associates)) {
        return window.state.masters.associates.filter(Boolean);
      }
    } catch {}
    try {
      const raw = JSON.parse(localStorage.getItem(MASTER_KEY) || '{}');
      if (Array.isArray(raw.associates)) return raw.associates.filter(Boolean);
    } catch {}
    return [];
  }

  function extractEmployeeName(item) {
    if (!item) return '';
    if (typeof item === 'string') return item.trim();
    if (typeof item === 'object') return String(item.name || item.employeeName || item.fullName || '').trim();
    return '';
  }

  function getOperatorOptions() {
    const attendanceNames = readAttendanceEmployees().map(extractEmployeeName).filter(Boolean);
    const fallbackNames = readMasterAssociates().map((name) => String(name || '').trim()).filter(Boolean);
    return [...new Set([...attendanceNames, ...fallbackNames])].sort((a, b) => a.localeCompare(b));
  }

  function getPreferredOperator() {
    const currentUser = String(window.state?.currentUser || localStorage.getItem(CURRENT_USER_KEY) || '').trim();
    const options = getOperatorOptions();
    if (state?.session?.operator && options.includes(state.session.operator)) return state.session.operator;
    if (currentUser && options.includes(currentUser)) return currentUser;
    return '';
  }

  const today = new Date().toISOString().slice(0, 10);
  const state = loadState();
  ensureCarriers();
  if (!state.session.operator || !getOperatorOptions().includes(state.session.operator)) {
    state.session.operator = getPreferredOperator();
  }
  if (!state.selectedDate) state.selectedDate = today;
  ensureDayRecord(state.selectedDate);
  if (!state.selectedCarrier || !state.carriers.includes(state.selectedCarrier)) {
    state.selectedCarrier = state.carriers[0];
  }


  hydrateSessionControls();
  bindEvents();
  render();
  loadFspFromBackend();
  // Refresh from backend on tab focus so multiple operators stay in sync
  window.addEventListener('focus', () => { if (fspSyncEnabled) loadFspFromBackend().catch(() => {}); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && fspSyncEnabled) loadFspFromBackend().catch(() => {});
  });

  function createDayRecord() {
    return {
      pallets: [],
      events: [],
      alerts: [],
      nextSequenceByCarrier: {}
    };
  }

  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      return {
        session: {
          operator: parsed.session?.operator || '',
          station: 'Main scan station',
          note: parsed.session?.note || ''
        },
        selectedDate: parsed.selectedDate || today,
        selectedCarrier: parsed.selectedCarrier || '',
        lookupQuery: parsed.lookupQuery || '',
        bucketMinutes: [15, 30, 60].includes(Number(parsed.bucketMinutes)) ? Number(parsed.bucketMinutes) : DEFAULT_BUCKET_MINUTES,
        carriers: Array.isArray(parsed.carriers) ? parsed.carriers.filter(Boolean) : [],
        openPallet: parsed.openPallet || null,
        days: parsed.days && typeof parsed.days === 'object' ? parsed.days : {},
        _uiAlerts: []
      };
    } catch {
      return {
        session: { operator: '', station: 'Main scan station', note: '' },
        selectedDate: today,
        selectedCarrier: '',
        lookupQuery: '',
        bucketMinutes: DEFAULT_BUCKET_MINUTES,
        carriers: [],
        openPallet: null,
        days: {},
        _uiAlerts: []
      };
    }
  }

  function saveState() {
    const payload = {
      session: state.session,
      selectedDate: state.selectedDate,
      selectedCarrier: state.selectedCarrier,
      lookupQuery: state.lookupQuery,
      bucketMinutes: state.bucketMinutes,
      carriers: state.carriers,
      openPallet: state.openPallet,
      days: state.days
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    scheduleFspSync();
  }

  function scheduleFspSync() {
    if (!fspSyncEnabled || !fspSyncLoaded) return;
    if (fspSyncTimer) clearTimeout(fspSyncTimer);
    fspSyncTimer = setTimeout(() => { fspSyncTimer = null; syncFspState(); }, 400);
  }

  async function fspApiRequest(method, body) {
    const options = { method, headers: { 'Accept': 'application/json' } };
    if (body !== undefined) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
    const response = await fetch(FULFILLMENT_API_BASE, options);
    const raw = await response.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw }; }
    if (!response.ok) throw new Error(data?.error || `Fulfillment sync failed (${response.status})`);
    return data;
  }

  function applyFspPayload(payload) {
    if (!payload || typeof payload.state !== 'object') return false;
    const remote = payload.state;
    // Merge remote days into local — remote is authoritative for any date it has
    if (remote.days && typeof remote.days === 'object') {
      state.days = { ...state.days, ...remote.days };
    }
    if (Array.isArray(remote.carriers) && remote.carriers.length) {
      state.carriers = [...new Set([...state.carriers, ...remote.carriers])];
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      session: state.session,
      selectedDate: state.selectedDate,
      selectedCarrier: state.selectedCarrier,
      lookupQuery: state.lookupQuery,
      bucketMinutes: state.bucketMinutes,
      carriers: state.carriers,
      openPallet: state.openPallet,
      days: state.days
    }));
    return true;
  }

  async function loadFspFromBackend() {
    try {
      const data = await fspApiRequest('GET');
      applyFspPayload(data);
      fspSyncEnabled = true;
      setFspSyncStatus('Fulfillment sync connected.', 'synced', { clearAfter: 2500 });
    } catch (err) {
      console.warn('Fulfillment sync unavailable, using browser storage.', err);
      fspSyncEnabled = false;
      setFspSyncStatus('Saving in this browser only.', 'local');
    } finally {
      fspSyncLoaded = true;
    }
  }

  async function syncFspState() {
    if (!fspSyncEnabled || !fspSyncLoaded) return;
    if (fspSyncInFlight) { fspSyncQueued = true; return; }
    fspSyncInFlight = true;
    const payload = { session: state.session, selectedDate: state.selectedDate,
      selectedCarrier: state.selectedCarrier, lookupQuery: state.lookupQuery,
      bucketMinutes: state.bucketMinutes, carriers: state.carriers,
      openPallet: state.openPallet, days: state.days };
    try {
      await fspApiRequest('POST', { state: payload });
      setFspSyncStatus('Fulfillment data saved.', 'synced', { clearAfter: 2000 });
    } catch (err) {
      console.warn('Fulfillment sync save failed; keeping local copy.', err);
      fspSyncEnabled = false;
      setFspSyncStatus('Sync failed. Saving in this browser only.', 'local');
    } finally {
      fspSyncInFlight = false;
      if (fspSyncQueued) { fspSyncQueued = false; syncFspState(); }
    }
  }

  function setFspSyncStatus(message, type, options = {}) {
    const banner = document.getElementById('fspSyncBanner');
    if (!banner) return;
    banner.textContent = message;
    banner.className = `fsp-sync-banner fsp-sync-${type}`;
    banner.style.display = message ? '' : 'none';
    if (options.clearAfter) {
      setTimeout(() => {
        if (banner.textContent === message) banner.style.display = 'none';
      }, options.clearAfter);
    }
  }

  function ensureCarriers() {
    const merged = [...new Set([...DEFAULT_CARRIERS, ...(state.carriers || [])].map(cleanCarrierName).filter(Boolean))];
    state.carriers = merged;
  }

  function ensureDayRecord(dateKey) {
    if (!state.days[dateKey]) state.days[dateKey] = createDayRecord();
    const day = state.days[dateKey];
    if (!day.nextSequenceByCarrier || typeof day.nextSequenceByCarrier !== 'object') {
      day.nextSequenceByCarrier = {};
    }
    state.carriers.forEach((carrier) => {
      if (!day.nextSequenceByCarrier[carrier]) day.nextSequenceByCarrier[carrier] = 1;
    });
  }

  function hydrateSessionControls() {
    renderOperatorOptions();
    el.operatorInput.value = state.session.operator || '';
    el.sessionNoteInput.value = state.session.note;
    el.dateInput.value = state.selectedDate;
    if (el.bucketSizeSelect) el.bucketSizeSelect.value = String(state.bucketMinutes || DEFAULT_BUCKET_MINUTES);
    if (el.lookupInput) el.lookupInput.value = state.lookupQuery || '';
  }

  function renderOperatorOptions() {
    if (!el.operatorInput) return;
    const options = getOperatorOptions();
    const current = options.includes(state.session.operator) ? state.session.operator : getPreferredOperator();
    if (current !== state.session.operator) state.session.operator = current;
    if (el.operatorOptions) {
      el.operatorOptions.innerHTML = options.map((name) => `<option value="${escapeHtml(name)}"></option>`).join('');
    }
    el.operatorInput.value = state.session.operator || '';
    el.operatorInput.disabled = !options.length;
    el.operatorInput.placeholder = options.length ? 'Select or type operator name' : 'No attendance names found yet';
    el.operatorInput.title = options.length ? '' : 'No names found in Attendance yet.';
  }


  function bindEvents() {
    const commitOperatorField = ({ showWarning = false } = {}) => {
      const typed = (el.operatorInput?.value || '').trim();
      if (!typed) {
        state.session.operator = '';
        saveState();
        render();
        return false;
      }
      const matched = findOperatorMatch(typed);
      if (matched) {
        state.session.operator = matched;
        el.operatorInput.value = matched;
        saveState();
        render();
        return true;
      }
      state.session.operator = '';
      if (showWarning) {
        el.operatorInput.value = '';
        pushAlert('warn', 'Pick an attendance name', 'Use a name from Attendance for the operator.');
      }
      saveState();
      render();
      return false;
    };
    el.operatorInput.addEventListener('input', () => {
      // Let the operator freely type to narrow the datalist choices.
      // Do not re-render here or the field will snap back to the prior saved name.
      if (!el.operatorInput.value.trim()) {
        state.session.operator = '';
        saveState();
      }
    });
    el.operatorInput.addEventListener('change', () => commitOperatorField({ showWarning: true }));
    el.operatorInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commitOperatorField({ showWarning: true });
        if (hasAssignedOperator()) {
          window.setTimeout(() => el.scanInput?.focus(), 0);
        }
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        el.operatorInput.value = '';
        state.session.operator = '';
        saveState();
        render();
      }
    });
    el.operatorInput.addEventListener('blur', () => {
      const typed = el.operatorInput.value.trim();
      if (!typed) {
        state.session.operator = '';
        saveState();
        render();
        return;
      }
      commitOperatorField({ showWarning: true });
    });
    el.sessionNoteInput.addEventListener('input', () => { state.session.note = el.sessionNoteInput.value.trim(); saveState(); });
    el.dateInput.addEventListener('change', () => {
      state.selectedDate = el.dateInput.value || today;
      ensureDayRecord(state.selectedDate);
      saveState();
      render();
    });
    el.carrierSelect?.addEventListener('change', () => {
      state.selectedCarrier = el.carrierSelect.value;
      saveState();
      render();
    });
    el.bucketSizeSelect?.addEventListener('change', () => {
      const next = Number(el.bucketSizeSelect.value) || DEFAULT_BUCKET_MINUTES;
      state.bucketMinutes = [15, 30, 60].includes(next) ? next : DEFAULT_BUCKET_MINUTES;
      saveState();
      render();
    });
    el.lookupBtn?.addEventListener('click', runLookupSearch);
    el.lookupClearBtn?.addEventListener('click', clearLookupSearch);
    el.lookupInput?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        runLookupSearch();
      }
    });
    el.openCarrierPickerBtn?.addEventListener('click', () => openModal('carrier-picker'));
    el.openCarrierSetupBtn?.addEventListener('click', () => openModal('carrier-setup'));
    document.querySelectorAll('[data-close-modal]').forEach((btn) => btn.addEventListener('click', () => closeModal(btn.dataset.closeModal)));
    [el.carrierPickerModal, el.carrierSetupModal, el.infoModal].forEach((modal) => modal?.addEventListener('click', (event) => { if (event.target === modal) closeAllModals(); }));
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeAllModals(); });
    el.startSelectedBtn?.addEventListener('click', () => startPallet(state.selectedCarrier));
    el.endPalletBtn?.addEventListener('click', endOpenPallet);
    el.processScanBtn.addEventListener('click', processCurrentInput);
    el.scanInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        window.setTimeout(processCurrentInput, 0);
        return;
      }
      if (event.key === 'Tab') {
        event.preventDefault();
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        clearScannerBuffer();
        return;
      }
      if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
        queueScannerCharacter(event.key);
      }
    });
    el.scanInput.addEventListener('blur', () => {
      window.setTimeout(() => {
        const active = document.activeElement;
        const allowFocusElsewhere = [el.lookupInput, el.newCarrierInput, el.operatorInput, el.dateInput, el.sessionNoteInput]
          .filter(Boolean)
          .includes(active);
        if (!allowFocusElsewhere && hasAssignedOperator()) el.scanInput.focus();
      }, 0);
    });
    document.addEventListener('keydown', (event) => {
      if (event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      const activeModal = document.querySelector('.fsp-modal-backdrop:not([hidden])');
      if (activeModal && target !== el.scanInput) return;
      if (targetAllowsNormalTyping(target)) return;
      if (!hasAssignedOperator()) return;
      if (!state.openPallet && normalizeCommand(event.key) !== 'PALLETEND') return;
      if (event.key === 'Enter') {
        if (!scannerBuffer && !el.scanInput?.value) return;
        event.preventDefault();
        consumeScannerBuffer();
        return;
      }
      if (event.key === 'Escape') {
        clearScannerBuffer();
        return;
      }
      if (event.key === 'Tab') {
        if (scannerBuffer) event.preventDefault();
        return;
      }
      if (event.key.length !== 1) return;
      event.preventDefault();
      queueScannerCharacter(event.key);
    }, true);
    document.querySelectorAll('[data-command]').forEach((btn) => btn.addEventListener('click', () => {
      handleScan(btn.dataset.command);
      el.scanInput.value = '';
      el.scanInput.focus();
    }));
    el.undoBtn.addEventListener('click', undoLastAcceptedScan);
    el.exportBtn.addEventListener('click', exportSelectedDay);
    el.resetBtn.addEventListener('click', resetPrototypeData);
    el.addCarrierBtn.addEventListener('click', addCarrierFromInput);
    el.newCarrierInput?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        addCarrierFromInput();
      }
    });
    el.quickStartArea?.addEventListener('click', (event) => {
      const selectTarget = event.target.closest('[data-select-carrier], .fsp-picker-row');
      if (selectTarget) {
        const pickedCarrier = cleanCarrierName(selectTarget.dataset.selectCarrier || selectTarget.dataset.carrier || '');
        if (pickedCarrier) {
          state.selectedCarrier = pickedCarrier;
          saveState();
          render();
          closeModal('carrier-picker');
        }
        if (event.target.closest('[data-select-carrier]')) return;
      }
      const button = event.target.closest('[data-quick-start]');
      if (!button) return;
      startPallet(button.dataset.quickStart);
    });
    el.carrierList?.addEventListener('click', (event) => {
      const removeButton = event.target.closest('[data-remove-carrier]');
      if (!removeButton) return;
      removeCarrier(removeButton.dataset.removeCarrier);
    });
    el.currentScanBody?.addEventListener('click', (event) => {
      const removeButton = event.target.closest('[data-remove-open-scan]');
      if (!removeButton) return;
      removeTrackingFromOpenPallet(removeButton.dataset.removeOpenScan);
    });
    el.openPalletSummary?.addEventListener('click', (event) => {
      const trigger = event.target.closest('[data-info-title][data-info-value]');
      if (!trigger) return;
      openInfoModal(trigger.dataset.infoTitle || 'Details', trigger.dataset.infoValue || '—');
    });
  }


  function setModalState(modal, isOpen) {
    if (!modal) return;
    modal.hidden = !isOpen;
    modal.classList.toggle('is-open', isOpen);
    const card = modal.querySelector('.fsp-modal');
    if (card) card.classList.toggle('is-open', isOpen);
  }

  function openModal(name) {
    if (name === 'carrier-picker') setModalState(el.carrierPickerModal, true);
    if (name === 'carrier-setup') setModalState(el.carrierSetupModal, true);
    if (name === 'info') setModalState(el.infoModal, true);
  }

  function closeModal(name) {
    if (name === 'carrier-picker') setModalState(el.carrierPickerModal, false);
    if (name === 'carrier-setup') setModalState(el.carrierSetupModal, false);
    if (name === 'info') setModalState(el.infoModal, false);
  }

  function closeAllModals() {
    setModalState(el.carrierPickerModal, false);
    setModalState(el.carrierSetupModal, false);
    setModalState(el.infoModal, false);
  }

  function openInfoModal(title, value) {
    if (el.infoModalTitle) el.infoModalTitle.textContent = title || 'Details';
    if (el.infoModalValue) el.infoModalValue.textContent = value || '—';
    openModal('info');
  }



  function findOperatorMatch(value) {
    const typed = String(value || '').trim().toLowerCase();
    if (!typed) return '';
    return getOperatorOptions().find((name) => name.toLowerCase() === typed) || '';
  }

  function hasAssignedOperator() {
    return Boolean(findOperatorMatch(state.session.operator || ''));
  }

  function isTypingTarget(target) {
    if (!target) return false;
    const tag = String(target.tagName || '').toUpperCase();
    if (target.isContentEditable) return true;
    if (tag === 'TEXTAREA') return true;
    if (tag !== 'INPUT') return false;
    const input = target;
    const type = String(input.type || 'text').toLowerCase();
    if (['button', 'checkbox', 'radio', 'range', 'file', 'submit', 'reset', 'color'].includes(type)) return false;
    return true;
  }

  function targetAllowsNormalTyping(target) {
    if (!isTypingTarget(target)) return false;
    // Allow typing in ANY input, textarea, select, or contenteditable on the page —
    // not just the scanner's own fields. This prevents the scanner listener from
    // swallowing keystrokes meant for other modules (e.g. cycle count batch inputs).
    return true;
  }

  function queueScannerCharacter(char) {
    const now = Date.now();
    if (now - scannerLastKeyAt > SCANNER_CHAR_GAP_MS) scannerBuffer = '';
    scannerLastKeyAt = now;
    scannerBuffer += char;
    if (el.scanInput) el.scanInput.value = scannerBuffer;
  }

  function consumeScannerBuffer() {
    const value = normalizeTracking(scannerBuffer || el.scanInput?.value || '');
    scannerBuffer = '';
    scannerLastKeyAt = 0;
    if (el.scanInput) el.scanInput.value = '';
    if (!value) return;
    handleScan(value);
    if (hasAssignedOperator()) {
      window.setTimeout(() => el.scanInput?.focus(), 0);
    }
  }

  function clearScannerBuffer() {
    scannerBuffer = '';
    scannerLastKeyAt = 0;
    if (el.scanInput) el.scanInput.value = '';
  }

  function requireOperator(contextLabel) {
    if (hasAssignedOperator()) return true;
    pushAlert('warn', 'Operator required', `Select the operator before ${contextLabel}.`);
    saveState();
    render();
    return false;
  }

  function currentDay() {
    ensureDayRecord(state.selectedDate);
    return state.days[state.selectedDate];
  }

  function processCurrentInput() {
    scannerBuffer = normalizeTracking(el.scanInput?.value || scannerBuffer || '');
    consumeScannerBuffer();
  }

  function handleScan(rawValue) {
    const value = rawValue.trim();
    const normalizedCommand = normalizeCommand(value);

    if (!requireOperator('scanning')) {
      logEvent({ type: 'tracking', value, result: 'error', reason: 'Operator required', carrier: state.openPallet?.expectedCarrier || '—', palletId: state.openPallet?.id || '—' });
      return;
    }

    if (normalizedCommand === 'PALLETEND' || normalizedCommand === 'END' || normalizedCommand === 'CLOSEPALLET') {
      endOpenPallet('PALLET_END');
      return;
    }

    if (!state.openPallet) {
      pushAlert('bad', 'No pallet open', 'Pick a carrier and start a pallet before scanning tracking numbers.');
      logEvent({ type: 'tracking', value, result: 'error', reason: 'No pallet open', carrier: '—', palletId: '—' });
      saveState();
      render();
      return;
    }

    const validationError = validateTrackingValue(value);
    if (validationError) {
      pushAlert('bad', 'Invalid tracking scan', validationError);
      logRejected(value, validationError, state.openPallet.id);
      logEvent({ type: 'tracking', value, result: 'error', reason: validationError, carrier: state.openPallet.expectedCarrier, palletId: state.openPallet.id });
      saveState();
      render();
      return;
    }

    const duplicateMatch = findTrackingDuplicate(value);

    if (duplicateMatch) {
      const reason = duplicateMatch.reason;
      pushAlert('bad', 'Duplicate scan blocked', duplicateMatch.message);
      logRejected(value, reason, state.openPallet.id);
      logEvent({ type: 'tracking', value, result: 'duplicate', reason, carrier: state.openPallet.expectedCarrier, palletId: state.openPallet.id });
      saveState();
      render();
      return;
    }

    const cleanedTracking = normalizeTracking(value);
    state.openPallet.trackingNumbers.push(cleanedTracking);
    state.openPallet.lastAcceptedTracking = cleanedTracking;
    state.openPallet.updatedAt = isoNow();
    pushAlert('good', 'Scan accepted', `${state.openPallet.expectedCarrier} label added to ${state.openPallet.id}.`);
    logEvent({ type: 'tracking', value: cleanedTracking, result: 'accepted', reason: '', carrier: state.openPallet.expectedCarrier, palletId: state.openPallet.id });
    saveState();
    render();
  }

  function startPallet(carrierName) {
    if (!requireOperator('starting a pallet')) return;
    const carrier = cleanCarrierName(carrierName);
    if (!carrier) {
      pushAlert('warn', 'Pick a carrier', 'Choose a carrier before opening a pallet.');
      saveState();
      render();
      return;
    }
    if (state.openPallet) {
      pushAlert('warn', 'Pallet already open', `Finish ${state.openPallet.id} before starting a new pallet.`);
      logEvent({ type: 'command', value: `START_${slugifyCarrier(carrier)}`, result: 'error', reason: 'Pallet already open', carrier, palletId: state.openPallet.id });
      saveState();
      render();
      return;
    }

    ensureCarrierExists(carrier);
    const day = currentDay();
    const sequence = day.nextSequenceByCarrier[carrier] || 1;
    const palletId = `${slugifyCarrier(carrier)}-${String(sequence).padStart(3, '0')}`;
    day.nextSequenceByCarrier[carrier] = sequence + 1;
    state.selectedCarrier = carrier;
    state.openPallet = {
      id: palletId,
      expectedCarrier: carrier,
      operator: findOperatorMatch(state.session.operator) || 'Unassigned',
      station: state.session.station || 'Unassigned',
      note: state.session.note || '',
      startedAt: isoNow(),
      updatedAt: isoNow(),
      trackingNumbers: [],
      lastAcceptedTracking: ''
    };
    pushAlert('good', 'Pallet opened', `${palletId} is ready for ${carrier} scans.`);
    logEvent({ type: 'command', value: `START_${slugifyCarrier(carrier)}`, result: 'command', reason: `Opened ${palletId}`, carrier, palletId });
    saveState();
    closeAllModals();
    render();
    el.scanInput.focus();
  }

  function endOpenPallet(rawValue = 'PALLET_END') {
    if (!state.openPallet) {
      pushAlert('warn', 'No pallet open', 'There is nothing to close right now.');
      logEvent({ type: 'command', value: rawValue, result: 'error', reason: 'No pallet open', carrier: '—', palletId: '—' });
      saveState();
      render();
      return;
    }

    const day = currentDay();
    const pallet = {
      ...state.openPallet,
      closedAt: isoNow(),
      status: state.openPallet.trackingNumbers.length ? 'Closed' : 'Closed empty'
    };
    day.pallets.unshift(pallet);
    pushAlert('good', 'Pallet closed', `${pallet.id} closed with ${pallet.trackingNumbers.length} accepted scans.`);
    logEvent({ type: 'command', value: rawValue, result: 'command', reason: `Closed ${pallet.id}`, carrier: pallet.expectedCarrier, palletId: pallet.id });
    state.openPallet = null;
    saveState();
    render();
    el.scanInput.focus();
  }

  function addCarrierFromInput() {
    const carrier = cleanCarrierName(el.newCarrierInput.value);
    if (!carrier) return;
    if (state.carriers.includes(carrier)) {
      pushAlert('warn', 'Carrier already exists', `${carrier} is already in the list.`);
      el.newCarrierInput.value = '';
      saveState();
      render();
      return;
    }
    state.carriers.push(carrier);
    state.carriers.sort((a, b) => a.localeCompare(b));
    ensureDayRecord(state.selectedDate);
    Object.values(state.days).forEach((day) => {
      if (!day.nextSequenceByCarrier[carrier]) day.nextSequenceByCarrier[carrier] = 1;
    });
    state.selectedCarrier = carrier;
    el.newCarrierInput.value = '';
    pushAlert('good', 'Carrier added', `${carrier} is now available for new pallets.`);
    saveState();
    render();
  }

  function removeCarrier(carrierName) {
    const carrier = cleanCarrierName(carrierName);
    if (!carrier || !state.carriers.includes(carrier)) return;
    if (state.openPallet?.expectedCarrier === carrier) {
      pushAlert('warn', 'Carrier in use', `Close ${state.openPallet.id} before removing ${carrier}.`);
      saveState();
      render();
      return;
    }
    if (state.carriers.length <= 1) {
      pushAlert('warn', 'Keep at least one carrier', 'The prototype needs one carrier available to start pallets.');
      saveState();
      render();
      return;
    }
    state.carriers = state.carriers.filter((item) => item !== carrier);
    if (!state.carriers.includes(state.selectedCarrier)) {
      state.selectedCarrier = state.carriers[0];
    }
    pushAlert('warn', 'Carrier removed', `${carrier} was removed from future quick-start options.`);
    saveState();
    render();
  }

  function ensureCarrierExists(carrier) {
    if (!state.carriers.includes(carrier)) {
      state.carriers.push(carrier);
      state.carriers.sort((a, b) => a.localeCompare(b));
    }
    Object.values(state.days).forEach((day) => {
      if (!day.nextSequenceByCarrier[carrier]) day.nextSequenceByCarrier[carrier] = 1;
    });
  }

  function findTrackingDuplicate(value) {
    const normalizedValue = normalizeTracking(value);
    if (!normalizedValue) return null;

    const openMatch = state.openPallet?.trackingNumbers.find((tracking) => normalizeTracking(tracking) === normalizedValue);
    if (openMatch) {
      return {
        reason: 'Duplicate on open pallet',
        message: 'That tracking number is already on the open pallet.'
      };
    }

    for (const [dateKey, day] of Object.entries(state.days || {})) {
      for (const pallet of day.pallets || []) {
        const matchedTracking = (pallet.trackingNumbers || []).find((tracking) => normalizeTracking(tracking) === normalizedValue);
        if (matchedTracking) {
          return {
            reason: 'Duplicate in shipment history',
            message: `That tracking number was already shipped on ${dateKey} in ${pallet.id}.`
          };
        }
      }
    }

    return null;
  }

  function normalizeTracking(value) {
    return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  function normalizeCommand(value) {
    return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  function validateTrackingValue(value) {
    const normalized = normalizeTracking(value);
    if (!normalized) return 'Scan was empty.';
    if (normalized.length < MIN_TRACKING_LENGTH) {
      return `Scan looks incomplete. Minimum tracking length is ${MIN_TRACKING_LENGTH} characters.`;
    }
    if (!/[A-Z0-9]/.test(normalized)) {
      return 'Scan does not look like a tracking number.';
    }
    return '';
  }

  function logEvent({ type, value, result, reason, carrier, palletId }) {
    currentDay().events.unshift({ timestamp: isoNow(), type, value, result, reason, carrier, palletId });
  }

  function logRejected(value, reason, palletId) {
    currentDay().alerts.unshift({ timestamp: isoNow(), value, reason, palletId });
  }

  function pushAlert(kind, title, body) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const alert = { id, kind, title, body };
    state._uiAlerts = [alert, ...(state._uiAlerts || [])].slice(0, 4);
  }

  function undoLastAcceptedScan() {
    if (!state.openPallet || !state.openPallet.trackingNumbers.length) {
      pushAlert('warn', 'Nothing to delete', 'There is no accepted scan on the open pallet to remove.');
      saveState();
      render();
      return;
    }
    removeTrackingFromOpenPallet(state.openPallet.trackingNumbers[state.openPallet.trackingNumbers.length - 1], { isLast: true });
  }

  function removeTrackingFromOpenPallet(value, options = {}) {
    if (!state.openPallet || !state.openPallet.trackingNumbers.length) {
      pushAlert('warn', 'Nothing to delete', 'There is no open-pallet scan to remove.');
      saveState();
      render();
      return;
    }

    const normalizedValue = normalizeTracking(value);
    const index = state.openPallet.trackingNumbers.findIndex((tracking) => normalizeTracking(tracking) === normalizedValue);
    if (index === -1) {
      pushAlert('warn', 'Scan not found', 'That tracking number is no longer on the open pallet.');
      saveState();
      render();
      return;
    }

    const [removed] = state.openPallet.trackingNumbers.splice(index, 1);
    state.openPallet.lastAcceptedTracking = state.openPallet.trackingNumbers.at(-1) || '';
    state.openPallet.updatedAt = isoNow();
    const actionLabel = options.isLast ? 'Delete last accepted scan' : 'Delete accepted scan';
    logEvent({ type: 'command', value: removed, result: 'command', reason: actionLabel, carrier: state.openPallet.expectedCarrier, palletId: state.openPallet.id });
    pushAlert('warn', 'Scan removed', `${removed} was removed from ${state.openPallet.id}.`);
    saveState();
    render();
    el.scanInput.focus();
  }

  function exportSelectedDay() {
    const payload = {
      date: state.selectedDate,
      session: state.session,
      selectedCarrier: state.selectedCarrier,
      lookupQuery: state.lookupQuery,
      bucketMinutes: state.bucketMinutes,
      carriers: state.carriers,
      openPallet: state.openPallet,
      day: currentDay()
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fulfillment-scan-prototype-${state.selectedDate}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function resetPrototypeData() {
    const ok = window.confirm('Clear all prototype scan data? This only resets the standalone prototype.');
    if (!ok) return;
    localStorage.removeItem(STORAGE_KEY);
    window.location.reload();
  }

  function render() {
    renderOperatorOptions();
    renderCarrierControls();
    renderOpenPallet();
    renderAlerts();
    renderCurrentPalletScans();
    renderEventLog();
    renderPalletHistory();
    renderRejected();
    renderTraffic();
    renderStats();
    renderLookupResult();
  }

  function renderCarrierControls() {
    const operatorReady = hasAssignedOperator();
    const validOperator = findOperatorMatch(state.session.operator);
    el.selectedCarrierText.textContent = state.selectedCarrier || '—';
    if (el.carrierSelect) {
      el.carrierSelect.innerHTML = state.carriers.map((carrier) => `<option value="${escapeHtml(carrier)}" ${carrier === state.selectedCarrier ? 'selected' : ''}>${escapeHtml(carrier)}</option>`).join('');
    }
    el.quickStartArea.innerHTML = state.carriers.map((carrier) => `
      <div class="fsp-picker-row ${carrier === state.selectedCarrier ? 'is-selected' : ''}" data-carrier="${escapeHtml(carrier)}" tabindex="0" role="button" aria-label="Select ${escapeHtml(carrier)}">
        <div>
          <span class="fsp-picker-title">${escapeHtml(carrier)}</span>
          <span class="fsp-picker-sub">Next pallet code: ${escapeHtml(slugifyCarrier(carrier))}</span>
        </div>
        <div class="fsp-inline-actions">
          <button type="button" class="fsp-btn secondary fsp-small-btn" data-select-carrier="${escapeHtml(carrier)}">Use this carrier</button>
          <button type="button" class="fsp-btn primary fsp-small-btn" data-quick-start="${escapeHtml(carrier)}" ${operatorReady && !state.openPallet ? '' : 'disabled'}>Start pallet now</button>
        </div>
      </div>
    `).join('');
    el.startSelectedBtn.disabled = !operatorReady || Boolean(state.openPallet);
    el.processScanBtn.disabled = !operatorReady;
    el.scanInput.disabled = !operatorReady;
    if (el.endPalletBtn) el.endPalletBtn.disabled = !state.openPallet;
    el.scanInput.placeholder = operatorReady ? 'Scanner waits for Enter suffix after each scan' : 'Select operator first';
    el.carrierList.innerHTML = state.carriers.map((carrier) => `
      <div class="fsp-carrier-row">
        <div>
          <strong>${escapeHtml(carrier)}</strong>
          <div class="fsp-carrier-sub">Next pallet code: ${escapeHtml(slugifyCarrier(carrier))}</div>
        </div>
        <button type="button" class="fsp-btn secondary fsp-small-btn" data-remove-carrier="${escapeHtml(carrier)}">Remove</button>
      </div>
    `).join('');
  }

  function infoValue(title, value) {
    const safeTitle = escapeHtml(title || 'Details');
    const rawValue = value == null || value === '' ? '—' : String(value);
    const safeValue = escapeHtml(rawValue);
    return `<button type="button" class="fsp-kv-value" data-info-title="${safeTitle}" data-info-value="${safeValue}" title="${safeValue}" aria-label="Open full ${safeTitle}">${safeValue}</button>`;
  }

  function renderOpenPallet() {
    const open = state.openPallet;
    if (!open) {
      el.statusPill.className = 'fsp-status-pill idle';
      el.statusPill.textContent = 'No pallet open';
      el.openPalletSummary.innerHTML = '<div class="fsp-empty-state">Pick a carrier below, start a pallet, then scan box after box.</div>';
      el.liveStrip.innerHTML = summaryChip('Selected date', state.selectedDate)
        + summaryChip('Selected carrier', state.selectedCarrier || '—')
        + summaryChip('Operator', state.session.operator || 'Required before use')
        + summaryChip('Scanner mode', 'Enter suffix required');
      return;
    }

    el.statusPill.className = 'fsp-status-pill open';
    el.statusPill.textContent = `${open.expectedCarrier} pallet open`;
    el.openPalletSummary.innerHTML = `
      <div class="fsp-open-grid">
        <div class="fsp-kv"><span>Pallet ID</span>${infoValue('Pallet ID', open.id)}</div>
        <div class="fsp-kv"><span>Carrier</span>${infoValue('Carrier', open.expectedCarrier)}</div>
        <div class="fsp-kv"><span>Accepted scans</span>${infoValue('Accepted scans', open.trackingNumbers.length)}</div>
        <div class="fsp-kv"><span>Started</span>${infoValue('Started', formatDateTime(open.startedAt))}</div>
        <div class="fsp-kv"><span>Operator</span>${infoValue('Operator', open.operator)}</div>
        <div class="fsp-kv"><span>Scanner mode</span>${infoValue('Scanner mode', 'Enter suffix required')}</div>
        <div class="fsp-kv"><span>Last accepted</span>${infoValue('Last accepted', open.lastAcceptedTracking || '—')}</div>
        <div class="fsp-kv"><span>Session note</span>${infoValue('Session note', open.note || '—')}</div>
      </div>
    `;
    el.liveStrip.innerHTML = summaryChip('Selected date', state.selectedDate)
      + summaryChip('Closed pallets today', String(currentDay().pallets.length))
      + summaryChip('Rejected events today', String(currentDay().alerts.length));
  }

  function renderAlerts() {
    const alerts = state._uiAlerts || [];
    el.alertArea.innerHTML = alerts.length ? alerts.map((alert) => `
      <div class="fsp-alert ${alert.kind}">
        <strong>${escapeHtml(alert.title)}</strong>
        <div>${escapeHtml(alert.body)}</div>
      </div>
    `).join('') : '';
  }

  function renderCurrentPalletScans() {
    const open = state.openPallet;
    if (!open || !open.trackingNumbers.length) {
      el.currentScanBody.innerHTML = emptyRow(3, open ? 'No scans on the open pallet yet.' : 'Open a pallet to see removable scans here.');
      return;
    }

    const rows = [...open.trackingNumbers].map((tracking, index) => ({
      tracking,
      index,
      displayOrder: index + 1
    })).reverse();

    el.currentScanBody.innerHTML = rows.map((row) => `
      <tr>
        <td>${row.displayOrder}</td>
        <td>${escapeHtml(row.tracking)}</td>
        <td><button type="button" class="fsp-btn secondary fsp-small-btn" data-remove-open-scan="${escapeHtml(row.tracking)}">Delete</button></td>
      </tr>
    `).join('');
  }

  function renderEventLog() {
    const rows = currentDay().events.slice(0, 16);
    el.eventLogBody.innerHTML = rows.length ? rows.map((row) => `
      <tr>
        <td>${formatTime(row.timestamp)}</td>
        <td>${escapeHtml(row.type)}</td>
        <td>${escapeHtml(row.value)}</td>
        <td>${escapeHtml(row.carrier || '—')}</td>
        <td><span class="fsp-result-pill ${resultClass(row.result)}">${escapeHtml(row.result)}</span></td>
        <td>${escapeHtml(row.palletId || '—')}</td>
      </tr>
    `).join('') : emptyRow(6, 'No events logged for this date yet.');
  }

  function renderPalletHistory() {
    const rows = currentDay().pallets;
    el.palletHistoryBody.innerHTML = rows.length ? rows.map((pallet) => `
      <tr>
        <td>${escapeHtml(pallet.id)}</td>
        <td>${escapeHtml(pallet.expectedCarrier)}</td>
        <td>${pallet.trackingNumbers.length}</td>
        <td>${formatDateTime(pallet.startedAt)}</td>
        <td>${formatDateTime(pallet.closedAt)}</td>
        <td>${escapeHtml(pallet.operator)}</td>
        <td>${escapeHtml(pallet.status)}</td>
      </tr>
    `).join('') : emptyRow(7, 'No closed pallets on this date yet.');
  }

  function renderRejected() {
    const rows = currentDay().alerts.slice(0, 20);
    el.rejectedBody.innerHTML = rows.length ? rows.map((row) => `
      <tr>
        <td>${formatTime(row.timestamp)}</td>
        <td>${escapeHtml(row.value)}</td>
        <td>${escapeHtml(row.reason)}</td>
        <td>${escapeHtml(row.palletId || '—')}</td>
      </tr>
    `).join('') : emptyRow(4, 'No rejected scans for this date.');
  }



  function runLookupSearch() {
    state.lookupQuery = (el.lookupInput?.value || '').trim();
    saveState();
    renderLookupResult();
  }

  function clearLookupSearch() {
    state.lookupQuery = '';
    if (el.lookupInput) el.lookupInput.value = '';
    saveState();
    renderLookupResult();
  }

  function renderLookupResult() {
    if (!el.lookupResult) return;
    const query = (state.lookupQuery || '').trim();
    if (!query) {
      el.lookupResult.innerHTML = '<div class="fsp-empty-state">Scan or paste a tracking number here to search the full shipment history.</div>';
      return;
    }

    const normalized = normalizeTracking(query);
    if (!normalized) {
      el.lookupResult.innerHTML = '<div class="fsp-empty-state">That search was empty after cleaning the value.</div>';
      return;
    }

    const match = findTrackingRecord(normalized);
    if (!match) {
      el.lookupResult.innerHTML = `
        <div class="fsp-lookup-card miss">
          <div class="fsp-lookup-title">No shipment found</div>
          <div class="fsp-lookup-grid">
            <div class="fsp-kv"><span>Searched value</span><strong>${escapeHtml(normalized)}</strong></div>
            <div class="fsp-kv"><span>Status</span><strong>Not found in saved history</strong></div>
          </div>
        </div>
      `;
      return;
    }

    const whenText = match.event?.timestamp ? formatDateTime(match.event.timestamp) : (match.source === 'open' ? 'Open pallet, not closed yet' : 'Found');
    const resultText = match.source === 'open' ? 'Currently on open pallet' : 'Shipped and recorded';
    el.lookupResult.innerHTML = `
      <div class="fsp-lookup-card hit">
        <div class="fsp-lookup-title">Shipment found</div>
        <div class="fsp-lookup-grid">
          <div class="fsp-kv"><span>Tracking</span><strong>${escapeHtml(match.tracking)}</strong></div>
          <div class="fsp-kv"><span>Status</span><strong>${escapeHtml(resultText)}</strong></div>
          <div class="fsp-kv"><span>Date</span><strong>${escapeHtml(match.dateKey || 'Today')}</strong></div>
          <div class="fsp-kv"><span>Time scanned</span><strong>${escapeHtml(whenText)}</strong></div>
          <div class="fsp-kv"><span>Carrier</span><strong>${escapeHtml(match.carrier || '—')}</strong></div>
          <div class="fsp-kv"><span>Pallet</span><strong>${escapeHtml(match.palletId || '—')}</strong></div>
          <div class="fsp-kv"><span>Operator</span><strong>${escapeHtml(match.operator || '—')}</strong></div>
          <div class="fsp-kv"><span>Selected date view</span><strong>${escapeHtml(state.selectedDate)}</strong></div>
        </div>
      </div>
    `;
  }

  function findTrackingRecord(normalizedValue) {
    if (!normalizedValue) return null;

    if (state.openPallet) {
      const openMatch = (state.openPallet.trackingNumbers || []).find((tracking) => normalizeTracking(tracking) === normalizedValue);
      if (openMatch) {
        const openEvent = currentDay().events.find((event) => event.result === 'accepted' && normalizeTracking(event.value) === normalizedValue && event.palletId === state.openPallet.id);
        return {
          source: 'open',
          tracking: openMatch,
          dateKey: state.selectedDate,
          event: openEvent || null,
          carrier: state.openPallet.expectedCarrier,
          palletId: state.openPallet.id,
          operator: state.openPallet.operator
        };
      }
    }

    for (const [dateKey, day] of Object.entries(state.days || {})) {
      for (const pallet of day.pallets || []) {
        const matchedTracking = (pallet.trackingNumbers || []).find((tracking) => normalizeTracking(tracking) === normalizedValue);
        if (matchedTracking) {
          const acceptedEvent = (day.events || []).find((event) => event.result === 'accepted' && normalizeTracking(event.value) === normalizedValue && event.palletId === pallet.id);
          return {
            source: 'closed',
            tracking: matchedTracking,
            dateKey,
            event: acceptedEvent || null,
            carrier: pallet.expectedCarrier,
            palletId: pallet.id,
            operator: pallet.operator
          };
        }
      }
    }

    return null;
  }


  function renderTraffic() {
    const bucketMinutes = state.bucketMinutes || DEFAULT_BUCKET_MINUTES;
    const buckets = buildTrafficBuckets(currentDay(), bucketMinutes);
    const activeBuckets = buckets.filter((bucket) => bucket.accepted || bucket.closed || bucket.rejected);

    if (!activeBuckets.length) {
      el.trafficSummary.innerHTML = `
        <div class="fsp-stat-card"><span>Peak window</span><strong>—</strong></div>
        <div class="fsp-stat-card"><span>Peak accepted scans</span><strong>0</strong></div>
        <div class="fsp-stat-card"><span>Average / active block</span><strong>0.0</strong></div>
        <div class="fsp-stat-card"><span>Active time blocks</span><strong>0</strong></div>
      `;
      el.trafficChart.innerHTML = '<div class="fsp-empty-state">No scan traffic on this date yet.</div>';
      el.trafficBody.innerHTML = emptyRow(4, 'No traffic blocks on this date yet.');
      return;
    }

    const peakBucket = activeBuckets.reduce((best, bucket) => bucket.accepted > best.accepted ? bucket : best, activeBuckets[0]);
    const avgAccepted = (activeBuckets.reduce((sum, bucket) => sum + bucket.accepted, 0) / activeBuckets.length).toFixed(1);

    el.trafficSummary.innerHTML = `
      <div class="fsp-stat-card"><span>Peak window</span><strong>${escapeHtml(peakBucket.label)}</strong></div>
      <div class="fsp-stat-card"><span>Peak accepted scans</span><strong>${peakBucket.accepted}</strong></div>
      <div class="fsp-stat-card"><span>Average / active block</span><strong>${avgAccepted}</strong></div>
      <div class="fsp-stat-card"><span>Active time blocks</span><strong>${activeBuckets.length}</strong></div>
    `;

    const maxAccepted = Math.max(...activeBuckets.map((bucket) => bucket.accepted), 1);
    el.trafficChart.innerHTML = `
      <div class="fsp-bar-chart">
        ${activeBuckets.map((bucket) => `
          <div class="fsp-bar-col">
            <div class="fsp-bar-value">${bucket.accepted}</div>
            <div class="fsp-bar-track">
              <div class="fsp-bar-fill" style="height:${Math.max(8, Math.round((bucket.accepted / maxAccepted) * 100))}%"></div>
            </div>
            <div class="fsp-bar-label">${escapeHtml(shortBucketLabel(bucket.label))}</div>
          </div>
        `).join('')}
      </div>
    `;

    el.trafficBody.innerHTML = activeBuckets.map((bucket) => `
      <tr>
        <td>${escapeHtml(bucket.label)}</td>
        <td>${bucket.accepted}</td>
        <td>${bucket.closed}</td>
        <td>${bucket.rejected}</td>
      </tr>
    `).join('');
  }

  function buildTrafficBuckets(day, bucketMinutes) {
    const buckets = [];
    const total = Math.ceil(24 * 60 / bucketMinutes);
    for (let i = 0; i < total; i += 1) {
      const startMin = i * bucketMinutes;
      const endMin = Math.min(startMin + bucketMinutes, 24 * 60);
      buckets.push({
        startMin,
        endMin,
        label: `${formatMinutesLabel(startMin)}–${formatMinutesLabel(endMin)}`,
        accepted: 0,
        closed: 0,
        rejected: 0
      });
    }

    (day.events || []).forEach((event) => {
      if (event.result !== 'accepted') return;
      const index = timeToBucketIndex(event.timestamp, bucketMinutes);
      if (buckets[index]) buckets[index].accepted += 1;
    });
    (day.pallets || []).forEach((pallet) => {
      const index = timeToBucketIndex(pallet.closedAt || pallet.startedAt, bucketMinutes);
      if (buckets[index]) buckets[index].closed += 1;
    });
    (day.alerts || []).forEach((alert) => {
      const index = timeToBucketIndex(alert.timestamp, bucketMinutes);
      if (buckets[index]) buckets[index].rejected += 1;
    });
    return buckets;
  }

  function timeToBucketIndex(iso, bucketMinutes) {
    const date = new Date(iso);
    const mins = date.getHours() * 60 + date.getMinutes();
    return Math.max(0, Math.min(Math.floor(mins / bucketMinutes), Math.ceil(24 * 60 / bucketMinutes) - 1));
  }

  function formatMinutesLabel(totalMinutes) {
    const safe = Math.min(totalMinutes, 24 * 60 - 1);
    const hours24 = Math.floor(safe / 60);
    const minutes = safe % 60;
    const suffix = hours24 >= 12 ? 'PM' : 'AM';
    const hours12 = ((hours24 + 11) % 12) + 1;
    return `${hours12}:${String(minutes).padStart(2, '0')} ${suffix}`;
  }

  function shortBucketLabel(label) {
    return label.replace(/:00 /g, ' ').replace(/([AP]M).*/, '$1');
  }

  function renderStats() {
    const day = currentDay();
    const accepted = day.events.filter((row) => row.result === 'accepted').length;
    const duplicates = day.events.filter((row) => row.result === 'duplicate').length;
    const averageBoxes = day.pallets.length ? (day.pallets.reduce((sum, pallet) => sum + pallet.trackingNumbers.length, 0) / day.pallets.length).toFixed(1) : '0.0';
    const carrierBreakdown = state.carriers
      .map((carrier) => `${carrier}: ${day.pallets.filter((pallet) => pallet.expectedCarrier === carrier).length}`)
      .join(' · ');
    const cards = [
      ['Accepted scans', accepted],
      ['Closed pallets', day.pallets.length],
      ['Average boxes / pallet', averageBoxes],
      ['Rejected scans', day.alerts.length],
      ['Duplicate blocks', duplicates],
      ['Open pallet boxes', state.openPallet?.trackingNumbers.length || 0],
      ['Active carrier', state.openPallet?.expectedCarrier || state.selectedCarrier || '—'],
      ['Pallets by carrier', carrierBreakdown || '—']
    ];
    el.statsGrid.innerHTML = cards.map(([label, value]) => `
      <div class="fsp-stat-card">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(String(value))}</strong>
      </div>
    `).join('');
  }

  function summaryChip(label, value) {
    return `<span class="fsp-summary-chip"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</span>`;
  }

  function emptyRow(colspan, text) {
    return `<tr><td colspan="${colspan}" style="color: var(--fsp-muted);">${escapeHtml(text)}</td></tr>`;
  }

  function resultClass(result) {
    if (['accepted', 'command'].includes(result)) return result;
    if (['duplicate', 'error'].includes(result)) return result;
    return 'error';
  }

  function cleanCarrierName(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function slugifyCarrier(value) {
    return cleanCarrierName(value).toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'CARRIER';
  }

  function formatTime(iso) {
    return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  }

  function formatDateTime(iso) {
    return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  function isoNow() {
    return new Date().toISOString();
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
})();
