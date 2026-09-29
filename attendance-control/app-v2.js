(() => {
  const API='/api/attendance-control-v2';
  const SESSION_API='/.netlify/functions/hub-auth?action=session';
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const state={session:null,snapshot:null,date:'',department:'',draft:new Map(),dirty:false,personKey:'',personHistory:null};
  let toastTimer;

  function toast(message,error=false){
    const el=$('toast');el.textContent=message;el.className='toast show'+(error?' error':'');
    clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.className='toast',3200);
  }
  function easternToday(){
    const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
    const m=Object.fromEntries(parts.map(p=>[p.type,p.value]));return `${m.year}-${m.month}-${m.day}`;
  }
  function shiftDate(date,delta){const d=new Date(date+'T12:00:00');d.setDate(d.getDate()+delta);return d.toISOString().slice(0,10)}
  function formatDate(date){try{return new Date(date+'T12:00:00').toLocaleDateString([],{weekday:'long',month:'long',day:'numeric',year:'numeric'})}catch{return date}}
  function people(){return Array.isArray(state.snapshot?.people)?state.snapshot.people:[]}
  function activePeople(){return people().filter(p=>p.active!==false)}
  function departmentRows(){return Array.isArray(state.snapshot?.departments)?state.snapshot.departments:[]}
  function departmentNames(){
    const out=departmentRows().filter(d=>d.active!==false).map(d=>d.name);
    for(const p of activePeople())if(p.currentDepartment&&!out.includes(p.currentDepartment))out.push(p.currentDepartment);
    return out;
  }
  function deptPeople(dept=state.department){return activePeople().filter(p=>String(p.currentDepartment||'Unassigned')===String(dept)).sort((a,b)=>String(a.name).localeCompare(String(b.name)))}
  function settings(){return state.snapshot?.settings||{statuses:[],thresholds:[]}}
  function statusById(id){return settings().statuses.find(s=>s.id===id)||null}
  function savedRecord(key){return (state.snapshot?.dayRecords||[]).find(r=>(r.personKey||r.employeeKey)===key)||null}
  function totalFor(key){return Number((state.snapshot?.totals||[]).find(t=>(t.personKey||t.employeeKey)===key)?.totalPoints||0)}
  function draftFor(person){
    const key=person.personKey;
    if(!state.draft.has(key)){const saved=savedRecord(key);state.draft.set(key,{statusId:saved?.statusId||'',note:saved?.note||'',originalPoints:Number(saved?.points||0)})}
    return state.draft.get(key);
  }
  function projectedPoints(person){
    const d=draftFor(person),s=statusById(d.statusId);
    return Math.max(0,Math.round((totalFor(person.personKey)-Number(d.originalPoints||0)+Number(s?.points||0))*100)/100);
  }
  function thresholdState(points){
    const rows=[...(settings().thresholds||[])].sort((a,b)=>Number(a.points)-Number(b.points));
    return{met:rows.filter(t=>points>=Number(t.points)).pop()||null,next:rows.find(t=>points<Number(t.points))||null};
  }
  function pointsClass(points){
    const rows=[...(settings().thresholds||[])].sort((a,b)=>Number(a.points)-Number(b.points));
    if(!rows.length)return'';if(points>=Number(rows[1]?.points??rows[0].points))return' alert';if(points>=Math.max(0,Number(rows[0].points)-1))return' watch';return'';
  }
  function initials(name){return String(name||'?').split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]?.toUpperCase()).join('')||'?'}
  async function fetchJson(url,options={}){
    const r=await fetch(url,{cache:'no-store',credentials:'same-origin',...options});const j=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(j.error||`Request failed (${r.status})`);return j;
  }
  async function loadSession(){
    try{state.session=await fetchJson(SESSION_API)}catch{
      window.location.replace('/warehouse-hub/');
      return false;
    }
    if(!state.session?.signedIn){
      window.location.replace('/warehouse-hub/');
      return false;
    }
    const ok=String(state.session.role||'').toLowerCase()==='manager';
    $('managerPill').textContent=ok?`👤 ${state.session.name} · Manager`:'Access restricted';
    $('accessGate').hidden=ok;
    $('app').hidden=!ok;
    document.body.classList.remove('auth-pending');
    return ok;
  }
  async function loadAll(showToast=false){
    if(!await loadSession())return;$('refreshBtn').disabled=true;
    try{
      state.snapshot=await fetchJson(`${API}?date=${encodeURIComponent(state.date)}`);state.draft=new Map();state.dirty=false;
      const ds=departmentNames(),saved=localStorage.getItem('attendance-control-dept')||'';
      if(!state.department||!ds.includes(state.department))state.department=ds.includes(saved)?saved:(ds.find(d=>d!=='Unassigned')||ds[0]||'Unassigned');
      renderAll();if(showToast)toast('Attendance refreshed.');
    }catch(e){toast(e.message,true)}finally{$('refreshBtn').disabled=false}
  }

  function renderAll(){renderTabs();renderToday();renderPeople();renderSettings()}
  function renderTabs(){
    document.querySelectorAll('.tab').forEach(btn=>btn.onclick=()=>{
      document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x===btn));
      document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
      $('view-'+btn.dataset.view).classList.add('active');
      if(btn.dataset.view==='people')renderPeople();
      if(btn.dataset.view==='settings')renderSettings();
    });
  }
  function renderDeptTabs(){
    $('departmentTabs').innerHTML=departmentNames().filter(d=>d!=='Unassigned'||deptPeople(d).length).map(d=>`<button class="dept-tab${d===state.department?' active':''}" data-dept="${esc(d)}" type="button">${esc(d)} <span>${deptPeople(d).length}</span></button>`).join('');
    $('departmentTabs').querySelectorAll('[data-dept]').forEach(btn=>btn.onclick=()=>{
      if(state.dirty&&!confirm('You have unsaved attendance changes. Switch departments without saving?'))return;
      state.department=btn.dataset.dept;state.draft=new Map();state.dirty=false;localStorage.setItem('attendance-control-dept',state.department);renderToday();
    });
  }
  function renderStats(rows){
    const ds=rows.map(p=>draftFor(p)),marked=ds.filter(d=>d.statusId).length,present=ds.filter(d=>d.statusId==='present').length,exceptions=ds.filter(d=>d.statusId&&d.statusId!=='present').length;
    $('statRoster').textContent=rows.length;$('statMarked').textContent=marked;$('statMarkedHelp').textContent=`${rows.length?Math.round(marked/rows.length*100):0}% complete`;$('statPresent').textContent=present;$('statExceptions').textContent=exceptions;
  }
  function renderRoster(){
    const rows=deptPeople();
    if(!rows.length){$('rosterList').innerHTML='<div class="empty-state">No active people are assigned to this department. Add or move people in Settings.</div>';return}
    const options=settings().statuses.map(s=>`<option value="${esc(s.id)}">${esc(s.label)}${Number(s.points)?` · ${Number(s.points)>0?'+':''}${Number(s.points)}`:''}</option>`).join('');
    $('rosterList').innerHTML=rows.map(person=>{
      const d=draftFor(person),points=projectedPoints(person);
      return `<div class="roster-row" data-person="${esc(person.personKey)}"><div class="person-cell"><span class="avatar">${esc(initials(person.name))}</span><div class="person-copy"><b>${esc(person.name)}</b><small>${esc(person.currentDepartment||'Unassigned')}${person.sizes?` · Sizes: ${esc(person.sizes)}`:''}</small><button class="note-toggle" type="button" data-note-toggle>${d.note?'Edit note':'+ note'}</button></div></div><select class="status-select" data-status><option value="">Not marked</option>${options}</select><span class="points-badge${pointsClass(points)}">${points} pts</span><div class="note-row" data-note-row ${d.note?'':'hidden'}><input type="text" maxlength="1000" placeholder="Optional attendance note…" value="${esc(d.note)}" data-note-input /></div></div>`;
    }).join('');
    for(const p of rows){
      const row=$('rosterList').querySelector(`[data-person="${CSS.escape(p.personKey)}"]`),d=draftFor(p),sel=row.querySelector('[data-status]');sel.value=d.statusId;
      sel.onchange=()=>{d.statusId=sel.value;state.dirty=true;renderToday()};
      row.querySelector('[data-note-toggle]').onclick=()=>{const nr=row.querySelector('[data-note-row]');nr.hidden=!nr.hidden;if(!nr.hidden)nr.querySelector('input').focus()};
      row.querySelector('[data-note-input]').oninput=e=>{d.note=e.target.value;state.dirty=true;$('saveState').textContent='Unsaved changes'};
    }
  }
  function renderAttention(){
    const ts=[...(settings().thresholds||[])].sort((a,b)=>Number(a.points)-Number(b.points)),first=Number(ts[0]?.points||Infinity);
    const rows=activePeople().map(p=>({person:p,points:totalFor(p.personKey)})).filter(x=>x.points>=first).sort((a,b)=>b.points-a.points);
    $('attentionList').innerHTML=rows.length?rows.map(({person,points})=>{const t=thresholdState(points);return `<button class="attention-item" data-attention="${esc(person.personKey)}" type="button"><strong><span>${esc(person.name)}</span><span>${points} pts</span></strong><p>${esc(t.met?.label||'Attention')} threshold reached${t.next?` · ${Math.max(0,Number(t.next.points)-points)} from ${esc(t.next.label)}`:''}</p></button>`}).join(''):'<div class="attention-empty">Nobody is currently at a conversation threshold.</div>';
    $('attentionList').querySelectorAll('[data-attention]').forEach(btn=>btn.onclick=()=>openPerson(btn.dataset.attention,true));
  }
  function renderToday(){
    if(!state.snapshot)return;$('dateInput').value=state.date;$('todayTitle').textContent=formatDate(state.date);renderDeptTabs();
    const rows=deptPeople();$('deptTitle').textContent=state.department;$('deptHelp').textContent=`${rows.length} active ${rows.length===1?'person':'people'} · mark everyone Present, then change only exceptions.`;
    renderStats(rows);renderRoster();renderAttention();$('saveState').textContent=state.dirty?'Unsaved changes':'';
  }
  async function saveDay(){
    const records=deptPeople().map(p=>{const d=draftFor(p);return{personKey:p.personKey,employeeName:p.name,department:p.currentDepartment||state.department,assignment:'',statusId:d.statusId,note:d.note||''}});
    $('saveDayBtn').disabled=true;
    try{const j=await fetchJson(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'saveDay',date:state.date,records})});state.snapshot=j.snapshot;state.draft=new Map();state.dirty=false;renderAll();toast(`Saved ${state.department} attendance.`)}catch(e){toast(e.message,true)}finally{$('saveDayBtn').disabled=false}
  }
  function markAllPresent(){for(const p of deptPeople())draftFor(p).statusId='present';state.dirty=true;renderToday()}
  async function changeDate(next){if(state.dirty&&!confirm('You have unsaved attendance changes. Leave this date without saving?'))return;state.date=next;state.draft=new Map();state.dirty=false;await loadAll()}

  function renderPeople(){
    if(!state.snapshot)return;
    const q=String($('peopleSearch').value||'').trim().toLowerCase(),rows=people().filter(p=>!q||String(p.name).toLowerCase().includes(q)||String(p.currentDepartment||'').toLowerCase().includes(q)).sort((a,b)=>String(a.name).localeCompare(String(b.name)));
    $('peopleList').innerHTML=rows.map(p=>{const points=totalFor(p.personKey);return `<button class="person-list-btn${p.personKey===state.personKey?' active':''}" data-person-key="${esc(p.personKey)}" type="button"><span><b>${esc(p.name)}</b><small>${esc(p.currentDepartment||'Unassigned')}${p.active===false?' · Inactive':''}</small></span><span class="points-badge${pointsClass(points)}">${points}</span></button>`}).join('')||'<div class="empty-state">No matching people.</div>';
    $('peopleList').querySelectorAll('[data-person-key]').forEach(btn=>btn.onclick=()=>openPerson(btn.dataset.personKey));
  }
  async function openPerson(key,switchView=false){
    const p=people().find(x=>x.personKey===key);if(!p)return;state.personKey=key;state.personHistory=null;if(switchView)document.querySelector('.tab[data-view="people"]').click();renderPeople();$('personDetail').innerHTML='<div class="empty-state">Loading history…</div>';
    try{state.personHistory=await fetchJson(`${API}?person=${encodeURIComponent(key)}`);renderPersonDetail(p)}catch(e){$('personDetail').innerHTML=`<div class="empty-state">${esc(e.message)}</div>`}
  }
  function renderPersonDetail(person){
    const h=state.personHistory||{history:[],totalPoints:0},points=Number(h.totalPoints||0),ts=[...(settings().thresholds||[])].sort((a,b)=>Number(a.points)-Number(b.points));
    const tracks=ts.map(t=>{const pct=Math.min(100,Math.max(0,(points/Math.max(1,Number(t.points)))*100));return `<div class="threshold-line${points>=Number(t.points)?' alert':''}"><div><b>${esc(t.label)}</b><div class="bar"><div class="fill" style="width:${pct}%"></div></div></div><span>${points} / ${Number(t.points)}</span></div>`}).join('');
    const history=(h.history||[]).map(r=>`<div class="history-item"><time>${esc(formatDate(r.date).replace(/, \d{4}$/,''))}</time><div><b>${esc(r.statusLabel)}</b><small>${esc(r.department)}${r.assignment&&r.assignment!==r.department?` · ${esc(r.assignment)}`:''} · ${esc(r.source==='excel'?'Excel import':'recorded by '+(r.recordedBy||'Unknown'))}</small>${r.note?`<small>“${esc(r.note)}”</small>`:''}</div><span class="history-points">${Number(r.points)>0?'+':''}${Number(r.points)} pts</span></div>`).join('');
    $('personDetail').innerHTML=`<div class="person-header"><div><h2>${esc(person.name)}</h2><p>${esc(person.currentDepartment||'Unassigned')}${person.active===false?' · Inactive':''}${person.sizes?` · Sizes: ${esc(person.sizes)}`:''}</p></div><div class="big-points"><strong>${points}</strong><span>ACTIVE POINTS</span></div></div><div class="threshold-track">${tracks}</div><h3>Attendance Timeline</h3><div class="history-list">${history||'<div class="empty-state">No attendance history recorded.</div>'}</div>`;
  }

  function deptOptions(selected){return departmentNames().map(d=>`<option value="${esc(d)}"${d===selected?' selected':''}>${esc(d)}</option>`).join('')}
  function renderSettings(){
    if(!state.snapshot)return;const s=settings();
    $('thresholdSettings').innerHTML=(s.thresholds||[]).map(t=>`<div class="setting-row" data-threshold="${esc(t.id)}"><label>${esc(t.label)}<small>Flag manager follow-up at this point total.</small></label><input type="number" min="0" step=".5" value="${Number(t.points)}" /></div>`).join('');
    $('statusSettings').innerHTML=(s.statuses||[]).map(st=>{const p=Number(st.points),help=p===0?'No points':(p>0?'Adds '+p+' point'+(p===1?'':'s'):'Removes '+Math.abs(p)+' point'+(Math.abs(p)===1?'':'s'));return `<div class="setting-row" data-status-setting="${esc(st.id)}"><label>${esc(st.label)}<small>${esc(help)}</small></label><input type="number" min="-10" max="20" step=".5" value="${p}" /></div>`}).join('');
    $('rosterAdminList').innerHTML=people().map(p=>`<div class="roster-admin-row" data-roster-person="${esc(p.personKey)}"><input data-name value="${esc(p.name)}" aria-label="Name"><select data-department>${deptOptions(p.currentDepartment||'Unassigned')}</select><label class="active-check"><input data-active type="checkbox" ${p.active!==false?'checked':''}> Active</label><button data-save-person type="button">Save</button></div>`).join('');
    $('rosterAdminList').querySelectorAll('[data-roster-person]').forEach(row=>row.querySelector('[data-save-person]').onclick=()=>saveRosterPerson(row));
    $('departmentAdminList').innerHTML=departmentRows().map(d=>`<div class="department-admin-row" data-admin-dept="${esc(d.name)}"><b>${esc(d.name)}</b><label><input data-dept-active type="checkbox" ${d.active!==false?'checked':''}> Active</label></div>`).join('');
    $('departmentAdminList').querySelectorAll('[data-admin-dept]').forEach(row=>row.querySelector('[data-dept-active]').onchange=()=>saveDepartment(row.dataset.adminDept,row.querySelector('[data-dept-active]').checked));
  }
  async function saveSettings(){
    const ss=settings().statuses.map(st=>({...st,points:Number($('statusSettings').querySelector(`[data-status-setting="${CSS.escape(st.id)}"] input`).value||0)}));
    const tt=settings().thresholds.map(t=>({...t,points:Number($('thresholdSettings').querySelector(`[data-threshold="${CSS.escape(t.id)}"] input`).value||0)}));
    $('saveSettingsBtn').disabled=true;try{const j=await fetchJson(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'saveSettings',statuses:ss,thresholds:tt})});state.snapshot.settings=j.settings;state.draft=new Map();renderAll();toast('Attendance rules saved.')}catch(e){toast(e.message,true)}finally{$('saveSettingsBtn').disabled=false}
  }
  async function saveRosterPerson(row){
    const key=row.dataset.rosterPerson,name=row.querySelector('[data-name]').value,dept=row.querySelector('[data-department]').value,active=row.querySelector('[data-active]').checked;
    try{await fetchJson(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'upsertPerson',personKey:key,name,currentDepartment:dept,active})});await loadAll();toast(`Saved ${name}.`)}catch(e){toast(e.message,true)}
  }
  async function addPerson(){
    const name=prompt('Person name');if(!name)return;const dept=prompt('Department',departmentNames()[0]||'Unassigned')||'Unassigned';const sizes=prompt('Sizes (optional)','')||'';
    try{await fetchJson(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'upsertPerson',name,currentDepartment:dept,sizes,active:true})});await loadAll();document.querySelector('.tab[data-view="settings"]').click();toast(`Added ${name}.`)}catch(e){toast(e.message,true)}
  }
  async function saveDepartment(name,active=true){
    try{await fetchJson(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'upsertDepartment',name,active})});await loadAll();document.querySelector('.tab[data-view="settings"]').click();toast(`Department ${name} saved.`)}catch(e){toast(e.message,true)}
  }
  async function addDepartment(){
    const name=String($('newDepartmentName').value||'').trim();if(!name)return;
    await saveDepartment(name,true);$('newDepartmentName').value='';
  }

  $('markAllBtn').onclick=markAllPresent;$('saveDayBtn').onclick=saveDay;$('saveSettingsBtn').onclick=saveSettings;$('refreshBtn').onclick=()=>loadAll(true);$('peopleSearch').oninput=renderPeople;
  $('dateInput').onchange=e=>changeDate(e.target.value);$('prevDateBtn').onclick=()=>changeDate(shiftDate(state.date,-1));$('nextDateBtn').onclick=()=>changeDate(shiftDate(state.date,1));$('todayBtn').onclick=()=>changeDate(easternToday());
  $('addPersonBtn').onclick=addPerson;$('addDepartmentBtn').onclick=addDepartment;
  state.date=easternToday();loadAll();
})();