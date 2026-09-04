// Build refresh after manager key change.
(() => {
  const API = '/.netlify/functions/hub-feed';
  const FAIRSHIFT = 'https://fairshift-rotations.thandoyordani.chatgpt.site';
  const $ = (id) => document.getElementById(id);
  const todayDot=$('todayDot'), weekDot=$('weekDot'), todayView=$('todayView'), weekView=$('weekView');
  const sectionEyebrow=$('sectionEyebrow'), sectionTitle=$('sectionTitle'), sectionNote=$('sectionNote');
  let feed={announcements:[],policies:[],cleaning:[]};
  let managerKey='';
  let adminData=null;
  let checkinTarget=null;

  const escapeHtml=(v)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c]));
  const ymd=(d)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const parseDate=(s)=>{ const [y,m,d]=String(s).split('-').map(Number); return new Date(y,m-1,d,12,0,0); };
  const fmtDay=(s)=>parseDate(s).toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'});
  const statusLabel=(s)=>({scheduled:'Scheduled',in_progress:'In progress',completed:'Completed',missed:'Missed',reported_not_done:'Not completed'}[s]||s||'Scheduled');
  const today=()=>ymd(new Date());

  function weekDates(){ const now=new Date(); const dow=now.getDay(); const delta=dow===0?-6:1-dow; const mon=new Date(now); mon.setDate(now.getDate()+delta); mon.setHours(12,0,0,0); return Array.from({length:5},(_,i)=>{const d=new Date(mon);d.setDate(mon.getDate()+i);return ymd(d)}); }
  function activeAnnouncements(date){ return feed.announcements.filter(a=>a.startDate<=date && (!a.endDate || a.endDate>=date)); }
  function policiesForDate(date){ return feed.policies.filter(p=>p.effectiveDate===date); }
  function currentPolicies(){ const t=today(); return feed.policies.filter(p=>p.effectiveDate<=t).slice(0,4); }

  function setView(view){ const isToday=view==='today'; todayDot.classList.toggle('active',isToday);weekDot.classList.toggle('active',!isToday);todayDot.setAttribute('aria-selected',String(isToday));weekDot.setAttribute('aria-selected',String(!isToday));todayView.classList.toggle('active',isToday);weekView.classList.toggle('active',!isToday);sectionEyebrow.textContent=isToday?'Today at a glance':'Week at a glance';sectionTitle.textContent=isToday?'What the team needs to know':'What’s happening this week';sectionNote.textContent=isToday?'Cleaning responsibilities, announcements, and policy updates in one place.':'A Monday–Friday view of cleaning, announcements, reminders, and policy changes.'; }
  todayDot.addEventListener('click',()=>setView('today'));weekDot.addEventListener('click',()=>setView('week'));

  function actionForCleaning(r){
    if(r.status==='completed') return `<span class="checkin">${Number(r.creditMinutes||15)} min ✓</span>`;
    if(!['scheduled','in_progress'].includes(r.status)) return '';
    const label=r.status==='scheduled'?'Start':'Finish';
    if(r.source==='fairshift'){
      const href=r.checkinUrl || `${FAIRSHIFT}/checkin?assignment=${encodeURIComponent(r.fairshiftId||'')}`;
      return `<a class="checkin" href="${escapeHtml(href)}">${label}</a>`;
    }
    return `<button class="checkin" type="button" data-checkin="${escapeHtml(r.id)}" data-date="${escapeHtml(r.date)}" data-name="${escapeHtml(r.employeeName)}" data-status="${escapeHtml(r.status)}">${label}</button>`;
  }

  function renderToday(){
    const t=today(); const rows=feed.cleaning.filter(r=>r.date===t); const box=$('todayCleaning');
    box.innerHTML=rows.length?rows.map(r=>`<div class="cleaning-row"><div class="area">${escapeHtml(r.area)}</div><div class="person">${escapeHtml(r.employeeName)}</div><span class="status ${escapeHtml(r.status)}">${escapeHtml(statusLabel(r.status))}</span>${actionForCleaning(r)}</div>`).join(''):`<div class="empty">${feed.cleaningSource==='fairshift'?'No cleaning assignments are scheduled in FairShift for today.':'FairShift could not be reached, and no manual fallback assignments are available.'}</div>`;
    box.querySelectorAll('[data-checkin]').forEach(btn=>btn.addEventListener('click',()=>openCheckin(btn.dataset)));
    const sourceLabel=$('cleaningSourceLabel'); if(sourceLabel) sourceLabel.textContent=feed.cleaningSource==='fairshift'?'Live from FairShift · 15 min credit':'FairShift connection unavailable · fallback view';

    const anns=activeAnnouncements(t).sort((a,b)=>Number(b.pinned)-Number(a.pinned)); $('announcementCount').textContent=`${anns.length} active`; $('todayAnnouncements').innerHTML=anns.length?anns.map(a=>`<div class="notice"><div class="notice-meta">${a.pinned?'Pinned • ':''}${escapeHtml(a.department||'All teams')}</div><h4>${escapeHtml(a.title)}</h4><p>${escapeHtml(a.message)}</p></div>`).join(''):`<div class="empty">No active announcements.</div>`;
    const pol=currentPolicies(); $('policyCount').textContent=`${pol.length} current`; $('todayPolicies').innerHTML=pol.length?pol.map(p=>`<div class="policy-row"><div><div class="policy-title">${escapeHtml(p.title)}</div><div class="policy-meta">Effective ${escapeHtml(fmtDay(p.effectiveDate))} • ${escapeHtml(p.summary)}</div></div>${p.readRequired?'<div class="ack">Read required</div>':''}</div>`).join(''):`<div class="empty">No policy updates have been published.</div>`;
  }

  function renderWeek(){ const dates=weekDates(); const todayIso=today(); $('weekTitle').textContent=`Week of ${fmtDay(dates[0])} – ${fmtDay(dates[4])}`; $('weekCalendar').innerHTML=dates.map(date=>{ const clean=feed.cleaning.filter(r=>r.date===date); const ann=activeAnnouncements(date).filter(a=>a.startDate===date || a.pinned); const pol=policiesForDate(date); const events=[]; clean.forEach((r,i)=>events.push(`<div class="week-event"><div class="event-label">${i===0?'Cleaning':''}</div><div class="event-title">${escapeHtml(r.area)}</div><div class="event-meta">${escapeHtml(r.employeeName)} • ${escapeHtml(statusLabel(r.status))}</div></div>`)); ann.slice(0,3).forEach(a=>events.push(`<div class="week-event"><div class="event-label">Announcement</div><div class="event-title">${escapeHtml(a.title)}</div><div class="event-meta">${escapeHtml(a.department||'All teams')}</div></div>`)); pol.forEach(p=>events.push(`<div class="week-event"><div class="event-label">Policy</div><div class="event-title">${escapeHtml(p.title)}</div><div class="event-meta">${p.readRequired?'Read required':'Effective'}</div></div>`)); if(!events.length)events.push('<div class="event-meta">Nothing published.</div>'); return `<article class="day-column ${date===todayIso?'today-day':''}"><div class="day-head"><div class="day-name">${date===todayIso?'Today • ':''}${parseDate(date).toLocaleDateString(undefined,{weekday:'long'})}</div><div class="day-date">${parseDate(date).toLocaleDateString(undefined,{month:'short',day:'numeric'})}</div></div><div class="day-body">${events.join('')}</div></article>`; }).join(''); }
  function render(){renderToday();renderWeek();}

  async function loadFeed(){ try{ const r=await fetch(API,{cache:'no-store'}); if(!r.ok)throw new Error('Hub data unavailable.'); feed=await r.json(); render(); }catch(e){ $('todayCleaning').innerHTML=`<div class="empty">${escapeHtml(e.message||'Hub data is unavailable.')}</div>`; $('todayAnnouncements').innerHTML='<div class="empty">Unable to load announcements.</div>'; $('todayPolicies').innerHTML='<div class="empty">Unable to load policy updates.</div>'; renderWeek(); } }

  function showMessage(id,text,error=false){ const el=$(id);if(!el)return;el.textContent=text;el.classList.toggle('error',error);el.style.display='block'; }
  function openCheckin(data){ checkinTarget={assignmentId:data.checkin,date:data.date,employeeName:data.name,status:data.status}; $('checkinName').value=data.name||'';$('checkinPin').value='';$('checkinAssignment').textContent=`${data.name} • ${data.status==='scheduled'?'Start':'Finish'} today’s cleaning assignment`;$('checkinSubmit').textContent=data.status==='scheduled'?'Start cleaning':'Finish cleaning';$('checkinMessage').style.display='none';$('checkinDialog').showModal();$('checkinPin').focus(); }
  $('checkinSubmit').addEventListener('click',async()=>{ if(!checkinTarget)return; const action=checkinTarget.status==='scheduled'?'start':'finish'; const body={action:'cleaningAction',cleaningAction:action,assignmentId:checkinTarget.assignmentId,date:checkinTarget.date,employeeName:$('checkinName').value.trim(),pin:$('checkinPin').value.trim(),}; try{ const r=await fetch(API,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const j=await r.json();if(!r.ok)throw new Error(j.error||'Check-in failed.');showMessage('checkinMessage',action==='start'?'Cleaning started. Your status is now In progress.':'Cleaning completed. 15 minutes of credit were awarded.');await loadFeed();checkinTarget.status=j.result.status;$('checkinSubmit').disabled=true;setTimeout(()=>{$('checkinDialog').close();$('checkinSubmit').disabled=false;},900);}catch(e){showMessage('checkinMessage',e.message||'Check-in failed.',true);} });

  document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>$(b.dataset.close)?.close()));

  async function adminFetch(body=null){ const opts={headers:{'x-hub-key':managerKey}}; let url=`${API}?admin=1`; if(body){url=API;opts.method='POST';opts.headers['content-type']='application/json';opts.body=JSON.stringify(body);} const r=await fetch(url,opts);const j=await r.json();if(!r.ok)throw new Error(j.error||'Manager request failed.');return j; }
  async function openManager(){ const key=window.prompt('Manager access key'); if(!key)return; managerKey=key.trim(); try{adminData=await adminFetch();renderAdmin();$('managerMessage').style.display='none';$('managerDialog').showModal();}catch(e){managerKey='';window.alert(e.message||'Manager access denied.');} }
  $('manageBtn').addEventListener('click',openManager);
  function setDefaultDates(){ const t=today(); const af=document.querySelector('#announcementForm [name=startDate]'); const pf=document.querySelector('#policyForm [name=effectiveDate]'); if(af)af.value=t;if(pf)pf.value=t; }
  function renderAdmin(){ if(!adminData)return; $('announcementAdminList').innerHTML=adminData.announcements.length?adminData.announcements.map(a=>`<div class="admin-row"><div><strong>${escapeHtml(a.title)}</strong><small>${escapeHtml(a.startDate)}${a.endDate?' → '+escapeHtml(a.endDate):''}</small></div><button class="mini-delete" data-del-ann="${escapeHtml(a.id)}">Delete</button></div>`).join(''):'<div class="policy-meta">None posted.</div>'; $('policyAdminList').innerHTML=adminData.policies.length?adminData.policies.map(p=>`<div class="admin-row"><div><strong>${escapeHtml(p.title)}</strong><small>Effective ${escapeHtml(p.effectiveDate)}</small></div><button class="mini-delete" data-del-pol="${escapeHtml(p.id)}">Delete</button></div>`).join(''):'<div class="policy-meta">None posted.</div>'; bindAdminDeletes(); setDefaultDates(); }
  function bindAdminDeletes(){ document.querySelectorAll('[data-del-ann]').forEach(b=>b.onclick=()=>deleteAdmin({action:'deleteAnnouncement',id:b.dataset.delAnn}));document.querySelectorAll('[data-del-pol]').forEach(b=>b.onclick=()=>deleteAdmin({action:'deletePolicy',id:b.dataset.delPol})); }
  async function deleteAdmin(body){ if(!confirm('Delete this item?'))return; try{await adminFetch(body);await refreshAdmin('Deleted.');}catch(e){showMessage('managerMessage',e.message||'Delete failed.',true);} }
  async function refreshAdmin(msg){adminData=await adminFetch();renderAdmin();await loadFeed();if(msg)showMessage('managerMessage',msg);}
  function formObject(form){const fd=new FormData(form);const out={};fd.forEach((v,k)=>out[k]=v);form.querySelectorAll('input[type=checkbox]').forEach(i=>out[i.name]=i.checked);return out;}
  $('announcementForm').addEventListener('submit',async(e)=>{
    e.preventDefault();
    const form=e.currentTarget;
    const payload=formObject(form);
    try{
      await adminFetch({action:'upsertAnnouncement',...payload});
      form.reset();
      await refreshAdmin('Announcement posted.');
    }catch(err){showMessage('managerMessage',err.message||'Could not post announcement.',true);}
  });
  $('policyForm').addEventListener('submit',async(e)=>{
    e.preventDefault();
    const form=e.currentTarget;
    const payload=formObject(form);
    try{
      await adminFetch({action:'upsertPolicy',...payload});
      form.reset();
      await refreshAdmin('Policy update published.');
    }catch(err){showMessage('managerMessage',err.message||'Could not publish policy.',true);}
  });

  setDefaultDates(); loadFeed();
})();