const departments=["Receiving","Prepping","Assembly","Inventory","Fulfillment"];
const markOptions=["Present","Late","Absent","Excused","Call Out"];
const markDemerits={"Present":0,"Late":0.5,"Absent":1,"Excused":0,"Call Out":1};
const errorTypes=["Short","Over","Input Error","Damage","Mislabel","Missing ID","Wrong Location","Other"];

const attendanceStorageKey="ops_hub_attendance_records_v2";
const employeesStorageKey="ops_hub_employees_v1";
const attendanceBackupKey="ops_hub_attendance_backup_v2";
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
let employees=normalizeEmployees(loadJson(employeesStorageKey,defaultEmployees));
let activeAttendanceDepartment="Receiving";
let selectedProfileName="";
let errorRecords=normalizeErrorRecords(loadJson(errorsStorageKey,[]));
let assemblyBoardRows=normalizeAssemblyBoardRows(loadJson(assemblyBoardStorageKey,[]));
let availableQueueRows=normalizeQueueRows(loadJson(queueStorageKey,[]));
let scheduledQueueRows=normalizeScheduledQueueRows(loadJson(scheduledQueueStorageKey,[]));
let incompleteQueueRows=normalizeQueueRows(loadJson(incompleteQueueStorageKey,[]));
let queueRawRowCount=0;
let revenueReferenceRows=normalizeRevenueReferenceRows(loadJson(revenueReferenceStorageKey,[]));

const navButtons=document.querySelectorAll('.nav-btn');
const pages=document.querySelectorAll('.page');

function activatePage(pageId,{updateHash=true,persist=true}={}){
  if(!pageId) return;
  const targetPage=document.getElementById(pageId);
  if(!targetPage) return;
  navButtons.forEach(btn=>btn.classList.remove('active'));
  pages.forEach(page=>page.classList.remove('active'));
  targetPage.classList.add('active');
  const targetBtn=[...navButtons].find(btn=>btn.dataset.page===pageId);
  if(targetBtn) targetBtn.classList.add('active');
  if(persist){
    localStorage.setItem('ops_hub_active_page',pageId);
  }
  if(updateHash && window.location.hash!==`#${pageId}`){
    history.replaceState(null,'',`#${pageId}`);
  }
}

navButtons.forEach(btn=>btn.addEventListener('click',()=>activatePage(btn.dataset.page)));

function restoreActivePage(){
  const hashPage=window.location.hash.replace('#','').trim();
  const savedPage=localStorage.getItem('ops_hub_active_page');
  const defaultPage=document.querySelector('.nav-btn.active')?.dataset.page||'homePage';
  activatePage(hashPage||savedPage||defaultPage,{updateHash:!!(hashPage||savedPage),persist:true});
}

window.goToPage=activatePage;

function loadJson(key,fallback){try{const raw=localStorage.getItem(key);return raw?JSON.parse(raw):fallback}catch{return fallback}}
function saveJson(key,value){
  localStorage.setItem(key,JSON.stringify(value));
  if(assemblySyncKeys.has(key)) scheduleAssemblySync();
}
function scheduleAssemblySync(){
  if(!assemblySyncEnabled||!assemblySyncLoaded) return;
  if(assemblySyncTimer) clearTimeout(assemblySyncTimer);
  assemblySyncTimer=setTimeout(()=>{assemblySyncTimer=null;syncAssemblyState();},250);
}
async function assemblyApiRequest(method='GET',body){
  const options={method,headers:{'Accept':'application/json'}};
  if(body!==undefined){options.headers['Content-Type']='application/json';options.body=JSON.stringify(body);}
  const response=await fetch(assemblyApiBase,options);
  const raw=await response.text();
  let data={};
  try{data=raw?JSON.parse(raw):{}}catch{data={raw}}
  if(!response.ok) throw new Error(data?.error||`Assembly sync failed (${response.status})`);
  return data;
}
function buildAssemblySyncPayload(){
  return {
    board:assemblyBoardRows,
    available:availableQueueRows,
    scheduled:scheduledQueueRows,
    incomplete:incompleteQueueRows,
    revenue:revenueReferenceRows
  };
}
function applyAssemblySyncPayload(payload={}){
  assemblyBoardRows=normalizeAssemblyBoardRows(payload.board||[]);
  availableQueueRows=normalizeQueueRows(payload.available||[]);
  scheduledQueueRows=normalizeScheduledQueueRows(payload.scheduled||[]);
  incompleteQueueRows=normalizeQueueRows(payload.incomplete||[]);
  revenueReferenceRows=normalizeRevenueReferenceRows(payload.revenue||[]);
  localStorage.setItem(assemblyBoardStorageKey,JSON.stringify(assemblyBoardRows));
  localStorage.setItem(queueStorageKey,JSON.stringify(availableQueueRows));
  localStorage.setItem(scheduledQueueStorageKey,JSON.stringify(scheduledQueueRows));
  localStorage.setItem(incompleteQueueStorageKey,JSON.stringify(incompleteQueueRows));
  localStorage.setItem(revenueReferenceStorageKey,JSON.stringify(revenueReferenceRows));
}
async function loadAssemblyFromBackend(){
  try{
    const data=await assemblyApiRequest('GET');
    if(data&&data.state){
      applyAssemblySyncPayload(data.state);
    }
    assemblySyncEnabled=true;
  }catch(err){
    console.warn('Assembly sync unavailable, using browser storage.',err);
    assemblySyncEnabled=false;
  }finally{
    assemblySyncLoaded=true;
  }
}
async function syncAssemblyState(){
  if(!assemblySyncEnabled||!assemblySyncLoaded){return;}
  if(assemblySyncInFlight){assemblySyncQueued=true;return;}
  assemblySyncInFlight=true;
  try{
    const data=await assemblyApiRequest('POST',{state:buildAssemblySyncPayload()});
    if(data&&data.state) applyAssemblySyncPayload(data.state);
  }catch(err){
    console.warn('Assembly sync save failed; keeping local copy.',err);
    assemblySyncEnabled=false;
  }finally{
    assemblySyncInFlight=false;
    if(assemblySyncQueued){assemblySyncQueued=false;syncAssemblyState();}
  }
}
function normalizeEmployeeNames(list){return Array.from(new Set((list||[]).map(v=>String(v).trim()).filter(Boolean))).sort((a,b)=>a.localeCompare(b))}
function normalizeEmployees(list){
  const mapped=(list||[]).map(item=>{
    if(typeof item==='string') return {name:String(item).trim(),department:'Receiving',birthday:'',size:'',active:true};
    return {name:String(item.name||'').trim(),department:String(item.department||'Receiving').trim(),birthday:String(item.birthday||'').trim(),size:String(item.size||'').trim(),active:item.active!==false};
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
function normalizeErrorRecords(list){return(list||[]).map(item=>{const expectedQty=Number(item.expectedQty||0);const receivedQty=Number(item.receivedQty||0);const absoluteAmount=Math.abs(expectedQty-receivedQty);const errorRate=expectedQty>0?(absoluteAmount/expectedQty)*100:0;return{id:item.id||Date.now()+Math.random(),date:item.date||new Date().toISOString().slice(0,10),department:item.department||"Prepping",associate:item.associate||"",proofed:item.proofed||"Yes",poNumber:item.poNumber||"",linkedId:item.linkedId||"",category:item.category||"",palletLocation:item.palletLocation||"",expectedQty,receivedQty,errorType:item.errorType||"Other",absoluteAmount,errorRate,notes:item.notes||""}})}
function normalizeAssemblyBoardRows(list){return(list||[]).map(item=>({id:item.id||Date.now()+Math.random(),date:item.date||new Date().toISOString().slice(0,10),pb:String(item.pb||'').trim(),so:String(item.so||'').trim(),account:String(item.account||'').trim(),qty:Number(item.qty||0),products:Number(item.products||0),status:String(item.status||'').trim(),ihd:item.ihd||'',subtotal:Number(item.subtotal||0),stage:String(item.stage||inferLegacyStage(item)||'aa').trim(),rescheduleNote:String(item.rescheduleNote||'').trim(),pbId:String(item.pbId||'').trim(),pdfUrl:String(item.pdfUrl||'').trim(),workType:String(item.workType||'pack_builder').trim(),externalLink:String(item.externalLink||'').trim(),isPartial:!!item.isPartial,fullQty:Number(item.fullQty||item.qty||0),sourceQueue:String(item.sourceQueue||'').trim(),sourceStatus:String(item.sourceStatus||item.status||'').trim()}))}
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

function renderAttendanceEmployeeOptions(selectedName=''){const activeByDept=getActiveEmployees().filter(emp=>emp.department===activeAttendanceDepartment||!emp.department).map(emp=>emp.name);const fallback=getActiveEmployees().map(emp=>emp.name);const visible=(activeByDept.length?activeByDept:fallback);attendanceEmployeeInput.innerHTML=['<option value="">Select employee</option>'].concat(visible.map(name=>`<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`)).join('');attendanceEmployeeInput.value=selectedName&&visible.includes(selectedName)?selectedName:''}
function renderAttendanceDepartmentTabs(){attendanceDeptTabs.innerHTML=departments.map(dept=>`<button class="dept-btn ${dept===activeAttendanceDepartment?'active':''}" data-dept="${dept}">${dept}</button>`).join('');attendanceDeptTabs.querySelectorAll('[data-dept]').forEach(btn=>btn.addEventListener('click',()=>{activeAttendanceDepartment=btn.dataset.dept;attendanceDepartmentInput.value=activeAttendanceDepartment;renderAttendance()}))}
function updateAttendanceAutoDemerit(){attendanceDemeritsInput.value=getDemeritForMark(attendanceMarkInput.value)}
function sortAttendanceRecords(a,b){const mode=attendanceSortByInput.value;if(mode==='date_asc')return String(a.date).localeCompare(String(b.date));if(mode==='date_desc')return String(b.date).localeCompare(String(a.date));if(mode==='name_asc')return a.employeeName.localeCompare(b.employeeName);if(mode==='name_desc')return b.employeeName.localeCompare(a.employeeName);if(mode==='mark_asc')return a.mark.localeCompare(b.mark)||String(b.date).localeCompare(String(a.date));if(mode==='demerits_desc')return Number(b.demerits||0)-Number(a.demerits||0)||String(b.date).localeCompare(String(a.date));return String(b.date).localeCompare(String(a.date))}
function getFilteredAttendanceRecords(){const q=attendanceSearchInput.value.trim().toLowerCase();return attendanceRecords.filter(r=>r.department===activeAttendanceDepartment&&(!q||r.employeeName.toLowerCase().includes(q)||r.mark.toLowerCase().includes(q)||String(r.date).includes(q))).sort(sortAttendanceRecords)}
function getAttendanceEmployeeStats(name){const personRecords=attendanceRecords.filter(r=>r.employeeName===name).sort((a,b)=>String(a.date).localeCompare(String(b.date)));let totalDemerits=0,credits=0,streakDays=0,bestStreak=0,lastDate=null;personRecords.forEach(record=>{totalDemerits+=Number(record.demerits||0);const currentDate=new Date(record.date+'T00:00:00');let consecutive=!lastDate||Math.round((currentDate-lastDate)/86400000)===1;if(record.mark==='Present')streakDays=consecutive?streakDays+1:1;else streakDays=0;if(streakDays>bestStreak)bestStreak=streakDays;if(streakDays>0&&streakDays%30===0)credits+=1;lastDate=currentDate});return{records:personRecords,totalDays:personRecords.length,present:personRecords.filter(r=>r.mark==='Present').length,credits,netDemerits:Math.max(0,totalDemerits-credits),currentStreak:streakDays,bestStreak}}
function renderAttendanceRecords(){const filtered=getFilteredAttendanceRecords();if(!filtered.length){attendanceRecordsBody.innerHTML='<tr><td colspan="6" class="empty">No records found for this view.</td></tr>';return filtered}attendanceRecordsBody.innerHTML=filtered.map(r=>`<tr><td><button class="name-button" onclick="openAttendanceProfile('${escapeJs(r.employeeName)}')">${escapeHtml(r.employeeName)}</button></td><td>${escapeHtml(r.department)}</td><td>${escapeHtml(r.date)}</td><td><span class="badge ${toBadgeClass(r.mark)}">${escapeHtml(r.mark)}</span></td><td>${Number(r.demerits||0)}</td><td><div class="row-actions"><button class="btn danger" onclick="deleteAttendanceRecord(${r.id})">Delete</button></div></td></tr>`).join('');return filtered}
function renderAttendanceSummary(filtered){const names=Array.from(new Set(filtered.map(r=>r.employeeName))).sort((a,b)=>a.localeCompare(b));if(!names.length){attendanceSummaryBody.innerHTML='<tr><td colspan="4" class="empty">No employee summary yet.</td></tr>';return}attendanceSummaryBody.innerHTML=names.map(name=>{const stats=getAttendanceEmployeeStats(name);return`<tr><td><button class="name-button" onclick="openAttendanceProfile('${escapeJs(name)}')">${escapeHtml(name)}</button></td><td>${stats.totalDays}</td><td>${stats.present}</td><td>${stats.netDemerits}</td></tr>`}).join('')}
function renderAttendanceStats(filtered){const uniqueNames=Array.from(new Set(filtered.map(r=>r.employeeName)));const totals=filtered.reduce((acc,r)=>{acc.entries+=1;if(r.mark==='Present')acc.present+=1;if(r.mark==='Late')acc.late+=1;if(r.mark==='Absent')acc.absent+=1;return acc},{entries:0,present:0,late:0,absent:0});const net=uniqueNames.reduce((sum,name)=>sum+getAttendanceEmployeeStats(name).netDemerits,0);attendanceTotalEntries.textContent=totals.entries;attendancePresentCount.textContent=totals.present;attendanceLateAbsentCount.textContent=`${totals.late} / ${totals.absent}`;attendanceNetDemerits.textContent=net;attendanceCurrentDepartmentPill.textContent=activeAttendanceDepartment}
function updateAttendanceUndoButton(){attendanceUndoBtn.disabled=!localStorage.getItem(attendanceBackupKey)}
function renderAttendance(){renderAttendanceDepartmentTabs();renderAttendanceEmployeeOptions(attendanceEmployeeInput.value);const filtered=renderAttendanceRecords();renderAttendanceSummary(filtered);renderAttendanceStats(filtered);updateAttendanceUndoButton()}
function addAttendanceRecord(){const employeeName=attendanceEmployeeInput.value.trim();const department=attendanceDepartmentInput.value;const date=attendanceDateInput.value;const mark=attendanceMarkInput.value;const demerits=getDemeritForMark(mark);if(!employeeName){alert('Select an employee first.');attendanceEmployeeInput.focus();return}const duplicate=attendanceRecords.find(r=>r.employeeName===employeeName&&r.department===department&&r.date===date);if(duplicate){const replace=confirm('That employee already has a record for that department and date. Replace it?');if(!replace)return;attendanceRecords=attendanceRecords.filter(r=>!(r.employeeName===employeeName&&r.department===department&&r.date===date))}attendanceRecords.push({id:Date.now(),employeeName,department,date,mark,demerits});saveJson(attendanceStorageKey,attendanceRecords);attendanceEmployeeInput.value='';attendanceMarkInput.value='Present';updateAttendanceAutoDemerit();activeAttendanceDepartment=department;renderAttendance()}
function manageAttendanceEmployees(){document.querySelector('[data-page="employeesPage"]').click();}
function deleteAttendanceRecord(id){attendanceRecords=attendanceRecords.filter(r=>r.id!==id);saveJson(attendanceStorageKey,attendanceRecords);if(selectedProfileName)openAttendanceProfile(selectedProfileName);renderAttendance()}
function clearAttendanceData(){const confirmed=confirm('Delete all attendance data from this browser? You can undo this once.');if(!confirmed)return;saveJson(attendanceBackupKey,attendanceRecords);attendanceRecords=[];saveJson(attendanceStorageKey,attendanceRecords);renderAttendance();alert('Attendance data cleared. Use Undo clear if needed.');}
function undoAttendanceClear(){const backup=loadJson(attendanceBackupKey,null);if(!backup){alert('No attendance backup found.');return}attendanceRecords=normalizeAttendanceRecords(backup);saveJson(attendanceStorageKey,attendanceRecords);localStorage.removeItem(attendanceBackupKey);renderAttendance()}
function loadAttendanceSampleData(){attendanceRecords=normalizeAttendanceRecords(attendanceSampleData.map(item=>({...item,demerits:getDemeritForMark(item.mark)})));employees=normalizeEmployees(defaultEmployees);saveJson(attendanceStorageKey,attendanceRecords);saveEmployees();localStorage.removeItem(attendanceBackupKey);renderAttendance();renderEmployees()}
function exportAttendanceCsv(){const filtered=getFilteredAttendanceRecords();const rows=[["Employee Name","Department","Date","Mark","Demerits"],...filtered.map(r=>[r.employeeName,r.department,r.date,r.mark,r.demerits])];const csv=rows.map(row=>row.map(cell=>`"${String(cell).replace(/"/g,'""')}"`).join(',')).join('\n');const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`${activeAttendanceDepartment.toLowerCase()}_attendance.csv`;a.click();URL.revokeObjectURL(url)}
function openAttendanceProfile(name){selectedProfileName=name;const stats=getAttendanceEmployeeStats(name);const latestDepartment=stats.records.length?stats.records[stats.records.length-1].department:'No department yet';profileName.textContent=name;profileSubtitle.textContent=`${latestDepartment} • ${stats.totalDays} total records • ${stats.currentStreak} day current present streak`;profileStats.innerHTML=[{label:'Net Demerits',value:stats.netDemerits},{label:'30-Day Credits',value:stats.credits},{label:'Best Streak',value:stats.bestStreak},{label:'Present Days',value:stats.present}].map(card=>`<div class="mini-card"><div class="mini-label">${card.label}</div><div class="mini-value">${card.value}</div></div>`).join('');if(!stats.records.length){profileHistoryBody.innerHTML='<tr><td colspan="4" class="empty">No history found for this employee.</td></tr>'}else{profileHistoryBody.innerHTML=[...stats.records].sort((a,b)=>String(b.date).localeCompare(String(a.date))).map(r=>`<tr><td>${escapeHtml(r.date)}</td><td>${escapeHtml(r.department)}</td><td><span class="badge ${toBadgeClass(r.mark)}">${escapeHtml(r.mark)}</span></td><td>${Number(r.demerits||0)}</td></tr>`).join('')}profileModalBackdrop.classList.add('show')}
function closeAttendanceProfile(){profileModalBackdrop.classList.remove('show');selectedProfileName=''}

document.getElementById('attendanceSeedBtn').addEventListener('click',loadAttendanceSampleData);
document.getElementById('attendanceExportBtn').addEventListener('click',exportAttendanceCsv);
document.getElementById('attendanceAddBtn').addEventListener('click',addAttendanceRecord);
document.getElementById('attendanceManageEmployeesBtn').addEventListener('click',manageAttendanceEmployees);
document.getElementById('attendanceClearBtn').addEventListener('click',clearAttendanceData);
document.getElementById('attendanceUndoBtn').addEventListener('click',undoAttendanceClear);
document.getElementById('closeProfileBtn').addEventListener('click',closeAttendanceProfile);
attendanceMarkInput.addEventListener('change',updateAttendanceAutoDemerit);
attendanceSearchInput.addEventListener('input',renderAttendance);
attendanceSortByInput.addEventListener('change',renderAttendance);
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
function renderEmployees(){const filtered=getFilteredEmployees();employeesActiveCount.textContent=getActiveEmployees().length;employeesDepartmentCount.textContent=new Set(getActiveEmployees().map(emp=>emp.department)).size;if(!filtered.length){employeesTableBody.innerHTML='<tr><td colspan="6" class="empty">No employees found.</td></tr>';}else{employeesTableBody.innerHTML=filtered.map(emp=>{if(employeeInlineEditName===emp.name){return `<tr><td><input id="inlineEmployeeName" value="${escapeHtml(emp.name)}" /></td><td><select id="inlineEmployeeDepartment">${departments.map(d=>`<option value="${d}" ${emp.department===d?'selected':''}>${d}</option>`).join('')}</select></td><td><input id="inlineEmployeeBirthday" type="date" value="${escapeHtml(emp.birthday||'')}" /></td><td><input id="inlineEmployeeSize" value="${escapeHtml(emp.size||'')}" placeholder="S, M, L, XL..." /></td><td><span class="pill">${emp.active?'Active':'Inactive'}</span></td><td><div class="row-actions"><button class="btn" onclick="saveInlineEmployee('${escapeJs(emp.name)}')">Save</button><button class="btn secondary" onclick="cancelInlineEmployeeEdit()">Cancel</button></div></td></tr>`;}return `<tr><td>${escapeHtml(emp.name)}</td><td>${escapeHtml(emp.department)}</td><td>${formatBirthdayDisplay(emp.birthday)}</td><td>${escapeHtml(emp.size||'—')}</td><td><span class="pill">${emp.active?'Active':'Inactive'}</span></td><td><div class="row-actions"><button class="btn secondary" onclick="editEmployee('${escapeJs(emp.name)}')">Edit</button><button class="btn danger" onclick="removeEmployee('${escapeJs(emp.name)}')">Remove</button></div></td></tr>`;}).join('')}renderAttendanceEmployeeOptions(attendanceEmployeeInput.value);renderErrorAssociateOptions(errorAssociateInput.value)}
function addEmployee(){const name=employeeManagerNameInput.value.trim();const department=employeeManagerDepartmentInput.value;const birthday=employeeManagerBirthdayInput.value;const size=employeeManagerSizeInput.value.trim();if(!name){alert('Enter an employee name first.');employeeManagerNameInput.focus();return}const existing=getEmployeeByName(name);if(existing){existing.department=department;existing.birthday=birthday;existing.size=size;existing.active=true;}else{employees.push({name,department,birthday,size,active:true});employees=normalizeEmployees(employees)}saveEmployees();employeeManagerNameInput.value='';employeeManagerBirthdayInput.value='';employeeManagerSizeInput.value='';renderEmployees();renderCalendar();}
function removeEmployee(name){const confirmed=confirm(`Remove ${name} from the shared employee source? Existing history will stay in records.`);if(!confirmed)return;employees=employees.filter(emp=>emp.name!==name);if(employeeInlineEditName===name){employeeInlineEditName='';}saveEmployees();renderEmployees();renderCalendar();}
function editEmployee(name){employeeInlineEditName=name;renderEmployees();setTimeout(()=>{const input=document.getElementById('inlineEmployeeName');if(input) input.focus();},0);}
function cancelInlineEmployeeEdit(){employeeInlineEditName='';renderEmployees();}
function saveInlineEmployee(originalName){const name=(document.getElementById('inlineEmployeeName')?.value||'').trim();const department=document.getElementById('inlineEmployeeDepartment')?.value||'Receiving';const birthday=document.getElementById('inlineEmployeeBirthday')?.value||'';const size=(document.getElementById('inlineEmployeeSize')?.value||'').trim();if(!name){alert('Employee name cannot be blank.');return}const duplicate=employees.find(emp=>emp.name===name&&emp.name!==originalName);if(duplicate){alert('Another employee already has that name.');return}const employee=getEmployeeByName(originalName);if(!employee) return;employee.name=name;employee.department=department;employee.birthday=birthday;employee.size=size;employee.active=true;employees=normalizeEmployees(employees);saveEmployees();employeeInlineEditName='';renderEmployees();renderCalendar();}
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
function setAssemblyDateAndNavigate(dateStr,openAssemblyPage=true){
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
    const canJump=!muted;
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
let assemblyInlineEditId=null;
let assemblyShowBreakdown=false;
let assemblyShowDetails=false;
let assemblyEditMode=false;

function getAssemblyUnits(row){
  return Number(row.qty||0) * Number(row.products||0);
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
  const filteredRows=assemblyBoardRows.filter(row=>row.date===selectedDate);
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
  if(assemblyEditModeToggleBtn) assemblyEditModeToggleBtn.textContent=assemblyEditMode?'Exit Edit Mode':'Enter Edit Mode';

  const stageTotals={aa:0,print:0,picked:0,line:0,dpmo:0,done:0};
  filteredRows.forEach(row=>{ if(stageTotals[row.stage]!==undefined){ stageTotals[row.stage]+=getAssemblyUnits(row); } });
  assemblyAaUnits.textContent=stageTotals.aa.toLocaleString();
  assemblyPrintUnits.textContent=stageTotals.print.toLocaleString();
  assemblyPickedUnits.textContent=stageTotals.picked.toLocaleString();
  assemblyLineUnits.textContent=stageTotals.line.toLocaleString();
  assemblyDpmoUnits.textContent=stageTotals.dpmo.toLocaleString();
  assemblyDoneUnits.textContent=stageTotals.done.toLocaleString();

  const scheduledUnitsTotal=filteredRows.reduce((sum,row)=>sum+getAssemblyUnits(row),0);
  const doneUnitsTotal=filteredRows.filter(row=>row.stage==='done').reduce((sum,row)=>sum+getAssemblyUnits(row),0);
  const remainingUnitsTotal=Math.max(0,scheduledUnitsTotal-doneUnitsTotal);
  const completionPct=scheduledUnitsTotal>0?(doneUnitsTotal/scheduledUnitsTotal)*100:0;
  const currentUph=hoursElapsed>0?doneUnitsTotal/(Math.max(1,headcount)*hoursElapsed):0;
  const goalProgress=uph>0?(currentUph/uph)*100:0;
  assemblyRowsTodayStat.textContent=filteredRows.length;
  assemblyScheduledUnitsStat.textContent=scheduledUnitsTotal.toLocaleString();
  assemblyDoneUnitsStat2.textContent=doneUnitsTotal.toLocaleString();
  assemblyRemainingUnitsStat.textContent=remainingUnitsTotal.toLocaleString();
  assemblyCompletionStat.textContent=`${completionPct.toFixed(0)}%`;
  if(assemblyCurrentUphDisplay) assemblyCurrentUphDisplay.textContent=currentUph.toFixed(0);
  if(assemblyGoalProgressDisplay) assemblyGoalProgressDisplay.textContent=`${goalProgress.toFixed(0)}%`;

  if(assemblyWeekViewBody){
    const weekRows=[];
    const start=new Date(selectedDate+'T00:00:00');
    for(let i=0;i<7;i+=1){
      const d=new Date(start);
      d.setDate(start.getDate()+i);
      const dayKey=d.toISOString().slice(0,10);
      const rows=assemblyBoardRows.filter(row=>row.date===dayKey);
      const units=rows.reduce((sum,row)=>sum+getAssemblyUnits(row),0);
      const done=rows.filter(row=>row.stage==='done').reduce((sum,row)=>sum+getAssemblyUnits(row),0);
      const pct=units>0?((done/units)*100):0;
      weekRows.push(`<tr><td>${d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})}</td><td>${rows.length}</td><td>${units.toLocaleString()}</td><td>${done.toLocaleString()}</td><td>${units?`${pct.toFixed(0)}%`:'—'}</td></tr>`);
    }
    assemblyWeekViewBody.innerHTML=weekRows.join('');
  }

  if(assemblyBoardHead){
    assemblyBoardHead.innerHTML = assemblyShowDetails
      ? '<tr><th>Work Type</th><th>Pack Builder</th><th>Sales Order</th><th>Account</th><th>Qty</th><th>Total Products</th><th>Units</th><th>Status</th><th>IHD</th><th>Open</th><th>Subtotal</th><th>Current Stage</th><th>Reschedule Note</th><th>Action</th></tr>'
      : '<tr><th>Pack Builder</th><th>Account</th><th>Units</th><th>Stage</th><th>Status</th><th>Action</th></tr>';
  }

  if(!filteredRows.length){
    assemblyBoardBody.innerHTML=`<tr><td colspan="${assemblyShowDetails?14:6}" class="empty">No assembly board rows for the selected day.</td></tr>`;
    return;
  }

  assemblyBoardBody.innerHTML=filteredRows.map(row=>{
    const units=getAssemblyUnits(row);
    const openLink=getAssemblyOpenLink(row);
    const actionLabel=isPackBuilderWorkType(row.workType)?'Unschedule':'Delete';

    if(assemblyInlineEditId===row.id){
      return `<tr>
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
      return `<tr><td>${escapeHtml(row.pb||'—')}</td><td>${escapeHtml(row.account||'—')}</td><td>${units.toLocaleString()}</td><td><select onchange="setAssemblyStage(${row.id},this.value)"><option value="aa" ${row.stage==='aa'?'selected':''}>A.A.</option><option value="print" ${row.stage==='print'?'selected':''}>Print</option><option value="picked" ${row.stage==='picked'?'selected':''}>Picked</option><option value="line" ${row.stage==='line'?'selected':''}>Line</option><option value="dpmo" ${row.stage==='dpmo'?'selected':''}>DPMO</option><option value="done" ${row.stage==='done'?'selected':''}>Done</option></select></td><td>${escapeHtml(row.status||'—')}</td><td><div class="row-actions">${openLink?`<a class="btn secondary" href="${escapeHtml(openLink)}" target="_blank" rel="noopener noreferrer">Open</a>`:''}<button class="btn secondary" onclick="editAssemblyBoardRow(${row.id})">Edit</button><button class="btn warn" onclick="removeAssemblyBoardRow(${row.id})">${actionLabel}</button></div></td></tr>`;
    }

    return `<tr><td>${escapeHtml(getAssemblyWorkTypeLabel(row.workType)+(row.isPartial?' • Partial':''))}</td><td>${escapeHtml(row.pb)}</td><td>${escapeHtml(row.so)}</td><td>${escapeHtml(row.account)}</td><td>${formatAssemblyQty(row)}</td><td>${row.products}</td><td>${units.toLocaleString()}</td><td>${escapeHtml(row.status||'—')}</td><td>${escapeHtml(getEffectiveIhdForRow(row)||'—')}</td><td>${openLink?`<a class="queue-link" href="${escapeHtml(openLink)}" target="_blank" rel="noopener noreferrer">Open</a>`:'—'}</td><td>$${Number(getEffectiveSubtotalForRow(row)||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</td><td><select onchange="setAssemblyStage(${row.id},this.value)"><option value="aa" ${row.stage==='aa'?'selected':''}>A.A.</option><option value="print" ${row.stage==='print'?'selected':''}>Print</option><option value="picked" ${row.stage==='picked'?'selected':''}>Picked</option><option value="line" ${row.stage==='line'?'selected':''}>Line</option><option value="dpmo" ${row.stage==='dpmo'?'selected':''}>DPMO</option><option value="done" ${row.stage==='done'?'selected':''}>Done</option></select></td><td>${escapeHtml(row.rescheduleNote||'—')}</td><td><div class="row-actions"><button class="btn secondary" onclick="editAssemblyBoardRow(${row.id})">Edit</button><button class="btn secondary" onclick="rescheduleAssemblyBoardRow(${row.id})">Reschedule</button><button class="btn warn" onclick="removeAssemblyBoardRow(${row.id})">${actionLabel}</button></div></td></tr>`;
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
  saveJson(assemblyBoardStorageKey,assemblyBoardRows);
  clearAssemblyBoardForm();
  renderAssembly();
  renderHome();
  renderCalendar();
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
  const row=assemblyBoardRows.find(item=>String(item.id)===String(id));
  if(!row) return;

  if(!isPackBuilderWorkType(row.workType)){
    assemblyBoardRows=assemblyBoardRows.filter(item=>String(item.id)!==String(id));
    if(assemblyInlineEditId===row.id) assemblyInlineEditId=null;
    saveJson(assemblyBoardStorageKey,assemblyBoardRows);
    renderAssembly();
    renderHome();
    return;
  }

  let scheduledMatch=scheduledQueueRows.find(item=>String(item.id)===String(id));
  if(!scheduledMatch){
    scheduledMatch=scheduledQueueRows.find(item=>item.scheduledFor===row.date && item.pb===row.pb && item.so===row.so);
  }

  if(scheduledMatch){
    scheduledQueueRows=scheduledQueueRows.filter(item=>!(String(item.id)===String(scheduledMatch.id) || (item.scheduledFor===scheduledMatch.scheduledFor && item.pb===scheduledMatch.pb && item.so===scheduledMatch.so)));
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
    saveQueue();
    saveIncompleteQueue();
    saveScheduledQueue();
  } else {
    const targetBucket=(row.sourceQueue==='incomplete'||classifyQueueStatus(row.sourceStatus)==='incomplete')?incompleteQueueRows:availableQueueRows;
    mergeReturnedQueueRow(targetBucket,{
      priority:false,
      pb:row.pb,
      pbId:row.pbId,
      so:row.so,
      account:row.account,
      qty:Number(row.qty||0),
      products:Number(row.products||0),
      ihd:row.ihd,
      accountOwner:'',
      pdfUrl:row.pdfUrl,
      status:row.sourceStatus||row.status||''
    });
    saveQueue();
    saveIncompleteQueue();
  }

  assemblyBoardRows=assemblyBoardRows.filter(item=>String(item.id)!==String(id));
  if(assemblyInlineEditId===row.id) assemblyInlineEditId=null;
  saveJson(assemblyBoardStorageKey,assemblyBoardRows);
  renderQueue();
  renderAssembly();
  renderHome();
  renderCalendar();
  renderCalendar();
}
function editAssemblyBoardRow(id){assemblyInlineEditId=id;renderAssembly();}
function cancelAssemblyBoardEdit(){assemblyInlineEditId=null;renderAssembly();}
function updateInlineAssemblyUnitsPreview(){
  const qty=Number(document.getElementById('assemblyEditQty')?.value||0);
  const products=Number(document.getElementById('assemblyEditProducts')?.value||0);
  const target=document.getElementById('assemblyEditUnitsPreview');
  if(target) target.value=(qty*products).toLocaleString();
}
function saveAssemblyBoardRow(id){
  const row=assemblyBoardRows.find(r=>r.id===id);
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
  saveJson(assemblyBoardStorageKey,assemblyBoardRows);
  assemblyInlineEditId=null;
  renderAssembly();
  renderHome();
  renderCalendar();
}
function setAssemblyStage(id,stage){
  const row=assemblyBoardRows.find(r=>r.id===id);
  if(!row) return;
  row.stage=stage;
  saveJson(assemblyBoardStorageKey,assemblyBoardRows);
  renderAssembly();
  renderHome();
  renderCalendar();
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

assemblyDateInput.value=new Date().toISOString().slice(0,10);
[assemblyHeadcountInput,assemblyHoursInput,assemblyHoursElapsedInput,assemblyUphInput,assemblyScheduledPbInput,assemblyQtyInput,assemblyFullQtyInput,assemblyProductsInput].forEach(input=>input.addEventListener('input',()=>{updateAssemblyUnitsPreview();renderAssembly();}));
assemblyDateInput.addEventListener('change',()=>setAssemblyDateAndNavigate(assemblyDateInput.value,false));
assemblyPrevDayBtn.addEventListener('click',()=>changeAssemblyDateByDays(-1));
assemblyNextDayBtn.addEventListener('click',()=>changeAssemblyDateByDays(1));
injectAssemblyQuickDateControls();
assemblyBreakdownToggleBtn?.addEventListener('click',()=>{assemblyShowBreakdown=!assemblyShowBreakdown;renderAssembly();});
assemblyDetailsToggleBtn?.addEventListener('click',()=>{assemblyShowDetails=!assemblyShowDetails;renderAssembly();});
assemblyEditModeToggleBtn?.addEventListener('click',()=>{assemblyEditMode=!assemblyEditMode;renderAssembly();});
document.getElementById('assemblyAddBoardRowBtn').addEventListener('click',addAssemblyBoardRow);

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

  saveQueue();
  saveIncompleteQueue();
  saveScheduledQueue();
  saveJson(assemblyBoardStorageKey,assemblyBoardRows);
  renderQueue();
  renderAssembly();
  renderHome();
  renderCalendar();
  renderCalendar();
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
async function importRevenueReference(){
  const file=revenueFileInput.files?.[0];
  if(!file){setRevenueImportStatus('Choose the revenue reference .xlsx file first.',true);alert('Choose the revenue reference .xlsx file first.');return;}
  setRevenueImportStatus(`Preparing to import ${file.name}...`);
  try{await ensureXlsxLoaded();}catch(error){console.error(error);setRevenueImportStatus(error.message||'Excel reader failed to load.',true);alert(error.message||'Excel reader failed to load.');return;}
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
        const account=String(raw['Account']||raw['Account Name']||'').trim();
        mapped.push({id:Date.now()+Math.random(),salesOrder,originalSubtotal,ihd,account});
      });
      revenueReferenceRows=normalizeRevenueReferenceRows(mapped);
      saveRevenueReference();
      renderRevenueReferenceStats();
      setRevenueImportStatus(`Revenue reference imported: ${revenueReferenceRows.length} rows stored.`);
    } catch(error){
      console.error(error);
      setRevenueImportStatus(error.message||'The revenue reference could not be read.',true);
      alert(error.message||'The revenue reference could not be read.');
    }
  };
  reader.onerror=()=>{setRevenueImportStatus('The file could not be opened by the browser.',true);alert('The file could not be opened by the browser.');};
  reader.readAsArrayBuffer(file);
}
function clearRevenueReference(){
  const confirmed=confirm('Clear the stored revenue reference data?');
  if(!confirmed) return;
  revenueReferenceRows=[];
  saveRevenueReference();
  renderRevenueReferenceStats();
  setRevenueImportStatus('Revenue reference cleared.');
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
    queueTableBody.innerHTML=readyVisible.map(row=>{const link=buildSalesforcePbLink(row.pbId,row.pdfUrl);return `<tr><td>${row.priority?'⭐':'—'}</td><td>${escapeHtml(row.pb||'—')}</td><td>${escapeHtml(row.so||'—')}</td><td>${escapeHtml(row.account||'—')}</td><td>${Number(row.qty||0)}</td><td>${Number(row.products||0)}</td><td>${Number(row.units||0).toLocaleString()}</td><td>${escapeHtml(getEffectiveIhdForRow(row)||'—')}</td><td>${escapeHtml(row.status||'—')}</td><td>${renderQueueFlags(row)}</td><td>${escapeHtml(row.accountOwner||'—')}</td><td>${link?`<a class="queue-link" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">Open</a>`:'—'}</td><td><div class="row-actions"><button class="btn secondary" onclick="toggleQueuePriority('${escapeJs(String(row.id))}','ready')">${row.priority?'Unmark':'Priority'}</button><button class="btn" onclick="scheduleQueueRow('${escapeJs(String(row.id))}','ready')">Schedule</button></div></td></tr>`}).join('');
  }
  if(!incompleteFiltered.length){
    incompleteQueueTableBody.innerHTML='<tr><td colspan="13" class="empty">No incomplete or pending pack builders found for this view.</td></tr>';
  } else {
    incompleteQueueTableBody.innerHTML=incompleteVisible.map(row=>{const link=buildSalesforcePbLink(row.pbId,row.pdfUrl);return `<tr><td>${row.priority?'⭐':'—'}</td><td>${escapeHtml(row.pb||'—')}</td><td>${escapeHtml(row.so||'—')}</td><td>${escapeHtml(row.account||'—')}</td><td>${Number(row.qty||0)}</td><td>${Number(row.products||0)}</td><td>${Number(row.units||0).toLocaleString()}</td><td>${escapeHtml(getEffectiveIhdForRow(row)||'—')}</td><td>${escapeHtml(row.status||'—')}</td><td>${renderQueueFlags(row)}</td><td>${escapeHtml(row.accountOwner||'—')}</td><td>${link?`<a class="queue-link" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">Open</a>`:'—'}</td><td><div class="row-actions"><button class="btn secondary" onclick="toggleQueuePriority('${escapeJs(String(row.id))}','incomplete')">${row.priority?'Unmark':'Priority'}</button><button class="btn" onclick="scheduleQueueRow('${escapeJs(String(row.id))}','incomplete')">Schedule</button></div></td></tr>`}).join('');
  }
  const scheduledSorted=getSortedQueueRows(scheduledQueueRows.filter(matchesQueueSearch)).sort((a,b)=>String(b.scheduledAt||'').localeCompare(String(a.scheduledAt||''))||String(a.scheduledFor||'').localeCompare(String(b.scheduledFor||'')));
  const scheduledVisible=applyQueueLimit(scheduledSorted,scheduledQueueLimit?.value||'10');
  scheduledQueueTableBody.innerHTML=scheduledSorted.length?scheduledVisible.map(row=>{const link=buildSalesforcePbLink(row.pbId,row.pdfUrl);return `<tr><td>${escapeHtml(row.pb||'—')}</td><td>${escapeHtml(row.so||'—')}</td><td>${escapeHtml(row.account||'—')}</td><td>${Number(row.units||0).toLocaleString()}</td><td>${escapeHtml(row.scheduledFor||'—')}</td><td>${escapeHtml(row.scheduledAt||'—')}</td><td>${renderQueueFlags(row)}</td><td>${escapeHtml(row.scheduleNote||'—')}</td><td>${link?`<a class="queue-link" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">Open</a>`:'—'}</td><td><div class="row-actions"><button class="btn secondary" onclick="viewScheduledInAssembly('${escapeJs(String(row.id))}')">View in Assembly</button><button class="btn secondary" onclick="unscheduleQueueRow('${escapeJs(String(row.id))}')">Unschedule</button><button class="btn danger" onclick="deleteScheduledQueueRow('${escapeJs(String(row.id))}')">Delete</button></div></td></tr>`}).join(''):'<tr><td colspan="10" class="empty">Nothing has been scheduled from the queue yet.</td></tr>';
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
async function importQueueReport(){
  const file=queueFileInput.files?.[0];
  if(!file){setQueueImportStatus('Choose the Salesforce .xlsx report first.',true);alert('Choose the Salesforce .xlsx report first.');return}
  setQueueImportStatus(`Preparing to import ${file.name}...`);
  try{
    await ensureXlsxLoaded();
  } catch(error){
    console.error(error);
    setQueueImportStatus(error.message||'Excel reader failed to load.',true);
    alert(error.message||'Excel reader failed to load.');
    return;
  }
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
        target.pb=imported.pb||target.pb;
        target.pbId=imported.pbId||target.pbId;
        target.so=imported.so||target.so;
        target.account=imported.account||target.account;
        target.qty=Number(imported.qty||0);
        target.products=Number(imported.products||0);
        target.units=Number(imported.units||0);
        target.ihd=imported.ihd||target.ihd;
        target.accountOwner=imported.accountOwner||target.accountOwner;
        target.pdfUrl=imported.pdfUrl||target.pdfUrl;
        target.status=imported.status||target.status;
      };

      let addedCount=0;
      let updatedCount=0;
      const nextReady=[];
      const nextIncomplete=[];

      grouped.forEach((imported,key)=>{
        const bucket=classifyQueueStatus(imported.status);
        const scheduledExisting=scheduledMap.get(key);
        if(scheduledExisting){
          applyUpdate(scheduledExisting,imported);
          updatedCount+=1;
          return;
        }
        const existing=readyMap.get(key)||incompleteMap.get(key);
        const record=existing?{...existing}:{...imported};
        applyUpdate(record,imported);
        if(existing) updatedCount+=1; else addedCount+=1;
        if(bucket==='ready') nextReady.push(record); else nextIncomplete.push(record);
      });

      availableQueueRows=nextReady;
      incompleteQueueRows=nextIncomplete;
      scheduledQueueRows=scheduledQueueRows.filter(item=>importedKeys.has(String(item.pbId||item.pb||'').trim())||String(item.scheduledFor||'').trim());

      saveQueue();
      saveIncompleteQueue();
      saveScheduledQueue();
      renderQueue();
      const successMsg=`Import complete: ${addedCount} new pack builders added, ${updatedCount} existing pack builders updated, from ${queueRawRowCount} raw rows.`;
      setQueueImportStatus(successMsg);
      alert(successMsg);
    } catch(error){
      console.error(error);
      setQueueImportStatus(error.message||'The report could not be read.',true);
      alert(error.message||'The report could not be read. Make sure it is the Salesforce Details Only Excel export.');
    }
  };
  reader.onerror=()=>{
    setQueueImportStatus('The file could not be opened by the browser.',true);
    alert('The file could not be opened by the browser.');
  };
  reader.readAsArrayBuffer(file);
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

function renderHome(){
  const today=new Date().toISOString().slice(0,10);
  const activeEmployees=getActiveEmployees();
  const currentMonth=new Date().getMonth();
  const birthdaysThisMonth=activeEmployees.filter(emp=>emp.birthday && new Date(emp.birthday+'T00:00:00').getMonth()===currentMonth);
  const todayAttendance=attendanceRecords.filter(r=>r.date===today);
  const presentToday=todayAttendance.filter(r=>r.mark==='Present').length;
  const lateToday=todayAttendance.filter(r=>r.mark==='Late').length;
  const absentToday=todayAttendance.filter(r=>r.mark==='Absent' || r.mark==='Call Out').length;

  const selectedAssemblyDate=assemblyDateInput?.value || today;
  const selectedAssemblyRows=assemblyBoardRows.filter(row=>row.date===selectedAssemblyDate);
  const scheduledUnits=selectedAssemblyRows.reduce((sum,row)=>sum+getAssemblyUnits(row),0);
  const doneUnits=selectedAssemblyRows.filter(row=>row.stage==='done').reduce((sum,row)=>sum+getAssemblyUnits(row),0);
  const capacity=Number(assemblyHeadcountInput?.value||0) * Number(assemblyHoursInput?.value||0) * Number(assemblyUphInput?.value||0);
  const completionPct=scheduledUnits>0 ? (doneUnits/scheduledUnits)*100 : 0;

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

  homeEmployeesCount.textContent=activeEmployees.length;
  homeBirthdaysCount.textContent=birthdaysThisMonth.length;
  homeErrorsCount.textContent=errorRecords.length;
  homeAssemblyPbCount.textContent=selectedAssemblyRows.length;
  homePresentToday.textContent=presentToday;
  homeLateToday.textContent=lateToday;
  homeAbsentToday.textContent=absentToday;
  homeAssemblyUnits.textContent=scheduledUnits.toLocaleString();
  homeAssemblyDoneUnits.textContent=doneUnits.toLocaleString();
  homeAssemblyCapacity.textContent=capacity.toLocaleString();
  homeAssemblyCompletion.textContent=`${completionPct.toFixed(0)}%`;

  homeAssemblyStageSummary.innerHTML=stageSummary.map(item=>`<tr><td>${item.label}</td><td>${item.units.toLocaleString()}</td><td>${item.pbs}</td></tr>`).join('');

  const scheduleRows=[...selectedAssemblyRows].sort((a,b)=>{
    const stageOrder={aa:0,print:1,picked:2,line:3,dpmo:4,done:5};
    return (stageOrder[a.stage]??99)-(stageOrder[b.stage]??99) || String(a.account||'').localeCompare(String(b.account||'')) || String(a.pb||'').localeCompare(String(b.pb||''));
  });
  homeAssemblyScheduleBody.innerHTML=scheduleRows.length ? scheduleRows.map(row=>`<tr><td>${escapeHtml(getAssemblyWorkTypeLabel(row.workType)+(row.isPartial?' • Partial':''))}</td><td>${escapeHtml(row.pb||'—')}</td><td>${escapeHtml(row.so||'—')}</td><td>${escapeHtml(row.account||'—')}</td><td>${getAssemblyUnits(row).toLocaleString()} <span class="mini-label" style="display:block;margin-top:4px">${escapeHtml(formatAssemblyQty(row))}</span></td><td>${escapeHtml((row.stage||'').toUpperCase()==='AA'?'A.A.':(row.stage==='aa'?'A.A.':row.stage==='dpmo'?'DPMO':String(row.stage||'—').charAt(0).toUpperCase()+String(row.stage||'').slice(1)))}</td><td>${escapeHtml(row.status||'—')}</td><td>${escapeHtml(getEffectiveIhdForRow(row)||'—')}</td><td>${getAssemblyOpenLink(row)?`<a class="queue-link" href="${escapeHtml(getAssemblyOpenLink(row))}" target="_blank" rel="noopener noreferrer">Open</a>`:'—'}</td><td>${escapeHtml(row.rescheduleNote||'—')}</td><td>$${Number(getEffectiveSubtotalForRow(row)||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</td></tr>`).join('') : '<tr><td colspan="11" class="empty">No assembly schedule rows for the selected day.</td></tr>';

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

async function bootstrapWarehouseHub(){
  await loadAssemblyStateFromBackend();
  renderAttendance();
  renderErrors();
  renderEmployees();
  renderCalendar();
  renderAssembly();
  renderQueue();
  renderRevenueReferenceStats();
  renderHome();
}
bootstrapWarehouseHub();
queueSearchInput.addEventListener('input',renderQueue);
queueSortByInput.addEventListener('change',renderQueue);
queueClearSearchBtn.addEventListener('click',()=>{queueSearchInput.value='';renderQueue();});
scheduledQueueLimit.addEventListener('change',renderQueue);
readyQueueLimit.addEventListener('change',renderQueue);
incompleteQueueLimit.addEventListener('change',renderQueue);
document.getElementById('queueImportBtn').addEventListener('click',importQueueReport);
document.getElementById('queueClearBtn').addEventListener('click',clearQueue);
document.getElementById('revenueImportBtn').addEventListener('click',importRevenueReference);
document.getElementById('revenueClearBtn').addEventListener('click',clearRevenueReference);
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
