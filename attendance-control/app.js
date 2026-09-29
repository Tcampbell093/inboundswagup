(() => {
  const API='/api/attendance-control';
  const SESSION_API='/.netlify/functions/hub-auth?action=session';
  const TEAM_API='/.netlify/functions/hub-team-admin';
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const state={session:null,team:{employees:[],departments:[]},snapshot:null,date:'',department:'',draft:new Map(),dirty:false,personKey:'',personHistory:null};
  let toastTimer;

  function toast(message,error=false){
    const el=$('toast');el.textContent=message;el.className='toast show'+(error?' error':'');
    clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.className='toast',3200);
  }
  function easternToday(){
    const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
    const map=Object.fromEntries(parts.map(p=>[p.type,p.value]));
    return `${map.year}-${map.month}-${map.day}`;
  }
  function shiftDate(date,delta){
    const d=new Date(date+'T12:00:00');d.setDate(d.getDate()+delta);return d.toISOString().slice(0,10);
  }
  function formatDate(date){
    try{return new Date(date+'T12:00:00').toLocaleDateString([],{weekday:'long',month:'long',day:'numeric',year:'numeric'})}catch{return date}
  }
  function slug(v){return String(v||'').trim().toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')}
  function employeeKey(person){return `fairshift:${Number(person?.id)||slug(person?.name)}`}
  function activeEmployees(){return (state.team.employees||[]).filter(p=>p.active!==false&&String(p.name||'').trim())}
  function departments(){
    const names=[];
    for(const d of state.team.departments||[])if(d.active!==false&&d.name&&!names.includes(d.name))names.push(d.name);
    for(const p of activeEmployees()){const d=p.homeDepartment||'Unassigned';if(!names.includes(d))names.push(d)}
    return names.filter(Boolean);
  }
  function deptEmployees(dept=state.department){
    return activeEmployees().filter(p=>String(p.homeDepartment||'Unassigned')===String(dept)).sort((a,b)=>String(a.name).localeCompare(String(b.name)));
  }
  function settings(){return state.snapshot?.settings||{statuses:[],thresholds:[]}}
  function statusById(id){return settings().statuses.find(s=>s.id===id)||null}
  function savedRecord(key){return (state.snapshot?.dayRecords||[]).find(r=>r.employeeKey===key)||null}
  function totalFor(key){return Number((state.snapshot?.totals||[]).find(t=>t.employeeKey===key)?.totalPoints||0)}
  function draftFor(person){
    const key=employeeKey(person);
    if(!state.draft.has(key)){
      const saved=savedRecord(key);
      state.draft.set(key,{statusId:saved?.statusId||'',note:saved?.note||'',originalStatusId:saved?.statusId||'',originalPoints:Number(saved?.points||0)});
    }
    return state.draft.get(key);
  }
  function projectedPoints(person){
    const key=employeeKey(person),draft=draftFor(person),selected=statusById(draft.statusId);
    return Math.max(0,Math.round((totalFor(key)-Number(draft.originalPoints||0)+Number(selected?.points||0))*100)/100);
  }
  function thresholdState(points){
    const rows=[...(settings().thresholds||[])].sort((a,b)=>Number(a.points)-Number(b.points));
    return {met:rows.filter(t=>points>=Number(t.points)).pop()||null,next:rows.find(t=>points<Number(t.points))||null};
  }
  function pointsClass(points){
    const rows=[...(settings().thresholds||[])].sort((a,b)=>Number(a.points)-Number(b.points));
    if(!rows.length)return'';
    if(points>=Number(rows[1]?.points??rows[0].points))return' alert';
    if(points>=Math.max(0,Number(rows[0].points)-1))return' watch';
    return'';
  }
  function initials(name){return String(name||'?').split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]?.toUpperCase()).join('')||'?'}

  async function fetchJson(url,options={}){
    const r=await fetch(url,{cache:'no-store',credentials:'same-origin',...options});
    const j=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(j.error||`Request failed (${r.status})`);
    return j;
  }
  async function loadSession(){
    try{state.session=await fetchJson(SESSION_API)}catch{state.session={signedIn:false}}
    const isManager=state.session?.signedIn&&String(state.session.role||'').toLowerCase()==='manager';
    $('managerPill').textContent=isManager?`👤 ${state.session.name} · Manager`:'Manager sign-in required';
    $('accessGate').hidden=isManager;$('app').hidden=!isManager;
    return isManager;
  }
  async function loadAll(showToast=false){
    if(!await loadSession())return;
    $('refreshBtn').disabled=true;
    try{
      const [team,snapshot]=await Promise.all([
        fetchJson(TEAM_API),
        fetchJson(`${API}?date=${encodeURIComponent(state.date)}`)
      ]);
      state.team=team;state.snapshot=snapshot;state.draft=new Map();state.dirty=false;
      const ds=departments(),savedDept=localStorage.getItem('attendance-control-dept')||'';
      if(!state.department||!ds.includes(state.department))state.department=ds.includes(savedDept)?savedDept:(ds[0]||'Unassigned');
      renderAll();
      if(showToast)toast('Attendance refreshed.');
    }catch(e){toast(e.message,true)}
    finally{$('refreshBtn').disabled=false}
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
    $('departmentTabs').innerHTML=departments().map(d=>`<button class="dept-tab${d===state.department?' active':''}" data-dept="${esc(d)}" type="button">${esc(d)} <span>${deptEmployees(d).length}</span></button>`).join('');
    $('departmentTabs').querySelectorAll('[data-dept]').forEach(btn=>btn.onclick=()=>{state.department=btn.dataset.dept;localStorage.setItem('attendance-control-dept',state.department);renderToday()});
  }
  function renderStats(people){
    const drafts=people.map(p=>draftFor(p)),marked=drafts.filter(d=>d.statusId).length,present=drafts.filter(d=>d.statusId==='present').length,exceptions=drafts.filter(d=>d.statusId&&d.statusId!=='present').length;
    $('statRoster').textContent=people.length;$('statMarked').textContent=marked;$('statMarkedHelp').textContent=`${people.length?Math.round(marked/people.length*100):0}% complete`;$('statPresent').textContent=present;$('statExceptions').textContent=exceptions;
  }
  function renderRoster(){
    const people=deptEmployees();
    if(!people.length){$('rosterList').innerHTML='<div class="empty-state">No active people are assigned to this department.</div>';return}
    const options=settings().statuses.map(s=>`<option value="${esc(s.id)}">${esc(s.label)}${Number(s.points)?` · ${Number(s.points)>0?'+':''}${Number(s.points)}`:''}</option>`).join('');
    $('rosterList').innerHTML=people.map(person=>{
      const key=employeeKey(person),draft=draftFor(person),points=projectedPoints(person),hasNote=!!draft.note;
      return `<div class="roster-row" data-person="${esc(key)}"><div class="person-cell"><span class="avatar">${esc(initials(person.name))}</span><div class="person-copy"><b>${esc(person.name)}</b><small>${esc(person.role||'Associate')} · ${esc(person.homeDepartment||'Unassigned')}</small><button class="note-toggle" type="button" data-note-toggle>${hasNote?'Edit note':'+ note'}</button></div></div><select class="status-select" data-status aria-label="Attendance status for ${esc(person.name)}"><option value="">Not marked</option>${options}</select><span class="points-badge${pointsClass(points)}">${points} pts</span><div class="note-row" data-note-row ${hasNote?'':'hidden'}><input type="text" maxlength="1000" placeholder="Optional attendance note…" value="${esc(draft.note)}" data-note-input /></div></div>`;
    }).join('');
    for(const person of people){
      const key=employeeKey(person),row=$('rosterList').querySelector(`[data-person="${CSS.escape(key)}"]`),draft=draftFor(person),select=row.querySelector('[data-status]');
      select.value=draft.statusId;
      select.onchange=()=>{draft.statusId=select.value;state.dirty=true;renderToday()};
      row.querySelector('[data-note-toggle]').onclick=()=>{const noteRow=row.querySelector('[data-note-row]');noteRow.hidden=!noteRow.hidden;if(!noteRow.hidden)noteRow.querySelector('input').focus()};
      row.querySelector('[data-note-input]').oninput=e=>{draft.note=e.target.value;state.dirty=true;$('saveState').textContent='Unsaved changes'};
    }
  }
  function renderAttention(){
    const thresholds=[...(settings().thresholds||[])].sort((a,b)=>Number(a.points)-Number(b.points)),first=Number(thresholds[0]?.points||Infinity);
    const rows=activeEmployees().map(p=>({person:p,points:totalFor(employeeKey(p))})).filter(x=>x.points>=first).sort((a,b)=>b.points-a.points);
    $('attentionList').innerHTML=rows.length?rows.map(({person,points})=>{const t=thresholdState(points),label=t.met?.label||'Attention';return `<button class="attention-item" data-attention="${esc(employeeKey(person))}" type="button"><strong><span>${esc(person.name)}</span><span>${points} pts</span></strong><p>${esc(label)} threshold reached${t.next?` · ${Math.max(0,Number(t.next.points)-points)} from ${esc(t.next.label)}`:''}</p></button>`}).join(''):'<div class="attention-empty">Nobody is currently at a conversation threshold.</div>';
    $('attentionList').querySelectorAll('[data-attention]').forEach(btn=>btn.onclick=()=>openPerson(btn.dataset.attention,true));
  }
  function renderToday(){
    if(!state.snapshot)return;
    $('dateInput').value=state.date;$('todayTitle').textContent=formatDate(state.date);renderDeptTabs();
    const people=deptEmployees();$('deptTitle').textContent=state.department;$('deptHelp').textContent=`${people.length} active ${people.length===1?'person':'people'} · mark everyone Present, then change only exceptions.`;
    renderStats(people);renderRoster();renderAttention();$('saveState').textContent=state.dirty?'Unsaved changes':'';
  }

  async function saveDay(){
    const records=deptEmployees().map(p=>{const d=draftFor(p);return{employeeKey:employeeKey(p),employeeName:p.name,department:p.homeDepartment||state.department,statusId:d.statusId,note:d.note||''}});
    $('saveDayBtn').disabled=true;
    try{const j=await fetchJson(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'saveDay',date:state.date,records})});state.snapshot=j.snapshot;state.draft=new Map();state.dirty=false;renderAll();toast(`Saved ${state.department} attendance.`)}
    catch(e){toast(e.message,true)}finally{$('saveDayBtn').disabled=false}
  }
  function markAllPresent(){for(const p of deptEmployees())draftFor(p).statusId='present';state.dirty=true;renderToday()}
  async function changeDate(next){if(state.dirty&&!confirm('You have unsaved attendance changes. Leave this date without saving?'))return;state.date=next;state.draft=new Map();state.dirty=false;await loadAll()}

  function renderPeople(){
    if(!state.snapshot)return;
    const q=String($('peopleSearch').value||'').trim().toLowerCase(),rows=activeEmployees().filter(p=>!q||String(p.name).toLowerCase().includes(q)||String(p.homeDepartment||'').toLowerCase().includes(q)).sort((a,b)=>String(a.name).localeCompare(String(b.name)));
    $('peopleList').innerHTML=rows.map(p=>{const key=employeeKey(p),points=totalFor(key);return `<button class="person-list-btn${key===state.personKey?' active':''}" data-person-key="${esc(key)}" type="button"><span><b>${esc(p.name)}</b><small>${esc(p.homeDepartment||'Unassigned')}</small></span><span class="points-badge${pointsClass(points)}">${points}</span></button>`}).join('')||'<div class="empty-state">No matching people.</div>';
    $('peopleList').querySelectorAll('[data-person-key]').forEach(btn=>btn.onclick=()=>openPerson(btn.dataset.personKey));
  }
  async function openPerson(key,switchView=false){
    const person=activeEmployees().find(p=>employeeKey(p)===key);if(!person)return;
    state.personKey=key;state.personHistory=null;if(switchView)document.querySelector('.tab[data-view="people"]').click();renderPeople();$('personDetail').innerHTML='<div class="empty-state">Loading history…</div>';
    try{state.personHistory=await fetchJson(`${API}?person=${encodeURIComponent(key)}`);renderPersonDetail(person)}catch(e){$('personDetail').innerHTML=`<div class="empty-state">${esc(e.message)}</div>`}
  }
  function renderPersonDetail(person){
    const h=state.personHistory||{history:[],totalPoints:0},points=Number(h.totalPoints||0),thresholds=[...(settings().thresholds||[])].sort((a,b)=>Number(a.points)-Number(b.points));
    const tracks=thresholds.map(t=>{const pct=Math.min(100,Math.max(0,(points/Math.max(1,Number(t.points)))*100));return `<div class="threshold-line${points>=Number(t.points)?' alert':''}"><div><b>${esc(t.label)}</b><div class="bar"><div class="fill" style="width:${pct}%"></div></div></div><span>${points} / ${Number(t.points)}</span></div>`}).join('');
    const history=(h.history||[]).map(r=>`<div class="history-item"><time>${esc(formatDate(r.date).replace(/, \d{4}$/,''))}</time><div><b>${esc(r.statusLabel)}</b><small>${esc(r.department)} · recorded by ${esc(r.recordedBy||'Unknown')}</small>${r.note?`<small>“${esc(r.note)}”</small>`:''}</div><span class="history-points">${Number(r.points)>0?'+':''}${Number(r.points)} pts</span></div>`).join('');
    $('personDetail').innerHTML=`<div class="person-header"><div><h2>${esc(person.name)}</h2><p>${esc(person.homeDepartment||'Unassigned')} · ${esc(person.role||'Associate')}</p></div><div class="big-points"><strong>${points}</strong><span>ACTIVE POINTS</span></div></div><div class="threshold-track">${tracks}</div><h3>Attendance Timeline</h3><div class="history-list">${history||'<div class="empty-state">No attendance history has been recorded in this new system yet.</div>'}</div>`;
  }

  function renderSettings(){
    if(!state.snapshot)return;
    const s=settings();
    $('thresholdSettings').innerHTML=(s.thresholds||[]).map(t=>`<div class="setting-row" data-threshold="${esc(t.id)}"><label>${esc(t.label)}<small>Flag manager follow-up at this point total.</small></label><input type="number" min="0" step=".5" value="${Number(t.points)}" /></div>`).join('');
    $('statusSettings').innerHTML=(s.statuses||[]).map(st=>{const p=Number(st.points),help=p===0?'No points':(p>0?'Adds '+p+' point'+(p===1?'':'s'):'Removes '+Math.abs(p)+' point'+(Math.abs(p)===1?'':'s'));return `<div class="setting-row" data-status-setting="${esc(st.id)}"><label>${esc(st.label)}<small>${esc(help)}</small></label><input type="number" min="-10" max="20" step=".5" value="${p}" /></div>`}).join('');
  }
  async function saveSettings(){
    const statuses=settings().statuses.map(st=>({...st,points:Number($('statusSettings').querySelector(`[data-status-setting="${CSS.escape(st.id)}"] input`).value||0)}));
    const thresholds=settings().thresholds.map(t=>({...t,points:Number($('thresholdSettings').querySelector(`[data-threshold="${CSS.escape(t.id)}"] input`).value||0)}));
    $('saveSettingsBtn').disabled=true;
    try{const j=await fetchJson(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'saveSettings',statuses,thresholds})});state.snapshot.settings=j.settings;state.draft=new Map();renderAll();toast('Attendance rules saved.')}
    catch(e){toast(e.message,true)}finally{$('saveSettingsBtn').disabled=false}
  }

  $('markAllBtn').onclick=markAllPresent;
  $('saveDayBtn').onclick=saveDay;
  $('saveSettingsBtn').onclick=saveSettings;
  $('refreshBtn').onclick=()=>loadAll(true);
  $('peopleSearch').oninput=renderPeople;
  $('dateInput').onchange=e=>changeDate(e.target.value);
  $('prevDateBtn').onclick=()=>changeDate(shiftDate(state.date,-1));
  $('nextDateBtn').onclick=()=>changeDate(shiftDate(state.date,1));
  $('todayBtn').onclick=()=>changeDate(easternToday());

  state.date=easternToday();
  loadAll();
})();