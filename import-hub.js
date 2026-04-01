
(function(){
  const els = {
    page:       document.getElementById('importHubPage'),
    queue:      document.getElementById('importHubQueueFile'),
    revenue:    document.getElementById('importHubRevenueFile'),
    eom:        document.getElementById('importHubEomFile'),
    revTracker: document.getElementById('importHubRevTrackerFile'),
    run:        document.getElementById('importHubRunBtn'),
    clear:      document.getElementById('importHubClearBtn'),
    status:     document.getElementById('importHubStatus')
  };
  if(!els.page) return;

  // ── Helpers ────────────────────────────────────────────────────────────────
  function setStatus(message, isError){
    if(!els.status) return;
    els.status.innerHTML = message;
    els.status.classList.toggle('error', !!isError);
  }

  function fmtTs(iso){
    if(!iso) return '';
    try {
      const d = new Date(iso);
      return d.toLocaleDateString('en-US',{month:'short',day:'numeric'}) + ' at ' +
             d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
    } catch { return ''; }
  }

  function loadMeta(key){ try{ return JSON.parse(localStorage.getItem(key)||'null'); }catch{ return null; } }

  // ── Build status panel from stored metadata ────────────────────────────────
  function renderImportStatus(){
    if(!els.status) return;

    // Gather metadata from each import channel
    const sordMeta  = loadMeta('ops_hub_sord_imports_v1');
    const queueMeta = loadMeta('ops_hub_queue_import_meta_v1');
    const revMeta   = loadMeta('ops_hub_revenue_import_meta_v1');
    const rtMeta    = loadMeta('ops_hub_rev_tracker_v1');

    const qFileName  = sordMeta?.fileNames?.queue   || queueMeta?.fileName  || '';
    const rFileName  = sordMeta?.fileNames?.revenue || revMeta?.fileName    || '';
    const eFileName  = sordMeta?.fileNames?.eom     || '';
    const rtFileName = rtMeta?.fileName || '';

    const qTs  = queueMeta?.importedAt || sordMeta?.importedAt || '';
    const rTs  = revMeta?.importedAt   || sordMeta?.importedAt || '';
    const eTs  = sordMeta?.importedAt  || '';
    const rtTs = rtMeta?.importedAt    || '';

    const rows = [
      { label: 'Queue / Assembly',    file: qFileName,  ts: qTs  },
      { label: 'Revenue Reference',   file: rFileName,  ts: rTs  },
      { label: 'SORD / PO Detail',    file: eFileName,  ts: eTs  },
      { label: 'Monthly Rev Estimate',file: rtFileName, ts: rtTs },
    ];

    const hasAny = rows.some(r => r.file);
    if(!hasAny){
      els.status.innerHTML = 'No imports loaded yet — choose files above and click Import.';
      els.status.classList.remove('error');
      return;
    }

    const html = rows.map(r => {
      if(!r.file) return '';
      const ts = r.ts ? `<span class="import-status-ts">${fmtTs(r.ts)}</span>` : '';
      return `<div class="import-status-row">
        <span class="import-status-label">${r.label}:</span>
        <span class="import-status-file">${escHtml(r.file)}</span>
        ${ts}
      </div>`;
    }).filter(Boolean).join('');

    els.status.innerHTML = html || 'No imports loaded yet.';
    els.status.classList.remove('error');
  }

  function escHtml(v){ return String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  // ── Run imports ────────────────────────────────────────────────────────────
  async function runImport(){
    const queueFile      = els.queue?.files?.[0]      || null;
    const revenueFile    = els.revenue?.files?.[0]    || null;
    const eomFile        = els.eom?.files?.[0]        || null;
    const revTrackerFile = els.revTracker?.files?.[0] || null;

    if(!queueFile && !revenueFile && !eomFile && !revTrackerFile){
      setStatus('Choose at least one file to import.', true);
      return;
    }

    setStatus('Importing…');
    const errors = [];

    // Queue / Assembly
    if(queueFile){
      if(typeof window.importQueueReportFromFile === 'function'){
        try { await window.importQueueReportFromFile(queueFile, { silent: true }); }
        catch(e){ errors.push(`Queue: ${e?.message || 'failed'}`); }
      } else {
        errors.push('Queue helper not ready — reload the page and try again.');
      }
    }

    // Revenue reference
    if(revenueFile){
      if(typeof window.importRevenueReferenceFromFile === 'function'){
        try { await window.importRevenueReferenceFromFile(revenueFile, { silent: true }); }
        catch(e){ errors.push(`Revenue: ${e?.message || 'failed'}`); }
      } else {
        errors.push('Revenue helper not ready — reload the page and try again.');
      }
    }

    // SORD / PO detail  (also sends queue + revenue files so the dossier cross-references them)
    if(typeof window.importSordSharedFiles === 'function'){
      try {
        await window.importSordSharedFiles({ queueFile, revenueFile, eomFile }, { silent: true });
      } catch(e){ errors.push(`SORD dossier: ${e?.message || 'failed'}`); }
    } else {
      if(queueFile || revenueFile || eomFile){
        errors.push('SORD helper not ready — reload the page and try again.');
      }
    }

    // Monthly revenue estimate
    if(revTrackerFile){
      if(typeof window.importRevTrackerFile === 'function'){
        try { await window.importRevTrackerFile(revTrackerFile, { silent: true }); }
        catch(e){ errors.push(`Rev Tracker: ${e?.message || 'failed'}`); }
      } else {
        errors.push('Revenue Tracker helper not ready — reload the page and try again.');
      }
    }

    // Clear inputs
    if(els.queue)      els.queue.value      = '';
    if(els.revenue)    els.revenue.value    = '';
    if(els.eom)        els.eom.value        = '';
    if(els.revTracker) els.revTracker.value = '';

    if(errors.length){
      setStatus('⚠️ Some imports had issues:<br>' + errors.map(e=>`<div style="margin-top:4px">• ${escHtml(e)}</div>`).join(''), true);
    } else {
      renderImportStatus();
    }
  }

  // ── Clear ──────────────────────────────────────────────────────────────────
  function clearImports(){
    if(!confirm('Clear all shared imports (Queue, Revenue, SORD, Monthly Revenue)?')) return;
    try{
      if(typeof window.clearQueueSilent === 'function') window.clearQueueSilent();
      if(typeof window.clearRevenueReferenceSilent === 'function') window.clearRevenueReferenceSilent();
      if(typeof window.clearSordSharedImports === 'function') window.clearSordSharedImports({ silent: true });
      if(typeof window.clearRevTrackerSilent === 'function') window.clearRevTrackerSilent();
      // Clear stored metadata
      ['ops_hub_queue_import_meta_v1','ops_hub_revenue_import_meta_v1'].forEach(k=>{
        try{ localStorage.removeItem(k); }catch(_){}
      });
      if(els.queue)      els.queue.value      = '';
      if(els.revenue)    els.revenue.value    = '';
      if(els.eom)        els.eom.value        = '';
      if(els.revTracker) els.revTracker.value = '';
      setStatus('All imports cleared.');
    } catch(e){
      setStatus(e?.message || 'Clear failed.', true);
    }
  }

  // ── Page jump buttons ──────────────────────────────────────────────────────
  function bindPageJumps(){
    document.querySelectorAll('[data-page-jump]').forEach(btn => {
      btn.addEventListener('click', () => {
        const t = btn.getAttribute('data-page-jump');
        document.querySelector(`.nav-btn[data-page="${t}"]`)?.click();
      });
    });
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  els.run?.addEventListener('click', runImport);
  els.clear?.addEventListener('click', clearImports);
  bindPageJumps();
  renderImportStatus();
})();
