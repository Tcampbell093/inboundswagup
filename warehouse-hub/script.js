(() => {
  const API = '/.netlify/functions/hub-feed';
  const TOOLS_API = '/.netlify/functions/hub-tools';
  const TEAM_API = '/.netlify/functions/hub-team-admin';
  const FAIRSHIFT = 'https://fairshift-rotations.thandoyordani.chatgpt.site';
  const $ = (id) => document.getElementById(id);
  const todayDot = $('todayDot'), weekDot = $('weekDot'), bingoDot = $('bingoDot');
  const todayView = $('todayView'), weekView = $('weekView'), bingoView = $('bingoView');
  const sectionEyebrow = $('sectionEyebrow'), sectionTitle = $('sectionTitle'), sectionNote = $('sectionNote');

  let feed = { announcements: [], policies: [], cleaning: [] };
  let tools = [];
  let toolOrderDirty = false;
  let managerKey = '';
  let adminData = null;
  let toolAdminData = { tools: [] };
  let teamAdminData = { employees: [], departments: [] };
  let checkinTarget = null;

  const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const parseDate = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d, 12, 0, 0); };
  const fmtDay = (s) => parseDate(s).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const statusLabel = (s) => ({ scheduled: 'Scheduled', in_progress: 'In progress', completed: 'Completed', missed: 'Missed', reported_not_done: 'Not completed' }[s] || s || 'Scheduled');
  const today = () => ymd(new Date());

  function weekDates() {
    const now = new Date();
    const dow = now.getDay();
    const delta = dow === 0 ? -6 : 1 - dow;
    const mon = new Date(now);
    mon.setDate(now.getDate() + delta);
    mon.setHours(12, 0, 0, 0);
    return Array.from({ length: 5 }, (_, i) => { const d = new Date(mon); d.setDate(mon.getDate() + i); return ymd(d); });
  }
  function activeAnnouncements(date) { return feed.announcements.filter((a) => a.startDate <= date && (!a.endDate || a.endDate >= date)); }
  function policiesForDate(date) { return feed.policies.filter((p) => p.effectiveDate === date); }
  function currentPolicies() { const t = today(); return feed.policies.filter((p) => p.effectiveDate <= t).slice(0, 4); }

  function setView(view) {
    const isToday = view === 'today';
    const isWeek = view === 'week';
    const isBingo = view === 'bingo';

    todayDot.classList.toggle('active', isToday);
    weekDot.classList.toggle('active', isWeek);
    bingoDot.classList.toggle('active', isBingo);
    todayDot.setAttribute('aria-selected', String(isToday));
    weekDot.setAttribute('aria-selected', String(isWeek));
    bingoDot.setAttribute('aria-selected', String(isBingo));
    todayView.classList.toggle('active', isToday);
    weekView.classList.toggle('active', isWeek);
    bingoView.classList.toggle('active', isBingo);

    if (isBingo) {
      sectionEyebrow.textContent = 'Today at a glance';
      sectionTitle.textContent = 'Warehouse Bingo';
      sectionNote.textContent = 'Cleaning earns Bingo Coins. Spend them on random symbol draws.';
    } else if (isWeek) {
      sectionEyebrow.textContent = 'Week at a glance';
      sectionTitle.textContent = 'What’s happening this week';
      sectionNote.textContent = 'A Monday–Friday view of cleaning, announcements, reminders, and policy changes.';
    } else {
      sectionEyebrow.textContent = 'Today at a glance';
      sectionTitle.textContent = 'What the team needs to know';
      sectionNote.textContent = 'Cleaning responsibilities, announcements, and policy updates in one place.';
    }

    document.dispatchEvent(new CustomEvent('hub-view-changed', { detail: { view } }));
  }
  todayDot.addEventListener('click', () => setView('today'));
  weekDot.addEventListener('click', () => setView('week'));
  bingoDot.addEventListener('click', () => setView('bingo'));

  function actionForCleaning(r) {
    if (r.status === 'completed') return `<span class="checkin">${Number(r.creditMinutes || 15)} min ✓</span>`;
    if (!['scheduled', 'in_progress'].includes(r.status)) return '';
    const label = r.status === 'scheduled' ? 'Start' : 'Finish';
    if (r.source === 'fairshift') {
      const href = r.checkinUrl || `${FAIRSHIFT}/checkin?assignment=${encodeURIComponent(r.fairshiftId || '')}`;
      return `<a class="checkin" href="${escapeHtml(href)}">${label}</a>`;
    }
    return `<button class="checkin" type="button" data-checkin="${escapeHtml(r.id)}" data-date="${escapeHtml(r.date)}" data-name="${escapeHtml(r.employeeName)}" data-status="${escapeHtml(r.status)}">${label}</button>`;
  }

  function renderToday() {
    const t = today();
    const rows = feed.cleaning.filter((r) => r.date === t);
    const box = $('todayCleaning');
    box.innerHTML = rows.length
      ? rows.map((r) => `<div class="cleaning-row"><div class="area">${escapeHtml(r.area)}</div><div class="person">${escapeHtml(r.employeeName)}</div><span class="status ${escapeHtml(r.status)}">${escapeHtml(statusLabel(r.status))}</span>${actionForCleaning(r)}</div>`).join('')
      : `<div class="empty">${feed.cleaningSource === 'fairshift' ? 'No cleaning assignments are scheduled in FairShift for today.' : 'FairShift could not be reached, and no manual fallback assignments are available.'}</div>`;
    box.querySelectorAll('[data-checkin]').forEach((btn) => btn.addEventListener('click', () => openCheckin(btn.dataset)));

    const sourceLabel = $('cleaningSourceLabel');
    if (sourceLabel) sourceLabel.textContent = feed.cleaningSource === 'fairshift' ? 'Live from FairShift · 15 min credit' : 'FairShift connection unavailable · fallback view';

    const anns = activeAnnouncements(t).sort((a, b) => Number(b.pinned) - Number(a.pinned));
    $('announcementCount').textContent = `${anns.length} active`;
    $('todayAnnouncements').innerHTML = anns.length
      ? anns.map((a) => `<div class="notice"><div class="notice-meta">${a.pinned ? 'Pinned • ' : ''}${escapeHtml(a.department || 'All teams')}</div><h4>${escapeHtml(a.title)}</h4><p>${escapeHtml(a.message)}</p></div>`).join('')
      : '<div class="empty">No active announcements.</div>';

    const pol = currentPolicies();
    $('policyCount').textContent = `${pol.length} current`;
    $('todayPolicies').innerHTML = pol.length
      ? pol.map((p) => `<div class="policy-row"><div><div class="policy-title">${escapeHtml(p.title)}</div><div class="policy-meta">Effective ${escapeHtml(fmtDay(p.effectiveDate))} • ${escapeHtml(p.summary)}</div></div>${p.readRequired ? '<div class="ack">Read required</div>' : ''}</div>`).join('')
      : '<div class="empty">No policy updates have been published.</div>';
  }

  function renderWeek() {
    const dates = weekDates();
    const todayIso = today();
    $('weekTitle').textContent = `Week of ${fmtDay(dates[0])} – ${fmtDay(dates[4])}`;
    $('weekCalendar').innerHTML = dates.map((date) => {
      const clean = feed.cleaning.filter((r) => r.date === date);
      const ann = activeAnnouncements(date).filter((a) => a.startDate === date || a.pinned);
      const pol = policiesForDate(date);
      const events = [];
      clean.forEach((r, i) => events.push(`<div class="week-event"><div class="event-label">${i === 0 ? 'Cleaning' : ''}</div><div class="event-title">${escapeHtml(r.area)}</div><div class="event-meta">${escapeHtml(r.employeeName)} • ${escapeHtml(statusLabel(r.status))}</div></div>`));
      ann.slice(0, 3).forEach((a) => events.push(`<div class="week-event"><div class="event-label">Announcement</div><div class="event-title">${escapeHtml(a.title)}</div><div class="event-meta">${escapeHtml(a.department || 'All teams')}</div></div>`));
      pol.forEach((p) => events.push(`<div class="week-event"><div class="event-label">Policy</div><div class="event-title">${escapeHtml(p.title)}</div><div class="event-meta">${p.readRequired ? 'Read required' : 'Effective'}</div></div>`));
      if (!events.length) events.push('<div class="event-meta">Nothing published.</div>');
      return `<article class="day-column ${date === todayIso ? 'today-day' : ''}"><div class="day-head"><div class="day-name">${date === todayIso ? 'Today • ' : ''}${parseDate(date).toLocaleDateString(undefined, { weekday: 'long' })}</div><div class="day-date">${parseDate(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</div></div><div class="day-body">${events.join('')}</div></article>`;
    }).join('');
  }

  function render() { renderToday(); renderWeek(); }

  async function loadFeed() {
    try {
      const r = await fetch(API, { cache: 'no-store' });
      if (!r.ok) throw new Error('Hub data unavailable.');
      feed = await r.json();
      render();
    } catch (e) {
      $('todayCleaning').innerHTML = `<div class="empty">${escapeHtml(e.message || 'Hub data is unavailable.')}</div>`;
      $('todayAnnouncements').innerHTML = '<div class="empty">Unable to load announcements.</div>';
      $('todayPolicies').innerHTML = '<div class="empty">Unable to load policy updates.</div>';
      renderWeek();
    }
  }

  function toolCardHtml(tool) {
    const accentClass = tool.accent === 'green' ? ' green' : tool.accent === 'blue' ? ' blue' : '';
    return `<a class="tool-card${accentClass}" data-tool-id="${escapeHtml(tool.id || '')}" href="${escapeHtml(tool.url)}" target="_blank" rel="noopener"><div class="tool-top"><div class="iconbox">${escapeHtml(tool.icon || '◫')}</div><div class="open">Open ↗</div></div><div class="tool-label">${escapeHtml(tool.label || 'Team tool')}</div><h3>${escapeHtml(tool.title)}</h3><p>${escapeHtml(tool.description || `Open ${tool.title}.`)}</p></a>`;
  }

  function updateToolCount(count) {
    const badge = document.querySelector('.toolcount');
    if (badge) badge.innerHTML = `<span class="dot"></span> ${count} live tool${count === 1 ? '' : 's'}`;
  }

  function renderTools() {
    if (!tools.length) return;
    const grid = document.querySelector('.tool-grid');
    if (!grid) return;
    grid.innerHTML = tools.map(toolCardHtml).join('');
    updateToolCount(tools.length);
  }

  function appendFallbackInsertCards() {
    const grid = document.querySelector('.tool-grid');
    if (!grid || grid.querySelector('[data-fallback-insert-card]')) return;
    const fallback = [
      { title: 'Pending Insert Cards', url: 'https://swagup.lightning.force.com/lightning/o/Purchase_Order__c/list?filterName=SwagUp_Print', label: 'Salesforce list', description: 'Open the Pending Insert Cards list in Salesforce.', accent: 'orange', icon: '◫' },
      { title: 'Completed Insert Cards', url: 'https://swagup.lightning.force.com/lightning/r/Report/00ODu000000W9DYMA0/view', label: 'Salesforce report', description: 'Open the Completed Insert Cards report in Salesforce.', accent: 'green', icon: '▤' },
    ];
    fallback.forEach((tool) => {
      const holder = document.createElement('div');
      holder.setAttribute('data-fallback-insert-card', '1');
      holder.style.display = 'contents';
      holder.innerHTML = toolCardHtml(tool);
      grid.appendChild(holder);
    });
    updateToolCount(grid.querySelectorAll('.tool-card').length);
  }

  async function loadTools() {
    try {
      const r = await fetch(TOOLS_API, { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Tool cards unavailable.');
      tools = Array.isArray(j.tools) ? j.tools : [];
      renderTools();
    } catch (_) {
      appendFallbackInsertCards();
    }
  }

  document.querySelector('.tool-grid')?.addEventListener('click', (event) => {
    const card = event.target.closest('a[data-tool-id]');
    if (!card || !card.dataset.toolId) return;
    toolOrderDirty = true;
    const payload = JSON.stringify({ action: 'recordClick', id: card.dataset.toolId });
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(TOOLS_API, new Blob([payload], { type: 'application/json' }))) return;
    } catch (_) {}
    fetch(TOOLS_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true }).catch(() => {});
  });
  window.addEventListener('focus', () => {
    if (!toolOrderDirty) return;
    toolOrderDirty = false;
    loadTools();
  });

  function showMessage(id, text, error = false) {
    const el = $(id);
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('error', error);
    el.style.display = 'block';
  }

  function openCheckin(data) {
    checkinTarget = { assignmentId: data.checkin, date: data.date, employeeName: data.name, status: data.status };
    $('checkinName').value = data.name || '';
    $('checkinPin').value = '';
    $('checkinAssignment').textContent = `${data.name} • ${data.status === 'scheduled' ? 'Start' : 'Finish'} today’s cleaning assignment`;
    $('checkinSubmit').textContent = data.status === 'scheduled' ? 'Start cleaning' : 'Finish cleaning';
    $('checkinMessage').style.display = 'none';
    $('checkinDialog').showModal();
    $('checkinPin').focus();
  }

  $('checkinSubmit').addEventListener('click', async () => {
    if (!checkinTarget) return;
    const action = checkinTarget.status === 'scheduled' ? 'start' : 'finish';
    const body = {
      action: 'cleaningAction', cleaningAction: action, assignmentId: checkinTarget.assignmentId,
      date: checkinTarget.date, employeeName: $('checkinName').value.trim(), pin: $('checkinPin').value.trim(),
    };
    try {
      const r = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Check-in failed.');
      showMessage('checkinMessage', action === 'start' ? 'Cleaning started. Your status is now In progress.' : 'Cleaning completed. 15 minutes of credit were awarded.');
      await loadFeed();
      checkinTarget.status = j.result.status;
      $('checkinSubmit').disabled = true;
      setTimeout(() => { $('checkinDialog').close(); $('checkinSubmit').disabled = false; }, 900);
    } catch (e) {
      showMessage('checkinMessage', e.message || 'Check-in failed.', true);
    }
  });

  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => $(b.dataset.close)?.close()));

  function managerHeaders() {
    const headers = {};
    if (managerKey) headers['x-hub-key'] = managerKey;
    return headers;
  }

  async function adminFetch(body = null) {
    const opts = { headers: managerHeaders() };
    let url = `${API}?admin=1`;
    if (body) {
      url = API;
      opts.method = 'POST';
      opts.headers['content-type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const r = await fetch(url, opts);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Manager request failed.');
    return j;
  }

  async function toolAdminFetch(body = null) {
    const opts = { headers: managerHeaders() };
    let url = `${TOOLS_API}?admin=1`;
    if (body) {
      url = TOOLS_API;
      opts.method = 'POST';
      opts.headers['content-type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const r = await fetch(url, opts);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Tool card request failed.');
    return j;
  }

  async function teamAdminFetch(body = null) {
    const opts = { headers: managerHeaders(), cache: 'no-store' };
    let url = TEAM_API;
    if (body) {
      opts.method = 'POST';
      opts.headers['content-type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const r = await fetch(url, opts);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const error = new Error(j.error || 'Team management request failed.');
      error.bridgeMissing = !!j.bridgeMissing;
      throw error;
    }
    return j;
  }

  function inferToolMeta(title, url) {
    const name = String(title || '').trim() || 'Team Tool';
    const lower = String(url || '').toLowerCase();
    if (lower.includes('lightning.force.com')) {
      if (lower.includes('/lightning/r/report/')) return { label: 'Salesforce report', description: `Open the ${name} report in Salesforce.` };
      return { label: 'Salesforce list', description: `Open the ${name} list in Salesforce.` };
    }
    if (lower.includes('sharepoint.com')) return { label: 'Shared workbook', description: `Open the shared ${name} workbook.` };
    if (lower.includes('fairshift-rotations')) return { label: 'Labor planning', description: 'Plan team rotations, cleaning schedules, time off, and fair task assignments.' };
    if (lower.includes('overstock') || name.toLowerCase().includes('overstock')) return { label: 'Inbound workflow', description: `Open Houston directly to the ${name} section of the inbound module.` };
    if (lower.includes('inboundswagup.netlify.app')) return { label: 'Warehouse control', description: `Open ${name} in Houston Control.` };
    return { label: 'Team tool', description: `Open ${name}.` };
  }


  function teamDepartmentOptions(selected = '') {
    const departments = Array.isArray(teamAdminData?.departments) ? teamAdminData.departments : [];
    return ['Unassigned', ...departments.map((d) => d.name)]
      .map((name) => `<option value="${escapeHtml(name)}"${name === selected ? ' selected' : ''}>${escapeHtml(name)}</option>`)
      .join('');
  }

  function injectTeamManager() {
    if ($('teamManagerSection')) return;
    const managerGrid = document.querySelector('.manager-grid');
    if (!managerGrid) return;

    const style = document.createElement('style');
    style.textContent = `
      .team-manager-section{grid-column:1/-1}
      .team-manager-note{margin:-5px 0 15px;line-height:1.5}
      .team-add-grid{display:grid;grid-template-columns:1.3fr 1fr .8fr auto;gap:9px;align-items:end}
      .team-person-row{display:grid;grid-template-columns:1.25fr 1fr .8fr auto auto;gap:8px;align-items:center;padding:10px 0;border-bottom:1px solid var(--line)}
      .team-person-row input,.team-person-row select,.dept-admin-row input{width:100%;border:1px solid #cfd6d0;border-radius:9px;background:#fff;padding:9px;color:var(--ink)}
      .team-person-row .check{margin:0;white-space:nowrap}
      .dept-admin-row{display:grid;grid-template-columns:1fr auto auto auto;gap:8px;align-items:center;padding:9px 0;border-bottom:1px solid var(--line)}
      .team-subhead{font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:20px 0 8px}
      .team-role-manager{color:var(--green);font-weight:900}
      @media(max-width:820px){
        .team-add-grid{grid-template-columns:1fr 1fr}.team-add-grid .team-add-name{grid-column:1/-1}
        .team-person-row{grid-template-columns:1fr 1fr}.team-person-row .team-name{grid-column:1/-1}
        .dept-admin-row{grid-template-columns:1fr auto}.dept-admin-row .dept-name{grid-column:1/-1}
      }
    `;
    document.head.appendChild(style);

    const section = document.createElement('section');
    section.className = 'manager-section team-manager-section';
    section.id = 'teamManagerSection';
    section.innerHTML = `
      <h4>Team & departments</h4>
      <p class="policy-meta team-manager-note">Manage the warehouse roster here instead of opening FairShift. Manager is a Hub-wide designation: Managers automatically get the Hub manager tools and full Warehouse Inventory management access after signing in with their Hub PIN.</p>
      <form id="teamAddForm" class="team-add-grid">
        <div class="field team-add-name"><label>Name</label><input name="name" required maxlength="100" placeholder="Team member name" /></div>
        <div class="field"><label>Home department</label><select name="homeDepartment" id="teamAddDepartment"></select></div>
        <div class="field"><label>Designation</label><select name="role"><option>Associate</option><option>Team Lead</option><option>Manager</option></select></div>
        <button class="action" type="submit">Add person</button>
      </form>
      <div class="team-subhead">People</div>
      <div id="teamAdminList"></div>
      <div class="team-subhead">Departments</div>
      <form id="departmentAddForm" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
        <input name="name" required maxlength="100" placeholder="New department" style="flex:1;min-width:190px;border:1px solid #cfd6d0;border-radius:9px;background:#fff;padding:10px;color:var(--ink)" />
        <button class="action" type="submit">Add department</button>
      </form>
      <div id="departmentAdminList"></div>
    `;
    managerGrid.appendChild(section);

    $('teamAddForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const payload = formObject(form);
      try {
        await teamAdminFetch({ action: 'addEmployee', ...payload });
        form.reset();
        await refreshTeamAdmin('Team member added.');
      } catch (error) {
        showMessage('managerMessage', error.message || 'Could not add team member.', true);
      }
    });

    $('departmentAddForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const name = form.elements.name.value.trim();
      if (!name) return;
      try {
        await teamAdminFetch({ action: 'addDepartment', name });
        form.reset();
        await refreshTeamAdmin('Department added.');
      } catch (error) {
        showMessage('managerMessage', error.message || 'Could not add department.', true);
      }
    });
  }

  function renderTeamAdmin() {
    if (!$('teamAdminList') || !$('departmentAdminList')) return;
    const employees = Array.isArray(teamAdminData?.employees) ? teamAdminData.employees : [];
    const departments = Array.isArray(teamAdminData?.departments) ? teamAdminData.departments : [];

    const addDepartment = $('teamAddDepartment');
    if (addDepartment) addDepartment.innerHTML = teamDepartmentOptions('Unassigned');

    $('teamAdminList').innerHTML = employees.length ? employees.map((employee) => `
      <div class="team-person-row" data-team-id="${escapeHtml(employee.id)}">
        <input class="team-name" data-field="name" value="${escapeHtml(employee.name)}" aria-label="Name" />
        <select data-field="homeDepartment" aria-label="Department">${teamDepartmentOptions(employee.homeDepartment || 'Unassigned')}</select>
        <select data-field="role" aria-label="Designation">
          <option${employee.role === 'Associate' ? ' selected' : ''}>Associate</option>
          <option${employee.role === 'Team Lead' ? ' selected' : ''}>Team Lead</option>
          <option${employee.role === 'Manager' ? ' selected' : ''}>Manager</option>
        </select>
        <label class="check"><input data-field="active" type="checkbox"${employee.active !== false ? ' checked' : ''} /> Active</label>
        <button class="mini-edit" type="button" data-save-team="${escapeHtml(employee.id)}">Save</button>
      </div>
    `).join('') : '<div class="policy-meta">No team members found.</div>';

    $('departmentAdminList').innerHTML = departments.length ? departments.map((department) => `
      <div class="dept-admin-row" data-dept-id="${escapeHtml(department.id)}">
        <input class="dept-name" data-field="name" value="${escapeHtml(department.name)}" aria-label="Department name" />
        <label class="check"><input data-field="cleaningActive" type="checkbox"${department.cleaningActive ? ' checked' : ''} /> Cleaning area</label>
        <button class="mini-edit" type="button" data-save-dept="${escapeHtml(department.id)}">Save</button>
        <button class="mini-delete" type="button" data-remove-dept="${escapeHtml(department.id)}">Remove</button>
      </div>
    `).join('') : '<div class="policy-meta">No departments found.</div>';

    document.querySelectorAll('[data-save-team]').forEach((button) => {
      button.onclick = async () => {
        const row = button.closest('[data-team-id]');
        const id = Number(button.dataset.saveTeam);
        const name = row.querySelector('[data-field=name]').value.trim();
        const homeDepartment = row.querySelector('[data-field=homeDepartment]').value;
        const role = row.querySelector('[data-field=role]').value;
        const active = row.querySelector('[data-field=active]').checked;
        try {
          await teamAdminFetch({ action: 'updateEmployee', id, name, homeDepartment, role, active });
          const current = window.HubAssociate?.getSession?.() || {};
          const note = current.signedIn && normalizeName(current.name) === normalizeName(name) && role === 'Manager'
            ? ' Saved. Sign out and back in once to activate your new Manager access.'
            : '';
          await refreshTeamAdmin(`Team member saved.${note}`);
        } catch (error) {
          showMessage('managerMessage', error.message || 'Could not save team member.', true);
        }
      };
    });

    document.querySelectorAll('[data-save-dept]').forEach((button) => {
      button.onclick = async () => {
        const row = button.closest('[data-dept-id]');
        const id = Number(button.dataset.saveDept);
        const name = row.querySelector('[data-field=name]').value.trim();
        const cleaningActive = row.querySelector('[data-field=cleaningActive]').checked;
        try {
          await teamAdminFetch({ action: 'updateDepartment', id, name });
          await teamAdminFetch({ action: 'setCleaningDepartment', id, cleaningActive });
          await refreshTeamAdmin('Department saved.');
        } catch (error) {
          showMessage('managerMessage', error.message || 'Could not save department.', true);
        }
      };
    });

    document.querySelectorAll('[data-remove-dept]').forEach((button) => {
      button.onclick = async () => {
        if (!confirm('Remove this department? Team members must be moved out of it first.')) return;
        try {
          await teamAdminFetch({ action: 'removeDepartment', id: Number(button.dataset.removeDept) });
          await refreshTeamAdmin('Department removed.');
        } catch (error) {
          showMessage('managerMessage', error.message || 'Could not remove department.', true);
        }
      };
    });
  }

  function normalizeName(value) {
    return String(value || '').trim().toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-');
  }

  async function refreshTeamAdmin(message = '') {
    teamAdminData = await teamAdminFetch();
    renderTeamAdmin();
    await window.HubAssociate?.refreshRoster?.().catch?.(() => {});
    if (message) showMessage('managerMessage', message);
  }

  function injectToolManager() {
    if ($('toolManagerSection')) return;
    const managerGrid = document.querySelector('.manager-grid');
    if (!managerGrid) return;

    const style = document.createElement('style');
    style.textContent = `
      .manager-tools-section{grid-column:1/-1}
      .tool-manager-note{margin:-5px 0 15px;line-height:1.5}
      .tool-manager-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
      .tool-manager-form-grid .tool-wide{grid-column:1/-1}
      .tool-manager-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:4px}
      .tool-admin-actions{display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:flex-end}
      .mini-edit{border:1px solid #cdd9d3;background:#f7fbf9;color:#123d34;border-radius:9px;padding:7px 9px;font-size:11px;font-weight:850;cursor:pointer}
      .tool-url-preview{max-width:520px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      @media(max-width:700px){.tool-manager-form-grid{grid-template-columns:1fr}.tool-manager-form-grid .tool-wide{grid-column:auto}.admin-row{align-items:start}.tool-admin-actions{justify-content:flex-start}}
    `;
    document.head.appendChild(style);

    const section = document.createElement('section');
    section.className = 'manager-section manager-tools-section';
    section.id = 'toolManagerSection';
    section.innerHTML = `
      <h4>Tool cards & links</h4>
      <p class="policy-meta tool-manager-note">Add or edit any card here. For a new card, you can enter only the title and URL — the card label and flavor text will be generated automatically in the same style as the rest of the Hub.</p>
      <form id="toolForm">
        <input type="hidden" name="id" />
        <div class="tool-manager-form-grid">
          <div class="field"><label>Card title</label><input name="title" required maxlength="120" placeholder="Example: Pending Insert Cards" /></div>
          <div class="field"><label>Website URL</label><input name="url" required maxlength="1500" placeholder="https://..." /></div>
          <div class="field"><label>Card label <span style="font-weight:500">(auto if blank)</span></label><input name="label" maxlength="80" placeholder="Salesforce report" /></div>
          <div class="field"><label>Accent</label><select name="accent"><option value="">Auto</option><option value="orange">Orange</option><option value="green">Green</option><option value="blue">Blue</option></select></div>
          <div class="field tool-wide"><label>Flavor text <span style="font-weight:500">(auto if blank)</span></label><textarea name="description" maxlength="500" placeholder="Open the report in Salesforce..."></textarea></div>
          <div class="field"><label>Sort order</label><input name="sortOrder" type="number" min="0" step="1" placeholder="Auto" /></div>
          <label class="check" style="align-self:end"><input name="active" type="checkbox" checked /> Show this card on the Hub</label>
        </div>
        <div class="tool-manager-actions">
          <button class="action" type="submit" id="toolSaveBtn">Add card</button>
          <button class="action secondary" type="button" id="toolAutoBtn">Generate card text</button>
          <button class="action secondary" type="button" id="toolClearBtn">Clear / new card</button>
        </div>
      </form>
      <div class="admin-list" id="toolAdminList"></div>
    `;
    managerGrid.appendChild(section);

    const form = $('toolForm');
    const autoFill = (force = false) => {
      const title = form.elements.title.value.trim();
      const url = form.elements.url.value.trim();
      const meta = inferToolMeta(title, url);
      if (force || !form.elements.label.value.trim()) form.elements.label.value = meta.label;
      if (force || !form.elements.description.value.trim()) form.elements.description.value = meta.description;
    };
    form.elements.title.addEventListener('blur', () => autoFill(false));
    form.elements.url.addEventListener('blur', () => autoFill(false));
    $('toolAutoBtn').addEventListener('click', () => autoFill(true));
    $('toolClearBtn').addEventListener('click', clearToolForm);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      autoFill(false);
      const payload = formObject(form);
      if (!payload.accent) delete payload.accent;
      try {
        await toolAdminFetch({ action: 'upsertTool', ...payload });
        clearToolForm();
        await refreshToolAdmin('Tool card saved.');
      } catch (err) {
        showMessage('managerMessage', err.message || 'Could not save tool card.', true);
      }
    });
  }

  function clearToolForm() {
    const form = $('toolForm');
    if (!form) return;
    form.reset();
    form.elements.id.value = '';
    form.elements.active.checked = true;
    $('toolSaveBtn').textContent = 'Add card';
  }

  function editTool(id) {
    const tool = (toolAdminData.tools || []).find((t) => t.id === id);
    const form = $('toolForm');
    if (!tool || !form) return;
    form.elements.id.value = tool.id || '';
    form.elements.title.value = tool.title || '';
    form.elements.url.value = tool.url || '';
    form.elements.label.value = tool.label || '';
    form.elements.description.value = tool.description || '';
    form.elements.accent.value = tool.accent || '';
    form.elements.sortOrder.value = Number.isFinite(Number(tool.sortOrder)) ? tool.sortOrder : '';
    form.elements.active.checked = tool.active !== false;
    $('toolSaveBtn').textContent = 'Save changes';
    $('toolManagerSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => form.elements.title.focus(), 250);
  }

  function renderToolAdmin() {
    const list = $('toolAdminList');
    if (!list) return;
    const rows = Array.isArray(toolAdminData?.tools) ? toolAdminData.tools : [];
    list.innerHTML = rows.length ? rows.map((t) => `
      <div class="admin-row">
        <div><strong>${escapeHtml(t.title)}${t.active === false ? ' · Hidden' : ''}</strong><small>${escapeHtml(t.label || 'Team tool')} · Order ${escapeHtml(t.sortOrder)}</small><small class="tool-url-preview">${escapeHtml(t.url)}</small></div>
        <div class="tool-admin-actions"><button class="mini-edit" type="button" data-edit-tool="${escapeHtml(t.id)}">Edit</button><button class="mini-delete" type="button" data-del-tool="${escapeHtml(t.id)}">Delete</button></div>
      </div>`).join('') : '<div class="policy-meta">No tool cards found.</div>';

    list.querySelectorAll('[data-edit-tool]').forEach((b) => { b.onclick = () => editTool(b.dataset.editTool); });
    list.querySelectorAll('[data-del-tool]').forEach((b) => {
      b.onclick = async () => {
        if (!confirm('Delete this tool card?')) return;
        try {
          await toolAdminFetch({ action: 'deleteTool', id: b.dataset.delTool });
          await refreshToolAdmin('Tool card deleted.');
        } catch (e) {
          showMessage('managerMessage', e.message || 'Could not delete tool card.', true);
        }
      };
    });
  }

  async function openManager() {
    const session = window.HubAssociate?.getSession?.() || { signedIn: false };
    const designatedManager = session.signedIn && String(session.role || '').toLowerCase() === 'manager';
    if (designatedManager) {
      managerKey = '';
    } else {
      const key = window.prompt('Manager access key');
      if (!key) return;
      managerKey = key.trim();
    }

    try {
      const results = await Promise.allSettled([adminFetch(), toolAdminFetch(), teamAdminFetch()]);
      if (results[0].status !== 'fulfilled') throw results[0].reason;
      adminData = results[0].value;
      toolAdminData = results[1].status === 'fulfilled' ? results[1].value : { tools: [] };
      teamAdminData = results[2].status === 'fulfilled' ? results[2].value : { employees: [], departments: [] };
      renderAdmin();
      renderTeamAdmin();
      $('managerMessage').style.display = 'none';
      $('managerDialog').showModal();
      if (results[2].status !== 'fulfilled') showMessage('managerMessage', results[2].reason?.message || 'Team management is temporarily unavailable.', true);
    } catch (e) {
      managerKey = '';
      window.alert(e.message || 'Manager access denied.');
    }
  }

  function updateManagerButton() {
    const session = window.HubAssociate?.getSession?.() || {};
    const manager = session.signedIn && String(session.role || '').toLowerCase() === 'manager';
    $('manageBtn').textContent = manager ? 'Manager tools' : 'Manage';
    $('manageBtn').title = manager ? 'Open your Manager controls' : 'Manager controls';
  }

  $('manageBtn').addEventListener('click', openManager);
  document.addEventListener('hub-associate-session', updateManagerButton);
  setTimeout(updateManagerButton, 700);

  function setDefaultDates() {
    const t = today();
    const af = document.querySelector('#announcementForm [name=startDate]');
    const pf = document.querySelector('#policyForm [name=effectiveDate]');
    if (af && !af.value) af.value = t;
    if (pf && !pf.value) pf.value = t;
  }

  function renderAdmin() {
    if (!adminData) return;
    $('announcementAdminList').innerHTML = adminData.announcements.length
      ? adminData.announcements.map((a) => `<div class="admin-row"><div><strong>${escapeHtml(a.title)}</strong><small>${escapeHtml(a.startDate)}${a.endDate ? ' → ' + escapeHtml(a.endDate) : ''}</small></div><button class="mini-delete" data-del-ann="${escapeHtml(a.id)}">Delete</button></div>`).join('')
      : '<div class="policy-meta">None posted.</div>';
    $('policyAdminList').innerHTML = adminData.policies.length
      ? adminData.policies.map((p) => `<div class="admin-row"><div><strong>${escapeHtml(p.title)}</strong><small>Effective ${escapeHtml(p.effectiveDate)}</small></div><button class="mini-delete" data-del-pol="${escapeHtml(p.id)}">Delete</button></div>`).join('')
      : '<div class="policy-meta">None posted.</div>';
    bindAdminDeletes();
    renderTeamAdmin();
    renderToolAdmin();
    setDefaultDates();
  }

  function bindAdminDeletes() {
    document.querySelectorAll('[data-del-ann]').forEach((b) => { b.onclick = () => deleteAdmin({ action: 'deleteAnnouncement', id: b.dataset.delAnn }); });
    document.querySelectorAll('[data-del-pol]').forEach((b) => { b.onclick = () => deleteAdmin({ action: 'deletePolicy', id: b.dataset.delPol }); });
  }

  async function deleteAdmin(body) {
    if (!confirm('Delete this item?')) return;
    try {
      await adminFetch(body);
      await refreshAdmin('Deleted.');
    } catch (e) {
      showMessage('managerMessage', e.message || 'Delete failed.', true);
    }
  }

  async function refreshAdmin(msg) {
    adminData = await adminFetch();
    renderAdmin();
    await loadFeed();
    if (msg) showMessage('managerMessage', msg);
  }

  async function refreshToolAdmin(msg) {
    toolAdminData = await toolAdminFetch();
    renderToolAdmin();
    await loadTools();
    if (msg) showMessage('managerMessage', msg);
  }

  function formObject(form) {
    const fd = new FormData(form);
    const out = {};
    fd.forEach((v, k) => { out[k] = v; });
    form.querySelectorAll('input[type=checkbox]').forEach((i) => { out[i.name] = i.checked; });
    return out;
  }

  $('announcementForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const payload = formObject(form);
    try {
      await adminFetch({ action: 'upsertAnnouncement', ...payload });
      form.reset();
      setDefaultDates();
      await refreshAdmin('Announcement posted.');
    } catch (err) {
      showMessage('managerMessage', err.message || 'Could not post announcement.', true);
    }
  });

  $('policyForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const payload = formObject(form);
    try {
      await adminFetch({ action: 'upsertPolicy', ...payload });
      form.reset();
      setDefaultDates();
      await refreshAdmin('Policy update published.');
    } catch (err) {
      showMessage('managerMessage', err.message || 'Could not publish policy.', true);
    }
  });

  injectTeamManager();
  injectToolManager();
  setDefaultDates();
  loadFeed();
  loadTools();
})();
