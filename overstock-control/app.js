(() => {
  const API = '/api/overstock-control';
  const $ = (id) => document.getElementById(id);
  let snapshot = { entries: [], containers: [], categories: [], locations: [], associates: [], updatedAt: null, excelSync: { configured: false } };
  let toastTimer = null;

  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const norm = (v) => String(v ?? '').trim().toLowerCase();
  const fmtDate = (v) => { try { return v ? new Date(v).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}) : '—'; } catch { return '—'; } };

  function toast(message, error = false) {
    const el = $('toast');
    el.textContent = message;
    el.classList.toggle('error', error);
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
  }

  function formObject(form) {
    return Object.fromEntries(new FormData(form).entries());
  }

  function options(values, current = '') {
    const uniq = [...new Set((values || []).filter(Boolean).map(String))];
    if (current && !uniq.includes(current)) uniq.unshift(current);
    return uniq.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
  }

  function containerById(id) { return snapshot.containers.find(c => String(c.id) === String(id)); }
  function entriesForContainer(id) { return snapshot.entries.filter(e => String(e.containerId) === String(id)); }
  function currentQuery() { return norm($('searchInput').value); }

  function entryMatches(e, q) {
    if (!q) return true;
    const c = containerById(e.containerId);
    return [e.po,e.deliveryId,e.category,e.status,e.action,e.note,e.associate,e.location,e.containerCode,c?.code,c?.currentLocation].some(v => norm(v).includes(q));
  }

  function containerMatches(c, q) {
    if (!q) return true;
    return [c.code,c.currentLocation,c.status,c.notes].some(v => norm(v).includes(q)) || entriesForContainer(c.id).some(e => entryMatches(e,q));
  }

  function renderDate() {
    $('currentDate').textContent = new Intl.DateTimeFormat('en-US', { timeZone:'America/New_York', weekday:'short', month:'short', day:'numeric' }).format(new Date());
  }

  function renderExcelSync() {
    const pill = $('excelSyncPill');
    if (!pill) return;
    const connected = snapshot.excelSync?.configured === true;
    pill.textContent = connected ? 'Excel write-back · Connected' : 'Excel write-back · Setup needed';
    pill.classList.toggle('connected', connected);
    pill.classList.toggle('disconnected', !connected);
    pill.title = connected
      ? 'Changes from Overstock Control can be sent to the DailyLog table in New Daily Rec..xlsx.'
      : 'The Overstock side is ready. Connect the Power Automate webhook to enable automatic Excel updates.';
  }

  function renderStats() {
    const removed = new Set(['missing from box','lost','replaced']);
    const activeEntries = snapshot.entries.filter(e => !removed.has(norm(e.action)));
    $('statUnits').textContent = activeEntries.reduce((n,e) => n + (Number(e.quantity)||0), 0).toLocaleString();
    $('statEntries').textContent = snapshot.entries.length.toLocaleString();
    $('statOpen').textContent = snapshot.containers.filter(c => norm(c.status) !== 'closed').length.toLocaleString();
    $('statLocations').textContent = new Set(snapshot.containers.map(c => String(c.currentLocation||'').trim()).filter(Boolean)).size.toLocaleString();
  }

  function renderInventory() {
    const q = currentQuery();
    const entries = snapshot.entries.filter(e => entryMatches(e,q)).sort((a,b) => Number(b.updatedAt||b.createdAt||0)-Number(a.updatedAt||a.createdAt||0));
    $('inventoryMeta').textContent = `${entries.length} shown · ${snapshot.entries.length} total${snapshot.updatedAt ? ' · synced '+fmtDate(snapshot.updatedAt) : ''}`;
    $('inventoryList').innerHTML = entries.length ? entries.map(e => {
      const c = containerById(e.containerId);
      const location = c?.currentLocation || e.location || 'No location';
      const code = c?.code || e.containerCode || 'No box';
      const delivery = e.deliveryId ? ` · ${esc(e.deliveryId)}` : '';
      return `<article class="inventory-row">
        <div><div class="inv-po">PO ${esc(e.po || '—')}</div><div class="inv-meta">${esc(e.associate || 'Unknown associate')}${delivery} · ${fmtDate(Number(e.updatedAt||e.createdAt||0))}</div></div>
        <div><span class="chip blue">${esc(code)}</span><div class="inv-meta">${esc(location)}</div></div>
        <div><strong>${Number(e.quantity||0).toLocaleString()}</strong><div class="inv-meta">units</div></div>
        <div><span class="chip">${esc(e.category || 'Uncategorized')}</span></div>
        <div><span class="chip green">${esc(e.status || '—')}</span><div class="inv-meta">${esc(e.action || '')}</div>${e.note ? `<div class="inv-meta">${esc(e.note)}</div>` : ''}</div>
        <div class="row-actions"><button class="mini" type="button" data-edit-entry="${esc(e.id)}">Edit</button></div>
      </article>`;
    }).join('') : '<div class="empty">No Overstock entries match this search.</div>';
    document.querySelectorAll('[data-edit-entry]').forEach(b => b.onclick = () => openEditEntry(b.dataset.editEntry));
  }

  function renderContainers() {
    const q = currentQuery();
    const rows = snapshot.containers.filter(c => containerMatches(c,q)).sort((a,b) => String(a.code||'').localeCompare(String(b.code||''), undefined, {numeric:true}));
    $('containerGrid').innerHTML = rows.length ? rows.map(c => {
      const items = entriesForContainer(c.id);
      const units = items.reduce((n,e)=>n+(Number(e.quantity)||0),0);
      return `<article class="container-card">
        <div class="container-card-top"><div><div class="container-code">${esc(c.code||'Unnamed box')}</div><div class="container-location">📍 ${esc(c.currentLocation||'No location')}</div></div><span class="chip ${norm(c.status)==='stored'?'green':''}">${esc(c.status||'Open')}</span></div>
        <div class="container-stats"><div><span>Entries</span><strong>${items.length}</strong></div><div><span>Units</span><strong>${units.toLocaleString()}</strong></div></div>
        ${c.notes ? `<div class="inv-meta" style="margin-bottom:12px">${esc(c.notes)}</div>` : ''}
        <div class="container-actions"><button class="mini" type="button" data-edit-container="${esc(c.id)}">Edit</button><button class="mini" type="button" data-filter-container="${esc(c.code||'')}">Show items</button>${items.length===0?`<button class="mini" type="button" data-delete-container="${esc(c.id)}">Delete</button>`:''}</div>
      </article>`;
    }).join('') : '<div class="empty">No containers match this search.</div>';
    document.querySelectorAll('[data-edit-container]').forEach(b => b.onclick = () => editContainer(b.dataset.editContainer));
    document.querySelectorAll('[data-filter-container]').forEach(b => b.onclick = () => { $('searchInput').value=b.dataset.filterContainer; setTab('inventory'); renderAll(); });
    document.querySelectorAll('[data-delete-container]').forEach(b => b.onclick = () => deleteContainer(b.dataset.deleteContainer));
  }

  function refreshSelects() {
    const containerOpts = snapshot.containers
      .slice().sort((a,b)=>String(a.code||'').localeCompare(String(b.code||''),undefined,{numeric:true}))
      .map(c => `<option value="${esc(c.id)}">${esc(c.code||'Unnamed')} · ${esc(c.currentLocation||'No location')}</option>`).join('');
    document.querySelectorAll('select[name=containerId]').forEach(sel => {
      const current=sel.value;
      sel.innerHTML = `<option value="">— select container —</option>${containerOpts}`;
      if (current) sel.value=current;
    });
    $('associateList').innerHTML = options(snapshot.associates);
    $('categoryList').innerHTML = options([...snapshot.categories, ...snapshot.entries.map(e=>e.category)]);
    $('locationList').innerHTML = options([...snapshot.locations, ...snapshot.containers.map(c=>c.currentLocation)]);
    $('statusList').innerHTML = options(snapshot.entries.map(e=>e.status));
    $('actionList').innerHTML = options(snapshot.entries.map(e=>e.action));
  }

  function renderAll() { renderExcelSync(); renderStats(); refreshSelects(); renderInventory(); renderContainers(); }

  function setTab(tab) {
    document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
    document.querySelectorAll('.panel').forEach(p=>p.classList.toggle('active',p.id===`panel-${tab}`));
  }

  async function request(body=null) {
    const opts={headers:{'Accept':'application/json'}};
    if(body){opts.method='POST';opts.headers['Content-Type']='application/json';opts.body=JSON.stringify(body);}
    const r=await fetch(API,opts);
    const j=await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(j.error||`Request failed (${r.status})`);
    return j;
  }

  function completedMessage(base, result) {
    if (!result?.excelWrite?.configured) return base;
    if (result.excelWrite.ok) return `${base} Excel sync sent.`;
    return `${base} Saved in Overstock, but Excel sync failed.`;
  }

  async function load(showNotice=false) {
    $('refreshBtn').disabled=true;
    try {
      const j=await request();
      snapshot={...snapshot,...j};
      renderAll();
      if(showNotice) toast('Overstock refreshed.');
    } catch(e){ toast(e.message||'Could not load Overstock.',true); }
    finally{$('refreshBtn').disabled=false;}
  }

  function clearEntryForm() {
    const f=$('entryForm'); f.reset(); f.elements.id.value=''; f.elements.quantity.value='1'; f.elements.status.value='Not Donation'; f.elements.action.value='Required'; $('entrySaveBtn').textContent='Add item';
  }

  function clearContainerForm() {
    const f=$('containerForm'); f.reset(); f.elements.id.value=''; f.elements.status.value='Open'; $('containerSaveBtn').textContent='Create container';
  }

  function editContainer(id) {
    const c=containerById(id); if(!c)return;
    const f=$('containerForm');
    f.elements.id.value=c.id||''; f.elements.code.value=c.code||''; f.elements.currentLocation.value=c.currentLocation||''; f.elements.status.value=c.status||'Open'; f.elements.notes.value=c.notes||'';
    $('containerSaveBtn').textContent='Save container'; setTab('add'); window.scrollTo({top:document.querySelector('#panel-add').offsetTop-90,behavior:'smooth'});
  }

  async function deleteContainer(id) {
    const c=containerById(id); if(!c)return;
    if(!confirm(`Delete ${c.code||'this container'}?`))return;
    try{const j=await request({action:'deleteContainer',id});snapshot={...snapshot,...j};renderAll();toast(completedMessage('Container deleted.',j));}catch(e){toast(e.message,true);}
  }

  function openEditEntry(id) {
    const e=snapshot.entries.find(x=>String(x.id)===String(id)); if(!e)return;
    const f=$('editForm');
    refreshSelects();
    f.elements.id.value=e.id||'';f.elements.po.value=e.po||'';f.elements.deliveryId.value=e.deliveryId||'';f.elements.containerId.value=e.containerId||'';f.elements.quantity.value=Number(e.quantity||0);f.elements.category.value=e.category||'';f.elements.status.value=e.status||'';f.elements.action.value=e.action||'';f.elements.associate.value=e.associate||'';f.elements.note.value=e.note||'';
    $('editDialog').showModal();
  }

  $('entryForm').addEventListener('submit',async e=>{
    e.preventDefault(); const f=e.currentTarget; const d=formObject(f); const c=containerById(d.containerId); if(!c)return toast('Choose a container.',true);
    const entry={id:d.id||undefined,po:d.po,deliveryId:d.deliveryId,quantity:Number(d.quantity||0),category:d.category,status:d.status,action:d.action,note:d.note,associate:d.associate,containerId:d.containerId,containerCode:c.code,location:c.currentLocation,date:new Date().toISOString().slice(0,10),sourceType:'overstock-standalone'};
    try{const j=await request({action:'upsertEntry',entry});snapshot={...snapshot,...j};clearEntryForm();renderAll();toast(completedMessage(d.id?'Item updated.':'Item added to Overstock.',j),j.excelWrite?.configured && !j.excelWrite?.ok);}catch(err){toast(err.message,true);}
  });

  $('containerForm').addEventListener('submit',async e=>{
    e.preventDefault();const f=e.currentTarget;const d=formObject(f);const container={id:d.id||undefined,code:d.code,currentLocation:d.currentLocation,status:d.status,notes:d.notes};
    try{const j=await request({action:'upsertContainer',container});snapshot={...snapshot,...j};clearContainerForm();renderAll();toast(completedMessage(d.id?'Container updated.':'Container created.',j),j.excelWrite?.configured && !j.excelWrite?.ok);}catch(err){toast(err.message,true);}
  });

  $('editForm').addEventListener('submit',async e=>{
    e.preventDefault();const d=formObject(e.currentTarget);const old=snapshot.entries.find(x=>String(x.id)===String(d.id));const c=containerById(d.containerId);if(!old||!c)return;
    const entry={...old,id:d.id,po:d.po,deliveryId:d.deliveryId,containerId:d.containerId,containerCode:c.code,location:c.currentLocation,quantity:Number(d.quantity||0),category:d.category,status:d.status,action:d.action,note:d.note,associate:d.associate};
    try{const j=await request({action:'upsertEntry',entry});snapshot={...snapshot,...j};$('editDialog').close();renderAll();toast(completedMessage('Item updated.',j),j.excelWrite?.configured && !j.excelWrite?.ok);}catch(err){toast(err.message,true);}
  });

  $('deleteEntryBtn').addEventListener('click',async()=>{
    const id=$('editForm').elements.id.value;const e=snapshot.entries.find(x=>String(x.id)===String(id));if(!e||!confirm(`Delete PO ${e.po}?`))return;
    try{const j=await request({action:'deleteEntry',id});snapshot={...snapshot,...j};$('editDialog').close();renderAll();toast(completedMessage('Item deleted.',j),j.excelWrite?.configured && !j.excelWrite?.ok);}catch(err){toast(err.message,true);}
  });

  document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close)?.close());
  document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>setTab(b.dataset.tab));
  $('searchInput').addEventListener('input',()=>{renderInventory();renderContainers();});
  $('refreshBtn').onclick=()=>load(true);
  $('entryClearBtn').onclick=clearEntryForm;
  $('containerClearBtn').onclick=clearContainerForm;
  $('newContainerBtn').onclick=()=>{clearContainerForm();setTab('add');setTimeout(()=>$('containerForm').elements.code.focus(),50);};

  renderDate();
  setInterval(renderDate,60*1000);
  load(false);
  setInterval(()=>{ if(!document.hidden && !$('editDialog').open) load(false); },30000);
})();
