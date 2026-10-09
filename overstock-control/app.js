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
  // One formatter each, reused: toLocaleString with options builds a new one
  // per call, which made formatting thousands of dates slow. Same output.
  const dateFormat=new Intl.DateTimeFormat([],{month:'short',day:'numeric',year:'numeric'});
  const dateTimeFormat=new Intl.DateTimeFormat([],{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});
  const fmt=v=>{try{return v?dateFormat.format(new Date(v)):'—'}catch{return'—'}};
  const ago=v=>{const ms=Date.now()-Number(v||0),sec=Math.max(0,Math.floor(ms/1000));if(sec<10)return'now';if(sec<60)return`${sec}s`;const min=Math.floor(sec/60);if(min<60)return`${min}m`;const hr=Math.floor(min/60);if(hr<24)return`${hr}h`;return`${Math.floor(hr/24)}d`};
  const fullFmt=v=>{try{return v?dateTimeFormat.format(new Date(v)):'—'}catch{return'—'}};
  const container=id=>data.containers.find(c=>String(c.id)===String(id));
  const items=id=>data.entries.filter(e=>String(e.containerId)===String(id));
  const units=id=>items(id).reduce((n,e)=>n+Number(e.quantity||0),0);
  function toast(msg,error=false){const el=$('toast');el.textContent=msg;el.className='toast show'+(error?' error':'');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.className='toast',3300)}
  function renderHubUser(){const p=$('hubUserPill');if(!p)return;const name=hubSession?.signedIn?String(hubSession.name||'').trim():'';p.textContent=name?`👤 ${name}`:'⚠ Hub sign-in required';p.classList.toggle('connected',!!name);if($('siHubUser'))$('siHubUser').textContent=name?`Signed in as ${name}`:'Sign in through the Work Hub before using Stock Intake.';if($('editCurrentUser'))$('editCurrentUser').textContent=name||'Not signed in';
    const elevated=['manager','team lead'].includes(String(hubSession?.role||'').toLowerCase());
    if($('retireEmptyExcelBtn'))$('retireEmptyExcelBtn').hidden=!(name&&elevated);
  }
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
    const retiredBoxes=data.containers.filter(c=>status(c)==='closed');
    const eligible=boxView==='retired'?retiredBoxes:boxView==='empty'?emptyBoxes:activeBoxes;
    let bs=eligible.filter(c=>{
      const content=items(c.id).map(e=>`${e.po} ${e.deliveryId||''}`).join(' ');
      return !q||norm(`${c.code} ${c.currentLocation} ${c.status} ${content}`).includes(q);
    });
    if(sort==='name')bs.sort((a,b)=>cmp(a.code,b.code));
    else if(sort==='location')bs.sort((a,b)=>cmp(a.currentLocation,b.currentLocation)||cmp(a.code,b.code));
    else bs.sort((a,b)=>time(b)-time(a));

    $('boxActiveCount').textContent=activeBoxes.length;
    $('boxEmptyCount').textContent=emptyBoxes.length;
    $('boxRetiredCount').textContent=retiredBoxes.length;
    $('boxCount').textContent=`${bs.length} ${boxView==='empty'?'empty':boxView==='retired'?'retired':'active'} box${bs.length===1?'':'es'}`;
    $('boxViewTitle').textContent=boxView==='retired'?'Retired / closed boxes':boxView==='empty'?'Empty containers':'Active boxes';
    $('boxViewNote').textContent=boxView==='retired'
      ? 'Retired Excel-generated boxes and manually closed boxes remain here for review, history and reuse.'
      : boxView==='empty'
        ? 'Reusable empty containers are kept here without cluttering active inventory.'
        : 'Containers currently holding one or more Overstock records.';
    document.querySelectorAll('[data-box-view]').forEach(btn=>{
      const on=btn.dataset.boxView===boxView;
      btn.classList.toggle('active',on);
      btn.setAttribute('aria-current',on?'true':'false');
    });
    $('boxesGrid').innerHTML=bs.length?bs.map(c=>boxCard(c)).join('')
      : `<div class="empty">${boxView==='retired'?'No retired boxes.':boxView==='empty'?'No empty containers right now.':'No active boxes match.'}</div>`;
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

  function donationMatches(d,q){
    if(!q)return true;
    const original=d.originalAssociate||d.associate||'';
    const donor=d.donatedBy||d.lastChangedBy||original;
    const when=d.donatedAt||d.updatedAt||d.createdAt;
    return norm([
      d.po,d.deliveryId,d.category,d.quantity,d.containerCode,d.location,d.note,
      original,donor,when,fmt(when),fullFmt(when),'donated','donation'
    ].join(' ')).includes(q);
  }

  function renderDonationPool(){
    const all=(Array.isArray(data.donations)?data.donations:[]).slice()
      .sort((a,b)=>Number(b.donatedAt||b.updatedAt||0)-Number(a.donatedAt||a.updatedAt||0));
    const q=norm($('donationSearch')?.value);
    const rows=all.filter(d=>donationMatches(d,q));
    const total=all.reduce((n,d)=>n+Number(d.quantity||0),0);
    const resultUnits=rows.reduce((n,d)=>n+Number(d.quantity||0),0);
    $('donationDialogSub').textContent=all.length?`${all.length} PO${all.length===1?'':'s'} · ${total.toLocaleString()} units`:'Nothing donated yet.';
    if($('donationSearchClear'))$('donationSearchClear').hidden=!q;
    if($('donationSearchCount'))$('donationSearchCount').textContent=q
      ? `Showing ${rows.length} of ${all.length} donated POs · ${resultUnits.toLocaleString()} units in results`
      : `${all.length} donated POs · search by PO, item, box, location, person, or date`;
    $('donationDialogBody').innerHTML=rows.length?'<div class="donation-list">'+rows.map(d=>{
      const original=d.originalAssociate||d.associate||'Unknown',donor=d.donatedBy||d.lastChangedBy||original;
      return`<article class="donation-row" data-donation-id="${esc(d.id)}">
        <div class="donation-main"><b>PO ${esc(d.po||'—')}</b><span class="qty">${Number(d.quantity||0).toLocaleString()} units</span></div>
        <div class="donation-meta">${esc(d.category||'Uncategorized')}${d.deliveryId?` · ${esc(d.deliveryId)}`:''}</div>
        <div class="donation-meta">From <b>${esc(d.containerCode||'Unknown box')}</b>${d.location?` · 📍 ${esc(d.location)}`:''}</div>
        <div class="donation-meta">Originally added by <b>${esc(original)}</b></div>
        <div class="donation-meta">Donated by <b>${esc(donor)}</b> · ${esc(fullFmt(d.donatedAt||d.updatedAt||d.createdAt))}</div>
      </article>`}).join('')+'</div>'
      :`<div class="empty">${all.length?'No donated items match this search.':'The Donation Pool is empty.'}</div>`;
  }

  // Donation readiness, worked out from data.donationInfo (built by the
  // Overstock function). Bulk and Bulk+Assembly POs can go 30 days after they
  // were first added to Overstock; Pack Builder POs 30 days after their
  // assembly date, or any time if no date has been added (anyone can add one).
  // POs not in the workbook have no route and are left out.
  const isLead=()=>['manager','team lead'].includes(String(hubSession?.role||'').toLowerCase());
  const localToday=()=>{const d=new Date();return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
  const dayPlus=(day,n)=>{const d=new Date(`${day}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
  const dayDiff=(a,b)=>Math.round((Date.parse(`${a}T12:00:00Z`)-Date.parse(`${b}T12:00:00Z`))/864e5);
  const shortDay=day=>day?dateFormat.format(new Date(`${day}T12:00:00`)):'—';
  const poKey=v=>String(v??'').trim().replace(/^PO[-\s]*/i,'').trim().toUpperCase();
  const routeLabel=route=>route==='Assembly'?'Pack Builder':route;
  function donationReadiness(po){
    const info=data.donationInfo,row=info?.pos?.[poKey(po)],wait=Number(info?.waitDays||30);
    if(!row?.route)return{status:'no-route'};
    const packBuilder=row.route==='Assembly',start=packBuilder?row.assembly?.date:row.added;
    if(!start)return{status:packBuilder?'needs-assembly-date':'no-route',route:row.route,wait};
    const readyOn=dayPlus(start,wait),today=localToday();
    return{status:today>=readyOn?'ready':'waiting',route:row.route,start,readyOn,wait,days:dayDiff(today,start),left:dayDiff(readyOn,today),assembly:row.assembly};
  }
  const stillInBox=e=>norm(e.action)!=='donated';
  function readyEntries(){return data.entries.filter(stillInBox).map(e=>({e,r:donationReadiness(e.po)}))}
  function renderReadyButton(){
    const count=readyEntries().filter(x=>x.r.status==='ready').length;
    $('readyDonateBtn').innerHTML=`✅ Ready to donate <span class="button-count">${count}</span>`;
  }
  async function saveAssemblyDate(po,date){
    const j=await request({action:'setAssemblyDate',po,date});
    data={...data,...j};render();
    toast(date?`Assembly date saved for PO ${po}.`:`Assembly date cleared for PO ${po}.`);
  }
  const assemblyForm=(po,current='')=>`<span class="asm-form"><input type="date" max="${localToday()}" value="${esc(current)}" data-asm-date="${esc(po)}" aria-label="Assembly date for PO ${esc(po)}"><button type="button" class="ghost" data-asm-save="${esc(po)}">Save</button></span>`;
  function wireAssemblyForms(root,after=()=>{}){
    root.querySelectorAll('[data-asm-save]').forEach(btn=>btn.onclick=async()=>{
      const po=btn.dataset.asmSave,input=[...root.querySelectorAll('[data-asm-date]')].find(i=>i.dataset.asmDate===po);
      if(!input?.value)return toast('Pick the assembly date first.',true);
      btn.disabled=true;
      try{await saveAssemblyDate(po,input.value);after()}catch(x){toast(x.message,true)}finally{btn.disabled=false}
    });
  }
  let openNeeds=false;
  function renderReadyDonations(){
    const rows=readyEntries(),ready=rows.filter(x=>x.r.status==='ready');
    const soon=rows.filter(x=>x.r.status==='waiting'&&x.r.left<=7).sort((a,b)=>cmp(a.r.readyOn,b.r.readyOn)||cmp(a.e.po,b.e.po));
    const needs=new Map();
    rows.filter(x=>x.r.status==='needs-assembly-date').forEach(x=>{const k=poKey(x.e.po);if(!needs.has(k))needs.set(k,{po:x.e.po,boxes:new Set(),units:0});const n=needs.get(k);n.boxes.add(container(x.e.containerId)?.code||x.e.containerCode||'No box');n.units+=Number(x.e.quantity||0)});
    const where=e=>{const c=container(e.containerId);return{loc:c?.currentLocation||e.location||'No location',code:c?.code||e.containerCode||'No box',id:c?.id||''}};
    const groups=new Map();
    ready.forEach(x=>{const w=where(x.e),k=`${w.loc}|${w.code}`;if(!groups.has(k))groups.set(k,{...w,items:[]});groups.get(k).items.push(x)});
    const ordered=[...groups.values()].sort((a,b)=>cmp(a.loc,b.loc)||cmp(a.code,b.code));
    const units=ready.reduce((n,x)=>n+Number(x.e.quantity||0),0);
    $('readyDialogSub').textContent=ready.length?`${ready.length} PO${ready.length===1?'':'s'} · ${units.toLocaleString()} units in ${ordered.length} box${ordered.length===1?'':'es'}`:'Nothing is ready to donate right now.';
    const since=x=>x.r.route==='Assembly'?`assembled ${shortDay(x.r.start)}`:`added ${shortDay(x.r.start)}`;
    let html=`<p class="ready-rule">Bulk and Bulk+Assembly: 30 days after being added to Overstock. Pack Builder: 30 days after assembly. POs that aren't in the workbook aren't listed.</p>`;
    html+=ordered.length?ordered.map(g=>`<section class="ready-group"><button type="button" class="ready-box" data-ready-box="${esc(g.id)}"><b>📍 ${esc(g.loc)}</b><span class="mono">${esc(g.code)}</span><span>${g.items.length} PO${g.items.length===1?'':'s'}</span></button>
      ${g.items.sort((a,b)=>cmp(a.e.po,b.e.po)).map(x=>`<button type="button" class="ready-row" data-ready-entry="${esc(x.e.id)}"><b>PO ${esc(x.e.po)}</b><span class="qty">${Number(x.e.quantity||0).toLocaleString()} units</span><span class="tag">${esc(routeLabel(x.r.route))}</span><small>${esc(since(x))} · ${x.r.days} days</small></button>`).join('')}</section>`).join('')
      :'<div class="empty">Nothing is ready to donate right now.</div>';
    if(soon.length)html+=`<details class="ready-more"><summary>Coming up in the next 7 days (${soon.length})</summary>`+soon.map(x=>{const w=where(x.e);return`<button type="button" class="ready-row soon" data-ready-entry="${esc(x.e.id)}"><b>PO ${esc(x.e.po)}</b><span class="tag">${esc(routeLabel(x.r.route))}</span><span>📍 ${esc(w.loc)} · <span class="mono">${esc(w.code)}</span></span><small>ready ${esc(shortDay(x.r.readyOn))}</small></button>`}).join('')+'</details>';
    if(needs.size){
      html+=`<details class="ready-more"${openNeeds?' open':''}><summary>Pack Builder POs with no assembly date (${needs.size})</summary><p class="ready-rule">These can be donated without a date. If you know when a PO was assembled, add it; it then becomes ready 30 days after that date.</p>`+
        [...needs.values()].sort((a,b)=>cmp(a.po,b.po)).map(n=>`<div class="ready-row needs"><b>PO ${esc(n.po)}</b><span class="qty">${n.units.toLocaleString()} units</span><span class="mono">${esc([...n.boxes].join(', '))}</span>${assemblyForm(n.po)}</div>`).join('')+'</details>';
    }
    const body=$('readyDialogBody');body.innerHTML=html;
    body.querySelectorAll('details.ready-more').forEach(d=>d.ontoggle=()=>{if(d.querySelector('.needs'))openNeeds=d.open});
    body.querySelectorAll('[data-ready-entry]').forEach(b=>b.onclick=()=>{close('readyDialog');openEntry(b.dataset.readyEntry)});
    body.querySelectorAll('[data-ready-box]').forEach(b=>b.onclick=()=>{if(!b.dataset.readyBox)return;close('readyDialog');openBox(b.dataset.readyBox)});
    wireAssemblyForms(body);
  }
  function openReadyDonations(){renderReadyDonations();if(!$('readyDialog').open)$('readyDialog').showModal()}

  function openDonationPool(prefill=''){
    const input=$('donationSearch');
    if(input)input.value=prefill||'';
    renderDonationPool();
    if(!$('donationDialog').open)$('donationDialog').showModal();
    if(prefill)setTimeout(()=>input?.select(),30);
  }

  // Search index, rebuilt only when the data changes (the page swaps in new
  // arrays whenever it reloads or saves). Typing then just compares prepared
  // lowercase text instead of re-looking-up boxes and re-formatting ~10k dates
  // on every keystroke. Labels are built only for the results shown.
  let searchIndex=null,searchIndexFor=[];
  function globalSearchIndex(){
    const sources=[data.entries,data.donations,data.containers,data.activities];
    if(searchIndex&&sources.every((list,i)=>list===searchIndexFor[i]))return searchIndex;
    const list=v=>Array.isArray(v)?v:[];
    const boxes=new Map(list(data.containers).map(c=>[String(c.id),c]));
    const byBox=new Map();
    list(data.entries).forEach(e=>{const k=String(e.containerId||'');if(!byBox.has(k))byBox.set(k,[]);byBox.get(k).push(e)});
    const index=[];
    const add=(rec,fields)=>{rec.fields=fields.filter(v=>v!==null&&v!==undefined&&v!=='').map(norm);index.push(rec)};

    list(data.entries).filter(e=>norm(e.action)!=='donated').forEach(e=>{
      const c=boxes.get(String(e.containerId));
      const loc=c?.currentLocation||e.location||'No location';
      const code=c?.code||e.containerCode||'No box';
      const original=e.originalAssociate||e.associate||'Unknown';
      const changed=norm(e.sourceType)==='excel-location-sync'?'Excel Sync':(e.lastChangedBy||original);
      const when=e.lastChangedAt||e.updatedAt||e.createdAt;
      add({kind:'entry',id:e.id,sort:time(e),title:`PO ${e.po||'—'}`,build:()=>({badge:'Current inventory',
        what:`${e.category||'Uncategorized'} · ${Number(e.quantity||0).toLocaleString()} units · ${e.action||'Required'}`,
        where:`${loc} · ${code}`,who:`Originally ${original} · Last changed by ${changed}`,when:fullFmt(when)})},
      [e.po,e.deliveryId,e.category,e.quantity,e.action,e.status,e.note,loc,code,original,changed,fmt(when),fullFmt(when)]);
    });

    list(data.donations).forEach(d=>{
      const original=d.originalAssociate||d.associate||'Unknown';
      const donor=d.donatedBy||d.lastChangedBy||original;
      const when=d.donatedAt||d.updatedAt||d.createdAt;
      add({kind:'donation',id:d.id,po:d.po||'',sort:Number(when||0),title:`PO ${d.po||'—'}`,build:()=>({badge:'Donation Pool',
        what:`${d.category||'Uncategorized'} · ${Number(d.quantity||0).toLocaleString()} units · Donated`,
        where:`Donation Pool · from ${d.containerCode||'Unknown box'}${d.location?` at ${d.location}`:''}`,
        who:`Originally ${original} · Donated by ${donor}`,when:fullFmt(when)})},
      [d.po,d.deliveryId,d.category,d.quantity,d.containerCode,d.location,d.note,original,donor,fmt(when),fullFmt(when),'donation','donated']);
    });

    list(data.containers).forEach(c=>{
      const its=byBox.get(String(c.id))||[],poText=its.map(e=>e.po).filter(Boolean).join(' ');
      const unitCount=its.reduce((n,e)=>n+Number(e.quantity||0),0);
      const actor=c.createdBy||'Not recorded',when=c.updatedAt||c.createdAt;
      add({kind:'box',id:c.id,sort:time(c),title:c.code||'Unnamed box',build:()=>({badge:'Container',
        what:`${c.status||'Open'} · ${its.length} PO${its.length===1?'':'s'} · ${unitCount.toLocaleString()} units`,
        where:c.currentLocation||'On cart / no assigned location',
        who:`Created by ${actor}${c.createdSource?` via ${c.createdSource}`:''}`,when:fullFmt(when)})},
      [c.code,c.currentLocation,c.status,c.notes,c.createdSource,c.createdBy,poText,fmt(when),fullFmt(when)]);
    });

    list(data.activities).forEach(a=>{
      const c=boxes.get(String(a.containerId));
      const loc=a.location||c?.currentLocation||'Location not recorded';
      const code=a.containerCode||c?.code||'';
      add({kind:'activity',id:a.id,entryId:a.entryId||'',containerId:a.containerId||'',activityType:a.type||'',po:a.po||'',
        sort:Number(a.createdAt||0),title:a.summary||'Overstock activity',build:()=>({badge:'Recent activity',
        what:a.po?`PO ${a.po}`:(code||'Overstock update'),where:`${loc}${code?` · ${code}`:''}`,
        who:a.actor||'Unknown',when:fullFmt(a.createdAt)})},
      [a.actor,a.summary,a.po,a.containerCode,a.location,loc,code,fmt(a.createdAt),fullFmt(a.createdAt),a.type]);
    });

    searchIndex=index;searchIndexFor=sources;
    return index;
  }

  function globalResultScore(nq,fields){
    let score=0;
    for(const n of fields){
      if(n===nq)return 100;
      if(score<70&&n.startsWith(nq))score=70;
      else if(score<40&&n.includes(nq))score=40;
    }
    return score;
  }

  function renderGlobalSearch(){
    const input=$('globalSearchInput'),results=$('globalSearchResults'),clear=$('globalSearchClear');
    if(!input||!results)return;
    const q=norm(input.value);
    if(clear)clear.hidden=!q;
    if(!q){results.hidden=true;results.innerHTML='';return}

    const matches=[];
    for(const rec of globalSearchIndex()){
      const score=globalResultScore(q,rec.fields);
      if(score)matches.push({rec,score});
    }
    matches.sort((a,b)=>b.score-a.score||b.rec.sort-a.rec.sort||cmp(a.rec.title,b.rec.title));
    const rows=matches;
    const visible=rows.slice(0,40).map(m=>({...m.rec,...m.rec.build(),score:m.score}));
    results.hidden=false;
    results.innerHTML=`
      <div class="overstock-search-summary"><b>${rows.length}</b> match${rows.length===1?'':'es'} for “${esc(input.value.trim())}”${rows.length>visible.length?` · showing first ${visible.length}`:''}</div>
      <div class="overstock-search-list">${visible.length?visible.map(r=>`
        <button class="overstock-search-result" type="button"
          data-global-kind="${esc(r.kind)}" data-global-id="${esc(r.id||'')}"
          data-global-entry="${esc(r.entryId||'')}" data-global-container="${esc(r.containerId||'')}"
          data-global-activity="${esc(r.activityType||'')}" data-global-po="${esc(r.po||'')}">
          <div class="overstock-search-result-head"><b>${esc(r.title)}</b><span>${esc(r.badge)}</span></div>
          <div><strong>What:</strong> ${esc(r.what)}</div>
          <div><strong>Where:</strong> ${esc(r.where)}</div>
          <div><strong>Who:</strong> ${esc(r.who)}</div>
          <div><strong>When:</strong> ${esc(r.when)}</div>
        </button>`).join(''):'<div class="empty">No Overstock records match that search.</div>'}</div>`;
    results.querySelectorAll('[data-global-kind]').forEach(btn=>btn.onclick=()=>{
      const kind=btn.dataset.globalKind,id=btn.dataset.globalId;
      if(kind==='entry'){openEntry(id);return}
      if(kind==='box'){openBox(id);return}
      if(kind==='donation'){openDonationPool(btn.dataset.globalPo||'');return}
      if(kind==='activity'){
        if(btn.dataset.globalActivity==='donation'){openDonationPool(btn.dataset.globalPo||'');return}
        const entry=data.entries.find(e=>String(e.id)===String(btn.dataset.globalEntry)&&norm(e.action)!=='donated');
        if(entry){openEntry(entry.id,entry.containerId||btn.dataset.globalContainer||'');return}
        if(btn.dataset.globalContainer&&container(btn.dataset.globalContainer))openBox(btn.dataset.globalContainer);
      }
    });
  }

  function render(){lists();syncPill();renderDonationPoolButton();renderReadyButton();if($('readyDialog').open)renderReadyDonations();const stats=renderStats();renderCart(stats);renderLocations(stats);renderBoxes(stats);renderLog();renderActivityFeed();renderGlobalSearch()
    // Prepare the search text in the background so the first keystroke is fast.
    ;(window.requestIdleCallback||(f=>setTimeout(f,300)))(()=>globalSearchIndex());
  }
  async function openBoxHistory(reference=''){
    await loadHubSession();
    if(!requireHubUser())return;
    const dialog=$('boxHistoryDialog');
    const box=container(reference)||data.containers.find(c=>norm(c.code)===norm(reference));
    $('boxHistoryCode').value=box?.code||reference||'';
    $('boxHistoryTitle').textContent=box?.code?`${box.code} · Box History`:'Box History';
    $('boxHistorySubtitle').textContent='Creation source, PO movements, changes and the people or processes responsible.';
    $('boxHistoryBody').innerHTML=reference?'<div class="box-history-empty">Loading history…</div>':'<div class="box-history-empty">Enter a box code to view its history, including retired boxes.</div>';
    if($('boxDialog').open)$('boxDialog').close();
    if(!dialog.open)dialog.showModal();
    if(reference)await loadBoxHistory(box?.id||reference);
  }

  function historyDetail(detail){
    if(!detail||typeof detail!=='object')return'';
    const labels={po:'PO',from:'From',to:'To',prepBy:'Prep By',quantity:'Quantity',previousQuantity:'Previous quantity',location:'Location',reason:'Reason',notes:'Notes',summary:'Details',deliveryId:'Delivery ID'};
    return Object.entries(detail).filter(([k,v])=>labels[k]&&v!==null&&v!==undefined&&String(v).trim())
      .map(([k,v])=>`<span><b>${esc(labels[k])}:</b> ${esc(v)}</span>`).join(' · ');
  }

  async function loadBoxHistory(reference){
    const body=$('boxHistoryBody');
    body.innerHTML='<div class="box-history-empty">Loading history…</div>';
    try{
      const res=await fetch(`${API}?${new URLSearchParams({boxHistory:reference})}`,{cache:'no-store',credentials:'same-origin'});
      const result=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(result.error||'Could not retrieve box history.');
      const box=result.box||{},events=Array.isArray(result.events)?result.events:[];
      $('boxHistoryTitle').textContent=`${box.code||reference} · Box History`;
      $('boxHistoryCode').value=box.code||reference;
      body.innerHTML=`
        <section class="box-history-summary">
          <strong>${esc(box.code||reference)}</strong> · ${esc(box.status||'Unknown status')}
          ${box.location?` · 📍 ${esc(box.location)}`:''}
          ${box.poCount!==undefined?` · ${esc(box.poCount)} PO(s)`:''}
          <small>Originally created by: ${esc(box.createdBy||'Not recorded')} · Source: ${esc(box.createdSource||'Unknown')}
          ${box.createdAt?` · ${esc(new Date(box.createdAt).toLocaleString())}`:''}</small>
          ${box.notes?`<small>Notes: ${esc(box.notes)}</small>`:''}
        </section>
        ${events.length?`<div class="box-history-timeline">${events.map(event=>`
          <article class="box-history-event">
            <strong>${esc(String(event.type||'changed').replace(/-/g,' ').replace(/\b\w/g,c=>c.toUpperCase()))}</strong>
            <span class="box-history-source">${esc(event.source||'Not recorded')}</span>
            <div class="box-history-event-meta">${esc(event.at?new Date(event.at).toLocaleString():'Date unavailable')} · ${esc(event.actor||'Not recorded')}</div>
            ${historyDetail(event.detail)?`<div class="box-history-event-detail">${historyDetail(event.detail)}</div>`:''}
          </article>`).join('')}</div>`
          :'<div class="box-history-empty">No detailed events survived for this box. Historical tracking starts with this update.</div>'}
      `;
    }catch(error){
      body.innerHTML=`<div class="box-history-empty">${esc(error.message||'Unable to retrieve box history.')}</div>`;
    }
  }

  function openBox(id){
    const c=container(id);
    if(!c)return;
    const its=items(id),closed=status(c)==='closed';
    $('boxDialogTitle').textContent=c.code||'Box';
    $('boxDialogSub').textContent=`${c.currentLocation||'On cart'} · ${its.length} PO(s) · ${units(id)} units`;
    $('boxDialogBody').innerHTML=`
      <div class="box-summary"><b>${esc(c.code)}</b> is ${esc(c.status||'Open')} at
        <b>${esc(c.currentLocation||'no assigned location')}</b>.
        ${c.createdSource?`<br><small>Created via ${esc(c.createdSource)}${c.createdBy?` · ${esc(c.createdBy)}`:''}</small>`:''}
      </div>
      <div class="action-grid">
        ${closed?'<button class="action-btn" data-act="reopen">↻ Reopen box</button>':'<button class="action-btn" data-act="add">➕ Add a PO</button>'}
        <button class="action-btn" data-act="history">📜 Box history</button>
        <button class="action-btn" data-act="audit">🔍 Audit contents</button>
        ${closed?'':'<button class="action-btn" data-act="move">↗ Move location</button>'}
        <button class="action-btn" data-act="edit">✏️ Edit box</button>
        ${its.length===0?'<button class="action-btn" data-act="delete">🗑 Delete empty box</button>':''}
      </div>`;
    $('boxDialog').showModal();
    $('boxDialogBody').querySelector('[data-act="add"]')?.addEventListener('click',()=>{close('boxDialog');newEntry(id)});
    $('boxDialogBody').querySelector('[data-act="history"]').onclick=()=>openBoxHistory(id);
    $('boxDialogBody').querySelector('[data-act="audit"]').onclick=()=>auditBox(id);
    $('boxDialogBody').querySelector('[data-act="move"]')?.addEventListener('click',()=>editContainer(id,true));
    $('boxDialogBody').querySelector('[data-act="edit"]').onclick=()=>editContainer(id);
    $('boxDialogBody').querySelector('[data-act="delete"]')?.addEventListener('click',()=>deleteContainer(id));
    $('boxDialogBody').querySelector('[data-act="reopen"]')?.addEventListener('click',async()=>{
      if(!requireHubUser())return;
      try{
        const j=await request({action:'upsertContainer',container:{...c,status:c.currentLocation?'Stored':'Open',retainEmpty:true}});
        data={...data,...j};
        close('boxDialog');
        render();
        openBox(id);
        toast('Box reopened. It will not be automatically retired while marked for reuse.');
      }catch(error){toast(error.message,true)}
    });
  }
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
  // Known route: show the 30-day rule and its result (early donation needs a
  // lead or admin). No route: the original five-point checklist.
  function confirmDonationEligibility({po='',quantity=0,containerCode=''}={}){
    const dlg=$('donationEligibilityDialog'),confirmBtn=$('donationEligibilityConfirm'),cancelBtn=$('donationEligibilityCancel'),closeBtn=$('donationEligibilityClose'),summary=$('donationEligibilityItem');
    const checks=[...dlg.querySelectorAll('[data-donation-check]')],rule=$('eligibilityRule');
    let manual=true;
    checks.forEach(c=>{c.checked=false});
    summary.textContent=`PO ${po||'—'} · ${Number(quantity||0).toLocaleString()} units${containerCode?` · ${containerCode}`:''}`;
    const paint=()=>{
      const r=donationReadiness(po),lead=isLead();
      manual=r.status==='no-route';
      $('eligibilityManual').hidden=!manual;rule.hidden=manual;
      if(manual){confirmBtn.textContent='Confirm Donation';confirmBtn.disabled=!checks.every(c=>c.checked);return}
      // No assembly date: still donatable; adding the date is optional.
      const packBuilder=r.route==='Assembly',ok=r.status==='ready'||r.status==='needs-assembly-date';
      const dateLine=packBuilder
        ?(r.start?`Assembled <b>${esc(shortDay(r.start))}</b> · ${r.days} day${r.days===1?'':'s'} ago`:'No assembly date entered yet')
        :`First added to Overstock <b>${esc(shortDay(r.start))}</b> · ${r.days} day${r.days===1?'':'s'} ago`;
      const verdict=r.status==='ready'?`<div class="rule-verdict ok">✓ Ready to donate. ${r.wait} days have passed (ready since ${esc(shortDay(r.readyOn))}).</div>`
        :r.status==='waiting'?`<div class="rule-verdict wait">Not ready until <b>${esc(shortDay(r.readyOn))}</b> (${r.left} day${r.left===1?'':'s'} left).</div>`
        :`<div class="rule-verdict ok">No assembly date yet. You can add it above if you know it, or donate without it.</div>`;
      rule.innerHTML=`<div class="rule-line">Route <span class="tag">${esc(routeLabel(r.route))}</span> <small>from the workbook</small></div>
        <div class="rule-line">${dateLine}</div>
        ${packBuilder?`<div class="rule-line">${r.start?'Change':'Add'} assembly date ${assemblyForm(po,r.start||'')}</div>`:''}
        ${verdict}
        ${ok?'':`<p class="rule-note">${lead?'You are a lead or admin, so you can donate it early if needed.':'Ask a lead or admin if this needs to be donated early.'}</p>`}`;
      wireAssemblyForms(rule,paint);
      confirmBtn.textContent=ok?'Confirm Donation':lead?'Donate early':'Not ready yet';
      confirmBtn.disabled=!(ok||lead);
    };
    paint();
    return new Promise(resolve=>{
      let finished=false;
      const cleanup=()=>{checks.forEach(c=>c.removeEventListener('change',update));confirmBtn.removeEventListener('click',yes);cancelBtn.removeEventListener('click',no);closeBtn.removeEventListener('click',no);dlg.removeEventListener('cancel',cancelEvent)};
      const finish=value=>{if(finished)return;finished=true;cleanup();if(dlg.open)dlg.close();resolve(value)};
      const update=()=>{if(manual)confirmBtn.disabled=!checks.every(c=>c.checked)};
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
  $('siContainerForm').onsubmit=ev=>{
    ev.preventDefault();
    const actor=requireHubUser();
    if(!actor)return;
    const code=$('siContainerCode').value.trim().toUpperCase(),loc=$('siContainerLocation').value;
    if(!code)return toast('Enter a box code.',true);
    let c=data.containers.find(x=>norm(x.code)===norm(code));
    if(!c&&!loc)return toast('Choose a location for the new box.',true);
    // This is only a draft. The backend creates the box and its first PO
    // together in one transaction when the first item is actually submitted.
    if(!c)c={id:'',code,currentLocation:loc,status:'Stored',pending:true};
    intake.container=c;
    if(c.id)intake.touched.add(String(c.id));
    intakeStats();
    $('siActiveContainer').textContent=`${c.code} · ${c.currentLocation||'On cart'} · Hub user: ${actor}${c.pending?' · Not saved until first PO':''}`;
    $('siContainerStep').hidden=true;
    $('siItemStep').hidden=false;
    setTimeout(()=>$('siPo').focus(),20);
  };
  $('siItemForm').onsubmit=async ev=>{
    ev.preventDefault();
    const form=ev.currentTarget;
    if(form.dataset.saving==='1')return;
    const c=intake.container,po=$('siPo').value.trim(),qty=Number($('siQty').value||0),
      donateNow=ev.submitter?.dataset.intent==='donate';
    if(!c||!po||!Number.isSafeInteger(qty)||qty<1)return toast('Enter a PO and a valid quantity.',true);
    form.dataset.saving='1';
    try{
      if(donateNow){
        const eligible=await confirmDonationEligibility({po,quantity:qty,containerCode:c.code});
        if(!eligible)return;
      }
      const actor=requireHubUser();
      if(!actor)return;
      const entry={
        po,deliveryId:$('siDeliveryId').value.trim(),quantity:qty,
        category:$('siCategory').value.trim(),status:'Not Donation',
        action:$('siAction').value,note:$('siNote').value.trim(),
        date:new Date().toISOString().slice(0,10),sourceType:'stock-intake',
      };
      const j=await request({action:'intakeAddEntry',container:{code:c.code,currentLocation:c.currentLocation},entry,donateNow});
      data={...data,...j};
      const saved=data.entries.find(e=>String(e.id)===String(j.savedEntryId))||entry;
      const resolved=data.containers.find(box=>String(box.id)===String(j.savedContainerId));
      if(resolved){
        intake.container=resolved;
        intake.touched.add(String(resolved.id));
        $('siActiveContainer').textContent=`${resolved.code} · ${resolved.currentLocation||'On cart'} · Hub user: ${actor}`;
      }
      intake.items.push({...saved,containerCode:c.code});
      intakeStats();
      ['siPo','siDeliveryId','siQty','siCategory','siNote'].forEach(id=>$(id).value='');
      setTimeout(()=>$('siPo').focus(),20);
      toast(donateNow?`PO ${po} moved to the Donation Pool.`:`PO ${po} added to ${c.code}.`);
    }catch(error){toast(error.message,true)}
    finally{delete form.dataset.saving}
  };
  $('siSwitchContainer').onclick=()=>{intake.container=null;$('siItemStep').hidden=true;$('siContainerStep').hidden=false;$('siContainerCode').value='';$('siExistingContainer').hidden=true};$('stockIntakeBtn').onclick=()=>openIntake();$('stockIntakeCancel').onclick=()=>{if(!intake.items.length||confirm('Cancel? Saved items will remain in Houston.'))closeIntake()};$('stockIntakeComplete').onclick=()=>{toast(`Stock Intake complete · ${intake.items.length} item(s) added.`);closeIntake()};
  $('activityFeedHide').onclick=()=>setActivityHidden(true);$('activityFeedShow').onclick=()=>setActivityHidden(false);$('refreshBtn').onclick=()=>load(true);$('donationPoolBtn').onclick=()=>openDonationPool();$('readyDonateBtn').onclick=()=>openReadyDonations();
  // Wait for a short pause in typing before searching.
  let globalSearchTimer=0;
  $('globalSearchInput').oninput=()=>{clearTimeout(globalSearchTimer);globalSearchTimer=setTimeout(renderGlobalSearch,150)};
  $('globalSearchClear').onclick=()=>{$('globalSearchInput').value='';renderGlobalSearch();$('globalSearchInput').focus()};
  $('donationSearch').oninput=renderDonationPool;
  $('donationSearchClear').onclick=()=>{$('donationSearch').value='';renderDonationPool();$('donationSearch').focus()};
  $('boxHistoryBtn').onclick=()=>openBoxHistory();
  $('retireEmptyExcelBtn').onclick=async()=>{
    await loadHubSession();
    if(!requireHubUser())return;
    if(!['manager','team lead'].includes(String(hubSession?.role||'').toLowerCase()))
      return toast('Admin or Team Lead access is required.',true);
    if(!confirm('Retire empty Excel-created boxes? They will be marked CLOSED, not deleted. Manually created boxes and boxes holding POs are left alone. Physically review any box before reusing it.'))return;
    const btn=$('retireEmptyExcelBtn');
    btn.disabled=true;
    try{
      const j=await request({action:'reconcileEmptyExcelBoxes'});
      data={...data,...j};
      boxView='retired';
      render();
      toast(`${Number(j.retiredEmptyExcelBoxes||0)} empty Excel-generated boxes retired. Review them in the Retired view.`);
    }catch(error){toast(error.message||'Could not reconcile boxes.',true)}
    finally{btn.disabled=false}
  };
  $('boxHistorySearchForm').onsubmit=e=>{
    e.preventDefault();
    const code=$('boxHistoryCode').value.trim().toUpperCase();
    if(code)loadBoxHistory(code);
  };$('newBoxBtn').onclick=()=>editContainer();$('boxSearch').oninput=()=>renderBoxes(renderStats());$('boxSort').onchange=()=>renderBoxes(renderStats());document.querySelectorAll('[data-box-view]').forEach(btn=>btn.onclick=()=>{boxView=['active','empty','retired'].includes(btn.dataset.boxView)?btn.dataset.boxView:'active';renderBoxes(renderStats())});$('logSearch').oninput=()=>{logLimit=50;renderLog()};$('logSort').onchange=()=>{logLimit=50;renderLog()};$('showMoreBtn').onclick=()=>{logLimit+=50;renderLog()};$('editBackBtn').onclick=returnToBoxList;$('editCloseBtn').onclick=closeEdit;document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>close(b.dataset.close));
  load().then?.(()=>{lastActivityId=data.activities?.[0]?.id||'';renderActivityFeed()});setInterval(()=>{if(!document.hidden)pollActivityFeed()},5000);setInterval(()=>{if(!document.hidden&&!document.querySelector('dialog[open]')&&!document.activeElement?.matches('input,select,textarea')&&$('stockIntakeOverlay').hidden)load()},60000);
})();
