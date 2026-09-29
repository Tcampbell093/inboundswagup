(() => {
  const API='/api/overstock-control',HUB_SESSION_API='/.netlify/functions/hub-auth?action=session',$=id=>document.getElementById(id);
  let data={entries:[],containers:[],donations:[],activities:[],locations:[],categories:[],associates:[],excelSync:{}},hubSession={signedIn:false,name:''},logLimit=50,toastTimer,boxView='active',entryReturnBoxId='',lastActivityId='';
  let intake={container:null,items:[],touched:new Set(),started:null};
  const activityStyle=document.createElement('style');
  activityStyle.textContent='.activity-feed{position:fixed;left:22px;bottom:22px;width:min(390px,calc(100vw - 44px));z-index:40;background:transparent;color:#fff;pointer-events:none;filter:drop-shadow(0 2px 4px rgba(0,0,0,.68))}.activity-feed[hidden],.activity-feed-show[hidden]{display:none!important}.activity-feed-head{display:flex;align-items:center;gap:10px;margin:0 0 5px 2px;font-size:10px;font-weight:950;letter-spacing:.13em;text-transform:uppercase;color:rgba(255,255,255,.78);pointer-events:auto}.activity-feed-head button{margin-left:auto;border:0;border-radius:999px;padding:3px 8px;background:rgba(15,24,21,.35);color:rgba(255,255,255,.72);font:inherit;cursor:pointer}.activity-feed-list{display:grid;gap:2px}.activity-item{display:grid;grid-template-columns:20px 1fr;gap:7px;align-items:start;width:100%;padding:3px 2px;border:0;background:transparent;color:#fff;text-align:left;cursor:pointer;pointer-events:auto;font:inherit;line-height:1.22;text-shadow:0 1px 3px rgba(0,0,0,.95),0 0 8px rgba(0,0,0,.45);transition:opacity .2s ease,transform .2s ease}.activity-item:hover{transform:translateX(3px)}.activity-item.rank-0{opacity:1}.activity-item.rank-1{opacity:.88}.activity-item.rank-2{opacity:.75}.activity-item.rank-3{opacity:.62}.activity-item.rank-4{opacity:.5}.activity-icon{font-size:13px;font-weight:1000;text-align:center}.activity-copy{display:flex;flex-wrap:wrap;gap:0 4px;align-items:baseline;font-size:12px;font-weight:760}.activity-copy b{font-weight:1000}.activity-copy small{margin-left:auto;font-size:9px;font-weight:850;color:rgba(255,255,255,.64)}.activity-empty{padding:4px 2px;font-size:11px;font-weight:750;color:rgba(255,255,255,.62);text-shadow:0 1px 3px rgba(0,0,0,.95)}.activity-new{animation:activityFeedPop 1.1s ease}@keyframes activityFeedPop{0%{transform:translateX(-8px);opacity:0}30%{transform:translateX(0);opacity:1}100%{opacity:1}}.activity-feed-show{position:fixed;left:18px;bottom:18px;z-index:40;border:1px solid rgba(255,255,255,.34);border-radius:999px;padding:7px 10px;background:rgba(15,24,21,.58);color:#fff;font-size:10px;font-weight:900;cursor:pointer}@media(max-width:640px){.activity-feed{left:12px;bottom:12px;width:min(340px,calc(100vw - 24px))}.activity-feed-show{left:12px;bottom:12px}.activity-copy{font-size:11px}}@media(prefers-reduced-motion:reduce){.activity-new{animation:none}.activity-item{transition:none}}';
  document.head.appendChild(activityStyle);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const norm=v=>String(v??'').trim().toLowerCase();
  const cmp=(a,b)=>String(a||'').localeCompare(String(b||''),undefined,{numeric:true,sensitivity:'base'});
  const time=x=>Number(x?.updatedAt||x?.createdAt||0);
  const fmt=v=>{try{return v?new Date(v).toLocaleString([],{month:'short',day:'numeric',year:'numeric'}):'—'}catch{return'—'}};
  const ago=v=>{const ms=Date.now()-Number(v||0),sec=Math.max(0,Math.floor(ms/1000));if(sec<10)return'now';if(sec<60)return`${sec}s`;const min=Math.floor(sec/60);if(min<60)return`${min}m`;const hr=Math.floor(min/60);if(hr<24)return`${hr}h`;return`${Math.floor(hr/24)}d`};
  const container=id=>data.containers.find(c=>String(c.id)===String(id));
  const items=id=>data.entries.filter(e=>String(e.containerId)===String(id));
  const units=id=>items(id).reduce((n,e)=>n+Number(e.quantity||0),0);
  function toast(msg,error=false){const el=$('toast');el.textContent=msg;el.className='toast show'+(error?' error':'');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.className='toast',3300)}
  function renderHubUser(){const p=$('hubUserPill');if(!p)return;const name=hubSession?.signedIn?String(hubSession.name||'').trim():'';p.textContent=name?`👤 ${name}`:'⚠ Hub sign-in required';p.classList.toggle('connected',!!name);if($('siHubUser'))$('siHubUser').textContent=name?`Signed in as ${name}`:'Sign in through the Work Hub before using Stock Intake.';if($('editCurrentUser'))$('editCurrentUser').textContent=name||'Not signed in'}
  async function loadHubSession(){try{const r=await fetch(HUB_SESSION_API,{cache:'no-store',credentials:'same-origin'});hubSession=r.ok?await r.json():{signedIn:false};}catch{hubSession={signedIn:false};}renderHubUser();return hubSession}
  function hubUser(){return hubSession?.signedIn?String(hubSession.name||'').trim():''}
  function requireHubUser(){const name=hubUser();if(!name)toast('Sign in to the Work Hub first. Overstock changes are tied to the signed-in Hub user.',true);return name}
  async function request(body){await loadHubSession();if(!requireHubUser())throw new Error('Hub sign-in required.');const r=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify(body)});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||`Request failed (${r.status})`);return j}
  async function load(show=false){$('refreshBtn').disabled=true;try{await loadHubSession();const r=await fetch(API,{cache:'no-store',credentials:'same-origin'});if(!r.ok)throw new Error(`Could not load Overstock (${r.status})`);data=await r.json();if(hubUser()&&(data.entries||[]).some(e=>norm(e.action)==='donated'&&(e.containerId||e.containerCode||e.location))){const migrated=await request({action:'migrateDonations'});data={...data,...migrated};}render();if(show)toast('Overstock refreshed.')}catch(e){toast(e.message,true)}finally{$('refreshBtn').disabled=false}}

  function activityPreferenceKey(){
    const who=norm(hubUser()||'guest').replace(/[^a-z0-9]+/g,'-');
    return `overstock-activity-hidden:${who}`;
  }
  function activityHidden(){
    try{return localStorage.getItem(activityPreferenceKey())==='1'}catch{return false}
  }
  function setActivityHidden(hidden){
    try{localStorage.setItem(activityPreferenceKey(),hidden?'1':'0')}catch{}
    renderActivityFeed();
  }
  function activityIcon(type){return ({donation:'🎁',added:'＋',updated:'↻',deleted:'×',box:'□'})[type]||'•'}
  function renderActivityFeed(){
    const feed=$('activityFeed'),show=$('activityFeedShow'),list=$('activityFeedList');
    if(!feed||!show||!list)return;
    const hidden=activityHidden();
    feed.hidden=hidden;show.hidden=!hidden;
    if(hidden)return;
    const rows=(Array.isArray(data.activities)?data.activities:[]).slice(0,5);
    list.innerHTML=rows.length?rows.map((a,i)=>`<button class="activity-item rank-${i}" type="button" data-activity-id="${esc(a.id)}" data-entry-id="${esc(a.entryId||'')}" data-container-id="${esc(a.containerId||'')}" data-activity-type="${esc(a.type||'update')}"><span class="activity-icon">${activityIcon(a.type)}</span><span class="activity-copy"><b>${esc(a.actor||'Unknown')}</b> ${esc(a.summary||'updated Overstock')}<small>${esc(ago(a.createdAt))}</small></span></button>`).join(''):'<div class="activity-empty">No recent Overstock activity yet.</div>';
    list.querySelectorAll('[data-activity-id]').forEach(btn=>btn.onclick=()=>{
      const entryId=btn.dataset.entryId,containerId=btn.dataset.containerId,type=btn.dataset.activityType;
      if(type==='donation'){openDonationPool();return}
      const entry=data.entries.find(e=>String(e.id)===String(entryId)&&norm(e.action)!=='donated');
      if(entry){openEntry(entry.id,entry.containerId||containerId||'');return}
      if(containerId&&container(containerId))openBox(containerId);
    });
  }
  async function pollActivityFeed(){
    try{
      const r=await fetch(`${API}?activity=1`,{cache:'no-store',credentials:'same-origin'});
      if(!r.ok)return;
      const j=await r.json();
      const rows=Array.isArray(j.activities)?j.activities:[];
      const newest=rows[0]?.id||'';
      const changed=newest&&newest!==lastActivityId;
      data.activities=rows;
      renderActivityFeed();
      if(changed&&lastActivityId&&!activityHidden()){
        const first=$('activityFeedList')?.querySelector('.activity-item');
        if(first){first.classList.add('activity-new');setTimeout(()=>first.classList.remove('activity-new'),1200)}
      }
      lastActivityId=newest;
    }catch{}
  }

  function mutationMessage(base,j){return j.excelWrite?.configured&&!j.excelWrite?.ok?`${base} Excel write-back needs attention.`:base}
  function lists(){const opts=(arr,blank='')=>`${blank?`<option value="">${blank}</option>`:''}${[...new Set(arr.filter(Boolean))].sort(cmp).map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('')}`;$('categoryList').innerHTML=opts(data.categories||[]);document.querySelectorAll('select[name="containerId"]').forEach(s=>{const keep=s.value;s.innerHTML=opts(data.containers.filter(c=>norm(c.status)!=='closed').sort((a,b)=>cmp(a.code,b.code)).map(c=>({v:c.id,t:`${c.code} · ${c.currentLocation||'On cart'}`})).map(x=>x.v));s.innerHTML='<option value="">— Select box —</option>'+data.containers.filter(c=>norm(c.status)!=='closed').sort((a,b)=>cmp(a.code,b.code)).map(c=>`<option value="${esc(c.id)}">${esc(c.code)} · ${esc(c.currentLocation||'On cart')}</option>`).join('');s.value=keep});const locs=['',...(data.locations||[])];document.querySelectorAll('select[name="currentLocation"],#siContainerLocation').forEach(s=>{const keep=s.value;s.innerHTML=locs.map(v=>`<option value="${esc(v)}">${v?esc(v):'— No location / on cart —'}</option>`).join('');s.value=keep})}
  function syncPill(){const p=$('excelSyncPill'),out=data.excelSync?.configured,inbound=data.excelSync?.importConfigured;p.textContent=out&&inbound?'Excel sync · Two-way ready':inbound?'Excel → Houston · Ready':out?'Houston → Excel · Ready':'Excel sync · Setup needed';p.classList.toggle('connected',out||inbound)}
  function status(c){const n=norm(c.status);if(n==='closed')return'closed';if(c.currentLocation&&(n==='stored'||n==='full'))return'stored';if(!c.currentLocation)return'cart';return n||'open'}
  function renderStats(){const active=data.containers.filter(c=>status(c)!=='closed'),cart=active.filter(c=>!c.currentLocation),open=active.filter(c=>status(c)==='open'||status(c)==='cart'),stored=active.filter(c=>c.currentLocation&&(status(c)==='stored'||status(c)==='full'));$('statCart').textContent=cart.length;$('statOpen').textContent=open.length;$('statStored').textContent=stored.length;$('statLocations').textContent=new Set(active.map(c=>c.currentLocation).filter(Boolean)).size;return{active,cart,open,stored}}
  function boxCard(c,cart=false){const its=items(c.id),u=units(c.id);return`<article class="box-card" data-box="${esc(c.id)}"><div class="box-top"><div class="box-code"><i class="status-dot ${status(c)}"></i>${esc(c.code||'Unnamed')}</div><span class="badge ${cart?'amber':''}">${esc(cart?'On cart':c.status||'Open')}</span></div><div class="box-meta"><b>${its.length}</b> PO${its.length===1?'':'s'} · <b>${u.toLocaleString()}</b> units${c.currentLocation?` · 📍 ${esc(c.currentLocation)}`:''}</div><div class="box-meta">${its.slice(0,3).map(e=>`PO ${esc(e.po)}`).join(' · ')||'Empty box'}</div><div class="box-cta">${cart?'Assign location →':'Open box options →'}</div></article>`}
  function bindBoxes(root=document){root.querySelectorAll('[data-box]').forEach(el=>el.onclick=()=>openBox(el.dataset.box))}
  function renderCart(stats){$('cartCount').textContent=`${stats.cart.length} waiting`;$('cartGrid').innerHTML=stats.cart.length?stats.cart.sort((a,b)=>time(b)-time(a)).map(c=>boxCard(c,true)).join(''):'<div class="empty">✓ No boxes are waiting on the cart.</div>';bindBoxes($('cartGrid'))}
  function renderLocations(stats){const locs=[...new Set([...(data.locations||[]),...stats.active.map(c=>c.currentLocation).filter(Boolean)])].sort(cmp),used=new Set(stats.active.map(c=>c.currentLocation).filter(Boolean));$('locationCount').textContent=`${used.size} used`;$('locationGrid').innerHTML=locs.map(loc=>{const bs=stats.active.filter(c=>norm(c.currentLocation)===norm(loc)),u=bs.reduce((n,c)=>n+units(c.id),0);return`<button class="location ${bs.length?'occupied':''}" data-location="${esc(loc)}"><b>${esc(loc)}</b><span>${bs.length?`${bs.length} bx · ${u}u`:'free'}</span></button>`}).join('');document.querySelectorAll('[data-location]').forEach(b=>b.onclick=()=>openLocation(b.dataset.location))}
  function renderBoxes(stats){
    const q=norm($('boxSearch').value),sort=$('boxSort').value;
    const activeBoxes=stats.active.filter(c=>items(c.id).length>0);
    const emptyBoxes=stats.active.filter(c=>items(c.id).length===0);
    let bs=(boxView==='empty'?emptyBoxes:activeBoxes).filter(c=>{
      const content=items(c.id).map(e=>`${e.po} ${e.deliveryId||''}`).join(' ');
      return !q||norm(`${c.code} ${c.currentLocation} ${c.status} ${content}`).includes(q)
    });
    if(sort==='name')bs.sort((a,b)=>cmp(a.code,b.code));
    else if(sort==='location')bs.sort((a,b)=>cmp(a.currentLocation,b.currentLocation)||cmp(a.code,b.code));
    else bs.sort((a,b)=>time(b)-time(a));

    $('boxActiveCount').textContent=activeBoxes.length;
    $('boxEmptyCount').textContent=emptyBoxes.length;
    $('boxCount').textContent=`${bs.length} ${boxView==='empty'?'empty container':'box'}${bs.length===1?'':'es'}`;
    $('boxViewTitle').textContent=boxView==='empty'?'Empty containers':'Active boxes';
    $('boxViewNote').textContent=boxView==='empty'
      ? 'Empty containers are kept here for reuse without cluttering the active box list.'
      : 'Containers currently holding one or more Overstock records.';
    document.querySelectorAll('[data-box-view]').forEach(btn=>{
      const on=btn.dataset.boxView===boxView;
      btn.classList.toggle('active',on);
      btn.setAttribute('aria-current',on?'true':'false');
    });

    $('boxesGrid').innerHTML=bs.length
      ? bs.map(c=>boxCard(c)).join('')
      : `<div class="empty">${boxView==='empty'?'No empty containers right now.':'No active boxes match.'}</div>`;
    bindBoxes($('boxesGrid'));
  }
  function logMatches(e,q){const c=container(e.containerId);return!q||norm([e.po,e.deliveryId,e.category,e.status,e.action,e.location,e.containerCode,e.associate,e.originalAssociate,e.lastChangedBy,c?.code,c?.currentLocation].join(' ')).includes(q)}
  function renderLog(){
    const q=norm($('logSearch').value),sort=$('logSort').value;
    let es=data.entries.filter(e=>norm(e.action)!=='donated').filter(e=>logMatches(e,q));
    if(sort==='oldest')es.sort((a,b)=>time(a)-time(b));
    else if(sort==='po')es.sort((a,b)=>cmp(a.po,b.po));
    else if(sort==='qty-desc')es.sort((a,b)=>Number(b.quantity||0)-Number(a.quantity||0));
    else if(sort==='qty-asc')es.sort((a,b)=>Number(a.quantity||0)-Number(b.quantity||0));
    else if(sort==='location')es.sort((a,b)=>cmp(container(a.containerId)?.currentLocation||a.location,container(b.containerId)?.currentLocation||b.location));
    else if(sort==='associate')es.sort((a,b)=>cmp(a.originalAssociate||a.associate,b.originalAssociate||b.associate));
    else es.sort((a,b)=>time(b)-time(a));

    const visible=es.slice(0,logLimit);
    $('logBody').innerHTML=visible.length?visible.map(e=>{
      const c=container(e.containerId),loc=c?.currentLocation||e.location||'—',code=c?.code||e.containerCode||'—';
      const storedOriginal=String(e.originalAssociate||'').trim();
      const currentAssociate=String(e.associate||'').trim();
      const original=/^unknown(?: associate)?$/i.test(storedOriginal)||!storedOriginal
        ? (currentAssociate&&!/^unknown(?: associate)?$/i.test(currentAssociate)?currentAssociate:'Unknown')
        : storedOriginal;
      const fromExcel=norm(e.sourceType)==='excel-location-sync';
      const changed=fromExcel?'Excel Sync':(e.lastChangedBy||original);
      const sourceNote=fromExcel?'<span class="excel-source">From Excel</span>':'';
      return `<tr>
        <td>${esc(e.date||fmt(time(e)))}</td>
        <td><button class="po-link" data-entry="${esc(e.id)}">${esc(e.po||'—')}</button>${e.deliveryId?`<small><br>${esc(e.deliveryId)}</small>`:''}</td>
        <td>${esc(e.category||'—')}</td>
        <td><span class="qty">+${Number(e.quantity||0).toLocaleString()}</span></td>
        <td><span class="tag">${esc(e.action||'—')}</span></td>
        <td><span class="mono">${esc(loc)}</span><br><small>${esc(code)}</small></td>
        <td>${esc(original)}${fromExcel?'<small><br>Prep By</small>':''}</td>
        <td>${esc(changed)}${sourceNote?`<small><br>${sourceNote}</small>`:''}<small><br>${esc(fmt(e.updatedAt))}</small></td>
        <td><button class="ghost" data-entry="${esc(e.id)}">Edit</button></td>
      </tr>`;
    }).join(''):'<tr><td colspan="9" class="empty">No entries match.</td></tr>';
    $('logCount').textContent=`Showing ${visible.length} of ${es.length}`;
    $('showMoreBtn').hidden=visible.length>=es.length;
    $('showMoreBtn').textContent=`Show more (${es.length-visible.length} remaining)`;
    document.querySelectorAll('[data-entry]').forEach(b=>b.onclick=()=>openEntry(b.dataset.entry));
  }
  function renderDonationPoolButton(){const rows=Array.isArray(data.donations)?data.donations:[];const count=rows.length,total=rows.reduce((n,d)=>n+Number(d.quantity||0),0);$('donationPoolBtn').innerHTML=`🎁 Donation Pool <span class="button-count">${count}</span>`;$('donationPoolBtn').title=`${count} donated PO${count===1?'':'s'} · ${total.toLocaleString()} units`;}
  function openDonationPool(){const rows=(Array.isArray(data.donations)?data.donations:[]).slice().sort((a,b)=>Number(b.donatedAt||b.updatedAt||0)-Number(a.donatedAt||a.updatedAt||0));const total=rows.reduce((n,d)=>n+Number(d.quantity||0),0);$('donationDialogSub').textContent=rows.length?`${rows.length} PO${rows.length===1?'':'s'} · ${total.toLocaleString()} units`:'Nothing donated yet.';$('donationDialogBody').innerHTML=rows.length?'<div class="donation-list">'+rows.map(d=>{const original=d.originalAssociate||d.associate||'Unknown',donor=d.donatedBy||d.lastChangedBy||original;return`<article class="donation-row"><div class="donation-main"><b>PO ${esc(d.po||'—')}</b><span class="qty">${Number(d.quantity||0).toLocaleString()} units</span></div><div class="donation-meta">${esc(d.category||'Uncategorized')}${d.deliveryId?` · ${esc(d.deliveryId)}`:''}</div><div class="donation-meta">From <b>${esc(d.containerCode||'Unknown box')}</b>${d.location?` · 📍 ${esc(d.location)}`:''}</div><div class="donation-meta">Originally added by <b>${esc(original)}</b></div><div class="donation-meta">Donated by <b>${esc(donor)}</b> · ${esc(fmt(d.donatedAt||d.updatedAt))}</div></article>`}).join('')+'</div>':'<div class="empty">The Donation Pool is empty.</div>';$('donationDialog').showModal();}
  function render(){lists();syncPill();renderDonationPoolButton();const stats=renderStats();renderCart(stats);renderLocations(stats);renderBoxes(stats);renderLog();renderActivityFeed()}
  function openBox(id){const c=container(id);if(!c)return;const its=items(id);$('boxDialogTitle').textContent=c.code||'Box';$('boxDialogSub').textContent=`${c.currentLocation||'On cart'} · ${its.length} PO(s) · ${units(id)} units`;$('boxDialogBody').innerHTML=`<div class="box-summary"><b>${esc(c.code)}</b> is ${esc(c.status||'Open')} at <b>${esc(c.currentLocation||'no assigned location')}</b>.</div><div class="action-grid"><button class="action-btn" data-act="add">➕ Add a PO</button><button class="action-btn" data-act="audit">🔍 Audit contents</button><button class="action-btn" data-act="move">↗ Move location</button><button class="action-btn" data-act="edit">✏️ Edit box</button>${its.length===0?'<button class="action-btn" data-act="delete">🗑 Delete empty box</button>':''}</div>`;$('boxDialog').showModal();$('boxDialogBody').querySelector('[data-act="add"]').onclick=()=>{close('boxDialog');newEntry(id)};$('boxDialogBody').querySelector('[data-act="audit"]').onclick=()=>auditBox(id);$('boxDialogBody').querySelector('[data-act="move"]').onclick=()=>editContainer(id,true);$('boxDialogBody').querySelector('[data-act="edit"]').onclick=()=>editContainer(id);$('boxDialogBody').querySelector('[data-act="delete"]')?.addEventListener('click',()=>deleteContainer(id))}
  function auditBox(id){const c=container(id),its=items(id);$('boxDialogTitle').textContent=`Audit ${c.code}`;$('boxDialogSub').textContent='Verify the physical contents against this list.';$('boxDialogBody').innerHTML=`<div class="box-summary">📍 <b>${esc(c.currentLocation||'On cart')}</b> · ${units(id)} total units</div><div class="audit-list">${its.length?its.map(e=>`<div class="audit-row"><span><b>PO ${esc(e.po)}</b>${e.deliveryId?` · ${esc(e.deliveryId)}`:''}<br><small>${esc(e.category||'Uncategorized')} · ${esc(e.associate||'Unknown associate')}</small></span><span><b>${Number(e.quantity||0)}</b> units <button class="ghost" data-audit-entry="${esc(e.id)}">Edit</button></span></div>`).join(''):'<div class="empty">This box has no POs.</div>'}</div>`;document.querySelectorAll('[data-audit-entry]').forEach(b=>b.onclick=()=>{close('boxDialog');openEntry(b.dataset.auditEntry,id)})}
  function openLocation(loc){const bs=data.containers.filter(c=>norm(c.currentLocation)===norm(loc)&&status(c)!=='closed');$('locationDialogTitle').textContent=loc;$('locationDialogSub').textContent=`${bs.length} box(es) · ${bs.reduce((n,c)=>n+units(c.id),0)} units`;$('locationDialogBody').innerHTML=bs.length?`<div class="card-grid">${bs.map(c=>boxCard(c)).join('')}</div>`:'<div class="empty">This location is free.</div>';$('locationDialog').showModal();bindBoxes($('locationDialogBody'))}
  function close(id){$(id)?.close()}
  function returnToBoxList(){
    const boxId=entryReturnBoxId;
    close('editDialog');
    if(boxId&&container(boxId)){openBox(boxId);auditBox(boxId)}
    entryReturnBoxId='';
  }
  function closeEdit(){
    if(entryReturnBoxId)returnToBoxList();
    else close('editDialog');
  }
  function confirmDonationEligibility({po='',quantity=0,containerCode=''}={}){
    const dlg=$('donationEligibilityDialog'),confirmBtn=$('donationEligibilityConfirm'),cancelBtn=$('donationEligibilityCancel'),closeBtn=$('donationEligibilityClose'),summary=$('donationEligibilityItem');
    const checks=[...dlg.querySelectorAll('[data-donation-check]')];
    checks.forEach(c=>{c.checked=false});
    confirmBtn.disabled=true;
    summary.textContent=`PO ${po||'—'} · ${Number(quantity||0).toLocaleString()} units${containerCode?` · ${containerCode}`:''}`;
    return new Promise(resolve=>{
      let finished=false;
      const cleanup=()=>{checks.forEach(c=>c.removeEventListener('change',update));confirmBtn.removeEventListener('click',yes);cancelBtn.removeEventListener('click',no);closeBtn.removeEventListener('click',no);dlg.removeEventListener('cancel',cancelEvent)};
      const finish=value=>{if(finished)return;finished=true;cleanup();if(dlg.open)dlg.close();resolve(value)};
      const update=()=>{confirmBtn.disabled=!checks.every(c=>c.checked)};
      const yes=()=>finish(true),no=()=>finish(false),cancelEvent=e=>{e.preventDefault();finish(false)};
      checks.forEach(c=>c.addEventListener('change',update));
      confirmBtn.addEventListener('click',yes);
      cancelBtn.addEventListener('click',no);
      closeBtn.addEventListener('click',no);
      dlg.addEventListener('cancel',cancelEvent);
      dlg.showModal();
    });
  }
  function newEntry(containerId){const actor=requireHubUser();if(!actor)return;entryReturnBoxId='';$('editBackBtn').hidden=true;const f=$('editForm');f.reset();f.elements.id.value='';lists();f.elements.containerId.value=containerId||'';$('editOriginalAssociate').textContent=actor;$('editCurrentUser').textContent=actor;$('editTitle').textContent='Add PO to box';$('editSubtitle').textContent=container(containerId)?.code||'Choose a box';$('deleteEntryBtn').hidden=true;$('donateEntryBtn').hidden=true;$('editDialog').showModal();setTimeout(()=>f.elements.po.focus(),20)}
  function openEntry(id,returnBoxId=''){const e=data.entries.find(x=>String(x.id)===String(id));if(!e||norm(e.action)==='donated')return;entryReturnBoxId=returnBoxId||'';$('editBackBtn').hidden=!entryReturnBoxId;const f=$('editForm');lists();['id','po','deliveryId','containerId','quantity','category','action','note'].forEach(k=>f.elements[k].value=e[k]??'');$('editOriginalAssociate').textContent=e.originalAssociate||e.associate||'Unknown';$('editCurrentUser').textContent=hubUser()||'Not signed in';$('editTitle').textContent=`PO ${e.po}`;$('editSubtitle').textContent=`${e.deliveryId||e.containerCode||''}${e.lastChangedBy?` · Last changed by ${e.lastChangedBy}`:''}`;$('deleteEntryBtn').hidden=false;$('donateEntryBtn').hidden=false;$('editDialog').showModal()}
  function editContainer(id='',focusLocation=false){close('boxDialog');const c=id?container(id):null,f=$('containerForm');f.reset();lists();f.elements.id.value=c?.id||'';f.elements.code.value=c?.code||'';f.elements.currentLocation.value=c?.currentLocation||'';f.elements.status.value=c?.status||'Open';f.elements.notes.value=c?.notes||'';$('containerTitle').textContent=c?`Edit ${c.code}`:'New box';$('containerDialog').showModal();setTimeout(()=>focusLocation?f.elements.currentLocation.focus():f.elements.code.focus(),20)}
  async function deleteContainer(id){const c=container(id);if(!c||items(id).length||!confirm(`Delete empty box ${c.code}?`))return;try{const j=await request({action:'deleteContainer',id});data={...data,...j};close('boxDialog');render();toast('Empty box deleted.')}catch(e){toast(e.message,true)}}
  function inspectIntake(){const code=norm($('siContainerCode').value),c=data.containers.find(x=>norm(x.code)===code),el=$('siExistingContainer');el.hidden=!c;if(c){el.textContent=`Existing box · ${c.currentLocation||'On cart'} · ${items(c.id).length} PO(s)`;$('siContainerLocation').value=c.currentLocation||''}}
  function intakeStats(){$('siItemsCount').textContent=intake.items.length;$('siContainersCount').textContent=intake.touched.size;$('siStartedAt').textContent=intake.started?new Date(intake.started).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}):'—';$('siRecentList').innerHTML=intake.items.slice().reverse().map(e=>`<div class="recent-item"><b>PO ${esc(e.po)}</b> · ${Number(e.quantity||0)} units · ${esc(e.containerCode)}</div>`).join('')}
  function openIntake(containerId=''){const actor=requireHubUser();if(!actor)return;intake={container:null,items:[],touched:new Set(),started:Date.now()};$('stockIntakeOverlay').hidden=false;$('siContainerStep').hidden=false;$('siItemStep').hidden=true;$('siContainerForm').reset();lists();renderHubUser();if(containerId){const c=container(containerId);$('siContainerCode').value=c?.code||'';$('siContainerLocation').value=c?.currentLocation||'';inspectIntake()}intakeStats();setTimeout(()=>$('siContainerCode').focus(),20)}
  function closeIntake(){$('stockIntakeOverlay').hidden=true;intake.container=null;render()}
  $('editForm').onsubmit=async ev=>{ev.preventDefault();const actor=requireHubUser();if(!actor)return;const f=ev.currentTarget,d=Object.fromEntries(new FormData(f)),old=data.entries.find(e=>String(e.id)===String(d.id))||{},c=container(d.containerId);if(!c)return toast('Choose a box.',true);const original=String(old.originalAssociate||old.associate||actor).trim(),entry={...old,id:d.id||undefined,po:d.po,deliveryId:d.deliveryId,containerId:c.id,containerCode:c.code,location:c.currentLocation,quantity:Number(d.quantity||0),category:d.category,status:old.status||'Not Donation',action:d.action,associate:original,originalAssociate:original,note:d.note,date:old.date||new Date().toISOString().slice(0,10),sourceType:old.sourceType||'overstock-standalone'};try{const j=await request({action:'upsertEntry',entry});data={...data,...j};const shouldReturn=Boolean(d.id&&entryReturnBoxId);if(shouldReturn){render();returnToBoxList()}else{close('editDialog');render()}toast(mutationMessage(d.id?'Item updated.':'PO added to box.',j))}catch(e){toast(e.message,true)}};
  $('donateEntryBtn').onclick=async()=>{const actor=requireHubUser();if(!actor)return;const f=$('editForm'),id=f.elements.id.value,e=data.entries.find(x=>String(x.id)===String(id));if(!e)return;const c=container(e.containerId),returnBoxId=entryReturnBoxId||e.containerId;const eligible=await confirmDonationEligibility({po:e.po,quantity:e.quantity,containerCode:c?.code||e.containerCode||''});if(!eligible)return;try{const j=await request({action:'donateEntry',id});data={...data,...j};render();if(returnBoxId){entryReturnBoxId=returnBoxId;returnToBoxList()}else close('editDialog');toast(`PO ${e.po} moved to the Donation Pool by ${actor}.`)}catch(x){toast(x.message,true)}};
  $('deleteEntryBtn').onclick=async()=>{if(!requireHubUser())return;const id=$('editForm').elements.id.value,e=data.entries.find(x=>String(x.id)===String(id));if(!e||!confirm(`⚠️ DELETE THIS PO?\n\nYou are about to permanently remove PO ${e.po} from the shared Overstock system.\n\nONLY use Delete if this entry was created by mistake. If the product was donated, moved, pulled, missing, or replaced, press Cancel and use the correct action instead.\n\nPress OK to DELETE or Cancel to keep it.`))return;try{const j=await request({action:'deleteEntry',id});data={...data,...j};const shouldReturn=Boolean(entryReturnBoxId);render();if(shouldReturn)returnToBoxList();else close('editDialog');toast(mutationMessage('Item deleted.',j))}catch(x){toast(x.message,true)}};
  $('containerForm').onsubmit=async ev=>{ev.preventDefault();if(!requireHubUser())return;const d=Object.fromEntries(new FormData(ev.currentTarget)),old=container(d.id)||{},saved={...old,id:d.id||undefined,code:d.code,currentLocation:d.currentLocation,status:d.currentLocation&&['Open','On Cart'].includes(d.status)?'Stored':d.status,notes:d.notes};try{const j=await request({action:'upsertContainer',container:saved});data={...data,...j};close('containerDialog');render();toast(mutationMessage(d.id?'Box updated.':'Box created.',j))}catch(e){toast(e.message,true)}};
  $('boxLookupForm').onsubmit=e=>{e.preventDefault();const code=norm($('boxLookupInput').value),c=data.containers.find(x=>norm(x.code)===code);if(c){$('boxLookupStatus').textContent=`Found ${c.code} · ${c.currentLocation||'On cart'} · ${items(c.id).length} PO(s)`;openBox(c.id)}else{$('boxLookupStatus').textContent='Box not found. Opening Stock Intake to create it.';openIntake();$('siContainerCode').value=$('boxLookupInput').value.trim().toUpperCase()}};
  $('siContainerCode').oninput=inspectIntake;
  $('siContainerForm').onsubmit=async ev=>{ev.preventDefault();const actor=requireHubUser();if(!actor)return;const code=$('siContainerCode').value.trim().toUpperCase(),loc=$('siContainerLocation').value;let c=data.containers.find(x=>norm(x.code)===norm(code));try{if(!c){if(!loc)throw new Error('Choose a location for the new box.');const j=await request({action:'upsertContainer',container:{code,currentLocation:loc,status:'Stored',notes:'Created through Stock Intake'}});data={...data,...j};c=data.containers.find(x=>norm(x.code)===norm(code))}if(!c)throw new Error('Box could not be opened.');intake.container=c;intake.touched.add(String(c.id));intakeStats();$('siActiveContainer').textContent=`${c.code} · ${c.currentLocation||'On cart'} · Hub user: ${actor}`;$('siContainerStep').hidden=true;$('siItemStep').hidden=false;setTimeout(()=>$('siPo').focus(),20)}catch(e){toast(e.message,true)}};
  $('siItemForm').onsubmit=async ev=>{ev.preventDefault();const c=intake.container,po=$('siPo').value.trim(),qty=Number($('siQty').value||0),donateNow=ev.submitter?.dataset.intent==='donate';if(!c||!po||qty<1)return toast('Enter a PO and quantity.',true);if(donateNow){const eligible=await confirmDonationEligibility({po,quantity:qty,containerCode:c.code});if(!eligible)return}const actor=requireHubUser();if(!actor)return;const entry={po,deliveryId:$('siDeliveryId').value.trim(),quantity:qty,category:$('siCategory').value.trim(),status:'Not Donation',action:$('siAction').value,note:$('siNote').value.trim(),containerId:c.id,containerCode:c.code,location:c.currentLocation,date:new Date().toISOString().slice(0,10),sourceType:'stock-intake'};try{const j=await request({action:'upsertEntry',entry,donateNow});data={...data,...j};const saved=data.entries.slice().sort((a,b)=>time(b)-time(a)).find(e=>e.po===po)||entry;intake.items.push({...saved,containerCode:c.code});intakeStats();['siPo','siDeliveryId','siQty','siCategory','siNote'].forEach(id=>$(id).value='');setTimeout(()=>$('siPo').focus(),20);toast(donateNow?`PO ${po} moved to the Donation Pool.`:`PO ${po} added to ${c.code}.`)}catch(e){toast(e.message,true)}};
  $('siSwitchContainer').onclick=()=>{intake.container=null;$('siItemStep').hidden=true;$('siContainerStep').hidden=false;$('siContainerCode').value='';$('siExistingContainer').hidden=true};$('stockIntakeBtn').onclick=()=>openIntake();$('stockIntakeCancel').onclick=()=>{if(!intake.items.length||confirm('Cancel? Saved items will remain in Houston.'))closeIntake()};$('stockIntakeComplete').onclick=()=>{toast(`Stock Intake complete · ${intake.items.length} item(s) added.`);closeIntake()};
  $('activityFeedHide').onclick=()=>setActivityHidden(true);$('activityFeedShow').onclick=()=>setActivityHidden(false);$('refreshBtn').onclick=()=>load(true);$('donationPoolBtn').onclick=openDonationPool;$('newBoxBtn').onclick=()=>editContainer();$('boxSearch').oninput=()=>renderBoxes(renderStats());$('boxSort').onchange=()=>renderBoxes(renderStats());document.querySelectorAll('[data-box-view]').forEach(btn=>btn.onclick=()=>{boxView=btn.dataset.boxView==='empty'?'empty':'active';renderBoxes(renderStats())});$('logSearch').oninput=()=>{logLimit=50;renderLog()};$('logSort').onchange=()=>{logLimit=50;renderLog()};$('showMoreBtn').onclick=()=>{logLimit+=50;renderLog()};$('editBackBtn').onclick=returnToBoxList;$('editCloseBtn').onclick=closeEdit;document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>close(b.dataset.close));
  load().then?.(()=>{lastActivityId=data.activities?.[0]?.id||'';renderActivityFeed()});setInterval(()=>{if(!document.hidden)pollActivityFeed()},5000);setInterval(()=>{if(!document.hidden&&!document.querySelector('dialog[open]')&&!document.activeElement?.matches('input,select,textarea')&&$('stockIntakeOverlay').hidden)load()},60000);
})();
