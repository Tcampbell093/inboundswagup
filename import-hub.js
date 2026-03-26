
(function(){
  const els = {
    page: document.getElementById('importHubPage'),
    queue: document.getElementById('importHubQueueFile'),
    revenue: document.getElementById('importHubRevenueFile'),
    eom: document.getElementById('importHubEomFile'),
    run: document.getElementById('importHubRunBtn'),
    clear: document.getElementById('importHubClearBtn'),
    status: document.getElementById('importHubStatus')
  };
  if(!els.page) return;

  function text(v){ return String(v || '').trim(); }
  function setStatus(message, isError){
    if(!els.status) return;
    els.status.textContent = message;
    els.status.classList.toggle('error', !!isError);
  }
  function summarizeSavedImports(){
    const parts = [];
    const queueStorage = (typeof loadJson === 'function') ? loadJson('ops_hub_sord_imports_v1', null) : null;
    const revRows = (typeof loadJson === 'function') ? loadJson('ops_hub_revenue_reference_v1', []) : [];
    if(queueStorage?.fileNames?.queue) parts.push(`Queue: ${queueStorage.fileNames.queue}`);
    if(queueStorage?.fileNames?.revenue) parts.push(`Revenue: ${queueStorage.fileNames.revenue}`);
    if(queueStorage?.fileNames?.eom) parts.push(`SORD / PO: ${queueStorage.fileNames.eom}`);
    if(!parts.length && Array.isArray(revRows) && revRows.length) parts.push(`<a class="import-report-link" href="https://swagup.lightning.force.com/lightning/r/Report/00OQm000003BE2jMAG/view?queryScope=userFolders" target="_blank" rel="noopener noreferrer">Revenue report</a> rows: ${revRows.length}`);
    return parts.length ? parts.join(' • ') : 'No shared imports have been loaded yet.';
  }
  async function runImport(){
    const queueFile = els.queue.files?.[0] || null;
    const revenueFile = els.revenue.files?.[0] || null;
    const eomFile = els.eom.files?.[0] || null;
    if(!queueFile && !revenueFile && !eomFile){
      setStatus('Choose at least one file to import.', true);
      return;
    }
    if(typeof window.importQueueReportFromFile !== 'function' || typeof window.importRevenueReferenceFromFile !== 'function' || typeof window.importSordSharedFiles !== 'function'){
      setStatus('Import helpers are not available yet. Refresh the page and try again.', true);
      return;
    }
    try{
      setStatus('Importing selected files...');
      if(queueFile){
        await window.importQueueReportFromFile(queueFile, { silent: true });
      }
      if(revenueFile){
        await window.importRevenueReferenceFromFile(revenueFile, { silent: true });
      }
      await window.importSordSharedFiles({ queueFile, revenueFile, eomFile }, { silent: true });
      setStatus(`Shared imports updated. ${summarizeSavedImports()}`);
      els.queue.value = '';
      els.revenue.value = '';
      els.eom.value = '';
    } catch(error){
      console.error(error);
      setStatus(error?.message || 'Import failed.', true);
    }
  }
  function clearImports(){
    const confirmed = confirm('Clear the shared Queue, Revenue, and Daily Tools imports?');
    if(!confirmed) return;
    try{
      if(typeof clearQueue === 'function') clearQueue();
      if(typeof clearRevenueReference === 'function') clearRevenueReference();
      if(typeof window.clearSordSharedImports === 'function') window.clearSordSharedImports({ silent: true });
      els.queue.value = '';
      els.revenue.value = '';
      els.eom.value = '';
      setStatus('Shared imports cleared.');
    } catch(error){
      console.error(error);
      setStatus(error?.message || 'Clear failed.', true);
    }
  }
  function bindPageJumps(){
    document.querySelectorAll('[data-page-jump]').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.getAttribute('data-page-jump');
        document.querySelector(`.nav-btn[data-page="${target}"]`)?.click();
      });
    });
  }
  els.run?.addEventListener('click', runImport);
  els.clear?.addEventListener('click', clearImports);
  bindPageJumps();
  setStatus(summarizeSavedImports(), false);
})();
