// =============================
// DATA VALIDATION LAYER
// =============================

function sanitizeNumber(value, fallback = 0) {
  const num = Number(value);
  return isNaN(num) ? fallback : num;
}

function sanitizeString(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function sanitizeRow(row) {
  return {
    ...row,
    qty: sanitizeNumber(row.qty),
    products: sanitizeNumber(row.products),
    units: sanitizeNumber(row.units),
    subtotal: sanitizeNumber(row.subtotal),
    pb: sanitizeString(row.pb),
    so: sanitizeString(row.so),
    account: sanitizeString(row.account),
    status: sanitizeString(row.status),
  };
}

function sanitizeRows(rows) {
  return (rows || []).map(sanitizeRow);
}

window.sanitizeRows = sanitizeRows;

// =============================
// EXECUTIVE SNAPSHOT (single source of truth)
// =============================

function classifyRowRisk(row) {
  if (row.stage === 'done') return 'none';
  const ihd = getEffectiveIhdForRow(row);
  if (!ihd) return 'none';
  const today = new Date(); today.setHours(0,0,0,0);
  const ihdDate = new Date(ihd + 'T00:00:00');
  const diffDays = (ihdDate - today) / 86400000;
  if (diffDays < 0) return 'overdue';
  if (diffDays <= 2) return 'at_risk';
  return 'none';
}

function classifyRowPriority(row, revenueThreshold) {
  const risk = classifyRowRisk(row);
  if (risk === 'overdue') return { rank: 0, risk, label: '🔴 OVERDUE', cls: 'priority-overdue' };
  if (risk === 'at_risk') return { rank: 1, risk, label: '🟡 AT RISK', cls: 'priority-atrisk' };
  const rev = Number(getEffectiveSubtotalForRow(row) || 0);
  if (rev >= revenueThreshold && revenueThreshold > 0 && row.stage !== 'done') return { rank: 2, risk, label: '💰 HIGH VALUE', cls: 'priority-highvalue' };
  return { rank: 3, risk, label: '', cls: '' };
}

function getRevenueThreshold(rows) {
  const revenues = rows.filter(r => r.stage !== 'done').map(r => Number(getEffectiveSubtotalForRow(r) || 0)).filter(v => v > 0).sort((a, b) => b - a);
  if (revenues.length < 3) return revenues[0] || 0;
  return revenues[Math.floor(revenues.length * 0.2)] || 0;
}

function prioritySortRows(rows) {
  const threshold = getRevenueThreshold(rows);
  return [...rows].map(row => {
    const p = classifyRowPriority(row, threshold);
    return { row, priority: p };
  }).sort((a, b) => {
    if (a.priority.rank !== b.priority.rank) return a.priority.rank - b.priority.rank;
    const stageOrder = { aa: 0, print: 1, picked: 2, line: 3, dpmo: 4, done: 5 };
    return (stageOrder[a.row.stage] ?? 99) - (stageOrder[b.row.stage] ?? 99);
  });
}

function getTodayAssemblyRows() {
  const today = new Date().toISOString().slice(0, 10);
  return assemblyBoardRows.filter(r => r.date === today);
}

function getExecutiveSnapshot() {
  const rows = sanitizeRows(getTodayAssemblyRows());

  const totalUnits = rows.reduce((sum, r) => sum + r.qty * r.products, 0);
  const doneRows = rows.filter(r => r.stage === 'done');
  const notDoneRows = rows.filter(r => r.stage !== 'done');
  const doneUnits = doneRows.reduce((sum, r) => sum + r.qty * r.products, 0);
  const remainingUnits = Math.max(0, totalUnits - doneUnits);

  const headcount = Number(assemblyHeadcountInput?.value || 0);
  const hours = Number(assemblyHoursInput?.value || 0);
  const uph = Number(assemblyUphInput?.value || 0);
  const capacity = headcount * hours * uph;
  const completion = totalUnits > 0 ? (doneUnits / totalUnits) * 100 : 0;
  const onTrack = capacity > 0 ? doneUnits >= (capacity * 0.9) : false;

  // Revenue
  const scheduledRevenue = rows.reduce((sum, r) => sum + Number(getEffectiveSubtotalForRow(r) || 0), 0);
  const doneRevenue = doneRows.reduce((sum, r) => sum + Number(getEffectiveSubtotalForRow(r) || 0), 0);
  const remainingRevenue = Math.max(0, scheduledRevenue - doneRevenue);
  const revenueCompletion = scheduledRevenue > 0 ? (doneRevenue / scheduledRevenue) * 100 : 0;

  // Risk
  const overdueRows = notDoneRows.filter(r => classifyRowRisk(r) === 'overdue');
  const atRiskRows = notDoneRows.filter(r => classifyRowRisk(r) === 'at_risk');
  const revenueAtRisk = [...overdueRows, ...atRiskRows].reduce((sum, r) => sum + Number(getEffectiveSubtotalForRow(r) || 0), 0);

  return {
    rows, totalUnits, doneUnits, remainingUnits, capacity, completion, onTrack,
    scheduledRevenue, doneRevenue, remainingRevenue, revenueCompletion,
    overdueCount: overdueRows.length, atRiskCount: atRiskRows.length, revenueAtRisk
  };
}

window.classifyRowRisk = classifyRowRisk;
window.classifyRowPriority = classifyRowPriority;
window.prioritySortRows = prioritySortRows;


const departments=["Receiving","Prepping","Assembly","Inventory","Fulfillment"];
const sizeOptions=["","XS","S","M","L","XL","2XL","3XL","4XL","5XL","6XL"];
const markOptions=["Present","Late","Absent","Excused","Call Out","No Call No Show"];
const markDemerits={"Present":0,"Late":0.5,"Absent":1,"Excused":0,"Call Out":1,"No Call No Show":2};
const errorTypes=["Short","Over","Input Error","Damage","Mislabel","Missing ID","Wrong Location","Other"];

const attendanceStorageKey="ops_hub_attendance_records_v2";
const employeesStorageKey="ops_hub_employees_v1";
const attendanceBackupKey="ops_hub_attendance_backup_v2";
const attendanceMovesStorageKey="ops_hub_attendance_moves_v1";
const errorsStorageKey="ops_hub_errors_records_v2";
const assemblyBoardStorageKey="ops_hub_assembly_board_v2";
const queueStorageKey="ops_hub_available_queue_v1";
const scheduledQueueStorageKey="ops_hub_scheduled_queue_v1";
const incompleteQueueStorageKey="ops_hub_incomplete_queue_v1";
const revenueReferenceStorageKey="ops_hub_revenue_reference_v1";
const assemblyApiBase='/.netlify/functions/assembly';
const assemblySyncKeys=new Set([assemblyBoardStorageKey,queueStorageKey,scheduledQueueStorageKey,incompleteQueueStorageKey,revenueReferenceStorageKey]);
let assemblySyncEnabled=false;
let assemblySyncLoaded=false;
let assemblySyncInFlight=false;
let assemblySyncQueued=false;
let assemblySyncTimer=null;

const attendanceSampleData=[
{id:1,employeeName:"Diana Parra",department:"Receiving",date:"2026-03-10",mark:"Present"},
{id:2,employeeName:"Zuleidy Milian",department:"Receiving",date:"2026-03-10",mark:"Present"},
{id:3,employeeName:"Maria Elena",department:"Receiving",date:"2026-03-10",mark:"Late"},
{id:4,employeeName:"Katherine Ospina",department:"Receiving",date:"2026-03-10",mark:"Present"},
{id:5,employeeName:"Henry Lewis",department:"Receiving",date:"2026-03-10",mark:"Absent"},
{id:6,employeeName:"Carlton Rudolph",department:"Receiving",date:"2026-03-10",mark:"Present"},
{id:7,employeeName:"Diana Parra",department:"Receiving",date:"2026-03-11",mark:"Present"},
{id:8,employeeName:"Zuleidy Milian",department:"Receiving",date:"2026-03-11",mark:"Present"},
{id:9,employeeName:"Maria Elena",department:"Receiving",date:"2026-03-11",mark:"Present"},
{id:10,employeeName:"Katherine Ospina",department:"Receiving",date:"2026-03-11",mark:"Present"},
{id:11,employeeName:"Henry Lewis",department:"Receiving",date:"2026-03-11",mark:"Call Out"},
{id:12,employeeName:"Carlton Rudolph",department:"Receiving",date:"2026-03-11",mark:"Present"}
];
const defaultEmployees=[
{name:"Diana Parra",department:"Receiving",birthday:"",size:"",active:true},
{name:"Zuleidy Milian",department:"Receiving",birthday:"",size:"",active:true},
{name:"Maria Elena",department:"Receiving",birthday:"",size:"",active:true},
{name:"Katherine Ospina",department:"Receiving",birthday:"",size:"",active:true},
{name:"Henry Lewis",department:"Receiving",birthday:"",size:"",active:true},
{name:"Carlton Rudolph",department:"Receiving",birthday:"",size:"",active:true}
];
const errorSampleData=[
{id:100,date:"2026-03-11",department:"Prepping",associate:"Elizabeth",proofed:"Yes",poNumber:"PO12345",linkedId:"SORD8881",category:"Drinkware",palletLocation:"A-12-4",expectedQty:500,receivedQty:480,errorType:"Short",notes:"Missing one carton during prep check."},
{id:101,date:"2026-03-11",department:"Receiving",associate:"Carlos",proofed:"No",poNumber:"PO77821",linkedId:"PB-2177",category:"Apparel",palletLocation:"R-03-2",expectedQty:100,receivedQty:112,errorType:"Over",notes:"Received count was higher than PO expected."}
];

let attendanceRecords=normalizeAttendanceRecords(loadJson(attendanceStorageKey,[]));
let attendanceMoveRecords=normalizeAttendanceMoveRecords(loadJson(attendanceMovesStorageKey,[]));
let employees=normalizeEmployees(loadJson(employeesStorageKey,defaultEmployees));
let activeAttendanceDepartment="Receiving";
let selectedProfileName="";
let attendanceRosterSelection=new Set();
let errorRecords=normalizeErrorRecords(loadJson(errorsStorageKey,[]));
let assemblyBoardRows=normalizeAssemblyBoardRows(loadJson(assemblyBoardStorageKey,[]));
let availableQueueRows=normalizeQueueRows(loadJson(queueStorageKey,[]));
let scheduledQueueRows=normalizeScheduledQueueRows(loadJson(scheduledQueueStorageKey,[]));
let incompleteQueueRows=normalizeQueueRows(loadJson(incompleteQueueStorageKey,[]));
let queueRawRowCount=0;
let revenueReferenceRows=normalizeRevenueReferenceRows(loadJson(revenueReferenceStorageKey,[]));

function normalizeEmployeeNames(list){return Array.from(new Set((list||[]).map(v=>String(v).trim()).filter(Boolean))).sort((a,b)=>a.localeCompare(b))}
function normalizeEmployees(list){
  const mapped=(list||[]).map(item=>{
    if(typeof item==='string') return {name:String(item).trim(),department:'Receiving',birthday:'',size:'',active:true};
    const normalizedSize=String(item.size||'').trim().toUpperCase();
    return {name:String(item.name||'').trim(),department:String(item.department||'Receiving').trim(),birthday:String(item.birthday||'').trim(),size:sizeOptions.includes(normalizedSize)?normalizedSize:'',active:item.active!==false};
  }).filter(item=>item.name);
  const deduped=[]; const seen=new Set();
  mapped.forEach(item=>{const key=item.name.toLowerCase(); if(!seen.has(key)){seen.add(key); deduped.push(item)}});
  return deduped.sort((a,b)=>a.name.localeCompare(b.name));
}
function saveEmployees(){saveJson(employeesStorageKey,employees)}
function getActiveEmployees(){return employees.filter(emp=>emp.active)}
function getEmployeeByName(name){return employees.find(emp=>emp.name===name)}
function formatBirthdayDisplay(value){if(!value) return '—'; const d=new Date(value+'T00:00:00'); return d.toLocaleDateString('en-US',{month:'short',day:'numeric'});}
function normalizeSalesOrderKey(value){return String(value||'').trim().toLowerCase();}
function buildRevenueReferenceLookup(){
  const map=new Map();
  revenueReferenceRows.forEach(row=>{
    const key=normalizeSalesOrderKey(row.salesOrder);
    if(!key) return;
    if(!map.has(key)){
      map.set(key,{salesOrder:row.salesOrder,originalSubtotal:Number(row.originalSubtotal||0),ihd:String(row.ihd||'').trim(),account:String(row.account||'').trim()});
      return;
    }
    const existing=map.get(key);
    existing.originalSubtotal=Math.max(Number(existing.originalSubtotal||0),Number(row.originalSubtotal||0));
    const existingIhd=String(existing.ihd||'').trim();
    const incomingIhd=String(row.ihd||'').trim();
    if(incomingIhd && (!existingIhd || incomingIhd<existingIhd)) existing.ihd=incomingIhd;
    if(!existing.account && row.account) existing.account=String(row.account).trim();
  });
  return map;
}
function getRevenueReferenceForSalesOrder(salesOrder){
  if(!salesOrder) return null;
  const lookup=buildRevenueReferenceLookup();
  return lookup.get(normalizeSalesOrderKey(salesOrder))||null;
}
function getEffectiveIhdForRow(row){
  const direct=String(row?.ihd||'').trim();
  if(direct) return direct;
  const revenue=getRevenueReferenceForSalesOrder(row?.so||'');
  return revenue?.ihd||'';
}
function getEffectiveSubtotalForRow(row){
  const direct=Number(row?.subtotal||0);
  if(direct>0) return direct;
  const revenue=getRevenueReferenceForSalesOrder(row?.so||'');
  return Number(revenue?.originalSubtotal||0);
}
function getAssemblyDaySummary(dateStr){
  const rows=assemblyBoardRows.filter(row=>String(row.date||'')===String(dateStr||''));
  return {
    pbCount:rows.length,
    units:rows.reduce((sum,row)=>sum+getAssemblyUnits(row),0),
    packs:rows.reduce((sum,row)=>sum+Number(row.qty||0),0)
  };
}
function getBirthdayEventsForMonth(year,month){return getActiveEmployees().filter(emp=>emp.birthday).map(emp=>{const source=new Date(emp.birthday+'T00:00:00'); return {name:emp.name, month:source.getMonth(), day:source.getDate()};}).filter(item=>item.month===month);}
function getDemeritForMark(mark){return Number(markDemerits[mark]??0)}
function escapeHtml(v){return String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,'&quot;').replace(/'/g,'&#039;')}
function escapeJs(v){return String(v??"").replace(/\\/g,'\\\\').replace(/'/g,"\\'")}
function toBadgeClass(v){return String(v||"").toLowerCase().replace(/\s+/g,'')}

function normalizeAttendanceRecords(list){return(list||[]).map(item=>({id:item.id||Date.now()+Math.random(),employeeName:String(item.employeeName||"").trim(),department:String(item.department||"Receiving").trim(),date:item.date||new Date().toISOString().slice(0,10),mark:item.mark||"Present",demerits:typeof item.demerits==='number'?item.demerits:getDemeritForMark(item.mark||"Present")}))}
function normalizeAttendanceMoveRecords(list){
  return (list||[]).map(item=>({
    id:item.id||Date.now()+Math.random(),
    employeeName:String(item.employeeName||'').trim(),
    date:item.date||new Date().toISOString().slice(0,10),
    fromDepartment:String(item.fromDepartment||'Receiving').trim(),
    toDepartment:String(item.toDepartment||'Receiving').trim(),
    startTime:String(item.startTime||'').trim(),
    endTime:String(item.endTime||'').trim(),
    note:String(item.note||'').trim()
  })).filter(item=>item.employeeName);
}
function normalizeErrorRecords(list){return(list||[]).map(item=>{const expectedQty=Number(item.expectedQty||0);const receivedQty=Number(item.receivedQty||0);const absoluteAmount=Math.abs(expectedQty-receivedQty);const errorRate=expectedQty>0?(absoluteAmount/expectedQty)*100:0;return{id:item.id||Date.now()+Math.random(),date:item.date||new Date().toISOString().slice(0,10),department:item.department||"Prepping",associate:item.associate||"",proofed:item.proofed||"Yes",poNumber:item.poNumber||"",linkedId:item.linkedId||"",category:item.category||"",palletLocation:item.palletLocation||"",expectedQty,receivedQty,errorType:item.errorType||"Other",absoluteAmount,errorRate,notes:item.notes||""}})}
function normalizeAssemblyBoardRows(list){return(list||[]).map(item=>({id:item.id||Date.now()+Math.random(),date:item.date||new Date().toISOString().slice(0,10),pb:String(item.pb||'').trim(),so:String(item.so||'').trim(),account:String(item.account||'').trim(),qty:Number(item.qty||0),products:Number(item.products||0),status:String(item.status||'').trim(),ihd:item.ihd||'',subtotal:Number(item.subtotal||0),stage:String(item.stage||inferLegacyStage(item)||'aa').trim(),rescheduleNote:String(item.rescheduleNote||'').trim(),pbId:String(item.pbId||'').trim(),pdfUrl:String(item.pdfUrl||'').trim(),workType:String(item.workType||'pack_builder').trim(),externalLink:String(item.externalLink||'').trim(),isPartial:!!item.isPartial,fullQty:Number(item.fullQty||item.qty||0),accountOwner:String(item.accountOwner||'').trim(),sourceQueue:String(item.sourceQueue||'').trim(),sourceStatus:String(item.sourceStatus||item.status||'').trim()}))}
function inferLegacyStage(item){if(item.done) return 'done'; if(item.dpmo) return 'dpmo'; if(item.line) return 'line'; if(item.picked) return 'picked'; if(item.print) return 'print'; return 'aa';}
function normalizeQueueRows(list){return(list||[]).map(item=>({id:item.id||Date.now()+Math.random(),priority:!!item.priority,pb:String(item.pb||'').trim(),pbId:String(item.pbId||'').trim(),so:String(item.so||'').trim(),account:String(item.account||'').trim(),qty:Number(item.qty||0),products:Number(item.products||0),units:Number(item.units||0),ihd:String(item.ihd||'').trim(),accountOwner:String(item.accountOwner||'').trim(),pdfUrl:String(item.pdfUrl||'').trim(),status:String(item.status||'').trim()}))}
function normalizeScheduledQueueRows(list){return(list||[]).map(item=>({id:item.id||Date.now()+Math.random(),priority:!!item.priority,pb:String(item.pb||'').trim(),pbId:String(item.pbId||'').trim(),so:String(item.so||'').trim(),account:String(item.account||'').trim(),qty:Number(item.qty||0),products:Number(item.products||0),units:Number(item.units||0),ihd:String(item.ihd||'').trim(),accountOwner:String(item.accountOwner||'').trim(),pdfUrl:String(item.pdfUrl||'').trim(),scheduledFor:String(item.scheduledFor||'').trim(),scheduledAt:String(item.scheduledAt||'').trim(),scheduleNote:String(item.scheduleNote||'').trim(),status:String(item.status||'').trim(),sourceQueue:String(item.sourceQueue||'ready').trim(),sourceStatus:String(item.sourceStatus||item.status||'').trim()}))}
function normalizeRevenueReferenceRows(list){return(list||[]).map(item=>({id:item.id||Date.now()+Math.random(),salesOrder:String(item.salesOrder||'').trim(),originalSubtotal:Number(item.originalSubtotal||0),ihd:String(item.ihd||'').trim(),account:String(item.account||'').trim()})).filter(item=>item.salesOrder)}
function saveRevenueReference(){saveJson(revenueReferenceStorageKey,revenueReferenceRows)}
function saveQueue(){saveJson(queueStorageKey,availableQueueRows)}
function saveScheduledQueue(){saveJson(scheduledQueueStorageKey,scheduledQueueRows)}
function saveIncompleteQueue(){saveJson(incompleteQueueStorageKey,incompleteQueueRows)}
function buildSalesforcePbLink(pbId,pdfUrl){if(pdfUrl&&pdfUrl!=='-') return pdfUrl; if(!pbId) return ''; return `https://swagup.lightning.force.com/lightning/r/Pack_Builder__c/${pbId}/view`;}
function getAssemblyOpenLink(row){return String(row.externalLink||'').trim()||buildSalesforcePbLink(row.pbId,row.pdfUrl)||''}
function getAssemblyWorkTypeLabel(value){const map={pack_builder:'Pack Builder',jira:'Jira',placeholder:'Placeholder'};return map[value]||'Pack Builder'}
function isPackBuilderWorkType(value){const normalized=String(value||'').trim().toLowerCase().replace(/\s+/g,'_');return normalized==='pack_builder'||normalized==='packbuilder'||normalized==='pack-builder'||normalized==='pack builder';}
function formatAssemblyQty(row){const scheduledQty=Number(row.qty||0);const fullQty=Number(row.fullQty||row.qty||0);if(row.isPartial&&fullQty>0&&fullQty!==scheduledQty)return `${scheduledQty} / ${fullQty}`;return String(scheduledQty)}
const readyStatuses=['qa approved','pick ready','assembly ready','assembly in process'];
const incompleteStatuses=['pending items','partially complete'];
function classifyQueueStatus(status){
  const normalized=String(status||'').trim().toLowerCase().split(' ').filter(Boolean).join(' ');
  if(!normalized) return 'incomplete';
  if(readyStatuses.some(s=>normalized===s||normalized.includes(s))) return 'ready';
  if(incompleteStatuses.some(s=>normalized===s||normalized.includes(s))) return 'incomplete';
  return 'incomplete';
}
function getSortedQueueRows(rows){const mode=document.getElementById('queueSortBy')?.value||'ihd_asc';const sorters={ihd_asc:(a,b)=>String(a.ihd||'9999-99-99').localeCompare(String(b.ihd||'9999-99-99'))||Number(b.priority)-Number(a.priority),units_desc:(a,b)=>Number(b.units||0)-Number(a.units||0)||String(a.ihd||'').localeCompare(String(b.ihd||'')),account_asc:(a,b)=>String(a.account||'').localeCompare(String(b.account||''))||Number(b.priority)-Number(a.priority),pb_asc:(a,b)=>String(a.pb||'').localeCompare(String(b.pb||''))};return [...rows].sort(sorters[mode]||sorters.ihd_asc)}
function matchesQueueSearch(row){const q=(document.getElementById('queueSearch')?.value||'').trim().toLowerCase();return !q||String(row.pb||'').toLowerCase().includes(q)||String(row.so||'').toLowerCase().includes(q)||String(row.account||'').toLowerCase().includes(q)||String(row.accountOwner||'').toLowerCase().includes(q)||String(row.status||'').toLowerCase().includes(q)||String(row.scheduledFor||'').toLowerCase().includes(q)||String(row.scheduleNote||'').toLowerCase().includes(q)}
function getQueueFlags(row){const flags=[];if(row.priority) flags.push({label:'Priority',cls:'flag-priority'});if(row.ihd){const today=new Date();today.setHours(0,0,0,0);const ihdDate=new Date(String(row.ihd)+'T00:00:00');const diffDays=Math.round((ihdDate-today)/86400000);if(diffDays<0) flags.push({label:'Overdue',cls:'flag-overdue'});else if(diffDays<=3) flags.push({label:'Due Soon',cls:'flag-due'});}if(classifyQueueStatus(row.status)==='incomplete') flags.push({label:'Pending',cls:'flag-due'});return flags}
function renderQueueFlags(row){const flags=getQueueFlags(row);if(!flags.length) return '—';return `<div class="flag-wrap">${flags.map(flag=>`<span class="flag-badge ${flag.cls}">${flag.label}</span>`).join('')}</div>`}
function applyQueueLimit(rows,limitValue){if(limitValue==='all') return rows;const limit=Math.max(1,Number(limitValue||10));return rows.slice(0,limit)}
function mergeReturnedQueueRow(targetBucket,payload){
  const matchIndex=targetBucket.findIndex(item=>{
    const sameId=(item.pbId&&payload.pbId&&item.pbId===payload.pbId);
    const sameKey=!item.pbId&&!payload.pbId&&item.pb===payload.pb&&item.so===payload.so;
    return sameId||sameKey;
  });
  if(matchIndex>=0){
    const existing=targetBucket[matchIndex];
    existing.priority=!!(existing.priority||payload.priority);
    existing.pb=payload.pb||existing.pb;
    existing.pbId=payload.pbId||existing.pbId;
    existing.so=payload.so||existing.so;
    existing.account=payload.account||existing.account;
    existing.qty=Number(existing.qty||0)+Number(payload.qty||0);
    existing.products=Math.max(Number(existing.products||0),Number(payload.products||0));
    existing.units=Number(existing.qty||0)*Number(existing.products||0);
    existing.ihd=payload.ihd||existing.ihd;
    existing.accountOwner=payload.accountOwner||existing.accountOwner;
    existing.pdfUrl=payload.pdfUrl||existing.pdfUrl;
    existing.status=payload.status||existing.status;
    const merged=targetBucket.splice(matchIndex,1)[0];
    targetBucket.unshift(merged);
    return merged;
  }
  const fresh={
    id:Date.now()+Math.random(),
    priority:!!payload.priority,
    pb:payload.pb||'',
    pbId:payload.pbId||'',
    so:payload.so||'',
    account:payload.account||'',
    qty:Number(payload.qty||0),
    products:Number(payload.products||0),
    units:Number(payload.qty||0)*Number(payload.products||0),
    ihd:payload.ihd||'',
    accountOwner:payload.accountOwner||'',
    pdfUrl:payload.pdfUrl||'',
    status:payload.status||''
  };
  targetBucket.unshift(fresh);
  return fresh;
}

const attendanceDeptTabs=document.getElementById('attendanceDeptTabs');
const attendanceRecordsBody=document.getElementById('attendanceRecordsBody');
const attendanceSummaryBody=document.getElementById('attendanceSummaryBody');
const attendanceTotalEntries=document.getElementById('attendanceTotalEntries');
const attendancePresentCount=document.getElementById('attendancePresentCount');
const attendanceLateAbsentCount=document.getElementById('attendanceLateAbsentCount');
const attendanceNetDemerits=document.getElementById('attendanceNetDemerits');
const attendanceCurrentDepartmentPill=document.getElementById('attendanceCurrentDepartmentPill');
const attendanceUndoBtn=document.getElementById('attendanceUndoBtn');
const attendanceEmployeeInput=document.getElementById('attendanceEmployeeName');
const attendanceDepartmentInput=document.getElementById('attendanceDepartment');
const attendanceDateInput=document.getElementById('attendanceDate');
const attendanceMarkInput=document.getElementById('attendanceMark');
const attendanceDemeritsInput=document.getElementById('attendanceDemerits');
const attendanceSearchInput=document.getElementById('attendanceSearch');
const attendanceSortByInput=document.getElementById('attendanceSortBy');
const attendanceBatchDateInput=document.getElementById('attendanceBatchDate');
const attendanceBatchMarkInput=document.getElementById('attendanceBatchMark');
const attendanceRosterGrid=document.getElementById('attendanceRosterGrid');
const attendanceBatchSummary=document.getElementById('attendanceBatchSummary');
const attendanceMoveToDepartmentInput=document.getElementById('attendanceMoveToDepartment');
const attendanceMoveStartTimeInput=document.getElementById('attendanceMoveStartTime');
const attendanceMoveEndTimeInput=document.getElementById('attendanceMoveEndTime');
const attendanceMoveNoteInput=document.getElementById('attendanceMoveNote');
const attendanceMoveLogBody=document.getElementById('attendanceMoveLogBody');

const profileModalBackdrop=document.getElementById('profileModalBackdrop');
const profileName=document.getElementById('profileName');
const profileSubtitle=document.getElementById('profileSubtitle');
const profileStats=document.getElementById('profileStats');
const profileHistoryBody=document.getElementById('profileHistoryBody');

attendanceDepartmentInput.innerHTML=departments.map(d=>`<option value="${d}">${d}</option>`).join('');
attendanceMarkInput.innerHTML=markOptions.map(m=>`<option value="${m}">${m}</option>`).join('');
attendanceDepartmentInput.value=activeAttendanceDepartment;
attendanceDateInput.value=new Date().toISOString().slice(0,10);
attendanceMarkInput.value='Present';
attendanceDemeritsInput.value=getDemeritForMark('Present');
attendanceBatchDateInput.value=new Date().toISOString().slice(0,10);
attendanceBatchMarkInput.innerHTML=markOptions.map(m=>`<option value="${m}">${m}</option>`).join('');
attendanceBatchMarkInput.value='Present';
attendanceMoveToDepartmentInput.innerHTML=departments.map(d=>`<option value="${d}">${d}</option>`).join('');
attendanceMoveToDepartmentInput.value='Assembly';

function getRosterEmployees(){
  const exact=getActiveEmployees().filter(emp=>emp.department===activeAttendanceDepartment||!emp.department);
  return (exact.length?exact:getActiveEmployees()).sort((a,b)=>a.name.localeCompare(b.name));
}
function renderAttendanceEmployeeOptions(selectedName=''){const visible=getRosterEmployees().map(emp=>emp.name);attendanceEmployeeInput.innerHTML=['<option value="">Select employee</option>'].concat(visible.map(name=>`<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`)).join('');attendanceEmployeeInput.value=selectedName&&visible.includes(selectedName)?selectedName:''}
function renderAttendanceDepartmentTabs(){attendanceDeptTabs.innerHTML=departments.map(dept=>`<button class="dept-btn ${dept===activeAttendanceDepartment?'active':''}" data-dept="${dept}">${dept}</button>`).join('');attendanceDeptTabs.querySelectorAll('[data-dept]').forEach(btn=>btn.addEventListener('click',()=>{activeAttendanceDepartment=btn.dataset.dept;attendanceDepartmentInput.value=activeAttendanceDepartment;attendanceRosterSelection.clear();renderAttendance()}))}
function updateAttendanceAutoDemerit(){attendanceDemeritsInput.value=getDemeritForMark(attendanceMarkInput.value)}
function sortAttendanceRecords(a,b){const mode=attendanceSortByInput.value;if(mode==='date_asc')return String(a.date).localeCompare(String(b.date));if(mode==='date_desc')return String(b.date).localeCompare(String(a.date));if(mode==='name_asc')return a.employeeName.localeCompare(b.employeeName);if(mode==='name_desc')return b.employeeName.localeCompare(a.employeeName);if(mode==='mark_asc')return a.mark.localeCompare(b.mark)||String(b.date).localeCompare(String(a.date));if(mode==='demerits_desc')return Number(b.demerits||0)-Number(a.demerits||0)||String(b.date).localeCompare(String(a.date));return String(b.date).localeCompare(String(a.date))}
function getFilteredAttendanceRecords(){const q=attendanceSearchInput.value.trim().toLowerCase();return attendanceRecords.filter(r=>r.department===activeAttendanceDepartment&&(!q||r.employeeName.toLowerCase().includes(q)||r.mark.toLowerCase().includes(q)||String(r.date).includes(q))).sort(sortAttendanceRecords)}
function getAttendanceEmployeeStats(name){const personRecords=attendanceRecords.filter(r=>r.employeeName===name).sort((a,b)=>String(a.date).localeCompare(String(b.date)));let totalDemerits=0,credits=0,streakDays=0,bestStreak=0,lastDate=null;personRecords.forEach(record=>{totalDemerits+=Number(record.demerits||0);const currentDate=new Date(record.date+'T00:00:00');let consecutive=!lastDate||Math.round((currentDate-lastDate)/86400000)===1;if(record.mark==='Present')streakDays=consecutive?streakDays+1:1;else streakDays=0;if(streakDays>bestStreak)bestStreak=streakDays;if(streakDays>0&&streakDays%30===0)credits+=1;lastDate=currentDate});return{records:personRecords,totalDays:personRecords.length,present:personRecords.filter(r=>r.mark==='Present').length,credits,netDemerits:Math.max(0,totalDemerits-credits),currentStreak:streakDays,bestStreak}}
function renderAttendanceRoster(){
  const roster=getRosterEmployees();
  const activeDate=attendanceBatchDateInput.value||new Date().toISOString().slice(0,10);
  if(!roster.length){attendanceRosterGrid.innerHTML='<div class="empty-roster">No active employees in this department yet.</div>';attendanceBatchSummary.textContent='0 selected';return}
  attendanceRosterGrid.innerHTML=roster.map(emp=>{const selected=attendanceRosterSelection.has(emp.name);const todaysRecord=attendanceRecords.find(r=>r.employeeName===emp.name&&r.department===activeAttendanceDepartment&&r.date===activeDate);return `<button class="attendance-roster-card ${selected?'selected':''}" data-employee="${escapeHtml(emp.name)}"><div class="attendance-roster-top"><span class="attendance-roster-name">${escapeHtml(emp.name)}</span><span class="pill">${escapeHtml(emp.size||'—')}</span></div><div class="attendance-roster-meta">Default: ${escapeHtml(emp.department||'—')}</div><div class="attendance-roster-meta">Birthday: ${formatBirthdayDisplay(emp.birthday)}</div><div class="attendance-roster-status ${todaysRecord?toBadgeClass(todaysRecord.mark):'unset'}">${todaysRecord?escapeHtml(todaysRecord.mark):'No mark yet'}</div></button>`}).join('');
  attendanceRosterGrid.querySelectorAll('[data-employee]').forEach(btn=>btn.addEventListener('click',()=>{const name=btn.dataset.employee;if(attendanceRosterSelection.has(name))attendanceRosterSelection.delete(name);else attendanceRosterSelection.add(name);renderAttendanceRoster();}));
  const alreadyMarked=roster.filter(emp=>attendanceRecords.some(r=>r.employeeName===emp.name&&r.department===activeAttendanceDepartment&&r.date===activeDate)).length;
  attendanceBatchSummary.textContent=`${attendanceRosterSelection.size} selected • ${roster.length} shown • ${alreadyMarked} already marked for ${activeDate}`;
}
function getFilteredAttendanceMoves(){return attendanceMoveRecords.filter(r=>r.fromDepartment===activeAttendanceDepartment||r.toDepartment===activeAttendanceDepartment).sort((a,b)=>`${b.date} ${b.startTime}`.localeCompare(`${a.date} ${a.startTime}`)).slice(0,20)}
function renderAttendanceMoveLog(){const filtered=getFilteredAttendanceMoves();if(!filtered.length){attendanceMoveLogBody.innerHTML='<tr><td colspan="7" class="empty">No department moves logged yet for this department.</td></tr>';return}attendanceMoveLogBody.innerHTML=filtered.map(r=>`<tr><td>${escapeHtml(r.employeeName)}</td><td>${escapeHtml(r.date)}</td><td>${escapeHtml(r.fromDepartment)}</td><td>${escapeHtml(r.toDepartment)}</td><td>${escapeHtml([r.startTime,r.endTime].filter(Boolean).join(' - ')||'—')}</td><td>${escapeHtml(r.note||'—')}</td><td><button class="btn danger" onclick="deleteAttendanceMoveRecord(${r.id})">Delete</button></td></tr>`).join('')}
function renderAttendanceRecords(){const filtered=getFilteredAttendanceRecords();if(!filtered.length){attendanceRecordsBody.innerHTML='<tr><td colspan="6" class="empty">No records found for this view.</td></tr>';return filtered}attendanceRecordsBody.innerHTML=filtered.map(r=>`<tr><td><button class="name-button" onclick="openAttendanceProfile('${escapeJs(r.employeeName)}')">${escapeHtml(r.employeeName)}</button></td><td>${escapeHtml(r.department)}</td><td>${escapeHtml(r.date)}</td><td><span class="badge ${toBadgeClass(r.mark)}">${escapeHtml(r.mark)}</span></td><td>${Number(r.demerits||0)}</td><td><div class="row-actions"><button class="btn danger" onclick="deleteAttendanceRecord(${r.id})">Delete</button></div></td></tr>`).join('');return filtered}
function renderAttendanceSummary(filtered){const names=Array.from(new Set(filtered.map(r=>r.employeeName))).sort((a,b)=>a.localeCompare(b));if(!names.length){attendanceSummaryBody.innerHTML='<tr><td colspan="4" class="empty">No employee summary yet.</td></tr>';return}attendanceSummaryBody.innerHTML=names.map(name=>{const stats=getAttendanceEmployeeStats(name);return`<tr><td><button class="name-button" onclick="openAttendanceProfile('${escapeJs(name)}')">${escapeHtml(name)}</button></td><td>${stats.totalDays}</td><td>${stats.present}</td><td>${stats.netDemerits}</td></tr>`}).join('')}
function renderAttendanceStats(filtered){const uniqueNames=Array.from(new Set(filtered.map(r=>r.employeeName)));const totals=filtered.reduce((acc,r)=>{acc.entries+=1;if(r.mark==='Present')acc.present+=1;if(r.mark==='Late')acc.late+=1;if(r.mark==='Absent'||r.mark==='Call Out'||r.mark==='No Call No Show')acc.absent+=1;return acc},{entries:0,present:0,late:0,absent:0});const net=uniqueNames.reduce((sum,name)=>sum+getAttendanceEmployeeStats(name).netDemerits,0);attendanceTotalEntries.textContent=totals.entries;attendancePresentCount.textContent=totals.present;attendanceLateAbsentCount.textContent=`${totals.late} / ${totals.absent}`;attendanceNetDemerits.textContent=net;attendanceCurrentDepartmentPill.textContent=activeAttendanceDepartment}
function updateAttendanceUndoButton(){attendanceUndoBtn.disabled=!localStorage.getItem(attendanceBackupKey)}
function renderAttendance(){renderAttendanceDepartmentTabs();renderAttendanceEmployeeOptions(attendanceEmployeeInput.value);const filtered=renderAttendanceRecords();renderAttendanceSummary(filtered);renderAttendanceStats(filtered);renderAttendanceRoster();renderAttendanceMoveLog();updateAttendanceUndoButton()}
function addAttendanceRecord(){const employeeName=attendanceEmployeeInput.value.trim();const department=attendanceDepartmentInput.value;const date=attendanceDateInput.value;const mark=attendanceMarkInput.value;const demerits=getDemeritForMark(mark);if(!employeeName){alert('Select an employee first.');attendanceEmployeeInput.focus();return}const duplicate=attendanceRecords.find(r=>r.employeeName===employeeName&&r.department===department&&r.date===date);if(duplicate){const replace=confirm('That employee already has a record for that department and date. Replace it?');if(!replace)return;attendanceRecords=attendanceRecords.filter(r=>!(r.employeeName===employeeName&&r.department===department&&r.date===date))}attendanceRecords.push({id:Date.now(),employeeName,department,date,mark,demerits});saveJson(attendanceStorageKey,attendanceRecords);attendanceEmployeeInput.value='';attendanceMarkInput.value='Present';updateAttendanceAutoDemerit();activeAttendanceDepartment=department;attendanceBatchDateInput.value=date;renderAttendance()}
function selectAllAttendanceRoster(){getRosterEmployees().forEach(emp=>attendanceRosterSelection.add(emp.name));renderAttendanceRoster();}
function clearAttendanceSelection(){attendanceRosterSelection.clear();renderAttendanceRoster();}
function applyBatchAttendance(markOverride=''){const selected=[...attendanceRosterSelection];if(!selected.length){alert('Select at least one employee first.');return}const date=attendanceBatchDateInput.value||new Date().toISOString().slice(0,10);const mark=markOverride||attendanceBatchMarkInput.value||'Present';selected.forEach(employeeName=>{attendanceRecords=attendanceRecords.filter(r=>!(r.employeeName===employeeName&&r.department===activeAttendanceDepartment&&r.date===date));attendanceRecords.push({id:Date.now()+Math.random(),employeeName,department:activeAttendanceDepartment,date,mark,demerits:getDemeritForMark(mark)});});saveJson(attendanceStorageKey,attendanceRecords);renderAttendance();}
function logAttendanceDepartmentMove(){const selected=[...attendanceRosterSelection];if(!selected.length){alert('Select at least one employee first.');return}const toDepartment=attendanceMoveToDepartmentInput.value;if(!toDepartment){alert('Choose where the selected employees moved to.');return}const date=attendanceBatchDateInput.value||new Date().toISOString().slice(0,10);const startTime=attendanceMoveStartTimeInput.value;const endTime=attendanceMoveEndTimeInput.value;const note=attendanceMoveNoteInput.value.trim();selected.forEach(employeeName=>attendanceMoveRecords.unshift({id:Date.now()+Math.random(),employeeName,date,fromDepartment:activeAttendanceDepartment,toDepartment,startTime,endTime,note}));saveJson(attendanceMovesStorageKey,attendanceMoveRecords);attendanceMoveNoteInput.value='';renderAttendanceMoveLog();}
function manageAttendanceEmployees(){document.querySelector('[data-page="employeesPage"]').click();}
function deleteAttendanceRecord(id){attendanceRecords=attendanceRecords.filter(r=>r.id!==id);saveJson(attendanceStorageKey,attendanceRecords);if(selectedProfileName)openAttendanceProfile(selectedProfileName);renderAttendance()}
function deleteAttendanceMoveRecord(id){attendanceMoveRecords=attendanceMoveRecords.filter(r=>r.id!==id);saveJson(attendanceMovesStorageKey,attendanceMoveRecords);renderAttendanceMoveLog()}
window.deleteAttendanceMoveRecord=deleteAttendanceMoveRecord;
function clearAttendanceData(){const confirmed=confirm('Delete all attendance data from this browser? You can undo this once.');if(!confirmed)return;saveJson(attendanceBackupKey,attendanceRecords);attendanceRecords=[];saveJson(attendanceStorageKey,attendanceRecords);renderAttendance();alert('Attendance data cleared. Use Undo clear if needed.');}
function undoAttendanceClear(){const backup=loadJson(attendanceBackupKey,null);if(!backup){alert('No attendance backup found.');return}attendanceRecords=normalizeAttendanceRecords(backup);saveJson(attendanceStorageKey,attendanceRecords);localStorage.removeItem(attendanceBackupKey);renderAttendance()}
function loadAttendanceSampleData(){attendanceRecords=normalizeAttendanceRecords(attendanceSampleData.map(item=>({...item,demerits:getDemeritForMark(item.mark)})));employees=normalizeEmployees(defaultEmployees);saveJson(attendanceStorageKey,attendanceRecords);saveEmployees();localStorage.removeItem(attendanceBackupKey);renderAttendance();renderEmployees()}
function exportAttendanceCsv(){const filtered=getFilteredAttendanceRecords();const rows=[["Employee Name","Department","Date","Mark","Demerits"],...filtered.map(r=>[r.employeeName,r.department,r.date,r.mark,r.demerits])];const csv=rows.map(row=>row.map(cell=>`"${String(cell).replace(/"/g,'""')}"`).join(',')).join('\n');const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`${activeAttendanceDepartment.toLowerCase()}_attendance.csv`;a.click();URL.revokeObjectURL(url)}
function openAttendanceProfile(name){selectedProfileName=name;const stats=getAttendanceEmployeeStats(name);const latestDepartment=stats.records.length?stats.records[stats.records.length-1].department:'No department yet';profileName.textContent=name;profileSubtitle.textContent=`${latestDepartment} • ${stats.totalDays} total records • ${stats.currentStreak} day current present streak`;profileStats.innerHTML=[{label:'Net Demerits',value:stats.netDemerits},{label:'30-Day Credits',value:stats.credits},{label:'Best Streak',value:stats.bestStreak},{label:'Present Days',value:stats.present}].map(card=>`<div class="mini-card"><div class="mini-label">${card.label}</div><div class="mini-value">${card.value}</div></div>`).join('');if(!stats.records.length){profileHistoryBody.innerHTML='<tr><td colspan="4" class="empty">No history found for this employee.</td></tr>'}else{profileHistoryBody.innerHTML=[...stats.records].sort((a,b)=>String(b.date).localeCompare(String(a.date))).map(r=>`<tr><td>${escapeHtml(r.date)}</td><td>${escapeHtml(r.department)}</td><td><span class="badge ${toBadgeClass(r.mark)}">${escapeHtml(r.mark)}</span></td><td>${Number(r.demerits||0)}</td></tr>`).join('')}profileModalBackdrop.classList.add('show')}
function closeAttendanceProfile(){profileModalBackdrop.classList.remove('show');selectedProfileName=''}

document.getElementById('attendanceSeedBtn').addEventListener('click',loadAttendanceSampleData);
document.getElementById('attendanceExportBtn').addEventListener('click',exportAttendanceCsv);
document.getElementById('attendanceAddBtn').addEventListener('click',addAttendanceRecord);
document.getElementById('attendanceApplyBatchBtn').addEventListener('click',()=>applyBatchAttendance());
document.getElementById('attendanceSelectAllBtn').addEventListener('click',selectAllAttendanceRoster);
document.getElementById('attendanceClearSelectionBtn').addEventListener('click',clearAttendanceSelection);
document.getElementById('attendanceMarkAllPresentBtn').addEventListener('click',()=>{selectAllAttendanceRoster();applyBatchAttendance('Present');});
document.getElementById('attendanceLogMoveBtn').addEventListener('click',logAttendanceDepartmentMove);
document.getElementById('attendanceManageEmployeesBtn').addEventListener('click',manageAttendanceEmployees);
document.getElementById('attendanceClearBtn').addEventListener('click',clearAttendanceData);
document.getElementById('attendanceUndoBtn').addEventListener('click',undoAttendanceClear);
document.getElementById('closeProfileBtn').addEventListener('click',closeAttendanceProfile);
attendanceMarkInput.addEventListener('change',updateAttendanceAutoDemerit);
attendanceSearchInput.addEventListener('input',renderAttendance);
attendanceSortByInput.addEventListener('change',renderAttendance);
attendanceBatchDateInput.addEventListener('change',renderAttendanceRoster);
attendanceBatchMarkInput.addEventListener('change',renderAttendanceRoster);
profileModalBackdrop.addEventListener('click',(e)=>{if(e.target===profileModalBackdrop)closeAttendanceProfile()});
window.openAttendanceProfile=openAttendanceProfile;window.deleteAttendanceRecord=deleteAttendanceRecord;

const errorsTotalCount=document.getElementById('errorsTotalCount');
const errorsAbsoluteTotal=document.getElementById('errorsAbsoluteTotal');
const errorsAverageRate=document.getElementById('errorsAverageRate');
const errorsTopType=document.getElementById('errorsTopType');
const errorsRecordsBody=document.getElementById('errorsRecordsBody');
const errorDateInput=document.getElementById('errorDate');
const errorDepartmentInput=document.getElementById('errorDepartment');
const errorAssociateInput=document.getElementById('errorAssociate');
const employeesActiveCount=document.getElementById('employeesActiveCount');
const employeesDepartmentCount=document.getElementById('employeesDepartmentCount');
const employeeManagerNameInput=document.getElementById('employeeManagerName');
const employeeManagerDepartmentInput=document.getElementById('employeeManagerDepartment');
const employeeManagerBirthdayInput=document.getElementById('employeeManagerBirthday');
const employeeManagerSizeInput=document.getElementById('employeeManagerSize');
let employeeEditTargetName='';
let employeeInlineEditName='';
const employeesSearchInput=document.getElementById('employeesSearch');
const employeesDepartmentFilterInput=document.getElementById('employeesDepartmentFilter');
const employeesTableBody=document.getElementById('employeesTableBody');
const errorProofedInput=document.getElementById('errorProofed');
const errorPoNumberInput=document.getElementById('errorPoNumber');
const errorLinkedIdInput=document.getElementById('errorLinkedId');
const errorCategoryInput=document.getElementById('errorCategory');
const errorPalletLocationInput=document.getElementById('errorPalletLocation');
const errorExpectedQtyInput=document.getElementById('errorExpectedQty');
const errorReceivedQtyInput=document.getElementById('errorReceivedQty');
const errorTypeInput=document.getElementById('errorType');
const errorAbsoluteAmountInput=document.getElementById('errorAbsoluteAmount');
const errorRateInput=document.getElementById('errorRate');
const errorNotesInput=document.getElementById('errorNotes');
const errorsSearchInput=document.getElementById('errorsSearch');
const errorsSortByInput=document.getElementById('errorsSortBy');
const errorsDepartmentFilterInput=document.getElementById('errorsDepartmentFilter');
const errorsTypeFilterInput=document.getElementById('errorsTypeFilter');
const errorsNotifiedFilterInput=document.getElementById('errorsNotifiedFilter');

document.getElementById('errorAddBtn').addEventListener('click',addErrorRecord);
errorDepartmentInput.innerHTML=departments.map(d=>`<option value="${d}">${d}</option>`).join('');
employeeManagerDepartmentInput.innerHTML=departments.map(d=>`<option value="${d}">${d}</option>`).join('');
employeesDepartmentFilterInput.innerHTML=['<option value="All">All Departments</option>'].concat(departments.map(d=>`<option value="${d}">${d}</option>`)).join('');
errorDepartmentInput.value='Prepping';
errorDateInput.value=new Date().toISOString().slice(0,10);
errorTypeInput.innerHTML=errorTypes.map(t=>`<option value="${t}">${t}</option>`).join('');
errorsDepartmentFilterInput.innerHTML=['<option value="All">All Departments</option>'].concat(departments.map(d=>`<option value="${d}">${d}</option>`)).join('');
errorsTypeFilterInput.innerHTML=['<option value="All">All Types</option>'].concat(errorTypes.map(t=>`<option value="${t}">${t}</option>`)).join('');
errorExpectedQtyInput.addEventListener('input',calculateErrorMetrics);errorReceivedQtyInput.addEventListener('input',calculateErrorMetrics);errorsSearchInput.addEventListener('input',renderErrors);errorsSortByInput.addEventListener('change',renderErrors);errorsDepartmentFilterInput.addEventListener('change',renderErrors);errorsTypeFilterInput.addEventListener('change',renderErrors);errorsNotifiedFilterInput.addEventListener('change',renderErrors);

function calculateErrorMetrics(){const expected=Number(errorExpectedQtyInput.value||0);const received=Number(errorReceivedQtyInput.value||0);const absolute=Math.abs(expected-received);const rate=expected>0?(absolute/expected)*100:0;errorAbsoluteAmountInput.value=absolute;errorRateInput.value=`${rate.toFixed(2)}%`;return{absolute,rate}}
function renderErrorAssociateOptions(selectedName=''){const active=getActiveEmployees().map(emp=>emp.name);errorAssociateInput.innerHTML=['<option value="">Select associate</option>'].concat(active.map(name=>`<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`)).join('');errorAssociateInput.value=selectedName&&active.includes(selectedName)?selectedName:''}
function clearErrorForm(){errorDateInput.value=new Date().toISOString().slice(0,10);errorDepartmentInput.value='Prepping';errorAssociateInput.value='';errorProofedInput.value='Yes';errorPoNumberInput.value='';errorLinkedIdInput.value='';errorCategoryInput.value='';errorPalletLocationInput.value='';errorExpectedQtyInput.value=0;errorReceivedQtyInput.value=0;errorTypeInput.value='Short';errorNotesInput.value='';calculateErrorMetrics()}
function addErrorRecord(){const metrics=calculateErrorMetrics();const record={id:Date.now(),date:errorDateInput.value,department:errorDepartmentInput.value,associate:errorAssociateInput.value.trim(),proofed:errorProofedInput.value,poNumber:errorPoNumberInput.value.trim(),linkedId:errorLinkedIdInput.value.trim(),category:errorCategoryInput.value.trim(),palletLocation:errorPalletLocationInput.value.trim(),expectedQty:Number(errorExpectedQtyInput.value||0),receivedQty:Number(errorReceivedQtyInput.value||0),errorType:errorTypeInput.value,absoluteAmount:metrics.absolute,errorRate:metrics.rate,notes:errorNotesInput.value.trim()};if(!record.associate){alert('Add the associate name first.');errorAssociateInput.focus();return}errorRecords.unshift(record);saveJson(errorsStorageKey,errorRecords);clearErrorForm();renderErrors()}
function deleteErrorRecord(id){errorRecords=errorRecords.filter(r=>r.id!==id);saveJson(errorsStorageKey,errorRecords);renderErrors()}
function sortErrorRecords(a,b){const mode=errorsSortByInput.value;if(mode==='date_asc')return String(a.date).localeCompare(String(b.date));if(mode==='date_desc')return String(b.date).localeCompare(String(a.date));if(mode==='associate_asc')return a.associate.localeCompare(b.associate);if(mode==='po_asc')return a.poNumber.localeCompare(b.poNumber);if(mode==='absolute_desc')return b.absoluteAmount-a.absoluteAmount||String(b.date).localeCompare(String(a.date));if(mode==='rate_desc')return b.errorRate-a.errorRate||String(b.date).localeCompare(String(a.date));return String(b.date).localeCompare(String(a.date))}
function getFilteredErrors(){const q=errorsSearchInput.value.trim().toLowerCase();const dept=errorsDepartmentFilterInput.value;const type=errorsTypeFilterInput.value;const notified=errorsNotifiedFilterInput.value;return errorRecords.filter(r=>{const matchesSearch=!q||r.associate.toLowerCase().includes(q)||r.poNumber.toLowerCase().includes(q)||r.linkedId.toLowerCase().includes(q)||r.errorType.toLowerCase().includes(q)||r.palletLocation.toLowerCase().includes(q);const matchesDept=dept==='All'||r.department===dept;const matchesType=type==='All'||r.errorType===type;const matchesNotified=notified==='All'||r.proofed===notified;return matchesSearch&&matchesDept&&matchesType&&matchesNotified}).sort(sortErrorRecords)}
function renderErrors(){const filtered=getFilteredErrors();errorsTotalCount.textContent=filtered.length;const absoluteTotal=filtered.reduce((sum,r)=>sum+r.absoluteAmount,0);errorsAbsoluteTotal.textContent=absoluteTotal;const avgRate=filtered.length?filtered.reduce((sum,r)=>sum+r.errorRate,0)/filtered.length:0;errorsAverageRate.textContent=`${avgRate.toFixed(2)}%`;const counts={};filtered.forEach(r=>counts[r.errorType]=(counts[r.errorType]||0)+1);let topType='—',topCount=0;Object.entries(counts).forEach(([type,count])=>{if(count>topCount){topType=type;topCount=count}});errorsTopType.textContent=topType;if(!filtered.length){errorsRecordsBody.innerHTML='<tr><td colspan="15" class="empty">No error records found for this view.</td></tr>';return}errorsRecordsBody.innerHTML=filtered.map(r=>`<tr><td>${escapeHtml(r.date)}</td><td>${escapeHtml(r.department)}</td><td>${escapeHtml(r.associate)}</td><td>${escapeHtml(r.proofed)}</td><td>${escapeHtml(r.poNumber)}</td><td>${escapeHtml(r.linkedId)}</td><td>${escapeHtml(r.category)}</td><td>${escapeHtml(r.palletLocation)}</td><td>${r.expectedQty}</td><td>${r.receivedQty}</td><td><span class="badge ${toBadgeClass(r.errorType)}">${escapeHtml(r.errorType)}</span></td><td>${r.absoluteAmount}</td><td>${r.errorRate.toFixed(2)}%</td><td>${escapeHtml(r.notes)}</td><td><button class="btn danger" onclick="deleteErrorRecord(${r.id})">Delete</button></td></tr>`).join('')}
function loadErrorSampleData(){errorRecords=normalizeErrorRecords(errorSampleData);saveJson(errorsStorageKey,errorRecords);renderErrors();renderEmployees()}
function exportErrorsCsv(){const filtered=getFilteredErrors();const rows=[["Date","Department","Associate","Lead Notified","PO Number","Linked ID","Category","Pallet Location","Expected Qty","Received Qty","Error Type","Absolute Error Amount","Error Rate","Notes"],...filtered.map(r=>[r.date,r.department,r.associate,r.proofed,r.poNumber,r.linkedId,r.category,r.palletLocation,r.expectedQty,r.receivedQty,r.errorType,r.absoluteAmount,`${r.errorRate.toFixed(2)}%`,r.notes])];const csv=rows.map(row=>row.map(cell=>`"${String(cell).replace(/"/g,'""')}"`).join(',')).join('\n');const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='warehouse_errors.csv';a.click();URL.revokeObjectURL(url)}
window.deleteErrorRecord=deleteErrorRecord;

function getFilteredEmployees(){const q=(employeesSearchInput.value||'').trim().toLowerCase();const dept=employeesDepartmentFilterInput.value;return employees.filter(emp=>{const matchesSearch=!q||emp.name.toLowerCase().includes(q)||emp.department.toLowerCase().includes(q);const matchesDept=dept==='All'||emp.department===dept;return matchesSearch&&matchesDept})}
function renderEmployees(){const filtered=getFilteredEmployees();employeesActiveCount.textContent=getActiveEmployees().length;employeesDepartmentCount.textContent=new Set(getActiveEmployees().map(emp=>emp.department)).size;employeeManagerSizeInput.innerHTML=sizeOptions.map(size=>`<option value="${size}">${size||'Select size'}</option>`).join('');if(!filtered.length){employeesTableBody.innerHTML='<tr><td colspan="6" class="empty">No employees found.</td></tr>';}else{employeesTableBody.innerHTML=filtered.map(emp=>{if(employeeInlineEditName===emp.name){return `<tr><td><input id="inlineEmployeeName" value="${escapeHtml(emp.name)}" /></td><td><select id="inlineEmployeeDepartment">${departments.map(d=>`<option value="${d}" ${emp.department===d?'selected':''}>${d}</option>`).join('')}</select></td><td><input id="inlineEmployeeBirthday" type="date" value="${escapeHtml(emp.birthday||'')}" /></td><td><select id="inlineEmployeeSize">${sizeOptions.map(size=>`<option value="${size}" ${String(emp.size||'')===size?'selected':''}>${size||'Select size'}</option>`).join('')}</select></td><td><span class="pill">${emp.active?'Active':'Inactive'}</span></td><td><div class="row-actions"><button class="btn" onclick="saveInlineEmployee('${escapeJs(emp.name)}')">Save</button><button class="btn secondary" onclick="cancelInlineEmployeeEdit()">Cancel</button></div></td></tr>`;}return `<tr><td>${escapeHtml(emp.name)}</td><td>${escapeHtml(emp.department)}</td><td>${formatBirthdayDisplay(emp.birthday)}</td><td>${escapeHtml(emp.size||'—')}</td><td><span class="pill">${emp.active?'Active':'Inactive'}</span></td><td><div class="row-actions"><button class="btn secondary" onclick="editEmployee('${escapeJs(emp.name)}')">Edit</button><button class="btn danger" onclick="removeEmployee('${escapeJs(emp.name)}')">Remove</button></div></td></tr>`;}).join('')}employeeManagerSizeInput.value=employeeManagerSizeInput.value||'';renderAttendanceEmployeeOptions(attendanceEmployeeInput.value);renderAttendanceRoster();renderErrorAssociateOptions(errorAssociateInput.value)}
function addEmployee(){const name=employeeManagerNameInput.value.trim();const department=employeeManagerDepartmentInput.value;const birthday=employeeManagerBirthdayInput.value;const size=String(employeeManagerSizeInput.value||'').trim().toUpperCase();if(!name){alert('Enter an employee name first.');employeeManagerNameInput.focus();return}const existing=getEmployeeByName(name);if(existing){existing.department=department;existing.birthday=birthday;existing.size=size;existing.active=true;}else{employees.push({name,department,birthday,size,active:true});employees=normalizeEmployees(employees)}saveEmployees();employeeManagerNameInput.value='';employeeManagerBirthdayInput.value='';employeeManagerSizeInput.value='';renderEmployees();renderCalendar();}
function removeEmployee(name){const confirmed=confirm(`Remove ${name} from the shared employee source? Existing history will stay in records.`);if(!confirmed)return;employees=employees.filter(emp=>emp.name!==name);if(employeeInlineEditName===name){employeeInlineEditName='';}saveEmployees();renderEmployees();renderCalendar();}
function editEmployee(name){employeeInlineEditName=name;renderEmployees();setTimeout(()=>{const input=document.getElementById('inlineEmployeeName');if(input) input.focus();},0);}
function cancelInlineEmployeeEdit(){employeeInlineEditName='';renderEmployees();}
function saveInlineEmployee(originalName){const name=(document.getElementById('inlineEmployeeName')?.value||'').trim();const department=document.getElementById('inlineEmployeeDepartment')?.value||'Receiving';const birthday=document.getElementById('inlineEmployeeBirthday')?.value||'';const size=String(document.getElementById('inlineEmployeeSize')?.value||'').trim().toUpperCase();if(!name){alert('Employee name cannot be blank.');return}const duplicate=employees.find(emp=>emp.name===name&&emp.name!==originalName);if(duplicate){alert('Another employee already has that name.');return}const employee=getEmployeeByName(originalName);if(!employee) return;employee.name=name;employee.department=department;employee.birthday=birthday;employee.size=size;employee.active=true;employees=normalizeEmployees(employees);saveEmployees();employeeInlineEditName='';renderEmployees();renderCalendar();}
window.editEmployee=editEmployee;
window.cancelInlineEmployeeEdit=cancelInlineEmployeeEdit;
window.saveInlineEmployee=saveInlineEmployee;
window.removeEmployee=removeEmployee;

// Add small buttons to errors hero dynamically for consistency
const errorsHero=document.querySelector('#errorsPage .hero');
const errorsActions=document.createElement('div');errorsActions.className='toolbar right';errorsActions.innerHTML='<button class="btn secondary" id="errorsSeedBtn">Load sample data</button><button class="btn" id="errorsExportBtn">Export CSV</button>';errorsHero.appendChild(errorsActions);document.getElementById('errorsSeedBtn').addEventListener('click',loadErrorSampleData);document.getElementById('errorsExportBtn').addEventListener('click',exportErrorsCsv);

document.getElementById('employeeAddBtn').addEventListener('click',addEmployee);
employeesSearchInput.addEventListener('input',renderEmployees);
employeesDepartmentFilterInput.addEventListener('change',renderEmployees);
const calendarHeaderRow=document.getElementById('calendarHeaderRow');
const calendarGrid=document.getElementById('calendarGrid');
const calendarMonthTitle=document.getElementById('calendarMonthTitle');
const calendarCurrentMonthLabel=document.getElementById('calendarCurrentMonthLabel');
const calendarBirthdaysLinked=document.getElementById('calendarBirthdaysLinked');
let calendarCursor=new Date();
calendarCursor.setDate(1);

function formatIsoDateForDisplay(dateStr){
  if(!dateStr) return '—';
  const d=new Date(String(dateStr).trim()+'T00:00:00');
  if(Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric'});
}
async function setAssemblyDateAndNavigate(dateStr,openAssemblyPage=true){
  const trimmed=String(dateStr||'').trim();
  if(!trimmed || !assemblyDateInput) return;
  assemblyDateInput.value=trimmed;
  const d=new Date(trimmed+'T00:00:00');
  if(!Number.isNaN(d.getTime())){
    calendarCursor=new Date(d.getFullYear(),d.getMonth(),1);
  }
  if(openAssemblyPage){
    activatePage('assemblyPage');
  }
  renderCalendar();
  await loadAssemblyFromBackend();
  renderAssembly();
  setTimeout(()=>{
    document.getElementById('assemblyPage')?.scrollIntoView({behavior:'smooth',block:'start'});
    assemblyDateInput?.focus();
  },40);
}
function changeAssemblyDateByDays(offsetDays){
  const current=assemblyDateInput?.value||new Date().toISOString().slice(0,10);
  const d=new Date(current+'T00:00:00');
  d.setDate(d.getDate()+offsetDays);
  setAssemblyDateAndNavigate(d.toISOString().slice(0,10),false);
}
function injectAssemblyQuickDateControls(){
  const toolbarLeft=document.querySelector('#assemblyPage .assembly-toolbar-stack .left');
  if(!toolbarLeft || document.getElementById('assemblyQuickDateControls')) return;
  const wrapper=document.createElement('div');
  wrapper.className='assembly-quick-date-controls';
  wrapper.id='assemblyQuickDateControls';
  wrapper.innerHTML='' +
    '<button class="btn secondary assembly-jump-btn" type="button" data-jump="today">Today</button>' +
    '<input type="date" class="assembly-date-picker" />';
  toolbarLeft.appendChild(wrapper);
  const dateInput = wrapper.querySelector('.assembly-date-picker');
  if(dateInput){
    dateInput.addEventListener('change',()=>{
      if(dateInput.value){
        setAssemblyDateAndNavigate(dateInput.value,false);
      }
    });
  }
  wrapper.querySelectorAll('.assembly-jump-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const mode=btn.dataset.jump;
      if(mode==='today'){
        setAssemblyDateAndNavigate(new Date().toISOString().slice(0,10),false);
        return;
      }
      // removed manual prompt
      const offset=Number(mode||0);
      if(Number.isFinite(offset)) changeAssemblyDateByDays(offset);
    });
  });
}

function renderCalendar(){
  const days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  calendarHeaderRow.innerHTML=days.map(day=>`<div class="calendar-day-name">${day}</div>`).join('');
  const year=calendarCursor.getFullYear();
  const month=calendarCursor.getMonth();
  const firstDay=new Date(year,month,1);
  const startWeekday=firstDay.getDay();
  const daysInMonth=new Date(year,month+1,0).getDate();
  const prevMonthDays=new Date(year,month,0).getDate();
  const monthLabel=calendarCursor.toLocaleString('en-US',{month:'long',year:'numeric'});
  const birthdayEvents=getBirthdayEventsForMonth(year,month);
  calendarMonthTitle.textContent=monthLabel;
  calendarCurrentMonthLabel.textContent=monthLabel;
  calendarBirthdaysLinked.textContent=birthdayEvents.length;
  const cells=[];
  for(let i=0;i<42;i++){
    let dayNumber='';
    let muted=false;
    let cellDate='';
    if(i<startWeekday){
      dayNumber=prevMonthDays-startWeekday+i+1;
      muted=true;
      const d=new Date(year,month-1,dayNumber);
      cellDate=d.toISOString().slice(0,10);
    } else if(i>=startWeekday+daysInMonth){
      dayNumber=i-(startWeekday+daysInMonth)+1;
      muted=true;
      const d=new Date(year,month+1,dayNumber);
      cellDate=d.toISOString().slice(0,10);
    } else {
      dayNumber=i-startWeekday+1;
      const d=new Date(year,month,dayNumber);
      cellDate=d.toISOString().slice(0,10);
    }
    let eventsHtml='';
    if(!muted){
      const dayBirthdays=birthdayEvents.filter(item=>item.day===dayNumber);
      const assemblySummary=getAssemblyDaySummary(cellDate);
      if(assemblySummary.pbCount>0){
        eventsHtml+=`<div class="calendar-event">📦 ${assemblySummary.pbCount} PB${assemblySummary.pbCount===1?'':'s'}</div>`;
        eventsHtml+=`<div class="calendar-event">🧮 ${assemblySummary.units.toLocaleString()} units</div>`;
        eventsHtml+=`<div class="calendar-event">📚 ${assemblySummary.packs.toLocaleString()} packs</div>`;
      }
      eventsHtml+=dayBirthdays.map(item=>`<div class="calendar-event">🎂 ${escapeHtml(item.name)}</div>`).join('');
      if(!eventsHtml&&dayNumber===1){
        eventsHtml='<div class="calendar-event placeholder">Birthdays and Assembly schedule appear here.</div>';
      }
    }
    const assemblySummary=getAssemblyDaySummary(cellDate);
    const canJump=!muted && assemblySummary.pbCount>0;
    const jumpClass=canJump&&assemblySummary.pbCount>0?' calendar-cell-linkable':'';
    const jumpAttr=canJump?` role="button" tabindex="0" data-assembly-date="${cellDate}" aria-label="Open assembly for ${cellDate}"`:'';
    const goToAssemblyBtn=(!muted&&assemblySummary.pbCount>0)?`<button class="calendar-assembly-link" type="button" data-assembly-date="${cellDate}">Open Assembly</button>`:'';
    cells.push(`<div class="calendar-cell ${muted?'muted':''}${jumpClass}"${jumpAttr}><div class="calendar-date">${dayNumber}</div>${eventsHtml}${goToAssemblyBtn}</div>`);
  }
  calendarGrid.innerHTML=cells.join('');
  calendarGrid.querySelectorAll('[data-assembly-date]').forEach(node=>{
    const dateStr=node.getAttribute('data-assembly-date');
    const handler=(event)=>{
      event.preventDefault();
      event.stopPropagation();
      setAssemblyDateAndNavigate(dateStr,true);
    };
    if(node.tagName==='BUTTON'){
      node.addEventListener('click',handler);
    } else {
      node.addEventListener('click',handler);
      node.addEventListener('keydown',(event)=>{
        if(event.key==='Enter' || event.key===' '){
          handler(event);
        }
      });
    }
  });
}

document.getElementById('calendarPrevBtn').addEventListener('click',()=>{calendarCursor.setMonth(calendarCursor.getMonth()-1);renderCalendar();});
document.getElementById('calendarNextBtn').addEventListener('click',()=>{calendarCursor.setMonth(calendarCursor.getMonth()+1);renderCalendar();});

function renderHome(){
  const snap = getExecutiveSnapshot();
  const today=new Date().toISOString().slice(0,10);
  const activeEmployees=getActiveEmployees();
  const currentMonth=new Date().getMonth();
  const birthdaysThisMonth=activeEmployees.filter(emp=>emp.birthday && new Date(emp.birthday+'T00:00:00').getMonth()===currentMonth);
  const todayAttendance=attendanceRecords.filter(r=>r.date===today);
  const presentToday=todayAttendance.filter(r=>r.mark==='Present').length;
  const lateToday=todayAttendance.filter(r=>r.mark==='Late').length;
  const absentToday=todayAttendance.filter(r=>r.mark==='Absent' || r.mark==='Call Out').length;

  const selectedAssemblyRows = snap.rows;
  const fmtCurrency=v=>Number(v||0).toLocaleString('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2});

  // Alert banner
  const alertEl=document.getElementById('homeAlertBanner');
  if(alertEl){
    const parts=[];
    if(snap.overdueCount>0) parts.push(`<span class="home-alert-pill home-alert-overdue">🔴 ${snap.overdueCount} overdue</span>`);
    if(snap.atRiskCount>0) parts.push(`<span class="home-alert-pill home-alert-atrisk">🟡 ${snap.atRiskCount} at risk</span>`);
    if(snap.revenueAtRisk>0) parts.push(`<span class="home-alert-pill home-alert-revenue">💰 ${fmtCurrency(snap.revenueAtRisk)} revenue at risk</span>`);
    if(parts.length){
      alertEl.innerHTML=parts.join(' ');
      alertEl.hidden=false;
    } else {
      alertEl.innerHTML='<span class="home-alert-pill home-alert-ok">✅ No urgent issues today</span>';
      alertEl.hidden=false;
    }
  }

  homeEmployeesCount.textContent=activeEmployees.length;
  homeBirthdaysCount.textContent=birthdaysThisMonth.length;
  homeErrorsCount.textContent=errorRecords.length;
  homeAssemblyPbCount.textContent=selectedAssemblyRows.length;
  homePresentToday.textContent=presentToday;
  homeLateToday.textContent=lateToday;
  homeAbsentToday.textContent=absentToday;
  homeAssemblyUnits.textContent=snap.totalUnits.toLocaleString();
  homeAssemblyDoneUnits.textContent=snap.doneUnits.toLocaleString();
  homeAssemblyCapacity.textContent=snap.capacity.toLocaleString();
  homeAssemblyCompletion.textContent=`${snap.completion.toFixed(0)}%`;
  homeAssemblyCompletion.style.color = snap.completion > 0 ? '#16a34a' : '';

  // Revenue snapshot
  const elScheduledRev=document.getElementById('homeScheduledRevenue');
  const elDoneRev=document.getElementById('homeDoneRevenue');
  const elRemainingRev=document.getElementById('homeRemainingRevenue');
  const elRevCompletion=document.getElementById('homeRevenueCompletion');
  if(elScheduledRev) elScheduledRev.textContent=fmtCurrency(snap.scheduledRevenue);
  if(elDoneRev) elDoneRev.textContent=fmtCurrency(snap.doneRevenue);
  if(elRemainingRev) elRemainingRev.textContent=fmtCurrency(snap.remainingRevenue);
  if(elRevCompletion) elRevCompletion.textContent=`${snap.revenueCompletion.toFixed(0)}%`;

  const stageSummary=[
    {label:'A.A.', key:'aa'},
    {label:'Print', key:'print'},
    {label:'Picked', key:'picked'},
    {label:'Line', key:'line'},
    {label:'DPMO', key:'dpmo'},
    {label:'Done', key:'done'}
  ].map(stage=>{
    const rows=selectedAssemblyRows.filter(row=>row.stage===stage.key);
    return {label:stage.label, units:rows.reduce((sum,row)=>sum+getAssemblyUnits(row),0), pbs:rows.length};
  });

  homeAssemblyStageSummary.innerHTML=stageSummary.map(item=>`<tr><td>${item.label}</td><td>${item.units.toLocaleString()}</td><td>${item.pbs}</td></tr>`).join('');

  const sorted=prioritySortRows(selectedAssemblyRows);
  homeAssemblyScheduleBody.innerHTML=sorted.length ? sorted.map(({row,priority})=>{
    const pLabel=priority.label?`<span class="mini-label ${priority.cls}">${priority.label}</span> `:'';
    return `<tr class="${priority.cls}"><td>${pLabel}${escapeHtml(getAssemblyWorkTypeLabel(row.workType)+(row.isPartial?' • Partial':''))}</td><td>${escapeHtml(row.pb||'—')}</td><td>${escapeHtml(row.so||'—')}</td><td>${escapeHtml(row.account||'—')}</td><td>${getAssemblyUnits(row).toLocaleString()} <span class="mini-label" style="display:block;margin-top:4px">${escapeHtml(formatAssemblyQty(row))}</span></td><td>${escapeHtml((row.stage||'').toUpperCase()==='AA'?'A.A.':(row.stage==='aa'?'A.A.':row.stage==='dpmo'?'DPMO':String(row.stage||'—').charAt(0).toUpperCase()+String(row.stage||'').slice(1)))}</td><td>${escapeHtml(row.status||'—')}</td><td>${escapeHtml(getEffectiveIhdForRow(row)||'—')}</td><td>${getAssemblyOpenLink(row)?`<a class="queue-link" href="${escapeHtml(getAssemblyOpenLink(row))}" target="_blank" rel="noopener noreferrer">Open</a>`:'—'}</td><td>${escapeHtml(row.rescheduleNote||'—')}</td><td>$${Number(getEffectiveSubtotalForRow(row)||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</td></tr>`;
  }).join('') : '<tr><td colspan="11" class="empty">No assembly schedule rows for today.</td></tr>';

  const upcomingBirthdays=[...activeEmployees]
    .filter(emp=>emp.birthday)
    .map(emp=>{
      const date=new Date(emp.birthday+'T00:00:00');
      return {name:emp.name, birthday:date};
    })
    .sort((a,b)=>a.birthday.getMonth()-b.birthday.getMonth() || a.birthday.getDate()-b.birthday.getDate())
    .slice(0,6);
  homeBirthdaysList.innerHTML=upcomingBirthdays.length ? upcomingBirthdays.map(item=>`<div class="module-item"><h3>${escapeHtml(item.name)}</h3><p>${item.birthday.toLocaleDateString('en-US',{month:'long',day:'numeric'})}</p></div>`).join('') : '<div class="module-item"><h3>No birthdays yet</h3><p>Add birthdays in the Employees tab to see them here.</p></div>';

  const recentErrors=[...errorRecords].sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,5);
  homeErrorsList.innerHTML=recentErrors.length ? recentErrors.map(item=>`<div class="module-item"><h3>${escapeHtml(item.errorType)} — ${escapeHtml(item.associate||'Unknown')}</h3><p>${escapeHtml(item.date)} • ${escapeHtml(item.department)} • PO ${escapeHtml(item.poNumber||'—')}</p></div>`).join('') : '<div class="module-item"><h3>No errors logged</h3><p>Recent warehouse issues will appear here.</p></div>';
}

clearErrorForm();
renderAttendanceEmployeeOptions();
renderErrorAssociateOptions();
restoreActivePage();

// Print Snapshot button
const printSnapshotBtn=document.getElementById('printSnapshotBtn');
if(printSnapshotBtn){
  printSnapshotBtn.addEventListener('click',()=>{
    if(typeof exportStakeholderDashboardDocx==='function'){
      exportStakeholderDashboardDocx();
    } else {
      window.print();
    }
  });
}


// =============================
// DEBUG / STABILITY LAYER
// =============================
let lastDebugStatus = { level: 'warn', text: 'System starting', source: 'startup' };

function updateDebugStrip(level = 'warn', text = 'System update', source = 'system') {
  lastDebugStatus = { level, text, source };
  const strip = document.getElementById('debugStatusStrip');
  const textEl = document.getElementById('debugStatusText');
  const timeEl = document.getElementById('debugStatusTime');
  const sourceEl = document.getElementById('debugStatusSource');
  if (!strip || !textEl || !timeEl || !sourceEl) return;

  strip.hidden = false;
  strip.classList.remove('is-ok', 'is-warn', 'is-error');
  strip.classList.add(level === 'error' ? 'is-error' : level === 'ok' ? 'is-ok' : 'is-warn');
  textEl.textContent = text;
  timeEl.textContent = new Date().toLocaleTimeString();
  sourceEl.textContent = source;
}

window.updateDebugStrip = updateDebugStrip;

window.addEventListener('error', (event) => {
  updateDebugStrip('error', event?.message || 'JavaScript error', 'window.error');
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = event?.reason?.message || event?.reason || 'Unhandled promise rejection';
  updateDebugStrip('error', String(reason), 'promise');
});



// =============================
// SAFE EXECUTION LAYER
// =============================
function safeRun(fn, label = 'task') {
  try {
    return fn();
  } catch (err) {
    console.error(`[${label}]`, err);
    if (typeof updateDebugStrip === 'function') {
      updateDebugStrip('error', `${label} failed`, label);
    }
    return null;
  }
}

window.safeRun = safeRun;



// =============================
// SHARED ACTIONS LAYER
// =============================
function updateAssemblyData() {
  safeRun(() => saveJson(assemblyBoardStorageKey, assemblyBoardRows), 'saveAssembly');
  safeRun(() => renderAssembly(), 'renderAssembly');
  safeRun(() => renderHome(), 'renderHome');
  safeRun(() => renderCalendar(), 'renderCalendar');
  if (typeof updateDebugStrip === 'function') {
    updateDebugStrip('ok', 'Assembly synced', 'updateAssemblyData');
  }
}

function updateQueueData() {
  safeRun(() => saveQueue(), 'saveQueue');
  safeRun(() => saveIncompleteQueue(), 'saveIncompleteQueue');
  safeRun(() => saveScheduledQueue(), 'saveScheduledQueue');
  safeRun(() => renderQueue(), 'renderQueue');
  if (typeof updateDebugStrip === 'function') {
    updateDebugStrip('ok', 'Queue synced', 'updateQueueData');
  }
}

function updateAllData() {
  safeRun(() => saveQueue(), 'saveQueue');
  safeRun(() => saveIncompleteQueue(), 'saveIncompleteQueue');
  safeRun(() => saveScheduledQueue(), 'saveScheduledQueue');
  safeRun(() => saveJson(assemblyBoardStorageKey, assemblyBoardRows), 'saveAssembly');
  safeRun(() => renderQueue(), 'renderQueue');
  safeRun(() => renderAssembly(), 'renderAssembly');
  safeRun(() => renderHome(), 'renderHome');
  safeRun(() => renderCalendar(), 'renderCalendar');
  if (typeof updateDebugStrip === 'function') {
    updateDebugStrip('ok', 'Safe full sync complete', 'updateAllData');
  }
}

window.updateAssemblyData = updateAssemblyData;
window.updateQueueData = updateQueueData;
window.updateAllData = updateAllData;


async function bootstrapWarehouseHub(){
  await loadAssemblyFromBackend();
  renderAttendance();
  renderErrors();
  renderEmployees();
  renderCalendar();
  renderAssembly();
  renderQueue();
  renderRevenueReferenceStats();
  renderHome();
  if (typeof updateDebugStrip === 'function') {
    updateDebugStrip('ok', 'App loaded successfully', 'bootstrapWarehouseHub');
  }
}
bootstrapWarehouseHub();
queueSearchInput.addEventListener('input',renderQueue);
queueSortByInput.addEventListener('change',renderQueue);
queueClearSearchBtn.addEventListener('click',()=>{queueSearchInput.value='';renderQueue();});
scheduledQueueLimit.addEventListener('change',renderQueue);
readyQueueLimit.addEventListener('change',renderQueue);
incompleteQueueLimit.addEventListener('change',renderQueue);
document.getElementById('queueImportBtn')?.addEventListener('click',importQueueReport);
document.getElementById('queueClearBtn')?.addEventListener('click',clearQueue);
document.getElementById('revenueImportBtn')?.addEventListener('click',importRevenueReference);
document.getElementById('revenueClearBtn')?.addEventListener('click',clearRevenueReference);
document.getElementById('closeScheduleBtn').addEventListener('click',closeScheduleModal);
document.getElementById('cancelScheduleBtn').addEventListener('click',closeScheduleModal);
document.getElementById('confirmScheduleBtn').addEventListener('click',confirmSchedule);
scheduleModeInput.addEventListener('change',()=>{
  const isPartial=scheduleModeInput.value==='partial';
  scheduleQtyInput.disabled=!isPartial;
  scheduleRemainderToggleInput.disabled=!isPartial;
  if(!isPartial){
    scheduleQtyInput.value=scheduleFullQtyInput.value||0;
    scheduleRemainderToggleInput.value='false';
    scheduleRemainderDateInput.value='';
    scheduleRemainderDateInput.disabled=true;
  } else {
    scheduleRemainderToggleInput.disabled=false;
    scheduleRemainderDateInput.disabled=scheduleRemainderToggleInput.value!=='true';
  }
});
scheduleRemainderToggleInput.addEventListener('change',()=>{
  const enabled=scheduleModeInput.value==='partial' && scheduleRemainderToggleInput.value==='true';
  scheduleRemainderDateInput.disabled=!enabled;
  if(!enabled) scheduleRemainderDateInput.value='';
});
scheduleModeInput.dispatchEvent(new Event('change'));
scheduleModalBackdrop.addEventListener('click',(e)=>{if(e.target===scheduleModalBackdrop)closeScheduleModal()});


function formatCurrencyWhole(value){
  const num=Number(value||0);
  return num.toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0});
}
function getStageLabel(stage){
  const map={aa:'A.A.',print:'Print',picked:'Picked',line:'Line',dpmo:'DPMO',done:'Done'};
  return map[String(stage||'').trim().toLowerCase()]||'—';
}
function buildCellBorders(color='2b4b64'){
  return {
    top:{style:docx.BorderStyle.SINGLE,size:4,color},
    bottom:{style:docx.BorderStyle.SINGLE,size:4,color},
    left:{style:docx.BorderStyle.SINGLE,size:4,color},
    right:{style:docx.BorderStyle.SINGLE,size:4,color}
  };
}
function buildKpiCell(label,value){
  return new docx.TableCell({
    children:[
      new docx.Paragraph({children:[new docx.TextRun({text:label,bold:true,color:'FFFFFF',size:20})]}),
      new docx.Paragraph({children:[new docx.TextRun({text:value,bold:true,color:'7DE3F4',size:32})]})
    ],
    margins:{top:120,bottom:120,left:120,right:120},
    verticalAlign:docx.VerticalAlign.CENTER,
    shading:{fill:'112B3C'},
    borders:buildCellBorders('1E5169')
  });
}
function buildHeaderCell(text){
  return new docx.TableCell({
    children:[new docx.Paragraph({children:[new docx.TextRun({text:text,bold:true,color:'FFFFFF',size:18})]})],
    margins:{top:90,bottom:90,left:90,right:90},
    verticalAlign:docx.VerticalAlign.CENTER,
    shading:{fill:'163C52'},
    borders:buildCellBorders('1F5977')
  });
}
function buildBodyCell(text){
  return new docx.TableCell({
    children:[new docx.Paragraph({children:[new docx.TextRun({text:String(text||'—'),color:'1A1A1A',size:18})]})],
    margins:{top:70,bottom:70,left:90,right:90},
    verticalAlign:docx.VerticalAlign.CENTER,
    borders:buildCellBorders('D9E6EF')
  });
}
async function exportStakeholderDashboardDocx(){
  if(typeof docx==='undefined'){
    alert('The Word dashboard library is still loading. Try again in a moment.');
    return;
  }
  const baseDateStr=String(assemblyDateInput?.value||new Date().toISOString().slice(0,10)).trim();
  const baseDate=new Date(baseDateStr+'T00:00:00');
  if(Number.isNaN(baseDate.getTime())){
    alert('Choose a valid Assembly date first.');
    return;
  }

  const dateKeys=[];
  for(let i=0;i<7;i++){
    const d=new Date(baseDate);
    d.setDate(d.getDate()+i);
    dateKeys.push(d.toISOString().slice(0,10));
  }

  const rowsByDay=dateKeys.map(dateKey=>{
    const rows=assemblyBoardRows.filter(row=>String(row.date||'')===dateKey);
    const scheduledUnits=rows.reduce((sum,row)=>sum+getAssemblyUnits(row),0);
    const scheduledRevenue=rows.reduce((sum,row)=>sum+Number(getEffectiveSubtotalForRow(row)||0),0);
    const doneRevenue=rows.filter(row=>String(row.stage||'')==='done').reduce((sum,row)=>sum+Number(getEffectiveSubtotalForRow(row)||0),0);
    return {dateKey,rows,scheduledUnits,scheduledRevenue,doneRevenue};
  }).filter(day=>day.rows.length);

  if(!rowsByDay.length){
    alert('There are no scheduled rows in the selected 7-day window.');
    return;
  }

  const totalPbs=rowsByDay.reduce((sum,day)=>sum+day.rows.length,0);
  const totalUnits=rowsByDay.reduce((sum,day)=>sum+day.scheduledUnits,0);
  const scheduledRevenue=rowsByDay.reduce((sum,day)=>sum+day.scheduledRevenue,0);
  const doneRevenue=rowsByDay.reduce((sum,day)=>sum+day.doneRevenue,0);
  const remainingRevenue=Math.max(0,scheduledRevenue-doneRevenue);
  const completionPct=scheduledRevenue>0?Math.round((doneRevenue/scheduledRevenue)*100):0;
  const generatedAt=new Date().toLocaleString('en-US');

  const children=[
    new docx.Paragraph({
      alignment:docx.AlignmentType.CENTER,
      spacing:{after:120},
      children:[new docx.TextRun({text:'ASSEMBLY SCHEDULE',bold:true,size:34,color:'102A43'})]
    }),
    new docx.Paragraph({
      alignment:docx.AlignmentType.CENTER,
      spacing:{after:60},
      children:[new docx.TextRun({text:'7-Day Stakeholder Dashboard',bold:true,size:26,color:'1E5169'})]
    }),
    new docx.Paragraph({
      alignment:docx.AlignmentType.CENTER,
      spacing:{after:280},
      children:[new docx.TextRun({text:`Window: ${baseDate.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})} → ${new Date(dateKeys[dateKeys.length-1]+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})} | Generated: ${generatedAt}`,italics:true,size:18,color:'486581'})]
    }),
    new docx.Table({
      width:{size:100,type:docx.WidthType.PERCENTAGE},
      rows:[
        new docx.TableRow({children:[
          buildKpiCell('Total Scheduled PBs (7 Days)',String(totalPbs)),
          buildKpiCell('Total Units (7 Days)',Number(totalUnits).toLocaleString()),
          buildKpiCell('Scheduled Revenue',formatCurrencyWhole(scheduledRevenue))
        ]}),
        new docx.TableRow({children:[
          buildKpiCell('Done Revenue',formatCurrencyWhole(doneRevenue)),
          buildKpiCell('Remaining Revenue',formatCurrencyWhole(remainingRevenue)),
          buildKpiCell('Completion %',`${completionPct}%`)
        ]})
      ]
    }),
    new docx.Paragraph({text:'',spacing:{after:180}})
  ]

  rowsByDay.forEach(day=>{
    const displayDate=new Date(day.dateKey+'T00:00:00').toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'});
    children.push(
      new docx.Paragraph({
        spacing:{before:220,after:120},
        children:[new docx.TextRun({text:displayDate,bold:true,size:24,color:'102A43'})]
      }),
      new docx.Paragraph({
        spacing:{after:140},
        children:[new docx.TextRun({text:`${day.rows.length} PBs • ${Number(day.scheduledUnits).toLocaleString()} units • ${formatCurrencyWhole(day.scheduledRevenue)} scheduled`,bold:true,size:18,color:'1E5169'})]
      })
    );
    const tableRows=[
      new docx.TableRow({tableHeader:true,children:[
        buildHeaderCell('Pack Builder'),
        buildHeaderCell('Sales Order'),
        buildHeaderCell('Account'),
        buildHeaderCell('Units'),
        buildHeaderCell('Stage'),
        buildHeaderCell('Status'),
        buildHeaderCell('IHD'),
        buildHeaderCell('Revenue ($)')
      ]})
    ];
    day.rows.forEach(row=>{
      tableRows.push(new docx.TableRow({children:[
        buildBodyCell(row.pb||'—'),
        buildBodyCell(row.so||'—'),
        buildBodyCell(row.account||'—'),
        buildBodyCell(Number(getAssemblyUnits(row)||0).toLocaleString()),
        buildBodyCell(getStageLabel(row.stage)),
        buildBodyCell(row.status||'—'),
        buildBodyCell(getEffectiveIhdForRow(row)||'—'),
        buildBodyCell(formatCurrencyWhole(getEffectiveSubtotalForRow(row)||0))
      ]}));
    });
    children.push(new docx.Table({
      width:{size:100,type:docx.WidthType.PERCENTAGE},
      rows:tableRows
    }));
  });

  children.push(
    new docx.Paragraph({
      alignment:docx.AlignmentType.RIGHT,
      spacing:{before:220},
      children:[new docx.TextRun({text:'Generated automatically from Warehouse Operations Hub',italics:true,size:16,color:'6B7C93'})]
    })
  );

  const doc=new docx.Document({
    sections:[{
      properties:{page:{margin:{top:720,right:720,bottom:720,left:720}}},
      children
    }]
  });

  const blob=await docx.Packer.toBlob(doc);
  const url=URL.createObjectURL(blob);
  const link=document.createElement('a');
  link.href=url;
  link.download=`stakeholder_dashboard_7day_${baseDateStr}.docx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
const exportStakeholderDashboardBtn=document.getElementById('exportStakeholderDashboardBtn');
if(exportStakeholderDashboardBtn){
  exportStakeholderDashboardBtn.addEventListener('click',exportStakeholderDashboardDocx);
}

window.addEventListener('storage',(event)=>{
  if(!assemblySyncKeys.has(event.key)) return;
  if(event.key===assemblyBoardStorageKey) assemblyBoardRows=normalizeAssemblyBoardRows(loadJson(assemblyBoardStorageKey,[]));
  if(event.key===queueStorageKey) availableQueueRows=normalizeQueueRows(loadJson(queueStorageKey,[]));
  if(event.key===scheduledQueueStorageKey) scheduledQueueRows=normalizeScheduledQueueRows(loadJson(scheduledQueueStorageKey,[]));
  if(event.key===incompleteQueueStorageKey) incompleteQueueRows=normalizeQueueRows(loadJson(incompleteQueueStorageKey,[]));
  if(event.key===revenueReferenceStorageKey) revenueReferenceRows=normalizeRevenueReferenceRows(loadJson(revenueReferenceStorageKey,[]));
  renderAssembly();
  renderQueue();
  renderRevenueReferenceStats();
  renderHome();
});
