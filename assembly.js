// ===== ASSEMBLY MODULE (Phase split) =====

const assemblyDateInput=document.getElementById('assemblyDate');
const assemblyPrevDayBtn=document.getElementById('assemblyPrevDayBtn');
const assemblyNextDayBtn=document.getElementById('assemblyNextDayBtn');
const assemblySelectedDatePill=document.getElementById('assemblySelectedDatePill');
const assemblyWorkTypeInput=document.getElementById('assemblyWorkType');
const assemblyPbInput=document.getElementById('assemblyPb');
const assemblySoInput=document.getElementById('assemblySo');
const assemblyAccountInput=document.getElementById('assemblyAccount');
const assemblyQtyInput=document.getElementById('assemblyQty');
const assemblyFullQtyInput=document.getElementById('assemblyFullQty');
const assemblyProductsInput=document.getElementById('assemblyProducts');
const assemblyStatusInput=document.getElementById('assemblyStatus');
const assemblyIhdInput=document.getElementById('assemblyIhd');
const assemblyExternalLinkInput=document.getElementById('assemblyExternalLink');
const assemblyStageInput=document.getElementById('assemblyStage');
const assemblyIsPartialInput=document.getElementById('assemblyIsPartial');
const assemblyUnitsPreview=document.getElementById('assemblyUnitsPreview');
const assemblyBoardBody=document.getElementById('assemblyBoardBody');
const assemblyBoardCountPill=document.getElementById('assemblyBoardCountPill');
const assemblyHeadcountInput=document.getElementById('assemblyHeadcount');
const assemblyHoursInput=document.getElementById('assemblyHours');
const assemblyUphInput=document.getElementById('assemblyUph');
const assemblyScheduledPbInput=document.getElementById('assemblyScheduledPb');
const assemblyHeadcountStat=document.getElementById('assemblyHeadcountStat');
const assemblyHoursStat=document.getElementById('assemblyHoursStat');
const assemblyUphStat=document.getElementById('assemblyUphStat');
const assemblyCapacityStat=document.getElementById('assemblyCapacityStat');
const assemblyCapacityDisplay=document.getElementById('assemblyCapacityDisplay');
const assemblyScheduledPbDisplay=document.getElementById('assemblyScheduledPbDisplay');
const assemblyAaUnits=document.getElementById('assemblyAaUnits');
const assemblyPrintUnits=document.getElementById('assemblyPrintUnits');
const assemblyPickedUnits=document.getElementById('assemblyPickedUnits');
const assemblyLineUnits=document.getElementById('assemblyLineUnits');
const assemblyDpmoUnits=document.getElementById('assemblyDpmoUnits');
const assemblyDoneUnits=document.getElementById('assemblyDoneUnits');
const assemblyHoursElapsedInput=document.getElementById('assemblyHoursElapsed');
const assemblyCurrentUphDisplay=document.getElementById('assemblyCurrentUphDisplay');
const assemblyGoalProgressDisplay=document.getElementById('assemblyGoalProgressDisplay');
const assemblyScheduledRevenueStat=document.getElementById('assemblyScheduledRevenueStat');
const assemblyBoardHead=document.getElementById('assemblyBoardHead');
const assemblyWeekViewBody=document.getElementById('assemblyWeekViewBody');
const assemblyBreakdownToggleBtn=document.getElementById('assemblyBreakdownToggleBtn');
const assemblyDetailsToggleBtn=document.getElementById('assemblyDetailsToggleBtn');
const assemblyEditModeToggleBtn=document.getElementById('assemblyEditModeToggleBtn');
const assemblyBreakdownPanel=document.getElementById('assemblyBreakdownPanel');
const assemblyEditModePanel=document.getElementById('assemblyEditModePanel');
const assemblyViewModePill=document.getElementById('assemblyViewModePill');
const assemblyRowsTodayStat=document.getElementById('assemblyRowsTodayStat');
const assemblyScheduledUnitsStat=document.getElementById('assemblyScheduledUnitsStat');
const assemblyDoneUnitsStat2=document.getElementById('assemblyDoneUnitsStat2');
const assemblyRemainingUnitsStat=document.getElementById('assemblyRemainingUnitsStat');
const assemblyCompletionStat=document.getElementById('assemblyCompletionStat');
const assemblyEditModalBackdrop=document.getElementById('assemblyEditModalBackdrop');
const assemblyEditModalSummary=document.getElementById('assemblyEditModalSummary');
const closeAssemblyCreateBtn=document.getElementById('closeAssemblyCreateBtn');
const closeAssemblyEditBtn=document.getElementById('closeAssemblyEditBtn');
const cancelAssemblyEditBtn=document.getElementById('cancelAssemblyEditBtn');
const saveAssemblyEditBtn=document.getElementById('saveAssemblyEditBtn');
const assemblyEditRevenue=document.getElementById('assemblyEditRevenue');
let pendingAssemblyEditId=null;
let assemblyInlineEditId=null;
let assemblyShowBreakdown=false;
let assemblyShowDetails=false;
let assemblyEditMode=false;

function getAssemblyUnits(row){
  return Number(row.qty||0) * Number(row.products||0);
}
function getAssemblyQty(row){
  return Number(row?.qty||0);
}
function formatUnitsQtyText(units, qty){
  return `${Number(units||0).toLocaleString()} units • ${Number(qty||0).toLocaleString()} packs`;
}
function formatUnitsQtyHtml(units, qty){
  return `<div class="assembly-dual-metric"><strong>${Number(units||0).toLocaleString()}</strong><span>${Number(qty||0).toLocaleString()} packs</span></div>`;
}
function updateAssemblyUnitsPreview(){
  const qty=Number(assemblyQtyInput.value||0);
  const products=Number(assemblyProductsInput.value||0);
  assemblyUnitsPreview.value=(qty*products).toLocaleString();
}
function renderAssembly(){
  const headcount=Number(assemblyHeadcountInput.value||0);
  const hours=Number(assemblyHoursInput.value||0);
  const hoursElapsed=Math.max(0,Number(assemblyHoursElapsedInput?.value||0));
  const uph=Number(assemblyUphInput.value||0);
  const selectedDate=assemblyDateInput.value||new Date().toISOString().slice(0,10);
  const filteredRows = sanitizeRows(
    assemblyBoardRows.filter(row => row.date === selectedDate)
  );
  const capacity=headcount*hours*uph;
  const formattedSelected=new Date(selectedDate+'T00:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric'});

  assemblyHeadcountStat.textContent=headcount;
  assemblyHoursStat.textContent=hours;
  assemblyUphStat.textContent=uph;
  assemblyCapacityStat.textContent=capacity.toLocaleString();
  assemblyScheduledPbDisplay.textContent=filteredRows.length;
  assemblySelectedDatePill.textContent=formattedSelected;
  assemblyBoardCountPill.textContent=`${filteredRows.length} row${filteredRows.length===1?'':'s'}`;
  if(assemblyViewModePill) assemblyViewModePill.textContent=assemblyShowDetails?'Detailed View':'Compact View';
  if(assemblyBreakdownPanel) assemblyBreakdownPanel.hidden=!assemblyShowBreakdown;
  if(assemblyEditModePanel) assemblyEditModePanel.hidden=!assemblyEditMode;
  if(assemblyBreakdownToggleBtn) assemblyBreakdownToggleBtn.textContent=assemblyShowBreakdown?'Hide Breakdown':'Show Breakdown';
  if(assemblyDetailsToggleBtn) assemblyDetailsToggleBtn.textContent=assemblyShowDetails?'Show Compact Columns':'Show Detail Columns';
  if(assemblyEditModeToggleBtn) assemblyEditModeToggleBtn.textContent=assemblyEditMode?'Close Row Creator':'Open Row Creator';

  const stageTotals={aa:{units:0,qty:0},print:{units:0,qty:0},picked:{units:0,qty:0},line:{units:0,qty:0},dpmo:{units:0,qty:0},done:{units:0,qty:0}};
  filteredRows.forEach(row=>{ if(stageTotals[row.stage]!==undefined){ stageTotals[row.stage].units+=getAssemblyUnits(row); stageTotals[row.stage].qty+=getAssemblyQty(row); } });
  assemblyAaUnits.textContent=formatUnitsQtyText(stageTotals.aa.units,stageTotals.aa.qty);
  assemblyPrintUnits.textContent=formatUnitsQtyText(stageTotals.print.units,stageTotals.print.qty);
  assemblyPickedUnits.textContent=formatUnitsQtyText(stageTotals.picked.units,stageTotals.picked.qty);
  assemblyLineUnits.textContent=formatUnitsQtyText(stageTotals.line.units,stageTotals.line.qty);
  assemblyDpmoUnits.textContent=formatUnitsQtyText(stageTotals.dpmo.units,stageTotals.dpmo.qty);
  assemblyDoneUnits.textContent=formatUnitsQtyText(stageTotals.done.units,stageTotals.done.qty);

  const scheduledUnitsTotal=filteredRows.reduce((sum,row)=>sum+getAssemblyUnits(row),0);
  const scheduledQtyTotal=filteredRows.reduce((sum,row)=>sum+getAssemblyQty(row),0);
  const doneUnitsTotal=filteredRows.filter(row=>row.stage==='done').reduce((sum,row)=>sum+getAssemblyUnits(row),0);
  const doneQtyTotal=filteredRows.filter(row=>row.stage==='done').reduce((sum,row)=>sum+getAssemblyQty(row),0);
  const remainingUnitsTotal=Math.max(0,scheduledUnitsTotal-doneUnitsTotal);
  const remainingQtyTotal=Math.max(0,scheduledQtyTotal-doneQtyTotal);
  const completionPct=scheduledUnitsTotal>0?(doneUnitsTotal/scheduledUnitsTotal)*100:0;
  const currentUph=hoursElapsed>0?doneUnitsTotal/(Math.max(1,headcount)*hoursElapsed):0;
  const goalProgress=uph>0?(currentUph/uph)*100:0;
  assemblyRowsTodayStat.textContent=filteredRows.length;
  assemblyScheduledUnitsStat.textContent=formatUnitsQtyText(scheduledUnitsTotal,scheduledQtyTotal);
  assemblyDoneUnitsStat2.textContent=formatUnitsQtyText(doneUnitsTotal,doneQtyTotal);
  assemblyRemainingUnitsStat.textContent=formatUnitsQtyText(remainingUnitsTotal,remainingQtyTotal);
  assemblyCompletionStat.textContent=`${completionPct.toFixed(0)}%`;
  if(assemblyCurrentUphDisplay) assemblyCurrentUphDisplay.textContent=currentUph.toFixed(0);
  if(assemblyGoalProgressDisplay) assemblyGoalProgressDisplay.textContent=`${goalProgress.toFixed(0)}%`;
  if(assemblyScheduledRevenueStat){
    const totalRev = filteredRows.reduce((sum,row)=>sum+Number(getEffectiveSubtotalForRow(row)||0),0);
    assemblyScheduledRevenueStat.textContent = new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(totalRev);
  }

  if(assemblyWeekViewBody){
    const weekRows=[];
    const start=new Date(selectedDate+'T00:00:00');
    for(let i=0;i<7;i+=1){
      const d=new Date(start);
      d.setDate(start.getDate()+i);
      const dayKey=d.toISOString().slice(0,10);
      const rows=assemblyBoardRows.filter(row=>row.date===dayKey);
      const units=rows.reduce((sum,row)=>sum+getAssemblyUnits(row),0);
      const qty=rows.reduce((sum,row)=>sum+getAssemblyQty(row),0);
      const done=rows.filter(row=>row.stage==='done').reduce((sum,row)=>sum+getAssemblyUnits(row),0);
      const doneQty=rows.filter(row=>row.stage==='done').reduce((sum,row)=>sum+getAssemblyQty(row),0);
      const pct=units>0?((done/units)*100):0;
      weekRows.push(`<tr><td>${d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})}</td><td>${rows.length}</td><td>${formatUnitsQtyHtml(units,qty)}</td><td>${formatUnitsQtyHtml(done,doneQty)}</td><td>${units?`${pct.toFixed(0)}%`:'—'}</td></tr>`);
    }
    assemblyWeekViewBody.innerHTML=weekRows.join('');
  }

  if(assemblyBoardHead){
    assemblyBoardHead.innerHTML = assemblyShowDetails
      ? '<tr><th>Work Type</th><th>Pack Builder</th><th>Sales Order</th><th>Account</th><th>Packs</th><th>Total Products</th><th>Units / Packs</th><th>Status</th><th>IHD</th><th>Open</th><th>Subtotal</th><th>Current Stage</th><th>Reschedule Note</th><th>Comments</th><th>Action</th></tr>'
      : '<tr><th>Pack Builder</th><th>Account</th><th>Units / Packs</th><th>IHD</th><th>Revenue</th><th>Stage</th><th>Status</th><th>Comments</th><th>Action</th></tr>';
  }

  if(!filteredRows.length){
    assemblyBoardBody.innerHTML=`<tr><td colspan="${assemblyShowDetails?15:9}" class="empty">No assembly board rows for the selected day.</td></tr>`;
    return;
  }

  const sortedWithPriority = typeof prioritySortRows === 'function' ? prioritySortRows(filteredRows) : filteredRows.map(row => ({row, priority:{rank:3,risk:'none',label:'',cls:''}}));

  assemblyBoardBody.innerHTML=sortedWithPriority.map(({row, priority})=>{
    const units=getAssemblyUnits(row);
    const openLink=getAssemblyOpenLink(row);
    const actionLabel=isPackBuilderWorkType(row.workType)?'Unschedule':'Delete';
    const isOverdue = priority.risk === 'overdue';
    const isAtRisk = priority.risk === 'at_risk';
    const rowClass = priority.cls || (isOverdue ? 'row-overdue' : isAtRisk ? 'row-risk' : '');
    const priorityBadge = priority.label ? ` <span class="mini-label ${priority.cls}">${priority.label}</span>` : '';

    if(false && assemblyInlineEditId===row.id){
      return `<tr class="${rowClass}">
        <td><select id="assemblyEditWorkType"><option value="pack_builder" ${row.workType==='pack_builder'?'selected':''}>Pack Builder</option><option value="jira" ${row.workType==='jira'?'selected':''}>Jira</option><option value="placeholder" ${row.workType==='placeholder'?'selected':''}>Placeholder</option></select></td>
        <td><input id="assemblyEditPb" value="${escapeHtml(row.pb)}" /></td>
        <td><input id="assemblyEditSo" value="${escapeHtml(row.so)}" /></td>
        <td><input id="assemblyEditAccount" value="${escapeHtml(row.account)}" /></td>
        <td><input id="assemblyEditQty" type="number" min="0" value="${row.qty}" oninput="updateInlineAssemblyUnitsPreview()" /></td>
        <td><input id="assemblyEditFullQty" type="number" min="0" value="${Number(row.fullQty||row.qty||0)}" /></td>
        <td><input id="assemblyEditProducts" type="number" min="0" value="${row.products}" oninput="updateInlineAssemblyUnitsPreview()" /></td>
        <td><input id="assemblyEditUnitsPreview" value="${units.toLocaleString()}" disabled /></td>
        <td><input id="assemblyEditStatus" value="${escapeHtml(row.status)}" /></td>
        <td><input id="assemblyEditIhd" type="date" value="${escapeHtml(getEffectiveIhdForRow(row)||'')}" /></td>
        <td><input id="assemblyEditExternalLink" value="${escapeHtml(row.externalLink||'')}" placeholder="Optional URL" /></td>
        <td>$${Number(getEffectiveSubtotalForRow(row)||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
        <td><select id="assemblyEditStage"><option value="aa" ${row.stage==='aa'?'selected':''}>A.A.</option><option value="print" ${row.stage==='print'?'selected':''}>Print</option><option value="picked" ${row.stage==='picked'?'selected':''}>Picked</option><option value="line" ${row.stage==='line'?'selected':''}>Line</option><option value="dpmo" ${row.stage==='dpmo'?'selected':''}>DPMO</option><option value="done" ${row.stage==='done'?'selected':''}>Done</option></select></td>
        <td><input id="assemblyEditRescheduleNote" value="${escapeHtml(row.rescheduleNote||'')}" placeholder="Hold, missing units, box issue..." /></td>
        <td><div class="row-actions"><button class="btn" onclick="saveAssemblyBoardRow(${row.id})">Save</button><button class="btn secondary" onclick="cancelAssemblyBoardEdit()">Cancel</button></div></td>
      </tr>`;
    }

    if(!assemblyShowDetails){
      const cbKey = row.pbId||row.so||'';
      return `<tr class="${rowClass}"><td>${escapeHtml(row.pb||'—')}</td><td>${escapeHtml(row.account||'—')}</td><td>${formatUnitsQtyHtml(units,getAssemblyQty(row))}</td><td>${escapeHtml(getEffectiveIhdForRow(row)||'—')}</td><td>$${Number(getEffectiveSubtotalForRow(row)||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</td><td><select onchange="setAssemblyStage(${row.id},this.value)"><option value="aa" ${row.stage==='aa'?'selected':''}>A.A.</option><option value="print" ${row.stage==='print'?'selected':''}>Print</option><option value="picked" ${row.stage==='picked'?'selected':''}>Picked</option><option value="line" ${row.stage==='line'?'selected':''}>Line</option><option value="dpmo" ${row.stage==='dpmo'?'selected':''}>DPMO</option><option value="done" ${row.stage==='done'?'selected':''}>Done</option></select></td><td>${escapeHtml(row.status||'—')}${priorityBadge}</td><td class="cb-cell" data-cbkey="${cbKey}"><span class="cb-badge cb-loading">…</span></td><td><div class="row-actions">${openLink?`<a class="btn secondary" href="${escapeHtml(openLink)}" target="_blank" rel="noopener noreferrer">Open</a>`:''}<button class="btn secondary" onclick="editAssemblyBoardRow(${row.id})">Edit</button>${isPackBuilderWorkType(row.workType)?`<button class="btn warn" onclick="openIssueHoldModal(${row.id},'assembly')">Hold</button>`:''}<button class="btn warn" onclick="removeAssemblyBoardRow(${row.id})">${actionLabel}</button></div></td></tr>`;
    }

    const cbKey2 = row.pbId||row.so||'';
    return `<tr class="${rowClass}"><td>${escapeHtml(getAssemblyWorkTypeLabel(row.workType)+(row.isPartial?' • Partial':''))}</td><td>${escapeHtml(row.pb)}</td><td>${escapeHtml(row.so)}</td><td>${escapeHtml(row.account)}</td><td>${formatAssemblyQty(row)}</td><td>${row.products}</td><td>${formatUnitsQtyHtml(units,getAssemblyQty(row))}</td><td>${escapeHtml(row.status||'—')}${priorityBadge}</td><td>${escapeHtml(getEffectiveIhdForRow(row)||'—')}</td><td>${openLink?`<a class="queue-link" href="${escapeHtml(openLink)}" target="_blank" rel="noopener noreferrer">Open</a>`:'—'}</td><td>$${Number(getEffectiveSubtotalForRow(row)||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</td><td><select onchange="setAssemblyStage(${row.id},this.value)"><option value="aa" ${row.stage==='aa'?'selected':''}>A.A.</option><option value="print" ${row.stage==='print'?'selected':''}>Print</option><option value="picked" ${row.stage==='picked'?'selected':''}>Picked</option><option value="line" ${row.stage==='line'?'selected':''}>Line</option><option value="dpmo" ${row.stage==='dpmo'?'selected':''}>DPMO</option><option value="done" ${row.stage==='done'?'selected':''}>Done</option></select></td><td>${escapeHtml(row.rescheduleNote||'—')}</td><td class="cb-cell" data-cbkey="${cbKey2}"><span class="cb-badge cb-loading">…</span></td><td><div class="row-actions"><button class="btn secondary" onclick="editAssemblyBoardRow(${row.id})">Edit</button>${isPackBuilderWorkType(row.workType)?`<button class="btn warn" onclick="openIssueHoldModal(${row.id},'assembly')">Hold</button>`:''}<button class="btn secondary" onclick="rescheduleAssemblyBoardRow(${row.id})">Reschedule</button><button class="btn warn" onclick="removeAssemblyBoardRow(${row.id})">${actionLabel}</button></div></td></tr>`;
  }).join('');
}
function clearAssemblyBoardForm(){
  assemblyWorkTypeInput.value='pack_builder';
  assemblyPbInput.value='';
  assemblySoInput.value='';
  assemblyAccountInput.value='';
  assemblyQtyInput.value=0;
  assemblyFullQtyInput.value=0;
  assemblyProductsInput.value=0;
  assemblyStatusInput.value='';
  assemblyIhdInput.value='';
  assemblyExternalLinkInput.value='';
  assemblyStageInput.value='aa';
  assemblyIsPartialInput.value='false';
  updateAssemblyUnitsPreview();
}
function addAssemblyBoardRow(){
  const pb=assemblyPbInput.value.trim();
  const so=assemblySoInput.value.trim();
  const account=assemblyAccountInput.value.trim();
  if(!pb&&!so&&!account){
    alert('Enter at least a primary ID/name, Sales Order, or Account before adding a row.');
    assemblyPbInput.focus();
    return;
  }
  assemblyBoardRows.unshift({
    id:Date.now(),
    date:assemblyDateInput.value||new Date().toISOString().slice(0,10),
    pb,
    so,
    account,
    qty:Number(assemblyQtyInput.value||0),
    fullQty:Number(assemblyFullQtyInput.value||assemblyQtyInput.value||0),
    isPartial:assemblyIsPartialInput.value==='true',
    products:Number(assemblyProductsInput.value||0),
    status:assemblyStatusInput.value.trim(),
    ihd:assemblyIhdInput.value,
    subtotal:0,
    stage:assemblyStageInput.value,
    rescheduleNote:'',
    workType:assemblyWorkTypeInput.value,
    externalLink:assemblyExternalLinkInput.value.trim(),
    sourceQueue:'',
    sourceStatus:assemblyStatusInput.value.trim()
  });
  clearAssemblyBoardForm();
  updateAssemblyData();
  assemblyEditMode=false;
  renderAssembly();
}
function deleteAssemblyBoardRow(id){
  assemblyBoardRows=assemblyBoardRows.filter(row=>row.id!==id);
  if(assemblyInlineEditId===id) assemblyInlineEditId=null;
  saveJson(assemblyBoardStorageKey,assemblyBoardRows);
  renderAssembly();
  renderHome();
  renderCalendar();
}
function removeAssemblyBoardRow(id){
  const targetId=String(id);
  const row=assemblyBoardRows.find(item=>String(item.id)===targetId);
  if(!row) return;

  if(!isPackBuilderWorkType(row.workType)){
    assemblyBoardRows=assemblyBoardRows.filter(item=>String(item.id)!==targetId);
    if(assemblyInlineEditId===row.id) assemblyInlineEditId=null;
    updateAssemblyData();
    return;
  }

  let scheduledMatch=scheduledQueueRows.find(item=>String(item.id)===targetId);
  if(!scheduledMatch){
    scheduledMatch=scheduledQueueRows.find(item=>
      String(item.scheduledFor||'')===String(row.date||'') &&
      String(item.pb||'')===String(row.pb||'') &&
      String(item.so||'')===String(row.so||'')
    );
  }

  const sourceRow=scheduledMatch||row;
  const targetBucket=(
    sourceRow.sourceQueue==='incomplete' ||
    classifyQueueStatus(sourceRow.sourceStatus)==='incomplete'
  ) ? incompleteQueueRows : availableQueueRows;

  mergeReturnedQueueRow(targetBucket,{
    priority:!!sourceRow.priority,
    pb:sourceRow.pb,
    pbId:sourceRow.pbId,
    so:sourceRow.so,
    account:sourceRow.account,
    qty:Number(sourceRow.fullQty||sourceRow.qty||0),
    products:Number(sourceRow.products||0),
    ihd:sourceRow.ihd,
    accountOwner:sourceRow.accountOwner||'',
    pdfUrl:sourceRow.pdfUrl,
    status:sourceRow.sourceStatus||sourceRow.status||''
  });

  scheduledQueueRows=scheduledQueueRows.filter(item=>String(item.id)!==targetId);
  if(scheduledMatch){
    scheduledQueueRows=scheduledQueueRows.filter(item=>!(
      String(item.scheduledFor||'')===String(scheduledMatch.scheduledFor||'') &&
      String(item.pb||'')===String(scheduledMatch.pb||'') &&
      String(item.so||'')===String(scheduledMatch.so||'')
    ));
  }

  assemblyBoardRows=assemblyBoardRows.filter(item=>String(item.id)!==targetId);
  if(assemblyInlineEditId===row.id) assemblyInlineEditId=null;
  updateAllData();
}

function openAssemblyEditModal(id){
  const row=assemblyBoardRows.find(r=>r.id===id);
  if(!row || !assemblyEditModalBackdrop) return;
  pendingAssemblyEditId=id;
  assemblyInlineEditId=id;

  if(assemblyEditModalSummary){
    assemblyEditModalSummary.innerHTML=`<strong>${escapeHtml(row.pb||'Pack Builder')}</strong><div>${escapeHtml(row.account||'—')}</div><div>${formatUnitsQtyText(getAssemblyUnits(row),getAssemblyQty(row))} • ${escapeHtml(row.so||'—')}</div>`;
  }

  const workTypeInput=document.getElementById('assemblyEditWorkType');
  const pbInput=document.getElementById('assemblyEditPb');
  const soInput=document.getElementById('assemblyEditSo');
  const accountInput=document.getElementById('assemblyEditAccount');
  const qtyInput=document.getElementById('assemblyEditQty');
  const fullQtyInput=document.getElementById('assemblyEditFullQty');
  const productsInput=document.getElementById('assemblyEditProducts');
  const statusInput=document.getElementById('assemblyEditStatus');
  const ihdInput=document.getElementById('assemblyEditIhd');
  const externalLinkInput=document.getElementById('assemblyEditExternalLink');
  const stageInput=document.getElementById('assemblyEditStage');
  const noteInput=document.getElementById('assemblyEditRescheduleNote');

  if(workTypeInput) workTypeInput.value=row.workType||'pack_builder';
  if(pbInput) pbInput.value=row.pb||'';
  if(soInput) soInput.value=row.so||'';
  if(accountInput) accountInput.value=row.account||'';
  if(qtyInput) qtyInput.value=Number(row.qty||0);
  if(fullQtyInput) fullQtyInput.value=Number(row.fullQty||row.qty||0);
  if(productsInput) productsInput.value=Number(row.products||0);
  if(statusInput) statusInput.value=row.status||'';
  if(ihdInput) ihdInput.value=getEffectiveIhdForRow(row)||'';
  if(externalLinkInput) externalLinkInput.value=row.externalLink||'';
  if(stageInput) stageInput.value=row.stage||'aa';
  if(noteInput) noteInput.value=row.rescheduleNote||'';
  if(assemblyEditRevenue) assemblyEditRevenue.textContent=`$${Number(getEffectiveSubtotalForRow(row)||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;

  updateInlineAssemblyUnitsPreview();
  assemblyEditModalBackdrop.classList.add('show');
}
function closeAssemblyEditModal(){
  if(assemblyEditModalBackdrop) assemblyEditModalBackdrop.classList.remove('show');
  pendingAssemblyEditId=null;
  assemblyInlineEditId=null;
}
function editAssemblyBoardRow(id){
  openAssemblyEditModal(id);
}
function cancelAssemblyBoardEdit(){
  closeAssemblyEditModal();
}
function updateInlineAssemblyUnitsPreview(){
  const qty=Number(document.getElementById('assemblyEditQty')?.value||0);
  const products=Number(document.getElementById('assemblyEditProducts')?.value||0);
  const target=document.getElementById('assemblyEditUnitsPreview');
  if(target) target.value=(qty*products).toLocaleString();
}
function saveAssemblyBoardRow(id){
  const targetId=id ?? pendingAssemblyEditId;
  const row=assemblyBoardRows.find(r=>r.id===targetId);
  if(!row) return;
  row.workType=(document.getElementById('assemblyEditWorkType')?.value||'pack_builder');
  row.pb=(document.getElementById('assemblyEditPb')?.value||'').trim();
  row.so=(document.getElementById('assemblyEditSo')?.value||'').trim();
  row.account=(document.getElementById('assemblyEditAccount')?.value||'').trim();
  row.qty=Number(document.getElementById('assemblyEditQty')?.value||0);
  row.fullQty=Number(document.getElementById('assemblyEditFullQty')?.value||row.qty||0);
  row.isPartial=row.workType==='pack_builder' && Number(row.fullQty||0)>Number(row.qty||0);
  row.products=Number(document.getElementById('assemblyEditProducts')?.value||0);
  row.status=(document.getElementById('assemblyEditStatus')?.value||'').trim();
  row.ihd=(document.getElementById('assemblyEditIhd')?.value||'');
  row.externalLink=(document.getElementById('assemblyEditExternalLink')?.value||'').trim();
  row.sourceStatus=row.sourceStatus||row.status||'';
  row.stage=(document.getElementById('assemblyEditStage')?.value||'aa');
  row.rescheduleNote=(document.getElementById('assemblyEditRescheduleNote')?.value||'').trim();
  closeAssemblyEditModal();
  updateAssemblyData();
}
function setAssemblyStage(id,stage){

  const row=assemblyBoardRows.find(r=>r.id===id);
  if(!row) return;
  row.stage=stage;
  updateAssemblyData();
}
function rescheduleAssemblyBoardRow(id){openRescheduleModal(id)}
window.setAssemblyStage=setAssemblyStage;
window.rescheduleAssemblyBoardRow=rescheduleAssemblyBoardRow;
window.editAssemblyBoardRow=editAssemblyBoardRow;
window.deleteAssemblyBoardRow=deleteAssemblyBoardRow;
window.removeAssemblyBoardRow=removeAssemblyBoardRow;
window.cancelAssemblyBoardEdit=cancelAssemblyBoardEdit;
window.saveAssemblyBoardRow=saveAssemblyBoardRow;
window.updateInlineAssemblyUnitsPreview=updateInlineAssemblyUnitsPreview;

if(assemblyDateInput) assemblyDateInput.value=new Date().toISOString().slice(0,10);

const assemblyLiveInputs=[assemblyHeadcountInput,assemblyHoursInput,assemblyHoursElapsedInput,assemblyUphInput,assemblyScheduledPbInput,assemblyQtyInput,assemblyFullQtyInput,assemblyProductsInput].filter(Boolean);
assemblyLiveInputs.forEach(input=>input.addEventListener('input',()=>{updateAssemblyUnitsPreview();renderAssembly();}));

assemblyDateInput?.addEventListener('change',()=>setAssemblyDateAndNavigate(assemblyDateInput.value,false));
assemblyPrevDayBtn?.addEventListener('click',()=>changeAssemblyDateByDays(-1));
assemblyNextDayBtn?.addEventListener('click',()=>changeAssemblyDateByDays(1));

if(typeof injectAssemblyQuickDateControls==='function'){
  injectAssemblyQuickDateControls();
}

assemblyBreakdownToggleBtn?.addEventListener('click',()=>{assemblyShowBreakdown=!assemblyShowBreakdown;renderAssembly();});
assemblyDetailsToggleBtn?.addEventListener('click',()=>{assemblyShowDetails=!assemblyShowDetails;renderAssembly();});
assemblyEditModeToggleBtn?.addEventListener('click',()=>{assemblyEditMode=!assemblyEditMode;renderAssembly();});
closeAssemblyCreateBtn?.addEventListener('click',()=>{assemblyEditMode=false;renderAssembly();});
assemblyEditModePanel?.addEventListener('click',(e)=>{if(e.target===assemblyEditModePanel){assemblyEditMode=false;renderAssembly();}});
document.getElementById('assemblyAddBoardRowBtn')?.addEventListener('click',addAssemblyBoardRow);

[document.getElementById('assemblyEditQty'),document.getElementById('assemblyEditProducts')].filter(Boolean).forEach(input=>input.addEventListener('input',updateInlineAssemblyUnitsPreview));
closeAssemblyEditBtn?.addEventListener('click',closeAssemblyEditModal);
cancelAssemblyEditBtn?.addEventListener('click',closeAssemblyEditModal);
saveAssemblyEditBtn?.addEventListener('click',()=>saveAssemblyBoardRow());
assemblyEditModalBackdrop?.addEventListener('click',(e)=>{if(e.target===assemblyEditModalBackdrop)closeAssemblyEditModal()});

window.openIssueHoldModal=window.openIssueHoldModal||openIssueHoldModal;

// ── Comment badge loader for Assembly board ───────────────────────────────
const _assemblyCommentCache = new Map(); // cbKey → count

async function _fetchCommentCount(cbKey) {
  if (!cbKey) return 0;
  try {
    const isPbId = !cbKey.startsWith('SORD') && cbKey.length > 6;
    const param  = isPbId ? `pb_id=${encodeURIComponent(cbKey)}` : `so=${encodeURIComponent(cbKey)}`;
    const res    = await fetch(`/.netlify/functions/flight-tracker-comments?${param}`, { headers: { Accept: 'application/json' } });
    if (!res.ok) return 0;
    const data = await res.json();
    return (data.comments || []).length;
  } catch { return 0; }
}

async function renderAssemblyCommentBadges() {
  const cells = document.querySelectorAll('#assemblyBoardBody .cb-cell');
  if (!cells.length) return;
  // Collect unique keys
  const keys = [...new Set([...cells].map(c => c.dataset.cbkey).filter(Boolean))];
  await Promise.all(keys.map(async key => {
    const count = await _fetchCommentCount(key);
    _assemblyCommentCache.set(key, count);
  }));
  cells.forEach(cell => {
    const key   = cell.dataset.cbkey || '';
    const count = _assemblyCommentCache.get(key) ?? 0;
    const span  = cell.querySelector('.cb-badge');
    if (!span) return;
    span.classList.remove('cb-loading');
    if (count > 0) {
      span.className = 'cb-badge cb-has';
      span.textContent = `💬 ${count}`;
      span.title = `${count} comment${count === 1 ? '' : 's'}`;
    } else {
      span.className = 'cb-badge cb-none';
      span.textContent = '💬 Add';
      span.title = 'Click to add a comment';
    }
  });
}

// Run after every renderAssembly call
const _origRenderAssembly = typeof renderAssembly === 'function' ? renderAssembly : null;
if (_origRenderAssembly) {
  const _wrappedRenderAssembly = function(...args) {
    _origRenderAssembly.apply(this, args);
    renderAssemblyCommentBadges();
  };
  // Only wrap if renderAssembly is directly accessible as a var in this scope
  // (it is — defined above in this file). Reassign the module-level reference.
  window.renderAssemblyCommentBadges = renderAssemblyCommentBadges;
}
window.renderAssemblyCommentBadges = renderAssemblyCommentBadges;

// ── Phase 2: Mobile card view for Assembly board ──────────────────────────
function buildAssemblyCard(row, priority) {
  const units    = getAssemblyUnits(row);
  const revenue  = Number(getEffectiveSubtotalForRow(row)||0);
  const ihd      = getEffectiveIhdForRow(row)||'—';
  const stage    = row.stage||'aa';
  const stageMap = {aa:'A.A.',print:'Print',picked:'Picked',line:'Line',dpmo:'DPMO',done:'Done'};
  const stageLabel = stageMap[stage]||stage;
  const stageCls   = stage==='done'?'stage-done':(stage==='aa'||stage==='print'||stage==='picked'?'stage-risk':'stage-mid');
  const cbKey    = row.pbId||row.so||'';
  const openLink = getAssemblyOpenLink(row);
  const actionLabel = isPackBuilderWorkType(row.workType)?'Unschedule':'Delete';
  const priorityBadge = priority&&priority.label ? `<span class="mini-label ${priority.cls}" style="font-size:10px;padding:2px 7px;border-radius:999px;margin-left:4px">${priority.label}</span>` : '';
  const revenueStr = new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(revenue);

  return `<div class="mob-card${priority&&priority.cls?' mob-card-'+priority.risk:''}">
    <div class="mob-card-header">
      <div class="mob-card-title">
        <span class="mob-card-pb">${escapeHtml(row.pb||'—')}</span>${priorityBadge}
        <span class="mob-card-account">${escapeHtml(row.account||'—')}</span>
      </div>
      <span class="mob-stage-badge mob-stage-${stageCls}">${escapeHtml(stageLabel)}</span>
    </div>
    <div class="mob-card-meta">
      <div class="mob-meta-item"><span class="mob-meta-label">Units</span><strong>${units.toLocaleString()}</strong></div>
      <div class="mob-meta-item"><span class="mob-meta-label">Revenue</span><strong>${revenueStr}</strong></div>
      <div class="mob-meta-item"><span class="mob-meta-label">IHD</span><strong>${escapeHtml(ihd)}</strong></div>
      <div class="mob-meta-item"><span class="mob-meta-label">Status</span><strong>${escapeHtml(row.status||'—')}</strong></div>
    </div>
    <div class="mob-card-stage-row">
      <label class="mob-meta-label" style="margin-right:8px">Stage</label>
      <select class="mob-stage-select" onchange="setAssemblyStage(${row.id},this.value)">
        <option value="aa" ${stage==='aa'?'selected':''}>A.A.</option>
        <option value="print" ${stage==='print'?'selected':''}>Print</option>
        <option value="picked" ${stage==='picked'?'selected':''}>Picked</option>
        <option value="line" ${stage==='line'?'selected':''}>Line</option>
        <option value="dpmo" ${stage==='dpmo'?'selected':''}>DPMO</option>
        <option value="done" ${stage==='done'?'selected':''}>Done</option>
      </select>
    </div>
    <div class="mob-card-actions">
      ${openLink?`<a class="mob-action-btn mob-action-secondary" href="${escapeHtml(openLink)}" target="_blank" rel="noopener noreferrer">Open</a>`:''}
      <button class="mob-action-btn mob-action-secondary" onclick="editAssemblyBoardRow(${row.id})">Edit</button>
      ${isPackBuilderWorkType(row.workType)?`<button class="mob-action-btn mob-action-warn" onclick="openIssueHoldModal(${row.id},'assembly')">Hold</button>`:''}
      <button class="mob-action-btn mob-action-warn" onclick="removeAssemblyBoardRow(${row.id})">${actionLabel}</button>
      <span class="cb-cell cb-badge cb-loading" data-cbkey="${escapeHtml(cbKey)}" style="margin-left:auto">…</span>
    </div>
  </div>`;
}

function renderAssemblyCards(sortedWithPriority) {
  const container = document.getElementById('assemblyBoardCards');
  if (!container) return;
  if (!sortedWithPriority.length) {
    container.innerHTML = '<p class="mob-empty">No assembly board rows for the selected day.</p>';
    return;
  }
  container.innerHTML = sortedWithPriority.map(({row, priority}) => buildAssemblyCard(row, priority)).join('');
}

// Patch renderAssembly to also call renderAssemblyCards
const _origRenderAssemblyPhase2 = renderAssembly;
renderAssembly = function() {
  _origRenderAssemblyPhase2.apply(this, arguments);
  // Re-derive sorted rows for card view
  const selectedDate = assemblyDateInput ? (assemblyDateInput.value||new Date().toISOString().slice(0,10)) : new Date().toISOString().slice(0,10);
  const filteredRows = typeof sanitizeRows==='function'
    ? sanitizeRows(assemblyBoardRows.filter(r=>r.date===selectedDate))
    : assemblyBoardRows.filter(r=>r.date===selectedDate);
  const sortedWithPriority = typeof prioritySortRows==='function'
    ? prioritySortRows(filteredRows)
    : filteredRows.map(row=>({row, priority:{rank:3,risk:'none',label:'',cls:''}}));
  renderAssemblyCards(sortedWithPriority);
  if (typeof renderAssemblyCommentBadges === 'function') renderAssemblyCommentBadges();
};
window.renderAssembly = renderAssembly;
