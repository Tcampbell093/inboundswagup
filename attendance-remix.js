
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
    // Note: the legacy `employees` array is no longer the roster source —
    // accountRoster (from user accounts) is. We don't rewrite employees here.
  }

  function getDepartmentRoster(dept){
    return effectiveRoster().filter(emp => emp.department === dept).sort((a,b) => a.name.localeCompare(b.name));
  }

  function getAllRoster(){
    return effectiveRoster().sort((a,b) => a.name.localeCompare(b.name));
  }

  /* ────────────────────────────────────────────────────────────────
     USER-ACCOUNT-DERIVED ROSTER
     The roster is the list of users whose role is manager, l1, or l2.
     Admins and Externals are excluded. Names come from the user account
     (data.name) — never re-typed in attendance. Department per user is
     persisted in localStorage.hcUserDepartments keyed by email so the
     assignment survives reloads.

     If the fetch hasn't returned yet (cold start), we render with an
     empty roster rather than the legacy local employees[] array — the
     old typed-in names are no longer the source of truth.
     ──────────────────────────────────────────────────────────────── */
  const USER_DEPT_KEY = 'hcUserDepartments';
  let accountRoster = []; // [{ name, email, role, suspended }]
  let accountRosterLoaded = false;

  function loadUserDeptMap(){
    try { return JSON.parse(localStorage.getItem(USER_DEPT_KEY) || '{}') || {}; } catch(_) { return {}; }
  }
  function saveUserDeptMap(map){
    try { localStorage.setItem(USER_DEPT_KEY, JSON.stringify(map || {})); } catch(_) {}
  }
  function setUserDepartment(email, dept){
    if (!email) return;
    const map = loadUserDeptMap();
    map[email.toLowerCase()] = dept;
    saveUserDeptMap(map);
  }

  // Build the runtime roster the rest of the module reads from. Each entry:
  // { name, email, department, active }. Department comes from the local
  // assignment map; if unset, defaults to the first department.
  function effectiveRoster(){
    if (!accountRosterLoaded) return [];
    const map = loadUserDeptMap();
    const fallbackDept = departments[0] || 'Receiving';
    return accountRoster
      .filter(u => !u.suspended)
      .map(u => ({
        name: u.name || u.email,
        email: u.email,
        department: map[(u.email || '').toLowerCase()] || fallbackDept,
        active: true,
      }));
  }

  // Fetch the user list from the same API Settings uses, filter to roles
  // that count for attendance (manager / l1 / l2), then re-render.
  async function fetchAccountRoster(){
    try {
      const token = (function(){
        try { return JSON.parse(localStorage.getItem('hcAuthUser') || '{}').token || null; } catch(_) { return null; }
      })();
      if (!token) { accountRosterLoaded = true; renderRemix(); return; }
      const res = await fetch('/.netlify/functions/users?action=list', {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      if (!res.ok) { accountRosterLoaded = true; renderRemix(); return; }
      const data = await res.json();
      const users = Array.isArray(data?.users) ? data.users : [];
      const ATTENDANCE_ROLES = new Set(['manager','l1','l2']);
      accountRoster = users
        .filter(u => ATTENDANCE_ROLES.has(String(u.role||'').toLowerCase()))
        .map(u => ({
          name:      String(u.name || u.displayName || u.email || '').trim(),
          email:     String(u.email || '').trim().toLowerCase(),
          role:      u.role,
          suspended: !!u.suspended,
        }))
        .filter(u => u.email);
      accountRosterLoaded = true;
      renderRemix();
    } catch (_) {
      // On failure, leave the roster empty rather than falling back to the
      // legacy typed-in list — accounts are the only source of truth now.
      accountRosterLoaded = true;
      renderRemix();
    }
  }

  // Expose for the (deprecated) employee settings UI to refresh after edits
  window.attendanceRemixRefreshRoster = fetchAccountRoster;

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
    // settingsDraft.employees is no longer used — the roster is read live
    // from accountRoster (user accounts) in renderSettings. Keep the key
    // as an empty array so any stray reference doesn't error.
    settingsDraft = { departments: [...settings.departments], marks: [...settings.marks], markDemerits: {...settings.markDemerits}, employees: [] };
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

    // ── Employees list ───────────────────────────────────────────
    // Names come from user accounts (manager/l1/l2). They can't be added,
    // renamed, or removed from here — that happens in Settings → User
    // Management. Department is editable per user and persists in
    // localStorage.hcUserDepartments.
    const userDeptMap = loadUserDeptMap();
    const fallbackDept = settingsDraft.departments[0] || 'Receiving';
    const rosterForEditor = accountRoster
      .filter(u => !u.suspended)
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));

    const employeesIntro = `
      <div style="background:#f0f6ff;border:1px solid #cfe0f4;border-radius:8px;padding:10px 12px;margin-bottom:10px;font-size:12px;color:#0c447c;line-height:1.4;">
        <strong>Names come from user accounts</strong> with role Manager, Associate L1, or Associate L2.
        To add an associate, invite them in <em>Settings → User Management</em>.
        Department assignment below is local to attendance.
      </div>
    `;

    if (!accountRosterLoaded) {
      els.employeesList.innerHTML = employeesIntro +
        '<div class="attendance-remix-empty-state" style="padding:12px;">Loading roster from user accounts…</div>';
    } else if (!rosterForEditor.length) {
      els.employeesList.innerHTML = employeesIntro +
        '<div class="attendance-remix-empty-state" style="padding:12px;">No users with role Manager, L1, or L2 yet. Invite associates via <em>Settings → User Management</em>.</div>';
    } else {
      els.employeesList.innerHTML = employeesIntro + rosterForEditor.map((u, idx) => {
        const currentDept = userDeptMap[u.email] || fallbackDept;
        return `
          <div class="attendance-remix-setting-item attendance-remix-emp-row" style="display:flex;align-items:center;gap:10px;">
            <div style="flex:1;min-width:0;">
              <div style="font-size:13px;font-weight:700;color:#0f172a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(u.name)}</div>
              <div style="font-size:11px;color:#64748b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(u.email)}</div>
            </div>
            <select data-user-dept="${escapeHtml(u.email)}" style="min-width:160px;height:36px;padding:0 10px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:#0f172a;font-size:13px;">
              ${settingsDraft.departments.map(d => `<option value="${escapeHtml(d)}" ${currentDept===d?'selected':''}>${escapeHtml(d)}</option>`).join('')}
            </select>
          </div>
        `;
      }).join('');
    }

    // Hide the legacy "Add employee" row inputs — invites happen in User Management
    if (els.newEmployeeName)        els.newEmployeeName.closest('.attendance-remix-setting-item, .attendance-remix-emp-row')?.style.setProperty('display','none');
    if (els.addEmployeeSaveBtn)     els.addEmployeeSaveBtn.style.display = 'none';

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
        // Re-point any user-dept assignment that was on the removed dept
        // to the fallback dept. This keeps attendance consistent after a
        // department is deleted.
        const map = loadUserDeptMap();
        Object.keys(map).forEach(email => {
          if (map[email] === removed) map[email] = fallback;
        });
        saveUserDeptMap(map);
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
    // Per-user dept change auto-saves (no need to click Save to commit)
    els.employeesList.querySelectorAll('[data-user-dept]').forEach(sel => {
      sel.addEventListener('change', () => {
        const email = (sel.getAttribute('data-user-dept') || '').trim().toLowerCase();
        if (!email) return;
        setUserDepartment(email, sel.value);
        afterRosterChange();
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
    // Per-user department assignments: read each <select data-user-dept="email">
    // and write into the localStorage hcUserDepartments map. We no longer
    // touch the legacy settingsDraft.employees array — that field is dead.
    const deptMap = loadUserDeptMap();
    els.employeesList.querySelectorAll('[data-user-dept]').forEach(sel => {
      const email = (sel.getAttribute('data-user-dept') || '').trim().toLowerCase();
      const dept  = sel.value || (settingsDraft.departments[0] || 'Receiving');
      if (email) deptMap[email] = dept;
    });
    saveUserDeptMap(deptMap);
  }

  function saveSettings(){
    captureSettingsInputs();
    if (!settingsDraft.departments.length) { alert('Add at least one department.'); return; }
    if (!settingsDraft.marks.length) { alert('Add at least one mark.'); return; }
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
    // Manual roster adds are deprecated. Names come from user accounts —
    // direct people to Settings → User Management to invite a new associate.
    alert('To add an associate, invite them in Settings → User Management.\n\nUsers with role Manager, Associate L1, or Associate L2 automatically appear in the attendance roster.');
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

    // One-shot migration: the first time this version runs, wipe the legacy
    // typed-in roster and any attendance records keyed to those old names.
    // The new source of truth is the user-accounts list; old records would
    // orphan against new account names.
    const MIGRATION_FLAG = 'hc_attendance_account_bind_v1';
    if (!localStorage.getItem(MIGRATION_FLAG)) {
      try {
        if (typeof employees !== 'undefined' && Array.isArray(employees)) {
          employees.length = 0;
          if (typeof saveEmployees === 'function') saveEmployees();
        }
        if (typeof attendanceRecords !== 'undefined' && Array.isArray(attendanceRecords)) {
          attendanceRecords.length = 0;
          if (typeof saveJson === 'function' && typeof attendanceStorageKey === 'string') {
            saveJson(attendanceStorageKey, attendanceRecords);
          }
        }
        localStorage.setItem(MIGRATION_FLAG, '1');
      } catch (_) {}
    }

    syncDateInputs();
    afterRosterChange();

    // Fetch the user list and re-render once accounts arrive.
    fetchAccountRoster();

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
