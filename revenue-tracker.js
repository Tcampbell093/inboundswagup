// ===== REVENUE TRACKER MODULE =====
// Tracks monthly revenue from imported report + assembly completions
// Deduplicates: if a SORD is already in the imported "Mission Complete" list,
// assembly rows for that same SORD do not double-count.

(function () {
  const STORAGE_KEY = 'ops_hub_rev_tracker_v1';
  const GOAL_KEY = 'ops_hub_rev_goal_v1';

  // ── Persistence ──────────────────────────────────────────────────────────
  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : emptyState();
    } catch { return emptyState(); }
  }

  function emptyState() {
    return { rows: [], importedAt: null, fileName: null };
  }

  function saveState(state) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
  }

  function loadGoal() {
    try {
      const raw = localStorage.getItem(GOAL_KEY);
      return raw ? JSON.parse(raw) : { amount: 0 };
    } catch { return { amount: 0 }; }
  }

  function saveGoal(amount) {
    try { localStorage.setItem(GOAL_KEY, JSON.stringify({ amount: Number(amount) || 0 })); } catch {}
  }

  // ── Import parsing ────────────────────────────────────────────────────────
  function normalizeKey(key) {
    return String(key || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[:\n\r\t()/]+/g, ' ')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase();
  }

  function parseRevTrackerRows(rawRows) {
    const out = [];
    rawRows.forEach(raw => {
      const r = {};
      Object.keys(raw || {}).forEach(k => { r[normalizeKey(k)] = raw[k]; });

      const sord = String(
        r.sales_order_name || r.sales_order || r.sord || ''
      ).trim();
      if (!sord) return; // skip rows with no SORD

      const subtotal = Number(
        String(r.subtotal || r.invoice_subtotal || 0).replace(/[$,]/g, '')
      ) || 0;

      const account = String(
        r.account_account_name || r.account || r.account_name || ''
      ).trim();

      const invoice = String(r.invoice_name || r.invoice || '').trim();
      const status = String(r.status || '').trim();
      const poStatus = String(r.po_status || '').trim();

      out.push({ sord, subtotal, account, invoice, status, poStatus });
    });
    return out;
  }

  async function importFile(file) {
    if (!file) throw new Error('No file selected.');
    await ensureXlsx();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
          const sheet = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
          const parsed = parseRevTrackerRows(rows);
          const state = { rows: parsed, importedAt: new Date().toISOString(), fileName: file.name };
          saveState(state);
          resolve(state);
        } catch (err) { reject(err); }
      };
      reader.onerror = () => reject(new Error('Could not read file.'));
      reader.readAsArrayBuffer(file);
    });
  }

  function ensureXlsx() {
    return new Promise((resolve, reject) => {
      if (typeof XLSX !== 'undefined') { resolve(); return; }
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/xlsx/dist/xlsx.full.min.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('XLSX library failed to load.'));
      document.body.appendChild(s);
    });
  }

  // ── Revenue calculation ───────────────────────────────────────────────────
  // Returns { importedTotal, assemblyBonus, grandTotal, importedSords, assemblySords, allRows }
  function calcRevenue() {
    const state = loadState();
    const importedRows = state.rows || [];

    // Build set of SORDs already in the imported report
    const importedSordSet = new Set(
      importedRows.map(r => String(r.sord || '').trim().toUpperCase()).filter(Boolean)
    );

    // Sum the imported report (each row is one invoice, already filtered to have a SORD)
    const importedTotal = importedRows.reduce((s, r) => s + (Number(r.subtotal) || 0), 0);

    // Assembly rows marked "done" — grab from global assemblyBoardRows if available
    const asmRows = (typeof assemblyBoardRows !== 'undefined' && Array.isArray(assemblyBoardRows))
      ? assemblyBoardRows : [];

    // For each "done" assembly row, include its subtotal ONLY if its SORD is NOT already
    // in the imported report (prevents double-count)
    const seenAssemblySords = new Set();
    let assemblyBonus = 0;
    const assemblySordsList = [];

    asmRows.forEach(row => {
      if (String(row.stage || '') !== 'done') return;
      const sord = String(row.so || '').trim().toUpperCase();
      if (!sord) return;
      if (importedSordSet.has(sord)) return; // already counted in import
      if (seenAssemblySords.has(sord)) return; // deduplicate multi-PB same SORD
      seenAssemblySords.add(sord);

      // Use getEffectiveSubtotalForRow if available, otherwise row.subtotal
      const sub = (typeof getEffectiveSubtotalForRow === 'function')
        ? (Number(getEffectiveSubtotalForRow(row)) || 0)
        : (Number(row.subtotal) || 0);

      assemblyBonus += sub;
      assemblySordsList.push({ sord: row.so, account: row.account, subtotal: sub, pb: row.pb });
    });

    const grandTotal = importedTotal + assemblyBonus;
    return {
      importedTotal,
      assemblyBonus,
      grandTotal,
      importedCount: importedRows.length,
      assemblyCount: assemblySordsList.length,
      assemblySords: assemblySordsList,
      importedAt: state.importedAt,
      fileName: state.fileName,
    };
  }

  // ── Rendering ─────────────────────────────────────────────────────────────
  function fmt(n) {
    return Number(n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  function fmtFull(n) {
    return Number(n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function render() {
    const panel = document.getElementById('revTrackerPanel');
    if (!panel) return;

    const calc = calcRevenue();
    const goal = loadGoal();
    const goalAmt = Number(goal.amount) || 0;
    const pct = goalAmt > 0 ? (calc.grandTotal / goalAmt) * 100 : null;
    const remaining = goalAmt > 0 ? goalAmt - calc.grandTotal : null;
    const over = remaining !== null && remaining < 0;

    // Health strip card
    const cardVal = document.getElementById('mcMonthRevenue');
    const cardSub = document.getElementById('mcMonthRevenueSub');
    const cardEl = document.getElementById('mcMonthRevenueCard');
    if (cardVal) cardVal.textContent = fmt(calc.grandTotal);
    if (cardSub) {
      if (pct !== null) {
        cardSub.textContent = over
          ? `${fmt(Math.abs(remaining))} over goal 🎉`
          : `${pct.toFixed(1)}% of ${fmt(goalAmt)} goal`;
      } else {
        cardSub.textContent = `${calc.importedCount} SORDs imported`;
      }
    }
    if (cardEl) {
      cardEl.classList.remove('is-good', 'is-watch', 'is-risk');
      if (pct === null) cardEl.classList.add('is-watch');
      else if (over || pct >= 100) cardEl.classList.add('is-good');
      else if (pct >= 75) cardEl.classList.add('is-watch');
      else cardEl.classList.add('is-risk');
    }

    // Main panel
    const progressBar = document.getElementById('revProgressBar');
    const progressFill = document.getElementById('revProgressFill');
    const revGrandTotal = document.getElementById('revGrandTotal');
    const revGoalDisplay = document.getElementById('revGoalDisplay');
    const revPctDisplay = document.getElementById('revPctDisplay');
    const revRemainingDisplay = document.getElementById('revRemainingDisplay');
    const revImportedLine = document.getElementById('revImportedLine');
    const revAssemblyLine = document.getElementById('revAssemblyLine');
    const revImportMeta = document.getElementById('revImportMeta');
    const revAssemblyDetail = document.getElementById('revAssemblyDetail');

    if (revGrandTotal) revGrandTotal.textContent = fmtFull(calc.grandTotal);

    if (goalAmt > 0) {
      const clampedPct = Math.min(pct, 100);
      if (progressBar) progressBar.style.display = '';
      if (progressFill) {
        progressFill.style.width = clampedPct.toFixed(2) + '%';
        progressFill.classList.toggle('rev-bar-over', over);
      }
      if (revGoalDisplay) revGoalDisplay.textContent = fmt(goalAmt);
      if (revPctDisplay) revPctDisplay.textContent = pct.toFixed(1) + '%';
      if (revRemainingDisplay) {
        revRemainingDisplay.textContent = over
          ? fmt(Math.abs(remaining)) + ' over goal'
          : fmt(remaining) + ' remaining';
        revRemainingDisplay.classList.toggle('rev-over', over);
      }
    } else {
      if (progressBar) progressBar.style.display = 'none';
      if (revGoalDisplay) revGoalDisplay.textContent = 'No goal set';
      if (revPctDisplay) revPctDisplay.textContent = '—';
      if (revRemainingDisplay) revRemainingDisplay.textContent = '—';
    }

    if (revImportedLine) revImportedLine.textContent = `${fmtFull(calc.importedTotal)} from ${calc.importedCount} imported SORDs`;
    if (revAssemblyLine) revAssemblyLine.textContent = `+ ${fmtFull(calc.assemblyBonus)} from ${calc.assemblyCount} assembly-completed SORDs (not double-counted)`;

    if (revImportMeta) {
      revImportMeta.textContent = calc.fileName
        ? `Last import: ${calc.fileName}${calc.importedAt ? ' · ' + new Date(calc.importedAt).toLocaleDateString() : ''}`
        : 'No monthly revenue report imported yet.';
    }

    // Assembly detail list
    if (revAssemblyDetail) {
      if (calc.assemblySords.length === 0) {
        revAssemblyDetail.innerHTML = '<p class="rev-empty">No assembly-completed SORDs to add yet.</p>';
      } else {
        revAssemblyDetail.innerHTML = calc.assemblySords.map(s =>
          `<div class="rev-asm-row">
            <span class="rev-asm-sord">${escHtml(s.sord)}</span>
            <span class="rev-asm-account">${escHtml(s.account || '—')}</span>
            <span class="rev-asm-sub">${fmtFull(s.subtotal)}</span>
          </div>`
        ).join('');
      }
    }

    // Goal input field current value
    const goalInput = document.getElementById('revGoalInput');
    if (goalInput && goalAmt > 0 && goalInput.value === '') {
      goalInput.placeholder = fmt(goalAmt).replace('$', '').replace(/,/g, '');
    }
  }

  function escHtml(v) {
    return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ── Bindings ──────────────────────────────────────────────────────────────
  function bind() {
    // Goal save
    const saveGoalBtn = document.getElementById('revSaveGoalBtn');
    const goalInput = document.getElementById('revGoalInput');
    if (saveGoalBtn && goalInput) {
      saveGoalBtn.addEventListener('click', () => {
        const raw = goalInput.value.replace(/[$,\s]/g, '');
        const n = parseFloat(raw);
        if (isNaN(n) || n < 0) {
          goalInput.classList.add('rev-input-error');
          return;
        }
        goalInput.classList.remove('rev-input-error');
        saveGoal(n);
        goalInput.value = '';
        goalInput.placeholder = fmt(n).replace('$', '').replace(/,/g, '');
        render();
      });
      goalInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') saveGoalBtn.click();
      });
      goalInput.addEventListener('input', () => goalInput.classList.remove('rev-input-error'));
    }

    // File import via import hub
    const hubRevTrackerInput = document.getElementById('importHubRevTrackerFile');
    if (hubRevTrackerInput) {
      // Handled by import-hub.js calling window.importRevTrackerFile
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────
  window.importRevTrackerFile = async function (file, { silent = false } = {}) {
    try {
      await importFile(file);
      render();
      if (!silent) alert(`Monthly revenue report imported successfully.`);
    } catch (err) {
      console.error(err);
      if (!silent) alert(err.message || 'Import failed.');
      throw err;
    }
  };

  window.renderRevTracker = render;

  window.clearRevTrackerSilent = function () {
    saveState(emptyState());
    render();
  };

  // Re-render when assembly data changes (storage event from other tabs)
  window.addEventListener('storage', e => {
    if (e.key === 'ops_hub_assembly_board_v1' || e.key === STORAGE_KEY || e.key === GOAL_KEY) {
      render();
    }
  });

  // Init
  document.addEventListener('DOMContentLoaded', () => {
    bind();
    render();
  });

  // Also render on subsequent calls (e.g. after assembly stage change)
  if (document.readyState !== 'loading') {
    setTimeout(() => { bind(); render(); }, 0);
  }
})();
