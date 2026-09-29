const $=s=>document.querySelector(s);
let page=1,total=0,lastRecords=[];

function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function text(v){return String(v??'').trim();}
function pretty(v){return text(v)||'—';}
function recordRows(detail){
  const selected=detail?.record||{};
  const related=Array.isArray(detail?.relatedRecords)?detail.relatedRecords:[];
  return [selected,...related.filter(r=>r.record_key!==selected.record_key)];
}
function rowField(rows,names=[],regexes=[]){
  for(const row of rows){
    const obj=row?.row_json||{};
    for(const name of names){
      const v=text(obj[name]);
      if(v)return v;
    }
  }
  for(const row of rows){
    for(const [k,v] of Object.entries(row?.row_json||{})){
      if(!text(v))continue;
      if(regexes.some(rx=>rx.test(k)))return text(v);
    }
  }
  return '';
}
function uniqueWorkers(rows){
  const found=[];
  for(const row of rows){
    for(const [k,v] of Object.entries(row?.row_json||{})){
      const value=text(v);
      if(!value)continue;
      if(/\bby\b|\(por\)|por\b/i.test(k)&&!/date|fecha|qty|quantity/i.test(k)){
        value.split(/[,;/]+/).map(x=>x.trim()).filter(Boolean).forEach(name=>{
          if(!found.some(x=>x.toLowerCase()===name.toLowerCase()))found.push(name);
        });
      }
    }
  }
  return found;
}
function stage(rows,{label,icon,dateNames=[],dateRx=[],byNames=[],byRx=[],locationNames=[],locationRx=[]}){
  const date=rowField(rows,dateNames,dateRx);
  const by=rowField(rows,byNames,byRx);
  const location=rowField(rows,locationNames,locationRx);
  return {label,icon,date,by,location,done:Boolean(date||by||location)};
}
function detailStages(rows){
  const readyDate=rowField(rows,[],[/ready.*receiv.*date/i,/ready.*rec.*date/i,/ready.*receive/i]);
  const readyBy=rowField(rows,[],[/ready.*receiv.*by/i,/ready.*rec.*by/i]);
  const stages=[];
  if(readyDate||readyBy)stages.push({label:'Ready to Receive',icon:'◎',date:readyDate,by:readyBy,location:'',done:true});
  stages.push(
    stage(rows,{label:'Docked',icon:'⇩',dateNames:['Dock Date (Fecha)','Dock Date'],dateRx:[/^dock.*date/i],byNames:['Dock By (Muelle-Por)','Dock By'],byRx:[/^dock.*by/i,/dock.*por/i]}),
    stage(rows,{label:'QA Receiving',icon:'✓',dateNames:['Rec Date (Recibo)','Received Date','QA Date'],dateRx:[/^rec.*date/i,/receiv.*date/i,/qa.*date/i],byNames:['Rec By (Por)','Received By','QA By'],byRx:[/^rec.*by/i,/receiv.*by/i,/qa.*by/i,/rec.*por/i]}),
    stage(rows,{label:'Prepped',icon:'◇',dateNames:['Prep Date (Prep)','Prep Date'],dateRx:[/^prep.*date/i],byNames:['Prep By (Por)','Prep By'],byRx:[/^prep.*by/i,/prep.*por/i]}),
    stage(rows,{label:'Put Away',icon:'▣',dateNames:['Done Date (Term.)','Put-Away Date','Put Away Date','Closed On'],dateRx:[/put.?away.*date/i,/^done.*date/i,/closed.*on/i],byNames:['Done By (Por)','Put-Away By','Put Away By'],byRx:[/put.?away.*by/i,/^done.*by/i,/done.*por/i],locationNames:['Put-Away Loc','Put Away Loc','Location / Ubicacion (QE4-A1)','Overstock Loc (Ubicacion)'],locationRx:[/put.?away.*loc/i]})
  );
  return stages;
}
function overviewValue(rows,names,regexes=[]){return rowField(rows,names,regexes)}
function card(r,i){
  const who=text(r.associate_name);
  const activity=text(r.activity_date);
  return `<button class="record" data-i="${i}">
    <div class="record-main"><strong>PO ${esc(r.po||'—')}</strong><div class="meta">${esc(r.delivery_id||'No delivery ID')}</div></div>
    <div><b>${esc(r.category||'Uncategorized')}</b><div class="meta">Category</div></div>
    <div><b>${esc(r.status||'—')}</b><div class="meta">Status</div></div>
    <div><b>${esc(r.location||'—')}</b><div class="meta">Location</div></div>
    <div><b>${esc(activity||'Date unavailable')}</b><div class="meta">${who?`Latest · ${esc(who)}`:'Latest recorded activity'}</div></div>
    <div><span class="pill ${r.lifecycle_state==='archived'?'archived':''}">${esc(r.lifecycle_state)}</span></div>
  </button>`;
}

async function load(){
  $('#message').textContent='';
  $('#records').innerHTML='<p>Loading records…</p>';
  const p=new URLSearchParams({q:$('#search').value,scope:$('#scope').value,sort:$('#sort').value,page:String(page),pageSize:'40'});
  try{
    const res=await fetch('/api/po-history?'+p,{cache:'no-store',credentials:'same-origin'});
    const data=await res.json().catch(()=>({}));
    if(res.status===401){
      lastRecords=[];total=0;$('#count').textContent='0';$('#records').innerHTML='';
      $('#message').textContent='Sign in with your Warehouse Hub PIN to view PO History.';
      window.HubAssociate?.open?.();
      return;
    }
    if(!res.ok){
      $('#records').innerHTML='';
      $('#message').textContent=data.error||'Unable to load PO history.';
      return;
    }
    lastRecords=data.records||[];
    total=data.total||0;
    $('#count').textContent=total.toLocaleString();
    $('#records').innerHTML=lastRecords.length?lastRecords.map(card).join(''):'<p>No matching records yet. Run the updated Excel sync to copy workbook history here.</p>';
    $('#page').textContent=`Page ${page} of ${Math.max(1,Math.ceil(total/40))}`;
    $('#prev').disabled=page<=1;
    $('#next').disabled=page*40>=total;
    const s=data.lastSync;
    $('#syncStatus').textContent=s?`Last workbook copy: ${new Date(s.synced_at).toLocaleString()} · ${(data.totalStored||0).toLocaleString()} stored rows`:'Waiting for the first workbook copy.';
  }catch(error){
    $('#records').innerHTML='';
    $('#message').textContent=error?.message||'Unable to load PO history.';
  }
}

function overviewCard(label,value,wide=false){
  return `<div class="overview-card${wide?' wide':''}"><span>${esc(label)}</span><strong>${esc(pretty(value))}</strong></div>`;
}
function timelineHtml(stages){
  return stages.map((s,i)=>`<div class="timeline-stage ${s.done?'done':'pending'}">
    <div class="timeline-marker"><span>${esc(s.done?s.icon:'·')}</span></div>
    <div class="timeline-copy">
      <div class="timeline-title"><strong>${esc(s.label)}</strong><span>${s.done?'Recorded':'Not recorded'}</span></div>
      <div class="timeline-meta">
        ${s.date?`<span><b>When</b> ${esc(s.date)}</span>`:''}
        ${s.by?`<span><b>By</b> ${esc(s.by)}</span>`:''}
        ${s.location?`<span><b>Location</b> ${esc(s.location)}</span>`:''}
      </div>
    </div>
  </div>`).join('');
}
function rawFieldsHtml(rows){
  return rows.map((r,ri)=>{
    const entries=Object.entries(r.row_json||{}).filter(([,v])=>text(v));
    if(!entries.length)return'';
    return `<section class="raw-record"><h4>${esc(r.source_sheet||'Workbook')} ${r.delivery_id?`· ${esc(r.delivery_id)}`:''}</h4><div class="raw-grid">${entries.map(([k,v])=>`<dl><dt>${esc(k)}</dt><dd>${esc(v)}</dd></dl>`).join('')}</div></section>`;
  }).join('');
}
async function details(r){
  $('#detailState').textContent=`${r.lifecycle_state} · ${r.source_sheet}`;
  $('#detailTitle').textContent=`PO ${r.po||'details'}`;
  $('#detailSubtitle').textContent=r.delivery_id||'';
  $('#detailBody').innerHTML='<div class="detail-loading">Building PO timeline…</div>';
  $('#details').showModal();
  try{
    const res=await fetch('/api/po-history?'+new URLSearchParams({recordKey:r.record_key}),{cache:'no-store',credentials:'same-origin'});
    const data=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(data.error||'Unable to load PO details.');
    const rows=recordRows(data),selected=data.record||r,workers=uniqueWorkers(rows),stages=detailStages(rows);
    const status=overviewValue(rows,['Status (Estado)','Status'])||selected.status;
    const category=overviewValue(rows,['Category / Categoria','Category'])||selected.category;
    const boxes=overviewValue(rows,['Boxes (Cajas)','Boxes','Box Qty'],[/box.*(qty|caja)/i]);
    const dockQty=overviewValue(rows,['Dock Qty (Cant.)','Dock Qty','Quantity'],[/dock.*qty/i]);
    const pallet=overviewValue(rows,['Pallet (Dia-#)','Pallet'],[/^pallet\b(?!.*type)/i]);
    const palletType=overviewValue(rows,['Pallet Type (Tipo)','Pallet Type']);
    const route=overviewValue(rows,['Prep Route / Ruta Prep','Prep Route'],[/prep.*route/i]);
    const location=overviewValue(rows,['Put-Away Loc','Put Away Loc','Overstock Loc (Ubicacion)','Location / Ubicacion (QE4-A1)'])||selected.location;
    const part=overviewValue(rows,['Delivery / Part #','Part #']);
    const dockDate=overviewValue(rows,['Dock Date (Fecha)','Dock Date'],[/^dock.*date/i]);
    const recDate=overviewValue(rows,['Rec Date (Recibo)','Received Date','QA Date'],[/^rec.*date/i,/qa.*date/i]);

    $('#detailState').textContent=`${selected.lifecycle_state} · ${selected.source_sheet}`;
    $('#detailTitle').textContent=`PO ${selected.po||'details'}`;
    $('#detailSubtitle').textContent=[selected.delivery_id,category,status].filter(Boolean).join(' · ');

    $('#detailBody').innerHTML=`
      <section class="detail-hero">
        <div class="overview-grid">
          ${overviewCard('Status',status)}
          ${overviewCard('Category',category)}
          ${overviewCard('Delivery ID',selected.delivery_id)}
          ${overviewCard('Delivery / Part #',part)}
          ${overviewCard('Boxes',boxes)}
          ${overviewCard('Dock Qty',dockQty)}
          ${overviewCard('Pallet',pallet)}
          ${overviewCard('Pallet Type',palletType)}
          ${overviewCard('Prep Route',route)}
          ${overviewCard('Current / Final Location',location)}
          ${overviewCard('Dock Date',dockDate)}
          ${overviewCard('QA Received',recDate)}
        </div>
      </section>
      <section class="detail-section">
        <div class="section-head"><div><p class="eyebrow">Workflow</p><h3>PO Journey</h3></div><span class="source-count">${rows.length} related workbook record${rows.length===1?'':'s'}</span></div>
        <div class="timeline">${timelineHtml(stages)}</div>
      </section>
      <section class="detail-section">
        <div class="section-head"><div><p class="eyebrow">People</p><h3>Who Worked This PO</h3></div></div>
        <div class="worker-list">${workers.length?workers.map(name=>`<span class="worker-chip">${esc(name)}</span>`).join(''):'<span class="empty-inline">No associate names recorded in the workbook.</span>'}</div>
      </section>
      <details class="raw-details">
        <summary>All workbook fields</summary>
        ${rawFieldsHtml(rows)}
      </details>
    `;
  }catch(error){
    $('#detailBody').innerHTML=`<div class="detail-error">${esc(error?.message||'Unable to load PO details.')}</div>`;
  }
}

document.addEventListener('click',e=>{const c=e.target.closest('.record');if(c)details(lastRecords[Number(c.dataset.i)]);});
document.addEventListener('hub-associate-session',e=>{if(e.detail?.signedIn){page=1;load();}});
let timer;
$('#search').addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(()=>{page=1;load()},250)});
['scope','sort'].forEach(id=>$('#'+id).addEventListener('change',()=>{page=1;load()}));
$('#refresh').onclick=load;
$('#prev').onclick=()=>{page--;load()};
$('#next').onclick=()=>{page++;load()};
$('#close').onclick=()=>$('#details').close();
load();
