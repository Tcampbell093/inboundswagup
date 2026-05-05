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
const calendarEventsStorageKey="ops_hub_calendar_events_v1";
const attendanceApiBase='/.netlify/functions/attendance';
const employeesApiBase='/.netlify/functions/employees';
let attendanceSyncEnabled=false;
let attendanceSyncLoaded=false;
let attendanceSyncInFlight=false;
let attendanceSyncQueued=false;
let attendanceSyncTimer=null;
let employeesSyncEnabled=false;
let employeesSyncLoaded=false;
let employeesSyncInFlight=false;
let employeesSyncQueued=false;
let employeesSyncTimer=null;
const assemblyApiBase='/.netlify/functions/assembly';
const assemblySyncKeys=new Set([assemblyBoardStorageKey,queueStorageKey,scheduledQueueStorageKey,incompleteQueueStorageKey,revenueReferenceStorageKey,calendarEventsStorageKey,issueHoldQueueStorageKey]);
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
let calendarEvents=normalizeCalendarEvents(loadJson(calendarEventsStorageKey,[]));


const returnsStorageKey="ops_hub_returns_records_v1";
const defaultReturnsRecords=[{"id": "seed_return_1", "date": "2026-01-02", "company": "HealthPlan One", "returnType": "Pack", "notes": "", "tracking": "420327149400136000000000000000", "barcode": "630459_9", "size": "One Size", "clientName": "n/A", "createdAt": 1735689600000, "updatedAt": 1735689600000, "source": "seed"}, {"id": "seed_return_2", "date": "2026-01-02", "company": "Arm Institute", "returnType": "Pack", "notes": "", "tracking": "94346362084162700000000", "barcode": "555099_9/D-1891392", "size": "One Size", "clientName": "Leese & co.", "createdAt": 1735689600001, "updatedAt": 1735689600001, "source": "seed"}, {"id": "seed_return_3", "date": "2026-01-02", "company": "EnrollInsurance.com", "returnType": "Pack", "notes": "", "tracking": "9261290318406410000000", "barcode": "495565_9/D-1705122", "size": "One Size", "clientName": "Phyllis McIntyre", "createdAt": 1735689600002, "updatedAt": 1735689600002, "source": "seed"}, {"id": "seed_return_4", "date": "2026-01-02", "company": "One", "returnType": "Pack", "notes": "", "tracking": "420078349434636000000000000000", "barcode": "646326_5/D-1902698", "size": "XL", "clientName": "Sean Chambers", "createdAt": 1735689600003, "updatedAt": 1735689600003, "source": "seed"}, {"id": "seed_return_5", "date": "2026-01-02", "company": "Harmonic Security", "returnType": "Pack", "notes": "", "tracking": "9434636208416270000000", "barcode": "641099_4/D-189462", "size": "L", "clientName": "Yi Chen", "createdAt": 1735689600004, "updatedAt": 1735689600004, "source": "seed"}, {"id": "seed_return_6", "date": "2026-01-02", "company": "One", "returnType": "Pack", "notes": "", "tracking": "420100249434636000000000000000", "barcode": "646326_3/D- 1902369", "size": "M", "clientName": "Bridget Doran", "createdAt": 1735689600005, "updatedAt": 1735689600005, "source": "seed"}, {"id": "seed_return_7", "date": "2026-01-02", "company": "One", "returnType": "Pack", "notes": "", "tracking": "1z81r3y30315042471", "barcode": "646326_1/D-1902386", "size": "XS", "clientName": "Celeste Ma", "createdAt": 1735689600006, "updatedAt": 1735689600006, "source": "seed"}, {"id": "seed_return_8", "date": "2026-01-02", "company": "EnrollInsurance.com", "returnType": "Pack", "notes": "", "tracking": "420750249400136000000000000000", "barcode": "625709_9/D-1907147", "size": "One Size", "clientName": "Cathy Sun", "createdAt": 1735689600007, "updatedAt": 1735689600007, "source": "seed"}, {"id": "seed_return_9", "date": "2026-01-02", "company": "HealthPlan One", "returnType": "Pack", "notes": "", "tracking": "9400136208416270000000", "barcode": "630459_9/D-1834711", "size": "One Size", "clientName": "Will Lanier", "createdAt": 1735689600008, "updatedAt": 1735689600008, "source": "seed"}, {"id": "seed_return_10", "date": "2026-01-02", "company": "HealthPlan One", "returnType": "Pack", "notes": "", "tracking": "420321149400136000000000000000", "barcode": "630459_9/D-1835752", "size": "One Size", "clientName": "Jonathan Sparkman", "createdAt": 1735689600009, "updatedAt": 1735689600009, "source": "seed"}, {"id": "seed_return_11", "date": "2026-01-02", "company": "HealthPlan One", "returnType": "Pack", "notes": "", "tracking": "9400136208416270000000", "barcode": "630459_9/D-1835409", "size": "One Size", "clientName": "Odelia Jarrett", "createdAt": 1735689600010, "updatedAt": 1735689600010, "source": "seed"}, {"id": "seed_return_12", "date": "2026-01-02", "company": "Resolution Economics", "returnType": "Pack", "notes": "", "tracking": "420088540000", "barcode": "646633_9/D-1898162", "size": "One Size", "clientName": "Matthew Shorr", "createdAt": 1735689600011, "updatedAt": 1735689600011, "source": "seed"}, {"id": "seed_return_13", "date": "2026-01-02", "company": "Resolution Economics", "returnType": "Pack", "notes": "", "tracking": "1Z81R3Y31210320788", "barcode": "646634_9/D-1908828", "size": "One Size", "clientName": "Christina Briesacher", "createdAt": 1735689600012, "updatedAt": 1735689600012, "source": "seed"}, {"id": "seed_return_14", "date": "2026-01-02", "company": "Resolution Economics", "returnType": "Pack", "notes": "", "tracking": "420100199434636000000000000000", "barcode": "646631_9/D-1898023", "size": "One Size", "clientName": "Angela Tricari", "createdAt": 1735689600013, "updatedAt": 1735689600013, "source": "seed"}, {"id": "seed_return_15", "date": "2026-01-02", "company": "National Assocaition of B", "returnType": "Bulk", "notes": "", "tracking": "9400136208416270000000", "barcode": "WOG-038513/138567", "size": "M", "clientName": "Connie Ortiz", "createdAt": 1735689600014, "updatedAt": 1735689600014, "source": "seed"}, {"id": "seed_return_16", "date": "2026-01-02", "company": "Care Options", "returnType": "Bulk", "notes": "", "tracking": "9400136208416270000000", "barcode": "WOG-042862/148312", "size": "One Size", "clientName": "Ellie Lewis", "createdAt": 1735689600015, "updatedAt": 1735689600015, "source": "seed"}, {"id": "seed_return_17", "date": "2026-01-02", "company": "Biolumina", "returnType": "Bulk", "notes": "", "tracking": "9400136208416270000000", "barcode": "WOG-043647/150113", "size": "XL", "clientName": "Mariah Branum", "createdAt": 1735689600016, "updatedAt": 1735689600016, "source": "seed"}, {"id": "seed_return_18", "date": "2026-01-02", "company": "Biolumina", "returnType": "Bulk", "notes": "", "tracking": "420100399434636000000000000000", "barcode": "WOG-043661/150224", "size": "One Size", "clientName": "Nancy Davis", "createdAt": 1735689600017, "updatedAt": 1735689600017, "source": "seed"}, {"id": "seed_return_19", "date": "2026-01-05", "company": "Senior Solutions", "returnType": "Bulk/Pack", "notes": "", "tracking": "1Z81R3Y30335945226", "barcode": "WOG-043555/149858", "size": "One Size", "clientName": "Marsha Null", "createdAt": 1735689600018, "updatedAt": 1735689600018, "source": "seed"}, {"id": "seed_return_20", "date": "2026-01-05", "company": "Equipment Share", "returnType": "Pack", "notes": "Without Ornament", "tracking": "420786659400136000000000000000", "barcode": "646712_9", "size": "One Size", "clientName": "Amount Counted- 1", "createdAt": 1735689600019, "updatedAt": 1735689600019, "source": "seed"}, {"id": "seed_return_21", "date": "2026-01-05", "company": "Equipment Share", "returnType": "Pack", "notes": "With Ornament", "tracking": "420633689400136000000000000000", "barcode": "621954_9", "size": "One Size", "clientName": "Amount Counted- 30", "createdAt": 1735689600020, "updatedAt": 1735689600020, "source": "seed"}, {"id": "seed_return_22", "date": "2026-01-05", "company": "Equipment Share", "returnType": "Bulk/Pack", "notes": "Total 23", "tracking": "1Z81R3Y30315907251", "barcode": "WOG-044065/151027", "size": "One Size", "clientName": "Aztec Bolting Services", "createdAt": 1735689600021, "updatedAt": 1735689600021, "source": "seed"}, {"id": "seed_return_23", "date": "2026-01-05", "company": "Equipment Share", "returnType": "Bulk/Pack", "notes": "Total   4", "tracking": "1Z81R3Y30315907251", "barcode": "WOG-044065/151028", "size": "One Size", "clientName": "Aztec Bolting Services", "createdAt": 1735689600022, "updatedAt": 1735689600022, "source": "seed"}, {"id": "seed_return_24", "date": "2026-01-05", "company": "Equipment Share", "returnType": "Bulk/Pack", "notes": "Total   2", "tracking": "1Z81R3Y30315907251", "barcode": "WOG-044066/151029", "size": "One Size", "clientName": "n/A", "createdAt": 1735689600023, "updatedAt": 1735689600023, "source": "seed"}, {"id": "seed_return_25", "date": "2026-01-05", "company": "Fcm Travel", "returnType": "Bulk", "notes": "", "tracking": "1Z999A9R0366342695", "barcode": "WOG-044348/151812", "size": "One Size", "clientName": "Corinna Disanto", "createdAt": 1735689600024, "updatedAt": 1735689600024, "source": "seed"}, {"id": "seed_return_26", "date": "2026-01-05", "company": "Hospitable", "returnType": "Bulk", "notes": "", "tracking": "1Z81R3Y30339418655", "barcode": "WOG-043941/150672", "size": "One Size", "clientName": "Jeff Greenblatt", "createdAt": 1735689600025, "updatedAt": 1735689600025, "source": "seed"}, {"id": "seed_return_27", "date": "2026-01-05", "company": "Amazee.io", "returnType": "Bulk/Pack", "notes": "", "tracking": "1Z81R3Y30337678851", "barcode": "WOG-043628/149999", "size": "One Size", "clientName": "Robert Neshovski", "createdAt": 1735689600026, "updatedAt": 1735689600026, "source": "seed"}, {"id": "seed_return_28", "date": "2026-01-06", "company": "Equipment Share", "returnType": "Pack", "notes": "With Ornament", "tracking": "420851429400136000000000000000", "barcode": "621954_9", "size": "One Size", "clientName": "Total Amount:21", "createdAt": 1735689600027, "updatedAt": 1735689600027, "source": "seed"}, {"id": "seed_return_29", "date": "2026-01-06", "company": "Arm Institute", "returnType": "Pack", "notes": "", "tracking": "420153179434636000000000000000", "barcode": "555099_9/D-1891392", "size": "One Size", "clientName": "Pennsylvania Transformer Technology", "createdAt": 1735689600028, "updatedAt": 1735689600028, "source": "seed"}, {"id": "seed_return_30", "date": "2026-01-06", "company": "Zero Hash", "returnType": "Pack", "notes": "", "tracking": "9434636208416270000000", "barcode": "631027_9", "size": "M", "clientName": "", "createdAt": 1735689600029, "updatedAt": 1735689600029, "source": "seed"}, {"id": "seed_return_31", "date": "2026-01-06", "company": "HealthPlan One", "returnType": "Pack", "notes": "", "tracking": "9400136208416270000000", "barcode": "630459_9", "size": "One Size", "clientName": "", "createdAt": 1735689600030, "updatedAt": 1735689600030, "source": "seed"}, {"id": "seed_return_32", "date": "2026-01-06", "company": "HealthPlan One", "returnType": "Pack", "notes": "", "tracking": "420334289400136000000000000000", "barcode": "630459_9/D-1835130", "size": "One Size", "clientName": "Audrey Rendontroia", "createdAt": 1735689600031, "updatedAt": 1735689600031, "source": "seed"}, {"id": "seed_return_33", "date": "2026-01-06", "company": "Performance Contracting Gp.", "returnType": "Bulk/Pack", "notes": "", "tracking": "1Z81R3Y30300918124", "barcode": "WOG-043626/149995", "size": "One Size", "clientName": "Justin Moreno", "createdAt": 1735689600032, "updatedAt": 1735689600032, "source": "seed"}, {"id": "seed_return_34", "date": "2026-01-06", "company": "Performance Contracting Gp.", "returnType": "Bulk/Pack", "notes": "", "tracking": "1Z81R3Y30303302033", "barcode": "WOG-043626/149997", "size": "One Size", "clientName": "Andrew Broussard", "createdAt": 1735689600033, "updatedAt": 1735689600033, "source": "seed"}, {"id": "seed_return_35", "date": "2026-01-06", "company": "Performance Contracting Gp.", "returnType": "Bulk/Pack", "notes": "", "tracking": "1Z81R3Y30321022954", "barcode": "WOG-043581/149909", "size": "One Size", "clientName": "n/A", "createdAt": 1735689600034, "updatedAt": 1735689600034, "source": "seed"}, {"id": "seed_return_36", "date": "2026-01-06", "company": "Resolution Economics", "returnType": "Pack", "notes": "", "tracking": "1Z81R3Y30304271520", "barcode": "646632_9/D-1898094", "size": "One Size", "clientName": "Renee Noy", "createdAt": 1735689600035, "updatedAt": 1735689600035, "source": "seed"}, {"id": "seed_return_37", "date": "2026-01-06", "company": "Green Key Resources", "returnType": "Pack", "notes": "", "tracking": "420100169434636000000000000000", "barcode": "628754_9/D-1903646", "size": "One Size", "clientName": "Brian Cheng", "createdAt": 1735689600036, "updatedAt": 1735689600036, "source": "seed"}, {"id": "seed_return_38", "date": "2026-01-06", "company": "Green Key Resources", "returnType": "Pack", "notes": "", "tracking": "420100209434636000000000000000", "barcode": "628754_9/D-1903534", "size": "One Size", "clientName": "Rica Araneta-Rodriguez", "createdAt": 1735689600037, "updatedAt": 1735689600037, "source": "seed"}, {"id": "seed_return_39", "date": "2026-01-06", "company": "Green Key Resources", "returnType": "Pack", "notes": "", "tracking": "420100109434636000000000000000", "barcode": "628754_9/D-1903509", "size": "One Size", "clientName": "Reetika Vijay", "createdAt": 1735689600038, "updatedAt": 1735689600038, "source": "seed"}, {"id": "seed_return_40", "date": "2026-01-06", "company": "Green Key Resources", "returnType": "Pack", "notes": "", "tracking": "1Z81R3Y30335643552", "barcode": "628754_9/D-1903477", "size": "One Size", "clientName": "Cristina Minella", "createdAt": 1735689600039, "updatedAt": 1735689600039, "source": "seed"}, {"id": "seed_return_41", "date": "2026-01-06", "company": "Green Key Resources", "returnType": "Pack", "notes": "", "tracking": "420100179434636000000000000000", "barcode": "628754_9/D-1903404", "size": "One Size", "clientName": "Rebecca Stern", "createdAt": 1735689600040, "updatedAt": 1735689600040, "source": "seed"}, {"id": "seed_return_42", "date": "2026-01-06", "company": "Green Key Resources", "returnType": "Pack", "notes": "", "tracking": "420021109434636000000000000000", "barcode": "628754_9/D-1903514", "size": "One Size", "clientName": "Matthew Marotta", "createdAt": 1735689600041, "updatedAt": 1735689600041, "source": "seed"}, {"id": "seed_return_43", "date": "2026-01-06", "company": "Green Key Resources", "returnType": "Pack", "notes": "", "tracking": "1Z81R3Y30336803789", "barcode": "628754_9/D-1903664", "size": "One Size", "clientName": "Lynn Norris", "createdAt": 1735689600042, "updatedAt": 1735689600042, "source": "seed"}, {"id": "seed_return_44", "date": "2026-01-06", "company": "Jobsity", "returnType": "Pack", "notes": "", "tracking": "1Z81R3Y30330681501", "barcode": "641935_9/D-1866617", "size": "One Size", "clientName": "Peter Bjordahl", "createdAt": 1735689600043, "updatedAt": 1735689600043, "source": "seed"}, {"id": "seed_return_45", "date": "2026-01-06", "company": "CollegeVine", "returnType": "Pack", "notes": "", "tracking": "1Z81R3Y30338342292", "barcode": "641958_9/D-1903001", "size": "One Size", "clientName": "Zack Perkins", "createdAt": 1735689600044, "updatedAt": 1735689600044, "source": "seed"}, {"id": "seed_return_46", "date": "2026-01-06", "company": "Nourish", "returnType": "Pack", "notes": "", "tracking": "1Z81R3Y31205635798", "barcode": "642175_9/D-1907931", "size": "One Size", "clientName": "Christine Li", "createdAt": 1735689600045, "updatedAt": 1735689600045, "source": "seed"}, {"id": "seed_return_47", "date": "2026-01-06", "company": "Equipment Share", "returnType": "Pack", "notes": "With Ornament", "tracking": "420790659400136000000000000000", "barcode": "621954_9", "size": "One Size", "clientName": "Total Amount:5", "createdAt": 1735689600046, "updatedAt": 1735689600046, "source": "seed"}, {"id": "seed_return_48", "date": "2026-01-06", "company": "Nourish", "returnType": "Pack", "notes": "", "tracking": "9434636208416270000000", "barcode": "635545_1/D-1867917", "size": "XS", "clientName": "Keyri Corona", "createdAt": 1735689600047, "updatedAt": 1735689600047, "source": "seed"}, {"id": "seed_return_49", "date": "2026-01-06", "company": "American Kennel Club", "returnType": "Pack", "notes": "", "tracking": "1Z81R3Y31209270844", "barcode": "643911_9/D-1876908", "size": "One Size", "clientName": "John Havrilla", "createdAt": 1735689600048, "updatedAt": 1735689600048, "source": "seed"}, {"id": "seed_return_50", "date": "2026-01-06", "company": "Fourtune Brands Innovation", "returnType": "Pack", "notes": "", "tracking": "1Z81R3Y30310981528", "barcode": "566197_9/D-1901305", "size": "One Size", "clientName": "Izaiah Estrella", "createdAt": 1735689600049, "updatedAt": 1735689600049, "source": "seed"}, {"id": "seed_return_51", "date": "2026-01-06", "company": "Andiamo", "returnType": "Pack", "notes": "", "tracking": "1Z81R3Y30339099303", "barcode": "642842_9/D-1895335", "size": "One Size", "clientName": "Stephen Sorrow", "createdAt": 1735689600050, "updatedAt": 1735689600050, "source": "seed"}, {"id": "seed_return_52", "date": "2026-01-06", "company": "Amazon Delivery", "returnType": "Pack", "notes": "", "tracking": "9400136208416270000000", "barcode": "626151_3/D-1911713", "size": "M", "clientName": "Olyver Yau", "createdAt": 1735689600051, "updatedAt": 1735689600051, "source": "seed"}, {"id": "seed_return_53", "date": "2026-01-06", "company": "Amazon Delivery", "returnType": "Pack", "notes": "", "tracking": "420372089400136000000000000000", "barcode": "626151_4/D-1911996", "size": "L", "clientName": "YOO JIN HAN", "createdAt": 1735689600052, "updatedAt": 1735689600052, "source": "seed"}, {"id": "seed_return_54", "date": "2026-01-06", "company": "Cambium", "returnType": "Pack", "notes": "", "tracking": "1Z81R3Y30309611948", "barcode": "594869_9/D-1909211", "size": "One Size", "clientName": "Adrianna Barazotti", "createdAt": 1735689600053, "updatedAt": 1735689600053, "source": "seed"}, {"id": "seed_return_55", "date": "2026-01-06", "company": "Neon One", "returnType": "Pack", "notes": "", "tracking": "1Z81R3Y30314420822", "barcode": "637913_9/D-1896562", "size": "One Size", "clientName": "Carlos Desroses", "createdAt": 1735689600054, "updatedAt": 1735689600054, "source": "seed"}, {"id": "seed_return_56", "date": "2026-01-06", "company": "Northrop Gruman", "returnType": "Pack", "notes": "", "tracking": "1Z81R3Y30334428617", "barcode": "501217_9/D-1900339", "size": "One Size", "clientName": "Wiiliam Harrison", "createdAt": 1735689600055, "updatedAt": 1735689600055, "source": "seed"}, {"id": "seed_return_57", "date": "2026-01-07", "company": "Balfour Betty Investments", "returnType": "Pack", "notes": "", "tracking": "1Z81R3Y30323806158", "barcode": "638950_9/D-1911604", "size": "One Size", "clientName": "Alexandra Hicks", "createdAt": 1735689600056, "updatedAt": 1735689600056, "source": "seed"}, {"id": "seed_return_58", "date": "2026-01-07", "company": "Rockbot", "returnType": "Pack", "notes": "", "tracking": "420112219434636000000000000000", "barcode": "522581_9/D-1907884", "size": "XS", "clientName": "Lhanzi Giambrone", "createdAt": 1735689600057, "updatedAt": 1735689600057, "source": "seed"}, {"id": "seed_return_59", "date": "2026-01-07", "company": "Willow Bridge", "returnType": "Pack", "notes": "", "tracking": "1Z81R3Y30327321049", "barcode": "637906_9/D-1865868", "size": "One Size", "clientName": "Ronald Gonzalez", "createdAt": 1735689600058, "updatedAt": 1735689600058, "source": "seed"}, {"id": "seed_return_60", "date": "2026-01-07", "company": "Willow Bridge", "returnType": "Pack", "notes": "", "tracking": "1Z81R3Y30333415114", "barcode": "637906_9/D-1907277", "size": "One Size", "clientName": "Ambrosio Luna", "createdAt": 1735689600059, "updatedAt": 1735689600059, "source": "seed"}, {"id": "seed_return_61", "date": "2026-01-12", "company": "Northrop Gruman", "returnType": "Pack", "notes": "", "tracking": "1Z81R3Y30304325856", "barcode": "501217_9/D-1895699", "size": "One Size", "clientName": "Robert henderickson", "createdAt": 1735689600060, "updatedAt": 1735689600060, "source": "seed"}, {"id": "seed_return_62", "date": "2026-01-12", "company": "Green Key Resources", "returnType": "Pack", "notes": "", "tracking": "420100119434636000000000000000", "barcode": "628754_9/D-1903812", "size": "One Size", "clientName": "Alyssa Placa", "createdAt": 1735689600061, "updatedAt": 1735689600061, "source": "seed"}, {"id": "seed_return_63", "date": "2026-01-12", "company": "Green Key Resources", "returnType": "Pack", "notes": "", "tracking": "420100189434636000000000000000", "barcode": "628754_9/D-1903450", "size": "One Size", "clientName": "Cynthia Martin", "createdAt": 1735689600062, "updatedAt": 1735689600062, "source": "seed"}, {"id": "seed_return_64", "date": "2026-01-12", "company": "Amazon Delivery", "returnType": "Pack", "notes": "", "tracking": "9400136208416270000000", "barcode": "626151_3/D-1911833", "size": "M", "clientName": "Ram Prudhvi", "createdAt": 1735689600063, "updatedAt": 1735689600063, "source": "seed"}, {"id": "seed_return_65", "date": "2026-01-12", "company": "Amazon Delivery", "returnType": "Pack", "notes": "", "tracking": "9400136208416270000000", "barcode": "625496_3/D-1851885", "size": "M", "clientName": "Ricardo Gonzalez", "createdAt": 1735689600064, "updatedAt": 1735689600064, "source": "seed"}, {"id": "seed_return_66", "date": "2026-01-12", "company": "Amazon Delivery", "returnType": "Pack", "notes": "NAME ON PACKAGE WAS DAMAGED", "tracking": "483972298462", "barcode": "626151_4", "size": "L", "clientName": "", "createdAt": 1735689600065, "updatedAt": 1735689600065, "source": "seed"}, {"id": "seed_return_67", "date": "2026-01-12", "company": "Sydecar", "returnType": "Pack", "notes": "", "tracking": "1Z81R3Y30330823778", "barcode": "633083_9/D-1894555", "size": "One Size", "clientName": "David Chitester", "createdAt": 1735689600066, "updatedAt": 1735689600066, "source": "seed"}, {"id": "seed_return_68", "date": "2026-01-12", "company": "Nasdaq", "returnType": "Pack", "notes": "", "tracking": "1Z999A9R0319279469", "barcode": "328233_2/D-1915416", "size": "S", "clientName": "Renata Aidukiene", "createdAt": 1735689600067, "updatedAt": 1735689600067, "source": "seed"}, {"id": "seed_return_69", "date": "2026-01-12", "company": "The B Strong Grp.", "returnType": "Pack", "notes": "", "tracking": "1Z999A9R0358992436", "barcode": "645613_3", "size": "M", "clientName": "", "createdAt": 1735689600068, "updatedAt": 1735689600068, "source": "seed"}, {"id": "seed_return_70", "date": "2026-01-12", "company": "Willow Bridge", "returnType": "Pack", "notes": "", "tracking": "420275379434636000000000000000", "barcode": "637906_9/D-1907359", "size": "One Size", "clientName": "Angelica West", "createdAt": 1735689600069, "updatedAt": 1735689600069, "source": "seed"}, {"id": "seed_return_71", "date": "2026-01-12", "company": "Willow Bridge", "returnType": "Pack", "notes": "", "tracking": "1Z81R3Y30339904094", "barcode": "637906_9/D-1907274", "size": "One Size", "clientName": "Milly Mejia", "createdAt": 1735689600070, "updatedAt": 1735689600070, "source": "seed"}, {"id": "seed_return_72", "date": "2026-01-12", "company": "Equipment Share", "returnType": "Pack", "notes": "", "tracking": "420776139400136000000000000000", "barcode": "621954_9", "size": "One Size", "clientName": "Total:24", "createdAt": 1735689600071, "updatedAt": 1735689600071, "source": "seed"}, {"id": "seed_return_73", "date": "2026-01-12", "company": "Equipment Share", "returnType": "Pack", "notes": "", "tracking": "420760319400136000000000000000", "barcode": "646712_9", "size": "One Size", "clientName": "Total:5", "createdAt": 1735689600072, "updatedAt": 1735689600072, "source": "seed"}, {"id": "seed_return_74", "date": "2026-01-13", "company": "Everflow", "returnType": "Pack", "notes": "", "tracking": "1Z81R3Y30302275673", "barcode": "639026_9/D-1874056", "size": "One Size", "clientName": "Andrew Lekhraj", "createdAt": 1735689600073, "updatedAt": 1735689600073, "source": "seed"}, {"id": "seed_return_75", "date": "2026-01-13", "company": "Labelbox", "returnType": "Pack", "notes": "", "tracking": "1Z81R3Y30311853003", "barcode": "643124_9/D-1897880", "size": "One Size", "clientName": "Adam Tisdale", "createdAt": 1735689600074, "updatedAt": 1735689600074, "source": "seed"}, {"id": "seed_return_76", "date": "2026-01-13", "company": "Senior Solutions", "returnType": "Pack", "notes": "", "tracking": "420379209434636000000000000000", "barcode": "615099_5/D-1913485", "size": "XL", "clientName": "Shirley Roach", "createdAt": 1735689600075, "updatedAt": 1735689600075, "source": "seed"}, {"id": "seed_return_77", "date": "2026-01-13", "company": "Nerdery", "returnType": "Bulk", "notes": "", "tracking": "1Z10010V0457454417", "barcode": "WOG-043202/149001", "size": "M", "clientName": "Jorge Viveros", "createdAt": 1735689600076, "updatedAt": 1735689600076, "source": "seed"}, {"id": "seed_return_78", "date": "2026-01-13", "company": "CruxOCM", "returnType": "Pack", "notes": "", "tracking": "1Z81R3Y30321490556", "barcode": "645241_9/D-1901353", "size": "One Size", "clientName": "Jay Hum", "createdAt": 1735689600077, "updatedAt": 1735689600077, "source": "seed"}, {"id": "seed_return_79", "date": "2026-01-13", "company": "Enrollment Insurance", "returnType": "Pack", "notes": "", "tracking": "420751819400136000000000000000", "barcode": "625709_9/D-1907166", "size": "One Size", "clientName": "Kelvin White", "createdAt": 1735689600078, "updatedAt": 1735689600078, "source": "seed"}, {"id": "seed_return_80", "date": "2026-01-13", "company": "Bella&Canvas", "returnType": "Bulk", "notes": "", "tracking": "9400136208416270000000", "barcode": "WOG-039382/141260", "size": "XL", "clientName": "Alvaro Lamadrid", "createdAt": 1735689600079, "updatedAt": 1735689600079, "source": "seed"}, {"id": "seed_return_81", "date": "2026-01-13", "company": "Equipment Share", "returnType": "Pack", "notes": "", "tracking": "420350169400136000000000000000", "barcode": "621954_9", "size": "One Size", "clientName": "Total:3", "createdAt": 1735689600080, "updatedAt": 1735689600080, "source": "seed"}, {"id": "seed_return_82", "date": "2026-01-13", "company": "Repush", "returnType": "Pack", "notes": "", "tracking": "1Z81R3Y30318345488", "barcode": "606395_9/D-1916059", "size": "One Size", "clientName": "Israel Cruz", "createdAt": 1735689600081, "updatedAt": 1735689600081, "source": "seed"}, {"id": "seed_return_83", "date": "2026-01-13", "company": "Zero Hash", "returnType": "Pack", "notes": "", "tracking": "1Z81R3Y36789705916", "barcode": "631027_3/D-1896527", "size": "M", "clientName": "Tiganetea Claudiu", "createdAt": 1735689600082, "updatedAt": 1735689600082, "source": "seed"}, {"id": "seed_return_84", "date": "2026-01-13", "company": "One", "returnType": "Pack", "notes": "", "tracking": "1Z81R3Y30308192199", "barcode": "646326_3/D-1902613", "size": "M", "clientName": "Mikey Chapman", "createdAt": 1735689600083, "updatedAt": 1735689600083, "source": "seed"}, {"id": "seed_return_85", "date": "2026-01-13", "company": "Northone", "returnType": "Pack", "notes": "", "tracking": "420328259400136000000000000000", "barcode": "101479_3/D-785062", "size": "M", "clientName": "Kalista Levang", "createdAt": 1735689600084, "updatedAt": 1735689600084, "source": "seed"}, {"id": "seed_return_86", "date": "2026-01-14", "company": "HealthPlan One", "returnType": "Pack", "notes": "", "tracking": "9400136208416270000000", "barcode": "630459_9/D-1835963", "size": "One Size", "clientName": "Michael Corti", "createdAt": 1735689600085, "updatedAt": 1735689600085, "source": "seed"}, {"id": "seed_return_87", "date": "2026-01-14", "company": "One", "returnType": "Pack", "notes": "", "tracking": "1Z81R3Y30332326329", "barcode": "646326_4/D-1902482", "size": "L", "clientName": "Holly Thomas", "createdAt": 1735689600086, "updatedAt": 1735689600086, "source": "seed"}, {"id": "seed_return_88", "date": "2026-01-14", "company": "One", "returnType": "Pack", "notes": "", "tracking": "420112119434636000000000000000", "barcode": "646326_3/D-1902328", "size": "M", "clientName": "Annie Song", "createdAt": 1735689600087, "updatedAt": 1735689600087, "source": "seed"}, {"id": "seed_return_89", "date": "2026-01-14", "company": "Cursor", "returnType": "Pack", "notes": "", "tracking": "420805219400136000000000000000", "barcode": "637020_9/D-1901634", "size": "One Size", "clientName": "Quang Dao", "createdAt": 1735689600088, "updatedAt": 1735689600088, "source": "seed"}, {"id": "seed_return_90", "date": "2026-01-14", "company": "Attain", "returnType": "Pack", "notes": "", "tracking": "1Z81R3Y30337140832", "barcode": "636491_9/D-1898777", "size": "One Size", "clientName": "Maxime Theokritoff", "createdAt": 1735689600089, "updatedAt": 1735689600089, "source": "seed"}, {"id": "seed_return_91", "date": "2026-01-14", "company": "ConcertA.I.", "returnType": "Pack", "notes": "", "tracking": "1Z81R3Y30330789137", "barcode": "622611_9/D-1901124", "size": "One Size", "clientName": "Ned Bement", "createdAt": 1735689600090, "updatedAt": 1735689600090, "source": "seed"}, {"id": "seed_return_92", "date": "2026-01-16", "company": "Equipment Share", "returnType": "Pack", "notes": "", "tracking": "420776139400136000000000000000", "barcode": "621954_9", "size": "One Size", "clientName": "11", "createdAt": 1735689600091, "updatedAt": 1735689600091, "source": "seed"}, {"id": "seed_return_93", "date": "2026-01-16", "company": "OnTap Consulting", "returnType": "Bulk/Pack", "notes": "204/220", "tracking": "1Z81R3Y30320317218", "barcode": "WOG-044410/152016", "size": "One Size", "clientName": "Liz Alstott", "createdAt": 1735689600092, "updatedAt": 1735689600092, "source": "seed"}, {"id": "seed_return_94", "date": "2026-01-21", "company": "HealthPlan One", "returnType": "Pack", "notes": "NAME ON PACKAGE WAS DAMAGED", "tracking": "1Z81R3Y30316250995", "barcode": "630459_9", "size": "One Size", "clientName": "", "createdAt": 1735689600093, "updatedAt": 1735689600093, "source": "seed"}, {"id": "seed_return_95", "date": "2026-01-21", "company": "Enrollment Insurance", "returnType": "Pack", "notes": "", "tracking": "420328099400136000000000000000", "barcode": "625709_9/D-1915133", "size": "One Size", "clientName": "Edgar Rincon", "createdAt": 1735689600094, "updatedAt": 1735689600094, "source": "seed"}, {"id": "seed_return_96", "date": "2026-01-21", "company": "Enrollment Insurance", "returnType": "Pack", "notes": "", "tracking": "420774949400136000000000000000", "barcode": "625709_9/D-1907173", "size": "One Size", "clientName": "Heidy Larreal", "createdAt": 1735689600095, "updatedAt": 1735689600095, "source": "seed"}, {"id": "seed_return_97", "date": "2026-01-21", "company": "Circle", "returnType": "Pack", "notes": "", "tracking": "1Z81R3Y36707549061", "barcode": "553156_3/D-1873022", "size": "M", "clientName": "Caroline Chaves", "createdAt": 1735689600096, "updatedAt": 1735689600096, "source": "seed"}, {"id": "seed_return_98", "date": "2026-01-21", "company": "Equipment Share", "returnType": "Pack", "notes": "", "tracking": "420852499400136000000000000000", "barcode": "621954_9", "size": "One Size", "clientName": "Total:8", "createdAt": 1735689600097, "updatedAt": 1735689600097, "source": "seed"}, {"id": "seed_return_99", "date": "2026-01-21", "company": "Team Raft", "returnType": "Bulk", "notes": "", "tracking": "9434636208416270000000", "barcode": "WOG-042674/147887", "size": "2XL", "clientName": "David Fatokun", "createdAt": 1735689600098, "updatedAt": 1735689600098, "source": "seed"}, {"id": "seed_return_100", "date": "2026-01-21", "company": "Enrollment Insurance", "returnType": "Pack", "notes": "", "tracking": "420752549400136000000000000000", "barcode": "625709_9/D-1915120", "size": "One Size", "clientName": "Luis Gonzalez", "createdAt": 1735689600099, "updatedAt": 1735689600099, "source": "seed"}, {"id": "seed_return_101", "date": "2026-01-21", "company": "Constellation West", "returnType": "Bulk", "notes": "", "tracking": "9434636208416270000000", "barcode": "WOG-044759/152806", "size": "L", "clientName": "Michelle Johnson", "createdAt": 1735689600100, "updatedAt": 1735689600100, "source": "seed"}, {"id": "seed_return_102", "date": "2026-01-21", "company": "CollegeVine", "returnType": "Pack", "notes": "", "tracking": "420112229434636000000000000000", "barcode": "641958_9/D-1902962", "size": "One Size", "clientName": "Christina Tan", "createdAt": 1735689600101, "updatedAt": 1735689600101, "source": "seed"}, {"id": "seed_return_103", "date": "2026-01-21", "company": "NFP", "returnType": "Pack", "notes": "", "tracking": "9434636208416270000000", "barcode": "571096_9/D-1919479", "size": "One Size", "clientName": "Jake Blumencranz", "createdAt": 1735689600102, "updatedAt": 1735689600102, "source": "seed"}, {"id": "seed_return_104", "date": "2026-01-21", "company": "Blueprint to Automation", "returnType": "Pack", "notes": "", "tracking": "1Z81R3Y30302059700", "barcode": "559410_9/D-1913872", "size": "One Size", "clientName": "Benji Benas", "createdAt": 1735689600103, "updatedAt": 1735689600103, "source": "seed"}, {"id": "seed_return_105", "date": "2026-01-21", "company": "Willow Bridge", "returnType": "Pack", "notes": "", "tracking": "420019059434636000000000000000", "barcode": "637906_9/D-1907352", "size": "One Size", "clientName": "Luis Gonzalez", "createdAt": 1735689600104, "updatedAt": 1735689600104, "source": "seed"}, {"id": "seed_return_106", "date": "2026-01-21", "company": "Resprop Management", "returnType": "Pack", "notes": "", "tracking": "1Z81R3Y30332272182", "barcode": "592194_9/D-1859930", "size": "One Size", "clientName": "Jackeline Gaytan", "createdAt": 1735689600105, "updatedAt": 1735689600105, "source": "seed"}, {"id": "seed_return_107", "date": "2026-01-21", "company": "Hospitable", "returnType": "Pack", "notes": "", "tracking": "420197139434636000000000000000", "barcode": "645303_9/D-1918476", "size": "One Size", "clientName": "Castle Host", "createdAt": 1735689600106, "updatedAt": 1735689600106, "source": "seed"}, {"id": "seed_return_108", "date": "2026-01-21", "company": "Inclined", "returnType": "Pack", "notes": "", "tracking": "1Z81R3Y30307682545", "barcode": "641486_9/D-1893002", "size": "One Size", "clientName": "Barbara Bernstein", "createdAt": 1735689600107, "updatedAt": 1735689600107, "source": "seed"}, {"id": "seed_return_109", "date": "2026-01-21", "company": "Space and Time Labs", "returnType": "Pack", "notes": "", "tracking": "1Z81R3Y36780234389", "barcode": "592930_5/D-1874703", "size": "XL", "clientName": "Yang Junyi", "createdAt": 1735689600108, "updatedAt": 1735689600108, "source": "seed"}, {"id": "seed_return_110", "date": "2026-01-21", "company": "Inclined", "returnType": "Pack", "notes": "", "tracking": "420265479434636000000000000000", "barcode": "641486_9/D-1915846", "size": "One Size", "clientName": "Zebulon Lewis", "createdAt": 1735689600109, "updatedAt": 1735689600109, "source": "seed"}, {"id": "seed_return_111", "date": "2026-01-21", "company": "FurtherED", "returnType": "Pack", "notes": "", "tracking": "1Z81R3Y30319101293", "barcode": "644428_9/D-1872317", "size": "One Size", "clientName": "Rachel Atencio", "createdAt": 1735689600110, "updatedAt": 1735689600110, "source": "seed"}, {"id": "seed_return_112", "date": "2026-01-21", "company": "Boundless Imigration", "returnType": "Pack", "notes": "", "tracking": "1Z81R3Y30330282586", "barcode": "641159_9/D-1878128", "size": "One Size", "clientName": "Tahmina Parvin", "createdAt": 1735689600111, "updatedAt": 1735689600111, "source": "seed"}, {"id": "seed_return_113", "date": "2026-01-21", "company": "Wpromote", "returnType": "Pack", "notes": "", "tracking": "420804979434636000000000000000", "barcode": "626265_2/D-1910866", "size": "S", "clientName": "Noah Stulberg", "createdAt": 1735689600112, "updatedAt": 1735689600112, "source": "seed"}, {"id": "seed_return_114", "date": "2026-01-21", "company": "Amazon Delivery", "returnType": "Pack", "notes": "API-695509 missing from pack", "tracking": "420100199400136000000000000000", "barcode": "625494_1/D-1842115", "size": "XS", "clientName": "Ranjini Musuvathy", "createdAt": 1735689600113, "updatedAt": 1735689600113, "source": "seed"}, {"id": "seed_return_115", "date": "2026-01-21", "company": "Amazon Delivery", "returnType": "Pack", "notes": "API-695509 missing from pack", "tracking": "9400136208416270000000", "barcode": "626090_2/D-1841218", "size": "S", "clientName": "Kathy Jessica Paul", "createdAt": 1735689600114, "updatedAt": 1735689600114, "source": "seed"}, {"id": "seed_return_116", "date": "2026-01-21", "company": "Amazon Delivery", "returnType": "Pack", "notes": "API-695499 missing from pack", "tracking": "420980059400136000000000000000", "barcode": "625493_4/D-1845676", "size": "L", "clientName": "Joshua Muehring", "createdAt": 1735689600115, "updatedAt": 1735689600115, "source": "seed"}, {"id": "seed_return_117", "date": "2026-01-21", "company": "Amazon Delivery", "returnType": "Pack", "notes": "API-695961 missing from pack", "tracking": "420980379400136000000000000000", "barcode": "626089_3/D-1912478", "size": "M", "clientName": "Thanujhaa Danasekaran", "createdAt": 1735689600116, "updatedAt": 1735689600116, "source": "seed"}, {"id": "seed_return_118", "date": "2026-01-21", "company": "Amazon Delivery", "returnType": "Pack", "notes": "API-696032 missing from pack", "tracking": "9400136208416270000000", "barcode": "626151_5/D-1912021", "size": "XL", "clientName": "Han Yoo Jin", "createdAt": 1735689600117, "updatedAt": 1735689600117, "source": "seed"}, {"id": "seed_return_119", "date": "2026-01-21", "company": "Amazon Delivery", "returnType": "Pack", "notes": "API-695499 missing from pack", "tracking": "420981079400136000000000000000", "barcode": "625493_3/D-1844736", "size": "M", "clientName": "Arvind Chhikara", "createdAt": 1735689600118, "updatedAt": 1735689600118, "source": "seed"}, {"id": "seed_return_120", "date": "2026-01-21", "company": "Amazon Delivery", "returnType": "Pack", "notes": "API-695971 missing from pack", "tracking": "9400136208416270000000", "barcode": "626090_3/D-1840607", "size": "M", "clientName": "Jiaming Wang", "createdAt": 1735689600119, "updatedAt": 1735689600119, "source": "seed"}, {"id": "seed_return_121", "date": "2026-01-21", "company": "Amazon Delivery", "returnType": "Pack", "notes": "API-695519 missing from pack", "tracking": "420306839400136000000000000000", "barcode": "625496_3/D-1851885", "size": "M", "clientName": "Ricardo Gonzalez", "createdAt": 1735689600120, "updatedAt": 1735689600120, "source": "seed"}, {"id": "seed_return_122", "date": "2026-01-21", "company": "Amazon Delivery", "returnType": "Pack", "notes": "API-696032 missing from pack", "tracking": "420787599400136000000000000000", "barcode": "626151_4/D-1849949", "size": "L", "clientName": "Ujjwal Arora", "createdAt": 1735689600121, "updatedAt": 1735689600121, "source": "seed"}, {"id": "seed_return_123", "date": "2026-01-21", "company": "Amazon Delivery", "returnType": "Pack", "notes": "API-695499 missing from pack", "tracking": "420024539400136000000000000000", "barcode": "625493_5/D-1846539", "size": "XL", "clientName": "Erik Elliott", "createdAt": 1735689600122, "updatedAt": 1735689600122, "source": "seed"}, {"id": "seed_return_124", "date": "2026-01-22", "company": "Blockchain.com", "returnType": "Pack", "notes": "", "tracking": "Tracking Number Damaged", "barcode": "557813_4/D-1757221", "size": "L", "clientName": "William Smith", "createdAt": 1735689600123, "updatedAt": 1735689600123, "source": "seed"}, {"id": "seed_return_125", "date": "2026-01-22", "company": "CPMStar", "returnType": "Pack", "notes": "", "tracking": "420100179434636000000000000000", "barcode": "648383_9/D-1915544", "size": "One Size", "clientName": "Katie Beaule", "createdAt": 1735689600124, "updatedAt": 1735689600124, "source": "seed"}, {"id": "seed_return_126", "date": "2026-01-22", "company": "CPMStar", "returnType": "Pack", "notes": "", "tracking": "420100179434636000000000000000", "barcode": "648383_9/D-1915521", "size": "One Size", "clientName": "Deepthi Prakash", "createdAt": 1735689600125, "updatedAt": 1735689600125, "source": "seed"}, {"id": "seed_return_127", "date": "2026-01-22", "company": "CPMStar", "returnType": "Pack", "notes": "", "tracking": "420100179434636000000000000000", "barcode": "648383_9/D-1915539", "size": "One Size", "clientName": "Alexandra Bernal", "createdAt": 1735689600126, "updatedAt": 1735689600126, "source": "seed"}, {"id": "seed_return_128", "date": "2026-01-22", "company": "CPMStar", "returnType": "Pack", "notes": "", "tracking": "420100179434636000000000000000", "barcode": "648383_9/D-1915546", "size": "One Size", "clientName": "Duncan Smith", "createdAt": 1735689600127, "updatedAt": 1735689600127, "source": "seed"}, {"id": "seed_return_129", "date": "2026-01-22", "company": "EquipmentShare", "returnType": "Pack", "notes": "", "tracking": "1Z81R3Y30337907200", "barcode": "637234_9/D-1860845", "size": "One Size", "clientName": "Bryce Larkin", "createdAt": 1735689600128, "updatedAt": 1735689600128, "source": "seed"}, {"id": "seed_return_130", "date": "2026-01-22", "company": "eMoney Advisor", "returnType": "Pack", "notes": "", "tracking": "1Z81R3Y30320080698", "barcode": "639414_2/D-1875416", "size": "S", "clientName": "Elena Demidionok", "createdAt": 1735689600129, "updatedAt": 1735689600129, "source": "seed"}, {"id": "seed_return_131", "date": "2026-01-22", "company": "Blockworks", "returnType": "Pack", "notes": "", "tracking": "1Z81R3Y30322152679", "barcode": "648609_9/D-1913892", "size": "One Size", "clientName": "Alexander Hanbury", "createdAt": 1735689600130, "updatedAt": 1735689600130, "source": "seed"}, {"id": "seed_return_132", "date": "2026-01-22", "company": "Sydecar", "returnType": "Pack", "notes": "", "tracking": "1Z81R3Y30306446427", "barcode": "640023_9/D-1894560", "size": "One Size", "clientName": "Marissa Pulido", "createdAt": 1735689600131, "updatedAt": 1735689600131, "source": "seed"}, {"id": "seed_return_133", "date": "2026-01-23", "company": "Inclined", "returnType": "Pack", "notes": "", "tracking": "1Z81R3Y30321804823", "barcode": "641486_9/D-1915814", "size": "One Size", "clientName": "Garrett Leusink", "createdAt": 1735689600132, "updatedAt": 1735689600132, "source": "seed"}, {"id": "seed_return_134", "date": "2026-01-23", "company": "Amazon Delivery", "returnType": "Pack", "notes": "", "tracking": "420945389400136000000000000000", "barcode": "626090_3/D-1840732", "size": "M", "clientName": "Swarnalatha Srenigarajan", "createdAt": 1735689600133, "updatedAt": 1735689600133, "source": "seed"}, {"id": "seed_return_135", "date": "2026-01-23", "company": "Amazon Delivery", "returnType": "Pack", "notes": "", "tracking": "9400136208416270000000", "barcode": "625494_1/D-1842315", "size": "XS", "clientName": "Yasmeen Manghat", "createdAt": 1735689600134, "updatedAt": 1735689600134, "source": "seed"}, {"id": "seed_return_136", "date": "2026-01-23", "company": "Rula", "returnType": "Pack", "notes": "", "tracking": "9434636208416270000000", "barcode": "641707_9/D-1879398", "size": "One Size", "clientName": "Joshua Stevens-Stein", "createdAt": 1735689600135, "updatedAt": 1735689600135, "source": "seed"}, {"id": "seed_return_137", "date": "2026-01-27", "company": "Taymar", "returnType": "Pack", "notes": "", "tracking": "420640939400136000000000000000", "barcode": "642434_4/D-1915762", "size": "L", "clientName": "Kyle Voelker", "createdAt": 1735689600136, "updatedAt": 1735689600136, "source": "seed"}, {"id": "seed_return_138", "date": "2026-01-27", "company": "Equipment Share", "returnType": "Pack", "notes": "", "tracking": "9400136208416270000000", "barcode": "621954_9", "size": "One Size", "clientName": "total:3", "createdAt": 1735689600137, "updatedAt": 1735689600137, "source": "seed"}, {"id": "seed_return_139", "date": "2026-01-27", "company": "Green Key Resources", "returnType": "Pack", "notes": "", "tracking": "420191039434636000000000000000", "barcode": "628754_9/D-1903795", "size": "One Size", "clientName": "Nancy Landy", "createdAt": 1735689600138, "updatedAt": 1735689600138, "source": "seed"}, {"id": "seed_return_140", "date": "2026-01-27", "company": "Ontap Consulting", "returnType": "Bulk/Pack", "notes": "Total:7", "tracking": "1Z81R3Y30329345887", "barcode": "WOG-044410/152016", "size": "One Size", "clientName": "Liz Alstott", "createdAt": 1735689600139, "updatedAt": 1735689600139, "source": "seed"}, {"id": "seed_return_141", "date": "2026-01-28", "company": "Equipment Share", "returnType": "Pack", "notes": "", "tracking": "420795639400136000000000000000", "barcode": "621954_9", "size": "One Size", "clientName": "total:2", "createdAt": 1735689600140, "updatedAt": 1735689600140, "source": "seed"}, {"id": "seed_return_142", "date": "2026-01-28", "company": "Enrollment Insurance", "returnType": "Pack", "notes": "", "tracking": "420333099400136000000000000000", "barcode": "625709_9/D-1920236", "size": "One Size", "clientName": "Chentel Garcia", "createdAt": 1735689600141, "updatedAt": 1735689600141, "source": "seed"}, {"id": "seed_return_143", "date": "2026-01-28", "company": "HealthPlan One", "returnType": "Pack", "notes": "", "tracking": "9400136208416270000000", "barcode": "630459_9/D-1835023", "size": "One Size", "clientName": "Lesley Gonzales", "createdAt": 1735689600142, "updatedAt": 1735689600142, "source": "seed"}, {"id": "seed_return_144", "date": "2026-01-28", "company": "HealthPlan One", "returnType": "Pack", "notes": "", "tracking": "9400136208416270000000", "barcode": "630459_9", "size": "One Size", "clientName": "", "createdAt": 1735689600143, "updatedAt": 1735689600143, "source": "seed"}, {"id": "seed_return_145", "date": "2026-01-28", "company": "Amazon Delivery", "returnType": "Pack", "notes": "", "tracking": "9400136208416270000000", "barcode": "626089_2/D-1912330", "size": "One Size", "clientName": "Alekhya Maddila", "createdAt": 1735689600144, "updatedAt": 1735689600144, "source": "seed"}, {"id": "seed_return_146", "date": "2026-01-28", "company": "TechCXO", "returnType": "Pack", "notes": "", "tracking": "420100239434636000000000000000", "barcode": "601856_9/D-1918073", "size": "One Size", "clientName": "Tracey Martin", "createdAt": 1735689600145, "updatedAt": 1735689600145, "source": "seed"}, {"id": "seed_return_147", "date": "2026-01-28", "company": "Equipment Share", "returnType": "Pack", "notes": "", "tracking": "420493489434636000000000000000", "barcode": "620918_9/D-1913134", "size": "One Size", "clientName": "Thomas Himmelright", "createdAt": 1735689600146, "updatedAt": 1735689600146, "source": "seed"}, {"id": "seed_return_148", "date": "2026-01-28", "company": "Cypfer", "returnType": "Bulk", "notes": "", "tracking": "1Z4Y6R500346761138", "barcode": "WOG-044351/151815", "size": "One Size", "clientName": "", "createdAt": 1735689600147, "updatedAt": 1735689600147, "source": "seed"}, {"id": "seed_return_149", "date": "2026-01-28", "company": "Pelco", "returnType": "Bulk", "notes": "", "tracking": "1Z999A9R0368403615", "barcode": "WOG-044918/153164", "size": "One Size", "clientName": "", "createdAt": 1735689600148, "updatedAt": 1735689600148, "source": "seed"}, {"id": "seed_return_150", "date": "2026-01-28", "company": "Relatient Pack", "returnType": "Pack", "notes": "", "tracking": "Tracking Number Damaged/Covered", "barcode": "647795_9/D-1920804", "size": "One Size", "clientName": "Arianna Trejo", "createdAt": 1735689600149, "updatedAt": 1735689600149, "source": "seed"}, {"id": "seed_return_151", "date": "2026-01-29", "company": "TechCXO", "returnType": "Pack", "notes": "", "tracking": "420068209434636000000000000000", "barcode": "601856_9/D-1918074", "size": "One Size", "clientName": "Lehua Sparrow", "createdAt": 1735689600150, "updatedAt": 1735689600150, "source": "seed"}, {"id": "seed_return_152", "date": "2026-01-29", "company": "Equipment Share", "returnType": "Pack", "notes": "", "tracking": "9400136208416270000000", "barcode": "646712_9", "size": "One Size", "clientName": "total:1", "createdAt": 1735689600151, "updatedAt": 1735689600151, "source": "seed"}, {"id": "seed_return_153", "date": "2026-01-29", "company": "Equipment Share", "returnType": "Pack", "notes": "", "tracking": "9400136208416270000000", "barcode": "621954_9", "size": "One Size", "clientName": "total:1", "createdAt": 1735689600152, "updatedAt": 1735689600152, "source": "seed"}, {"id": "seed_return_154", "date": "2026-01-29", "company": "Equipment Share", "returnType": "Pack", "notes": "", "tracking": "9400136208416270000000", "barcode": "621954_9", "size": "One Size", "clientName": "total:1", "createdAt": 1735689600153, "updatedAt": 1735689600153, "source": "seed"}, {"id": "seed_return_155", "date": "2026-01-29", "company": "Equipment Share", "returnType": "Pack", "notes": "", "tracking": "9400136208416270000000", "barcode": "646712_9", "size": "One Size", "clientName": "total:1", "createdAt": 1735689600154, "updatedAt": 1735689600154, "source": "seed"}, {"id": "seed_return_156", "date": "2026-01-29", "company": "HealthPlan One", "returnType": "Pack", "notes": "", "tracking": "420349829400136000000000000000", "barcode": "630459_9/D-1836341", "size": "One Size", "clientName": "Desiree Serrano", "createdAt": 1735689600155, "updatedAt": 1735689600155, "source": "seed"}, {"id": "seed_return_157", "date": "2026-01-29", "company": "Amazon Delivery", "returnType": "Pack", "notes": "", "tracking": "420112219400136000000000000000", "barcode": "626150_4/D-1856818", "size": "L", "clientName": "Gabby Soares", "createdAt": 1735689600156, "updatedAt": 1735689600156, "source": "seed"}, {"id": "seed_return_158", "date": "2026-01-29", "company": "Everbridge", "returnType": "Pack", "notes": "", "tracking": "420101679434636000000000000000", "barcode": "482715_9/D-1919249", "size": "One Size", "clientName": "Colin Kelly", "createdAt": 1735689600157, "updatedAt": 1735689600157, "source": "seed"}, {"id": "seed_return_159", "date": "2026-01-29", "company": "Dark Wolf", "returnType": "Bulk", "notes": "", "tracking": "1Z81R3Y30339099518", "barcode": "WOG-045452/154368", "size": "One Size", "clientName": "Sam Sapienza", "createdAt": 1735689600158, "updatedAt": 1735689600158, "source": "seed"}, {"id": "seed_return_160", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600159, "updatedAt": 1735689600159, "source": "seed"}, {"id": "seed_return_161", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600160, "updatedAt": 1735689600160, "source": "seed"}, {"id": "seed_return_162", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600161, "updatedAt": 1735689600161, "source": "seed"}, {"id": "seed_return_163", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600162, "updatedAt": 1735689600162, "source": "seed"}, {"id": "seed_return_164", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600163, "updatedAt": 1735689600163, "source": "seed"}, {"id": "seed_return_165", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600164, "updatedAt": 1735689600164, "source": "seed"}, {"id": "seed_return_166", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600165, "updatedAt": 1735689600165, "source": "seed"}, {"id": "seed_return_167", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600166, "updatedAt": 1735689600166, "source": "seed"}, {"id": "seed_return_168", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600167, "updatedAt": 1735689600167, "source": "seed"}, {"id": "seed_return_169", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600168, "updatedAt": 1735689600168, "source": "seed"}, {"id": "seed_return_170", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600169, "updatedAt": 1735689600169, "source": "seed"}, {"id": "seed_return_171", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600170, "updatedAt": 1735689600170, "source": "seed"}, {"id": "seed_return_172", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600171, "updatedAt": 1735689600171, "source": "seed"}, {"id": "seed_return_173", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600172, "updatedAt": 1735689600172, "source": "seed"}, {"id": "seed_return_174", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600173, "updatedAt": 1735689600173, "source": "seed"}, {"id": "seed_return_175", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600174, "updatedAt": 1735689600174, "source": "seed"}, {"id": "seed_return_176", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600175, "updatedAt": 1735689600175, "source": "seed"}, {"id": "seed_return_177", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600176, "updatedAt": 1735689600176, "source": "seed"}, {"id": "seed_return_178", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600177, "updatedAt": 1735689600177, "source": "seed"}, {"id": "seed_return_179", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600178, "updatedAt": 1735689600178, "source": "seed"}, {"id": "seed_return_180", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600179, "updatedAt": 1735689600179, "source": "seed"}, {"id": "seed_return_181", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600180, "updatedAt": 1735689600180, "source": "seed"}, {"id": "seed_return_182", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600181, "updatedAt": 1735689600181, "source": "seed"}, {"id": "seed_return_183", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600182, "updatedAt": 1735689600182, "source": "seed"}, {"id": "seed_return_184", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600183, "updatedAt": 1735689600183, "source": "seed"}, {"id": "seed_return_185", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600184, "updatedAt": 1735689600184, "source": "seed"}, {"id": "seed_return_186", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600185, "updatedAt": 1735689600185, "source": "seed"}, {"id": "seed_return_187", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600186, "updatedAt": 1735689600186, "source": "seed"}, {"id": "seed_return_188", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600187, "updatedAt": 1735689600187, "source": "seed"}, {"id": "seed_return_189", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600188, "updatedAt": 1735689600188, "source": "seed"}, {"id": "seed_return_190", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600189, "updatedAt": 1735689600189, "source": "seed"}, {"id": "seed_return_191", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600190, "updatedAt": 1735689600190, "source": "seed"}, {"id": "seed_return_192", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600191, "updatedAt": 1735689600191, "source": "seed"}, {"id": "seed_return_193", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600192, "updatedAt": 1735689600192, "source": "seed"}, {"id": "seed_return_194", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600193, "updatedAt": 1735689600193, "source": "seed"}, {"id": "seed_return_195", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600194, "updatedAt": 1735689600194, "source": "seed"}, {"id": "seed_return_196", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600195, "updatedAt": 1735689600195, "source": "seed"}, {"id": "seed_return_197", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600196, "updatedAt": 1735689600196, "source": "seed"}, {"id": "seed_return_198", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600197, "updatedAt": 1735689600197, "source": "seed"}, {"id": "seed_return_199", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600198, "updatedAt": 1735689600198, "source": "seed"}, {"id": "seed_return_200", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600199, "updatedAt": 1735689600199, "source": "seed"}, {"id": "seed_return_201", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600200, "updatedAt": 1735689600200, "source": "seed"}, {"id": "seed_return_202", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600201, "updatedAt": 1735689600201, "source": "seed"}, {"id": "seed_return_203", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600202, "updatedAt": 1735689600202, "source": "seed"}, {"id": "seed_return_204", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600203, "updatedAt": 1735689600203, "source": "seed"}, {"id": "seed_return_205", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600204, "updatedAt": 1735689600204, "source": "seed"}, {"id": "seed_return_206", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600205, "updatedAt": 1735689600205, "source": "seed"}, {"id": "seed_return_207", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600206, "updatedAt": 1735689600206, "source": "seed"}, {"id": "seed_return_208", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600207, "updatedAt": 1735689600207, "source": "seed"}, {"id": "seed_return_209", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600208, "updatedAt": 1735689600208, "source": "seed"}, {"id": "seed_return_210", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600209, "updatedAt": 1735689600209, "source": "seed"}, {"id": "seed_return_211", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600210, "updatedAt": 1735689600210, "source": "seed"}, {"id": "seed_return_212", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600211, "updatedAt": 1735689600211, "source": "seed"}, {"id": "seed_return_213", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600212, "updatedAt": 1735689600212, "source": "seed"}, {"id": "seed_return_214", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600213, "updatedAt": 1735689600213, "source": "seed"}, {"id": "seed_return_215", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600214, "updatedAt": 1735689600214, "source": "seed"}, {"id": "seed_return_216", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600215, "updatedAt": 1735689600215, "source": "seed"}, {"id": "seed_return_217", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600216, "updatedAt": 1735689600216, "source": "seed"}, {"id": "seed_return_218", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600217, "updatedAt": 1735689600217, "source": "seed"}, {"id": "seed_return_219", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600218, "updatedAt": 1735689600218, "source": "seed"}, {"id": "seed_return_220", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600219, "updatedAt": 1735689600219, "source": "seed"}, {"id": "seed_return_221", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600220, "updatedAt": 1735689600220, "source": "seed"}, {"id": "seed_return_222", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600221, "updatedAt": 1735689600221, "source": "seed"}, {"id": "seed_return_223", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600222, "updatedAt": 1735689600222, "source": "seed"}, {"id": "seed_return_224", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600223, "updatedAt": 1735689600223, "source": "seed"}, {"id": "seed_return_225", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600224, "updatedAt": 1735689600224, "source": "seed"}, {"id": "seed_return_226", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600225, "updatedAt": 1735689600225, "source": "seed"}, {"id": "seed_return_227", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600226, "updatedAt": 1735689600226, "source": "seed"}, {"id": "seed_return_228", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600227, "updatedAt": 1735689600227, "source": "seed"}, {"id": "seed_return_229", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600228, "updatedAt": 1735689600228, "source": "seed"}, {"id": "seed_return_230", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600229, "updatedAt": 1735689600229, "source": "seed"}, {"id": "seed_return_231", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600230, "updatedAt": 1735689600230, "source": "seed"}, {"id": "seed_return_232", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600231, "updatedAt": 1735689600231, "source": "seed"}, {"id": "seed_return_233", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600232, "updatedAt": 1735689600232, "source": "seed"}, {"id": "seed_return_234", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600233, "updatedAt": 1735689600233, "source": "seed"}, {"id": "seed_return_235", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600234, "updatedAt": 1735689600234, "source": "seed"}, {"id": "seed_return_236", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600235, "updatedAt": 1735689600235, "source": "seed"}, {"id": "seed_return_237", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600236, "updatedAt": 1735689600236, "source": "seed"}, {"id": "seed_return_238", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600237, "updatedAt": 1735689600237, "source": "seed"}, {"id": "seed_return_239", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600238, "updatedAt": 1735689600238, "source": "seed"}, {"id": "seed_return_240", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600239, "updatedAt": 1735689600239, "source": "seed"}, {"id": "seed_return_241", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600240, "updatedAt": 1735689600240, "source": "seed"}, {"id": "seed_return_242", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600241, "updatedAt": 1735689600241, "source": "seed"}, {"id": "seed_return_243", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600242, "updatedAt": 1735689600242, "source": "seed"}, {"id": "seed_return_244", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600243, "updatedAt": 1735689600243, "source": "seed"}, {"id": "seed_return_245", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600244, "updatedAt": 1735689600244, "source": "seed"}, {"id": "seed_return_246", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600245, "updatedAt": 1735689600245, "source": "seed"}, {"id": "seed_return_247", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600246, "updatedAt": 1735689600246, "source": "seed"}, {"id": "seed_return_248", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600247, "updatedAt": 1735689600247, "source": "seed"}, {"id": "seed_return_249", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600248, "updatedAt": 1735689600248, "source": "seed"}, {"id": "seed_return_250", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600249, "updatedAt": 1735689600249, "source": "seed"}, {"id": "seed_return_251", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600250, "updatedAt": 1735689600250, "source": "seed"}, {"id": "seed_return_252", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600251, "updatedAt": 1735689600251, "source": "seed"}, {"id": "seed_return_253", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600252, "updatedAt": 1735689600252, "source": "seed"}, {"id": "seed_return_254", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600253, "updatedAt": 1735689600253, "source": "seed"}, {"id": "seed_return_255", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600254, "updatedAt": 1735689600254, "source": "seed"}, {"id": "seed_return_256", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600255, "updatedAt": 1735689600255, "source": "seed"}, {"id": "seed_return_257", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600256, "updatedAt": 1735689600256, "source": "seed"}, {"id": "seed_return_258", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600257, "updatedAt": 1735689600257, "source": "seed"}, {"id": "seed_return_259", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600258, "updatedAt": 1735689600258, "source": "seed"}, {"id": "seed_return_260", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600259, "updatedAt": 1735689600259, "source": "seed"}, {"id": "seed_return_261", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600260, "updatedAt": 1735689600260, "source": "seed"}, {"id": "seed_return_262", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600261, "updatedAt": 1735689600261, "source": "seed"}, {"id": "seed_return_263", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600262, "updatedAt": 1735689600262, "source": "seed"}, {"id": "seed_return_264", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600263, "updatedAt": 1735689600263, "source": "seed"}, {"id": "seed_return_265", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600264, "updatedAt": 1735689600264, "source": "seed"}, {"id": "seed_return_266", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600265, "updatedAt": 1735689600265, "source": "seed"}, {"id": "seed_return_267", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600266, "updatedAt": 1735689600266, "source": "seed"}, {"id": "seed_return_268", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600267, "updatedAt": 1735689600267, "source": "seed"}, {"id": "seed_return_269", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600268, "updatedAt": 1735689600268, "source": "seed"}, {"id": "seed_return_270", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600269, "updatedAt": 1735689600269, "source": "seed"}, {"id": "seed_return_271", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600270, "updatedAt": 1735689600270, "source": "seed"}, {"id": "seed_return_272", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600271, "updatedAt": 1735689600271, "source": "seed"}, {"id": "seed_return_273", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600272, "updatedAt": 1735689600272, "source": "seed"}, {"id": "seed_return_274", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600273, "updatedAt": 1735689600273, "source": "seed"}, {"id": "seed_return_275", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600274, "updatedAt": 1735689600274, "source": "seed"}, {"id": "seed_return_276", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600275, "updatedAt": 1735689600275, "source": "seed"}, {"id": "seed_return_277", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600276, "updatedAt": 1735689600276, "source": "seed"}, {"id": "seed_return_278", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600277, "updatedAt": 1735689600277, "source": "seed"}, {"id": "seed_return_279", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600278, "updatedAt": 1735689600278, "source": "seed"}, {"id": "seed_return_280", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600279, "updatedAt": 1735689600279, "source": "seed"}, {"id": "seed_return_281", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600280, "updatedAt": 1735689600280, "source": "seed"}, {"id": "seed_return_282", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600281, "updatedAt": 1735689600281, "source": "seed"}, {"id": "seed_return_283", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600282, "updatedAt": 1735689600282, "source": "seed"}, {"id": "seed_return_284", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600283, "updatedAt": 1735689600283, "source": "seed"}, {"id": "seed_return_285", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600284, "updatedAt": 1735689600284, "source": "seed"}, {"id": "seed_return_286", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600285, "updatedAt": 1735689600285, "source": "seed"}, {"id": "seed_return_287", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600286, "updatedAt": 1735689600286, "source": "seed"}, {"id": "seed_return_288", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600287, "updatedAt": 1735689600287, "source": "seed"}, {"id": "seed_return_289", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600288, "updatedAt": 1735689600288, "source": "seed"}, {"id": "seed_return_290", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600289, "updatedAt": 1735689600289, "source": "seed"}, {"id": "seed_return_291", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600290, "updatedAt": 1735689600290, "source": "seed"}, {"id": "seed_return_292", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600291, "updatedAt": 1735689600291, "source": "seed"}, {"id": "seed_return_293", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600292, "updatedAt": 1735689600292, "source": "seed"}, {"id": "seed_return_294", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600293, "updatedAt": 1735689600293, "source": "seed"}, {"id": "seed_return_295", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600294, "updatedAt": 1735689600294, "source": "seed"}, {"id": "seed_return_296", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600295, "updatedAt": 1735689600295, "source": "seed"}, {"id": "seed_return_297", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600296, "updatedAt": 1735689600296, "source": "seed"}, {"id": "seed_return_298", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600297, "updatedAt": 1735689600297, "source": "seed"}, {"id": "seed_return_299", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600298, "updatedAt": 1735689600298, "source": "seed"}, {"id": "seed_return_300", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600299, "updatedAt": 1735689600299, "source": "seed"}, {"id": "seed_return_301", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600300, "updatedAt": 1735689600300, "source": "seed"}, {"id": "seed_return_302", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600301, "updatedAt": 1735689600301, "source": "seed"}, {"id": "seed_return_303", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600302, "updatedAt": 1735689600302, "source": "seed"}, {"id": "seed_return_304", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600303, "updatedAt": 1735689600303, "source": "seed"}, {"id": "seed_return_305", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600304, "updatedAt": 1735689600304, "source": "seed"}, {"id": "seed_return_306", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600305, "updatedAt": 1735689600305, "source": "seed"}, {"id": "seed_return_307", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600306, "updatedAt": 1735689600306, "source": "seed"}, {"id": "seed_return_308", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600307, "updatedAt": 1735689600307, "source": "seed"}, {"id": "seed_return_309", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600308, "updatedAt": 1735689600308, "source": "seed"}, {"id": "seed_return_310", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600309, "updatedAt": 1735689600309, "source": "seed"}, {"id": "seed_return_311", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600310, "updatedAt": 1735689600310, "source": "seed"}, {"id": "seed_return_312", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600311, "updatedAt": 1735689600311, "source": "seed"}, {"id": "seed_return_313", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600312, "updatedAt": 1735689600312, "source": "seed"}, {"id": "seed_return_314", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600313, "updatedAt": 1735689600313, "source": "seed"}, {"id": "seed_return_315", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600314, "updatedAt": 1735689600314, "source": "seed"}, {"id": "seed_return_316", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600315, "updatedAt": 1735689600315, "source": "seed"}, {"id": "seed_return_317", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600316, "updatedAt": 1735689600316, "source": "seed"}, {"id": "seed_return_318", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600317, "updatedAt": 1735689600317, "source": "seed"}, {"id": "seed_return_319", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600318, "updatedAt": 1735689600318, "source": "seed"}, {"id": "seed_return_320", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600319, "updatedAt": 1735689600319, "source": "seed"}, {"id": "seed_return_321", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600320, "updatedAt": 1735689600320, "source": "seed"}, {"id": "seed_return_322", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600321, "updatedAt": 1735689600321, "source": "seed"}, {"id": "seed_return_323", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600322, "updatedAt": 1735689600322, "source": "seed"}, {"id": "seed_return_324", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600323, "updatedAt": 1735689600323, "source": "seed"}, {"id": "seed_return_325", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600324, "updatedAt": 1735689600324, "source": "seed"}, {"id": "seed_return_326", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600325, "updatedAt": 1735689600325, "source": "seed"}, {"id": "seed_return_327", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600326, "updatedAt": 1735689600326, "source": "seed"}, {"id": "seed_return_328", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600327, "updatedAt": 1735689600327, "source": "seed"}, {"id": "seed_return_329", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600328, "updatedAt": 1735689600328, "source": "seed"}, {"id": "seed_return_330", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600329, "updatedAt": 1735689600329, "source": "seed"}, {"id": "seed_return_331", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600330, "updatedAt": 1735689600330, "source": "seed"}, {"id": "seed_return_332", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600331, "updatedAt": 1735689600331, "source": "seed"}, {"id": "seed_return_333", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600332, "updatedAt": 1735689600332, "source": "seed"}, {"id": "seed_return_334", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600333, "updatedAt": 1735689600333, "source": "seed"}, {"id": "seed_return_335", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600334, "updatedAt": 1735689600334, "source": "seed"}, {"id": "seed_return_336", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600335, "updatedAt": 1735689600335, "source": "seed"}, {"id": "seed_return_337", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600336, "updatedAt": 1735689600336, "source": "seed"}, {"id": "seed_return_338", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600337, "updatedAt": 1735689600337, "source": "seed"}, {"id": "seed_return_339", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600338, "updatedAt": 1735689600338, "source": "seed"}, {"id": "seed_return_340", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600339, "updatedAt": 1735689600339, "source": "seed"}, {"id": "seed_return_341", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600340, "updatedAt": 1735689600340, "source": "seed"}, {"id": "seed_return_342", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600341, "updatedAt": 1735689600341, "source": "seed"}, {"id": "seed_return_343", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600342, "updatedAt": 1735689600342, "source": "seed"}, {"id": "seed_return_344", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600343, "updatedAt": 1735689600343, "source": "seed"}, {"id": "seed_return_345", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600344, "updatedAt": 1735689600344, "source": "seed"}, {"id": "seed_return_346", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600345, "updatedAt": 1735689600345, "source": "seed"}, {"id": "seed_return_347", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600346, "updatedAt": 1735689600346, "source": "seed"}, {"id": "seed_return_348", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600347, "updatedAt": 1735689600347, "source": "seed"}, {"id": "seed_return_349", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600348, "updatedAt": 1735689600348, "source": "seed"}, {"id": "seed_return_350", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600349, "updatedAt": 1735689600349, "source": "seed"}, {"id": "seed_return_351", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600350, "updatedAt": 1735689600350, "source": "seed"}, {"id": "seed_return_352", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600351, "updatedAt": 1735689600351, "source": "seed"}, {"id": "seed_return_353", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600352, "updatedAt": 1735689600352, "source": "seed"}, {"id": "seed_return_354", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600353, "updatedAt": 1735689600353, "source": "seed"}, {"id": "seed_return_355", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600354, "updatedAt": 1735689600354, "source": "seed"}, {"id": "seed_return_356", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600355, "updatedAt": 1735689600355, "source": "seed"}, {"id": "seed_return_357", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600356, "updatedAt": 1735689600356, "source": "seed"}, {"id": "seed_return_358", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600357, "updatedAt": 1735689600357, "source": "seed"}, {"id": "seed_return_359", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600358, "updatedAt": 1735689600358, "source": "seed"}, {"id": "seed_return_360", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600359, "updatedAt": 1735689600359, "source": "seed"}, {"id": "seed_return_361", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600360, "updatedAt": 1735689600360, "source": "seed"}, {"id": "seed_return_362", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600361, "updatedAt": 1735689600361, "source": "seed"}, {"id": "seed_return_363", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600362, "updatedAt": 1735689600362, "source": "seed"}, {"id": "seed_return_364", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600363, "updatedAt": 1735689600363, "source": "seed"}, {"id": "seed_return_365", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600364, "updatedAt": 1735689600364, "source": "seed"}, {"id": "seed_return_366", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600365, "updatedAt": 1735689600365, "source": "seed"}, {"id": "seed_return_367", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600366, "updatedAt": 1735689600366, "source": "seed"}, {"id": "seed_return_368", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600367, "updatedAt": 1735689600367, "source": "seed"}, {"id": "seed_return_369", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600368, "updatedAt": 1735689600368, "source": "seed"}, {"id": "seed_return_370", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600369, "updatedAt": 1735689600369, "source": "seed"}, {"id": "seed_return_371", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600370, "updatedAt": 1735689600370, "source": "seed"}, {"id": "seed_return_372", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600371, "updatedAt": 1735689600371, "source": "seed"}, {"id": "seed_return_373", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600372, "updatedAt": 1735689600372, "source": "seed"}, {"id": "seed_return_374", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600373, "updatedAt": 1735689600373, "source": "seed"}, {"id": "seed_return_375", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600374, "updatedAt": 1735689600374, "source": "seed"}, {"id": "seed_return_376", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600375, "updatedAt": 1735689600375, "source": "seed"}, {"id": "seed_return_377", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600376, "updatedAt": 1735689600376, "source": "seed"}, {"id": "seed_return_378", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600377, "updatedAt": 1735689600377, "source": "seed"}, {"id": "seed_return_379", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600378, "updatedAt": 1735689600378, "source": "seed"}, {"id": "seed_return_380", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600379, "updatedAt": 1735689600379, "source": "seed"}, {"id": "seed_return_381", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600380, "updatedAt": 1735689600380, "source": "seed"}, {"id": "seed_return_382", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600381, "updatedAt": 1735689600381, "source": "seed"}, {"id": "seed_return_383", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600382, "updatedAt": 1735689600382, "source": "seed"}, {"id": "seed_return_384", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600383, "updatedAt": 1735689600383, "source": "seed"}, {"id": "seed_return_385", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600384, "updatedAt": 1735689600384, "source": "seed"}, {"id": "seed_return_386", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600385, "updatedAt": 1735689600385, "source": "seed"}, {"id": "seed_return_387", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600386, "updatedAt": 1735689600386, "source": "seed"}, {"id": "seed_return_388", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600387, "updatedAt": 1735689600387, "source": "seed"}, {"id": "seed_return_389", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600388, "updatedAt": 1735689600388, "source": "seed"}, {"id": "seed_return_390", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600389, "updatedAt": 1735689600389, "source": "seed"}, {"id": "seed_return_391", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600390, "updatedAt": 1735689600390, "source": "seed"}, {"id": "seed_return_392", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600391, "updatedAt": 1735689600391, "source": "seed"}, {"id": "seed_return_393", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600392, "updatedAt": 1735689600392, "source": "seed"}, {"id": "seed_return_394", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600393, "updatedAt": 1735689600393, "source": "seed"}, {"id": "seed_return_395", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600394, "updatedAt": 1735689600394, "source": "seed"}, {"id": "seed_return_396", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600395, "updatedAt": 1735689600395, "source": "seed"}, {"id": "seed_return_397", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600396, "updatedAt": 1735689600396, "source": "seed"}, {"id": "seed_return_398", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600397, "updatedAt": 1735689600397, "source": "seed"}, {"id": "seed_return_399", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600398, "updatedAt": 1735689600398, "source": "seed"}, {"id": "seed_return_400", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600399, "updatedAt": 1735689600399, "source": "seed"}, {"id": "seed_return_401", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600400, "updatedAt": 1735689600400, "source": "seed"}, {"id": "seed_return_402", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600401, "updatedAt": 1735689600401, "source": "seed"}, {"id": "seed_return_403", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600402, "updatedAt": 1735689600402, "source": "seed"}, {"id": "seed_return_404", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600403, "updatedAt": 1735689600403, "source": "seed"}, {"id": "seed_return_405", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600404, "updatedAt": 1735689600404, "source": "seed"}, {"id": "seed_return_406", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600405, "updatedAt": 1735689600405, "source": "seed"}, {"id": "seed_return_407", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600406, "updatedAt": 1735689600406, "source": "seed"}, {"id": "seed_return_408", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600407, "updatedAt": 1735689600407, "source": "seed"}, {"id": "seed_return_409", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600408, "updatedAt": 1735689600408, "source": "seed"}, {"id": "seed_return_410", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600409, "updatedAt": 1735689600409, "source": "seed"}, {"id": "seed_return_411", "date": "2026-01-29", "company": "", "returnType": "Pack", "notes": "", "tracking": "", "barcode": "", "size": "", "clientName": "", "createdAt": 1735689600410, "updatedAt": 1735689600410, "source": "seed"}];
let returnsRecords=normalizeReturnsRecords(loadJson(returnsStorageKey,defaultReturnsRecords));

function normalizeReturnsDate(value){
  if(!value) return '';
  const raw=String(value).trim();
  if(/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const d=new Date(raw);
  if(!Number.isNaN(d.getTime())) return d.toISOString().slice(0,10);
  return raw;
}
function normalizeReturnsRecords(records){
  return (Array.isArray(records)?records:[]).map((item,idx)=>({
    id:String(item.id||`return_${Date.now()}_${idx}`),
    date:normalizeReturnsDate(item.date||''),
    company:String(item.company||'').trim(),
    returnType:(String(item.returnType||'Pack').trim()||'Pack'),
    notes:String(item.notes||'').trim(),
    tracking:String(item.tracking||'').trim(),
    barcode:String(item.barcode||'').trim(),
    size:String(item.size||'').trim(),
    clientName:String(item.clientName||'').trim(),
    createdAt:Number(item.createdAt||Date.now())||Date.now(),
    updatedAt:Number(item.updatedAt||item.createdAt||Date.now())||Date.now(),
    source:String(item.source||'manual').trim()||'manual'
  })).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
}
function persistReturns(){
  returnsRecords=normalizeReturnsRecords(returnsRecords);
  localStorage.setItem(returnsStorageKey,JSON.stringify(returnsRecords));
}

function getReturnsFiltered(){
  const q=(document.getElementById('returnsSearchInput')?.value||'').trim().toLowerCase();
  const type=(document.getElementById('returnsTypeFilter')?.value||'All');
  const company=(document.getElementById('returnsCompanyFilter')?.value||'All');
  const date=(document.getElementById('returnsDateFilter')?.value||'');
  return returnsRecords.filter(row=>{
    if(type!=='All' && row.returnType!==type) return false;
    if(company!=='All' && row.company!==company) return false;
    if(date && row.date!==date) return false;
    if(!q) return true;
    const hay=[row.date,row.company,row.returnType,row.tracking,row.barcode,row.clientName,row.size,row.notes].join(' ').toLowerCase();
    return hay.includes(q);
  });
}

function renderReturnsFilters(){
  const companyFilter=document.getElementById('returnsCompanyFilter');
  const companyOptions=document.getElementById('returnsCompanyOptions');
  if(!companyFilter || !companyOptions) return;
  const companies=[...new Set(returnsRecords.map(r=>r.company).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  const current=companyFilter.value||'All';
  companyFilter.innerHTML=['<option value="All">All</option>'].concat(companies.map(name=>`<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`)).join('');
  companyFilter.value=companies.includes(current)?current:'All';
  companyOptions.innerHTML=companies.map(name=>`<option value="${escapeHtml(name)}"></option>`).join('');
}

function renderReturnsStats(){
  const today=new Date().toISOString().slice(0,10);
  const todayRows=returnsRecords.filter(r=>r.date===today);
  const totalPill=document.getElementById('returnsTotalPill');
  const todayPill=document.getElementById('returnsTodayPill');
  const todayCount=document.getElementById('returnsTodayCount');
  const packCount=document.getElementById('returnsPackCount');
  const bulkCount=document.getElementById('returnsBulkCount');
  const companyCount=document.getElementById('returnsCompanyCount');
  if(totalPill) totalPill.textContent=`${returnsRecords.length} returns`;
  if(todayPill) todayPill.textContent=`${todayRows.length} today`;
  if(todayCount) todayCount.textContent=todayRows.length;
  if(packCount) packCount.textContent=todayRows.filter(r=>String(r.returnType).toLowerCase()==='pack').length;
  if(bulkCount) bulkCount.textContent=todayRows.filter(r=>String(r.returnType).toLowerCase()==='bulk').length;
  if(companyCount) companyCount.textContent=new Set(todayRows.map(r=>r.company).filter(Boolean)).size;
}

function renderReturnsRecent(){
  const el=document.getElementById('returnsRecentList');
  if(!el) return;
  const rows=returnsRecords.slice(0,5);
  el.innerHTML=rows.length ? rows.map(row=>`
    <article class="mc-update-item returns-log-item">
      <div class="mc-priority-title">${escapeHtml(row.company||'Unknown company')}</div>
      <div class="mc-update-copy">${escapeHtml(row.clientName||'No client')} • ${escapeHtml(row.returnType||'Return')} • ${escapeHtml(row.date||'No date')}</div>
      <div class="mc-update-copy">${escapeHtml(row.tracking||'No tracking')}${row.barcode ? ` • ${escapeHtml(row.barcode)}` : ''}</div>
    </article>
  `).join('') : '<div class="returns-empty">No returns logged yet.</div>';
}

function renderReturnsTable(){
  const tbody=document.getElementById('returnsTableBody');
  if(!tbody) return;
  const rows=getReturnsFiltered();
  tbody.innerHTML=rows.length ? rows.map(row=>`
    <tr>
      <td>${escapeHtml(row.date||'—')}</td>
      <td>${escapeHtml(row.company||'—')}</td>
      <td>${escapeHtml(row.returnType||'—')}</td>
      <td>${escapeHtml(row.tracking||'—')}</td>
      <td>${escapeHtml(row.barcode||'—')}</td>
      <td>${escapeHtml(row.clientName||'—')}</td>
      <td>${escapeHtml(row.size||'—')}</td>
      <td>${escapeHtml(row.notes||'—')}</td>
      <td><button class="btn secondary returns-delete-btn" data-id="${escapeHtml(row.id)}" type="button">Delete</button></td>
    </tr>
  `).join('') : '<tr><td colspan="9" class="returns-empty">No returns match the current filters.</td></tr>';
  tbody.querySelectorAll('.returns-delete-btn').forEach(btn=>btn.addEventListener('click',()=>{
    const id=btn.dataset.id;
    returnsRecords=returnsRecords.filter(r=>r.id!==id);
    persistReturns();
    renderReturns();
  }));
}

function setReturnsType(value){
  const input=document.getElementById('returnsTypeInput');
  if(input) input.value=value;
  document.querySelectorAll('#returnsTypeToggle .returns-type-btn').forEach(btn=>btn.classList.toggle('active',btn.dataset.value===value));
}

function clearReturnsForm(){
  const today=new Date().toISOString().slice(0,10);
  const dateInput=document.getElementById('returnsDateInput');
  const companyInput=document.getElementById('returnsCompanyInput');
  const trackingInput=document.getElementById('returnsTrackingInput');
  const barcodeInput=document.getElementById('returnsBarcodeInput');
  const clientNameInput=document.getElementById('returnsClientNameInput');
  const sizeInput=document.getElementById('returnsSizeInput');
  const notesInput=document.getElementById('returnsNotesInput');
  if(dateInput) dateInput.value=today;
  if(companyInput) companyInput.value='';
  if(trackingInput) trackingInput.value='';
  if(barcodeInput) barcodeInput.value='';
  if(clientNameInput) clientNameInput.value='';
  if(sizeInput) sizeInput.value='';
  if(notesInput) notesInput.value='';
  setReturnsType('Pack');
}

function saveReturnRecord(resetAfter=false){
  const date=(document.getElementById('returnsDateInput')?.value||'').trim();
  const company=(document.getElementById('returnsCompanyInput')?.value||'').trim();
  const returnType=(document.getElementById('returnsTypeInput')?.value||'Pack').trim() || 'Pack';
  const tracking=(document.getElementById('returnsTrackingInput')?.value||'').trim();
  const barcode=(document.getElementById('returnsBarcodeInput')?.value||'').trim();
  const clientName=(document.getElementById('returnsClientNameInput')?.value||'').trim();
  const size=(document.getElementById('returnsSizeInput')?.value||'').trim();
  const notes=(document.getElementById('returnsNotesInput')?.value||'').trim();

  if(!date){ alert('Add a date first.'); return; }
  if(!company){ alert('Add a company first.'); return; }
  if(!tracking && !barcode){ alert('Add a tracking number or a barcode.'); return; }

  returnsRecords.unshift({
    id:`return_${Date.now()}`,
    date, company, returnType, tracking, barcode, clientName, size, notes,
    createdAt:Date.now(),
    updatedAt:Date.now(),
    source:'manual'
  });
  persistReturns();
  renderReturns();
  if(resetAfter) clearReturnsForm();
}

function exportReturnsCsv(){
  const rows=getReturnsFiltered();
  const header=['Date','Company','Return Type','Tracking','Barcode','Client Full Name','Size','Notes'];
  const lines=[header.join(',')];
  rows.forEach(row=>{
    const vals=[row.date,row.company,row.returnType,row.tracking,row.barcode,row.clientName,row.size,row.notes].map(v=>`"${String(v||'').replace(/"/g,'""')}"`);
    lines.push(vals.join(','));
  });
  const blob=new Blob([lines.join('\n')],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;
  a.download=`returns-log-${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function renderReturns(){
  renderReturnsFilters();
  renderReturnsStats();
  renderReturnsRecent();
  renderReturnsTable();
}

function bindReturnsEvents(){
  if(document.body.dataset.returnsBound==='1') return;
  document.body.dataset.returnsBound='1';

  document.querySelectorAll('#returnsTypeToggle .returns-type-btn').forEach(btn=>btn.addEventListener('click',()=>setReturnsType(btn.dataset.value)));
  document.getElementById('returnsClearBtn')?.addEventListener('click',clearReturnsForm);
  document.getElementById('returnsSaveBtn')?.addEventListener('click',()=>saveReturnRecord(false));
  document.getElementById('returnsSaveNewBtn')?.addEventListener('click',()=>saveReturnRecord(true));
  document.getElementById('returnsExportCsvBtn')?.addEventListener('click',exportReturnsCsv);
  ['returnsSearchInput','returnsTypeFilter','returnsCompanyFilter','returnsDateFilter'].forEach(id=>{
    document.getElementById(id)?.addEventListener('input',renderReturnsTable);
    document.getElementById(id)?.addEventListener('change',renderReturnsTable);
  });
}

function scheduleAttendanceSync(){
  if(!attendanceSyncEnabled || !attendanceSyncLoaded) return;
  if(attendanceSyncTimer) clearTimeout(attendanceSyncTimer);
  attendanceSyncTimer=setTimeout(()=>{attendanceSyncTimer=null;syncAttendanceState();},250);
}
async function flushAttendanceSync(){
  if(!attendanceSyncEnabled || !attendanceSyncLoaded) return;
  if(attendanceSyncTimer){
    clearTimeout(attendanceSyncTimer);
    attendanceSyncTimer=null;
  }
  attendanceSyncQueued=false;
  await syncAttendanceState();
}
function scheduleEmployeesSync(){
  if(!employeesSyncEnabled || !employeesSyncLoaded) return;
  if(employeesSyncTimer) clearTimeout(employeesSyncTimer);
  employeesSyncTimer=setTimeout(()=>{employeesSyncTimer=null;syncEmployeesState();},250);
}
async function recordsApiRequest(base, method='GET', body){
  const options={method,headers:{'Accept':'application/json'}};
  if(body!==undefined){
    options.headers['Content-Type']='application/json';
    options.body=JSON.stringify(body);
  }
  const response=await fetch(base,options);
  const raw=await response.text();
  let data={};
  try{data=raw?JSON.parse(raw):{}}catch{data={raw}}
  if(!response.ok) throw new Error(data?.error || `Sync failed (${response.status})`);
  return data;
}
async function loadAttendanceFromBackend(){
  try{
    const data=await recordsApiRequest(attendanceApiBase,'GET');
    // PATCH: Always use backend as source of truth — remove the stale-local-wins guard.
    if(data && Array.isArray(data.records)){
      attendanceRecords=normalizeAttendanceRecords(data.records);
      localStorage.setItem(attendanceStorageKey,JSON.stringify(attendanceRecords));
    }
    if(data && Array.isArray(data.moves)){
      attendanceMoveRecords=normalizeAttendanceMoveRecords(data.moves);
      localStorage.setItem(attendanceMovesStorageKey,JSON.stringify(attendanceMoveRecords));
    }
    attendanceSyncEnabled=true;
    if(typeof renderAttendance==='function') renderAttendance();
    if(typeof window.attendanceRemixRefresh==='function') window.attendanceRemixRefresh();
  }catch(err){
    console.warn('Attendance sync unavailable, using browser storage.',err);
    attendanceSyncEnabled=false;
  }finally{
    attendanceSyncLoaded=true;
  }
}
async function syncAttendanceState(){
  if(!attendanceSyncEnabled || !attendanceSyncLoaded) return;
  if(attendanceSyncInFlight){attendanceSyncQueued=true;return;}
  attendanceSyncInFlight=true;
  try{
    const data=await recordsApiRequest(attendanceApiBase,'POST',{records:attendanceRecords,moves:attendanceMoveRecords});
    const responseIsStale=attendanceSyncQueued;
    if(!responseIsStale && data && Array.isArray(data.records)){
      attendanceRecords=normalizeAttendanceRecords(data.records);
      localStorage.setItem(attendanceStorageKey,JSON.stringify(attendanceRecords));
    }
    if(!responseIsStale && data && Array.isArray(data.moves)){
      attendanceMoveRecords=normalizeAttendanceMoveRecords(data.moves);
      localStorage.setItem(attendanceMovesStorageKey,JSON.stringify(attendanceMoveRecords));
    }
  }catch(err){
    console.warn('Attendance sync save failed; keeping local copy.',err);
    attendanceSyncEnabled=false;
  }finally{
    attendanceSyncInFlight=false;
    if(attendanceSyncQueued){attendanceSyncQueued=false;syncAttendanceState();}
  }
}
async function loadEmployeesFromBackend(){
  try{
    const data=await recordsApiRequest(employeesApiBase,'GET');
    const backendEmployees=(data && Array.isArray(data.employees)) ? normalizeEmployees(data.employees) : [];
    if(backendEmployees.length){
      employees=backendEmployees;
      localStorage.setItem(employeesStorageKey,JSON.stringify(employees));
    } else if(employees.length){
      // Seed the shared backend once from existing local data when the backend is empty.
      const seeded=await recordsApiRequest(employeesApiBase,'POST',{employees});
      if(seeded && Array.isArray(seeded.employees)){
        employees=normalizeEmployees(seeded.employees);
        localStorage.setItem(employeesStorageKey,JSON.stringify(employees));
      }
    } else {
      localStorage.setItem(employeesStorageKey,JSON.stringify(employees));
    }
    employeesSyncEnabled=true;
  }catch(err){
    console.warn('Employee sync unavailable, using browser storage.',err);
    employeesSyncEnabled=false;
  }finally{
    employeesSyncLoaded=true;
  }
}
async function syncEmployeesState(){
  if(!employeesSyncEnabled || !employeesSyncLoaded) return;
  if(employeesSyncInFlight){employeesSyncQueued=true;return;}
  employeesSyncInFlight=true;
  try{
    const data=await recordsApiRequest(employeesApiBase,'POST',{employees});
    if(data && Array.isArray(data.employees)){
      employees=normalizeEmployees(data.employees);
      localStorage.setItem(employeesStorageKey,JSON.stringify(employees));
    }
  }catch(err){
    console.warn('Employee sync save failed; keeping local copy.',err);
    employeesSyncEnabled=false;
  }finally{
    employeesSyncInFlight=false;
    if(employeesSyncQueued){employeesSyncQueued=false;syncEmployeesState();}
  }
}


function normalizeEmployeeNames(list){return Array.from(new Set((list||[]).map(v=>String(v).trim()).filter(Boolean))).sort((a,b)=>a.localeCompare(b))}
function normalizeEmployees(list){
  const mapped=(list||[]).map(item=>{
    if(typeof item==='string') return {name:String(item).trim(),adpName:'',department:'Receiving',birthday:'',size:'',active:true};
    const normalizedSize=String(item.size||'').trim().toUpperCase();
    return {name:String(item.name||'').trim(),adpName:String(item.adpName||'').trim(),department:String(item.department||'Receiving').trim(),birthday:String(item.birthday||'').trim(),size:sizeOptions.includes(normalizedSize)?normalizedSize:'',active:item.active!==false};
  }).filter(item=>item.name);
  const deduped=[]; const seen=new Set();
  mapped.forEach(item=>{const key=item.name.toLowerCase(); if(!seen.has(key)){seen.add(key); deduped.push(item)}});
  return deduped.sort((a,b)=>a.name.localeCompare(b.name));
}
function saveEmployees(){saveJson(employeesStorageKey,employees);scheduleEmployeesSync()}
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
function getAssemblyMonthSummary(year,month){
  const monthPrefix=`${year}-${String(month+1).padStart(2,'0')}-`;
  const days=new Set();
  let units=0;
  let packs=0;
  let pbCount=0;
  assemblyBoardRows.forEach(row=>{
    const date=String(row.date||'');
    if(!date.startsWith(monthPrefix)) return;
    days.add(date);
    units+=getAssemblyUnits(row);
    packs+=Number(row.qty||0);
    pbCount+=1;
  });
  return {dayCount:days.size,units,packs,pbCount};
}
function normalizeCalendarEvents(list){
  return (Array.isArray(list)?list:[]).map((item,idx)=>({
    id:String(item.id||`calendar_${Date.now()}_${idx}`),
    date:String(item.date||new Date().toISOString().slice(0,10)).trim(),
    time:String(item.time||'').trim(),
    title:String(item.title||'').trim(),
    type:String(item.type||'event').trim()||'event',
    note:String(item.note||'').trim(),
    createdAt:Number(item.createdAt||Date.now())
  })).filter(item=>item.date&&item.title);
}
function saveCalendarEvents(){saveJson(calendarEventsStorageKey,calendarEvents)}
function getCalendarEventsForDate(dateStr){
  return calendarEvents
    .filter(item=>String(item.date||'')===String(dateStr||''))
    .sort((a,b)=>String(a.time||'99:99').localeCompare(String(b.time||'99:99'))||String(a.title||'').localeCompare(String(b.title||'')));
}
function getCalendarEventsForMonth(year,month){
  const monthPrefix=`${year}-${String(month+1).padStart(2,'0')}-`;
  return calendarEvents.filter(item=>String(item.date||'').startsWith(monthPrefix));
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
function normalizeQueueRows(list){return(list||[]).map(item=>({id:item.id||Date.now()+Math.random(),priority:!!item.priority,pb:String(item.pb||'').trim(),pbId:String(item.pbId||'').trim(),so:String(item.so||'').trim(),account:String(item.account||'').trim(),qty:Number(item.qty||0),products:Number(item.products||0),units:Number(item.units||0),ihd:String(item.ihd||'').trim(),accountOwner:String(item.accountOwner||'').trim(),pdfUrl:String(item.pdfUrl||'').trim(),status:String(item.status||'').trim(),subtotal:Number(item.subtotal||item.revenue||0),revenue:Number(item.revenue||item.subtotal||0)}))}
function normalizeScheduledQueueRows(list){return(list||[]).map(item=>({id:item.id||Date.now()+Math.random(),priority:!!item.priority,pb:String(item.pb||'').trim(),pbId:String(item.pbId||'').trim(),so:String(item.so||'').trim(),account:String(item.account||'').trim(),qty:Number(item.qty||0),products:Number(item.products||0),units:Number(item.units||0),ihd:String(item.ihd||'').trim(),accountOwner:String(item.accountOwner||'').trim(),pdfUrl:String(item.pdfUrl||'').trim(),scheduledFor:String(item.scheduledFor||'').trim(),scheduledAt:String(item.scheduledAt||'').trim(),scheduleNote:String(item.scheduleNote||'').trim(),status:String(item.status||'').trim(),subtotal:Number(item.subtotal||item.revenue||0),revenue:Number(item.revenue||item.subtotal||0),sourceQueue:String(item.sourceQueue||'ready').trim(),sourceStatus:String(item.sourceStatus||item.status||'').trim()}))}
function normalizeRevenueReferenceRows(list){return(list||[]).map(item=>({id:item.id||Date.now()+Math.random(),salesOrder:String(item.salesOrder||'').trim(),originalSubtotal:Number(item.originalSubtotal||0),ihd:String(item.ihd||'').trim(),account:String(item.account||'').trim()})).filter(item=>item.salesOrder)}
function saveRevenueReference(){saveJson(revenueReferenceStorageKey,revenueReferenceRows)}
function saveQueue(){saveJson(queueStorageKey,availableQueueRows)}
function saveScheduledQueue(){saveJson(scheduledQueueStorageKey,scheduledQueueRows)}
function saveIncompleteQueue(){saveJson(incompleteQueueStorageKey,incompleteQueueRows)}
function buildSalesforcePbLink(pbId,pdfUrl){if(pdfUrl&&pdfUrl!=='-') return pdfUrl; if(!pbId) return ''; return `https://swagup.lightning.force.com/lightning/r/Pack_Builder__c/${pbId}/view`;}
function getAssemblyOpenLink(row){return String(row.externalLink||'').trim()||buildSalesforcePbLink(row.pbId,row.pdfUrl)||''}
function getAssemblyWorkTypeLabel(value){const map={pack_builder:'Pack Builder',jira:'Jira',placeholder:'Placeholder'};return map[value]||'Pack Builder'}
function isPackBuilderWorkType(value){const normalized=String(value||'').trim().toLowerCase().replace(/\s+/g,'_');return normalized==='pack_builder'||normalized==='packbuilder'||normalized==='pack-builder'||normalized==='pack builder';}
function formatAssemblyQty(row){const scheduledQty=Number(row.qty||0);const fullQty=Number(row.fullQty||row.qty||0);if(row.isPartial&&fullQty>0&&fullQty!==scheduledQty)return `${scheduledQty.toLocaleString()} / ${fullQty.toLocaleString()} packs`;return `${scheduledQty.toLocaleString()} packs`;}
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
    existing.subtotal=Number(existing.subtotal||0)+Number(payload.subtotal||payload.revenue||0);
    existing.revenue=Number(existing.revenue||0)+Number(payload.revenue||payload.subtotal||0);
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
    status:payload.status||'',
    subtotal:Number(payload.subtotal||payload.revenue||0),
    revenue:Number(payload.revenue||payload.subtotal||0)
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
function addAttendanceRecord(){const employeeName=attendanceEmployeeInput.value.trim();const department=attendanceDepartmentInput.value;const date=attendanceDateInput.value;const mark=attendanceMarkInput.value;const demerits=getDemeritForMark(mark);if(!employeeName){alert('Select an employee first.');attendanceEmployeeInput.focus();return}const duplicate=attendanceRecords.find(r=>r.employeeName===employeeName&&r.department===department&&r.date===date);if(duplicate){const replace=confirm('That employee already has a record for that department and date. Replace it?');if(!replace)return;attendanceRecords=attendanceRecords.filter(r=>!(r.employeeName===employeeName&&r.department===department&&r.date===date))}attendanceRecords.push({id:Date.now(),employeeName,department,date,mark,demerits});saveJson(attendanceStorageKey,attendanceRecords);flushAttendanceSync();attendanceEmployeeInput.value='';attendanceMarkInput.value='Present';updateAttendanceAutoDemerit();activeAttendanceDepartment=department;attendanceBatchDateInput.value=date;renderAttendance()}
function selectAllAttendanceRoster(){getRosterEmployees().forEach(emp=>attendanceRosterSelection.add(emp.name));renderAttendanceRoster();}
function clearAttendanceSelection(){attendanceRosterSelection.clear();renderAttendanceRoster();}
function applyBatchAttendance(markOverride=''){const selected=[...attendanceRosterSelection];if(!selected.length){alert('Select at least one employee first.');return}const date=attendanceBatchDateInput.value||new Date().toISOString().slice(0,10);const mark=markOverride||attendanceBatchMarkInput.value||'Present';selected.forEach(employeeName=>{attendanceRecords=attendanceRecords.filter(r=>!(r.employeeName===employeeName&&r.department===activeAttendanceDepartment&&r.date===date));attendanceRecords.push({id:Date.now()+Math.random(),employeeName,department:activeAttendanceDepartment,date,mark,demerits:getDemeritForMark(mark)});});saveJson(attendanceStorageKey,attendanceRecords);flushAttendanceSync();renderAttendance();}
function logAttendanceDepartmentMove(){const selected=[...attendanceRosterSelection];if(!selected.length){alert('Select at least one employee first.');return}const toDepartment=attendanceMoveToDepartmentInput.value;if(!toDepartment){alert('Choose where the selected employees moved to.');return}const date=attendanceBatchDateInput.value||new Date().toISOString().slice(0,10);const startTime=attendanceMoveStartTimeInput.value;const endTime=attendanceMoveEndTimeInput.value;const note=attendanceMoveNoteInput.value.trim();selected.forEach(employeeName=>attendanceMoveRecords.unshift({id:Date.now()+Math.random(),employeeName,date,fromDepartment:activeAttendanceDepartment,toDepartment,startTime,endTime,note}));saveJson(attendanceMovesStorageKey,attendanceMoveRecords);flushAttendanceSync();attendanceMoveNoteInput.value='';renderAttendanceMoveLog();}
function manageAttendanceEmployees(){document.querySelector('[data-page="employeesPage"]').click();}
function deleteAttendanceRecord(id){attendanceRecords=attendanceRecords.filter(r=>r.id!==id);saveJson(attendanceStorageKey,attendanceRecords);flushAttendanceSync();if(selectedProfileName)openAttendanceProfile(selectedProfileName);renderAttendance()}
function deleteAttendanceMoveRecord(id){attendanceMoveRecords=attendanceMoveRecords.filter(r=>r.id!==id);saveJson(attendanceMovesStorageKey,attendanceMoveRecords);flushAttendanceSync();renderAttendanceMoveLog()}
window.deleteAttendanceMoveRecord=deleteAttendanceMoveRecord;
function clearAttendanceData(){const confirmed=confirm('Delete all attendance data from this browser? You can undo this once.');if(!confirmed)return;saveJson(attendanceBackupKey,attendanceRecords);attendanceRecords=[];saveJson(attendanceStorageKey,attendanceRecords);flushAttendanceSync();renderAttendance();alert('Attendance data cleared. Use Undo clear if needed.');}
function undoAttendanceClear(){const backup=loadJson(attendanceBackupKey,null);if(!backup){alert('No attendance backup found.');return}attendanceRecords=normalizeAttendanceRecords(backup);saveJson(attendanceStorageKey,attendanceRecords);flushAttendanceSync();localStorage.removeItem(attendanceBackupKey);renderAttendance()}
function loadAttendanceSampleData(){attendanceRecords=normalizeAttendanceRecords(attendanceSampleData.map(item=>({...item,demerits:getDemeritForMark(item.mark)})));employees=normalizeEmployees(defaultEmployees);saveJson(attendanceStorageKey,attendanceRecords);flushAttendanceSync();saveEmployees();localStorage.removeItem(attendanceBackupKey);renderAttendance();renderEmployees()}
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
function renderEmployees(){const filtered=getFilteredEmployees();employeesActiveCount.textContent=getActiveEmployees().length;employeesDepartmentCount.textContent=new Set(getActiveEmployees().map(emp=>emp.department)).size;employeeManagerSizeInput.innerHTML=sizeOptions.map(size=>`<option value="${size}">${size||'Select size'}</option>`).join('');if(!filtered.length){employeesTableBody.innerHTML='<tr><td colspan="7" class="empty">No employees found.</td></tr>';}else{employeesTableBody.innerHTML=filtered.map(emp=>{if(employeeInlineEditName===emp.name){return `<tr><td><input id="inlineEmployeeName" value="${escapeHtml(emp.name)}" /></td><td><input id="inlineEmployeeAdpName" value="${escapeHtml(emp.adpName||'')}" placeholder="e.g. Campbell, TJ" /></td><td><select id="inlineEmployeeDepartment">${departments.map(d=>`<option value="${d}" ${emp.department===d?'selected':''}>${d}</option>`).join('')}</select></td><td><input id="inlineEmployeeBirthday" type="date" value="${escapeHtml(emp.birthday||'')}" /></td><td><select id="inlineEmployeeSize">${sizeOptions.map(size=>`<option value="${size}" ${String(emp.size||'')===size?'selected':''}>${size||'Select size'}</option>`).join('')}</select></td><td><span class="pill">${emp.active?'Active':'Inactive'}</span></td><td><div class="row-actions"><button class="btn" onclick="saveInlineEmployee('${escapeJs(emp.name)}')">Save</button><button class="btn secondary" onclick="cancelInlineEmployeeEdit()">Cancel</button></div></td></tr>`;}return `<tr><td>${escapeHtml(emp.name)}</td><td>${escapeHtml(emp.adpName||'—')}</td><td>${escapeHtml(emp.department)}</td><td>${formatBirthdayDisplay(emp.birthday)}</td><td>${escapeHtml(emp.size||'—')}</td><td><span class="pill">${emp.active?'Active':'Inactive'}</span></td><td><div class="row-actions"><button class="btn secondary" onclick="editEmployee('${escapeJs(emp.name)}')">Edit</button><button class="btn danger" onclick="removeEmployee('${escapeJs(emp.name)}')">Remove</button></div></td></tr>`;}).join('')}employeeManagerSizeInput.value=employeeManagerSizeInput.value||'';renderAttendanceEmployeeOptions(attendanceEmployeeInput.value);renderAttendanceRoster();renderErrorAssociateOptions(errorAssociateInput.value)}
function addEmployee(){const name=employeeManagerNameInput.value.trim();const adpName=String(document.getElementById('employeeManagerAdpName')?.value||'').trim();const department=employeeManagerDepartmentInput.value;const birthday=employeeManagerBirthdayInput.value;const size=String(employeeManagerSizeInput.value||'').trim().toUpperCase();if(!name){alert('Enter an employee name first.');employeeManagerNameInput.focus();return}const existing=getEmployeeByName(name);if(existing){existing.adpName=adpName;existing.department=department;existing.birthday=birthday;existing.size=size;existing.active=true;}else{employees.push({name,adpName,department,birthday,size,active:true});employees=normalizeEmployees(employees)}saveEmployees();employeeManagerNameInput.value='';const adpInput=document.getElementById('employeeManagerAdpName');if(adpInput)adpInput.value='';employeeManagerBirthdayInput.value='';employeeManagerSizeInput.value='';renderEmployees();renderCalendar();}
function removeEmployee(name){const confirmed=confirm(`Remove ${name} from the shared employee source? Existing history will stay in records.`);if(!confirmed)return;employees=employees.filter(emp=>emp.name!==name);if(employeeInlineEditName===name){employeeInlineEditName='';}saveEmployees();renderEmployees();renderCalendar();}
function editEmployee(name){employeeInlineEditName=name;renderEmployees();setTimeout(()=>{const input=document.getElementById('inlineEmployeeName');if(input) input.focus();},0);}
function cancelInlineEmployeeEdit(){employeeInlineEditName='';renderEmployees();}
function saveInlineEmployee(originalName){const name=(document.getElementById('inlineEmployeeName')?.value||'').trim();const adpName=String(document.getElementById('inlineEmployeeAdpName')?.value||'').trim();const department=document.getElementById('inlineEmployeeDepartment')?.value||'Receiving';const birthday=document.getElementById('inlineEmployeeBirthday')?.value||'';const size=String(document.getElementById('inlineEmployeeSize')?.value||'').trim().toUpperCase();if(!name){alert('Employee name cannot be blank.');return}const duplicate=employees.find(emp=>emp.name===name&&emp.name!==originalName);if(duplicate){alert('Another employee already has that name.');return}const employee=getEmployeeByName(originalName);if(!employee) return;employee.name=name;employee.adpName=adpName;employee.department=department;employee.birthday=birthday;employee.size=size;employee.active=true;employees=normalizeEmployees(employees);saveEmployees();employeeInlineEditName='';renderEmployees();renderCalendar();}
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
const calendarEventCount=document.getElementById('calendarEventCount');
const calendarAssemblyDays=document.getElementById('calendarAssemblyDays');
const calendarScheduledUnits=document.getElementById('calendarScheduledUnits');
const calendarSelectedDateLabel=document.getElementById('calendarSelectedDateLabel');
const calendarSelectedAssemblyList=document.getElementById('calendarSelectedAssemblyList');
const calendarCustomEventList=document.getElementById('calendarCustomEventList');
const calendarEventDate=document.getElementById('calendarEventDate');
const calendarEventTime=document.getElementById('calendarEventTime');
const calendarEventTitle=document.getElementById('calendarEventTitle');
const calendarEventType=document.getElementById('calendarEventType');
const calendarEventNote=document.getElementById('calendarEventNote');
let calendarCursor=new Date();
calendarCursor.setDate(1);
let selectedCalendarDate=new Date().toISOString().slice(0,10);

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

function selectCalendarDate(dateStr){
  const trimmed=String(dateStr||'').trim();
  if(!trimmed) return;
  selectedCalendarDate=trimmed;
  if(calendarEventDate) calendarEventDate.value=trimmed;
  const d=new Date(trimmed+'T00:00:00');
  if(!Number.isNaN(d.getTime())){
    calendarCursor=new Date(d.getFullYear(),d.getMonth(),1);
  }
  renderCalendar();
}
function renderCalendarSelectedDay(){
  if(!calendarSelectedDateLabel) return;
  calendarSelectedDateLabel.textContent=formatIsoDateForDisplay(selectedCalendarDate);
  if(calendarEventDate&&!calendarEventDate.value) calendarEventDate.value=selectedCalendarDate;
  const assemblyRows=assemblyBoardRows
    .filter(row=>String(row.date||'')===selectedCalendarDate)
    .sort((a,b)=>String(a.account||'').localeCompare(String(b.account||''))||String(a.pb||'').localeCompare(String(b.pb||'')));
  if(calendarSelectedAssemblyList){
    calendarSelectedAssemblyList.innerHTML=assemblyRows.length?assemblyRows.map(row=>{
      const stageLabel=getStageLabel(row.stage);
      return `<div class="calendar-list-item assembly"><div><strong>${escapeHtml(row.pb||'Pack Builder')}</strong><span>${escapeHtml(row.account||'—')} • ${escapeHtml(row.so||'—')}</span></div><div class="calendar-list-meta">${Number(getAssemblyUnits(row)||0).toLocaleString()} units • ${escapeHtml(stageLabel)}</div></div>`;
    }).join(''):'<div class="calendar-empty">No Assembly work scheduled for this day.</div>';
  }
  if(calendarCustomEventList){
    const dayEvents=getCalendarEventsForDate(selectedCalendarDate);
    calendarCustomEventList.innerHTML=dayEvents.length?dayEvents.map(item=>`<div class="calendar-list-item event"><div><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.time||'All day')} • ${escapeHtml(item.type)}</span>${item.note?`<p>${escapeHtml(item.note)}</p>`:''}</div><button class="calendar-delete-event" type="button" onclick="deleteCalendarEvent('${escapeJs(item.id)}')">Delete</button></div>`).join(''):'<div class="calendar-empty">No custom events scheduled for this day.</div>';
  }
}
function addCalendarEvent(){
  const date=String(calendarEventDate?.value||selectedCalendarDate||'').trim();
  const title=String(calendarEventTitle?.value||'').trim();
  if(!date){
    alert('Choose a date for the event.');
    calendarEventDate?.focus();
    return;
  }
  if(!title){
    alert('Add an event name first.');
    calendarEventTitle?.focus();
    return;
  }
  calendarEvents.unshift({
    id:`calendar_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    date,
    time:String(calendarEventTime?.value||'').trim(),
    title,
    type:String(calendarEventType?.value||'event').trim(),
    note:String(calendarEventNote?.value||'').trim(),
    createdAt:Date.now()
  });
  saveCalendarEvents();
  selectedCalendarDate=date;
  if(calendarEventTitle) calendarEventTitle.value='';
  if(calendarEventTime) calendarEventTime.value='';
  if(calendarEventNote) calendarEventNote.value='';
  renderCalendar();
}
function deleteCalendarEvent(id){
  calendarEvents=calendarEvents.filter(item=>String(item.id)!==String(id));
  saveCalendarEvents();
  renderCalendar();
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
  const assemblyMonthSummary=getAssemblyMonthSummary(year,month);
  const calendarMonthEvents=getCalendarEventsForMonth(year,month);
  calendarMonthTitle.textContent=monthLabel;
  calendarCurrentMonthLabel.textContent=monthLabel;
  if(calendarEventCount) calendarEventCount.textContent=calendarMonthEvents.length.toLocaleString();
  if(calendarAssemblyDays) calendarAssemblyDays.textContent=assemblyMonthSummary.dayCount.toLocaleString();
  if(calendarScheduledUnits) calendarScheduledUnits.textContent=assemblyMonthSummary.units.toLocaleString();
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
      const dayEvents=getCalendarEventsForDate(cellDate);
      if(assemblySummary.pbCount>0){
        eventsHtml+=`<div class="calendar-event assembly">Assembly: ${assemblySummary.pbCount} PB${assemblySummary.pbCount===1?'':'s'}</div>`;
        eventsHtml+=`<div class="calendar-event assembly-detail">${assemblySummary.units.toLocaleString()} units • ${assemblySummary.packs.toLocaleString()} packs</div>`;
      }
      eventsHtml+=dayEvents.slice(0,3).map(item=>`<div class="calendar-event custom">${escapeHtml(item.time?`${item.time} `:'')}${escapeHtml(item.title)}</div>`).join('');
      if(dayEvents.length>3){
        eventsHtml+=`<div class="calendar-event more">+${dayEvents.length-3} more event${dayEvents.length-3===1?'':'s'}</div>`;
      }
      eventsHtml+=dayBirthdays.map(item=>`<div class="calendar-event birthday">Birthday: ${escapeHtml(item.name)}</div>`).join('');
      if(!eventsHtml&&dayNumber===1){
        eventsHtml='<div class="calendar-event placeholder">Assembly and scheduled events appear here.</div>';
      }
    }
    const assemblySummary=getAssemblyDaySummary(cellDate);
    const isSelected=cellDate===selectedCalendarDate;
    const canSelect=!muted;
    const selectClass=canSelect?' calendar-cell-selectable':'';
    const selectedClass=isSelected?' selected':'';
    const assemblyClass=(!muted&&assemblySummary.pbCount>0)?' has-assembly':'';
    const jumpAttr=canSelect?` role="button" tabindex="0" data-calendar-date="${cellDate}" aria-label="Show schedule for ${cellDate}"`:'';
    const goToAssemblyBtn=(!muted&&assemblySummary.pbCount>0)?`<button class="calendar-assembly-link" type="button" data-assembly-date="${cellDate}">Open Assembly</button>`:'';
    cells.push(`<div class="calendar-cell ${muted?'muted':''}${selectClass}${selectedClass}${assemblyClass}"${jumpAttr}><div class="calendar-date">${dayNumber}</div>${eventsHtml}${goToAssemblyBtn}</div>`);
  }
  calendarGrid.innerHTML=cells.join('');
  calendarGrid.querySelectorAll('[data-calendar-date]').forEach(node=>{
    const dateStr=node.getAttribute('data-calendar-date');
    node.addEventListener('click',(event)=>{
      event.preventDefault();
      selectCalendarDate(dateStr);
    });
    node.addEventListener('keydown',(event)=>{
      if(event.key==='Enter' || event.key===' '){
        event.preventDefault();
        selectCalendarDate(dateStr);
      }
    });
  });
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
  renderCalendarSelectedDay();
}

document.getElementById('calendarPrevBtn').addEventListener('click',()=>{calendarCursor.setMonth(calendarCursor.getMonth()-1);renderCalendar();});
document.getElementById('calendarNextBtn').addEventListener('click',()=>{calendarCursor.setMonth(calendarCursor.getMonth()+1);renderCalendar();});
document.getElementById('calendarTodayBtn')?.addEventListener('click',()=>selectCalendarDate(new Date().toISOString().slice(0,10)));
document.getElementById('calendarAddEventBtn')?.addEventListener('click',addCalendarEvent);
calendarEventDate?.addEventListener('change',()=>{if(calendarEventDate.value) selectCalendarDate(calendarEventDate.value);});
window.deleteCalendarEvent=deleteCalendarEvent;




function getHomeSnapshotData(){
  const today = new Date().toISOString().slice(0,10);
  const safeReadLocalJson=(key,fallback)=>{
    try{
      const raw=localStorage.getItem(key);
      return raw?JSON.parse(raw):fallback;
    }catch{return fallback}
  };
  const safeNum=v=>Number(v||0)||0;
  const bestDate=(rows)=>{
    const dates=[...new Set((rows||[]).map(r=>String(r.date||'').trim()).filter(Boolean))].sort();
    if(!dates.length) return '';
    return dates.includes(today) ? today : dates[dates.length-1];
  };

  const workflowData=safeReadLocalJson('qaV5SeparatedWorkflowData_v4fixed',{})||{};
  const policyEntryFeed=(typeof policyEntries!=='undefined' && Array.isArray(policyEntries)) ? policyEntries : safeReadLocalJson('ops_hub_policy_entries_v1',[]);
  const policyDocFeed=(typeof policyDocs!=='undefined' && Array.isArray(policyDocs)) ? policyDocs : safeReadLocalJson('ops_hub_policy_docs_v1',[]);
  const sordImportMeta=safeReadLocalJson('ops_hub_sord_imports_v1',null);

  const activeEmployees=getActiveEmployees();
  const todayAttendance=attendanceRecords.filter(r=>r.date===today);
  const presentToday=todayAttendance.filter(r=>r.mark==='Present' || r.mark==='Late').length;
  const lateToday=todayAttendance.filter(r=>r.mark==='Late').length;
  const absentToday=todayAttendance.filter(r=>r.mark==='Absent' || r.mark==='Call Out' || r.mark==='No Call No Show').length;

  const byDept=(deptNames)=>{
    const set=new Set(deptNames.map(v=>String(v).toLowerCase()));
    return todayAttendance.filter(r=>set.has(String(r.department||'').toLowerCase()) && (r.mark==='Present' || r.mark==='Late')).length;
  };
  const receivingHeadcount=byDept(['Receiving','QA Receiving']);
  const prepHeadcount=byDept(['Prepping','Prep','QA Prep']);
  const assemblyHeadcountToday=byDept(['Assembly']);

  const flattenWorkflowSections=(sections,label,mode)=>{
    const out=[];
    (sections||[]).forEach(section=>{
      (section.rows||[]).forEach(row=>{
        out.push({
          source:label,
          date:section.date||'',
          associate:section.name||'',
          location:section.location||'',
          po:row.po||'',
          boxes:safeNum(row.boxes),
          ordered:safeNum(row.orderedQty||row.qty),
          received:safeNum(row.receivedQty||row.qty),
          extras:safeNum(row.extras),
          category:row.category||'',
          notes:row.notes||'',
          editHistory:Array.isArray(row.editHistory)?row.editHistory:[],
          createdAt:safeNum(row.createdAt||section.updatedAt||section.createdAt),
          mode
        });
      });
    });
    return out;
  };

  const allDock=flattenWorkflowSections(workflowData.dockSections,'Dock','simple');
  const allReceiving=flattenWorkflowSections(workflowData.receivingSections,'Receiving','counting');
  const allPrep=flattenWorkflowSections(workflowData.prepSections,'Prep','counting');
  const dockDate=bestDate(allDock);
  const receivingDate=bestDate(allReceiving);
  const prepDate=bestDate(allPrep);
  const dockRows=allDock.filter(r=>r.date===dockDate);
  const receivingRows=allReceiving.filter(r=>r.date===receivingDate);
  const prepRows=allPrep.filter(r=>r.date===prepDate);

  const allOverstock=(workflowData.overstockEntries||[]).map(r=>({
    source:'Overstock', date:r.date||'', associate:r.associate||'', location:r.location||'', po:r.po||'', quantity:safeNum(r.quantity), status:r.status||'', action:r.action||'', notes:r.notes||'', createdAt:safeNum(r.updatedAt||r.createdAt), editHistory:Array.isArray(r.editHistory)?r.editHistory:[]
  }));
  const allPutaway=(workflowData.putawayEntries||[]).map(r=>({
    source:'Putaway', date:r.date||'', associate:r.associate||'', location:r.location||'', po:r.po||'', status:r.status||'', notes:r.notes||'', createdAt:safeNum(r.updatedAt||r.createdAt), editHistory:Array.isArray(r.editHistory)?r.editHistory:[]
  }));
  const overstockDate=bestDate(allOverstock);
  const putawayDate=bestDate(allPutaway);
  const overstockRows=allOverstock.filter(r=>r.date===overstockDate);
  const putawayRows=allPutaway.filter(r=>r.date===putawayDate);

  const snap=getExecutiveSnapshot();
  const assemblyRows=snap.rows||[];
  const assemblyUnits=safeNum(snap.totalUnits);
  const assemblyDoneUnits=safeNum(snap.doneUnits);
  const assemblyUph=assemblyHeadcountToday>0 ? +(assemblyUnits/(assemblyHeadcountToday*8)).toFixed(1) : 0;
  const receivingUnits=receivingRows.reduce((s,r)=>s+r.received,0);
  const prepUnits=prepRows.reduce((s,r)=>s+r.received,0);
  const dockUnits=dockRows.reduce((s,r)=>s+(r.received||r.ordered||0),0);
  const receivingUph=receivingHeadcount>0 ? +(receivingUnits/(receivingHeadcount*8)).toFixed(1) : 0;
  const prepUph=prepHeadcount>0 ? +(prepUnits/(prepHeadcount*8)).toFixed(1) : 0;
  const inboundUnits=dockUnits+receivingUnits+prepUnits;
  const todayOutput=inboundUnits+assemblyUnits;

  const allTraceRows=[...dockRows,...receivingRows,...prepRows,...overstockRows,...putawayRows];
  const poMap=new Map();
  allTraceRows.forEach(r=>{
    const po=String(r.po||'').trim();
    if(!po) return;
    if(!poMap.has(po)) poMap.set(po,[]);
    poMap.get(po).push(r);
  });
  const poSummaries=[...poMap.entries()].map(([po,rows])=>{
    const touches=rows.length;
    const edits=rows.reduce((s,r)=>s+((r.editHistory||[]).length),0);
    const sources=[...new Set(rows.map(r=>r.source))];
    const latest=[...rows].sort((a,b)=>b.createdAt-a.createdAt)[0]||{};
    return {po,rows,touches,edits,sources,lastBy:latest.associate||'Unknown',lastAt:latest.createdAt||0};
  });
  const multiTouch=poSummaries.filter(item=>item.touches>1).sort((a,b)=>b.touches-a.touches);
  const editedTrace=poSummaries.filter(item=>item.edits>0).sort((a,b)=>b.edits-a.edits);

  const latestTimes=[];
  const pushLatest=(label,items,fieldNames=['updatedAt','createdAt'])=>{
    (items||[]).forEach(item=>{
      for(const field of fieldNames){
        const raw=item?.[field];
        const t=Number(raw)||new Date(String(raw||'')).getTime()||0;
        if(t){ latestTimes.push({label,time:t}); break; }
      }
    });
  };
  pushLatest('Assembly',assemblyBoardRows);
  pushLatest('Errors',errorRecords,['id']);
  pushLatest('Inbound',allTraceRows,['createdAt']);
  pushLatest('Policy',policyEntryFeed);
  pushLatest('Policy Docs',policyDocFeed);
  latestTimes.sort((a,b)=>b.time-a.time);
  const freshest=latestTimes.find(item=>item.time>0);

  const recentPolicies=[...(policyEntryFeed||[])].sort((a,b)=>(safeNum(b.updatedAt||b.createdAt)-safeNum(a.updatedAt||a.createdAt))).slice(0,3);
  const mostCommonError=[...errorRecords.reduce((m,r)=>m.set(r.errorType,(m.get(r.errorType)||0)+1), new Map()).entries()].sort((a,b)=>b[1]-a[1])[0];

  return {
    generatedAt: Date.now(),
    today,
    activeEmployees: activeEmployees.length,
    presentToday,
    lateToday,
    absentToday,
    inboundUnits,
    dockUnits,
    receivingUnits,
    prepUnits,
    receivingUph,
    prepUph,
    assemblyUph,
    assemblyUnits,
    assemblyDoneUnits,
    assemblyScheduled: assemblyRows.length,
    atRiskCount: safeNum(snap.atRiskCount),
    overdueCount: safeNum(snap.overdueCount),
    todayOutput,
    scheduledRevenue: safeNum(snap.scheduledRevenue),
    doneRevenue: safeNum(snap.doneRevenue),
    remainingRevenue: safeNum(snap.remainingRevenue),
    overstockCount: overstockRows.length,
    putawayCount: putawayRows.length,
    requiredExtras: overstockRows.filter(r=>r.action==='Required').length,
    errorCount: errorRecords.length,
    mostCommonError: mostCommonError ? `${mostCommonError[0]} (${mostCommonError[1]})` : 'None',
    multiTouchCount: multiTouch.length,
    editedTraceCount: editedTrace.length,
    topTimeline: poSummaries
      .filter(item=>item.touches>1 || item.edits>0)
      .sort((a,b)=>(b.edits*100+b.touches)-(a.edits*100+a.touches))
      .slice(0,6),
    recentPolicies: recentPolicies.map(item=>({
      title:item.title||item.name||'Untitled',
      category:item.category||'Policy',
      time:Number(item.updatedAt||item.createdAt)||0
    })),
    policyDocCount: policyDocFeed?.length||0,
    freshestLabel: freshest?.label || 'None',
    freshestTime: freshest?.time || 0,
    importSummary: sordImportMeta?.fileNames || null,
    dates:{dockDate, receivingDate, prepDate, overstockDate, putawayDate}
  };
}

function getHomeSnapshotDocumentHtml(snapshot){
  const fmtCurrency=v=>Number(v||0).toLocaleString('en-US',{style:'currency',currency:'USD',minimumFractionDigits:0,maximumFractionDigits:0});
  const fmtDateTime=(ts)=> ts ? new Date(ts).toLocaleString() : '—';
  const tl = snapshot.topTimeline || [];
  const pol = snapshot.recentPolicies || [];
  const importParts = snapshot.importSummary
    ? [snapshot.importSummary.queue && `Queue: ${snapshot.importSummary.queue}`, snapshot.importSummary.revenue && `Revenue: ${snapshot.importSummary.revenue}`, snapshot.importSummary.eom && `SORD: ${snapshot.importSummary.eom}`].filter(Boolean)
    : [];
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Mission Control Snapshot</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;color:#16344c;margin:24px;background:#fff}
  h1,h2,h3,p{margin:0}
  .top{display:flex;justify-content:space-between;gap:16px;align-items:flex-end;margin-bottom:18px}
  .sub{color:#5b7892;font-size:13px}
  .grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:14px 0 20px}
  .card{border:1px solid #d6e5f2;border-radius:16px;padding:12px;background:#fafdff;break-inside:avoid}
  .label{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#64829c;font-weight:700}
  .value{font-size:24px;font-weight:800;color:#103a60;margin-top:6px}
  .hint{margin-top:6px;font-size:12px;color:#5f7a93;line-height:1.35}
  .section{margin-top:22px}
  .section h2{font-size:20px;margin-bottom:10px}
  table{width:100%;border-collapse:collapse}
  th,td{border:1px solid #d6e5f2;padding:8px 10px;text-align:left;font-size:12px;vertical-align:top}
  th{background:#eef6fd}
  .list{display:grid;gap:8px}
  .item{border:1px solid #d6e5f2;border-radius:12px;padding:10px;background:#fff}
  .item-title{font-weight:700}
  .foot{margin-top:22px;font-size:12px;color:#6a859d}
  @media print{body{margin:12px}.grid{grid-template-columns:repeat(4,minmax(0,1fr))}}
</style>
</head>
<body>
  <div class="top">
    <div>
      <div class="label">Mission Control Snapshot</div>
      <h1>Warehouse Summary</h1>
      <p class="sub">Generated ${fmtDateTime(snapshot.generatedAt)}</p>
    </div>
    <div class="sub">Prepared from Home / Mission Control</div>
  </div>

  <div class="grid">
    <div class="card"><div class="label">Attendance Health</div><div class="value">${snapshot.presentToday}/${snapshot.activeEmployees}</div><div class="hint">${snapshot.lateToday} late • ${snapshot.absentToday} absent/call out</div></div>
    <div class="card"><div class="label">Inbound Health</div><div class="value">${snapshot.inboundUnits.toLocaleString()}</div><div class="hint">Dock ${snapshot.dockUnits.toLocaleString()} • Receiving ${snapshot.receivingUnits.toLocaleString()} • Prep ${snapshot.prepUnits.toLocaleString()}</div></div>
    <div class="card"><div class="label">Assembly Health</div><div class="value">${snapshot.assemblyUph || '—'} UPH</div><div class="hint">${snapshot.assemblyScheduled} scheduled • ${snapshot.atRiskCount} at risk • ${snapshot.overdueCount} overdue</div></div>
    <div class="card"><div class="label">Today's Output</div><div class="value">${snapshot.todayOutput.toLocaleString()}</div><div class="hint">${snapshot.assemblyUnits.toLocaleString()} assembly • ${snapshot.inboundUnits.toLocaleString()} inbound</div></div>
    <div class="card"><div class="label">Revenue</div><div class="value">${fmtCurrency(snapshot.scheduledRevenue)}</div><div class="hint">Done ${fmtCurrency(snapshot.doneRevenue)} • Remaining ${fmtCurrency(snapshot.remainingRevenue)}</div></div>
    <div class="card"><div class="label">Issue Health</div><div class="value">${snapshot.errorCount + snapshot.requiredExtras + snapshot.editedTraceCount}</div><div class="hint">${snapshot.errorCount} errors • ${snapshot.requiredExtras} required extras • ${snapshot.editedTraceCount} edited PO(s)</div></div>
    <div class="card"><div class="label">Timeline Pressure</div><div class="value">${snapshot.multiTouchCount}</div><div class="hint">PO(s) with multiple touches</div></div>
    <div class="card"><div class="label">Data Freshness</div><div class="value">${snapshot.freshestLabel}</div><div class="hint">${fmtDateTime(snapshot.freshestTime)}</div></div>
  </div>

  <div class="section">
    <h2>Department summary</h2>
    <table>
      <thead><tr><th>Department</th><th>Key metric</th><th>Support detail</th></tr></thead>
      <tbody>
        <tr><td>Dock</td><td>${snapshot.dockUnits.toLocaleString()} units</td><td>Date ${snapshot.dates.dockDate || '—'}</td></tr>
        <tr><td>QA Receiving</td><td>${snapshot.receivingUph || '—'} UPH</td><td>${snapshot.receivingUnits.toLocaleString()} units • Date ${snapshot.dates.receivingDate || '—'}</td></tr>
        <tr><td>Prep</td><td>${snapshot.prepUph || '—'} UPH</td><td>${snapshot.prepUnits.toLocaleString()} units • Date ${snapshot.dates.prepDate || '—'}</td></tr>
        <tr><td>Overstock</td><td>${snapshot.overstockCount} row(s)</td><td>${snapshot.requiredExtras} required • Date ${snapshot.dates.overstockDate || '—'}</td></tr>
        <tr><td>Putaway</td><td>${snapshot.putawayCount} row(s)</td><td>Date ${snapshot.dates.putawayDate || '—'}</td></tr>
        <tr><td>Assembly</td><td>${snapshot.assemblyUph || '—'} UPH</td><td>${snapshot.assemblyScheduled} scheduled • ${snapshot.assemblyUnits.toLocaleString()} units</td></tr>
      </tbody>
    </table>
  </div>

  <div class="section">
    <h2>Exception and traceability summary</h2>
    <table>
      <thead><tr><th>Signal</th><th>Value</th><th>Notes</th></tr></thead>
      <tbody>
        <tr><td>Warehouse errors</td><td>${snapshot.errorCount}</td><td>${snapshot.mostCommonError}</td></tr>
        <tr><td>Required extras</td><td>${snapshot.requiredExtras}</td><td>Rows currently marked Required in Extras</td></tr>
        <tr><td>Edited PO activity</td><td>${snapshot.editedTraceCount}</td><td>POs with audit-tracked edits</td></tr>
        <tr><td>Multi-touch PO activity</td><td>${snapshot.multiTouchCount}</td><td>POs with multiple timeline entries</td></tr>
      </tbody>
    </table>
  </div>

  <div class="section">
    <h2>Top timeline activity</h2>
    ${tl.length ? `<table>
      <thead><tr><th>PO</th><th>Timeline entries</th><th>Edits</th><th>Sources</th><th>Last touched</th></tr></thead>
      <tbody>
        ${tl.map(item=>`<tr><td>${item.po}</td><td>${item.touches}</td><td>${item.edits}</td><td>${item.sources.join(' → ')}</td><td>${item.lastBy} • ${fmtDateTime(item.lastAt)}</td></tr>`).join('')}
      </tbody>
    </table>` : `<div class="item">No multi-touch or edited POs are standing out in the current visible data.</div>`}
  </div>

  <div class="section">
    <h2>Recent changes</h2>
    <div class="list">
      ${pol.length ? pol.map(item=>`<div class="item"><div class="item-title">${item.title}</div><div class="sub">${item.category} • ${fmtDateTime(item.time)}</div></div>`).join('') : `<div class="item">No recent policy changes detected.</div>`}
      <div class="item"><div class="item-title">Policy documents</div><div class="sub">${snapshot.policyDocCount} supporting document(s) saved.</div></div>
      <div class="item"><div class="item-title">Import summary</div><div class="sub">${importParts.length ? importParts.join(' • ') : 'No shared import filenames detected.'}</div></div>
    </div>
  </div>

  <div class="foot">This snapshot is designed for Home / Mission Control review and print distribution.</div>
</body>
</html>`;
}

function exportHomeSnapshotFile(){
  const snapshot=getHomeSnapshotData();
  const html=getHomeSnapshotDocumentHtml(snapshot);
  const blob=new Blob([html],{type:'text/html;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;
  const stamp=new Date(snapshot.generatedAt).toISOString().slice(0,16).replace(/[:T]/g,'-');
  a.download=`mission-control-snapshot-${stamp}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
}

function printHomeSnapshot(){
  const snapshot=getHomeSnapshotData();
  const html=getHomeSnapshotDocumentHtml(snapshot);
  const win=window.open('','_blank','noopener,noreferrer,width=1100,height=900');
  if(!win) return;
  win.document.open();
  win.document.write(html);
  win.document.close();
  setTimeout(()=>{ try{ win.focus(); win.print(); }catch{} }, 250);
}

function renderHome(){
  const today = new Date().toISOString().slice(0,10);
  const nowTs = Date.now();
  const fmtCurrency=v=>Number(v||0).toLocaleString('en-US',{style:'currency',currency:'USD',minimumFractionDigits:0,maximumFractionDigits:0});

  const safeReadLocalJson=(key,fallback)=>{
    try{
      const raw=localStorage.getItem(key);
      return raw?JSON.parse(raw):fallback;
    }catch{return fallback}
  };
  const safeNum=v=>Number(v||0)||0;
  const bestDate=(rows)=>{
    const dates=[...new Set((rows||[]).map(r=>String(r.date||'').trim()).filter(Boolean))].sort();
    if(!dates.length) return '';
    return dates.includes(today) ? today : dates[dates.length-1];
  };
  const hoursSince=(ts)=>{
    const n=Number(ts||0);
    if(!n) return Infinity;
    return (nowTs - n) / 36e5;
  };
  const healthStatus=(value,{goodIf=()=>false,watchIf=()=>false}={})=>{
    if(goodIf(value)) return 'good';
    if(watchIf(value)) return 'watch';
    return 'risk';
  };

  const workflowData=safeReadLocalJson('qaV5SeparatedWorkflowData_v4fixed',{})||{};
  const policyEntryFeed=(typeof policyEntries!=='undefined' && Array.isArray(policyEntries)) ? policyEntries : safeReadLocalJson('ops_hub_policy_entries_v1',[]);
  const policyDocFeed=(typeof policyDocs!=='undefined' && Array.isArray(policyDocs)) ? policyDocs : safeReadLocalJson('ops_hub_policy_docs_v1',[]);
  const sordImportMeta=safeReadLocalJson('ops_hub_sord_imports_v1',null);

  const activeEmployees=getActiveEmployees();
  const todayAttendance=attendanceRecords.filter(r=>r.date===today);
  const presentToday=todayAttendance.filter(r=>r.mark==='Present' || r.mark==='Late').length;
  const lateToday=todayAttendance.filter(r=>r.mark==='Late').length;
  const absentToday=todayAttendance.filter(r=>r.mark==='Absent' || r.mark==='Call Out' || r.mark==='No Call No Show').length;

  const byDept=(deptNames)=>{
    const set=new Set(deptNames.map(v=>String(v).toLowerCase()));
    return todayAttendance.filter(r=>set.has(String(r.department||'').toLowerCase()) && (r.mark==='Present' || r.mark==='Late')).length;
  };
  const receivingHeadcount=byDept(['Receiving','QA Receiving']);
  const prepHeadcount=byDept(['Prepping','Prep','QA Prep']);
  const assemblyHeadcountToday=byDept(['Assembly']);

  const flattenWorkflowSections=(sections,label,mode)=>{
    const out=[];
    (sections||[]).forEach(section=>{
      (section.rows||[]).forEach(row=>{
        out.push({
          source:label,
          date:section.date||'',
          associate:section.name||'',
          location:section.location||'',
          po:row.po||'',
          boxes:safeNum(row.boxes),
          ordered:safeNum(row.orderedQty||row.qty),
          received:safeNum(row.receivedQty||row.qty),
          extras:safeNum(row.extras),
          category:row.category||'',
          notes:row.notes||'',
          editHistory:Array.isArray(row.editHistory)?row.editHistory:[],
          createdAt:safeNum(row.createdAt||section.updatedAt||section.createdAt),
          mode
        });
      });
    });
    return out;
  };

  const allDock=flattenWorkflowSections(workflowData.dockSections,'Dock','simple');
  const allReceiving=flattenWorkflowSections(workflowData.receivingSections,'Receiving','counting');
  const allPrep=flattenWorkflowSections(workflowData.prepSections,'Prep','counting');
  const dockDate=bestDate(allDock);
  const receivingDate=bestDate(allReceiving);
  const prepDate=bestDate(allPrep);
  const dockRows=allDock.filter(r=>r.date===dockDate);
  const receivingRows=allReceiving.filter(r=>r.date===receivingDate);
  const prepRows=allPrep.filter(r=>r.date===prepDate);

  const allOverstock=(workflowData.overstockEntries||[]).map(r=>({
    source:'Overstock', date:r.date||'', associate:r.associate||'', location:r.location||'', po:r.po||'', quantity:safeNum(r.quantity), status:r.status||'', action:r.action||'', notes:r.notes||'', createdAt:safeNum(r.updatedAt||r.createdAt), editHistory:Array.isArray(r.editHistory)?r.editHistory:[]
  }));
  const allPutaway=(workflowData.putawayEntries||[]).map(r=>({
    source:'Putaway', date:r.date||'', associate:r.associate||'', location:r.location||'', po:r.po||'', status:r.status||'', notes:r.notes||'', createdAt:safeNum(r.updatedAt||r.createdAt), editHistory:Array.isArray(r.editHistory)?r.editHistory:[]
  }));
  const overstockDate=bestDate(allOverstock);
  const putawayDate=bestDate(allPutaway);
  const overstockRows=allOverstock.filter(r=>r.date===overstockDate);
  const putawayRows=allPutaway.filter(r=>r.date===putawayDate);

  const snap=getExecutiveSnapshot();
  const assemblyRows=snap.rows||[];
  const assemblyUnits=safeNum(snap.totalUnits);
  const assemblyDoneUnits=safeNum(snap.doneUnits);
  const assemblyUph=assemblyHeadcountToday>0 ? +(assemblyUnits/(assemblyHeadcountToday*8)).toFixed(1) : 0;
  const receivingUnits=receivingRows.reduce((s,r)=>s+r.received,0);
  const prepUnits=prepRows.reduce((s,r)=>s+r.received,0);
  const dockUnits=dockRows.reduce((s,r)=>s+(r.received||r.ordered||0),0);
  const receivingUph=receivingHeadcount>0 ? +(receivingUnits/(receivingHeadcount*8)).toFixed(1) : 0;
  const prepUph=prepHeadcount>0 ? +(prepUnits/(prepHeadcount*8)).toFixed(1) : 0;

  const inboundUnits=dockUnits+receivingUnits+prepUnits;
  const todayOutput=inboundUnits+assemblyUnits;

  const allTraceRows=[...dockRows,...receivingRows,...prepRows,...overstockRows,...putawayRows];
  const poMap=new Map();
  allTraceRows.forEach(r=>{
    const po=String(r.po||'').trim();
    if(!po) return;
    if(!poMap.has(po)) poMap.set(po,[]);
    poMap.get(po).push(r);
  });
  const poSummaries=[...poMap.entries()].map(([po,rows])=>{
    const touches=rows.length;
    const edits=rows.reduce((s,r)=>s+((r.editHistory||[]).length),0);
    const sources=[...new Set(rows.map(r=>r.source))];
    const latest=[...rows].sort((a,b)=>b.createdAt-a.createdAt)[0]||{};
    return {po,rows,touches,edits,sources,lastBy:latest.associate||'Unknown',lastAt:latest.createdAt||0};
  });
  const multiTouch=poSummaries.filter(item=>item.touches>1).sort((a,b)=>b.touches-a.touches);
  const editedTrace=poSummaries.filter(item=>item.edits>0).sort((a,b)=>b.edits-a.edits);

  const latestTimes=[];
  const pushLatest=(label,items,fieldNames=['updatedAt','createdAt'])=>{
    (items||[]).forEach(item=>{
      for(const field of fieldNames){
        const raw=item?.[field];
        const t=Number(raw)||new Date(String(raw||'')).getTime()||0;
        if(t){ latestTimes.push({label,time:t}); break; }
      }
    });
  };
  pushLatest('Assembly',assemblyBoardRows);
  pushLatest('Errors',errorRecords,['id']);
  pushLatest('Inbound',allTraceRows,['createdAt']);
  pushLatest('Policy',policyEntryFeed);
  pushLatest('Policy Docs',policyDocFeed);
  latestTimes.sort((a,b)=>b.time-a.time);
  const freshest=latestTimes.find(item=>item.time>0);
  const freshestHours=hoursSince(freshest?.time||0);

  const setCard=(prefix, value, sub, status='watch')=>{
    const v=document.getElementById(prefix);
    const s=document.getElementById(prefix+'Sub');
    const card=document.getElementById(prefix+'Card');
    if(v) v.textContent=value;
    if(s) s.textContent=sub;
    if(card){
      card.classList.remove('is-good','is-watch','is-risk');
      card.classList.add(status==='good'?'is-good':status==='risk'?'is-risk':'is-watch');
    }
  };

  const attendanceRatio = activeEmployees.length ? presentToday/activeEmployees.length : 0;
  setCard('mcAttendanceHealth', `${presentToday}/${activeEmployees.length||0}`, `${lateToday} late • ${absentToday} absent/call out`, attendanceRatio>=0.9 && absentToday===0 ? 'good' : attendanceRatio>=0.75 ? 'watch' : 'risk');
  const inboundDateLabel = dockDate||receivingDate||prepDate||today;
  setCard('mcInboundHealth', inboundUnits.toLocaleString(), `Dock ${dockUnits.toLocaleString()} • Receiving ${receivingUnits.toLocaleString()} • Prep ${prepUnits.toLocaleString()} • ${inboundDateLabel===today?'today':'latest date'}`, inboundUnits>1500?'good':inboundUnits>0?'watch':'risk');
  setCard('mcAssemblyHealth', assemblyUph?`${assemblyUph} UPH`:'—', `${assemblyRows.length} scheduled • ${snap.atRiskCount||0} at risk • ${snap.overdueCount||0} overdue`, assemblyUph>=220?'good':assemblyUph>=180?'watch':'risk');
  const openIssues=errorRecords.length + overstockRows.filter(r=>r.action==='Required').length + editedTrace.length;
  setCard('mcIssueHealth', String(openIssues), `${errorRecords.length} warehouse errors • ${overstockRows.filter(r=>r.action==='Required').length} required extras • ${editedTrace.length} edited PO(s)`, openIssues===0?'good':openIssues<=8?'watch':'risk');
  setCard('mcDataFreshness', freshest?new Date(freshest.time).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}):'—', freshest?`${freshest.label} updated most recently • ${freshestHours<1?'fresh':freshestHours<8?'today':'stale'}`:'No recent timestamps found', freshestHours<2?'good':freshestHours<12?'watch':'risk');
  setCard('mcTodayOutput', todayOutput.toLocaleString(), `${assemblyUnits.toLocaleString()} assembly • ${inboundUnits.toLocaleString()} inbound • ${fmtCurrency(snap.scheduledRevenue||0)} scheduled`, todayOutput>3000?'good':todayOutput>0?'watch':'risk');

  const healthBanner=document.getElementById('homeAlertBanner');
  if(healthBanner){
    const alerts=[];
    if((snap.overdueCount||0)>0) alerts.push(`<span class="home-alert-pill home-alert-overdue">🔴 ${snap.overdueCount} overdue</span>`);
    if((snap.atRiskCount||0)>0) alerts.push(`<span class="home-alert-pill home-alert-atrisk">🟡 ${snap.atRiskCount} at risk</span>`);
    if(absentToday>0) alerts.push(`<span class="home-alert-pill home-alert-overdue">👥 ${absentToday} attendance gaps</span>`);
    if(editedTrace.length>0) alerts.push(`<span class="home-alert-pill home-alert-revenue">📝 ${editedTrace.length} edited PO(s)</span>`);
    if(freshestHours>=12) alerts.push(`<span class="home-alert-pill home-alert-overdue">⏱️ Data may be stale</span>`);
    if(!alerts.length) alerts.push('<span class="home-alert-pill home-alert-ok">✅ No urgent issues right now</span>');
    healthBanner.innerHTML=alerts.join(' ');
    healthBanner.hidden=false;
  }

  const deptCards=[
    {
      title:'Dock',
      metric:dockUnits.toLocaleString(),
      sub:`${new Set(dockRows.map(r=>r.po).filter(Boolean)).size} active POs • ${dockDate===today?'today':'latest date'}`,
      status:dockRows.length>0 ? 'good' : (allDock.length>0 ? 'watch' : 'risk'),
      copy:dockRows.length? 'Inbound is landing and being logged.' : (allDock.length? 'No dock work on today; showing latest available dock activity.' : 'No dock activity logged yet.'),
      pills:[`${dockRows.length} lines`,`Timeline ${multiTouch.filter(item=>item.sources.includes('Dock')).length}`],
      jump:'workflowInboundPage'
    },
    {
      title:'QA Receiving',
      metric: receivingUph?`${receivingUph} UPH`:'—',
      sub:`${receivingUnits.toLocaleString()} units • ${new Set(receivingRows.map(r=>r.po).filter(Boolean)).size} POs`,
      status: receivingUph>=180?'good':receivingUph>=150?'watch':'risk',
      copy: receivingRows.length? 'Receiving is actively processing work.' : (allReceiving.length? 'No receiving lines on today; latest activity is shown.' : 'No receiving lines logged yet.'),
      pills:[`${receivingHeadcount} present`,`Edits ${editedTrace.filter(item=>item.sources.includes('Receiving')).length}`],
      jump:'workflowInboundPage'
    },
    {
      title:'Prep',
      metric: prepUph?`${prepUph} UPH`:'—',
      sub:`${prepUnits.toLocaleString()} units • ${new Set(prepRows.map(r=>r.po).filter(Boolean)).size} POs`,
      status: prepUph>=275?'good':prepUph>=220?'watch':'risk',
      copy: prepRows.length? 'Prep is moving but should be watched for variance.' : (allPrep.length? 'No prep lines on today; latest activity is shown.' : 'No prep lines logged yet.'),
      pills:[`${prepHeadcount} present`,`Multi-touch ${multiTouch.filter(item=>item.sources.includes('Prep')).length}`],
      jump:'workflowInboundPage'
    },
    {
      title:'Overstock',
      metric: String(overstockRows.length),
      sub:`${overstockRows.filter(r=>r.action==='Required').length} required • ${overstockRows.filter(r=>r.status==='Donation').length} donation`,
      status: overstockRows.filter(r=>r.action==='Required').length===0 ? (overstockRows.length?'watch':'good') : 'risk',
      copy: overstockRows.length? 'Extras need review before they compound.' : (allOverstock.length? 'No extras on today; latest overstock activity is available.' : 'No extras logged yet.'),
      pills:[`${new Set(overstockRows.map(r=>r.po).filter(Boolean)).size} POs`,`Edited ${editedTrace.filter(item=>item.sources.includes('Overstock')).length}`],
      jump:'workflowInboundPage'
    },
    {
      title:'Putaway',
      metric: String(putawayRows.length),
      sub:`${new Set(putawayRows.map(r=>r.location).filter(Boolean)).size} locations in use`,
      status: putawayRows.length>0?'good':(allPutaway.length?'watch':'risk'),
      copy: putawayRows.length? 'Putaway has staged material available to trace.' : (allPutaway.length? 'No putaway on today; latest activity is shown.' : 'No putaway entries logged yet.'),
      pills:[`${new Set(putawayRows.map(r=>r.po).filter(Boolean)).size} POs`,`Timeline ${multiTouch.filter(item=>item.sources.includes('Putaway')).length}`],
      jump:'workflowInboundPage'
    },
    {
      title:'Assembly',
      metric: assemblyUph?`${assemblyUph} UPH`:'—',
      sub:`${assemblyRows.length} scheduled • ${assemblyUnits.toLocaleString()} units`,
      status: assemblyUph>=220?'good':assemblyUph>=180?'watch':'risk',
      copy: assemblyRows.length? 'Assembly is the live execution pressure point.' : 'No assembly schedule rows for today.',
      pills:[`Done ${assemblyDoneUnits.toLocaleString()}`,`At risk ${snap.atRiskCount||0}`],
      jump:'assemblyPage'
    },
  ];

  const deptRadar=document.getElementById('mcDeptRadar');
  if(deptRadar){
    deptRadar.innerHTML=deptCards.map(card=>{
      const cls=card.status==='good'?'mc-status-good':card.status==='risk'?'mc-status-risk':'mc-status-watch';
      const txt=card.status==='good'?'Stable':card.status==='risk'?'Risk':'Watch';
      return `<article class="mc-dept-card">
        <div class="mc-dept-top"><div class="eyebrow">${card.title}</div><span class="mc-status-chip ${cls}">${txt}</span></div>
        <div class="mc-dept-metric">${card.metric}</div>
        <div class="mc-dept-sub">${card.sub}</div>
        <div class="mc-dept-copy">${card.copy}</div>
        <div class="mc-mini-list">${card.pills.map(p=>`<span class="mc-mini-pill">${p}</span>`).join('')}</div>
        <button class="btn secondary" type="button" data-home-jump="${card.jump}">Open ${card.title}</button>
      </article>`;
    }).join('');
  }

  const priorities=[];
  const pushPriority=(score,level,title,copy,target)=> priorities.push({score,level,title,copy,target});
  if((snap.overdueCount||0)>0) pushPriority(100+safeNum(snap.overdueCount),'high','Overdue assembly work',`${snap.overdueCount} item(s) are overdue in assembly and need immediate review.`, 'assemblyPage');
  if(absentToday>0) pushPriority(95+absentToday,'high','Attendance coverage gap',`${absentToday} associate(s) are absent or called out today.`, 'attendancePage');
  if((snap.atRiskCount||0)>0) pushPriority(85+safeNum(snap.atRiskCount),'high','Assembly risk detected',`${snap.atRiskCount} assembly item(s) are currently at risk.`, 'assemblyPage');
  if(overstockRows.filter(r=>r.action==='Required').length>0) pushPriority(70+overstockRows.filter(r=>r.action==='Required').length,'med','Extras require disposition',`${overstockRows.filter(r=>r.action==='Required').length} overstock row(s) are marked Required.`, 'workflowInboundPage');
  if(errorRecords.length>0) pushPriority(60+errorRecords.length,'med','Warehouse errors need review',`${errorRecords.length} error record(s) are open in the system.`, 'errorsPage');
  if(editedTrace.length>0) pushPriority(50+editedTrace.length,'med','Edited PO activity detected',`${editedTrace.length} PO(s) have audit-tracked edits.`, 'workflowInboundPage');
  if(multiTouch.length>0) pushPriority(40+multiTouch.length,'med','Multi-touch PO activity',`${multiTouch.length} PO(s) have multiple timeline entries.`, 'workflowInboundPage');
  if(freshestHours>=12) pushPriority(30+Math.floor(freshestHours),'low','Data freshness is slipping',`Latest meaningful update was ${Math.floor(freshestHours)} hour(s) ago.`, 'importHubPage');
  if((policyEntryFeed||[]).length>0) {
    const rp=[...(policyEntryFeed||[])].sort((a,b)=>(safeNum(b.updatedAt||b.createdAt)-safeNum(a.updatedAt||a.createdAt)))[0];
    if(rp) pushPriority(20,'low','Recent policy changes available',`Latest policy update: ${rp.title||rp.name||'Untitled policy'}.`, 'policyPage');
  }
  if(!priorities.length) pushPriority(1,'low','Operation stable','No urgent exceptions are standing out right now.','homePage');

  priorities.sort((a,b)=>b.score-a.score);
  const radar=document.getElementById('mcPriorityRadar');
  if(radar){
    radar.innerHTML=priorities.slice(0,6).map(item=>{
      const cls=item.level==='high'?'mc-priority-high':item.level==='med'?'mc-priority-med':'mc-priority-low';
      const label=item.level==='high'?'High':item.level==='med'?'Medium':'Low';
      return `<article class="mc-priority-item">
        <div class="mc-priority-top"><div class="mc-priority-title">${item.title}</div><span class="mc-priority-badge ${cls}">${label}</span></div>
        <div class="mc-priority-copy">${item.copy}</div>
        <button class="btn secondary" type="button" data-home-jump="${item.target}">Open</button>
      </article>`;
    }).join('');
  }

  const exceptionCenter=document.getElementById('mcExceptionCenter');
  if(exceptionCenter){
    const mostCommonError=[...errorRecords.reduce((m,r)=>m.set(r.errorType,(m.get(r.errorType)||0)+1), new Map()).entries()].sort((a,b)=>b[1]-a[1])[0];
    const mostEdited=editedTrace[0];
    const mostTouched=multiTouch[0];
    const exceptionCards=[
      {title:'Warehouse Errors',value:errorRecords.length,copy:errorRecords.length?(mostCommonError?`${mostCommonError[0]} is repeating most.`:`${errorRecords.length} active error record(s).`):'No active error records'},
      {title:'Holds / Extras',value:overstockRows.length,copy:overstockRows.filter(r=>r.action==='Required').length?`${overstockRows.filter(r=>r.action==='Required').length} need action right now.`:'No urgent extras right now'},
      {title:'Audit Alerts',value:editedTrace.length,copy:mostEdited?`${mostEdited.po} has ${mostEdited.edits} edit(s).`:'No edited POs in current visible data'},
      {title:'Repeat PO Activity',value:multiTouch.length,copy:mostTouched?`${mostTouched.po} has ${mostTouched.touches} touches.`:'No repeated PO activity detected'},
    ];
    exceptionCenter.innerHTML=exceptionCards.map(card=>`<article class="mc-exception-card"><div class="mc-exception-title">${card.title}</div><strong>${card.value}</strong><div class="mc-priority-copy">${card.copy}</div></article>`).join('');
  }

  const timeline=document.getElementById('mcTimelinePulse');
  if(timeline){
    const items=poSummaries
      .filter(item=>item.touches>1 || item.edits>0)
      .sort((a,b)=>(b.edits*100+b.touches)-(a.edits*100+a.touches))
      .slice(0,8);
    timeline.innerHTML=items.length?items.map(item=>`
      <article class="mc-timeline-item">
        <div class="mc-timeline-top"><div class="mc-timeline-title">${item.po}</div><span class="mc-mini-pill">${item.touches} timeline entries</span></div>
        <div class="mc-timeline-copy"><strong>${item.sources.join(' → ')}</strong> • ${item.edits} edit(s) • last by ${item.lastBy}${item.lastAt?` at ${new Date(item.lastAt).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}`:''}</div>
      </article>
    `).join(''):`<div class="mc-empty">No multi-touch or edited POs are standing out in the current visible data.</div>`;
  }

  const urgency=document.getElementById('mcUrgencyRail');
  if(urgency){
    const urgencyItems=[];
    if(assemblyRows.length) urgencyItems.push({title:'Assembly schedule pressure',copy:`${assemblyRows.length} scheduled item(s), ${snap.atRiskCount||0} at risk, ${snap.overdueCount||0} overdue.`,target:'assemblyPage'});
    if(receivingRows.length||prepRows.length||dockRows.length) urgencyItems.push({title:'Inbound movement',copy:`Dock ${dockRows.length} • Receiving ${receivingRows.length} • Prep ${prepRows.length} lines on the most recent visible dates.`,target:'workflowInboundPage'});
    if(lateToday>0 || absentToday>0) urgencyItems.push({title:'People coverage',copy:`${presentToday} present, ${lateToday} late, ${absentToday} absent/call out.`,target:'attendancePage'});
    const upcomingAssemblyDays=[];
    if(typeof getAssemblyDaySummary==='function'){
      for(let i=0;i<5;i++){
        const d=new Date();
        d.setDate(d.getDate()+i);
        const iso=d.toISOString().slice(0,10);
        const summary=getAssemblyDaySummary(iso);
        if(summary && summary.pbCount>0) upcomingAssemblyDays.push({date:iso, pbCount:summary.pbCount, units:summary.units});
      }
    }
    if(upcomingAssemblyDays.length){
      const soon=upcomingAssemblyDays[0];
      urgencyItems.push({title:'Upcoming assembly load',copy:`${soon.date} has ${soon.pbCount} PB(s) and ${Number(soon.units||0).toLocaleString()} units on the board.`,target:'calendarPage'});
    }
    if(!urgencyItems.length) urgencyItems.push({title:'No urgent time pressure found',copy:'Current modules do not show a strong time-sensitive signal.',target:'homePage'});
    urgency.innerHTML=urgencyItems.slice(0,5).map(item=>`<article class="mc-urgency-item"><div class="mc-priority-title">${item.title}</div><div class="mc-urgency-copy">${item.copy}</div><button class="btn secondary" type="button" data-home-jump="${item.target}">Open</button></article>`).join('');
  }

  const recent=document.getElementById('mcRecentChanges');
  if(recent){
    const updates=[];
    const recentPolicies=[...(policyEntryFeed||[])].sort((a,b)=>(safeNum(b.updatedAt||b.createdAt)-safeNum(a.updatedAt||a.createdAt))).slice(0,3);
    recentPolicies.forEach(item=>updates.push({title:`Policy: ${item.title||item.name||'Untitled'}`,copy:`${item.category||'Policy'} • ${safeNum(item.updatedAt||item.createdAt)?new Date(safeNum(item.updatedAt||item.createdAt)).toLocaleString(): 'No timestamp'}`,target:'policyPage'}));
    if(sordImportMeta?.fileNames){
      const f=sordImportMeta.fileNames;
      const label=[f.queue&&`Queue: ${f.queue}`, f.revenue&&`Revenue: ${f.revenue}`, f.eom&&`SORD: ${f.eom}`].filter(Boolean).join(' • ');
      if(label) updates.push({title:'Latest shared imports',copy:label,target:'importHubPage'});
    }
    if(revenueReferenceRows.length) updates.push({title:'Revenue reference loaded',copy:`${revenueReferenceRows.length} revenue row(s) currently available for summaries.`,target:'importHubPage'});
    if(policyDocFeed?.length) updates.push({title:'Policy documents available',copy:`${policyDocFeed.length} supporting document(s) are saved in Policy.`,target:'policyPage'});
    if(activeEmployees.filter(emp=>emp.birthday).length) {
      const upcoming=[...activeEmployees].filter(emp=>emp.birthday).map(emp=>({name:emp.name, date:new Date(emp.birthday+'T00:00:00')})).sort((a,b)=>a.date-b.date)[0];
      if(upcoming) updates.push({title:'Upcoming birthday on file',copy:`${upcoming.name} • ${upcoming.date.toLocaleDateString('en-US',{month:'long',day:'numeric'})}`,target:'attendancePage'});
    }
    if(!updates.length) updates.push({title:'No recent system updates',copy:'Imports and policy changes will appear here as they happen.',target:'importHubPage'});
    recent.innerHTML=updates.slice(0,6).map(item=>`<article class="mc-update-item"><div class="mc-priority-title">${item.title}</div><div class="mc-update-copy">${item.copy}</div><button class="btn secondary" type="button" data-home-jump="${item.target}">Open</button></article>`).join('');
  }

  document.querySelectorAll('[data-home-jump]').forEach(btn=>{
    if(btn.dataset.boundHomeJump==='1') return;
    const handler=()=>{ if(typeof goToPage==='function') goToPage(btn.dataset.homeJump); };
    btn.addEventListener('click',handler);
    if(btn.classList.contains('mc-clickable-card')){
      btn.addEventListener('keydown',(event)=>{ if(event.key==='Enter' || event.key===' '){ event.preventDefault(); handler(); }});
    }
    btn.dataset.boundHomeJump='1';
  });
}



clearErrorForm();
renderAttendanceEmployeeOptions();
renderErrorAssociateOptions();
clearReturnsForm();
bindReturnsEvents();
renderReturns();
restoreActivePage();

// Home Snapshot actions
const printSnapshotBtn=document.getElementById('printSnapshotBtn');
if(printSnapshotBtn){
  printSnapshotBtn.addEventListener('click',()=>{ printHomeSnapshot(); });
}
const exportSnapshotBtn=document.getElementById('exportSnapshotBtn');
if(exportSnapshotBtn){
  exportSnapshotBtn.addEventListener('click',()=>{ exportHomeSnapshotFile(); });
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
  safeRun(() => renderReturns(), 'renderReturns');
  safeRun(() => renderCalendar(), 'renderCalendar');
  safeRun(() => { if(typeof window.renderRevTracker === 'function') window.renderRevTracker(); }, 'renderRevTracker');
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
  safeRun(() => renderReturns(), 'renderReturns');
  safeRun(() => renderCalendar(), 'renderCalendar');
  if (typeof updateDebugStrip === 'function') {
    updateDebugStrip('ok', 'Safe full sync complete', 'updateAllData');
  }
}

window.updateAssemblyData = updateAssemblyData;
window.updateQueueData = updateQueueData;
window.updateAllData = updateAllData;


async function bootstrapWarehouseHub(){
  await Promise.all([loadEmployeesFromBackend(),loadAttendanceFromBackend(),loadAssemblyFromBackend()]);
  renderAttendance();
  renderErrors();
  renderEmployees();
  window.addEventListener('focus',()=>{ loadAttendanceFromBackend().catch(()=>{}); });
  window.addEventListener('pageshow',()=>{ loadAttendanceFromBackend().catch(()=>{}); });
  document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible') loadAttendanceFromBackend().catch(()=>{}); });
  renderCalendar();
  renderAssembly();
  renderQueue();
  renderRevenueReferenceStats();
  renderHome();
  renderReturns();
  // PATCH: Re-render attendance-remix after backend load so it reflects Neon data, not stale localStorage.
  if (typeof window.attendanceRemixRefresh === 'function') window.attendanceRemixRefresh();
  // PATCH: Refresh huddle dashboard after all data is loaded
  if (typeof window.huddleRefresh === 'function') window.huddleRefresh();
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
  if(typeof updateScheduleFinancialImpact==='function') updateScheduleFinancialImpact();
});
scheduleQtyInput.addEventListener('input',()=>{if(typeof updateScheduleFinancialImpact==='function') updateScheduleFinancialImpact();});
scheduleRemainderToggleInput.addEventListener('change',()=>{
  const enabled=scheduleModeInput.value==='partial' && scheduleRemainderToggleInput.value==='true';
  scheduleRemainderDateInput.disabled=!enabled;
  if(!enabled) scheduleRemainderDateInput.value='';
  if(typeof updateScheduleFinancialImpact==='function') updateScheduleFinancialImpact();
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
  if(event.key===calendarEventsStorageKey) calendarEvents=normalizeCalendarEvents(loadJson(calendarEventsStorageKey,[]));
  renderAssembly();
  renderQueue();
  renderCalendar();
  renderRevenueReferenceStats();
  renderHome();
});

// ── Auto-trigger comment badges after every render ────────────────────────
(function() {
  function hookBadges() {
    const origAssembly = window.renderAssembly;
    if (origAssembly && !origAssembly._cbHooked) {
      window.renderAssembly = function(...args) {
        origAssembly.apply(this, args);
        if (typeof window.renderAssemblyCommentBadges === 'function') {
          window.renderAssemblyCommentBadges();
        }
      };
      window.renderAssembly._cbHooked = true;
    }

    const origQueue = window.renderQueue;
    if (origQueue && !origQueue._cbHooked) {
      window.renderQueue = function(...args) {
        origQueue.apply(this, args);
        if (typeof window.renderQueueCommentBadges === 'function') {
          window.renderQueueCommentBadges();
        }
      };
      window.renderQueue._cbHooked = true;
    }
  }
  // Run after all scripts have loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hookBadges);
  } else {
    hookBadges();
  }
  // Also run on a short delay as a safety net for late-loading scripts
  setTimeout(hookBadges, 500);
})();
