(() => {
  'use strict';
  const API='/.netlify/functions/hub-rotations', CHECKIN='/.netlify/functions/hub-cleaning', TEAM_API='/.netlify/functions/hub-team-admin';
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const key=v=>String(v??'').trim().toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-');
  const iso=d=>new Date(d).toISOString().slice(0,10);
  const addDays=(day,n)=>{const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return iso(d);};
  const dayGap=(a,b)=>a?Math.max(0,Math.round((new Date(b+'T12:00:00Z')-new Date(a+'T12:00:00Z'))/86400000)):999;
  const today=()=>{
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
    const t=Object.fromEntries(parts.map(x=>[x.type,x.value]));
    return t.year+'-'+t.month+'-'+t.day;
  };
  const weekStart=day=>{const d=new Date(day+'T12:00:00Z'),dow=d.getUTCDay();return addDays(day,-(dow===0?6:dow-1));};
  const dateText=day=>new Date(day+'T12:00:00Z').toLocaleDateString('en-US',{timeZone:'UTC',month:'short',day:'numeric'});
  const dayName=day=>new Date(day+'T12:00:00Z').toLocaleDateString('en-US',{timeZone:'UTC',weekday:'short'});
  const session=()=>window.HubAssociate?.getSession?.()||{signedIn:false};
  const isAdmin=()=>session().signedIn&&String(session().role||'').toLowerCase()==='manager';
  const isLead=()=>session().signedIn&&['manager','team lead'].includes(String(session().role||'').toLowerCase());

  const top=document.querySelector('.top-actions');
  if(!top)return;
  const trigger=document.createElement('button');
  trigger.id='hubRotationsBtn';
  trigger.className='toolcount rotations-launch';
  trigger.type='button';
  trigger.textContent='🧹 Cleaning';
  top.insertBefore(trigger,$('bingoRewardBtn')||$('manageBtn')||null);

  const css=document.createElement('style');
  css.textContent=`
    .rotations-launch{display:inline-flex;cursor:pointer;color:var(--ink);border-color:#c5d9d1;background:var(--green-soft);white-space:nowrap}
    .rotations-modal{border:0;border-radius:19px;padding:0;width:min(1000px,calc(100% - 22px));max-height:calc(100dvh - 30px);background:var(--bg);color:var(--ink);box-shadow:0 25px 90px rgba(18,61,52,.28)}
    .rotations-modal::backdrop{background:rgba(12,28,24,.54);backdrop-filter:blur(3px)}
    .rotations-header{display:flex;justify-content:space-between;gap:15px;align-items:start;padding:18px 22px 13px;border-bottom:1px solid var(--line)}
    .rotations-header h2{font-size:21px;margin:0 0 3px}.rotations-header p{font-size:12px;color:var(--muted);margin:0}
    .rotations-close{background:#e7efea;border:0;border-radius:9px;width:35px;height:35px;font-size:23px;cursor:pointer}
    .rotations-tabs{display:flex;align-items:center;gap:7px;padding:11px 19px;border-bottom:1px solid var(--line);flex-wrap:wrap}
    .rotations-tabs button{border:1px solid transparent;background:transparent;color:#566960;border-radius:9px;padding:9px 12px;font-size:12px;font-weight:850;cursor:pointer}
    .rotations-tabs button.active{background:var(--ink);color:white}
    .rotations-refresh{margin-left:auto!important}
    .rotations-body{padding:19px 21px 23px;overflow:auto;max-height:calc(100dvh - 210px)}
    .rotations-note{font-size:12px;color:var(--muted);line-height:1.5;margin:0 0 14px}
    .rotations-note.warning{background:#fff4dd;color:#684a15;border:1px solid #ebd5a1;padding:10px 12px;border-radius:10px}
    .rotations-error{background:#ffebe7;border:1px solid #f0c5bd;color:#883526;padding:10px 13px;border-radius:10px;font-size:12px;font-weight:800;margin-bottom:13px}
    .rotations-ok{background:#e7f6ed;border:1px solid #c1e6ce;color:#23583b;padding:10px 13px;border-radius:10px;font-size:12px;font-weight:800;margin-bottom:13px}
    .rotations-toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:9px;margin:8px 0 16px}
    .rotations-toolbar button,.rotations-toolbar input,.rotations-toolbar select,.rotations-cell select,.rotations-absence select,.rotations-absence input{border:1px solid #cad8cd;border-radius:9px;background:#fff;color:var(--ink);padding:9px;font-size:12px}
    .rotations-toolbar button{cursor:pointer;font-weight:850}.rotations-toolbar button.action{background:var(--ink);color:#fff}
    .rotations-toolbar button:disabled,.rotations-cell button:disabled{opacity:.5;cursor:default}
    .rotations-overview{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:12px 0 17px}
    .rotations-stat{border:1px solid var(--line);background:var(--paper);border-radius:12px;padding:13px}
    .rotations-stat b{display:block;font-size:23px}.rotations-stat span{font-size:10px;color:var(--muted);font-weight:800}
    .rotations-day{margin-bottom:12px;border:1px solid var(--line);background:var(--paper);border-radius:13px;padding:12px}
    .rotations-side{display:grid;gap:8px;margin-bottom:18px}
    .rotations-side-title{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line);padding:0 2px 8px;margin:10px 0 0;font-size:13px;font-weight:950;color:var(--ink)}
    .rotations-side-title small{font-size:10px;font-weight:750;color:var(--muted)}
    .rotations-side-empty{border:1px dashed var(--line);border-radius:10px;padding:11px 12px;color:var(--muted);font-size:12px}
    .rotations-group-row th{background:var(--green-soft);color:var(--ink);font-size:11px;letter-spacing:.05em;text-transform:uppercase;text-align:left;padding:9px 10px!important;border-radius:9px}
    .rotations-area-config{display:grid;grid-template-columns:1.5fr 1fr auto;gap:12px;align-items:center;border:1px solid var(--line);background:var(--paper);border-radius:12px;padding:12px;margin:9px 0}
    .rotations-area-config small{display:block;color:var(--muted);font-size:11px;margin-top:3px}
    .rotations-area-config select{width:100%;border:1px solid #cad8cd;border-radius:9px;background:#fff;padding:9px;font-size:12px}
    .rotations-area-config label{font-size:11px;white-space:nowrap;font-weight:800}
    @media(max-width:560px){.rotations-area-config{grid-template-columns:1fr auto}.rotations-area-config>div:first-child{grid-column:1/-1}}
    .rotations-day h3{font-size:13px;margin:0 0 10px}.rotations-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.3fr) auto;gap:9px;align-items:center;padding:9px 0;border-top:1px solid var(--line);font-size:12px}
    .rotations-row:first-of-type{border-top:0}.rotations-row small{display:block;color:var(--muted);font-size:10px;margin-top:3px}
    .rotations-row button,.rotations-absence button,.rotations-cell button{border:1px solid #bdd3c4;background:#eaf6ef;color:#23573d;border-radius:8px;padding:8px 9px;font-size:11px;font-weight:850;cursor:pointer}
    .rotations-row button.danger{border-color:#eccabc;background:#fff0e9;color:#8b462d}
    .rotations-area{font-weight:900}
    .rotations-week-table{width:100%;border-collapse:separate;border-spacing:0 8px;table-layout:fixed}
    .rotations-week-table th{text-align:left;font-size:11px;color:#60726b;padding:7px 8px}
    .rotations-week-table td{padding:8px;vertical-align:top;border:1px solid var(--line);background:var(--paper);border-radius:9px;font-size:12px}
    .rotations-week-table .rotations-cell{display:grid;gap:5px;min-width:0}
    .rotations-cell select{width:100%;min-width:0;padding:7px;font-size:11px}
    .rotations-cell small{font-size:10px;color:var(--muted);line-height:1.35}
    .rotations-cell b{font-size:12px}.rotations-cell .done{color:var(--green);font-weight:900}
    .rotations-fair-table{width:100%;border-collapse:collapse;font-size:12px;background:var(--paper);border-radius:12px;overflow:hidden}
    .rotations-fair-table th,.rotations-fair-table td{padding:10px 8px;text-align:left;border-bottom:1px solid var(--line)}
    .rotations-fair-table th{font-size:10px;color:var(--muted);font-weight:900}
    .rotations-fair-table tr:last-child td{border-bottom:0}
    .rotations-absence{border:1px solid var(--line);background:var(--paper);border-radius:11px;padding:12px;margin:12px 0;display:flex;flex-wrap:wrap;gap:8px;align-items:center}
    .rotations-absence b{font-size:12px;margin-right:8px}
    .rotations-badge{font-size:10px;font-weight:850;padding:3px 7px;border-radius:99px;background:#eff4f0;color:#476450}
    .rotations-badge.warn{background:#ffebd2;color:#855f21}
    .rotations-badge.done{background:#dcf2e5;color:#285d39}
    .rotations-history{display:grid;gap:7px;max-height:400px;overflow:auto}
    .rotations-history-row{display:flex;justify-content:space-between;gap:8px;background:var(--paper);border:1px solid var(--line);border-radius:9px;padding:9px 11px;font-size:11px}
    .rotations-history-row small{display:block;color:var(--muted);margin-top:3px}
    @media print{
      @page{size:landscape;margin:.35in}
      body *{visibility:hidden!important}
      #hubRotationsDialog,#hubRotationsDialog *{visibility:visible!important}
      #hubRotationsDialog{position:absolute!important;inset:0!important;width:100%!important;max-width:none!important;max-height:none!important;margin:0!important;padding:0!important;border:0!important;box-shadow:none!important;background:#fff!important}
      #hubRotationsDialog::backdrop{display:none!important}
      .rotations-header,.rotations-tabs,#rotationsMessage,.rotations-toolbar,.rotations-note,.rotations-absence,.rotations-cell button{display:none!important}
      .rotations-body{padding:0!important;overflow:visible!important;max-height:none!important}
      .rotations-week-wrap{overflow:visible!important}
      .rotations-print-title{display:block!important;font-size:20px;font-weight:900;margin:0 0 14px;color:#173f35}
      .rotations-week-table{min-width:0!important;border-collapse:collapse!important;border-spacing:0!important;width:100%!important;table-layout:fixed!important}
      .rotations-week-table th,.rotations-week-table td{border:1px solid #aebdb7!important;border-radius:0!important;padding:7px!important;background:#fff!important;color:#173f35!important}
      .rotations-group-row th{background:#e7f3ee!important}
      .rotations-cell small{color:#556760!important}
    }
    @media(max-width:730px){
      .top-actions{flex-wrap:wrap;justify-content:flex-end}.topbar{height:auto;min-height:74px;padding:8px 0}
      .rotations-body{padding:12px;max-height:calc(100dvh - 200px)}
      .rotations-header{padding:14px}.rotations-tabs{padding:8px}.rotations-row{grid-template-columns:1fr auto}
      .rotations-row .rotations-assignee{grid-column:1/-1;grid-row:2}
      .rotations-overview{gap:5px}.rotations-stat{padding:9px}.rotations-stat b{font-size:18px}
      .rotations-week-wrap{overflow-x:auto}.rotations-week-table{min-width:700px}
      .rotations-fair-wrap{overflow-x:auto}.rotations-fair-table{min-width:510px}
    }`;
  document.head.appendChild(css);

  const dialog=document.createElement('dialog');
  dialog.className='rotations-modal';
  dialog.id='hubRotationsDialog';
  dialog.innerHTML=`
    <div class="rotations-header">
      <div><h2>🧹 Cleaning & Rotations</h2><p id="rotationsSubtitle">Fair schedules · one team across every cleaning area</p></div>
      <button class="rotations-close" type="button" id="rotationsClose" aria-label="Close">×</button>
    </div>
    <div class="rotations-tabs">
      <button type="button" data-rot-tab="today" class="active">Today</button>
      <button type="button" data-rot-tab="week">Weekly schedule</button>
      <button type="button" data-rot-tab="fairness">Fairness & history</button>
      <button type="button" data-rot-tab="areas" hidden>Areas</button>
      <button type="button" class="rotations-refresh" id="rotationsRefresh">↻ Refresh</button>
    </div>
    <div class="rotations-body">
      <div id="rotationsMessage" aria-live="polite"></div>
      <div id="rotationsContent"><p class="rotations-note">Loading cleaning assignments…</p></div>
    </div>`;
  document.body.appendChild(dialog);

  let data=null,tab='today',week=weekStart(today()),draft=[],busy=false,message='',isError=false;
  const role=()=>isAdmin()?'admin':isLead()?'lead':'associate';
  const person=id=>data?.employees.find(e=>e.id===Number(id));
  const personName=id=>person(id)?.name||'Unassigned';
  const available=(id,date)=>!(data?.availability||[]).some(x=>x.employeeId===Number(id)&&x.date===date&&x.status==='unavailable');
  const areaSide=area=>{
    const match=data?.departments.find(d=>d.name.toLowerCase()===String(area||'').toLowerCase());
    return match?.side==='Outbound'?'Outbound':match?.side==='Inbound'?'Inbound':
      /fulfill?ment|outbound|inventory|shipping|dispatch|pack.?out/i.test(String(area||''))?'Outbound':'Inbound';
  };
  const areas=()=>data?.departments.filter(d=>d.active&&d.cleaningActive)
    .sort((a,b)=>Number(a.side==='Outbound')-Number(b.side==='Outbound')).map(d=>d.name)||[];
  const associates=()=>data?.employees.filter(e=>e.active&&e.role==='Associate')||[];
  const duty=(date,area)=>data?.assignments.find(a=>a.date===date&&a.area===area)||null;
  const weekDays=()=>Array.from({length:5},(_,i)=>addDays(week,i));
  const optionList=(date,selected,excluded=[],allowEmpty=false)=>{
    const people=associates().filter(e=>available(e.id,date)&&(!excluded.includes(e.id)||e.id===Number(selected)))
      .sort((a,b)=>a.name.localeCompare(b.name));
    return(allowEmpty?'<option value="">No alternate</option>':'<option value="">Choose cleaner…</option>')
      +people.map(e=>`<option value="${e.id}"${e.id===Number(selected)?' selected':''}>${esc(e.name)}</option>`).join('');
  };
  const showMessage=(text,error=false)=>{message=text;isError=error;const el=$('rotationsMessage');if(el)el.innerHTML=text?`<div class="rotations-${error?'error':'ok'}">${esc(text)}</div>`:'';};
  async function fetchJSON(url,options={}){
    const response=await fetch(url,{credentials:'same-origin',cache:'no-store',...options});
    const out=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(out.error||'Cleaning request failed.');
    return out;
  }
  async function load(preserveMessage=false){
    if(!dialog.open)return;
    $('rotationsContent').innerHTML='<p class="rotations-note">Loading cleaning assignments…</p>';
    if(!preserveMessage)showMessage('');
    try{
      data=await fetchJSON(API+'?date='+encodeURIComponent(today()));
      if(data?.source)$('rotationsSubtitle').textContent='Warehouse-wide cleaning · '+data.source;
      draft=[];
      render();
    }catch(error){
      data=null;
      $('rotationsContent').innerHTML='<p class="rotations-note warning">'+esc(error.message||'Cleaning scheduler is unavailable.')+'</p>';
    }
  }
  async function send(body,success,endpoint=API){
    if(busy)return;
    busy=true;
    try{
      await fetchJSON(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      await load(true);
      showMessage(success);
      document.dispatchEvent(new CustomEvent('hub-cleaning-refresh'));
      return true;
    }catch(error){showMessage(error.message||'Could not update cleaning.',true);return false;}
    finally{busy=false;}
  }
  // Actual worked credit and leave protection are intentionally separate.
  // Leave protection maintains rotation position, but never creates worked
  // minutes or a Bingo coin. Department affinity never enters eligibility.
  function fairness(){
    if(!data)return[];
    const now=today(),start=addDays(now,-89),pool=associates();
    const totals=new Map(pool.map(e=>[e.id,{
      ...e,minutes:0,protected:0,rotations:0,last:null,bySide:{Inbound:0,Outbound:0},byArea:Object.fromEntries(areas().map(a=>[a,0])),
      lastArea:Object.fromEntries(areas().map(a=>[a,null])),dates:[],outDays:0,
    }]));
    const done=data.assignments.filter(a=>a.status==='completed'&&a.date>=start&&a.date<=now);
    for(const item of done){
      const p=totals.get(item.actualEmployeeId||item.employeeId);
      if(!p)continue;
      p.minutes+=15;p.rotations++;p.dates.push(item.date);
      if(!p.last||p.last<item.date)p.last=item.date;
      p.byArea[item.area]=(p.byArea[item.area]||0)+1;
      p.bySide[areaSide(item.area)]+=1;
      if(!p.lastArea[item.area]||p.lastArea[item.area]<item.date)p.lastArea[item.area]=item.date;
    }
    const byDate=new Map();
    for(const item of done)byDate.set(item.date,(byDate.get(item.date)||0)+1);
    const out=new Map();
    for(const r of data.availability)if(r.status==='unavailable'&&r.date>=start&&r.date<=now){
      if(!out.has(r.date))out.set(r.date,new Set());
      out.get(r.date).add(r.employeeId);
    }
    for(const [date,away] of out){
      const remaining=pool.filter(e=>!away.has(e.id)).length;
      const protection=remaining?15*(byDate.get(date)||0)/remaining:0;
      for(const id of away){
        const p=totals.get(id);
        if(p){p.protected+=protection;p.outDays++;}
      }
    }
    const gap=(p,date)=>{
      if(!date)return 999;
      let count=0;
      for(let d=addDays(date,1);d<=now;d=addDays(d,1))if(!(out.get(d)||new Set()).has(p.id))count++;
      return count;
    };
    return [...totals.values()].map(p=>({
      ...p,protected:Math.round(p.protected),
      balance:p.minutes+p.protected,daysSince:gap(p,p.last)
    })).sort((a,b)=>a.balance-b.balance||b.daysSince-a.daysSince||a.name.localeCompare(b.name));
  }
  function buildSuggestions(){
    if(!data)return[];
    const current=today(),pool=associates(),fields=areas(),score=new Map(fairness().map(p=>[p.id,{
      minutes:p.balance,worked:p.minutes,week:0,last:p.last,side:{...p.bySide},area:{...p.byArea},lastArea:{...p.lastArea},commitmentDates:new Set()
    }]));
    const planned=[];
    const addCommitment=(id,date,{worked=false,area=null}={})=>{
      const target=score.get(Number(id));
      if(!target||!date)return;
      target.week++;
      target.commitmentDates.add(date);
      if(worked&&area){
        target.minutes+=15;
        target.side[areaSide(area)]+=1;
        target.area[area]=(target.area[area]||0)+1;
        if(!target.last||target.last<date)target.last=date;
        if(!target.lastArea[area]||target.lastArea[area]<date)target.lastArea[area]=date;
      }
    };
    const adjacentCommitment=(id,date)=>{
      const dates=score.get(Number(id))?.commitmentDates;
      return !!dates&&(dates.has(addDays(date,-1))||dates.has(addDays(date,1)));
    };

    // Count every existing primary and backup commitment this week. Completed
    // work is already included in fairness(), so only unfinished primary work
    // adds projected minutes here. Backups count toward weekly load and spacing,
    // but do not receive worked minutes unless they actually complete the duty.
    for(const row of data.assignments.filter(a=>a.date>=week&&a.date<=addDays(week,4))){
      if(row.status==='missed')continue;
      const primaryId=row.actualEmployeeId||row.employeeId;
      addCommitment(primaryId,row.date,{worked:row.status!=='completed',area:row.area});
      if(row.alternateEmployeeId&&Number(row.alternateEmployeeId)!==Number(primaryId)){
        addCommitment(row.alternateEmployeeId,row.date);
      }
    }

    for(const date of weekDays()){
      if(date<current)continue;
      const occupied=new Set(data.assignments.filter(a=>a.date===date&&a.status!=='missed')
        .flatMap(a=>[a.employeeId,a.alternateEmployeeId,a.actualEmployeeId].filter(Boolean)));
      for(const area of fields){
        if(duty(date,area))continue;
        const eligible=pool.filter(p=>available(p.id,date)&&!occupied.has(p.id));
        if(!eligible.length)continue;

        // First avoid anyone already committed on the previous or next day.
        // Only relax that rule if staffing leaves no other eligible choice.
        const spaced=eligible.filter(p=>!adjacentCommitment(p.id,date));
        const spacingPool=spaced.length?spaced:eligible;

        // Primary + backup commitments both count toward the weekly load cap.
        const preferred=spacingPool.filter(p=>(score.get(p.id)?.week||0)<2);
        const choices=(preferred.length?preferred:spacingPool).sort((a,b)=>{
          const sa=score.get(a.id),sb=score.get(b.id);
          return (sa?.minutes||0)-(sb?.minutes||0)
            ||(sa?.side[areaSide(area)]||0)-(sb?.side[areaSide(area)]||0)
            ||(sa?.area[area]||0)-(sb?.area[area]||0)
            ||(sa?.week||0)-(sb?.week||0)
            ||dayGap(sb?.lastArea[area],date)-dayGap(sa?.lastArea[area],date)
            ||dayGap(sb?.last,date)-dayGap(sa?.last,date)
            ||a.name.localeCompare(b.name);
        });
        const primary=choices[0];
        occupied.add(primary.id);
        addCommitment(primary.id,date,{worked:true,area});
        planned.push({assignmentDate:date,department:area,employeeId:primary.id,alternateEmployeeId:null});
      }

      for(const plannedRow of planned.filter(r=>r.assignmentDate===date)){
        const eligibleAlternates=pool.filter(p=>available(p.id,date)&&!occupied.has(p.id));
        const spacedAlternates=eligibleAlternates.filter(p=>!adjacentCommitment(p.id,date));
        const spacingPool=spacedAlternates.length?spacedAlternates:eligibleAlternates;
        const preferred=spacingPool.filter(p=>(score.get(p.id)?.week||0)<2);
        const alternates=(preferred.length?preferred:spacingPool).sort((a,b)=>
          (score.get(a.id)?.week||0)-(score.get(b.id)?.week||0)
          ||(score.get(a.id)?.minutes||0)-(score.get(b.id)?.minutes||0)
          ||a.name.localeCompare(b.name));
        if(alternates[0]){
          plannedRow.alternateEmployeeId=alternates[0].id;
          occupied.add(alternates[0].id);
          addCommitment(alternates[0].id,date);
        }
      }
    }
    return planned;
  }
  function render(){
    if(!dialog.open||!data)return;
    document.querySelectorAll('[data-rot-tab]').forEach(b=>{
      b.classList.toggle('active',b.dataset.rotTab===tab);
      if(b.dataset.rotTab==='areas')b.hidden=!isAdmin();
    });
    $('rotationsMessage').innerHTML=message?`<div class="rotations-${isError?'error':'ok'}">${esc(message)}</div>`:'';
    if(tab==='today')renderToday();
    else if(tab==='week')renderWeek();
    else if(tab==='areas'&&isAdmin())renderAreas();
    else renderFairness();
  }
  function renderToday(){
    const now=today(),rows=areas().map(area=>({area,record:duty(now,area)}));
    const finished=rows.filter(r=>r.record?.status==='completed').length;
    const mine=rows.filter(r=>r.record&&(r.record.actualEmployeeId||r.record.employeeId)===Number(session().employeeId)
      &&!['completed','missed'].includes(r.record.status));
    $('rotationsContent').innerHTML=`
      <div class="rotations-overview">
        <div class="rotations-stat"><b>${rows.length}</b><span>Cleaning areas</span></div>
        <div class="rotations-stat"><b>${finished}</b><span>Completed today</span></div>
        <div class="rotations-stat"><b>${mine.length}</b><span>My outstanding duties</span></div>
      </div>
      <p class="rotations-note">Today's assignments · ${esc(dateText(now))}. Each completed duty counts as 15 minutes of cleaning and earns one Bingo coin through the existing check-in.</p>
      <div id="rotationsTodayRows">${['Inbound','Outbound'].map(side=>`
        <section class="rotations-side">
          <h3 class="rotations-side-title">${side}<small>${rows.filter(r=>areaSide(r.area)===side).length} areas</small></h3>
          ${rows.some(r=>areaSide(r.area)===side)
            ?rows.filter(r=>areaSide(r.area)===side).map(({area,record})=>{
        const status=record?.status||'Unassigned',original=record?personName(record.employeeId):'Not scheduled';
        const assigned=record?personName(record.actualEmployeeId||record.employeeId):'';
        const isMine=record&&[record.actualEmployeeId||record.employeeId].includes(Number(session().employeeId));
        const canCheck=isMine&&['scheduled','alternate_assigned','in_progress'].includes(record.status);
        const canChange=isLead()&&record&&!['completed','in_progress'].includes(record.status);
        const canUndo=record?.status==='in_progress'&&(isMine||isLead());
        const canReopen=record?.status==='completed'&&isAdmin();
        return `<div class="rotations-day">
          <div class="rotations-row">
            <div><div class="rotations-area">${esc(area)}</div>
              <small>${record&&record.actualEmployeeId&&record.actualEmployeeId!==record.employeeId?'Originally '+esc(original):'15-minute duty'}</small></div>
            <div class="rotations-assignee"><b>${esc(assigned||original)}</b>
              <small>${record?.alternateEmployeeId?'Backup: '+esc(personName(record.alternateEmployeeId)):'No alternate selected'}</small></div>
            <div><span class="rotations-badge ${status==='completed'?'done':status==='missed'?'warn':''}">${esc(status.replace(/_/g,' '))}</span></div>
          </div>
          ${canCheck||canUndo?`<div class="rotations-toolbar">${canCheck?`<button class="action" type="button" data-clean-check="${record.id}" data-next="${record.status==='in_progress'?'finish':'start'}">${record.status==='in_progress'?'✓ Finish cleaning':'▶ Start cleaning'}</button>`:''}${canUndo?`<button type="button" data-clean-check="${record.id}" data-next="undo">↺ Undo start</button>`:''}</div>`:''}
          ${canReopen?`<div class="rotations-toolbar"><button type="button" data-clean-check="${record.id}" data-next="reopen">↺ Reopen (Admin)</button></div>`:''}
          ${canChange?`<div class="rotations-toolbar">
            <button type="button" data-today-reassign="${record.id}">Change assignment</button>
            <button type="button" class="danger" data-today-absent="${record.id}">${record.alternateEmployeeId?'Absent → use backup':'Mark absent'}</button>
          </div>`:''}
        </div>`;
      }).join('')
            :`<p class="rotations-side-empty">No ${side} cleaning areas are enabled. Admins can add them under Areas.</p>`}
        </section>`).join('')}</div>
      ${isLead()?`<div class="rotations-note">To plan or adjust future duties, open the Weekly schedule tab. Replacements receive the completed cleaning credit, not the absent employee.</div>`:''}
    `;
    document.querySelectorAll('[data-clean-check]').forEach(b=>b.onclick=()=>runCheckin(Number(b.dataset.cleanCheck),b.dataset.next,b));
    document.querySelectorAll('[data-today-absent]').forEach(b=>b.onclick=async()=>{
      const r=data.assignments.find(a=>a.id===Number(b.dataset.todayAbsent));
      if(r&&confirm(`Mark ${personName(r.employeeId)} absent and ${r.alternateEmployeeId?'assign '+personName(r.alternateEmployeeId):'leave this duty unassigned'}?`))
        await send({action:'markCleaningAbsent',assignmentId:r.id},'Availability and backup assignment updated.');
    });
    document.querySelectorAll('[data-today-reassign]').forEach(b=>b.onclick=()=>{
      const r=data.assignments.find(a=>a.id===Number(b.dataset.todayReassign));
      if(r){week=weekStart(r.date);tab='week';render();$('rotationsContent').scrollTo?.(0,0);}
    });
  }
  async function runCheckin(id,action,button){
    if(busy)return;
    const row=data.assignments.find(a=>a.id===id);
    if(!row)return;
    if(action==='undo'&&!confirm('Undo this start? The duty goes back to Scheduled.'))return;
    if(action==='reopen'&&!confirm('Reopen this completed duty? It goes back to Scheduled and the Bingo Coin from finishing is taken back.'))return;
    button.disabled=true;busy=true;
    try{
      const out=await fetchJSON(CHECKIN,{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action,assignmentId:id})});
      await load(true);
      showMessage(action==='finish'?
        `Cleaning completed. 15 minutes credited.${out.bingoCoinAwarded?' One Bingo coin added.':''}`
        :action==='undo'?'Start undone. The duty is back to Scheduled.'
        :action==='reopen'?'Duty reopened. It is back to Scheduled and can be started again.'
        :'Cleaning started. Finish when your area is done.');
      document.dispatchEvent(new CustomEvent('hub-bingo-refresh'));
      document.dispatchEvent(new CustomEvent('hub-cleaning-refresh'));
    }catch(e){showMessage(e.message,true);button.disabled=false;}
    finally{busy=false;}
  }
  function printWeeklySchedule(){
    const dates=weekDays(),fields=areas();
    const title=`Horario de Limpieza · ${dateText(week)} – ${dateText(addDays(week,4))}`;
    const daySpanish={Mon:'Lunes',Tue:'Martes',Wed:'Miércoles',Thu:'Jueves',Fri:'Viernes'};
    const areaPrintMeta={
      'QA Receiving':{es:'Recepción QA',en:'QA Receiving',icon:'📦',accent:'#ff8a3d'},
      'QA Prep':{es:'Preparación QA',en:'QA Prep',icon:'🧴',accent:'#4f96ff'},
      'Assembly':{es:'Ensamblaje',en:'Assembly',icon:'🛠️',accent:'#9b52e8'},
      'Fulfillment':{es:'Despacho',en:'Fulfillment',icon:'🚚',accent:'#2ca38f'},
      'Inventory':{es:'Inventario',en:'Inventory',icon:'📋',accent:'#ef6b4e'},
    };
    const areaMeta=area=>areaPrintMeta[area]||{es:area,en:area,icon:'🧹',accent:'#2ca38f'};

    const cell=(date,area)=>{
      const r=duty(date,area);
      const d=draft.find(x=>x.assignmentDate===date&&x.department===area);
      if(r){
        const primary=personName(r.actualEmployeeId||r.employeeId);
        const backup=r.alternateEmployeeId?personName(r.alternateEmployeeId):'—';
        return `<div class="cleaner">${esc(primary)}</div><div class="backup"><span>Respaldo / Backup:</span><strong>${esc(backup)}</strong></div>`;
      }
      if(d){
        const primary=personName(d.employeeId);
        const backup=d.alternateEmployeeId?personName(d.alternateEmployeeId):'—';
        return `<div class="cleaner">${esc(primary)}</div><div class="backup"><span>Respaldo / Backup:</span><strong>${esc(backup)}</strong></div><div class="suggested">Sugerido / Suggested</div>`;
      }
      return '<div class="open"><strong>Disponible</strong><span>Open spot</span></div>';
    };

    const body=fields.map(area=>{
      const meta=areaMeta(area);
      return `<tr class="area-row">
        <th class="area" style="--accent:${meta.accent}">
          <div class="area-icon">${meta.icon}</div>
          <div class="area-copy"><strong>${esc(meta.es)}</strong><span>${esc(meta.en)}</span></div>
        </th>
        ${dates.map(date=>`<td>${cell(date,area)}</td>`).join('')}
      </tr>`;
    }).join('');

    document.getElementById('cleaningPrintFrame')?.remove();
    const frame=document.createElement('iframe');
    frame.id='cleaningPrintFrame';
    frame.setAttribute('aria-hidden','true');
    frame.style.position='fixed';
    frame.style.left='-10000px';
    frame.style.top='0';
    frame.style.width='1px';
    frame.style.height='1px';
    frame.style.border='0';
    frame.style.opacity='0';
    document.body.appendChild(frame);

    const doc=frame.contentDocument;
    doc.open();
    doc.write(`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<style>
  @page{size:letter landscape;margin:.25in}
  *{box-sizing:border-box}
  html,body{margin:0;padding:0;background:#f2f8f5;color:#153f35;font-family:Arial,Helvetica,sans-serif}
  body{width:10.5in;height:8in;overflow:hidden}
  .sheet{width:10.5in;height:7.95in;display:flex;flex-direction:column;background:#f2f8f5;padding:.22in .28in .14in}
  .top{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin:0 0 .12in}
  .brand{display:flex;align-items:center;gap:12px}
  .brand-icon{width:.56in;height:.56in;border-radius:16px;background:#31a494;display:flex;align-items:center;justify-content:center;font-size:25px}
  h1{margin:0;font-size:28px;line-height:.95;letter-spacing:-.035em;font-weight:900}
  .subtitle{margin:5px 0 0;color:#2fa596;font-size:16px;font-weight:800}
  .week{padding-top:4px;text-align:right}
  .week strong{display:block;font-size:15px;line-height:1.05}
  .week span{display:block;margin-top:4px;color:#64857c;font-size:10px;font-weight:800}
  table{width:100%;border-collapse:separate;border-spacing:7px 7px;table-layout:fixed;margin:0 -.07in}
  thead tr{height:.48in}
  thead th{border:0;background:#114e43;color:#fff;text-align:center;font-size:13px;font-weight:900;padding:7px 5px;border-radius:13px;line-height:1.05}
  thead th:first-child{background:transparent;color:#153f35;text-align:left;width:1.55in;padding-left:2px;font-size:10px}
  .day-en{display:block;margin-top:3px;color:#cfe4de;font-size:8.5px;font-weight:700}
  tbody .area-row{height:.91in}
  tbody th,tbody td{vertical-align:middle}
  .area{position:relative;background:#fff;border:1px solid #e4ece8;border-left:6px solid var(--accent);border-radius:14px;padding:8px 8px 8px 10px;text-align:left}
  .area>div{display:flex}
  .area-icon{float:left;width:28px;font-size:17px;align-items:center;justify-content:center;padding-top:1px}
  .area-copy{margin-left:30px;display:block!important}
  .area-copy strong{display:block;font-size:11.5px;font-weight:900;line-height:1.02}
  .area-copy span{display:block;margin-top:4px;color:#5e8378;font-size:8.7px;font-weight:700}
  tbody td{background:#fbfdfc;border:1.3px solid #c9dfd7;border-radius:13px;padding:10px 9px}
  .cleaner{font-size:15px;font-weight:900;line-height:1.08;color:#17463b}
  .backup{margin-top:7px;line-height:1.1}
  .backup span{display:block;color:#438173;font-size:8.5px;font-weight:800}
  .backup strong{display:block;margin-top:3px;color:#4e7c72;font-size:9.5px;font-weight:900}
  .suggested{margin-top:5px;font-size:7px;color:#89681f;font-weight:900;text-transform:uppercase;letter-spacing:.05em}
  .open{height:100%;min-height:.61in;border:1.8px dashed #e9b82d;border-radius:12px;background:#fff9e3;color:#956900;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;font-style:normal}
  .open strong{font-size:11px;line-height:1}.open span{margin-top:4px;font-size:9px;font-weight:800}
  .footer{margin-top:auto;display:flex;align-items:flex-end;justify-content:space-between;gap:20px;color:#4f8177;font-size:9px;font-weight:800}
  .thanks{font-size:18px;color:#2fa596;font-weight:900}
  tr,td,th{page-break-inside:avoid;break-inside:avoid}
</style>
</head>
<body>
<div class="sheet">
  <div class="top">
    <div class="brand">
      <div class="brand-icon">🧹</div>
      <div>
        <h1>Horario de Limpieza</h1>
        <div class="subtitle">Cleaning Schedule</div>
      </div>
    </div>
    <div class="week">
      <strong>${esc(dateText(week))} – ${esc(dateText(addDays(week,4)))}</strong>
      <span>Semana · Week</span>
    </div>
  </div>
  <table>
    <thead><tr><th>Área / Area</th>${dates.map(d=>`<th>${esc(daySpanish[dayName(d)]||dayName(d))}<span class="day-en">${esc(dayName(d))} · ${esc(dateText(d))}</span></th>`).join('')}</tr></thead>
    <tbody>${body}</tbody>
  </table>
  <div class="footer">
    <span>¿No puedes venir? Avisa a tu respaldo y a tu líder · Can't make it? Tell your backup and your lead.</span>
    <span class="thanks">¡Gracias, equipo! 💚</span>
  </div>
</div>
</body>
</html>`);
    doc.close();

    const cleanup=()=>setTimeout(()=>frame.remove(),250);
    frame.contentWindow.onafterprint=cleanup;
    setTimeout(()=>{
      try{
        frame.contentWindow.focus();
        frame.contentWindow.print();
      }catch(error){
        frame.remove();
        showMessage('Could not open the print preview. Please try again.',true);
      }
    },180);
  }

  function renderWeek(){
    const dates=weekDays(),now=today(),fields=areas(),existing=data.assignments.filter(a=>dates.includes(a.date));
    const published=existing.filter(a=>a.status!=='missed').length;
    const rows=dates.map(date=>({date,items:fields.map(area=>({area,record:duty(date,area),
      suggestion:draft.find(x=>x.assignmentDate===date&&x.department===area)}))}));
    $('rotationsContent').innerHTML=`
      <div class="rotations-print-title" style="display:none">Cleaning Schedule · ${esc(dateText(week))} – ${esc(dateText(addDays(week,4)))}</div>
      <div class="rotations-toolbar">
        <button type="button" id="rotationsPrev">← Previous</button>
        <b>${esc(dateText(week))} – ${esc(dateText(addDays(week,4)))}</b>
        <button type="button" id="rotationsNext">Next →</button>
        <button type="button" id="rotationsPrint">🖨 Print schedule</button>
        ${isAdmin()?`<button class="action" type="button" id="rotationsSuggest">✦ Generate suggestions</button>
        <button type="button" id="rotationsPublish" ${!draft.length?'disabled':''}>Publish ${draft.length} suggested</button>`:''}
      </div>
      <p class="rotations-note">Everyone in the active Associate pool can rotate through every cleaning area, regardless of home department. Suggestions avoid back-to-back cleaning days when staffing allows, then balance the last 90 days of completed minutes, leave protection, area variety and this week's primary/backup commitments. Existing assignments and completed work are preserved.</p>
      ${isAdmin()&&draft.length?`<p class="rotations-note warning">Review the proposed people and backups below, then publish. Changing a selection updates the draft only until you publish.</p>`:''}
      <div class="rotations-week-wrap"><table class="rotations-week-table"><thead><tr><th style="width:90px">Area</th>${dates.map(d=>`<th>${esc(dayName(d))}<br>${esc(dateText(d))}</th>`).join('')}</tr></thead>
      <tbody>${fields.map((area,i)=>`${i===0||areaSide(fields[i-1])!==areaSide(area)
        ?`<tr class="rotations-group-row"><th colspan="${dates.length+1}">${esc(areaSide(area))}</th></tr>`:''}<tr><th>${esc(area)}</th>${dates.map(date=>{
        const row=rows.find(r=>r.date===date).items.find(r=>r.area===area),r=row.record,d=row.suggestion;
        const locked=date<now||['completed','in_progress'].includes(r?.status);
        if(r)return`<td><div class="rotations-cell"><b>${esc(personName(r.actualEmployeeId||r.employeeId))}</b>
          <small>${esc(r.status.replace(/_/g,' '))}${r.alternateEmployeeId?' · Backup: '+esc(personName(r.alternateEmployeeId)):''}</small>
          ${r.status==='completed'?'<small class="done">✓ 15 min credited</small>':''}
          ${isLead()&&(isAdmin()||date===now)&&!locked?`<button data-edit-slot="${esc(date)}|${esc(area)}">Edit / reassign</button>`:''}
        </div></td>`;
        if(d)return`<td><div class="rotations-cell">
          <select aria-label="Cleaner for ${esc(area)} on ${date}" data-draft-primary="${esc(date)}|${esc(area)}">${optionList(date,d.employeeId,[],false)}</select>
          <select aria-label="Backup for ${esc(area)} on ${date}" data-draft-alternate="${esc(date)}|${esc(area)}">${optionList(date,d.alternateEmployeeId,[d.employeeId],true)}</select>
          <small>Suggested · 15 min</small>
        </div></td>`;
        return`<td><div class="rotations-cell"><small>${locked?'Not scheduled':'Open slot'}</small>
          ${isLead()&&(isAdmin()||date===now)&&!locked?`<button data-edit-slot="${esc(date)}|${esc(area)}">+ Assign</button>`:''}
        </div></td>`;
      }).join('')}</tr>`).join('')}</tbody></table></div>
      ${isAdmin()&&existing.some(x=>x.status!=='completed'&&x.date>=now)?'<div class="rotations-toolbar"><button id="rotationsClear" type="button">Clear unfinished days this week</button></div>':''}
    `;
    $('rotationsPrev').onclick=()=>{week=addDays(week,-7);draft=[];render();};
    $('rotationsNext').onclick=()=>{week=addDays(week,7);draft=[];render();};
    $('rotationsPrint').onclick=printWeeklySchedule;
    if($('rotationsSuggest'))$('rotationsSuggest').onclick=()=>{
      draft=buildSuggestions();render();if(!draft.length)showMessage('No open slots to suggest for this week.');
    };
    if($('rotationsPublish'))$('rotationsPublish').onclick=async()=>{
      if(!draft.length)return;
      if(!confirm(`Publish ${draft.length} suggested cleaning assignments? The current schedule will update immediately.`))return;
      const ok=await send({action:'acceptCleaningSuggestions',entries:draft},'Weekly cleaning assignments published.');
      if(ok)draft=[];
    };
    if($('rotationsClear'))$('rotationsClear').onclick=async()=>{
      const days=dates.filter(d=>d>=now&&data.assignments.some(a=>a.date===d&&a.status!=='completed'));
      if(days.length&&confirm('Clear unfinished cleaning assignments for '+days.length+' day(s)? Completed work stays protected.'))
        await send({action:'clearCleaningScheduleDays',dates:days},'Unfinished schedule cleared.');
    };
    document.querySelectorAll('[data-draft-primary]').forEach(sel=>sel.onchange=()=>{
      const [date,area]=sel.dataset.draftPrimary.split('|'),r=draft.find(x=>x.assignmentDate===date&&x.department===area);
      r.employeeId=Number(sel.value)||0;
      if(r.alternateEmployeeId===r.employeeId)r.alternateEmployeeId=null;
      render();
    });
    document.querySelectorAll('[data-draft-alternate]').forEach(sel=>sel.onchange=()=>{
      const [date,area]=sel.dataset.draftAlternate.split('|'),r=draft.find(x=>x.assignmentDate===date&&x.department===area);
      r.alternateEmployeeId=Number(sel.value)||null;render();
    });
    document.querySelectorAll('[data-edit-slot]').forEach(b=>b.onclick=()=>{
      const [date,area]=b.dataset.editSlot.split('|');renderSlotEditor(date,area);
    });
  }
  function renderSlotEditor(date,area){
    const r=duty(date,area),areaName=area,old=r?.employeeId||0;
    const todayDate=today();
    if(date<todayDate||['completed','in_progress'].includes(r?.status))return showMessage('Completed, in-progress and past assignments cannot be changed.',true);
    const host=document.createElement('div');host.className='rotations-absence';
    host.innerHTML=`<b>${esc(dayName(date))} · ${esc(areaName)}</b>
      <label class="rotations-note">Cleaner <select id="slotPrimary">${optionList(date,old,[],false)}</select></label>
      <label class="rotations-note">Backup <select id="slotAlternate">${optionList(date,r?.alternateEmployeeId||0,[old],true)}</select></label>
      <button type="button" id="slotSave">Save assignment</button>
      <button type="button" id="slotCancel">Cancel</button>`;
    const panel=$('rotationsContent');panel.prepend(host);
    $('slotPrimary').onchange=()=>{
      const backup=$('slotAlternate'),backupId=Number(backup.value)||null;
      backup.innerHTML=optionList(date,backupId,[Number($('slotPrimary').value)],true);
      if(backupId===Number($('slotPrimary').value))backup.value='';
    };
    $('slotSave').onclick=async()=>{
      const primary=Number($('slotPrimary').value),alternate=Number($('slotAlternate').value)||null;
      if(!primary)return showMessage('Select the cleaner first.',true);

      const conflict=data.assignments.find(a=>a.date===date&&a.status!=='missed'
        &&Number(a.id)!==Number(r?.id||0)&&Number(a.alternateEmployeeId||0)===primary);
      let replacement=null;
      if(conflict){
        const used=new Set();
        for(const row of data.assignments.filter(a=>a.date===date&&a.status!=='missed')){
          if(Number(row.id)===Number(r?.id||0))continue;
          if(Number(row.id)===Number(conflict.id)){
            used.add(Number(row.actualEmployeeId||row.employeeId));
            continue;
          }
          [row.employeeId,row.alternateEmployeeId,row.actualEmployeeId].filter(Boolean).forEach(id=>used.add(Number(id)));
        }
        used.add(primary);
        const history=new Map(fairness().map(p=>[p.id,p]));
        const weekLoad=id=>data.assignments.filter(a=>a.date>=week&&a.date<=addDays(week,4)&&a.status!=='missed'
          &&[a.employeeId,a.alternateEmployeeId,a.actualEmployeeId].filter(Boolean).map(Number).includes(Number(id))
          &&Number(a.id)!==Number(r?.id||0)).length;
        const adjacent=id=>data.assignments.some(a=>a.status!=='missed'&&(a.date===addDays(date,-1)||a.date===addDays(date,1))
          &&[a.employeeId,a.alternateEmployeeId,a.actualEmployeeId].filter(Boolean).map(Number).includes(Number(id)));
        const eligible=associates().filter(p=>available(p.id,date)&&!used.has(Number(p.id)));
        const spaced=eligible.filter(p=>!adjacent(p.id));
        const choices=(spaced.length?spaced:eligible).sort((a,b)=>{
          const ha=history.get(a.id),hb=history.get(b.id);
          return weekLoad(a.id)-weekLoad(b.id)
            ||(ha?.balance||0)-(hb?.balance||0)
            ||(ha?.byArea?.[conflict.area]||0)-(hb?.byArea?.[conflict.area]||0)
            ||dayGap(hb?.lastArea?.[conflict.area],date)-dayGap(ha?.lastArea?.[conflict.area],date)
            ||a.name.localeCompare(b.name);
        });
        replacement=choices[0]||null;
        if(!replacement)return showMessage(`${personName(primary)} is already the backup for ${conflict.area}, and there is no eligible replacement backup available that day.`,true);
      }

      const autoNote=conflict&&replacement
        ?` ${personName(primary)} is currently the backup for ${conflict.area}; that backup will automatically move to ${replacement.name}.`
        :'';
      if(!confirm(`Assign ${personName(primary)} to ${areaName} on ${date}?${autoNote}`))return;

      if(!conflict){
        await send({action:'setCleaningSchedule',employeeId:primary,alternateEmployeeId:alternate,assignmentDate:date,department:areaName},
          'Cleaning assignment saved.');
        return;
      }

      if(busy)return;
      busy=true;
      let backupMoved=false;
      try{
        await fetchJSON(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
          action:'setCleaningSchedule',employeeId:Number(conflict.employeeId),alternateEmployeeId:Number(replacement.id),
          assignmentDate:conflict.date,department:conflict.area
        })});
        backupMoved=true;
        await fetchJSON(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
          action:'setCleaningSchedule',employeeId:primary,alternateEmployeeId:alternate,assignmentDate:date,department:areaName
        })});
        await load(true);
        showMessage(`Cleaning assignment saved. ${conflict.area} backup automatically changed to ${replacement.name}.`);
        document.dispatchEvent(new CustomEvent('hub-cleaning-refresh'));
      }catch(error){
        if(backupMoved){
          try{
            await fetchJSON(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
              action:'setCleaningSchedule',employeeId:Number(conflict.employeeId),alternateEmployeeId:primary,
              assignmentDate:conflict.date,department:conflict.area
            })});
          }catch{}
        }
        showMessage(error.message||'Could not update cleaning.',true);
      }finally{busy=false;}
    };
    $('slotCancel').onclick=()=>host.remove();
  }
  function renderFairness(){
    const history=fairness(),completed=data.assignments.filter(a=>a.status==='completed')
      .sort((a,b)=>b.date.localeCompare(a.date)||b.id-a.id).slice(0,90);
    $('rotationsContent').innerHTML=`
      <p class="rotations-note">Last 90 days. Actual minutes are awarded only after completed work. Leave protection affects scheduling priority, not credited minutes or Bingo coins. The shared pool rotates across both Inbound and Outbound.</p>
      <div class="rotations-fair-wrap"><table class="rotations-fair-table"><thead><tr><th>Associate</th><th>Worked</th><th>Leave protection</th><th>Rotation balance</th><th>Inbound</th><th>Outbound</th>${areas().map(a=>`<th>${esc(a)}</th>`).join('')}</tr></thead><tbody>
      ${history.map(h=>`<tr><td><b>${esc(h.name)}</b><small style="display:block;color:var(--muted)">Last: ${esc(h.last||'Never')}</small></td>
        <td>${h.minutes} min</td><td>${h.protected} min</td><td><b>${Math.round(h.balance)} min</b></td><td>${h.bySide.Inbound}</td><td>${h.bySide.Outbound}</td>
        ${areas().map(a=>`<td>${h.byArea[a]||0}</td>`).join('')}</tr>`).join('')}
      </tbody></table></div>
      ${isAdmin()?`<div class="rotations-absence">
        <b>Record absence / leave</b>
        <select id="rotationsAbsentEmployee" aria-label="Employee">${associates().map(e=>`<option value="${e.id}">${esc(e.name)}</option>`).join('')}</select>
        <input type="date" id="rotationsAbsentStart" value="${today()}" aria-label="Start date" />
        <input type="date" id="rotationsAbsentEnd" value="${today()}" aria-label="End date" />
        <select id="rotationsAbsentStatus" aria-label="Availability"><option value="unavailable">Out / unavailable</option><option value="available">Available again</option></select>
        <button type="button" id="rotationsAbsentSave">Save dates</button>
      </div>`:''}
      <h3 style="font-size:13px;margin:17px 0 10px">Completed cleaning history</h3>
      <div class="rotations-history">${completed.length?completed.map(a=>`
        <div class="rotations-history-row"><span><b>${esc(personName(a.actualEmployeeId||a.employeeId))}</b><small>${esc(areaSide(a.area))} · ${esc(a.area)} · ${esc(a.date)}</small></span>
        <span class="rotations-badge done">15 min ✓</span></div>`).join(''):'<p class="rotations-note">No completed duties in the loaded history.</p>'}</div>
    `;
    if($('rotationsAbsentSave'))$('rotationsAbsentSave').onclick=async()=>{
      const employeeId=Number($('rotationsAbsentEmployee').value),startDate=$('rotationsAbsentStart').value,
        endDate=$('rotationsAbsentEnd').value,status=$('rotationsAbsentStatus').value;
      if(!startDate||!endDate||endDate<startDate)return showMessage('Choose a valid start and end date.',true);
      if(confirm(`Mark ${personName(employeeId)} ${status} from ${startDate} through ${endDate}?`))
        await send({action:'setAvailabilityRange',employeeId,startDate,endDate,status},'Availability saved. Suggestions will account for it.');
    };
  }

  function renderAreas(){
    if(!isAdmin()){tab='today';return render();}
    const departments=data.departments.filter(d=>d.active).slice()
      .sort((a,b)=>Number(a.side==='Outbound')-Number(b.side==='Outbound')||a.name.localeCompare(b.name));
    $('rotationsContent').innerHTML=`
      <p class="rotations-note">Assign every cleaning area to Inbound or Outbound. This changes its section on the dashboard and weekly planner, not which employees can clean it. Enable Cleaning area for Dock, Fulfillment, Inventory or any other department you want included.</p>
      ${departments.map(d=>`<div class="rotations-area-config">
        <div><b>${esc(d.name)}</b><small>${d.cleaningActive?'Included in the cleaning schedule':'Not currently a cleaning area'}</small></div>
        <select aria-label="Warehouse side for ${esc(d.name)}" data-side-dept="${d.id}">
          <option value="Inbound"${areaSide(d.name)==='Inbound'?' selected':''}>Inbound</option>
          <option value="Outbound"${areaSide(d.name)==='Outbound'?' selected':''}>Outbound</option>
        </select>
        <label><input type="checkbox" data-cleaning-active="${d.id}"${d.cleaningActive?' checked':''} /> Cleaning area</label>
      </div>`).join('')}
      <p class="rotations-note">Missing a department? Add it in Admin Tools → Team & departments, then return here to activate cleaning and assign its side. Existing assignments and Bingo history are unaffected by moving an area between sides.</p>
    `;
    document.querySelectorAll('[data-side-dept]').forEach(select=>select.onchange=async()=>{
      const departmentId=Number(select.dataset.sideDept),side=select.value;
      await send({action:'setCleaningAreaSide',departmentId,side},
        `${data.departments.find(d=>d.id===departmentId)?.name||'Area'} is now under ${side}.`);
    });
    document.querySelectorAll('[data-cleaning-active]').forEach(box=>box.onchange=async()=>{
      const id=Number(box.dataset.cleaningActive),cleaningActive=box.checked;
      await send({action:'setCleaningDepartment',id,cleaningActive},
        cleaningActive?'Cleaning area enabled.':'Cleaning area disabled for new schedules.',TEAM_API);
    });
  }

  async function open(targetTab='today'){
    if(!session().signedIn){
      window.HubAssociate?.open?.();return;
    }
    tab=['today','week','fairness','areas'].includes(targetTab)?targetTab:'today';week=weekStart(today());draft=[];message='';
    if(!dialog.open)dialog.showModal();
    await load();
  }
  trigger.onclick=()=>void open();
  $('rotationsClose').onclick=()=>dialog.close();
  $('rotationsRefresh').onclick=()=>void load();
  dialog.querySelectorAll('[data-rot-tab]').forEach(b=>b.onclick=()=>{
    tab=b.dataset.rotTab;render();
  });
  document.addEventListener('hub-associate-session',()=>{if(dialog.open)void load();});
  window.HubRotations={open,refresh:()=>dialog.open?load(true):Promise.resolve()};
})();
