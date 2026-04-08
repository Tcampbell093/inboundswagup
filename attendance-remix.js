
(function(){
  const settingsKey = 'ops_hub_attendance_settings_v1';
  const todayString = () => new Date().toISOString().slice(0,10);
  const ALL_TAB = '__all__';

  const els = {
    deptTabs:           document.getElementById('attendanceRemixDeptTabs'),
    dateInput:          document.getElementById('attendanceRemixDateInput'),
    dateLabel:          document.getElementById('attendanceRemixDateLabel'),
    stats:              document.getElementById('attendanceRemixStats'),
    summaryTitle:       document.getElementById('attendanceRemixSummaryTitle'),
    summaryHead:        document.getElementById('attendanceRemixSummaryHead'),
    summaryBody:        document.getElementById('attendanceRemixSummaryBody'),
    openEditorBtn:      document.getElementById('attendanceRemixOpenEditorBtn'),
    openSettingsBtn:    document.getElementById('attendanceRemixOpenSettingsBtn'),
    todayBtn:           document.getElementById('attendanceRemixTodayBtn'),
    prevBtn:            document.getElementById('attendanceRemixPrevBtn'),
    nextBtn:            document.getElementById('attendanceRemixNextBtn'),
    quickPresentBtn:    document.getElementById('attendanceRemixQuickPresentBtn'),
    employeesMergedGoBtn: document.getElementById('employeesMergedGoBtn'),
    editorBackdrop:     document.getElementById('attendanceRemixEditorBackdrop'),
    editorTitle:        document.getElementById('attendanceRemixEditorTitle'),
    editorDateInput:    document.getElementById('attendanceRemixEditorDateInput'),
    editorDateLabel:    document.getElementById('attendanceRemixEditorDateLabel'),
    editorTable:        document.getElementById('attendanceRemixEditorTable'),
    editorCloseBtn:     document.getElementById('attendanceRemixEditorCloseBtn'),
    editorCancelBtn:    document.getElementById('attendanceRemixEditorCancelBtn'),
    editorSaveBtn:      document.getElementById('attendanceRemixEditorSaveBtn'),
    editorPrevBtn:      document.getElementById('attendanceRemixEditorPrevBtn'),
    editorTodayBtn:     document.getElementById('attendanceRemixEditorTodayBtn'),
    editorNextBtn:      document.getElementById('attendanceRemixEditorNextBtn'),
    editorClearBtn:     document.getElementById('attendanceRemixEditorClearBtn'),
    settingsBackdrop:       document.getElementById('attendanceRemixSettingsBackdrop'),
    settingsCloseBtn:       document.getElementById('attendanceRemixSettingsCloseBtn'),
    settingsCancelBtn:      document.getElementById('attendanceRemixSettingsCancelBtn'),
    settingsSaveBtn:        document.getElementById('attendanceRemixSettingsSaveBtn'),
    departmentsList:        document.getElementById('attendanceRemixDepartmentsList'),
    marksList:              document.getElementById('attendanceRemixMarksList'),
    employeesList:          document.getElementById('attendanceRemixEmployeesList'),
    newDepartmentInput:     document.getElementById('attendanceRemixNewDepartmentInput'),
    addDepartmentBtn:       document.getElementById('attendanceRemixAddDepartmentBtn'),
    newMarkInput:           document.getElementById('attendanceRemixNewMarkInput'),
    newMarkDemeritInput:    document.getElementById('attendanceRemixNewMarkDemeritInput'),
    addMarkBtn:             document.getElementById('attendanceRemixAddMarkBtn'),
    newEmployeeName:        document.getElementById('attendanceRemixNewEmployeeName'),
    newEmployeeAdpName:     document.getElementById('attendanceRemixNewEmployeeAdpName'),
    newEmployeeDepartment:  document.getElementById('attendanceRemixNewEmployeeDepartment'),
    newEmployeeBirthday:    document.getElementById('attendanceRemixNewEmployeeBirthday'),
    newEmployeeSize:        document.getElementById('attendanceRemixNewEmployeeSize'),
    addEmployeeSaveBtn:     document.getElementById('attendanceRemixAddEmployeeSaveBtn'),
  };

  if (!els.deptTabs) return;

  let selectedDate = todayString();
  let activeTab = ALL_TAB;              // "All" is the default
  let settingsDraft = null;
  let editorDraft = null;

  /* ---- Helpers ---- */
  function clone(obj){ return JSON.parse(JSON.stringify(obj)); }
  function safeNum(v){ const n = Number(v); return Number.isFinite(n) ? n : 0; }

  function chipClass(mark){
    const m = String(mark).toLowerCase();
    if (m === 'present') return 'chip-present';
    if (m === 'late') return 'chip-late';
    if (m === 'absent') return 'chip-absent';
    if (m === 'excused') return 'chip-excused';
    if (m === 'call out') return 'chip-call-out';
    if (m === 'no call no show' || m === 'ncns') return 'chip-ncns';
    if (m === 'pto') return 'chip-pto';
    if (m === '') return 'chip-clear';
    return '';
  }

  function markBadgeClass(mark){
    if (!mark) return 'unmarked';
    const m = String(mark).toLowerCase();
    if (m === 'present') return 'present';
    if (m === 'late') return 'late';
    if (m === 'absent') return 'absent';
    if (m === 'excused') return 'excused';
    if (m === 'call out') return 'call-out';
    if (m === 'no call no show' || m === 'ncns') return 'ncns';
    if (m === 'pto') return 'pto';
    return 'unmarked';
  }

  function loadSettings(){
    const raw = loadJson ? loadJson(settingsKey, null) : null;
    return {
      departments: Array.isArray(raw?.departments) && raw.departments.length ? raw.departments : [...departments],
      marks: Array.isArray(raw?.marks) && raw.marks.length ? raw.marks : [...markOptions],
      markDemerits: raw?.markDemerits && typeof raw.markDemerits === 'object' ? {...markDemerits, ...raw.markDemerits} : {...markDemerits},
    };
  }
  function persistSettings(settings){ saveJson(settingsKey, settings); }

  function applySettingsToGlobals(settings){
    departments.splice(0, departments.length, ...settings.departments.filter(Boolean));
    markOptions.splice(0, markOptions.length, ...settings.marks.filter(Boolean));
    Object.keys(markDemerits).forEach(key => { delete markDemerits[key]; });
    settings.marks.forEach(mark => { markDemerits[mark] = safeNum(settings.markDemerits[mark]); });
    if (!departments.includes(activeAttendanceDepartment)) {
      activeAttendanceDepartment = departments[0] || 'Receiving';
    }
    employees = normalizeEmployees((employees || []).map(emp => ({
      ...emp,
      department: departments.includes(emp.department) ? emp.department : (departments[0] || 'Receiving')
    })));
    saveEmployees();
  }

  function getDepartmentRoster(dept){
    return getActiveEmployees().filter(emp => emp.department === dept).sort((a,b) => a.name.localeCompare(b.name));
  }

  function getAllRoster(){
    return getActiveEmployees().sort((a,b) => a.name.localeCompare(b.name));
  }

  function getRecord(name, dept, date){
    return attendanceRecords.find(r => r.employeeName === name && r.department === dept && r.date === date) || null;
  }

  function upsertRecord(name, dept, date, mark, options = {}){
    const shouldSync = options.sync !== false;
    attendanceRecords = attendanceRecords.filter(r => !(r.employeeName === name && r.department === dept && r.date === date));
    if (mark) {
      attendanceRecords.push({ id: Date.now() + Math.random(), employeeName: name, department: dept, date, mark, demerits: safeNum(markDemerits[mark]) });
    }
    saveJson(attendanceStorageKey, attendanceRecords);
    // PATCH: propagate to Neon via the shared sync path
    if (shouldSync) {
      if (typeof flushAttendanceSync === 'function') flushAttendanceSync(); else if (typeof scheduleAttendanceSync === 'function') scheduleAttendanceSync();
    }
  }

  function formatDateLabel(dateStr){
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric', year:'numeric' });
  }

  function shiftDate(days){
    const d = new Date(selectedDate + 'T00:00:00');
    d.setDate(d.getDate() + days);
    selectedDate = d.toISOString().slice(0,10);
    syncDateInputs();
    renderRemix();
  }

  function syncDateInputs(){
    els.dateInput.value = selectedDate;
    els.dateLabel.textContent = formatDateLabel(selectedDate);
    if (els.editorDateInput) els.editorDateInput.value = selectedDate;
    if (els.editorDateLabel) els.editorDateLabel.textContent = formatDateLabel(selectedDate);
  }

  /* ---- Get the effective dept for the current tab ---- */
  function isAllTab(){ return activeTab === ALL_TAB; }
  function currentDept(){ return isAllTab() ? departments[0] || 'Receiving' : activeTab; }

  /* ==================================
     RENDER: Department Tabs (All first)
     ================================== */
  function renderDeptTabs(){
    els.deptTabs.innerHTML = '';

    // "All" tab
    const allBtn = document.createElement('button');
    allBtn.className = 'attendance-remix-dept-btn' + (isAllTab() ? ' active' : '');
    allBtn.type = 'button';
    allBtn.textContent = 'All';
    allBtn.addEventListener('click', () => { activeTab = ALL_TAB; renderRemix(); });
    els.deptTabs.appendChild(allBtn);

    // Department tabs
    departments.forEach(dept => {
      const btn = document.createElement('button');
      btn.className = 'attendance-remix-dept-btn' + (activeTab === dept ? ' active' : '');
      btn.type = 'button';
      btn.textContent = dept;
      btn.addEventListener('click', () => { activeTab = dept; activeAttendanceDepartment = dept; renderRemix(); });
      els.deptTabs.appendChild(btn);
    });
  }

  /* ==================================
     RENDER: Stats
     ================================== */
  function renderStats(){
    const roster = isAllTab() ? getAllRoster() : getDepartmentRoster(activeTab);
    const todays = roster.map(emp => getRecord(emp.name, emp.department, selectedDate)).filter(Boolean);
    const present = todays.filter(r => r.mark === 'Present').length;
    const unmarked = Math.max(0, roster.length - todays.length);
    const absent = todays.filter(r => /absent|call out|no call/i.test(r.mark)).length;
    const late = todays.filter(r => r.mark === 'Late').length;
    const demerits = todays.reduce((sum, r) => sum + safeNum(r.demerits), 0);

    const cards = [
      { lbl:'Roster', num: roster.length, sub: isAllTab() ? 'All active employees' : 'People in dept' },
      { lbl:'Present', num: present, sub:'Marked present' },
      { lbl:'Late', num: late, sub:'Late today' },
      { lbl:'Absent / Out', num: absent, sub:'Absent, call out, NCNS' },
      { lbl:'Unmarked', num: unmarked, sub:'No status yet' },
      { lbl:'Demerits', num: demerits, sub:'Auto-calculated' },
    ];

    els.stats.innerHTML = cards.map(c => `
      <div class="attendance-remix-stat-card">
        <div class="stat-lbl">${c.lbl}</div>
        <div class="stat-num">${c.num}</div>
        <div class="stat-sub">${c.sub}</div>
      </div>
    `).join('');
  }

  /* ==============================================
     RENDER: At-a-Glance Summary Data Sheet
     (replaces the old roster list)
     ============================================== */
  function getEmployeeStats(emp){
    const empRecords = attendanceRecords.filter(r => r.employeeName === emp.name && r.department === emp.department);
    const totalDays = empRecords.length;
    const present = empRecords.filter(r => r.mark === 'Present').length;
    const late = empRecords.filter(r => r.mark === 'Late').length;
    const absent = empRecords.filter(r => r.mark === 'Absent').length;
    const callOut = empRecords.filter(r => r.mark === 'Call Out').length;
    const ncns = empRecords.filter(r => /no call/i.test(r.mark)).length;
    const excused = empRecords.filter(r => r.mark === 'Excused').length;
    const pto = empRecords.filter(r => /pto/i.test(r.mark)).length;
    const totalDemerits = empRecords.reduce((sum, r) => sum + safeNum(r.demerits), 0);

    // Today's mark
    const todayRecord = getRecord(emp.name, emp.department, selectedDate);
    const todayMark = todayRecord?.mark || '';

    return { totalDays, present, late, absent, callOut, ncns, excused, pto, totalDemerits, todayMark };
  }

  function renderSummary(){
    const roster = isAllTab() ? getAllRoster() : getDepartmentRoster(activeTab);
    const title = isAllTab() ? 'Warehouse Overview — All Employees' : activeTab + ' — At a Glance';
    els.summaryTitle.textContent = title;

    if (!roster.length){
      els.summaryHead.innerHTML = '';
      els.summaryBody.innerHTML = '<tr><td colspan="12" style="text-align:center;padding:32px;color:#94a3b8;">No employees found. Open Settings (⚙) to add people.</td></tr>';
      return;
    }

    // Table header — show Department column when "All" tab
    const deptCol = isAllTab() ? '<th>Department</th>' : '';
    els.summaryHead.innerHTML = `<tr>
      <th>Employee</th>
      ${deptCol}
      <th>Today</th>
      <th>Days Tracked</th>
      <th>Present</th>
      <th>Late</th>
      <th>Absent</th>
      <th>Call Out</th>
      <th>NCNS</th>
      <th>Excused</th>
      <th>Demerits</th>
    </tr>`;

    els.summaryBody.innerHTML = roster.map(emp => {
      const s = getEmployeeStats(emp);
      const todayBadge = s.todayMark
        ? `<span class="attendance-remix-mark-badge ${markBadgeClass(s.todayMark)}">${escapeHtml(s.todayMark)}</span>`
        : `<span class="attendance-remix-mark-badge unmarked">—</span>`;
      const deptTd = isAllTab() ? `<td>${escapeHtml(emp.department)}</td>` : '';
      const demeritClass = s.totalDemerits > 0 ? (s.totalDemerits >= 3 ? ' style="color:#dc2626;font-weight:900;"' : ' style="color:#d97706;font-weight:700;"') : '';
      return `<tr>
        <td class="summary-name-cell">${escapeHtml(emp.name)}</td>
        ${deptTd}
        <td>${todayBadge}</td>
        <td>${s.totalDays}</td>
        <td>${s.present}</td>
        <td>${s.late || '—'}</td>
        <td>${s.absent || '—'}</td>
        <td>${s.callOut || '—'}</td>
        <td>${s.ncns || '—'}</td>
        <td>${s.excused || '—'}</td>
        <td${demeritClass}>${s.totalDemerits}</td>
      </tr>`;
    }).join('');
  }

  /* ==================================
     MASTER RENDER
     ================================== */
  function renderRemix(){
    syncDateInputs();
    renderDeptTabs();
    renderStats();
    renderSummary();
  }

  /* ==================================
     EDITOR POPUP (blue overlay)
     ================================== */
  function openEditor(){
    // If "All" tab is selected, default to first department for the editor
    const editorDept = isAllTab() ? (departments[0] || 'Receiving') : activeTab;
    activeAttendanceDepartment = editorDept;
    const roster = getDepartmentRoster(editorDept);
    editorDraft = {};
    roster.forEach(emp => { editorDraft[emp.name] = getRecord(emp.name, editorDept, selectedDate)?.mark || ''; });
    els.editorTitle.textContent = editorDept + ' — Attendance Editor';
    syncDateInputs();
    renderEditorTable();
    renderEditorDeptTabs();
    els.editorBackdrop.classList.add('show');
  }

  function renderEditorDeptTabs(){
    let container = document.getElementById('attendanceRemixEditorDeptTabs');
    if (!container){
      // Create dept tabs inside the editor popup if not present
      const datebar = els.editorBackdrop.querySelector('.attendance-remix-popup-datebar');
      if (datebar){
        container = document.createElement('div');
        container.id = 'attendanceRemixEditorDeptTabs';
        container.className = 'attendance-remix-editor-dept-tabs';
        datebar.parentNode.insertBefore(container, datebar.nextSibling);
      }
    }
    if (!container) return;

    container.innerHTML = departments.map(dept => {
      const active = dept === activeAttendanceDepartment ? ' active' : '';
      return `<button class="attendance-remix-dept-btn${active}" type="button" data-editor-dept="${escapeHtml(dept)}">${escapeHtml(dept)}</button>`;
    }).join('');

    container.querySelectorAll('[data-editor-dept]').forEach(btn => {
      btn.addEventListener('click', () => {
        activeAttendanceDepartment = btn.getAttribute('data-editor-dept');
        const roster = getDepartmentRoster(activeAttendanceDepartment);
        editorDraft = {};
        roster.forEach(emp => { editorDraft[emp.name] = getRecord(emp.name, activeAttendanceDepartment, selectedDate)?.mark || ''; });
        els.editorTitle.textContent = activeAttendanceDepartment + ' — Attendance Editor';
        renderEditorTable();
        renderEditorDeptTabs();
      });
    });
  }

  function renderEditorTable(){
    const roster = getDepartmentRoster(activeAttendanceDepartment);
    if (!roster.length){
      els.editorTable.innerHTML = '<div class="attendance-remix-empty-state">No employees in this department.</div>';
      return;
    }
    els.editorTable.innerHTML = roster.map(emp => {
      const current = editorDraft?.[emp.name] || '';
      const allMarks = [''].concat(markOptions);
      const chips = allMarks.map(mark => {
        const label = mark || 'Clear';
        const active = current === mark ? ' active' : '';
        const cc = chipClass(mark);
        return `<button class="attendance-remix-chip ${cc}${active}" type="button" data-employee="${escapeHtml(emp.name)}" data-mark="${escapeHtml(mark)}">${escapeHtml(label)}</button>`;
      }).join('');
      return `
        <div class="attendance-remix-editor-row">
          <div class="attendance-remix-editor-name">${escapeHtml(emp.name)}</div>
          <div class="attendance-remix-chip-row">${chips}</div>
        </div>
      `;
    }).join('');

    els.editorTable.querySelectorAll('.attendance-remix-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        editorDraft[btn.getAttribute('data-employee')] = btn.getAttribute('data-mark');
        renderEditorTable();
      });
    });
  }

  function saveEditor(){
    Object.entries(editorDraft || {}).forEach(([name, mark]) => {
      upsertRecord(name, activeAttendanceDepartment, selectedDate, mark);
    });
    closeEditor();
    afterRosterChange();
  }

  function clearSelectedDay(){
    const roster = getDepartmentRoster(activeAttendanceDepartment).map(emp => emp.name);
    attendanceRecords = attendanceRecords.filter(r => !(r.department === activeAttendanceDepartment && r.date === selectedDate && roster.includes(r.employeeName)));
    saveJson(attendanceStorageKey, attendanceRecords);
    // PATCH: propagate to Neon via the shared sync path
    if (typeof flushAttendanceSync === 'function') flushAttendanceSync(); else if (typeof scheduleAttendanceSync === 'function') scheduleAttendanceSync();
    if (editorDraft){ Object.keys(editorDraft).forEach(name => editorDraft[name] = ''); renderEditorTable(); }
    afterRosterChange();
  }

  function closeEditor(){ els.editorBackdrop.classList.remove('show'); }

  /* ==================================
     SETTINGS POPUP
     ================================== */
  function openSettings(){
    const settings = loadSettings();
    settingsDraft = { departments: [...settings.departments], marks: [...settings.marks], markDemerits: {...settings.markDemerits}, employees: clone(employees) };
    renderSettings();
    els.settingsBackdrop.classList.add('show');
  }
  function closeSettings(){ els.settingsBackdrop.classList.remove('show'); }

  function renderSettings(){
    els.newEmployeeDepartment.innerHTML = settingsDraft.departments.map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');
    els.newEmployeeSize.innerHTML = sizeOptions.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s || 'Size')}</option>`).join('');

    els.departmentsList.innerHTML = settingsDraft.departments.map((dept, idx) => `
      <div class="attendance-remix-setting-item">
        <input data-dept-index="${idx}" value="${escapeHtml(dept)}" />
        <button class="remove-btn" type="button" data-remove-dept="${idx}">✕</button>
      </div>
    `).join('') || '<div class="attendance-remix-empty-state" style="padding:12px;">No departments.</div>';

    els.marksList.innerHTML = settingsDraft.marks.map((mark, idx) => `
      <div class="attendance-remix-setting-item">
        <input data-mark-index="${idx}" value="${escapeHtml(mark)}" style="flex:1.5;" />
        <input data-demerit-index="${idx}" type="number" step="0.5" value="${safeNum(settingsDraft.markDemerits[mark])}" style="max-width:80px;" title="Demerits" />
        <button class="remove-btn" type="button" data-remove-mark="${idx}">✕</button>
      </div>
    `).join('') || '<div class="attendance-remix-empty-state" style="padding:12px;">No marks.</div>';

    els.employeesList.innerHTML = settingsDraft.employees.map((emp, idx) => `
      <div class="attendance-remix-setting-item attendance-remix-emp-row">
        <input data-emp-name="${idx}" value="${escapeHtml(emp.name)}" />
        <input data-emp-adp-name="${idx}" value="${escapeHtml(emp.adpName || '')}" placeholder="ADP name (e.g. Last, First)" title="ADP Name — how this person appears in ADP exports" />
        <select data-emp-dept="${idx}">
          ${settingsDraft.departments.map(d => `<option value="${escapeHtml(d)}" ${emp.department===d?'selected':''}>${escapeHtml(d)}</option>`).join('')}
        </select>
        <input data-emp-birthday="${idx}" type="date" value="${escapeHtml(emp.birthday || '')}" />
        <select data-emp-size="${idx}">
          ${sizeOptions.map(s => `<option value="${escapeHtml(s)}" ${String(emp.size||'')===s?'selected':''}>${escapeHtml(s || 'Size')}</option>`).join('')}
        </select>
        <button class="remove-btn" type="button" data-remove-emp="${idx}">✕</button>
      </div>
    `).join('') || '<div class="attendance-remix-empty-state" style="padding:12px;">No employees.</div>';

    bindSettingsEvents();
  }

  function bindSettingsEvents(){
    els.departmentsList.querySelectorAll('[data-remove-dept]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (settingsDraft.departments.length <= 1) { alert('Keep at least one department.'); return; }
        const idx = Number(btn.getAttribute('data-remove-dept'));
        const removed = settingsDraft.departments[idx];
        const fallback = settingsDraft.departments.find((_, i) => i !== idx);
        settingsDraft.departments.splice(idx, 1);
        settingsDraft.employees = settingsDraft.employees.map(emp => ({ ...emp, department: emp.department === removed ? fallback : emp.department }));
        renderSettings();
      });
    });
    els.marksList.querySelectorAll('[data-remove-mark]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (settingsDraft.marks.length <= 1) { alert('Keep at least one mark.'); return; }
        const idx = Number(btn.getAttribute('data-remove-mark'));
        delete settingsDraft.markDemerits[settingsDraft.marks[idx]];
        settingsDraft.marks.splice(idx, 1);
        renderSettings();
      });
    });
    els.employeesList.querySelectorAll('[data-remove-emp]').forEach(btn => {
      btn.addEventListener('click', () => {
        settingsDraft.employees.splice(Number(btn.getAttribute('data-remove-emp')), 1);
        renderSettings();
      });
    });
  }

  function captureSettingsInputs(){
    settingsDraft.departments = Array.from(els.departmentsList.querySelectorAll('[data-dept-index]')).map(input => input.value.trim()).filter(Boolean);
    const markNames = Array.from(els.marksList.querySelectorAll('[data-mark-index]')).map(input => input.value.trim()).filter(Boolean);
    const demeritInputs = Array.from(els.marksList.querySelectorAll('[data-demerit-index]'));
    const nextMarkDemerits = {};
    markNames.forEach((mark, idx) => { nextMarkDemerits[mark] = safeNum(demeritInputs[idx]?.value); });
    settingsDraft.marks = markNames;
    settingsDraft.markDemerits = nextMarkDemerits;
    settingsDraft.employees = Array.from(els.employeesList.querySelectorAll('[data-emp-name]')).map((input, idx) => ({
      name: input.value.trim(),
      adpName: (els.employeesList.querySelector(`[data-emp-adp-name="${idx}"]`)?.value || '').trim(),
      department: els.employeesList.querySelector(`[data-emp-dept="${idx}"]`)?.value || settingsDraft.departments[0],
      birthday: els.employeesList.querySelector(`[data-emp-birthday="${idx}"]`)?.value || '',
      size: els.employeesList.querySelector(`[data-emp-size="${idx}"]`)?.value || '',
      active: true
    })).filter(emp => emp.name);
  }

  function saveSettings(){
    captureSettingsInputs();
    if (!settingsDraft.departments.length) { alert('Add at least one department.'); return; }
    if (!settingsDraft.marks.length) { alert('Add at least one mark.'); return; }
    employees = normalizeEmployees(settingsDraft.employees);
    saveEmployees();
    persistSettings({ departments: settingsDraft.departments, marks: settingsDraft.marks, markDemerits: settingsDraft.markDemerits });
    applySettingsToGlobals(loadSettings());
    closeSettings();
    afterRosterChange();
  }

  function addDepartment(){
    const value = (els.newDepartmentInput.value || '').trim();
    if (!value) return;
    if (settingsDraft.departments.some(d => d.toLowerCase() === value.toLowerCase())) { alert('Already exists.'); return; }
    settingsDraft.departments.push(value);
    els.newDepartmentInput.value = '';
    renderSettings();
  }

  function addMark(){
    const mark = (els.newMarkInput.value || '').trim();
    if (!mark) return;
    if (settingsDraft.marks.some(m => m.toLowerCase() === mark.toLowerCase())) { alert('Already exists.'); return; }
    settingsDraft.marks.push(mark);
    settingsDraft.markDemerits[mark] = safeNum(els.newMarkDemeritInput.value);
    els.newMarkInput.value = '';
    els.newMarkDemeritInput.value = '';
    renderSettings();
  }

  function addEmployeeFromSettings(){
    const name = (els.newEmployeeName.value || '').trim();
    if (!name) return;
    if (settingsDraft.employees.some(emp => emp.name.toLowerCase() === name.toLowerCase())) { alert('Employee already exists.'); return; }
    const adpName = (els.newEmployeeAdpName ? (els.newEmployeeAdpName.value || '').trim() : '');
    settingsDraft.employees.push({ name, adpName, department: els.newEmployeeDepartment.value || settingsDraft.departments[0], birthday: els.newEmployeeBirthday.value || '', size: els.newEmployeeSize.value || '', active: true });
    els.newEmployeeName.value = '';
    if (els.newEmployeeAdpName) els.newEmployeeAdpName.value = '';
    els.newEmployeeBirthday.value = '';
    els.newEmployeeSize.value = '';
    renderSettings();
  }

  function afterRosterChange(){
    if (typeof renderAttendance === 'function') renderAttendance();
    if (typeof renderEmployees === 'function') renderEmployees();
    if (typeof renderErrors === 'function') renderErrors();
    if (typeof renderHome === 'function') renderHome();
    if (typeof renderCalendar === 'function') renderCalendar();
    updateErrorDepartmentDropdowns();
    renderRemix();
  }

  function updateErrorDepartmentDropdowns(){
    const errorDepartmentInput = document.getElementById('errorDepartment');
    const errorsDepartmentFilterInput = document.getElementById('errorsDepartmentFilter');
    if (errorDepartmentInput){
      errorDepartmentInput.innerHTML = departments.map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');
      if (!departments.includes(errorDepartmentInput.value)) errorDepartmentInput.value = departments[0] || '';
    }
    if (errorsDepartmentFilterInput){
      errorsDepartmentFilterInput.innerHTML = ['<option value="All">All Departments</option>'].concat(departments.map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`)).join('');
    }
  }

  function quickMarkAllPresent(){
    const dept = isAllTab() ? (departments[0] || 'Receiving') : activeTab;
    getDepartmentRoster(dept).forEach(emp => {
      upsertRecord(emp.name, dept, selectedDate, 'Present', { sync: false });
    });
    if (typeof flushAttendanceSync === 'function') flushAttendanceSync(); else if (typeof scheduleAttendanceSync === 'function') scheduleAttendanceSync();
    afterRosterChange();
  }

  /* ==================================
     INIT
     ================================== */
  function init(){
    const settings = loadSettings();
    applySettingsToGlobals(settings);
    if (!departments.includes(activeAttendanceDepartment)) activeAttendanceDepartment = departments[0] || 'Receiving';
    activeTab = ALL_TAB; // Default to "All"
    selectedDate = todayString();
    syncDateInputs();
    afterRosterChange();

    els.dateInput.addEventListener('change', () => { selectedDate = els.dateInput.value || todayString(); renderRemix(); });
    els.todayBtn.addEventListener('click', () => { selectedDate = todayString(); renderRemix(); });
    els.prevBtn.addEventListener('click', () => shiftDate(-1));
    els.nextBtn.addEventListener('click', () => shiftDate(1));
    els.openEditorBtn.addEventListener('click', openEditor);
    els.openSettingsBtn.addEventListener('click', openSettings);
    els.quickPresentBtn.addEventListener('click', quickMarkAllPresent);

    if (els.employeesMergedGoBtn) {
      els.employeesMergedGoBtn.addEventListener('click', () => {
        const btn = document.querySelector('[data-page="attendancePage"]');
        if (btn) btn.click();
        openSettings();
      });
    }

    els.editorCloseBtn.addEventListener('click', closeEditor);
    els.editorCancelBtn.addEventListener('click', closeEditor);
    els.editorSaveBtn.addEventListener('click', saveEditor);
    els.editorPrevBtn.addEventListener('click', () => { shiftDate(-1); openEditor(); });
    els.editorTodayBtn.addEventListener('click', () => { selectedDate = todayString(); renderRemix(); openEditor(); });
    els.editorNextBtn.addEventListener('click', () => { shiftDate(1); openEditor(); });
    els.editorDateInput.addEventListener('change', () => { selectedDate = els.editorDateInput.value || todayString(); renderRemix(); openEditor(); });
    els.editorClearBtn.addEventListener('click', () => { if (confirm(`Clear all attendance for ${activeAttendanceDepartment} on ${selectedDate}?`)) clearSelectedDay(); });
    els.editorBackdrop.addEventListener('click', (e) => { if (e.target === els.editorBackdrop) closeEditor(); });

    els.settingsCloseBtn.addEventListener('click', closeSettings);
    els.settingsCancelBtn.addEventListener('click', closeSettings);
    els.settingsSaveBtn.addEventListener('click', saveSettings);
    els.addDepartmentBtn.addEventListener('click', addDepartment);
    els.addMarkBtn.addEventListener('click', addMark);
    els.addEmployeeSaveBtn.addEventListener('click', addEmployeeFromSettings);
    els.settingsBackdrop.addEventListener('click', (e) => { if (e.target === els.settingsBackdrop) closeSettings(); });

    const employeesNav = document.querySelector('.nav-btn[data-page="employeesPage"]');
    if (employeesNav){
      employeesNav.addEventListener('click', () => { setTimeout(() => { openSettings(); }, 0); });
    }
  }

  window.attendanceRemixRefresh = afterRosterChange;
  init();
})();
