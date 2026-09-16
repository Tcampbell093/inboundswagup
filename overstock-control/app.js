(() => {
  const API = '/api/overstock-control';
  const $ = (id) => document.getElementById(id);
  let snapshot = { entries: [], containers: [], categories: [], locations: [], associates: [], updatedAt: null, excelSync: { configured: false } };
  let toastTimer = null;
  let inventorySort = 'recent';
  let containerSort = 'updated';
  let inventoryLimit = 100;
  let searchTimer = null;
  let intake = { activeContainer: null, items: [], touched: new Set(), startedAt: null };

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

  function entryMatches(e, q, container = null) {
    if (!q) return true;
    const c = container || containerById(e.containerId);
    return [e.po,e.deliveryId,e.category,e.status,e.action,e.note,e.associate,e.location,e.containerCode,c?.code,c?.currentLocation].some(v => norm(v).includes(q));
  }

  function containerMatches(c, q, items = []) {
    if (!q) return true;
    return [c.code,c.currentLocation,c.status,c.notes].some(v => norm(v).includes(q)) || items.some(e => entryMatches(e,q,c));
  }

  function renderDate() {
    $('currentDate').textContent = new Intl.DateTimeFormat('en-US', { timeZone:'America/New_York', weekday:'short', month:'short', day:'numeric' }).format(new Date());
  }

  function renderExcelSync() {
    const pill = $('excelSyncPill');
    if (!pill) return;
    const outbound = snapshot.excelSync?.configured === true;
    const inbound = snapshot.excelSync?.importConfigured === true;
    const connected = outbound || inbound;
    pill.textContent = outbound && inbound
      ? 'Excel sync · Two-way ready'
      : inbound
        ? 'Excel → Houston · Ready'
        : outbound
          ? 'Houston → Excel · Ready'
          : 'Excel sync · Setup needed';
    pill.classList.toggle('connected', connected);
    pill.classList.toggle('disconnected', !connected);
    pill.title = outbound && inbound
      ? 'The DailyLog workbook can update Houston locations, and Houston changes can be sent back to Excel.'
      : inbound
        ? 'Use the workbook button to send populated DailyLog Overstock locations to Houston.'
        : outbound
          ? 'Changes from Overstock Control can be sent to the DailyLog workbook.'
          : 'Excel synchronization has not been configured.';
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
    const containersById = new Map(snapshot.containers.map(c => [String(c.id), c]));
    const entries = snapshot.entries.filter(e => entryMatches(e,q,containersById.get(String(e.containerId))));
    const cmp = (a,b) => String(a||'').localeCompare(String(b||''),undefined,{numeric:true,sensitivity:'base'});
    const ts = e => Number(e.updatedAt||e.createdAt||0);
    if(inventorySort==='oldest') entries.sort((a,b)=>ts(a)-ts(b));
    else if(inventorySort==='po') entries.sort((a,b)=>cmp(a.po,b.po));
    else if(inventorySort==='qty-desc') entries.sort((a,b)=>Number(b.quantity||0)-Number(a.quantity||0));
    else if(inventorySort==='qty-asc') entries.sort((a,b)=>Number(a.quantity||0)-Number(b.quantity||0));
    else if(inventorySort==='location') entries.sort((a,b)=>cmp(containersById.get(String(a.containerId))?.currentLocation||a.location,containersById.get(String(b.containerId))?.currentLocation||b.location));
    else if(inventorySort==='associate') entries.sort((a,b)=>cmp(a.associate,b.associate));
    else entries.sort((a,b)=>ts(b)-ts(a));
    const visible = entries.slice(0,inventoryLimit);
    $('inventoryMeta').textContent = `${visible.length} shown · ${entries.length} matching · ${snapshot.entries.length} total${snapshot.updatedAt ? ' · synced '+fmtDate(snapshot.updatedAt) : ''}`;
    $('inventoryList').innerHTML = entries.length ? visible.map(e => {
      const c = containersById.get(String(e.containerId));
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
    const more = $('inventoryMore');
    more.hidden = visible.length >= entries.length;
    if (!more.hidden) more.textContent = `Show more inventory (${(entries.length - visible.length).toLocaleString()} remaining)`;
    document.querySelectorAll('[data-edit-entry]').forEach(b => b.onclick = () => openEditEntry(b.dataset.editEntry));
  }

  function renderContainers() {
    const q = currentQuery();
    const entriesByContainer = new Map();
    snapshot.entries.forEach(e => {
      const id = String(e.containerId);
      if (!entriesByContainer.has(id)) entriesByContainer.set(id,[]);
      entriesByContainer.get(id).push(e);
    });
    const rows = snapshot.containers.filter(c => containerMatches(c,q,entriesByContainer.get(String(c.id))||[]));
    const cmp = (a,b) => String(a||'').localeCompare(String(b||''),undefined,{numeric:true,sensitivity:'base'});
    if(containerSort==='name') rows.sort((a,b)=>cmp(a.code,b.code));
    else if(containerSort==='location') rows.sort((a,b)=>cmp(a.currentLocation,b.currentLocation)||cmp(a.code,b.code));
    else rows.sort((a,b)=>Number(b.updatedAt||b.createdAt||0)-Number(a.updatedAt||a.createdAt||0));
    $('containerGrid').innerHTML = rows.length ? rows.map(c => {
      const items = entriesByContainer.get(String(c.id))||[];
      const units = items.reduce((n,e)=>n+(Number(e.quantity)||0),0);
      return `<article class="container-card">
        <div class="container-card-top"><div><div class="container-code">${esc(c.code||'Unnamed box')}</div><div class="container-location">📍 ${esc(c.currentLocation||'No location')}</div></div><span class="chip ${norm(c.status)==='stored'?'green':''}">${esc(c.status||'Open')}</span></div>
        <div class="container-stats"><div><span>Entries</span><strong>${items.length}</strong></div><div><span>Units</span><strong>${units.toLocaleString()}</strong></div></div>
        ${c.notes ? `<div class="inv-meta" style="margin-bottom:12px">${esc(c.notes)}</div>` : ''}
        <div class="container-actions"><button class="mini" type="button" data-edit-container="${esc(c.id)}">Edit</button><button class="mini" type="button" data-filter-container="${esc(c.code||'')}">Show items</button>${items.length===0?`<button class="mini" type="button" data-delete-container="${esc(c.id)}">Delete</button>`:''}</div>
      </article>`;
    }).join('') : '<div class="empty">No containers match this search.</div>';
    document.querySelectorAll('[data-edit-container]').forEach(b => b.onclick = () => editContainer(b.dataset.editContainer));
    document.querySelectorAll('[data-filter-container]').forEach(b => b.onclick = () => { $('searchInput').value=b.dataset.filterContainer; inventoryLimit=100; setTab('inventory'); });
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

  function renderActiveList() {
    if ($('panel-containers').classList.contains('active')) renderContainers();
    else if ($('panel-inventory').classList.contains('active')) renderInventory();
  }
  function renderAll() { renderExcelSync(); renderStats(); refreshSelects(); renderActiveList(); }

  function setTab(tab) {
    document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
    document.querySelectorAll('.panel').forEach(p=>p.classList.toggle('active',p.id===`panel-${tab}`));
    renderActiveList();
  }

  function intakeStats() {
    $('siItemsCount').textContent=String(intake.items.length);
    $('siContainersCount').textContent=String(intake.touched.size);
    $('siStartedAt').textContent=intake.startedAt?new Date(intake.startedAt).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}):'—';
    $('siRecentList').innerHTML=intake.items.length?intake.items.slice().reverse().map(item=>`<div class="si-recent-item"><span><strong>PO ${esc(item.po)}</strong> · ${Number(item.quantity).toLocaleString()} · ${esc(item.category||'Uncategorized')} · ${esc(item.containerCode)}</span><button type="button" data-si-delete="${esc(item.id)}" aria-label="Remove PO ${esc(item.po)}">×</button></div>`).join(''):'<div class="inv-meta">No items added yet.</div>';
    document.querySelectorAll('[data-si-delete]').forEach(b=>b.onclick=()=>deleteIntakeItem(b.dataset.siDelete));
  }

  function fillIntakeLocations() {
    const values=[...new Set([...snapshot.locations,...snapshot.containers.map(c=>c.currentLocation)].filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),undefined,{numeric:true}));
    $('siContainerLocation').innerHTML='<option value="">— Select location —</option>'+values.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');
  }

  function inspectIntakeContainer() {
    const code=String($('siContainerCode').value||'').trim().toUpperCase();
    const existing=snapshot.containers.find(c=>String(c.code||'').toUpperCase()===code);
    $('siExistingContainer').hidden=!existing;
    if(existing){$('siExistingContainer').textContent=`Existing container · ${existing.currentLocation||'No location'} · ${entriesForContainer(existing.id).length} item(s)`;if(existing.currentLocation)$('siContainerLocation').value=existing.currentLocation;}
  }

  function openStockIntake() {
    intake={activeContainer:null,items:[],touched:new Set(),startedAt:Date.now()};
    fillIntakeLocations();intakeStats();
    $('siContainerStep').hidden=false;$('siItemStep').hidden=true;$('stockIntakeOverlay').hidden=false;
    document.body.style.overflow='hidden';setTimeout(()=>$('siAssociate').focus(),40);
  }

  function closeStockIntake() {$('stockIntakeOverlay').hidden=true;document.body.style.overflow='';renderAll();}

  async function deleteIntakeItem(id) {
    const item=intake.items.find(x=>String(x.id)===String(id));if(!item||!confirm(`Remove PO ${item.po} from this intake?`))return;
    try{const j=await request({action:'deleteEntry',id});snapshot={...snapshot,...j};intake.items=intake.items.filter(x=>String(x.id)!==String(id));intakeStats();toast('Item removed.');}catch(e){toast(e.message,true);}
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

  function clearEntryForm(preserveContext=false) {
    const f=$('entryForm');
    const context=preserveContext?{associate:f.elements.associate.value,containerId:f.elements.containerId.value,status:f.elements.status.value,action:f.elements.action.value}:null;
    f.reset(); f.elements.id.value=''; f.elements.quantity.value='1'; f.elements.status.value='Not Donation'; f.elements.action.value='Required';
    if(context){f.elements.associate.value=context.associate;f.elements.containerId.value=context.containerId;f.elements.status.value=context.status||'Not Donation';f.elements.action.value=context.action||'Required';}
    $('entrySaveBtn').textContent='Add item and continue';
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
    f.elements.id.value=e.id||'';f.elements.po.value=e.po||'';f.elements.deliveryId.value=e.deliveryId||'';f.elements.containerId.value=e.containerId||'';f.elements.quantity.value=Number(e.quantity||0);f.elements.category.value=e.category||'';f.elements.status.value=e.status||'';f.elements.action.value=e.action||'';f.elements.associate.value=e.associate||'';f.elements.note.value=e.note||'';
    $('editDialog').showModal();
  }

  $('entryForm').addEventListener('submit',async e=>{
    e.preventDefault(); const f=e.currentTarget; const d=formObject(f); const c=containerById(d.containerId); if(!c)return toast('Choose a container.',true);
    const entry={id:d.id||undefined,po:d.po,deliveryId:d.deliveryId,quantity:Number(d.quantity||0),category:d.category,status:d.status,action:d.action,note:d.note,associate:d.associate,containerId:d.containerId,containerCode:c.code,location:c.currentLocation,date:new Date().toISOString().slice(0,10),sourceType:'overstock-standalone'};
    try{const j=await request({action:'upsertEntry',entry});snapshot={...snapshot,...j};clearEntryForm(true);renderAll();setTimeout(()=>$('entryForm').elements.po.focus(),25);toast(completedMessage(d.id?'Item updated.':'Item added. Ready for the next PO.',j),j.excelWrite?.configured && !j.excelWrite?.ok);}catch(err){toast(err.message,true);}
  });

  $('containerForm').addEventListener('submit',async e=>{
    e.preventDefault();const f=e.currentTarget;const d=formObject(f);const container={id:d.id||undefined,code:d.code,currentLocation:d.currentLocation,status:d.status,notes:d.notes};
    try{const j=await request({action:'upsertContainer',container});snapshot={...snapshot,...j};const selected=snapshot.containers.find(c=>String(c.code||'').toUpperCase()===String(container.code||'').toUpperCase())||snapshot.containers.slice().sort((a,b)=>Number(b.updatedAt||0)-Number(a.updatedAt||0))[0];clearContainerForm();renderAll();if(selected)$('entryForm').elements.containerId.value=selected.id;setTimeout(()=>$('entryForm').elements.po.focus(),25);toast(completedMessage(d.id?'Container updated and selected.':'Container created and selected. Add the first PO.',j),j.excelWrite?.configured && !j.excelWrite?.ok);}catch(err){toast(err.message,true);}
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
  $('searchInput').addEventListener('input',()=>{inventoryLimit=100;clearTimeout(searchTimer);searchTimer=setTimeout(renderActiveList,120);});
  $('inventorySort').addEventListener('change',e=>{inventorySort=e.target.value;inventoryLimit=100;renderInventory();});
  $('containerSort').addEventListener('change',e=>{containerSort=e.target.value;renderContainers();});
  $('inventoryMore').onclick=()=>{inventoryLimit+=100;renderInventory();};
  $('refreshBtn').onclick=()=>load(true);
  $('entryClearBtn').onclick=clearEntryForm;
  $('containerClearBtn').onclick=clearContainerForm;
  $('newContainerBtn').onclick=()=>{clearContainerForm();setTab('add');setTimeout(()=>$('containerForm').elements.code.focus(),50);};
  $('stockIntakeBtn').onclick=openStockIntake;
  $('stockIntakeCancel').onclick=()=>{if(!intake.items.length||confirm('Cancel this Stock Intake session? Saved items will remain in Houston.'))closeStockIntake();};
  $('stockIntakeComplete').onclick=()=>{toast(`Stock Intake complete · ${intake.items.length} item(s) added.`);closeStockIntake();};
  $('siSwitchContainer').onclick=()=>{intake.activeContainer=null;$('siItemStep').hidden=true;$('siContainerStep').hidden=false;$('siContainerCode').value='';$('siExistingContainer').hidden=true;setTimeout(()=>$('siContainerCode').focus(),30);};
  $('siContainerCode').addEventListener('input',inspectIntakeContainer);
  $('siContainerCode').addEventListener('blur',inspectIntakeContainer);

  $('siContainerForm').addEventListener('submit',async e=>{
    e.preventDefault();
    const associate=String($('siAssociate').value||'').trim();
    const code=String($('siContainerCode').value||'').trim().toUpperCase();
    const location=String($('siContainerLocation').value||'').trim();
    if(!associate)return toast('Choose or enter the associate.',true);
    let container=snapshot.containers.find(c=>String(c.code||'').toUpperCase()===code);
    try{
      if(!container){
        if(!location)return toast('Choose a location for the new container.',true);
        const j=await request({action:'upsertContainer',container:{code,currentLocation:location,status:'Open',notes:'Created through Stock Intake'}});
        snapshot={...snapshot,...j};
        container=snapshot.containers.find(c=>String(c.code||'').toUpperCase()===code)||snapshot.containers.slice().sort((a,b)=>Number(b.updatedAt||0)-Number(a.updatedAt||0))[0];
      }
      if(!container)throw new Error('Container could not be opened.');
      intake.activeContainer=container;intake.touched.add(String(container.id));intakeStats();
      $('siActiveContainer').textContent=`${container.code} · ${container.currentLocation||'No location'} · Logged by ${associate}`;
      $('siContainerStep').hidden=true;$('siItemStep').hidden=false;setTimeout(()=>$('siPo').focus(),30);
    }catch(err){toast(err.message||'Could not open container.',true);}
  });

  $('siItemForm').addEventListener('submit',async e=>{
    e.preventDefault();
    const container=intake.activeContainer;if(!container)return toast('Open a container first.',true);
    const po=String($('siPo').value||'').trim();const quantity=Number($('siQty').value||0);
    if(!po||quantity<1)return toast('Enter a PO and quantity.',true);
    const entry={po,deliveryId:String($('siDeliveryId').value||'').trim(),quantity,category:String($('siCategory').value||'').trim(),status:$('siStatus').value,action:$('siAction').value,note:String($('siNote').value||'').trim(),associate:String($('siAssociate').value||'').trim(),containerId:container.id,containerCode:container.code,location:container.currentLocation,date:new Date().toISOString().slice(0,10),sourceType:'stock-intake'};
    try{
      const j=await request({action:'upsertEntry',entry});snapshot={...snapshot,...j};
      const saved=snapshot.entries.slice().sort((a,b)=>Number(b.updatedAt||0)-Number(a.updatedAt||0)).find(x=>String(x.po)===po&&String(x.containerId)===String(container.id));
      intake.items.push(saved||entry);intakeStats();
      $('siPo').value='';$('siDeliveryId').value='';$('siQty').value='';$('siCategory').value='';$('siNote').value='';setTimeout(()=>$('siPo').focus(),20);
      toast(`PO ${po} added to ${container.code}.`);
    }catch(err){toast(err.message||'Could not add item.',true);}
  });

  renderDate();
  setInterval(renderDate,60*1000);
  load(false);
  setInterval(()=>{ if(!document.hidden && !$('editDialog').open && $('stockIntakeOverlay').hidden && !document.activeElement?.matches('input,textarea,select')) load(false); },60000);
})();
