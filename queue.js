// ===== QUEUE MODULE (Phase 2 split) =====

const queueImportedCount=document.getElementById('queueImportedCount');
const queueIncompleteCount=document.getElementById('queueIncompleteCount');
const queueScheduledCount=document.getElementById('queueScheduledCount');
const queueReadyUnitsStat=document.getElementById('queueReadyUnitsStat');
const queueReadyPbsStat=document.getElementById('queueReadyPbsStat');
const queuePendingUnitsStat=document.getElementById('queuePendingUnitsStat');
const queuePendingPbsStat=document.getElementById('queuePendingPbsStat');
const queueScheduledUnitsStat=document.getElementById('queueScheduledUnitsStat');
const queueScheduledPbsStat=document.getElementById('queueScheduledPbsStat');
const queueScheduledTodayUnitsStat=document.getElementById('queueScheduledTodayUnitsStat');
const queueScheduledTodayPbsStat=document.getElementById('queueScheduledTodayPbsStat');
const queueTotalUnits=document.getElementById('queueTotalUnits');
const queueEarliestIhd=document.getElementById('queueEarliestIhd');
const queueRawRowsCount=document.getElementById('queueRawRowsCount');
const queueGroupedRowsCount=document.getElementById('queueGroupedRowsCount');
const queuePriorityUnits=document.getElementById('queuePriorityUnits');
const queueSortModeLabel=document.getElementById('queueSortModeLabel');
const queueTableBody=document.getElementById('queueTableBody');
const scheduledQueueTableBody=document.getElementById('scheduledQueueTableBody');
const incompleteQueueTableBody=document.getElementById('incompleteQueueTableBody');
const scheduledQueueLimit=document.getElementById('scheduledQueueLimit');
const readyQueueLimit=document.getElementById('readyQueueLimit');
const incompleteQueueLimit=document.getElementById('incompleteQueueLimit');
const queueIssueHoldCountStat=document.getElementById('queueIssueHoldCountStat');
const queueIssueHoldUnitsStat=document.getElementById('queueIssueHoldUnitsStat');
const queueIssueHoldRevenueStat=document.getElementById('queueIssueHoldRevenueStat');
const queueIssueHoldTopTypeStat=document.getElementById('queueIssueHoldTopTypeStat');
const issueHoldQueueLimit=document.getElementById('issueHoldQueueLimit');
const issueHoldQueueTableBody=document.getElementById('issueHoldQueueTableBody');
const issueHoldModalBackdrop=document.getElementById('issueHoldModalBackdrop');
const issueHoldModalSummary=document.getElementById('issueHoldModalSummary');
const issueHoldTypeInput=document.getElementById('issueHoldType');
const issueHoldNoteInput=document.getElementById('issueHoldNote');
const issueHoldStartDateInput=document.getElementById('issueHoldStartDate');
const closeIssueHoldBtn=document.getElementById('closeIssueHoldBtn');
const cancelIssueHoldBtn=document.getElementById('cancelIssueHoldBtn');
const confirmIssueHoldBtn=document.getElementById('confirmIssueHoldBtn');
const revenueFileInput=document.getElementById('revenueFileInput');
const revenueImportStatus=document.getElementById('revenueImportStatus');
const revenueRowsCount=document.getElementById('revenueRowsCount');
const revenueKeysCount=document.getElementById('revenueKeysCount');
const revenueSubtotalTotal=document.getElementById('revenueSubtotalTotal');
const revenueEarliestIhd=document.getElementById('revenueEarliestIhd');
const queueFileInput=document.getElementById('queueFileInput');
const queueImportStatus=document.getElementById('queueImportStatus');
const queueSearchInput=document.getElementById('queueSearch');
const queueSortByInput=document.getElementById('queueSortBy');
const queueClearSearchBtn=document.getElementById('queueClearSearchBtn');
const homeEmployeesCount=document.getElementById('homeEmployeesCount');
const homeBirthdaysCount=document.getElementById('homeBirthdaysCount');
const homeErrorsCount=document.getElementById('homeErrorsCount');
const homeAssemblyPbCount=document.getElementById('homeAssemblyPbCount');
const homePresentToday=document.getElementById('homePresentToday');
const homeLateToday=document.getElementById('homeLateToday');
const homeAbsentToday=document.getElementById('homeAbsentToday');
const homeAssemblyUnits=document.getElementById('homeAssemblyUnits');
const homeAssemblyDoneUnits=document.getElementById('homeAssemblyDoneUnits');
const homeAssemblyCapacity=document.getElementById('homeAssemblyCapacity');
const homeAssemblyCompletion=document.getElementById('homeAssemblyCompletion');
const homeAssemblyStageSummary=document.getElementById('homeAssemblyStageSummary');
const homeAssemblyScheduleBody=document.getElementById('homeAssemblyScheduleBody');
const homeBirthdaysList=document.getElementById('homeBirthdaysList');
const homeErrorsList=document.getElementById('homeErrorsList');
const scheduleModalBackdrop=document.getElementById('scheduleModalBackdrop');
const scheduleModalSummary=document.getElementById('scheduleModalSummary');
const scheduleModalDate=document.getElementById('scheduleModalDate');
const scheduleModalNote=document.getElementById('scheduleModalNote');
const scheduleModeInput=document.getElementById('scheduleMode');
const scheduleQtyInput=document.getElementById('scheduleQty');
const scheduleFullQtyInput=document.getElementById('scheduleFullQty');
const scheduleRemainderToggleInput=document.getElementById('scheduleRemainderToggle');
const scheduleRemainderDateInput=document.getElementById('scheduleRemainderDate');
let pendingScheduleQueueId='';
let pendingScheduleSource='ready';
let pendingRescheduleAssemblyId='';
const issueHoldQueueStorageKey='ops_hub_issue_hold_queue_v1';
const queueImportMetaKey='ops_hub_queue_import_meta_v1';
const revenueImportMetaKey='ops_hub_revenue_import_meta_v1';
let issueHoldQueueRows=normalizeIssueHoldQueueRows(loadJson(issueHoldQueueStorageKey,[]));
let pendingIssueHoldId='';
let pendingIssueHoldSource='ready';

const HOLD_REASON_OPTIONS=[
  'Custom Box Size Incorrect',
  'Inventory Count Short / Miscount',
  'Size Breakdown Mismatch',
  'System / Mission Complete Issue',
  'PO Not Populating / Component Mapping Issue',
  'Client Last-Minute Change',
  'Insufficient Boxes Ordered',
  'Moved to MFC',
  'Order Canceled',
  'Awaiting Repush / New Pack Builder',
  'Unknown / Investigate'
];

function getTodayIsoDate(){
  return new Date().toISOString().slice(0,10);
}
function formatHoldStartDate(value){
  if(!value) return '—';
  try{
    return new Date(`${value}T00:00:00`).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
  }catch(error){
    return value;
  }
}
function getDaysOnHold(startDate){
  if(!startDate) return 0;
  const start = new Date(`${startDate}T00:00:00`);
  const today = new Date();
  const current = new Date(`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}T00:00:00`);
  const diff = Math.floor((current - start) / 86400000);
  return Math.max(0,diff);
}
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function hydrateIssueHoldReasonOptions(){
  if(!issueHoldTypeInput) return;
  const current = issueHoldTypeInput.value || 'Unknown / Investigate';
  issueHoldTypeInput.innerHTML = HOLD_REASON_OPTIONS.map(option=>`<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`).join('');
  issueHoldTypeInput.value = HOLD_REASON_OPTIONS.includes(current) ? current : 'Unknown / Investigate';
}

function viewScheduledInAssembly(id){
  const row=scheduledQueueRows.find(item=>String(item.id)===String(id));
  if(!row) return;
  const assemblyMatch=assemblyBoardRows.find(item=>(item.pbId&&row.pbId&&item.pbId===row.pbId)||((!item.pbId||!row.pbId)&&item.pb===row.pb&&item.so===row.so&&item.date===row.scheduledFor));
  activatePage('assemblyPage');
  assemblyDateInput.value=row.scheduledFor||new Date().toISOString().slice(0,10);
  renderAssembly();
  requestAnimationFrame(()=>{
    if(!assemblyMatch) return;
    const candidates=[...assemblyBoardBody.querySelectorAll('tr')];
    const target=candidates.find(tr=>{
      const cells=tr.querySelectorAll('td');
      if(!cells.length) return false;
      const pbText=(cells[0]?.textContent||'').trim();
      const soText=(cells[1]?.textContent||'').trim();
      return pbText===String(assemblyMatch.pb||'').trim() && soText===String(assemblyMatch.so||'').trim();
    });
    if(target){
      target.classList.add('assembly-row-highlight');
      target.scrollIntoView({behavior:'smooth',block:'center'});
      setTimeout(()=>target.classList.remove('assembly-row-highlight'),2200);
    }
  });
}


function normalizeIssueHoldQueueRows(list){
  return (list||[]).map(item=>({
    id:item.id||Date.now()+Math.random(),
    sourceId:String(item.sourceId||item.id||'').trim(),
    sourceQueue:String(item.sourceQueue||'ready').trim(),
    priority:!!item.priority,
    pb:String(item.pb||'').trim(),
    pbId:String(item.pbId||'').trim(),
    so:String(item.so||'').trim(),
    account:String(item.account||'').trim(),
    qty:Number(item.qty||0),
    products:Number(item.products||0),
    units:Number(item.units||0),
    ihd:String(item.ihd||'').trim(),
    accountOwner:String(item.accountOwner||'').trim(),
    pdfUrl:String(item.pdfUrl||'').trim(),
    issueType:String(item.issueType||'Unknown / Investigate').trim(),
    holdNote:String(item.holdNote||'').trim(),
    holdDate:String(item.holdDate||'').trim(),
    holdStartDate:String(item.holdStartDate||item.holdDate||'').trim(),
    holdDays:Number(item.holdDays||0),
    revenue:Number(item.revenue||0),
    status:String(item.status||'Issue Hold').trim(),
    scheduledFor:String(item.scheduledFor||'').trim(),
    scheduledAt:String(item.scheduledAt||'').trim(),
    scheduleNote:String(item.scheduleNote||'').trim(),
    sourceStatus:String(item.sourceStatus||item.status||'').trim()
  }));
}
function saveIssueHoldQueue(){saveJson(issueHoldQueueStorageKey,issueHoldQueueRows)}
function applyIssueHoldLimit(rows,limitValue){if(limitValue==='all') return rows;const limit=Math.max(1,Number(limitValue||10));return rows.slice(0,limit)}
function renderIssueHoldSection(){
  const filtered=issueHoldQueueRows
    .filter(matchesQueueSearch)
    .sort((a,b)=>String(b.holdStartDate||b.holdDate||'').localeCompare(String(a.holdStartDate||a.holdDate||'')));
  const visible=applyIssueHoldLimit(filtered,issueHoldQueueLimit?.value||'10');
  const totalUnits=issueHoldQueueRows.reduce((sum,row)=>sum+Number(row.units||0),0);
  const totalRevenue=issueHoldQueueRows.reduce((sum,row)=>sum+Number(row.revenue||0),0);
  const typeCounts={};
  issueHoldQueueRows.forEach(row=>{const key=String(row.issueType||'Unknown / Investigate').trim()||'Unknown / Investigate'; typeCounts[key]=(typeCounts[key]||0)+1;});
  const topType=Object.entries(typeCounts).sort((a,b)=>b[1]-a[1])[0]?.[0]||'—';
  if(queueIssueHoldCountStat) queueIssueHoldCountStat.textContent=issueHoldQueueRows.length.toLocaleString();
  if(queueIssueHoldUnitsStat) queueIssueHoldUnitsStat.textContent=totalUnits.toLocaleString();
  if(queueIssueHoldRevenueStat) queueIssueHoldRevenueStat.textContent='$'+totalRevenue.toLocaleString(undefined,{maximumFractionDigits:0});
  if(queueIssueHoldTopTypeStat) queueIssueHoldTopTypeStat.textContent=topType;
  if(!issueHoldQueueTableBody) return;
  if(!filtered.length){issueHoldQueueTableBody.innerHTML='<tr><td colspan="11" class="empty">No pack builders are currently on Issue Hold.</td></tr>';return;}
  issueHoldQueueTableBody.innerHTML=visible.map(row=>{
    const link=buildSalesforcePbLink(row.pbId,row.pdfUrl);
    const daysOnHold=getDaysOnHold(row.holdStartDate||'');
    return `<tr><td>${escapeHtml(row.pb||'—')}</td><td>${escapeHtml(row.so||'—')}</td><td>${escapeHtml(row.account||'—')}</td><td>${Number(row.units||0).toLocaleString()}</td><td>${escapeHtml(row.ihd||'—')}</td><td>${escapeHtml(row.issueType||'—')}</td><td>${escapeHtml(row.holdNote||'—')}</td><td>${escapeHtml(formatHoldStartDate(row.holdStartDate||row.holdDate||''))}</td><td>${daysOnHold.toLocaleString()}</td><td>$${Number(row.revenue||0).toLocaleString(undefined,{maximumFractionDigits:0})}</td><td><div class="row-actions">${link?`<a class="queue-link" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">Open</a>`:''}<button class="btn secondary" onclick="releaseIssueHoldRow('${escapeJs(String(row.id))}')">Release</button><button class="btn danger" onclick="deleteIssueHoldRow('${escapeJs(String(row.id))}')">Delete</button></div></td></tr>`;
  }).join('');
}
function openIssueHoldModal(id,source='ready'){
  const sourceRows=source==='incomplete'?incompleteQueueRows:source==='scheduled'?scheduledQueueRows:source==='assembly'?assemblyBoardRows:availableQueueRows;
  const row=sourceRows.find(item=>String(item.id)===String(id));
  if(!row||!issueHoldModalBackdrop) return;
  pendingIssueHoldId=String(id);
  pendingIssueHoldSource=source;
  hydrateIssueHoldReasonOptions();
  if(issueHoldTypeInput) issueHoldTypeInput.value=row.holdIssueType||'Unknown / Investigate';
  if(issueHoldNoteInput) issueHoldNoteInput.value=row.holdNote||row.rescheduleNote||'';
  if(issueHoldStartDateInput) issueHoldStartDateInput.value=row.holdStartDate||getTodayIsoDate();
  if(issueHoldModalSummary){issueHoldModalSummary.innerHTML=`<strong>${escapeHtml(row.pb||'Pack Builder')}</strong><div>${escapeHtml(row.account||'—')}</div><div>${Number((row.units!==undefined?row.units:getAssemblyUnits(row))||0).toLocaleString()} units • ${escapeHtml(row.so||'—')}</div>`;}
  issueHoldModalBackdrop.classList.add('show');
}
function closeIssueHoldModal(){
  if(!issueHoldModalBackdrop) return;
  issueHoldModalBackdrop.classList.remove('show');
  pendingIssueHoldId='';
  pendingIssueHoldSource='ready';
  hydrateIssueHoldReasonOptions();
  if(issueHoldTypeInput) issueHoldTypeInput.value='Unknown / Investigate';
  if(issueHoldNoteInput) issueHoldNoteInput.value='';
  if(issueHoldStartDateInput) issueHoldStartDateInput.value=getTodayIsoDate();
}
function confirmIssueHold(){
  const sourceRows=pendingIssueHoldSource==='incomplete'?incompleteQueueRows:pendingIssueHoldSource==='scheduled'?scheduledQueueRows:pendingIssueHoldSource==='assembly'?assemblyBoardRows:availableQueueRows;
  const idx=sourceRows.findIndex(item=>String(item.id)===String(pendingIssueHoldId));
  if(idx<0) return;
  const row=sourceRows[idx];
  const holdStartDate=String(issueHoldStartDateInput?.value||getTodayIsoDate()).trim();
  const holdEntry={
    id:Date.now()+Math.random(),
    sourceId:String(row.id),
    sourceQueue:pendingIssueHoldSource,
    priority:!!row.priority,
    pb:row.pb,
    pbId:row.pbId,
    so:row.so,
    account:row.account,
    qty:Number(row.qty||0),
    products:Number(row.products||0),
    units:Number((row.units!==undefined?row.units:getAssemblyUnits(row))||0),
    ihd:String(row.ihd||'').trim(),
    accountOwner:row.accountOwner||'',
    pdfUrl:row.pdfUrl||'',
    issueType:String(issueHoldTypeInput?.value||'Unknown / Investigate').trim(),
    holdNote:String(issueHoldNoteInput?.value||'').trim(),
    holdDate:new Date().toLocaleDateString('en-US'),
    holdStartDate:holdStartDate,
    holdDays:getDaysOnHold(holdStartDate),
    revenue:Number(getEffectiveSubtotalForRow(row)||row.revenue||0),
    status:'Issue Hold',
    scheduledFor:String(row.scheduledFor||row.date||'').trim(),
    scheduledAt:String(row.scheduledAt||'').trim(),
    scheduleNote:String(row.scheduleNote||row.rescheduleNote||'').trim(),
    sourceStatus:String(row.sourceStatus||row.status||'').trim(),
    stage:String(row.stage||'aa').trim()
  };
  issueHoldQueueRows.unshift(holdEntry);

  if(pendingIssueHoldSource==='scheduled'){
    sourceRows.splice(idx,1);
    assemblyBoardRows=assemblyBoardRows.filter(item=>String(item.id)!==String(row.id));
    saveScheduledQueue();
    saveJson(assemblyBoardStorageKey,assemblyBoardRows);
    renderAssembly();
    renderHome();
    renderCalendar();
  }else if(pendingIssueHoldSource==='assembly'){
    sourceRows.splice(idx,1);
    scheduledQueueRows=scheduledQueueRows.filter(item=>String(item.id)!==String(row.id));
    saveScheduledQueue();
    saveJson(assemblyBoardStorageKey,assemblyBoardRows);
    renderAssembly();
    renderHome();
    renderCalendar();
  }else if(pendingIssueHoldSource==='incomplete'){
    sourceRows.splice(idx,1);
    saveIncompleteQueue();
  }else{
    sourceRows.splice(idx,1);
    saveQueue();
  }
  saveIssueHoldQueue();
  renderQueue();
  closeIssueHoldModal();
}
function releaseIssueHoldRow(id){
  const idx=issueHoldQueueRows.findIndex(item=>String(item.id)===String(id));
  if(idx<0) return;
  const row=issueHoldQueueRows[idx];

  if(row.sourceQueue==='assembly'||row.sourceQueue==='scheduled'){
    const restoredAssembly={
      id:Number(row.sourceId)||Date.now()+Math.random(),
      date:row.scheduledFor||getTodayIsoDate(),
      pb:row.pb,
      so:row.so,
      account:row.account,
      qty:Number(row.qty||0),
      fullQty:Number(row.qty||0),
      isPartial:false,
      products:Number(row.products||0),
      status:'Scheduled',
      ihd:row.ihd||'',
      subtotal:Number(row.revenue||0),
      stage:row.stage||'aa',
      rescheduleNote:row.holdNote||row.scheduleNote||'',
      pbId:row.pbId||'',
      pdfUrl:row.pdfUrl||'',
      workType:'pack_builder',
      externalLink:'',
      accountOwner:row.accountOwner||'',
      sourceQueue:'scheduled',
      sourceStatus:row.sourceStatus||'Scheduled'
    };
    const restoredScheduled={
      id:restoredAssembly.id,
      priority:!!row.priority,
      pb:row.pb,
      pbId:row.pbId||'',
      so:row.so,
      account:row.account,
      qty:Number(row.qty||0),
      products:Number(row.products||0),
      units:Number(row.units||0),
      ihd:row.ihd||'',
      accountOwner:row.accountOwner||'',
      pdfUrl:row.pdfUrl||'',
      scheduledFor:row.scheduledFor||getTodayIsoDate(),
      scheduledAt:new Date().toLocaleString(),
      scheduleNote:row.holdNote||row.scheduleNote||'',
      status:'Scheduled',
      sourceQueue:'scheduled',
      sourceStatus:row.sourceStatus||'Scheduled'
    };
    assemblyBoardRows=assemblyBoardRows.filter(item=>String(item.id)!==String(restoredAssembly.id));
    scheduledQueueRows=scheduledQueueRows.filter(item=>String(item.id)!==String(restoredScheduled.id));
    assemblyBoardRows.unshift(restoredAssembly);
    scheduledQueueRows.unshift(restoredScheduled);
    saveJson(assemblyBoardStorageKey,assemblyBoardRows);
    saveScheduledQueue();
    renderAssembly();
    renderHome();
    renderCalendar();
  }else{
    const target=row.sourceQueue==='incomplete'?incompleteQueueRows:availableQueueRows;
    mergeReturnedQueueRow(target,{priority:row.priority,pb:row.pb,pbId:row.pbId,so:row.so,account:row.account,qty:Number(row.qty||0),products:Number(row.products||0),ihd:row.ihd,accountOwner:row.accountOwner,pdfUrl:row.pdfUrl,status:row.sourceStatus||'Pending Items'});
    if(row.sourceQueue==='incomplete') saveIncompleteQueue(); else saveQueue();
  }

  issueHoldQueueRows.splice(idx,1);
  saveIssueHoldQueue();
  renderQueue();
  if(window.qcc&&typeof window.qcc.applyFilters==='function') window.qcc.applyFilters();
}
function deleteIssueHoldRow(id){
  const idx=issueHoldQueueRows.findIndex(item=>String(item.id)===String(id));
  if(idx<0) return;
  issueHoldQueueRows.splice(idx,1);
  saveIssueHoldQueue();
  renderQueue();
  if(window.qcc&&typeof window.qcc.applyFilters==='function') window.qcc.applyFilters();
}

function deleteQueueRow(id,source='ready'){
  const sourceRows = source==='incomplete'?incompleteQueueRows:availableQueueRows;
  const idx = sourceRows.findIndex(r=>String(r.id)===String(id));
  if(idx<0) return;
  const row = sourceRows[idx];
  if(!confirm(`Delete ${row.pb||'this row'} from ${source} queue?`)) return;
  sourceRows.splice(idx,1);
  if(source==='incomplete') saveIncompleteQueue(); else saveQueue();
  renderQueue();
}

function deleteScheduledQueueRow(id){
  const idx = scheduledQueueRows.findIndex(r=>String(r.id)===String(id));
  if(idx<0) return;
  const row = scheduledQueueRows[idx];
  if(!confirm(`Delete ${row.pb||'this row'} from scheduled list?`)) return;
  scheduledQueueRows.splice(idx,1);
  saveScheduledQueue();
  renderQueue();
  renderHome();
}

function unscheduleQueueRow(id){
  const scheduledMatch=scheduledQueueRows.find(item=>String(item.id)===String(id));
  if(!scheduledMatch) return;

  scheduledQueueRows=scheduledQueueRows.filter(item=>String(item.id)!==String(id));
  assemblyBoardRows=assemblyBoardRows.filter(item=>String(item.id)!==String(id));

  const targetBucket=(scheduledMatch.sourceQueue==='incomplete'||classifyQueueStatus(scheduledMatch.sourceStatus)==='incomplete')?incompleteQueueRows:availableQueueRows;
  mergeReturnedQueueRow(targetBucket,{
    priority:scheduledMatch.priority,
    pb:scheduledMatch.pb,
    pbId:scheduledMatch.pbId,
    so:scheduledMatch.so,
    account:scheduledMatch.account,
    qty:Number(scheduledMatch.qty||0),
    products:Number(scheduledMatch.products||0),
    ihd:scheduledMatch.ihd,
    accountOwner:scheduledMatch.accountOwner,
    pdfUrl:scheduledMatch.pdfUrl,
    status:scheduledMatch.sourceStatus||scheduledMatch.status||''
  });

  updateAllData();
}

function renderRevenueReferenceStats(){
  const uniqueKeys=new Set(revenueReferenceRows.map(row=>row.salesOrder).filter(Boolean));
  const subtotalTotal=revenueReferenceRows.reduce((sum,row)=>sum+Number(row.originalSubtotal||0),0);
  const ihdValues=revenueReferenceRows.map(row=>String(row.ihd||'').trim()).filter(Boolean).sort();
  revenueRowsCount.textContent=revenueReferenceRows.length.toLocaleString();
  revenueKeysCount.textContent=uniqueKeys.size.toLocaleString();
  revenueSubtotalTotal.textContent=subtotalTotal.toLocaleString(undefined,{maximumFractionDigits:0});
  revenueEarliestIhd.textContent=ihdValues.length?ihdValues[0]:'—';
}
function setRevenueImportStatus(message,isError=false){
  if(!revenueImportStatus) return;
  revenueImportStatus.textContent=message;
  revenueImportStatus.style.color=isError?'#b91c1c':'var(--muted)';
  revenueImportStatus.style.borderStyle=isError?'solid':'dashed';
}
async function importRevenueReferenceFromFile(file,{silent=false}={}){
  if(!file){
    setRevenueImportStatus('Choose the revenue reference .xlsx file first.',true);
    if(!silent) alert('Choose the revenue reference .xlsx file first.');
    throw new Error('Choose the revenue reference .xlsx file first.');
  }
  setRevenueImportStatus(`Preparing to import ${file.name}...`);
  try{await ensureXlsxLoaded();}catch(error){console.error(error);setRevenueImportStatus(error.message||'Excel reader failed to load.',true);if(!silent) alert(error.message||'Excel reader failed to load.'); throw error;}
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=(e)=>{
      try{
        const workbook=XLSX.read(new Uint8Array(e.target.result),{type:'array'});
        const firstSheetName=workbook.SheetNames?.[0];
        if(!firstSheetName) throw new Error('No worksheet was found in the revenue file.');
        const sheet=workbook.Sheets[firstSheetName];
        const rows=XLSX.utils.sheet_to_json(sheet,{defval:''});
        const mapped=[];
        rows.forEach(raw=>{
          const salesOrder=String(raw['Sales Order']||raw['Sales Order Name']||raw['SalesOrder']||raw['SORD']||'').trim();
          if(!salesOrder) return;
          const originalSubtotal=Number(raw['Original Subtotal']||raw['Subtotal']||raw['OriginalSubtotal']||0)||0;
          const ihd=String(raw['In Hands Date']||raw['IHD']||raw['In-Hands Date']||raw['Complete Date']||'').trim();
          const account=String(raw['Account']||raw['Account Name']||raw['Account: Account Name']||'').trim();
          mapped.push({id:Date.now()+Math.random(),salesOrder,originalSubtotal,ihd,account});
        });
        revenueReferenceRows=normalizeRevenueReferenceRows(mapped);
        saveRevenueReference();
        renderRevenueReferenceStats();
        const message=`<a class="import-report-link" href="https://swagup.lightning.force.com/lightning/r/Report/00OQm000003BE2jMAG/view?queryScope=userFolders" target="_blank" rel="noopener noreferrer">Revenue reference</a> imported: ${revenueReferenceRows.length} rows stored.`;
        setRevenueImportStatus(message);
        if(!silent) alert(message);
        try { localStorage.setItem(revenueImportMetaKey, JSON.stringify({ fileName: file.name, importedAt: new Date().toISOString(), rows: revenueReferenceRows.length })); } catch(_){}
        resolve({rows:revenueReferenceRows.length,message});
      } catch(error){
        console.error(error);
        setRevenueImportStatus(error.message||'The revenue reference could not be read.',true);
        if(!silent) alert(error.message||'The revenue reference could not be read.');
        reject(error);
      }
    };
    reader.onerror=()=>{const error=new Error('The file could not be opened by the browser.');setRevenueImportStatus(error.message,true);if(!silent) alert(error.message);reject(error);};
    reader.readAsArrayBuffer(file);
  });
}
async function importRevenueReference(){
  const file=revenueFileInput?.files?.[0];
  try{ await importRevenueReferenceFromFile(file,{silent:false}); } catch(_error){}
}
function clearRevenueReference(){
  const confirmed=confirm('Clear the stored revenue reference data?');
  if(!confirmed) return;
  revenueReferenceRows=[];
  saveRevenueReference();
  renderRevenueReferenceStats();
  setRevenueImportStatus('<a class="import-report-link" href="https://swagup.lightning.force.com/lightning/r/Report/00OQm000003BE2jMAG/view?queryScope=userFolders" target="_blank" rel="noopener noreferrer">Revenue reference</a> cleared.');
}

function renderQueue(){
  const selectedAssemblyDate=assemblyDateInput?.value||new Date().toISOString().slice(0,10);
  const readyFiltered=getSortedQueueRows(availableQueueRows.filter(matchesQueueSearch));
  const incompleteFiltered=getSortedQueueRows(incompleteQueueRows.filter(matchesQueueSearch));
  const readyVisible=applyQueueLimit(readyFiltered,readyQueueLimit?.value||'10');
  const incompleteVisible=applyQueueLimit(incompleteFiltered,incompleteQueueLimit?.value||'10');
  const readyPriority=availableQueueRows.filter(row=>row.priority).length;
  const incompletePriority=incompleteQueueRows.filter(row=>row.priority).length;
  const allOpenRows=[...availableQueueRows,...incompleteQueueRows];
  const totalUnits=allOpenRows.reduce((sum,row)=>sum+Number(row.units||0),0);
  const readyUnits=availableQueueRows.reduce((sum,row)=>sum+Number(row.units||0),0);
  const pendingUnits=incompleteQueueRows.reduce((sum,row)=>sum+Number(row.units||0),0);
  const scheduledUnits=scheduledQueueRows.reduce((sum,row)=>sum+Number(row.units||0),0);
  const scheduledTodayRows=scheduledQueueRows.filter(row=>String(row.scheduledFor||'')===selectedAssemblyDate);
  const scheduledTodayUnits=scheduledTodayRows.reduce((sum,row)=>sum+Number(row.units||0),0);
  const priorityUnits=allOpenRows.filter(row=>row.priority).reduce((sum,row)=>sum+Number(row.units||0),0);
  const ihdRows=allOpenRows.map(row=>getEffectiveIhdForRow(row)).filter(Boolean);
  const earliest=ihdRows.length?ihdRows.sort()[0]:'—';
  queueImportedCount.textContent=availableQueueRows.length;
  queueIncompleteCount.textContent=incompleteQueueRows.length;
  queueScheduledCount.textContent=scheduledQueueRows.length;
  queueReadyUnitsStat.textContent=readyUnits.toLocaleString();
  queueReadyPbsStat.textContent=availableQueueRows.length.toLocaleString();
  queuePendingUnitsStat.textContent=pendingUnits.toLocaleString();
  queuePendingPbsStat.textContent=incompleteQueueRows.length.toLocaleString();
  queueScheduledUnitsStat.textContent=scheduledUnits.toLocaleString();
  queueScheduledPbsStat.textContent=scheduledQueueRows.length.toLocaleString();
  queueScheduledTodayUnitsStat.textContent=scheduledTodayUnits.toLocaleString();
  queueScheduledTodayPbsStat.textContent=scheduledTodayRows.length.toLocaleString();
  // queueTotalUnits removed to prevent script crash
  queueEarliestIhd.textContent=earliest==='—'?'—':earliest;
  queueRawRowsCount.textContent=queueRawRowCount.toLocaleString();
  queueGroupedRowsCount.textContent=(availableQueueRows.length+incompleteQueueRows.length).toLocaleString();
  // queuePriorityUnits removed to prevent script crash
  queueSortModeLabel.textContent=(queueSortByInput.value||'ihd_asc').startsWith('ihd')?'IHD':(queueSortByInput.value||'').startsWith('units')?'Units':(queueSortByInput.value||'').startsWith('account')?'Account':'Pack Builder';
  if(!readyFiltered.length){
    queueTableBody.innerHTML='<tr><td colspan="13" class="empty">No ready pack builders found for this view.</td></tr>';
  } else {
    queueTableBody.innerHTML=readyVisible.map(row=>{const link=buildSalesforcePbLink(row.pbId,row.pdfUrl);return `<tr><td>${row.priority?'⭐':'—'}</td><td>${escapeHtml(row.pb||'—')}</td><td>${escapeHtml(row.so||'—')}</td><td>${escapeHtml(row.account||'—')}</td><td>${Number(row.qty||0)}</td><td>${Number(row.products||0)}</td><td>${Number(row.units||0).toLocaleString()}</td><td>${escapeHtml(getEffectiveIhdForRow(row)||'—')}</td><td>${escapeHtml(row.status||'—')}</td><td>${renderQueueFlags(row)}</td><td>${escapeHtml(row.accountOwner||'—')}</td><td>${link?`<a class="queue-link" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">Open</a>`:'—'}</td><td><div class="row-actions"><button class="btn secondary" onclick="toggleQueuePriority('${escapeJs(String(row.id))}','ready')">${row.priority?'Unmark':'Priority'}</button><button class="btn warn" onclick="openIssueHoldModal('${escapeJs(String(row.id))}','ready')">Hold</button><button class="btn" onclick="scheduleQueueRow('${escapeJs(String(row.id))}','ready')">Schedule</button></div></td></tr>`}).join('');
  }
  if(!incompleteFiltered.length){
    incompleteQueueTableBody.innerHTML='<tr><td colspan="13" class="empty">No incomplete or pending pack builders found for this view.</td></tr>';
  } else {
    incompleteQueueTableBody.innerHTML=incompleteVisible.map(row=>{const link=buildSalesforcePbLink(row.pbId,row.pdfUrl);return `<tr><td>${row.priority?'⭐':'—'}</td><td>${escapeHtml(row.pb||'—')}</td><td>${escapeHtml(row.so||'—')}</td><td>${escapeHtml(row.account||'—')}</td><td>${Number(row.qty||0)}</td><td>${Number(row.products||0)}</td><td>${Number(row.units||0).toLocaleString()}</td><td>${escapeHtml(getEffectiveIhdForRow(row)||'—')}</td><td>${escapeHtml(row.status||'—')}</td><td>${renderQueueFlags(row)}</td><td>${escapeHtml(row.accountOwner||'—')}</td><td>${link?`<a class="queue-link" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">Open</a>`:'—'}</td><td><div class="row-actions"><button class="btn secondary" onclick="toggleQueuePriority('${escapeJs(String(row.id))}','incomplete')">${row.priority?'Unmark':'Priority'}</button><button class="btn warn" onclick="openIssueHoldModal('${escapeJs(String(row.id))}','incomplete')">Hold</button><button class="btn" onclick="scheduleQueueRow('${escapeJs(String(row.id))}','incomplete')">Schedule</button></div></td></tr>`}).join('');
  }
  const scheduledSorted=getSortedQueueRows(scheduledQueueRows.filter(matchesQueueSearch)).sort((a,b)=>String(b.scheduledAt||'').localeCompare(String(a.scheduledAt||''))||String(a.scheduledFor||'').localeCompare(String(b.scheduledFor||'')));
  const scheduledVisible=applyQueueLimit(scheduledSorted,scheduledQueueLimit?.value||'10');
  scheduledQueueTableBody.innerHTML=scheduledSorted.length?scheduledVisible.map(row=>{const link=buildSalesforcePbLink(row.pbId,row.pdfUrl);return `<tr data-cbkey="${escapeHtml(row.pbId||row.so||'')}"><td>${escapeHtml(row.pb||'—')}</td><td>${escapeHtml(row.so||'—')}</td><td>${escapeHtml(row.account||'—')}</td><td>${Number(row.units||0).toLocaleString()}</td><td>${escapeHtml(row.scheduledFor||'—')}</td><td>${escapeHtml(row.scheduledAt||'—')}</td><td>${renderQueueFlags(row)}</td><td>${escapeHtml(row.scheduleNote||'—')}</td><td>${link?`<a class="queue-link" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">Open</a>`:'—'}</td><td class="cb-cell" data-cbkey="${escapeHtml(row.pbId||row.so||'')}"><span class="cb-badge cb-loading">…</span></td><td><div class="row-actions"><button class="btn secondary" onclick="viewScheduledInAssembly('${escapeJs(String(row.id))}')">View in Assembly</button><button class="btn warn" onclick="openIssueHoldModal('${escapeJs(String(row.id))}','scheduled')">Hold</button><button class="btn secondary" onclick="unscheduleQueueRow('${escapeJs(String(row.id))}')">Unschedule</button><button class="btn danger" onclick="deleteScheduledQueueRow('${escapeJs(String(row.id))}')">Delete</button></div></td></tr>`}).join(''):'<tr><td colspan="10" class="empty">Nothing has been scheduled from the queue yet.</td></tr>';
  renderIssueHoldSection();
}
function setQueueImportStatus(message,isError=false){
  if(!queueImportStatus) return;
  queueImportStatus.textContent=message;
  queueImportStatus.style.color=isError?'#b91c1c':'var(--muted)';
  queueImportStatus.style.borderStyle=isError?'solid':'dashed';
}
function ensureXlsxLoaded(){
  return new Promise((resolve,reject)=>{
    if(typeof XLSX!=='undefined'){resolve();return;}
    const existing=document.querySelector('script[data-xlsx-loader="true"]');
    if(existing){
      existing.addEventListener('load',()=>resolve(),{once:true});
      existing.addEventListener('error',()=>reject(new Error('Excel library failed to load.')),{once:true});
      return;
    }
    const script=document.createElement('script');
    script.src='https://cdn.jsdelivr.net/npm/xlsx/dist/xlsx.full.min.js';
    script.dataset.xlsxLoader='true';
    script.onload=()=>resolve();
    script.onerror=()=>reject(new Error('Excel library failed to load.'));
    document.body.appendChild(script);
  });
}
async function importQueueReportFromFile(file,{silent=false}={}){
  if(!file){
    setQueueImportStatus('Choose the Salesforce .xlsx report first.',true);
    if(!silent) alert('Choose the Salesforce .xlsx report first.');
    throw new Error('Choose the Salesforce .xlsx report first.');
  }
  setQueueImportStatus(`Preparing to import ${file.name}...`);
  try{ await ensureXlsxLoaded(); } catch(error){ console.error(error); setQueueImportStatus(error.message||'Excel reader failed to load.',true); if(!silent) alert(error.message||'Excel reader failed to load.'); throw error; }
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=(e)=>{
      try{
        setQueueImportStatus(`Reading ${file.name}...`);
        const workbook=XLSX.read(new Uint8Array(e.target.result),{type:'array'});
        const firstSheetName=workbook.SheetNames?.[0];
        if(!firstSheetName) throw new Error('No worksheet was found in the file.');
        const sheet=workbook.Sheets[firstSheetName];
        const rows=XLSX.utils.sheet_to_json(sheet,{defval:''});
        queueRawRowCount=rows.length;
        setQueueImportStatus(`Worksheet loaded: ${rows.length} raw rows found.`);
        const grouped=new Map();
        rows.forEach(raw=>{
          const pb=String(raw['Pack Builder Name']||raw['Pack Builder']||'').trim();
          if(!pb) return;
          const pbId=String(raw['Pack Builder ID']||'').trim();
          const so=String(raw['Sales Order: Sales Order Name']||raw['Sales Order Name']||'').trim();
          const account=String(raw['Account']||raw['Account Product: Account Product Name']||'').trim();
          const qty=Number(raw['Quantity']||0)||0;
          const products=Number(raw['Total Unique Products']||raw['Products']||0)||0;
          const ihd=String(raw['In Hands Date']||raw['IHD']||raw['Complete Date']||'').trim();
          const accountOwner=String(raw['Account Owner']||'').trim();
          const pdfUrl=String(raw['Pack Builder PDF URL']||'').trim();
          const status=String(raw['Status']||'').trim();
          const key=(pbId||pb).trim();
          if(!grouped.has(key)){
            grouped.set(key,{id:key||Date.now()+Math.random(),priority:false,pb,pbId,so,account,qty,products,units:qty*products,ihd,accountOwner,pdfUrl,status});
          } else {
            const current=grouped.get(key);
            current.qty=Math.max(current.qty,qty);
            current.products=Math.max(current.products,products);
            current.units=current.qty*current.products;
            if(!current.so&&so) current.so=so;
            if(!current.account&&account) current.account=account;
            if(!current.ihd&&ihd) current.ihd=ihd;
            if(!current.accountOwner&&accountOwner) current.accountOwner=accountOwner;
            if(!current.pdfUrl&&pdfUrl) current.pdfUrl=pdfUrl;
            if(!current.pbId&&pbId) current.pbId=pbId;
            if(!current.status&&status) current.status=status;
          }
        });
        const importedKeys=new Set(grouped.keys());
        const readyMap=new Map(availableQueueRows.map(item=>[String(item.pbId||item.pb||'').trim(),item]));
        const incompleteMap=new Map(incompleteQueueRows.map(item=>[String(item.pbId||item.pb||'').trim(),item]));
        const scheduledMap=new Map(scheduledQueueRows.map(item=>[String(item.pbId||item.pb||'').trim(),item]));
        const applyUpdate=(target,imported)=>{
          target.pb=imported.pb||target.pb; target.pbId=imported.pbId||target.pbId; target.so=imported.so||target.so; target.account=imported.account||target.account;
          target.qty=Number(imported.qty||0); target.products=Number(imported.products||0); target.units=Number(imported.units||0); target.ihd=imported.ihd||target.ihd;
          target.accountOwner=imported.accountOwner||target.accountOwner; target.pdfUrl=imported.pdfUrl||target.pdfUrl; target.status=imported.status||target.status;
        };
        let addedCount=0; let updatedCount=0; const nextReady=[]; const nextIncomplete=[];
        grouped.forEach((imported,key)=>{
          const bucket=classifyQueueStatus(imported.status);
          const scheduledExisting=scheduledMap.get(key);
          if(scheduledExisting){ applyUpdate(scheduledExisting,imported); updatedCount+=1; return; }
          const existing=readyMap.get(key)||incompleteMap.get(key);
          const record=existing?{...existing}:{...imported};
          applyUpdate(record,imported);
          if(existing) updatedCount+=1; else addedCount+=1;
          if(bucket==='ready') nextReady.push(record); else nextIncomplete.push(record);
        });
        availableQueueRows=nextReady;
        incompleteQueueRows=nextIncomplete;
        scheduledQueueRows=scheduledQueueRows.filter(item=>importedKeys.has(String(item.pbId||item.pb||'').trim())||String(item.scheduledFor||'').trim());
        saveQueue(); saveIncompleteQueue(); saveScheduledQueue(); renderQueue();
        const successMsg=`Import complete: ${addedCount} new pack builders added, ${updatedCount} existing pack builders updated, from ${queueRawRowCount} raw rows.`;
        setQueueImportStatus(successMsg);
        if(!silent) alert(successMsg);
        try { localStorage.setItem(queueImportMetaKey, JSON.stringify({ fileName: file.name, importedAt: new Date().toISOString(), rows: queueRawRowCount })); } catch(_){}
        resolve({rows: queueRawRowCount, addedCount, updatedCount, message: successMsg});
      } catch(error){
        console.error(error);
        setQueueImportStatus(error.message||'The report could not be read.',true);
        if(!silent) alert(error.message||'The report could not be read. Make sure it is the Salesforce Details Only Excel export.');
        reject(error);
      }
    };
    reader.onerror=()=>{const error=new Error('The file could not be opened by the browser.'); setQueueImportStatus(error.message,true); if(!silent) alert(error.message); reject(error);};
    reader.readAsArrayBuffer(file);
  });
}
async function importQueueReport(){
  const file=queueFileInput?.files?.[0];
  try{ await importQueueReportFromFile(file,{silent:false}); } catch(_error){}
}
function clearQueue(){const confirmed=confirm('Clear the ready and incomplete pack builder queues?');if(!confirmed) return;availableQueueRows=[];incompleteQueueRows=[];queueRawRowCount=0;saveQueue();saveIncompleteQueue();renderQueue()}
function toggleQueuePriority(id,source='ready'){const sourceRows=source==='incomplete'?incompleteQueueRows:availableQueueRows;const row=sourceRows.find(item=>String(item.id)===String(id));if(!row) return;row.priority=!row.priority;if(source==='incomplete')saveIncompleteQueue();else saveQueue();renderQueue()}
function openScheduleModal(id,source='ready'){
  const sourceRows=source==='incomplete'?incompleteQueueRows:availableQueueRows;
  const row=sourceRows.find(item=>String(item.id)===String(id));
  if(!row) return;
  pendingScheduleQueueId=String(id);
  pendingScheduleSource=source;
  pendingRescheduleAssemblyId='';
  const suggestedDate=assemblyDateInput.value||new Date().toISOString().slice(0,10);
  scheduleModalDate.value=suggestedDate;
  scheduleModalNote.value='';
  scheduleModeInput.value='full';
  scheduleQtyInput.value=Number(row.qty||0);
  scheduleFullQtyInput.value=Number(row.qty||0);
  scheduleRemainderToggleInput.value='false';
  scheduleRemainderDateInput.value='';
  scheduleModalSummary.innerHTML=`<strong>${escapeHtml(row.pb||'Pack Builder')}</strong><div>${escapeHtml(row.account||'—')}</div><div>${Number(row.units||0).toLocaleString()} units • ${escapeHtml(row.so||'—')}</div>`;
  scheduleModalBackdrop.classList.add('show');
}
function openRescheduleModal(id){
  const row=assemblyBoardRows.find(item=>String(item.id)===String(id));
  if(!row) return;
  pendingRescheduleAssemblyId=String(id);
  pendingScheduleQueueId='';
  scheduleModalDate.value=row.date||assemblyDateInput.value||new Date().toISOString().slice(0,10);
  scheduleModalNote.value=row.rescheduleNote||'';
  scheduleModalSummary.innerHTML=`<strong>Reschedule ${escapeHtml(row.pb||'Pack Builder')}</strong><div>${escapeHtml(row.account||'—')}</div><div>${Number(getAssemblyUnits(row)||0).toLocaleString()} units • ${escapeHtml(row.so||'—')}</div>`;
  scheduleModalBackdrop.classList.add('show');
}
function closeScheduleModal(){
  scheduleModalBackdrop.classList.remove('show');
  pendingScheduleQueueId='';
  pendingRescheduleAssemblyId='';
  scheduleModeInput.value='full';
  scheduleQtyInput.value=0;
  scheduleFullQtyInput.value=0;
  scheduleRemainderToggleInput.value='false';
  scheduleRemainderDateInput.value='';
}
function confirmSchedule(){
  const trimmedDate=String(scheduleModalDate.value||'').trim();
  const parts=trimmedDate.split('-');
  if(parts.length!==3 || parts[0].length!==4 || parts[1].length!==2 || parts[2].length!==2){
    alert('Choose a valid Assembly date first.');
    return;
  }
  const note=String(scheduleModalNote.value||'').trim();

  if(pendingRescheduleAssemblyId){
    const row=assemblyBoardRows.find(item=>String(item.id)===String(pendingRescheduleAssemblyId));
    if(!row) return;
    row.date=trimmedDate;
    row.rescheduleNote=note;
    const revenueMatch=getRevenueReferenceForSalesOrder(row.so||'');
    if(revenueMatch){
      row.subtotal=Number(revenueMatch.originalSubtotal||row.subtotal||0);
      if(!row.ihd || row.ihd!==revenueMatch.ihd) row.ihd=revenueMatch.ihd||row.ihd;
    }
    const scheduledMatch=scheduledQueueRows.find(item=>String(item.id)===String(row.id));
    if(scheduledMatch){
      scheduledMatch.scheduledFor=trimmedDate;
      scheduledMatch.scheduleNote=note;
      scheduledMatch.ihd=getEffectiveIhdForRow(row)||scheduledMatch.ihd||'';
      saveScheduledQueue();
    }
    saveJson(assemblyBoardStorageKey,assemblyBoardRows);
    assemblyDateInput.value=trimmedDate;
    renderAssembly();
    renderHome();
    renderQueue();
    closeScheduleModal();
    return;
  }

  const scheduleSourceRows=pendingScheduleSource==='incomplete'?incompleteQueueRows:availableQueueRows;
  const row=scheduleSourceRows.find(item=>String(item.id)===String(pendingScheduleQueueId));
  if(!row) return;

  const fullQty=Number(row.qty||0);
  const mode=scheduleModeInput.value||'full';
  const scheduledQty=mode==='partial' ? Number(scheduleQtyInput.value||0) : fullQty;
  if(scheduledQty<=0){
    alert('Scheduled Qty must be greater than 0.');
    return;
  }
  if(scheduledQty>fullQty){
    alert('Scheduled Qty cannot be greater than the full quantity.');
    return;
  }

  const revenueMatch=getRevenueReferenceForSalesOrder(row.so||'');
  const matchedSubtotal=Number(revenueMatch?.originalSubtotal||0);
  const matchedIhd=String(revenueMatch?.ihd||row.ihd||'').trim();
  if(matchedIhd) row.ihd=matchedIhd;

  const isPartial=mode==='partial' && scheduledQty<fullQty;
  const remainderQty=Math.max(0,fullQty-scheduledQty);
  const shouldScheduleRemainder=isPartial && scheduleRemainderToggleInput.value==='true';
  const remainderDate=String(scheduleRemainderDateInput.value||'').trim();
  if(shouldScheduleRemainder){
    const remainderParts=remainderDate.split('-');
    if(remainderParts.length!==3 || remainderParts[0].length!==4 || remainderParts[1].length!==2 || remainderParts[2].length!==2){
      alert('Choose a valid remainder date.');
      return;
    }
  }

  const sourceQueue=pendingScheduleSource;
  const sourceStatus=row.status||'';
  const sourcePriority=!!row.priority;
  const sourceAccountOwner=row.accountOwner||'';
  const sourcePdfUrl=row.pdfUrl||'';
  const sourcePbId=row.pbId||'';

  const mainRow={
    id:Date.now()+Math.random(),
    date:trimmedDate,
    pb:row.pb,
    so:row.so,
    account:row.account,
    qty:scheduledQty,
    fullQty:fullQty,
    isPartial:isPartial,
    products:Number(row.products||0),
    status:'Scheduled',
    ihd:matchedIhd,
    subtotal:matchedSubtotal,
    stage:'aa',
    rescheduleNote:note,
    pbId:sourcePbId,
    pdfUrl:sourcePdfUrl,
    workType:'pack_builder',
    externalLink:'',
    accountOwner:sourceAccountOwner,
    sourceQueue:sourceQueue,
    sourceStatus:sourceStatus
  };
  assemblyBoardRows.unshift(mainRow);

  const scheduledAtText=new Date().toLocaleString();
  scheduledQueueRows.unshift({
    id:mainRow.id,
    priority:sourcePriority,
    pb:mainRow.pb,
    pbId:mainRow.pbId,
    so:mainRow.so,
    account:mainRow.account,
    qty:Number(mainRow.qty||0),
    products:Number(mainRow.products||0),
    units:getAssemblyUnits(mainRow),
    ihd:mainRow.ihd||'',
    accountOwner:sourceAccountOwner,
    pdfUrl:mainRow.pdfUrl,
    scheduledFor:mainRow.date,
    scheduledAt:scheduledAtText,
    scheduleNote:mainRow.rescheduleNote,
    status:mainRow.status,
    sourceQueue:sourceQueue,
    sourceStatus:sourceStatus
  });

  if(shouldScheduleRemainder && remainderQty>0){
    const remainderRow={
      id:Date.now()+Math.random(),
      date:remainderDate,
      pb:row.pb,
      so:row.so,
      account:row.account,
      qty:remainderQty,
      fullQty:fullQty,
      isPartial:true,
      products:Number(row.products||0),
      status:'Scheduled',
      ihd:matchedIhd,
      subtotal:matchedSubtotal,
      stage:'aa',
      rescheduleNote:`Remainder from ${trimmedDate}${note?` • ${note}`:''}`,
      pbId:sourcePbId,
      pdfUrl:sourcePdfUrl,
      workType:'pack_builder',
      externalLink:'',
      sourceQueue:sourceQueue,
      sourceStatus:sourceStatus
    };
    assemblyBoardRows.unshift(remainderRow);
    scheduledQueueRows.unshift({
      id:remainderRow.id,
      priority:sourcePriority,
      pb:remainderRow.pb,
      pbId:remainderRow.pbId,
      so:remainderRow.so,
      account:remainderRow.account,
      qty:Number(remainderRow.qty||0),
      products:Number(remainderRow.products||0),
      units:getAssemblyUnits(remainderRow),
      ihd:remainderRow.ihd||'',
      accountOwner:sourceAccountOwner,
      pdfUrl:remainderRow.pdfUrl,
      scheduledFor:remainderRow.date,
      scheduledAt:scheduledAtText,
      scheduleNote:remainderRow.rescheduleNote,
      status:remainderRow.status,
      sourceQueue:sourceQueue,
      sourceStatus:sourceStatus
    });
  }

  if(isPartial && !shouldScheduleRemainder && remainderQty>0){
    row.qty=remainderQty;
    row.units=Number(remainderQty||0)*Number(row.products||0);
    row.ihd=matchedIhd||row.ihd||'';
    if(sourceQueue==='incomplete') saveIncompleteQueue(); else saveQueue();
  } else {
    if(sourceQueue==='incomplete'){
      incompleteQueueRows=incompleteQueueRows.filter(item=>String(item.id)!==String(row.id));
      saveIncompleteQueue();
    } else {
      availableQueueRows=availableQueueRows.filter(item=>String(item.id)!==String(row.id));
      saveQueue();
    }
  }

  saveJson(assemblyBoardStorageKey,assemblyBoardRows);
  saveScheduledQueue();
  assemblyDateInput.value=trimmedDate;
  renderAssembly();
  renderHome();
  renderCalendar();
  renderQueue();
  closeScheduleModal();
}
function scheduleQueueRow(id,source='ready'){openScheduleModal(id,source)}
window.toggleQueuePriority=toggleQueuePriority;
window.scheduleQueueRow=scheduleQueueRow;
window.openScheduleModal=openScheduleModal;
window.openRescheduleModal=openRescheduleModal;
window.closeScheduleModal=closeScheduleModal;
window.confirmSchedule=confirmSchedule;
window.viewScheduledInAssembly=viewScheduledInAssembly;
window.openIssueHoldModal=openIssueHoldModal;
window.closeIssueHoldModal=closeIssueHoldModal;
window.confirmIssueHold=confirmIssueHold;
window.releaseIssueHoldRow=releaseIssueHoldRow;
window.deleteIssueHoldRow=deleteIssueHoldRow;
window.getIssueHoldQueueRows=function(){ return issueHoldQueueRows; };
window.unscheduleQueueRow=unscheduleQueueRow;
window.deleteScheduledQueueRow=deleteScheduledQueueRow;

// ── Bulk Schedule ─────────────────────────────────────────────
let _bulkPendingItems = []; // [{id, source, row}]

function openBulkScheduleModal(items) {
  // items: array of {id, source} where source is 'ready' or 'incomplete'
  _bulkPendingItems = [];
  items.forEach(function(item) {
    const sourceRows = item.source === 'incomplete' ? incompleteQueueRows : availableQueueRows;
    const row = sourceRows.find(function(r){ return String(r.id) === String(item.id); });
    if (row) _bulkPendingItems.push({ id: item.id, source: item.source, row });
  });
  if (!_bulkPendingItems.length) return;

  // Set suggested date
  const suggestedDate = assemblyDateInput ? assemblyDateInput.value : new Date().toISOString().slice(0,10);
  const dateEl = document.getElementById('bulkScheduleDate');
  const noteEl = document.getElementById('bulkScheduleNote');
  if (dateEl) dateEl.value = suggestedDate;
  if (noteEl) noteEl.value = '';

  // Render PB list + stats
  window.renderBulkScheduleList();
  window.updateBulkScheduleBtn();

  // Open modal
  const backdrop = document.getElementById('bulkScheduleModalBackdrop');
  if (backdrop) backdrop.classList.add('show');
}

window.renderBulkScheduleList = function() {
  const list = document.getElementById('bulkScheduleList');
  const titleEl = document.getElementById('bulkScheduleTitle');
  const countEl = document.getElementById('bulkStatCount');
  const unitsEl = document.getElementById('bulkStatUnits');
  const packsEl = document.getElementById('bulkStatPacks');
  if (!list) return;

  let totalUnits = 0, totalPacks = 0;
  _bulkPendingItems.forEach(function(item) {
    totalUnits += Number(item.row.units || 0);
    totalPacks += Number(item.row.qty || item.row.packs || 0);
  });

  const count = _bulkPendingItems.length;
  if (titleEl) titleEl.textContent = 'Schedule ' + count + ' pack builder' + (count !== 1 ? 's' : '');
  if (countEl) countEl.textContent = count;
  if (unitsEl) unitsEl.textContent = totalUnits.toLocaleString();
  if (packsEl) packsEl.textContent = totalPacks.toLocaleString();

  list.innerHTML = _bulkPendingItems.map(function(item, idx) {
    const r = item.row;
    return '<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;border:1px solid var(--blue2);background:var(--card);">' +
      '<div style="flex:1;min-width:0;">' +
        '<div style="font-size:12px;font-weight:800;color:var(--text);">' + escapeHtml(r.pb || '—') + '</div>' +
        '<div style="font-size:11px;color:var(--muted);">' + escapeHtml(r.account || '—') + '</div>' +
      '</div>' +
      '<div style="font-size:12px;color:var(--muted);text-align:right;white-space:nowrap;">' +
        Number(r.units||0).toLocaleString() + 'u · ' + Number(r.qty||0) + ' packs' +
      '</div>' +
      '<button onclick="window.removeBulkItem(' + idx + ')" title="Remove" ' +
        'style="width:20px;height:20px;border-radius:50%;border:1px solid var(--blue2);background:none;cursor:pointer;font-size:13px;color:var(--muted);display:flex;align-items:center;justify-content:center;flex-shrink:0;">' +
        '&#215;' +
      '</button>' +
    '</div>';
  }).join('');
};

window.removeBulkItem = function(idx) {
  _bulkPendingItems.splice(idx, 1);
  if (_bulkPendingItems.length === 0) {
    window.closeBulkScheduleModal();
    return;
  }
  window.renderBulkScheduleList();
  window.updateBulkScheduleBtn();
};

window.updateBulkScheduleBtn = function() {
  const btn = document.getElementById('bulkScheduleConfirmBtn');
  const date = (document.getElementById('bulkScheduleDate') || {}).value || '';
  const count = _bulkPendingItems.length;
  if (!btn) return;
  const ready = date.length === 10 && count > 0;
  btn.disabled = !ready;
  btn.textContent = 'Schedule all ' + count;
};

window.closeBulkScheduleModal = function() {
  const backdrop = document.getElementById('bulkScheduleModalBackdrop');
  if (backdrop) backdrop.classList.remove('show');
  _bulkPendingItems = [];
  // Do NOT clear QCC_SELECTED — user may want to retry or cancel via the bulk bar
};

window.confirmBulkSchedule = function() {
  const dateEl = document.getElementById('bulkScheduleDate');
  const noteEl = document.getElementById('bulkScheduleNote');
  const trimmedDate = String((dateEl || {}).value || '').trim();
  const parts = trimmedDate.split('-');
  if (parts.length !== 3 || parts[0].length !== 4) {
    alert('Choose a valid Assembly date first.');
    return;
  }
  const note = String((noteEl || {}).value || '').trim();

  _bulkPendingItems.forEach(function(item) {
    const r = item.row;
    const revenueMatch = getRevenueReferenceForSalesOrder(r.so || '');
    const matchedSubtotal = Number(revenueMatch && revenueMatch.originalSubtotal || 0);
    const matchedIhd = String(revenueMatch && revenueMatch.ihd || r.ihd || '').trim();
    if (matchedIhd) r.ihd = matchedIhd;

    const newRow = {
      id: Date.now() + Math.random(),
      date: trimmedDate,
      pb: r.pb, so: r.so, account: r.account,
      qty: Number(r.qty || 0),
      fullQty: Number(r.qty || 0),
      isPartial: false,
      products: Number(r.products || 0),
      status: 'Scheduled',
      ihd: matchedIhd || r.ihd || '',
      subtotal: matchedSubtotal,
      stage: 'aa',
      rescheduleNote: note,
      pbId: r.pbId || '',
      pdfUrl: r.pdfUrl || '',
      workType: 'pack_builder',
      externalLink: '',
      accountOwner: r.accountOwner || '',
      sourceQueue: item.source,
      sourceStatus: r.status || '',
    };
    assemblyBoardRows.unshift(newRow);

    // Also add to scheduledQueueRows
    const scheduledEntry = Object.assign({}, r, {
      scheduledFor: trimmedDate,
      scheduledAt: new Date().toISOString().slice(0,10),
      scheduleNote: note,
      ihd: matchedIhd || r.ihd || '',
    });
    scheduledQueueRows.unshift(scheduledEntry);

    // Remove from source queue
    if (item.source === 'incomplete') {
      incompleteQueueRows = incompleteQueueRows.filter(function(x){ return String(x.id) !== String(item.id); });
    } else {
      availableQueueRows = availableQueueRows.filter(function(x){ return String(x.id) !== String(item.id); });
    }
  });

  saveScheduledQueue();
  saveQueue();
  saveIncompleteQueue();
  saveJson(assemblyBoardStorageKey, assemblyBoardRows);
  if (assemblyDateInput) assemblyDateInput.value = trimmedDate;
  renderAssembly();
  renderHome();
  renderQueue();
  window.closeBulkScheduleModal();
};

window.openBulkScheduleModal = openBulkScheduleModal;

if(issueHoldQueueLimit){issueHoldQueueLimit.addEventListener('change',renderQueue);}
if(closeIssueHoldBtn){closeIssueHoldBtn.addEventListener('click',closeIssueHoldModal);}
if(cancelIssueHoldBtn){cancelIssueHoldBtn.addEventListener('click',closeIssueHoldModal);}
if(confirmIssueHoldBtn){confirmIssueHoldBtn.addEventListener('click',confirmIssueHold);}


hydrateIssueHoldReasonOptions();
if(issueHoldStartDateInput && !issueHoldStartDateInput.value) issueHoldStartDateInput.value=getTodayIsoDate();

window.importQueueReportFromFile = importQueueReportFromFile;
window.importRevenueReferenceFromFile = importRevenueReferenceFromFile;
window.clearQueueSilent = function(){
  availableQueueRows=[];incompleteQueueRows=[];queueRawRowCount=0;
  saveQueue();saveIncompleteQueue();renderQueue();
};
window.clearRevenueReferenceSilent = function(){
  revenueReferenceRows=[];
  saveRevenueReference();
  renderRevenueReferenceStats();
  setRevenueImportStatus('Revenue reference cleared.');
};

// ── Comment badge loader for Scheduled Queue (uses shared batch cache) ────
async function renderQueueCommentBadges() {
  // Use the shared batch loaded by assembly.js — triggers a load if stale
  if (typeof _loadCommentBatch === 'function') await _loadCommentBatch();
  _applyBadgesToCells('#scheduledQueueTableBody .cb-cell');
  // Mobile cards in queue
  document.querySelectorAll('#scheduledQueueMobCards .cb-cell, #scheduledQueueMobCards .cb-badge').forEach(el => {
    const key = el.dataset.cbkey || '';
    if (!key) return;
    const data = window._cmBatchData || { counts:{}, hasPriority:{} };
    const count = data.counts[key] || 0;
    const isPri = data.hasPriority[key] || false;
    el.classList.remove('cb-loading');
    if (count > 0) {
      el.className = `cb-badge cb-has${isPri ? ' cb-priority' : ''}`;
      el.textContent = `💬 ${count}`;
    } else {
      el.className = 'cb-badge cb-none';
      el.textContent = '—';
    }
  });
}
window.renderQueueCommentBadges = renderQueueCommentBadges;

// Hook into renderQueue so badges always load after render
const _origRenderQueue = window.renderQueue || (typeof renderQueue !== 'undefined' ? renderQueue : null);
if (_origRenderQueue && !window._queueCommentHooked) {
  window._queueCommentHooked = true;
  const _patchedRenderQueue = function(...args) {
    _origRenderQueue.apply(this, args);
    renderQueueCommentBadges();
  };
  window.renderQueue = _patchedRenderQueue;
}

// ── Phase 2: Mobile card views for Queue sections ─────────────────────────
function buildReadyQueueCard(row, source) {
  const link = buildSalesforcePbLink(row.pbId, row.pdfUrl);
  const id   = escapeJs(String(row.id));
  const ihd  = escapeHtml(getEffectiveIhdForRow(row)||'—');
  const scheduleLabel = source==='incomplete' ? 'Schedule' : 'Schedule';
  return `<div class="mob-card">
    <div class="mob-card-header">
      <div class="mob-card-title">
        <span class="mob-card-pb">${escapeHtml(row.pb||'—')}${row.priority?' ⭐':''}</span>
        <span class="mob-card-account">${escapeHtml(row.account||'—')}</span>
      </div>
      <span class="mob-stage-badge mob-stage-stage-mid">${escapeHtml(row.status||'—')}</span>
    </div>
    <div class="mob-card-meta">
      <div class="mob-meta-item"><span class="mob-meta-label">Units</span><strong>${Number(row.units||0).toLocaleString()}</strong></div>
      <div class="mob-meta-item"><span class="mob-meta-label">IHD</span><strong>${ihd}</strong></div>
      <div class="mob-meta-item"><span class="mob-meta-label">SO</span><strong>${escapeHtml(row.so||'—')}</strong></div>
      <div class="mob-meta-item"><span class="mob-meta-label">Owner</span><strong>${escapeHtml(row.accountOwner||'—')}</strong></div>
    </div>
    <div class="mob-card-actions">
      ${link?`<a class="mob-action-btn mob-action-secondary" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">Open</a>`:''}
      <button class="mob-action-btn mob-action-secondary" onclick="toggleQueuePriority('${id}','${source}')">${row.priority?'Unmark':'Priority'}</button>
      <button class="mob-action-btn mob-action-warn" onclick="openIssueHoldModal('${id}','${source}')">Hold</button>
      <button class="mob-action-btn mob-action-primary" onclick="scheduleQueueRow('${id}','${source}')">${scheduleLabel}</button>
    </div>
  </div>`;
}

function buildScheduledQueueCard(row) {
  const link = buildSalesforcePbLink(row.pbId, row.pdfUrl);
  const id   = escapeJs(String(row.id));
  const cbKey = escapeHtml(row.pbId||row.so||'');
  return `<div class="mob-card" data-cbkey="${cbKey}">
    <div class="mob-card-header">
      <div class="mob-card-title">
        <span class="mob-card-pb">${escapeHtml(row.pb||'—')}</span>
        <span class="mob-card-account">${escapeHtml(row.account||'—')}</span>
      </div>
      <span class="mob-stage-badge mob-stage-stage-mid">${escapeHtml(row.scheduledFor||'—')}</span>
    </div>
    <div class="mob-card-meta">
      <div class="mob-meta-item"><span class="mob-meta-label">Units</span><strong>${Number(row.units||0).toLocaleString()}</strong></div>
      <div class="mob-meta-item"><span class="mob-meta-label">SO</span><strong>${escapeHtml(row.so||'—')}</strong></div>
      <div class="mob-meta-item"><span class="mob-meta-label">Note</span><strong>${escapeHtml(row.scheduleNote||'—')}</strong></div>
      <div class="mob-meta-item"><span class="mob-meta-label">Comments</span><span class="cb-cell cb-badge cb-loading" data-cbkey="${cbKey}">…</span></div>
    </div>
    <div class="mob-card-actions">
      ${link?`<a class="mob-action-btn mob-action-secondary" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">Open</a>`:''}
      <button class="mob-action-btn mob-action-secondary" onclick="viewScheduledInAssembly('${id}')">View</button>
      <button class="mob-action-btn mob-action-warn" onclick="openIssueHoldModal('${id}','scheduled')">Hold</button>
      <button class="mob-action-btn mob-action-secondary" onclick="unscheduleQueueRow('${id}')">Unschedule</button>
      <button class="mob-action-btn mob-action-danger" onclick="deleteScheduledQueueRow('${id}')">Delete</button>
    </div>
  </div>`;
}

function renderQueueCardViews(readyRows, incompleteRows, scheduledRows) {
  const rc = document.getElementById('readyQueueCards');
  const ic = document.getElementById('incompleteQueueCards');
  const sc = document.getElementById('scheduledQueueCards');
  if (rc) rc.innerHTML = readyRows.length
    ? readyRows.map(r=>buildReadyQueueCard(r,'ready')).join('')
    : '<p class="mob-empty">No ready pack builders.</p>';
  if (ic) ic.innerHTML = incompleteRows.length
    ? incompleteRows.map(r=>buildReadyQueueCard(r,'incomplete')).join('')
    : '<p class="mob-empty">No incomplete pack builders.</p>';
  if (sc) sc.innerHTML = scheduledRows.length
    ? scheduledRows.map(r=>buildScheduledQueueCard(r)).join('')
    : '<p class="mob-empty">Nothing scheduled yet.</p>';
}
window.renderQueueCardViews = renderQueueCardViews;

// Export data arrays so queue-command-center.js can read them
Object.defineProperty(window, 'availableQueueRows',  { get: function(){ return availableQueueRows;  }, configurable:true });
Object.defineProperty(window, 'incompleteQueueRows', { get: function(){ return incompleteQueueRows; }, configurable:true });
Object.defineProperty(window, 'scheduledQueueRows',  { get: function(){ return scheduledQueueRows;  }, configurable:true });
Object.defineProperty(window, 'issueHoldQueueRows',  { get: function(){ return issueHoldQueueRows;  }, configurable:true });

// Export renderQueue so command center can hook it
window.renderQueue = renderQueue;
const _origRenderQueuePhase2 = window.renderQueue || (typeof renderQueue!=='undefined'?renderQueue:null);
if (_origRenderQueuePhase2 && !window._queuePhase2Hooked) {
  window._queuePhase2Hooked = true;
  const _patchedQueue = function(...args) {
    _origRenderQueuePhase2.apply(this, args);
    // Pass current visible rows for cards
    if (typeof availableQueueRows !== 'undefined' &&
        typeof incompleteQueueRows !== 'undefined' &&
        typeof scheduledQueueRows !== 'undefined') {
      const limit = v => { try { return v; } catch(e) { return v; } };
      renderQueueCardViews(
        limit(availableQueueRows),
        limit(incompleteQueueRows),
        limit(scheduledQueueRows)
      );
      if (typeof renderQueueCommentBadges === 'function') renderQueueCommentBadges();
    }
  };
  window.renderQueue = _patchedQueue;
}
