(function(){
  const DAILY_KEY = 'ops_hub_productivity_daily_v2';
  const LABOR_KEY = 'ops_hub_productivity_labor_v1';
  const SETTINGS_KEY = 'ops_hub_productivity_settings_v1';
  const IMPORT_BATCHES_KEY = 'ops_hub_productivity_import_batches_v1';
  const PENDING_IMPORT_KEY = 'ops_hub_productivity_pending_import_v1';
  const VIEW_KEY = 'ops_hub_productivity_view_v1';
  const EMPLOYEES_KEY = 'ops_hub_employees_v1';
  const ATTENDANCE_KEYS = ['ops_hub_attendance_records_v2','ops_hub_attendance_records_v1'];
  const WORKFLOW_KEY = 'qaV5SeparatedWorkflowData_v4fixed';
  const ASSEMBLY_KEY = 'ops_hub_assembly_board_v2';
  const PRODUCTIVITY_API_BASE = '/.netlify/functions/productivity-sync';

  const DEFAULT_SHOW_SENSITIVE_FINANCIALS = false;
  const FINANCE_UNLOCK_CODE = '2025';

  const defaultSettings = {
    qaRate: 20,
    prepRate: 20,
    assemblyRate: 20,
    putawayRate: 20,
    shippingRate: 20,
    inventoryRate: 20,
    otMultiplier: 1.5
  };

  let productivitySyncEnabled = false;
  let productivitySyncLoaded = false;
  let productivitySyncInFlight = false;
  let productivitySyncQueued = false;
  let productivitySyncTimer = null;
  let productivitySyncRequestId = 0;
  let productivityMutationVersion = 0;
  let productivityStatusTimer = null;

  const savedView = load(VIEW_KEY, {});
  const initialWeek = getWeekStart(savedView.selectedWeek || isoToday());
  const state = {
    activeTab: savedView.activeTab || 'week',
    activeDept: savedView.activeDept || 'qa-receiving',
    selectedWeek: initialWeek,
    selectedDate: text(savedView.selectedDate || '').slice(0,10) || getWeekDays(initialWeek)[0] || isoToday(),
    selectedMonth: text(savedView.selectedMonth || '').slice(0,7) || new Date().toISOString().slice(0,7),
    // PATCH: Start empty — backend load in loadProductivityFromBackend() is the authoritative source.
    // localStorage is only used as a fallback when Neon is unreachable.
    dailyRecords: [],
    laborEntries: [],
    importBatches: [],
    pendingImport: load(PENDING_IMPORT_KEY, null),
    financeUnlocked: false,
    settings: { ...defaultSettings, ...load(SETTINGS_KEY, {}) }
  };

  const root = document.getElementById('productivityModuleRoot');
  if(!root) return;

  function load(key, fallback){
    try{
      if(typeof loadJson === 'function') return loadJson(key, fallback);
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    }catch(_){ return fallback; }
  }
  function save(key, value){
    if(typeof saveJson === 'function') saveJson(key, value);
    else localStorage.setItem(key, JSON.stringify(value));
  }
  function n(v){ const num = Number(v); return Number.isFinite(num) ? num : 0; }
  function text(v){ return v == null ? '' : String(v); }
  function div(a,b){ return b ? a / b : 0; }
  function round(v,p=2){ const m = Math.pow(10,p); return Math.round((n(v)+Number.EPSILON)*m)/m; }
  function fmt(v,p=2){ return round(v,p).toLocaleString(undefined,{minimumFractionDigits:p,maximumFractionDigits:p}); }
  function fmtNum(v){ return n(v).toLocaleString(); }
  function money(v){ return n(v).toLocaleString(undefined,{style:'currency',currency:'USD',maximumFractionDigits:2}); }
  function financeVisible(){ return DEFAULT_SHOW_SENSITIVE_FINANCIALS === true || state.financeUnlocked === true; }
  function escapeHtml(str){ return text(str).replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }
  function isoToday(){ return new Date().toISOString().slice(0,10); }
  function monthFromDate(value){ return text(value).slice(0,7); }
  function uid(prefix='id'){ return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2,8)}`; }
  function uuid(){
    try{ if(globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID(); }catch(_){ }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random()*16|0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }
  function dateLabel(value){ if(!value) return '—'; const d = new Date(value+'T00:00:00'); return d.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}); }
  function monthLabel(value){ if(!value) return '—'; const [y,m]=value.split('-'); return new Date(Number(y), Number(m)-1, 1).toLocaleString(undefined,{month:'long', year:'numeric'}); }
  function getWeekStart(dateStr){ const d = new Date((dateStr||isoToday())+'T00:00:00'); const day=d.getDay(); const diff=(day+6)%7; d.setDate(d.getDate()-diff); return d.toISOString().slice(0,10); }
  function getWeekEnd(weekStart){ const d = new Date(weekStart+'T00:00:00'); d.setDate(d.getDate()+6); return d.toISOString().slice(0,10); }
  function getWeekDays(weekStart){ return Array.from({length:5}, (_,i)=>{ const d = new Date(weekStart+'T00:00:00'); d.setDate(d.getDate()+i); return d.toISOString().slice(0,10); }); }
  function safeArray(v){ return Array.isArray(v) ? v : []; }

  function readAttendanceRows(){
    for(const key of ATTENDANCE_KEYS){
      const rows = load(key, null);
      if(Array.isArray(rows) && rows.length) return rows;
    }
    return [];
  }
  function readWorkflowData(){
    return load(WORKFLOW_KEY, {});
  }
  function readAssemblyRows(){
    return load(ASSEMBLY_KEY, []);
  }
  function getEmployees(){
    const rows = load(EMPLOYEES_KEY, []);
    return safeArray(rows).map(row => ({
      name: text(row.name || row.employeeName),
      adpName: text(row.adpName || ''),
      department: text(row.department || row.defaultDepartment || row.homeDepartment)
    })).filter(r => r.name);
  }

  function saveEmployees(rows){
    save(EMPLOYEES_KEY, safeArray(rows));
  }

  function similarityScore(rawName, employee){
    const rawNorm = normalizeName(rawName);
    const displayNorm = normalizeName(employee?.name || '');
    const adpNorm = normalizeName(employee?.adpName || '');
    if(!rawNorm) return 0;
    if(rawNorm && (rawNorm === displayNorm || rawNorm === adpNorm)) return 100;
    const rawParts = new Set(rawNorm.split(' ').filter(Boolean));
    const displayParts = new Set(displayNorm.split(' ').filter(Boolean));
    const adpParts = new Set(adpNorm.split(' ').filter(Boolean));
    let score = 0;
    rawParts.forEach(part => {
      if(displayParts.has(part)) score += 3;
      if(adpParts.has(part)) score += 2;
    });
    const inverted = invertLastFirst(rawName);
    if(inverted && inverted === displayNorm) score += 6;
    if(inverted && inverted === adpNorm) score += 4;
    const firstPart = [...rawParts][0] || '';
    if(firstPart && displayNorm.startsWith(firstPart)) score += 1;
    return score;
  }

  function getEmployeeOptionsForAdpName(rawName){
    return getEmployees()
      .map(emp => ({ ...emp, score: similarityScore(rawName, emp) }))
      .sort((a,b)=> (b.score - a.score) || String(a.name).localeCompare(String(b.name)));
  }

  function rebuildPendingImportMatches(){
    const pending = state.pendingImport;
    if(!pending?.employeeRows?.length) return;
    const employeeLookup = buildEmployeeMatchMap();
    const unmatchedMap = new Map();
    pending.employeeRows = pending.employeeRows.map(row => {
      const rawName = text(row.adpRawName || row.employeeName).trim();
      const resolved = resolveAdpName(rawName, employeeLookup);
      const displayName = resolved ? resolved.employee.name : rawName;
      const department = resolved ? (resolved.employee.department || row.homeDepartment || '') : (row.homeDepartment || '');
      if(!resolved) unmatchedMap.set(rawName, (unmatchedMap.get(rawName) || 0) + 1);
      return {
        ...row,
        employeeName: displayName,
        matched: !!resolved,
        homeDepartment: department,
        workedDepartment: department || row.workedDepartment || ''
      };
    });
    pending.unmatchedNames = [...unmatchedMap.entries()].map(([name, count]) => ({ name, count }));
    pending.daySummaries = buildPendingImportSummary(pending.employeeRows, pending.fileName);
  }

  function refreshAdpMatchingUi(){
    rebuildPendingImportMatches();
    render();
  }

  function saveAdpNameMatch(rawAdpName, employeeName){
    const rawName = text(rawAdpName).trim();
    const targetName = text(employeeName).trim();
    if(!rawName || !targetName){
      alert('Pick an employee before saving the match.');
      return;
    }
    const rows = load(EMPLOYEES_KEY, []);
    const idx = safeArray(rows).findIndex(row => text(row.name || row.employeeName).trim() === targetName);
    if(idx < 0){
      alert('That employee record could not be found.');
      return;
    }
    const existingAdpName = text(rows[idx].adpName || '').trim();
    if(existingAdpName && normalizeName(existingAdpName) !== normalizeName(rawName)){
      const ok = window.confirm(`${targetName} already has an ADP Name saved as "${existingAdpName}". Overwrite it with "${rawName}"?`);
      if(!ok) return;
    }
    rows[idx] = { ...rows[idx], adpName: rawName };
    saveEmployees(rows);
    refreshAdpMatchingUi();
  }

  function addNewEmployeeFromAdpName(rawAdpName){
    const rawName = text(rawAdpName).trim();
    if(!rawName){
      alert('That ADP name is blank.');
      return;
    }
    const rows = load(EMPLOYEES_KEY, []);
    const existing = safeArray(rows).find(row => normalizeName(text(row.name || row.employeeName)) === normalizeName(rawName));
    if(existing){
      const ok = window.confirm(`${rawName} is already on your employee list. Save it as this person's ADP Name too?`);
      if(!ok) return;
      existing.adpName = rawName;
      saveEmployees(rows);
      refreshAdpMatchingUi();
      return;
    }
    rows.push({
      name: rawName,
      adpName: rawName,
      department: '',
      birthday: '',
      size: '',
      active: true
    });
    saveEmployees(rows);
    refreshAdpMatchingUi();
  }

  function replaceEmployeeDisplayNameWithAdp(rawAdpName, employeeName){
    const rawName = text(rawAdpName).trim();
    const targetName = text(employeeName).trim();
    if(!rawName || !targetName){
      alert('Pick an employee first.');
      return;
    }
    const rows = load(EMPLOYEES_KEY, []);
    const idx = safeArray(rows).findIndex(row => text(row.name || row.employeeName).trim() === targetName);
    if(idx < 0){
      alert('That employee record could not be found.');
      return;
    }
    const duplicate = safeArray(rows).find((row, rowIdx) => rowIdx !== idx && normalizeName(text(row.name || row.employeeName)) === normalizeName(rawName));
    if(duplicate){
      alert(`Another employee is already using the name "${rawName}".`);
      return;
    }
    const ok = window.confirm(`Replace "${targetName}" on your employee list with "${rawName}"? This will also save "${rawName}" as the ADP Name.`);
    if(!ok) return;
    rows[idx] = { ...rows[idx], name: rawName, adpName: rawName };
    saveEmployees(rows);
    refreshAdpMatchingUi();
  }


  function parseCsvLine(line){
    const out=[];
    let cur='';
    let inQuotes=false;
    for(let i=0;i<line.length;i++){
      const ch=line[i];
      if(ch==='"'){
        if(inQuotes && line[i+1]==='"'){ cur+='"'; i++; }
        else inQuotes=!inQuotes;
      }else if(ch===',' && !inQuotes){
        out.push(cur);
        cur='';
      }else{
        cur+=ch;
      }
    }
    out.push(cur);
    return out;
  }

  function parseCsv(textBlob){
    const cleaned = String(textBlob || '').replace(/^\uFEFF/, '').replaceAll('\r\n', '\n').replaceAll('\r', '\n');
    const lines = cleaned.split('\n').filter(Boolean);
    if(!lines.length) return [];
    const headers = parseCsvLine(lines[0]).map(h => text(h).trim());
    return lines.slice(1).map(line => {
      const cells = parseCsvLine(line);
      const row = {};
      headers.forEach((header, idx) => { row[header] = cells[idx] ?? ''; });
      return row;
    });
  }

  function normalizeName(value){
    return text(value).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  }

  function parseAdpDate(value){
    const raw = text(value).trim();
    if(!raw) return '';
    const datePart = raw.split(' ')[0];
    const m = datePart.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if(m) return `${m[3]}-${m[1]}-${m[2]}`;
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0,10);
  }

  function inferRateForDepartment(department){
    const key = normalizeName(department);
    if(['qa receiving','receiving'].includes(key)) return n(state.settings.qaRate);
    if(['qa prep','prep','prepping'].includes(key)) return n(state.settings.prepRate);
    if(key === 'assembly') return n(state.settings.assemblyRate);
    if(['putaway','inbound hazel','outbound hazel'].includes(key)) return n(state.settings.putawayRate);
    if(['fulfillment','bulk','individuals','individual','fulfillment bulk','fulfillment individuals'].includes(key)) return n(state.settings.shippingRate);
    if(key === 'inventory') return n(state.settings.inventoryRate || state.settings.putawayRate);
    return n(state.settings.shippingRate || state.settings.qaRate || 0);
  }

  // Convert "Last, First" → "first last" for normalized comparison.
  function invertLastFirst(value){
    const s = text(value).trim();
    const m = s.match(/^([^,]+),\s*(.+)$/);
    if(m) return normalizeName(`${m[2]} ${m[1]}`);
    return normalizeName(s);
  }

  function buildEmployeeMatchMap(){
    const map = new Map();
    getEmployees().forEach(emp => {
      // Priority 1: explicit adpName (exact normalized match)
      if(emp.adpName){
        const adpKey = normalizeName(emp.adpName);
        if(adpKey && !map.has(adpKey)) map.set(adpKey, emp);
        // also index the Last,First→First Last inversion of adpName
        const adpInverted = invertLastFirst(emp.adpName);
        if(adpInverted && adpInverted !== adpKey && !map.has(adpInverted)) map.set(adpInverted, emp);
      }
      // Priority 2: display name (normalized full name)
      const full = normalizeName(emp.name);
      if(full && !map.has(full)) map.set(full, emp);
      // Priority 3: first name only (weakest — only as final fallback)
      const first = normalizeName(text(emp.name).split(/\s+/)[0]);
      if(first && !map.has(first)) map.set(first, emp);
    });
    return map;
  }

  // Resolve a raw ADP name string to the matching employee, or null.
  // rawAdpName may be "Last, First" or "First Last".
  // Returns { employee, matchedBy } or null.
  function resolveAdpName(rawAdpName, employeeMatchMap){
    if(!rawAdpName) return null;
    const normalized = normalizeName(rawAdpName);
    const inverted   = invertLastFirst(rawAdpName);
    // Try normalized form first, then Last,First inverted
    const emp = employeeMatchMap.get(normalized) || employeeMatchMap.get(inverted) || null;
    return emp ? { employee: emp, matchedBy: normalized } : null;
  }

  function summarizeAdpCsvRows(rows){
    const employeeLookup = buildEmployeeMatchMap();
    const grouped = new Map();
    const unmatchedNames = new Map(); // rawName → count
    safeArray(rows).forEach(row => {
      const firstName = text(row['First Name']);
      const lastName = text(row['Last Name']);
      const rawName = [firstName, lastName].filter(Boolean).join(' ').trim() || firstName || lastName;
      if(!rawName) return;
      const date = parseAdpDate(row['Pay Date']);
      if(!date) return;

      const resolved = resolveAdpName(rawName, employeeLookup);
      const displayName = resolved ? resolved.employee.name : rawName;
      const department  = resolved ? resolved.employee.department : '';
      if(!resolved){
        unmatchedNames.set(rawName, (unmatchedNames.get(rawName) || 0) + 1);
      }

      const weekStart = getWeekStart(date);
      const bucketKey = `${date}__${normalizeName(displayName)}`;
      if(!grouped.has(bucketKey)) grouped.set(bucketKey, {
        date,
        weekStart,
        employeeName: displayName,
        adpRawName: rawName,
        matched: !!resolved,
        homeDepartment: department,
        workedDepartment: department,
        regularHours: 0,
        ptoHours: 0,
        otHours: 0,
        importDates: new Set(),
        codes: new Set()
      });
      const bucket = grouped.get(bucketKey);
      bucket.importDates.add(date);
      const code = normalizeName(row['Payroll Earnings'] || row['Pay Code'] || row['Pay Code.1']);
      const workedType = normalizeName(row['Worked Type']);
      if(code) bucket.codes.add(code.toUpperCase());
      const actualHours = n(row['Actual Hours (rounded)']);
      const payrollHours = n(row['Payroll Hours']);
      const hours = actualHours || payrollHours;
      if(!hours) return;
      const isOt = /(^|\s)ot(\s|$)|overtime/.test(code);
      const isLeave = /pto|sick|vac|holiday|bereav|jury|absent/.test(code) || (workedType.includes('non worked') && !isOt);
      if(isOt) bucket.otHours += hours;
      else if(isLeave) bucket.ptoHours += hours;
      else bucket.regularHours += hours;
    });
    const employeeRows = [...grouped.values()].map(row => ({
      ...row,
      regularHours: round(row.regularHours),
      ptoHours: round(row.ptoHours),
      otHours: round(row.otHours),
      importDates: [...row.importDates].sort(),
      codes: [...row.codes]
    })).sort((a,b)=> String(a.date).localeCompare(String(b.date)) || String(a.employeeName).localeCompare(String(b.employeeName)));
    return {
      employeeRows,
      unmatchedNames: [...unmatchedNames.entries()].map(([name, count]) => ({ name, count }))
    };
  }

  function getDeptHoursBucket(department){
    const key = normalizeName(department);
    if(['qa receiving','receiving'].includes(key)) return 'qa';
    if(['qa prep','prep','prepping'].includes(key)) return 'prep';
    if(key === 'assembly') return 'assembly';
    if(key === 'inventory') return 'inventory';
    if(['putaway','inbound hazel','outbound hazel'].includes(key)) return 'putaway';
    if(['fulfillment bulk','bulk'].includes(key)) return 'fulfillmentBulk';
    if(['fulfillment individuals','individuals','individual','fulfillment'].includes(key)) return 'fulfillmentIndividual';
    return '';
  }

  function buildPendingImportSummary(employeeRows, fileName){
    const byDate = new Map();
    employeeRows.forEach(row => {
      const key = row.date;
      if(!byDate.has(key)) byDate.set(key, {
        date: row.date,
        weekStart: row.weekStart,
        fileName,
        employeeCount: 0,
        hours: 0,
        payouts: 0,
        qaHours: 0,
        prepHours: 0,
        assemblyHours: 0,
        inventoryHours: 0,
        putawayHours: 0,
        fulfillmentIndividualHours: 0,
        fulfillmentBulkHours: 0
      });
      const bucket = byDate.get(key);
      bucket.employeeCount += 1;
      const totalHours = n(row.regularHours) + n(row.ptoHours) + n(row.otHours);
      const payout = computeLabor({ ...row, hourlyRate: n(row.hourlyRate) }).payout;
      bucket.hours += totalHours;
      bucket.payouts += payout;
      const deptBucket = getDeptHoursBucket(row.workedDepartment || row.homeDepartment);
      if(deptBucket === 'qa') bucket.qaHours += totalHours;
      else if(deptBucket === 'prep') bucket.prepHours += totalHours;
      else if(deptBucket === 'assembly') bucket.assemblyHours += totalHours;
      else if(deptBucket === 'inventory') bucket.inventoryHours += totalHours;
      else if(deptBucket === 'putaway') bucket.putawayHours += totalHours;
      else if(deptBucket === 'fulfillmentIndividual') bucket.fulfillmentIndividualHours += totalHours;
      else if(deptBucket === 'fulfillmentBulk') bucket.fulfillmentBulkHours += totalHours;
    });
    return [...byDate.values()].sort((a,b)=> String(a.date).localeCompare(String(b.date))).map(day => ({
      ...day,
      hours: round(day.hours),
      payouts: round(day.payouts),
      qaHours: round(day.qaHours),
      prepHours: round(day.prepHours),
      assemblyHours: round(day.assemblyHours),
      inventoryHours: round(day.inventoryHours),
      putawayHours: round(day.putawayHours),
      fulfillmentIndividualHours: round(day.fulfillmentIndividualHours),
      fulfillmentBulkHours: round(day.fulfillmentBulkHours)
    }));
  }

  function recomputeImportedHoursForDate(dateStr){
    const imported = state.laborEntries.filter(entry => entry.sourceKind === 'adp' && text(entry.date) === dateStr).map(computeLabor);
    const totals = imported.reduce((acc, row) => {
      const workedHours = n(row.regularHours) + n(row.otHours);
      const ptoHours = n(row.ptoHours);
      const totalPayout = n(row.payout);
      const ptoPayout = round(ptoHours * n(row.hourlyRate));
      const bucket = getDeptHoursBucket(row.workedDepartment || row.homeDepartment);
      if(bucket === 'qa'){
        acc.qaHoursWorked += workedHours;
        acc.qaPtoHours += ptoHours;
        acc.qaPayout += totalPayout;
        acc.qaPtoPayout += ptoPayout;
      }
      else if(bucket === 'prep'){
        acc.prepHoursWorked += workedHours;
        acc.prepPtoHours += ptoHours;
        acc.prepPayout += totalPayout;
        acc.prepPtoPayout += ptoPayout;
      }
      else if(bucket === 'assembly'){
        acc.assemblyHoursWorked += workedHours;
        acc.assemblyPtoHours += ptoHours;
        acc.assemblyPayout += totalPayout;
        acc.assemblyPtoPayout += ptoPayout;
      }
      else if(bucket === 'inventory'){
        acc.inventoryHoursWorked += workedHours;
        acc.inventoryPtoHours += ptoHours;
        acc.inventoryPayout += totalPayout;
        acc.inventoryPtoPayout += ptoPayout;
      }
      else if(bucket === 'putaway'){
        acc.putawayHoursWorked += workedHours;
        acc.putawayPtoHours += ptoHours;
        acc.putawayPayout += totalPayout;
        acc.putawayPtoPayout += ptoPayout;
      }
      else if(bucket === 'fulfillmentIndividual'){
        acc.fulfillmentIndividualHoursWorked += workedHours;
        acc.fulfillmentIndividualPtoHours += ptoHours;
        acc.fulfillmentIndividualPayout += totalPayout;
        acc.fulfillmentIndividualPtoPayout += ptoPayout;
      }
      else if(bucket === 'fulfillmentBulk'){
        acc.fulfillmentBulkHoursWorked += workedHours;
        acc.fulfillmentBulkPtoHours += ptoHours;
        acc.fulfillmentBulkPayout += totalPayout;
        acc.fulfillmentBulkPtoPayout += ptoPayout;
      }
      return acc;
    }, {
      qaHoursWorked: 0, qaPtoHours: 0, qaPayout: 0, qaPtoPayout: 0,
      prepHoursWorked: 0, prepPtoHours: 0, prepPayout: 0, prepPtoPayout: 0,
      assemblyHoursWorked: 0, assemblyPtoHours: 0, assemblyPayout: 0, assemblyPtoPayout: 0,
      inventoryHoursWorked: 0, inventoryPtoHours: 0, inventoryPayout: 0, inventoryPtoPayout: 0,
      putawayHoursWorked: 0, putawayPtoHours: 0, putawayPayout: 0, putawayPtoPayout: 0,
      fulfillmentIndividualHoursWorked: 0, fulfillmentIndividualPtoHours: 0, fulfillmentIndividualPayout: 0, fulfillmentIndividualPtoPayout: 0,
      fulfillmentBulkHoursWorked: 0, fulfillmentBulkPtoHours: 0, fulfillmentBulkPayout: 0, fulfillmentBulkPtoPayout: 0
    });
    const record = getRecord(dateStr);
    Object.entries(totals).forEach(([key, value]) => {
      record[key] = round(value);
    });
    record.lastAdpHoursSyncAt = imported.length ? new Date().toISOString() : '';
    return totals;
  }

  function normalizeDeptName(v){
    const s = text(v).trim().toLowerCase();
    if(['receiving','qa receiving'].includes(s)) return 'qa-receiving';
    if(['prepping','prep','qa prep'].includes(s)) return 'qa-prep';
    if(['assembly'].includes(s)) return 'assembly';
    if(['inventory'].includes(s)) return 'inventory';
    if(['fulfillment','bulk','individuals','individual','fulfillment bulk','fulfillment individuals'].includes(s)) return 'fulfillment';
    if(['putaway','outbound hazel','inbound hazel'].includes(s)) return 'putaway';
    return s;
  }

  function getAttendanceCountForDate(dateStr, aliases){
    const marksToExclude = new Set(['Absent','Call Out','No Call No Show','LOA']);
    return readAttendanceRows().filter(row => text(row.date) === dateStr)
      .filter(row => aliases.includes(normalizeDeptName(row.department)))
      .filter(row => !marksToExclude.has(text(row.mark || row.status || row.attendance)))
      .length;
  }

  function flattenWorkflowSections(sections, label){
    const out = [];
    safeArray(sections).forEach(section => {
      safeArray(section.rows).forEach(row => {
        out.push({
          source: label,
          date: text(section.date),
          associate: text(section.name),
          location: text(section.location),
          po: text(row.po),
          ordered: n(row.orderedQty || row.qty),
          received: n(row.receivedQty || row.qty),
          extras: n(row.extras),
          notes: text(row.notes)
        });
      });
    });
    return out;
  }

  function palletTouchedOnDate(pallet, dateStr){
    const created = text(new Date(n(pallet.createdAt || 0)).toISOString?.() || '').slice(0,10);
    const updated = text(new Date(n(pallet.updatedAt || 0)).toISOString?.() || '').slice(0,10);
    if(created === dateStr || updated === dateStr) return true;
    return safeArray(pallet.events).some(evt => text(new Date(n(evt.ts || 0)).toISOString?.() || '').slice(0,10) === dateStr);
  }

  function getPalletWorkflowMetrics(dateStr){
    const workflow = readWorkflowData();
    const pallets = safeArray(workflow.pallets);
    let receivingUnits = 0;
    let prepUnits = 0;
    let putawayUnits = 0;
    let receivingPOs = 0;
    let prepPOs = 0;
    let putawayCount = 0;

    pallets.forEach(pallet => {
      if(!palletTouchedOnDate(pallet, dateStr)) return;
      safeArray(pallet.pos).forEach(po => {
        const poId = text(po.po || po.id);
        if(text(po.receivingDone).toLowerCase() === 'true' || po.receivingDone === true || n(po.receivedQty) > 0){
          receivingUnits += n(po.receivedQty);
          if(poId) receivingPOs += 1;
        }
        if(text(po.prepVerified).toLowerCase() === 'true' || po.prepVerified === true || n(po.prepReceivedQty) > 0){
          prepUnits += n(po.prepReceivedQty);
          if(poId) prepPOs += 1;
        }
        const routedQty = n(po.stsQty) + n(po.ltsQty);
        if(routedQty > 0){
          putawayUnits += routedQty;
          putawayCount += 1;
        }
      });
    });

    return { receivingUnits, receivingPOs, prepUnits, prepPOs, putawayCount, putawayUnits };
  }

  function getWorkflowMetrics(dateStr){
    const palletMetrics = getPalletWorkflowMetrics(dateStr);
    const workflow = readWorkflowData();
    const receivingRows = flattenWorkflowSections(workflow.receivingSections, 'Receiving').filter(r => r.date === dateStr);
    const prepRows = flattenWorkflowSections(workflow.prepSections, 'Prep').filter(r => r.date === dateStr);
    const putawayRows = safeArray(workflow.putawayEntries).filter(r => text(r.date) === dateStr);
    const receivingUnits = palletMetrics.receivingUnits || receivingRows.reduce((s,r)=>s+n(r.received),0);
    const prepUnits = palletMetrics.prepUnits || prepRows.reduce((s,r)=>s+n(r.received),0);
    const putawayCount = palletMetrics.putawayCount || putawayRows.length;
    const receivingPOs = palletMetrics.receivingPOs || new Set(receivingRows.map(r=>text(r.po)).filter(Boolean)).size;
    const prepPOs = palletMetrics.prepPOs || new Set(prepRows.map(r=>text(r.po)).filter(Boolean)).size;
    const putawayUnits = palletMetrics.putawayUnits || safeArray(putawayRows).reduce((s,r)=>s+n(r.quantity || r.qty || 0),0);
    return { receivingUnits, receivingPOs, prepUnits, prepPOs, putawayCount, putawayUnits };
  }

  function getAssemblyMetrics(dateStr){
    const rows = safeArray(readAssemblyRows()).filter(r => text(r.date) === dateStr);
    const doneRows = rows.filter(r => text(r.stage).toLowerCase() === 'done');
    const units = doneRows.reduce((s,r)=>s+(n(r.qty)*n(r.products)),0);
    const packs = doneRows.reduce((s,r)=>s+n(r.qty),0);
    return { units, packs, scheduledRows: rows.length, doneRows: doneRows.length };
  }

  function getRecord(dateStr){
    let found = state.dailyRecords.find(r => text(r.date) === dateStr);
    if(!found){
      found = { id: uid('prod'), date: dateStr };
      state.dailyRecords.push(found);
      state.dailyRecords.sort((a,b)=> String(b.date).localeCompare(String(a.date)));
      persist(`Created Productivity record for ${dateLabel(dateStr)}. Syncing…`);
    }
    return found;
  }

  function computeDaily(record){
    const auto = getSavedAutoSnapshot(record) || getAutoMetrics(record.date);
    const qaUnits = n(auto.qaActualUnits);
    const qaHours = n(record.qaHoursWorked);
    const prepUnits = n(auto.prepUnits);
    const prepApprovedUnits = record.prepApprovedManual ? n(record.prepApprovedUnits) : prepUnits;
    const prepHours = n(record.prepHoursWorked);
    const assemblyUnits = n(auto.assemblyUnits);
    const assemblyHours = n(record.assemblyHoursWorked);
    const putawayUnits = n(auto.putawayUnits || record.putawayUnits);
    const putawayHours = n(record.putawayHoursWorked);
    const shippingUnits = n(record.fulfillmentIndividualUnits) + n(record.fulfillmentBulkUnits);
    const shippingHours = n(record.fulfillmentIndividualHoursWorked) + n(record.fulfillmentBulkHoursWorked);
    const inventoryHours = n(record.inventoryHoursWorked);
    const totalTouchedUnits = qaUnits + prepApprovedUnits + assemblyUnits + shippingUnits;
    const totalHoursUsed = qaHours + prepHours + assemblyHours + putawayHours + shippingHours + inventoryHours;
    const totalLaborCost =
      qaHours * n(state.settings.qaRate) +
      prepHours * n(state.settings.prepRate) +
      assemblyHours * n(state.settings.assemblyRate) +
      putawayHours * n(state.settings.putawayRate) +
      shippingHours * n(state.settings.shippingRate) +
      inventoryHours * n(state.settings.inventoryRate);
    return {
      ...record,
      qaActualUnits: qaUnits,
      qaActualPOs: n(auto.qaActualPOs),
      qaAttendance: n(auto.qaAttendance),
      prepUnits,
      prepPOs: n(auto.prepPOs),
      prepAttendance: n(auto.prepAttendance),
      prepApprovedUnits,
      assemblyUnits,
      assemblyPacks: n(auto.assemblyPacks),
      assemblyAttendance: n(auto.assemblyAttendance),
      qaUph: round(div(qaUnits, qaHours)),
      prepUph: round(div(prepApprovedUnits, prepHours)),
      assemblyUph: round(div(assemblyUnits, assemblyHours)),
      shippingUph: round(div(shippingUnits, shippingHours)),
      totalTouchedUnits: round(totalTouchedUnits),
      totalHoursUsed: round(totalHoursUsed),
      totalLaborCost: round(totalLaborCost),
      cpuTouched: round(div(totalLaborCost, totalTouchedUnits),4)
    };
  }

  function getAutoMetrics(dateStr){
    const workflow = getWorkflowMetrics(dateStr);
    const assembly = getAssemblyMetrics(dateStr);
    return {
      qaActualUnits: workflow.receivingUnits,
      qaActualPOs: workflow.receivingPOs,
      qaAttendance: getAttendanceCountForDate(dateStr, ['qa-receiving']),
      prepUnits: workflow.prepUnits,
      prepPOs: workflow.prepPOs,
      prepAttendance: getAttendanceCountForDate(dateStr, ['qa-prep']),
      assemblyUnits: assembly.units,
      assemblyPacks: assembly.packs,
      assemblyAttendance: getAttendanceCountForDate(dateStr, ['assembly']),
      assemblyScheduledRows: assembly.scheduledRows,
      putawayLineCount: workflow.putawayCount,
      putawayUnits: workflow.putawayUnits
    };
  }

  function buildAutoSnapshot(dateStr, autoMetrics){
    const auto = autoMetrics || getAutoMetrics(dateStr);
    return {
      date: text(dateStr),
      qaActualUnits: n(auto.qaActualUnits),
      qaActualPOs: n(auto.qaActualPOs),
      qaAttendance: n(auto.qaAttendance),
      prepUnits: n(auto.prepUnits),
      prepPOs: n(auto.prepPOs),
      prepAttendance: n(auto.prepAttendance),
      assemblyUnits: n(auto.assemblyUnits),
      assemblyPacks: n(auto.assemblyPacks),
      assemblyAttendance: n(auto.assemblyAttendance),
      assemblyScheduledRows: n(auto.assemblyScheduledRows),
      putawayLineCount: n(auto.putawayLineCount),
      putawayUnits: n(auto.putawayUnits),
      capturedAt: new Date().toISOString()
    };
  }

  function snapshotsEqual(a, b){
    if(!a || !b) return false;
    return text(a.date) === text(b.date)
      && n(a.qaActualUnits) === n(b.qaActualUnits)
      && n(a.qaActualPOs) === n(b.qaActualPOs)
      && n(a.qaAttendance) === n(b.qaAttendance)
      && n(a.prepUnits) === n(b.prepUnits)
      && n(a.prepPOs) === n(b.prepPOs)
      && n(a.prepAttendance) === n(b.prepAttendance)
      && n(a.assemblyUnits) === n(b.assemblyUnits)
      && n(a.assemblyPacks) === n(b.assemblyPacks)
      && n(a.assemblyAttendance) === n(b.assemblyAttendance)
      && n(a.assemblyScheduledRows) === n(b.assemblyScheduledRows)
      && n(a.putawayLineCount) === n(b.putawayLineCount)
      && n(a.putawayUnits) === n(b.putawayUnits);
  }

  function getSavedAutoSnapshot(record){
    const snapshot = record && typeof record.savedSnapshot === 'object' ? record.savedSnapshot : null;
    if(!snapshot || !text(snapshot.date || record?.date)) return null;
    return {
      ...snapshot,
      date: text(snapshot.date || record.date)
    };
  }

  function snapshotHasMeaningfulAutoData(snapshot){
    if(!snapshot) return false;
    return n(snapshot.qaActualUnits)
      || n(snapshot.qaActualPOs)
      || n(snapshot.qaAttendance)
      || n(snapshot.prepUnits)
      || n(snapshot.prepPOs)
      || n(snapshot.prepAttendance)
      || n(snapshot.assemblyUnits)
      || n(snapshot.assemblyPacks)
      || n(snapshot.assemblyAttendance)
      || n(snapshot.assemblyScheduledRows)
      || n(snapshot.putawayLineCount)
      || n(snapshot.putawayUnits);
  }

  function refreshDailyRecordSnapshot(record){
    if(!record || !text(record.date)) return false;
    const nextSnapshot = buildAutoSnapshot(record.date);
    const previousSnapshot = getSavedAutoSnapshot(record);
    const nextHasData = snapshotHasMeaningfulAutoData(nextSnapshot);
    const previousHasData = snapshotHasMeaningfulAutoData(previousSnapshot);
    if(previousHasData && !nextHasData) return false;
    if(snapshotsEqual(previousSnapshot, nextSnapshot)) return false;
    record.savedSnapshot = nextSnapshot;
    return true;
  }

  function refreshAllDailyRecordSnapshots(){
    let changed = 0;
    state.dailyRecords.forEach(record => {
      if(refreshDailyRecordSnapshot(record)) changed += 1;
    });
    return changed;
  }

  function setProductivityStatus(message='', type='info', options={}){
    state.syncStatus = { type, message: text(message) };
    if(productivityStatusTimer) clearTimeout(productivityStatusTimer);
    if(options.clearAfter){
      productivityStatusTimer = setTimeout(()=>{
        productivityStatusTimer = null;
        if(state.syncStatus?.message === message) state.syncStatus = { type: 'idle', message: '' };
        try{ render(); }catch(_){ }
      }, options.clearAfter);
    }
  }

  function markProductivityDirty(message='Changes saved locally. Syncing…'){
    productivityMutationVersion += 1;
    setProductivityStatus(message, productivitySyncEnabled ? 'saving' : 'local');
  }

  function productivityStatusMarkup(){
    const status = state.syncStatus || {};
    if(!status.message) return '';
    return `<div class="productivity-sync-banner ${escapeHtml(status.type || 'info')}"><span>${escapeHtml(status.message)}</span></div>`;
  }

  function computeLabor(entry){
    const regularHours = n(entry.regularHours);
    const ptoHours = n(entry.ptoHours);
    const otHours = n(entry.otHours);
    const rate = n(entry.hourlyRate);
    const payout = (regularHours * rate) + (ptoHours * rate) + (otHours * rate * n(state.settings.otMultiplier || 1.5));
    return { ...entry, payout: round(payout) };
  }

  function scheduleProductivitySync(){
    if(!productivitySyncEnabled || !productivitySyncLoaded) return;
    if(productivitySyncTimer) clearTimeout(productivitySyncTimer);
    productivitySyncTimer = setTimeout(()=>{ productivitySyncTimer = null; syncProductivityState(); }, 250);
  }

  async function productivityApiRequest(method='GET', body){
    const options = { method, headers: { 'Accept':'application/json' } };
    if(body !== undefined){
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
    const response = await fetch(PRODUCTIVITY_API_BASE, options);
    const raw = await response.text();
    let data = {};
    try{ data = raw ? JSON.parse(raw) : {}; }catch{ data = { raw }; }
    if(!response.ok) throw new Error(data?.error || `Productivity sync failed (${response.status})`);
    return data;
  }

  function applyProductivityPayload(data={}, options={}){
    const persistLocal = options.persistLocal !== false;
    if(data && typeof data.settings === 'object' && data.settings){
      state.settings = { ...defaultSettings, ...data.settings };
      if(persistLocal) save(SETTINGS_KEY, state.settings);
    }
    if(Array.isArray(data.dailyRecords)){
      state.dailyRecords = data.dailyRecords;
      if(persistLocal) save(DAILY_KEY, state.dailyRecords);
    }
    if(Array.isArray(data.laborEntries)){
      state.laborEntries = data.laborEntries;
      if(persistLocal) save(LABOR_KEY, state.laborEntries);
    }
    if(Array.isArray(data.importBatches)){
      state.importBatches = data.importBatches;
      if(persistLocal) save(IMPORT_BATCHES_KEY, state.importBatches);
    }
  }

  async function loadProductivityFromBackend(){
    try{
      const data = await productivityApiRequest('GET');
      applyProductivityPayload(data, { persistLocal: false });
      const fallbackDaily = load(DAILY_KEY, []);
      const fallbackLabor = load(LABOR_KEY, []);
      const fallbackBatches = load(IMPORT_BATCHES_KEY, []);
      const fallbackPending = load(PENDING_IMPORT_KEY, null);
      let hydratedFromLocal = false;
      if(!state.dailyRecords.length && fallbackDaily.length){ state.dailyRecords = fallbackDaily; hydratedFromLocal = true; }
      if(!state.laborEntries.length && fallbackLabor.length){ state.laborEntries = fallbackLabor; hydratedFromLocal = true; }
      if(!state.importBatches.length && fallbackBatches.length){ state.importBatches = fallbackBatches; hydratedFromLocal = true; }
      if(!state.pendingImport && fallbackPending?.employeeRows?.length){ state.pendingImport = fallbackPending; }
      save(DAILY_KEY, state.dailyRecords);
      save(LABOR_KEY, state.laborEntries);
      save(IMPORT_BATCHES_KEY, state.importBatches);
      save(PENDING_IMPORT_KEY, state.pendingImport);
      productivitySyncEnabled = true;
      if(hydratedFromLocal){
        setProductivityStatus('Recovered local Productivity data and syncing it to shared storage…', 'saving');
        scheduleProductivitySync();
      }else{
        setProductivityStatus('Productivity is connected to shared storage.', 'synced', { clearAfter: 2500 });
      }
      render();
    }catch(err){
      console.warn('Productivity sync unavailable, using browser storage.', err);
      // PATCH: Fall back to localStorage so app still works when Neon unreachable.
      const fallbackDaily = load(DAILY_KEY, []);
      const fallbackLabor = load(LABOR_KEY, []);
      const fallbackBatches = load(IMPORT_BATCHES_KEY, []);
      const fallbackPending = load(PENDING_IMPORT_KEY, null);
      if(fallbackDaily.length) state.dailyRecords = fallbackDaily;
      if(fallbackLabor.length) state.laborEntries = fallbackLabor;
      if(fallbackBatches.length) state.importBatches = fallbackBatches;
      if(fallbackPending?.employeeRows?.length) state.pendingImport = fallbackPending;
      productivitySyncEnabled = false;
      setProductivityStatus('Shared Productivity sync is unavailable. Saving in this browser only.', 'local');
      render();
    }finally{
      productivitySyncLoaded = true;
    }
  }

  async function syncProductivityState(){
    if(!productivitySyncEnabled || !productivitySyncLoaded) return;
    if(productivitySyncInFlight){ productivitySyncQueued = true; return; }
    productivitySyncInFlight = true;
    const requestId = ++productivitySyncRequestId;
    const sentVersion = productivityMutationVersion;
    try{
      const data = await productivityApiRequest('POST', {
        settings: state.settings,
        dailyRecords: state.dailyRecords,
        laborEntries: state.laborEntries,
        importBatches: state.importBatches
      });
      const becameStale = sentVersion !== productivityMutationVersion || productivitySyncQueued || requestId !== productivitySyncRequestId;
      if(becameStale){
        setProductivityStatus('Newer Productivity changes are waiting. Finishing sync…', 'saving');
        return;
      }
      applyProductivityPayload(data);
      setProductivityStatus('Productivity saved to shared storage.', 'synced', { clearAfter: 2500 });
    }catch(err){
      console.warn('Productivity sync save failed; keeping local copy.', err);
      productivitySyncEnabled = false;
      setProductivityStatus('Shared Productivity sync failed. Your latest changes are still saved in this browser.', 'local');
    }finally{
      productivitySyncInFlight = false;
      if(productivitySyncQueued){ productivitySyncQueued = false; syncProductivityState(); }
      try{ render(); }catch(_){ }
    }
  }

  function persistView(){
    save(VIEW_KEY, {
      activeTab: state.activeTab,
      activeDept: state.activeDept,
      selectedWeek: state.selectedWeek,
      selectedDate: state.selectedDate,
      selectedMonth: state.selectedMonth
    });
  }

  function persist(statusMessage='Changes saved locally. Syncing…'){
    persistView();
    save(DAILY_KEY, state.dailyRecords);
    save(LABOR_KEY, state.laborEntries);
    save(SETTINGS_KEY, state.settings);
    save(IMPORT_BATCHES_KEY, state.importBatches);
    save(PENDING_IMPORT_KEY, state.pendingImport);
    markProductivityDirty(statusMessage);
    scheduleProductivitySync();
  }

  function getMonthStats(month){
    const rows = state.dailyRecords.filter(r => monthFromDate(r.date) === month).map(computeDaily);
    const totals = rows.reduce((acc,row)=>{
      acc.qaUnits += n(row.qaActualUnits);
      acc.prepUnits += n(row.prepApprovedUnits);
      acc.assemblyUnits += n(row.assemblyUnits);
      acc.shippingUnits += n(row.fulfillmentIndividualUnits) + n(row.fulfillmentBulkUnits);
      acc.touchedUnits += n(row.totalTouchedUnits);
      acc.hours += n(row.totalHoursUsed);
      acc.cost += n(row.totalLaborCost);
      return acc;
    },{qaUnits:0,prepUnits:0,assemblyUnits:0,shippingUnits:0,touchedUnits:0,hours:0,cost:0});
    totals.cpu = div(totals.cost, totals.touchedUnits);
    totals.days = rows.length;
    return { rows, totals };
  }

  function updatePills(totals){
    const recordsPill = document.getElementById('productivityRecordsPill');
    const cpuPill = document.getElementById('productivityCpuPill');
    const hoursPill = document.getElementById('productivityHoursPill');
    if(recordsPill) recordsPill.textContent = `${state.dailyRecords.length} saved day${state.dailyRecords.length===1?'':'s'}`;
    if(cpuPill) cpuPill.textContent = `CPU ${totals.touchedUnits ? money(totals.cpu) : '—'}`;
    if(hoursPill) hoursPill.textContent = `Hours ${fmt(totals.hours)}`;
  }


  function financialControlMarkup(){
    return `<div class="productivity-finance-lock">${financeVisible() ? '<span class="pill">Financials visible</span><button class="btn secondary" type="button" id="productivityLockFinanceBtn">Hide financials</button>' : '<button class="btn secondary" type="button" id="productivityUnlockFinanceBtn">Unlock financials</button>'}</div>`;
  }

  function render(){
    const monthStats = getMonthStats(state.selectedMonth);
    updatePills(monthStats.totals);
    if(!getWeekDays(state.selectedWeek).includes(state.selectedDate)) state.selectedDate = getWeekDays(state.selectedWeek)[0];
    root.innerHTML = `
      <div class="productivity-shell">
        ${productivityStatusMarkup()}
        <div class="productivity-tabbar">
          <button type="button" class="productivity-tab-btn ${state.activeTab==='week'?'active':''}" data-productivity-tab="week">Weekly Board</button>
          <button type="button" class="productivity-tab-btn ${state.activeTab==='labor'?'active':''}" data-productivity-tab="labor">Weekly Labor</button>
          <button type="button" class="productivity-tab-btn ${state.activeTab==='monthly'?'active':''}" data-productivity-tab="monthly">Monthly Summary</button>
        </div>
        ${state.activeTab==='week' ? renderWeekTab() : ''}
        ${state.activeTab==='labor' ? renderLaborTab() : ''}
        ${state.activeTab==='monthly' ? renderMonthlyTab(monthStats) : ''}
      </div>
    `;
    bindEvents();
  }

  function renderWeekTab(){
    const weekDays = getWeekDays(state.selectedWeek);
    const selected = getRecord(state.selectedDate);
    const calc = computeDaily(selected);
    const auto = getAutoMetrics(state.selectedDate);
    return `
      <div class="productivity-grid">
        <div class="productivity-col-12 productivity-card">
          <div class="toolbar">
            <div class="left"><div><div class="eyebrow">Week structure</div><h3>Department pop-outs for ${dateLabel(state.selectedWeek)}–${dateLabel(getWeekEnd(state.selectedWeek))}</h3></div></div>
            <div class="right productivity-actions">${financialControlMarkup()}<label class="field productivity-inline-date"><span class="productivity-muted">Week of</span><input type="date" id="productivityWeekStartInput" value="${state.selectedWeek}"></label></div>
          </div>
          <div class="productivity-week-days">
            ${weekDays.map(day=>{
              const c = computeDaily(getRecord(day));
              const active = day===state.selectedDate ? 'active' : '';
              return `<button type="button" class="productivity-day-btn ${active}" data-day="${day}"><span class="day-name">${new Date(day+'T00:00:00').toLocaleDateString(undefined,{weekday:'short'})}</span><span class="day-date">${dateLabel(day)}</span><span class="day-meta">${fmtNum(c.totalTouchedUnits)} touched</span></button>`;
            }).join('')}
          </div>
          <div class="productivity-summary-grid">
            ${statCard('Touched Units', fmtNum(calc.totalTouchedUnits))}
            ${statCard('Total Hours', fmt(calc.totalHoursUsed))}
            ${financeVisible() ? statCard('Labor Cost', money(calc.totalLaborCost)) : ''}
            ${financeVisible() ? statCard('CPU Touched', calc.totalTouchedUnits ? money(calc.cpuTouched) : '—') : ''}
            ${statCard('Assembly Done', `${fmtNum(calc.assemblyUnits)} units / ${fmtNum(calc.assemblyPacks)} packs`)}
            ${statCard('Inbound Auto', `${fmtNum(auto.qaActualUnits)} rec • ${fmtNum(auto.prepUnits)} prep`)}
          </div>
        </div>

        <div class="productivity-col-12 productivity-card">
          <div class="toolbar">
            <div class="left"><div><div class="eyebrow">Selected day</div><h3>${dateLabel(state.selectedDate)}</h3></div></div>
            <div class="right"><span class="productivity-chip">Auto counts pull from Attendance, QA Inbound, Assembly, and saved labor imports where available</span></div>
          </div>
          <div class="productivity-radio-row">
            ${deptBtn('qa-receiving','QA Receiving')}
            ${deptBtn('qa-prep','QA Prep')}
            ${deptBtn('assembly','Assembly')}
            ${deptBtn('fulfillment','Fulfillment')}
            ${deptBtn('inventory','Inventory')}
            ${deptBtn('putaway','Putaway')}
          </div>

          ${state.activeDept==='qa-receiving' ? renderQaReceivingPanel(selected, calc, auto) : ''}
          ${state.activeDept==='qa-prep' ? renderQaPrepPanel(selected, calc) : ''}
          ${state.activeDept==='assembly' ? renderAssemblyPanel(selected, calc, auto) : ''}
          ${state.activeDept==='fulfillment' ? renderFulfillmentPanel(selected) : ''}
          ${state.activeDept==='inventory' ? renderInventoryPanel(selected) : ''}
          ${state.activeDept==='putaway' ? renderPutawayPanel(selected, auto) : ''}
        </div>
      </div>
    `;
  }

  function renderQaReceivingPanel(record, calc){
    return `
      <form class="productivity-dept-form" data-dept-form="qa-receiving">
        <input type="hidden" name="date" value="${record.date}">
        <div class="productivity-panel-title">QA Receiving</div>
        <div class="productivity-two-up">
          <section class="productivity-subcard">
            <div class="eyebrow">Uniqua block</div>
            <h4>Receiving labor + forecast</h4>
            <div class="productivity-form-grid compact-grid">
              ${readOnlyField('Actual Units (auto)','qaActualUnits', calc.qaActualUnits)}
              ${readOnlyField('Actual POs (auto)','qaActualPOs', calc.qaActualPOs)}
              ${field('Projected Units','qaProjectedUnits','number', record.qaProjectedUnits || '')}
              ${field('Projected POs','qaProjectedPOs','number', record.qaProjectedPOs || '')}
              ${readOnlyField('Hours Worked (from weekly labor)','qaHoursWorked', fmt(record.qaHoursWorked || 0))}
              ${financeVisible() ? readOnlyField('Payout (from weekly labor)','qaPayout', money(record.qaPayout || 0)) : ''}
              ${readOnlyField('Attendance (auto)','qaAttendance', calc.qaAttendance)}
              ${field('Monthly POs','qaMonthlyPOs','number', record.qaMonthlyPOs || '')}
              ${readOnlyField('PTO Hours (from weekly labor)','qaPtoHours', fmt(record.qaPtoHours || 0))}
              ${financeVisible() ? readOnlyField('PTO Payout (from weekly labor)','qaPtoPayout', money(record.qaPtoPayout || 0)) : ''}
            </div>
          </section>

          <section class="productivity-subcard">
            <div class="eyebrow">Diana block</div>
            <h4>Insert cards / printing</h4>
            <div class="productivity-form-grid compact-grid">
              ${field('Insert Cards Printed','insertCardsPrinted','number', record.insertCardsPrinted || '')}
              ${readOnlyField('Hours Worked','insertHoursWorked', fmt(record.insertHoursWorked || 0))}
              ${financeVisible() ? readOnlyField('Payout','insertPayout', money(record.insertPayout || 0)) : ''}
            </div>
            <div class="eyebrow" style="margin-top:16px">Diana QA block</div>
            <h4>QA receiving snapshot</h4>
            <div class="productivity-form-grid compact-grid">
              ${readOnlyField('Units (auto)','qaActualUnits2', calc.qaActualUnits)}
              ${readOnlyField('POs (auto)','qaActualPOs2', calc.qaActualPOs)}
              ${readOnlyField('Attendance (auto)','qaAttendance2', calc.qaAttendance)}
              ${field('Aging POs','qaAgingPOs','number', record.qaAgingPOs || '')}
              ${readOnlyField('Avg Units / PO','qaAvgUnits', round(div(calc.qaActualUnits, calc.qaActualPOs||0)))}
            </div>
          </section>
        </div>
        <div class="toolbar"><div class="left"><span class="pill">Receiving units, POs, and attendance are now tied to your live modules.</span></div><div class="right"><button class="btn" type="submit">Save QA Receiving</button></div></div>
      </form>
    `;
  }

  function renderQaPrepPanel(record, calc){
    return `
      <form class="productivity-dept-form" data-dept-form="qa-prep">
        <input type="hidden" name="date" value="${record.date}">
        <div class="productivity-panel-title">QA Prep</div>
        <section class="productivity-subcard">
          <div class="eyebrow">Reyna block</div>
          <h4>Prep performance</h4>
          <div class="productivity-form-grid compact-grid">
            ${readOnlyField('Units (auto)','prepUnits', calc.prepUnits)}
            ${readOnlyField('POs (auto)','prepPOs', calc.prepPOs)}
            ${field('QA Approved Units','prepApprovedUnits','number', record.prepApprovedManual ? record.prepApprovedUnits : '', '1')}
            ${readOnlyField('Attendance (auto)','prepAttendance', calc.prepAttendance)}
            ${readOnlyField('Hours Worked (from weekly labor)','prepHoursWorked', fmt(record.prepHoursWorked || 0))}
            ${financeVisible() ? readOnlyField('Payout (from weekly labor)','prepPayout', money(record.prepPayout || 0)) : ''}
            ${readOnlyField('PTO Hours (from weekly labor)','prepPtoHours', fmt(record.prepPtoHours || 0))}
            ${financeVisible() ? readOnlyField('PTO Payout (from weekly labor)','prepPtoPayout', money(record.prepPtoPayout || 0)) : ''}
            ${readOnlyField('Avg Units / PO','prepAvgUnits', round(div(calc.prepUnits, calc.prepPOs||0)))}
            ${readOnlyField('Prep UPH','prepUph', calc.prepUph)}
          </div>
        </section>
        <div class="toolbar"><div class="left"><span class="pill">Prep units and POs auto-pull from QA Inbound. QA approved units stay adjustable.</span></div><div class="right"><button class="btn" type="submit">Save QA Prep</button></div></div>
      </form>
    `;
  }

  function renderAssemblyPanel(record, calc, auto){
    return `
      <form class="productivity-dept-form" data-dept-form="assembly">
        <input type="hidden" name="date" value="${record.date}">
        <div class="productivity-panel-title">Assembly</div>
        <section class="productivity-subcard">
          <div class="eyebrow">Juan block</div>
          <h4>Produced today</h4>
          <div class="productivity-form-grid compact-grid">
            ${readOnlyField('Units (auto)','assemblyUnits', calc.assemblyUnits)}
            ${readOnlyField('Packs (auto)','assemblyPacks', calc.assemblyPacks)}
            ${readOnlyField('Attendance (auto)','assemblyAttendance', calc.assemblyAttendance)}
            ${readOnlyField('Hours Worked (from weekly labor)','assemblyHoursWorked', fmt(record.assemblyHoursWorked || 0))}
            ${financeVisible() ? readOnlyField('Payout (from weekly labor)','assemblyPayout', money(record.assemblyPayout || 0)) : ''}
            ${readOnlyField('PTO Hours (from weekly labor)','assemblyPtoHours', fmt(record.assemblyPtoHours || 0))}
            ${financeVisible() ? readOnlyField('PTO Payout (from weekly labor)','assemblyPtoPayout', money(record.assemblyPtoPayout || 0)) : ''}
            ${readOnlyField('Assembly UPH','assemblyUph', calc.assemblyUph)}
            ${readOnlyField('Scheduled Rows','assemblyScheduledRows', auto.assemblyScheduledRows)}
          </div>
        </section>
        <div class="toolbar"><div class="left"><span class="pill">Assembly units and packs are tied to rows marked Done on the selected date.</span></div><div class="right"><button class="btn" type="submit">Save Assembly</button></div></div>
      </form>
    `;
  }

  function renderFulfillmentPanel(record){
    return `
      <form class="productivity-dept-form" data-dept-form="fulfillment">
        <input type="hidden" name="date" value="${record.date}">
        <div class="productivity-panel-title">Fulfillment</div>
        <div class="productivity-two-up">
          <section class="productivity-subcard">
            <div class="eyebrow">Francisco block</div>
            <h4>Individuals</h4>
            <div class="productivity-form-grid compact-grid">
              ${field('Orders','fulfillmentIndividualOrders','number', record.fulfillmentIndividualOrders || '')}
              ${field('Units','fulfillmentIndividualUnits','number', record.fulfillmentIndividualUnits || '')}
              ${readOnlyField('Hours Worked (from weekly labor)','fulfillmentIndividualHoursWorked', fmt(record.fulfillmentIndividualHoursWorked || 0))}
              ${financeVisible() ? readOnlyField('Payout (from weekly labor)','fulfillmentIndividualPayout', money(record.fulfillmentIndividualPayout || 0)) : ''}
              ${readOnlyField('PTO Hours (from weekly labor)','fulfillmentIndividualPtoHours', fmt(record.fulfillmentIndividualPtoHours || 0))}
              ${financeVisible() ? readOnlyField('PTO Payout (from weekly labor)','fulfillmentIndividualPtoPayout', money(record.fulfillmentIndividualPtoPayout || 0)) : ''}
            </div>
          </section>
          <section class="productivity-subcard">
            <div class="eyebrow">Francisco block</div>
            <h4>Bulk</h4>
            <div class="productivity-form-grid compact-grid">
              ${field('Orders','fulfillmentBulkOrders','number', record.fulfillmentBulkOrders || '')}
              ${field('Units','fulfillmentBulkUnits','number', record.fulfillmentBulkUnits || '')}
              ${readOnlyField('Hours Worked (from weekly labor)','fulfillmentBulkHoursWorked', fmt(record.fulfillmentBulkHoursWorked || 0))}
              ${financeVisible() ? readOnlyField('Payout (from weekly labor)','fulfillmentBulkPayout', money(record.fulfillmentBulkPayout || 0)) : ''}
              ${readOnlyField('PTO Hours (from weekly labor)','fulfillmentBulkPtoHours', fmt(record.fulfillmentBulkPtoHours || 0))}
              ${financeVisible() ? readOnlyField('PTO Payout (from weekly labor)','fulfillmentBulkPtoPayout', money(record.fulfillmentBulkPtoPayout || 0)) : ''}
            </div>
          </section>
        </div>
        <div class="toolbar"><div class="left"><span class="pill">Fulfillment stays manual for now, but both sides are split cleanly on one panel.</span></div><div class="right"><button class="btn" type="submit">Save Fulfillment</button></div></div>
      </form>
    `;
  }

  function renderInventoryPanel(record){
    return `
      <form class="productivity-dept-form" data-dept-form="inventory">
        <input type="hidden" name="date" value="${record.date}">
        <div class="productivity-panel-title">Inventory</div>
        <section class="productivity-subcard">
          <div class="eyebrow">Katia block</div>
          <h4>Inventory tracking</h4>
          <div class="productivity-form-grid compact-grid">
            ${field('Units','inventoryUnits','number', record.inventoryUnits || '')}
            ${field('POs','inventoryPOs','number', record.inventoryPOs || '')}
            ${field('Attendance','inventoryAttendance','number', record.inventoryAttendance || '')}
            ${readOnlyField('Hours Worked (from weekly labor)','inventoryHoursWorked', fmt(record.inventoryHoursWorked || 0))}
            ${financeVisible() ? readOnlyField('Payout (from weekly labor)','inventoryPayout', money(record.inventoryPayout || 0)) : ''}
            ${readOnlyField('PTO Hours (from weekly labor)','inventoryPtoHours', fmt(record.inventoryPtoHours || 0))}
            ${financeVisible() ? readOnlyField('PTO Payout (from weekly labor)','inventoryPtoPayout', money(record.inventoryPtoPayout || 0)) : ''}
            ${field('Cycle Counts','inventoryCycleCounts','number', record.inventoryCycleCounts || '')}
            ${field('Discrepancies','inventoryDiscrepancies','number', record.inventoryDiscrepancies || '')}
            ${field('Accuracy %','inventoryAccuracy','number', record.inventoryAccuracy || '', '0.01')}
          </div>
        </section>
        <div class="toolbar"><div class="left"><span class="pill">Inventory stays manual for now just like you asked.</span></div><div class="right"><button class="btn" type="submit">Save Inventory</button></div></div>
      </form>
    `;
  }

  function renderPutawayPanel(record, auto){
    return `
      <form class="productivity-dept-form" data-dept-form="putaway">
        <input type="hidden" name="date" value="${record.date}">
        <div class="productivity-panel-title">Putaway</div>
        <section class="productivity-subcard">
          <div class="eyebrow">Francisco block</div>
          <h4>Inbound / outbound hazel</h4>
          <div class="productivity-form-grid compact-grid">
            ${field('Putaway Units','putawayUnits','number', record.putawayUnits || '')}
            ${field('Putaway POs','putawayPOs','number', record.putawayPOs || '')}
            ${field('Attendance','putawayAttendance','number', record.putawayAttendance || '')}
            ${readOnlyField('Hours Worked (from weekly labor)','putawayHoursWorked', fmt(record.putawayHoursWorked || 0))}
            ${financeVisible() ? readOnlyField('Payout (from weekly labor)','putawayPayout', money(record.putawayPayout || 0)) : ''}
            ${readOnlyField('PTO Hours (from weekly labor)','putawayPtoHours', fmt(record.putawayPtoHours || 0))}
            ${financeVisible() ? readOnlyField('PTO Payout (from weekly labor)','putawayPtoPayout', money(record.putawayPtoPayout || 0)) : ''}
            ${readOnlyField('Workflow Putaway Lines','putawayLineCount', auto.putawayLineCount)}
          </div>
        </section>
        <div class="toolbar"><div class="left"><span class="pill">Putaway stays mostly manual right now, with workflow line count shown as a hint.</span></div><div class="right"><button class="btn" type="submit">Save Putaway</button></div></div>
      </form>
    `;
  }

  function renderLaborTab(){
    const employees = getEmployees();
    const weekStart = state.selectedWeek;
    const weekEnd = getWeekEnd(weekStart);
    const entries = state.laborEntries.filter(entry => entry.weekStart === weekStart).map(computeLabor).sort((a,b)=> String(a.date||'').localeCompare(String(b.date||'')) || String(a.employeeName).localeCompare(String(b.employeeName)));
    const totals = entries.reduce((acc,row)=>{ acc.hours += n(row.regularHours)+n(row.ptoHours)+n(row.otHours); acc.payout += n(row.payout); return acc; }, {hours:0,payout:0});
    const weekBatches = state.importBatches.filter(batch => batch.weekStart === weekStart).sort((a,b)=> String(b.savedAt).localeCompare(String(a.savedAt)));
    const pending = state.pendingImport;
    return `
      <div class="productivity-grid">
        <div class="productivity-col-12 productivity-card">
          <div class="toolbar">
            <div class="left"><div><div class="eyebrow">Weekly labor</div><h3>ADP import with day-based save</h3></div></div>
            <div class="right">${financialControlMarkup()}<span class="productivity-chip">${dateLabel(weekStart)}–${dateLabel(weekEnd)}</span></div>
          </div>
          <div class="productivity-summary-grid">
            ${statCard('Tracked Hours', fmt(totals.hours))}
            ${financeVisible() ? statCard('Payout', money(totals.payout)) : ''}
            ${statCard('Saved Imports', fmtNum(weekBatches.length))}
          </div>
          <div class="productivity-import-box">
            <div>
              <div class="eyebrow">ADP import flow</div>
              <div class="productivity-muted">Choose a CSV, prepare the import, then save it. The save uses each row’s pay date, writes worked hours, PTO hours, and payout into that exact day, and keeps an upload history with timestamp.</div>
            </div>
            <div class="productivity-import-actions">
              <input id="productivityAdpCsvInput" type="file" accept=".csv,text/csv">
              <button class="btn secondary" type="button" id="productivityAdpPrepareBtn">Prepare Import</button>
              <button class="btn" type="button" id="productivityAdpSaveBtn" ${pending ? '' : 'disabled'}>Save Imported Day${pending && pending.daySummaries.length !== 1 ? 's' : ''}</button>
            </div>
          </div>
          ${pending ? `
            <div class="productivity-subcard" style="margin-bottom:16px">
              <div class="toolbar">
                <div class="left"><div><div class="eyebrow">Pending import</div><h4>${escapeHtml(pending.fileName)}</h4></div></div>
                <div class="right"><span class="pill">Prepared ${new Date(pending.preparedAt).toLocaleString()}</span></div>
              </div>
              <div class="productivity-table-wrap"><table class="productivity-table"><thead><tr><th>Pay Date</th><th>Employees</th><th>Total Hours</th><th>QA</th><th>Prep</th><th>Assembly</th><th>Inventory</th><th>Putaway</th><th>Fulfillment</th></tr></thead><tbody>${pending.daySummaries.map(day=>`<tr><td>${dateLabel(day.date)}</td><td>${fmtNum(day.employeeCount)}</td><td>${fmt(day.hours)}</td><td>${fmt(day.qaHours)}</td><td>${fmt(day.prepHours)}</td><td>${fmt(day.assemblyHours)}</td><td>${fmt(day.inventoryHours)}</td><td>${fmt(day.putawayHours)}</td><td>${fmt(day.fulfillmentIndividualHours + day.fulfillmentBulkHours)}</td></tr>`).join('')}</tbody></table></div>
              ${pending.unmatchedNames && pending.unmatchedNames.length ? `<div class="productivity-import-unmatched"><strong>⚠ ${pending.unmatchedNames.length} unmatched ADP name${pending.unmatchedNames.length !== 1 ? 's' : ''} — match them here:</strong><div class="productivity-import-match-list">${pending.unmatchedNames.map(u=>{ const options = getEmployeeOptionsForAdpName(u.name); return `<div class="productivity-import-match-row"><div class="productivity-import-match-main"><div class="productivity-import-match-name">${escapeHtml(u.name)}</div><div class="productivity-import-match-meta">${u.count} row${u.count!==1?'s':''} waiting to be linked</div></div><div class="productivity-import-match-controls"><select class="productivity-import-match-select" data-adp-match-name="${escapeHtml(u.name)}"><option value="">Match to employee…</option>${options.map(opt=>`<option value="${escapeHtml(opt.name)}">${escapeHtml(opt.name)}${opt.department ? ` — ${escapeHtml(opt.department)}` : ''}</option>`).join('')}</select><div class="productivity-import-match-actions"><button class="btn secondary productivity-save-adp-match-btn" type="button" data-adp-save-name="${escapeHtml(u.name)}">Save Match</button><button class="btn secondary productivity-replace-adp-name-btn" type="button" data-adp-replace-name="${escapeHtml(u.name)}">Use ADP Name</button><button class="btn secondary productivity-add-adp-employee-btn" type="button" data-adp-add-name="${escapeHtml(u.name)}">Add as New</button></div></div></div>`; }).join('')}</div><div class="productivity-import-unmatched-hint">Save Match = link ADP name to someone already on your list. Use ADP Name = replace the selected employee name with the ADP version. Add as New = create a brand-new employee using the ADP name.</div></div>` : `<div class="productivity-import-matched-ok">✓ All ADP names matched to employee records.</div>`}
            </div>
          ` : ''}
          <form id="productivityLaborForm" class="productivity-inline-form">
            <div class="field"><label>Employee</label><select name="employeeName"><option value="">Select employee</option>${employees.map(emp=>`<option value="${escapeHtml(emp.name)}">${escapeHtml(emp.name)}</option>`).join('')}</select></div>
            <div class="field"><label>Home Dept</label><input name="homeDepartment" type="text"></div>
            <div class="field"><label>Worked Dept</label><input name="workedDepartment" type="text"></div>
            <div class="field"><label>Regular Hrs</label><input name="regularHours" type="number" step="0.01"></div>
            <div class="field"><label>PTO Hrs</label><input name="ptoHours" type="number" step="0.01"></div>
            <div class="field"><label>OT Hrs</label><input name="otHours" type="number" step="0.01"></div>
            ${financeVisible() ? '<div class="field"><label>Rate</label><input name="hourlyRate" type="number" step="0.01"></div>' : ''}
            <div class="field"><label>Notes</label><input name="notes" type="text"></div>
            <div class="field"><button class="btn" type="submit">Add labor row</button></div>
          </form>
          ${entries.length ? `<div class="productivity-table-wrap"><table class="productivity-table"><thead><tr><th>Date</th><th>Employee</th><th>Home Dept</th><th>Worked Dept</th><th>Regular</th><th>PTO</th><th>OT</th>${financeVisible() ? '<th>Rate</th><th>Payout</th>' : ''}<th>Notes</th><th></th></tr></thead><tbody>${entries.map(entry=>`<tr><td>${entry.date ? dateLabel(entry.date) : '—'}</td><td>${escapeHtml(entry.employeeName)}</td><td>${escapeHtml(entry.homeDepartment)}</td><td>${escapeHtml(entry.workedDepartment)}</td><td>${fmt(entry.regularHours)}</td><td>${fmt(entry.ptoHours)}</td><td>${fmt(entry.otHours)}</td>${financeVisible() ? `<td>${money(entry.hourlyRate)}</td><td>${money(entry.payout)}</td>` : ''}<td>${escapeHtml(entry.notes || '')}</td><td><button class="btn secondary productivity-delete-labor-btn" type="button" data-id="${entry.id}">Delete</button></td></tr>`).join('')}</tbody></table></div>` : `<div class="productivity-empty">No weekly labor rows yet.</div>`}
        </div>
        <div class="productivity-col-12 productivity-card">
          <div class="toolbar">
            <div class="left"><div><div class="eyebrow">Import history</div><h3>Saved uploads for this week</h3></div></div>
          </div>
          ${weekBatches.length ? `<div class="productivity-table-wrap"><table class="productivity-table"><thead><tr><th>Saved</th><th>File</th><th>Pay Dates</th><th>Rows</th><th>Hours</th>${financeVisible() ? '<th>Payout</th>' : ''}<th></th></tr></thead><tbody>${weekBatches.map(batch=>`<tr><td>${new Date(batch.savedAt).toLocaleString()}</td><td>${escapeHtml(batch.fileName)}</td><td>${escapeHtml(batch.dates.map(dateLabel).join(', '))}</td><td>${fmtNum(batch.entryCount)}</td><td>${fmt(batch.totalHours)}</td>${financeVisible() ? `<td>${money(batch.totalPayout || 0)}</td>` : ''}<td><button class="btn secondary productivity-delete-batch-btn" type="button" data-batch-id="${batch.id}">Delete Import</button></td></tr>`).join('')}</tbody></table></div>` : `<div class="productivity-empty">No saved imports for this week yet.</div>`}
        </div>
      </div>
    `;
  }
  function renderMonthlyTab(stats){
    const t = stats.totals;
    const rows = stats.rows;
    return `
      <div class="productivity-grid">
        <div class="productivity-col-12 productivity-card">
          <div class="toolbar">
            <div class="left"><div><div class="eyebrow">Monthly view</div><h3>${monthLabel(state.selectedMonth)}</h3></div></div>
            <div class="right">${financialControlMarkup()}<label class="field productivity-inline-date"><span class="productivity-muted">Month</span><input type="month" id="productivityMonthInput" value="${state.selectedMonth}"></label></div>
          </div>
          <div class="productivity-month-grid">
            ${statCard('Days Logged', fmtNum(t.days))}
            ${statCard('QA Units', fmtNum(t.qaUnits))}
            ${statCard('Prep Approved', fmtNum(t.prepUnits))}
            ${statCard('Assembly Units', fmtNum(t.assemblyUnits))}
            ${statCard('Shipping Units', fmtNum(t.shippingUnits))}
            ${statCard('Total Hours', fmt(t.hours))}
            ${financeVisible() ? statCard('Labor Cost', money(t.cost)) : ''}
            ${financeVisible() ? statCard('CPU Touched', t.touchedUnits ? money(t.cpu) : '—') : ''}
          </div>
        </div>
        <div class="productivity-col-12 productivity-card">
          <div class="eyebrow">Month detail</div>
          <h3>Saved day breakdown</h3>
          ${rows.length ? `<div class="productivity-table-wrap"><table class="productivity-table"><thead><tr><th>Date</th><th>QA Units</th><th>Prep Approved</th><th>Assembly Units</th><th>Touched Units</th><th>Hours</th>${financeVisible() ? '<th>CPU</th>' : ''}</tr></thead><tbody>${rows.map(row=>`<tr><td>${dateLabel(row.date)}</td><td>${fmtNum(row.qaActualUnits)}</td><td>${fmtNum(row.prepApprovedUnits)}</td><td>${fmtNum(row.assemblyUnits)}</td><td>${fmtNum(row.totalTouchedUnits)}</td><td>${fmt(row.totalHoursUsed)}</td>${financeVisible() ? `<td>${row.totalTouchedUnits ? money(row.cpuTouched) : '—'}</td>` : ''}</tr>`).join('')}</tbody></table></div>` : `<div class="productivity-empty">No saved records for this month yet.</div>`}
        </div>
      </div>
    `;
  }

  function bindEvents(){
    root.querySelectorAll('[data-productivity-tab]').forEach(btn => btn.addEventListener('click', ()=>{ state.activeTab = btn.dataset.productivityTab; persistView(); render(); }));
    const weekInput = document.getElementById('productivityWeekStartInput');
    if(weekInput) weekInput.addEventListener('change', ()=>{ state.selectedWeek = getWeekStart(weekInput.value || isoToday()); state.selectedDate = getWeekDays(state.selectedWeek)[0]; persistView(); render(); });
    root.querySelectorAll('[data-day]').forEach(btn => btn.addEventListener('click', ()=>{ state.selectedDate = btn.dataset.day; render(); }));
    root.querySelectorAll('[data-dept]').forEach(btn => btn.addEventListener('click', ()=>{ state.activeDept = btn.dataset.dept; render(); }));
    root.querySelectorAll('[data-dept-form]').forEach(form => form.addEventListener('submit', onDeptSave));

    const laborForm = document.getElementById('productivityLaborForm');
    if(laborForm) laborForm.addEventListener('submit', onLaborSubmit);
    const adpPrepareBtn = document.getElementById('productivityAdpPrepareBtn');
    if(adpPrepareBtn) adpPrepareBtn.addEventListener('click', prepareAdpCsvImport);
    const adpSaveBtn = document.getElementById('productivityAdpSaveBtn');
    if(adpSaveBtn) adpSaveBtn.addEventListener('click', savePendingAdpImport);
    root.querySelectorAll('.productivity-save-adp-match-btn').forEach(btn => btn.addEventListener('click', ()=>{
      const rawName = btn.dataset.adpSaveName || '';
      const select = root.querySelector(`[data-adp-match-name="${CSS.escape(rawName)}"]`);
      const employeeName = select?.value || '';
      saveAdpNameMatch(rawName, employeeName);
    }));
    root.querySelectorAll('.productivity-replace-adp-name-btn').forEach(btn => btn.addEventListener('click', ()=>{
      const rawName = btn.dataset.adpReplaceName || '';
      const select = root.querySelector(`[data-adp-match-name="${CSS.escape(rawName)}"]`);
      const employeeName = select?.value || '';
      replaceEmployeeDisplayNameWithAdp(rawName, employeeName);
    }));
    root.querySelectorAll('.productivity-add-adp-employee-btn').forEach(btn => btn.addEventListener('click', ()=>{
      const rawName = btn.dataset.adpAddName || '';
      addNewEmployeeFromAdpName(rawName);
    }));
    root.querySelectorAll('.productivity-delete-labor-btn').forEach(btn => btn.addEventListener('click', ()=> deleteLabor(btn.dataset.id)));
    root.querySelectorAll('.productivity-delete-batch-btn').forEach(btn => btn.addEventListener('click', ()=> deleteImportBatch(btn.dataset.batchId)));
    const monthInput = document.getElementById('productivityMonthInput');
    if(monthInput) monthInput.addEventListener('change', ()=>{ state.selectedMonth = monthInput.value || state.selectedMonth; render(); });
    const unlockBtn = document.getElementById('productivityUnlockFinanceBtn');
    if(unlockBtn) unlockBtn.addEventListener('click', unlockFinancials);
    const lockBtn = document.getElementById('productivityLockFinanceBtn');
    if(lockBtn) lockBtn.addEventListener('click', ()=>{ state.financeUnlocked = false; render(); });
  }


  function unlockFinancials(){
    const code = window.prompt('Enter finance access code');
    if(code == null) return;
    if(String(code).trim() === FINANCE_UNLOCK_CODE){
      state.financeUnlocked = true;
      render();
      return;
    }
    alert('Incorrect code.');
  }

  function onDeptSave(event){
    event.preventDefault();
    const form = event.currentTarget;
    const fd = new FormData(form);
    const date = text(fd.get('date')) || state.selectedDate;
    const record = getRecord(date);
    const deptForm = text(form.dataset.deptForm);
    const auto = getAutoMetrics(date);
    for(const [key, value] of fd.entries()){
      if(key === 'date') continue;
      if(deptForm === 'qa-prep' && key === 'prepApprovedUnits') continue;
      record[key] = value === '' ? '' : value;
    }
    if(deptForm === 'qa-prep'){
      const rawApproved = text(fd.get('prepApprovedUnits'));
      const approvedValue = rawApproved === '' ? '' : n(rawApproved);
      const autoPrepUnits = n(auto.prepUnits);
      const shouldUseManual = rawApproved !== '' && approvedValue !== autoPrepUnits;
      record.prepApprovedManual = shouldUseManual;
      record.prepApprovedUnits = shouldUseManual ? approvedValue : '';
    }
    record.savedSnapshot = buildAutoSnapshot(date, auto);
    persist(`Saved ${form.querySelector('.productivity-panel-title')?.textContent || 'Productivity'} for ${dateLabel(date)}. Syncing…`);
    render();
  }

  function onLaborSubmit(event){
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const entry = computeLabor({
      id: uuid(),
      date: state.selectedDate,
      weekStart: state.selectedWeek,
      employeeName: text(fd.get('employeeName')),
      homeDepartment: text(fd.get('homeDepartment')),
      workedDepartment: text(fd.get('workedDepartment')),
      regularHours: n(fd.get('regularHours')),
      ptoHours: n(fd.get('ptoHours')),
      otHours: n(fd.get('otHours')),
      hourlyRate: n(fd.get('hourlyRate')) || inferRateForDepartment(text(fd.get('workedDepartment')) || text(fd.get('homeDepartment'))),
      notes: text(fd.get('notes'))
    });
    if(!entry.employeeName){ alert('Pick an employee first.'); return; }
    state.laborEntries.unshift(entry);
    persist(`Saved labor row for ${entry.employeeName} on ${dateLabel(entry.date)}. Syncing…`);
    render();
  }



  async function prepareAdpCsvImport(){
    const input = document.getElementById('productivityAdpCsvInput');
    const file = input?.files?.[0];
    if(!file){ alert('Choose the ADP CSV first.'); return; }
    const raw = await file.text();
    const rows = parseCsv(raw);
    if(!rows.length){ alert('That CSV looked empty.'); return; }
    const { employeeRows: summary, unmatchedNames } = summarizeAdpCsvRows(rows);
    if(!summary.length){ alert('I could not find any usable pay-date rows in that CSV.'); return; }
    const employeeRows = summary.map(row => ({
      ...row,
      hourlyRate: inferRateForDepartment(row.workedDepartment || row.homeDepartment)
    }));
    const daySummaries = buildPendingImportSummary(employeeRows, file.name);
    state.pendingImport = {
      fileName: file.name,
      preparedAt: new Date().toISOString(),
      employeeRows,
      daySummaries,
      unmatchedNames
    };
    if(daySummaries.length){
      state.selectedWeek = getWeekStart(daySummaries[0].date || employeeRows[0]?.date || isoToday());
      state.selectedDate = daySummaries[0].date || getWeekDays(state.selectedWeek)[0] || isoToday();
      state.activeTab = 'labor';
    }
    persist(`Prepared ${employeeRows.length} ADP labor row${employeeRows.length===1?'':'s'} from ${file.name}.`);
    render();
  }

  function savePendingAdpImport(){
    const pending = state.pendingImport;
    if(!pending || !pending.employeeRows?.length){ alert('Prepare an import first.'); return; }
    const batchId = uuid();
    const savedAt = new Date().toISOString();
    const imported = pending.employeeRows.map(row => ({
      id: uuid(),
      sourceKind: 'adp',
      importBatchId: batchId,
      importedAt: savedAt,
      sourceFile: pending.fileName,
      date: row.date,
      weekStart: row.weekStart,
      employeeName: row.employeeName,
      homeDepartment: row.homeDepartment,
      workedDepartment: row.workedDepartment,
      regularHours: row.regularHours,
      ptoHours: row.ptoHours,
      otHours: row.otHours,
      hourlyRate: row.hourlyRate,
      notes: `Imported from ${pending.fileName}${row.codes.length ? ` • ${row.codes.join(', ')}` : ''}`
    }));
    state.laborEntries = [...state.laborEntries, ...imported].sort((a,b)=> String(a.date||'').localeCompare(String(b.date||'')) || String(a.employeeName).localeCompare(String(b.employeeName)));
    const affectedDates = [...new Set(imported.map(row => row.date))];
    affectedDates.forEach(recomputeImportedHoursForDate);
    const totalHours = imported.reduce((sum,row)=> sum + n(row.regularHours)+n(row.ptoHours)+n(row.otHours), 0);
    state.importBatches.unshift({
      id: batchId,
      fileName: pending.fileName,
      savedAt,
      dates: affectedDates,
      entryCount: imported.length,
      totalHours: round(totalHours),
      totalPayout: round(imported.reduce((sum,row)=> sum + n(computeLabor(row).payout), 0)),
      weekStart: affectedDates.length ? getWeekStart(affectedDates[0]) : state.selectedWeek
    });
    state.pendingImport = null;
    if(affectedDates.length){
      state.selectedWeek = getWeekStart(affectedDates[0]);
      state.selectedDate = affectedDates[0];
      state.activeTab = 'labor';
    }
    persist(`Saved ${imported.length} imported labor row${imported.length===1?'':'s'} across ${affectedDates.length} day${affectedDates.length===1?'':'s'}. Syncing…`);
    render();
  }

  function deleteLabor(id){
    const target = state.laborEntries.find(row => String(row.id) === String(id));
    state.laborEntries = state.laborEntries.filter(row => String(row.id) !== String(id));
    if(target?.sourceKind === 'adp' && target?.date) recomputeImportedHoursForDate(target.date);
    persist(`Deleted 1 labor row. Syncing…`);
    render();
  }

  function deleteImportBatch(batchId){
    const batch = state.importBatches.find(row => String(row.id) === String(batchId));
    if(!batch) return;
    const affectedDates = new Set();
    state.laborEntries = state.laborEntries.filter(row => {
      const remove = String(row.importBatchId || '') === String(batchId);
      if(remove && row.date) affectedDates.add(row.date);
      return !remove;
    });
    state.importBatches = state.importBatches.filter(row => String(row.id) !== String(batchId));
    [...affectedDates].forEach(recomputeImportedHoursForDate);
    persist(`Deleted import ${batch.fileName || 'batch'}. Syncing…`);
    render();
  }

  function field(label,name,type='text',value='',step=''){
    const stepAttr = step ? ` step="${step}"` : '';
    return `<div class="field"><label for="prod-${name}">${escapeHtml(label)}</label><input id="prod-${name}" name="${escapeHtml(name)}" type="${escapeHtml(type)}" value="${escapeHtml(value)}"${stepAttr}></div>`;
  }
  function readOnlyField(label,name,value=''){
    return `<div class="field"><label for="prod-${name}">${escapeHtml(label)}</label><input id="prod-${name}" name="${escapeHtml(name)}" type="text" value="${escapeHtml(value)}" readonly class="readonly-field"></div>`;
  }
  function statCard(label,value){
    return `<div class="productivity-stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
  }
  function deptBtn(id,label){
    return `<button type="button" class="productivity-radio-btn ${state.activeDept===id?'active':''}" data-dept="${id}">${escapeHtml(label)}</button>`;
  }

  window.addEventListener('qa-workflow-data-changed', () => {
    try { render(); } catch(_){}
  });
  window.addEventListener('assembly-data-changed', () => {
    try { render(); } catch(_){}
  });
  window.addEventListener('attendance-data-changed', () => {
    try { render(); } catch(_){}
  });

  render();
  loadProductivityFromBackend();
})();
