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
  let toolAccessState = { signedIn: null, employeeName: '', access: null };
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
    // Text in a hidden panel can't be measured; check it once it shows.
    if (isToday) requestAnimationFrame(() => { clampLongText($('todayAnnouncements')); clampLongText($('todayPolicies')); });
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
    if (r.status === 'completed') {
      const done = `<span class="checkin">${Number(r.creditMinutes || 15)} min ✓</span>`;
      if (r.source !== 'fairshift' || !isHubAdmin()) return done;
      return `<span class="checkin-actions">${done}<button class="checkin-undo" type="button" data-reopen="${escapeHtml(r.fairshiftId)}">Reopen</button></span>`;
    }
    if (!['scheduled', 'in_progress'].includes(r.status)) return '';
    const label = r.status === 'scheduled' ? 'Start' : 'Finish';
    if (r.source === 'fairshift') {
      const href = r.checkinUrl || `${FAIRSHIFT}/checkin?assignment=${encodeURIComponent(r.fairshiftId || '')}`;
      const link = `<a class="checkin" href="${escapeHtml(href)}">${label}</a>`;
      if (r.status !== 'in_progress' || !canUndoStart(r)) return link;
      return `<span class="checkin-actions">${link}<button class="checkin-undo" type="button" data-undo-start="${escapeHtml(r.fairshiftId)}">Undo start</button></span>`;
    }
    return `<button class="checkin" type="button" data-checkin="${escapeHtml(r.id)}" data-date="${escapeHtml(r.date)}" data-name="${escapeHtml(r.employeeName)}" data-status="${escapeHtml(r.status)}">${label}</button>`;
  }

  function isHubAdmin() {
    const s = window.HubAssociate?.getSession?.() || {};
    return !!s.signedIn && String(s.role || '').toLowerCase() === 'manager';
  }

  // Mirrors the server rule: the assigned person (today) or a Manager/Team Lead.
  function canUndoStart(r) {
    const s = window.HubAssociate?.getSession?.() || {};
    if (!s.signedIn) return false;
    if (['manager', 'team lead'].includes(String(s.role || '').toLowerCase())) return true;
    return r.date === today() && normalizeName(s.name) === normalizeName(r.employeeName);
  }

  function personLabel(r) {
    return feed.namesHidden ? '<span class="names-hidden">Sign in to see</span>' : escapeHtml(r.employeeName);
  }

  function renderToday() {
    const t = today();
    const rows = feed.cleaning.filter((r) => r.date === t);
    const box = $('todayCleaning');
    const sideOf = (r) => r.side === 'Outbound' ? 'Outbound' : 'Inbound';
    const renderSide = (side) => {
      const assignments = rows.filter((r) => sideOf(r) === side);
      return `<section class="cleaning-side" aria-label="${side} cleaning">
        <h4 class="cleaning-side-title">${side}<span>${assignments.length} assigned</span></h4>
        <div class="cleaning-side-rows">${assignments.length
          ? assignments.map((r) => `<div class="cleaning-row"><div class="area">${escapeHtml(r.area)}</div><div class="person">${personLabel(r)}</div><span class="status ${escapeHtml(r.status)}">${escapeHtml(statusLabel(r.status))}</span>${actionForCleaning(r)}</div>`).join('')
          : `<div class="cleaning-side-empty">${feed.cleaningSource === 'fairshift' ? `No cleaning assignments for ${side} today.` : 'Cleaning schedule temporarily unavailable.'}</div>`}
        </div></section>`;
    };
    box.innerHTML = ['Inbound','Outbound'].map(renderSide).join('');
    box.querySelectorAll('[data-checkin]').forEach((btn) => btn.addEventListener('click', () => openCheckin(btn.dataset)));

    const sourceLabel = $('cleaningSourceLabel');
    if (sourceLabel) sourceLabel.textContent = feed.cleaningSource === 'fairshift' ? 'Cleaning schedule · 15 min credit' : 'Cleaning schedule temporarily unavailable';

    const anns = activeAnnouncements(t).sort((a, b) => Number(b.pinned) - Number(a.pinned));
    $('announcementCount').textContent = `${anns.length} active`;
    $('todayAnnouncements').innerHTML = anns.length
      ? anns.map((a) => `<div class="notice"><div class="notice-meta">${a.pinned ? 'Pinned • ' : ''}${escapeHtml(a.department || 'All teams')}</div><h4>${escapeHtml(a.title)}</h4><p class="clamp">${escapeHtml(a.message)}</p></div>`).join('')
      : '<div class="empty">No active announcements.</div>';

    const pol = currentPolicies();
    $('policyCount').textContent = `${pol.length} current`;
    $('todayPolicies').innerHTML = pol.length
      ? pol.map((p) => `<div class="policy-row"><div><div class="policy-title">${escapeHtml(p.title)}</div><div class="policy-meta">Effective ${escapeHtml(fmtDay(p.effectiveDate))}${p.readRequired ? ' • <b class="ack-inline">Read required</b>' : ''}</div><div class="policy-summary clamp">${escapeHtml(p.summary)}</div></div></div>`).join('')
      : '<div class="empty">No policy updates have been published.</div>';
    $('policyBankNote').textContent = feed.policies.length ? `${feed.policies.length} polic${feed.policies.length === 1 ? 'y' : 'ies'} on file` : '';
    clampLongText($('todayAnnouncements'));
    clampLongText($('todayPolicies'));
    if ($('policyBank')?.open) renderPolicyBank();
  }


  // Long announcement and policy text is cut to a few lines with a
  // "Read more" toggle, so one long post doesn't stretch the page.
  function clampLongText(root) {
    root?.querySelectorAll('.clamp').forEach((el) => {
      if (el.nextElementSibling?.classList.contains('read-more')) return;
      if (el.scrollHeight <= el.clientHeight + 2) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'read-more';
      btn.textContent = 'Read more';
      btn.addEventListener('click', () => {
        const open = el.classList.toggle('expanded');
        btn.textContent = open ? 'Show less' : 'Read more';
      });
      el.after(btn);
    });
  }

  // Policy bank: every policy ever published, newest first, searchable.
  function renderPolicyBank() {
    const q = String($('policyBankSearch').value || '').trim().toLowerCase();
    const t = today();
    const all = feed.policies.slice().sort((a, b) => String(b.effectiveDate).localeCompare(String(a.effectiveDate)));
    const rows = all.filter((p) => !q || `${p.title} ${p.summary}`.toLowerCase().includes(q));
    $('policyBankCount').textContent = q ? `${rows.length} of ${all.length} policies` : `${all.length} polic${all.length === 1 ? 'y' : 'ies'}`;
    $('policyBankList').innerHTML = rows.length
      ? rows.map((p) => `<article class="bank-item"><div class="bank-head"><h4>${escapeHtml(p.title)}</h4>${p.effectiveDate > t ? '<span class="smallpill">Upcoming</span>' : ''}${p.readRequired ? '<span class="ack">Read required</span>' : ''}</div><div class="policy-meta">Effective ${escapeHtml(fmtDay(p.effectiveDate))}</div><div class="policy-summary clamp">${escapeHtml(p.summary)}</div></article>`).join('')
      : `<div class="empty">${all.length ? 'No policies match this search.' : 'No policies have been published.'}</div>`;
    clampLongText($('policyBankList'));
  }
  function openPolicyBank() {
    $('policyBankSearch').value = '';
    if (!$('policyBank').open) $('policyBank').showModal();
    renderPolicyBank(); // after opening, so long text can be measured
  }
  $('policyBankBtn')?.addEventListener('click', openPolicyBank);
  $('policyBankSearch')?.addEventListener('input', renderPolicyBank);

  // Announcements and policies an admin marked "pop up" open in a window the
  // first time this browser opens the Hub each day, so nobody misses them.
  const POPUP_KEY = 'hubPopupSeen';
  function popupSeen() {
    try { const v = JSON.parse(localStorage.getItem(POPUP_KEY) || '{}'); return v.date === today() ? v.ids || [] : []; } catch { return []; }
  }
  function markPopupSeen(ids) {
    try { localStorage.setItem(POPUP_KEY, JSON.stringify({ date: today(), ids: [...new Set([...popupSeen(), ...ids])] })); } catch {}
  }
  let popupChecked = false;
  function maybeShowPopups() {
    if (popupChecked) return;
    popupChecked = true;
    const t = today(), seen = popupSeen();
    const items = [
      ...activeAnnouncements(t).filter((a) => a.showOnOpen).map((a) => ({ key: `a:${a.id}`, label: `Announcement • ${a.department || 'All teams'}`, title: a.title, body: a.message })),
      ...feed.policies.filter((p) => p.showOnOpen && p.effectiveDate <= t).map((p) => ({ key: `p:${p.id}`, label: `Policy • Effective ${fmtDay(p.effectiveDate)}`, title: p.title, body: p.summary })),
    ].filter((item) => !seen.includes(item.key));
    if (!items.length) return;
    // Wait for the sign-in window (and any other) to close first, so the
    // two never stack. It must stay clear for two checks in a row.
    let clear = 0;
    const waitTimer = setInterval(() => {
      clear = document.querySelector('dialog[open]') ? 0 : clear + 1;
      if (clear < 2) return;
      clearInterval(waitTimer);
      showPopups(items);
    }, 800);
  }
  function showPopups(items) {
    $('hubPopupList').innerHTML = items.map((item) => `<article class="popup-item"><div class="notice-meta">${escapeHtml(item.label)}</div><h4>${escapeHtml(item.title)}</h4><p>${escapeHtml(item.body)}</p></article>`).join('');
    $('hubPopupTitle').textContent = items.length === 1 ? 'Please read before you start' : `Please read these ${items.length} updates`;
    const dlg = $('hubPopup');
    const done = () => { markPopupSeen(items.map((item) => item.key)); dlg.close(); };
    $('hubPopupOk').onclick = done;
    dlg.oncancel = (e) => { e.preventDefault(); done(); };
    dlg.showModal();
  }

  function renderWeek() {
    const dates = weekDates();
    const todayIso = today();
    $('weekTitle').textContent = `Week of ${fmtDay(dates[0])} – ${fmtDay(dates[4])}`;
    $('weekCalendar').innerHTML = dates.map((date) => {
      const clean = feed.cleaning.filter((r) => r.date === date)
        .sort((a,b) => Number(a.side === 'Outbound') - Number(b.side === 'Outbound'));
      const ann = activeAnnouncements(date).filter((a) => a.startDate === date || a.pinned);
      const pol = policiesForDate(date);
      const events = [];
      clean.forEach((r, i) => events.push(`<div class="week-event"><div class="event-label">${i === 0 || r.side !== clean[i-1]?.side ? escapeHtml(r.side || 'Inbound') + ' cleaning' : ''}</div><div class="event-title">${escapeHtml(r.area)}</div><div class="event-meta">${personLabel(r)} • ${escapeHtml(statusLabel(r.status))}</div></div>`));
      ann.slice(0, 3).forEach((a) => events.push(`<div class="week-event"><div class="event-label">Announcement</div><div class="event-title">${escapeHtml(a.title)}</div><div class="event-meta">${escapeHtml(a.department || 'All teams')}</div></div>`));
      pol.forEach((p) => events.push(`<div class="week-event"><div class="event-label">Policy</div><div class="event-title">${escapeHtml(p.title)}</div><div class="event-meta">${p.readRequired ? 'Read required' : 'Effective'}</div></div>`));
      if (!events.length) events.push('<div class="event-meta">Nothing published.</div>');
      return `<article class="day-column ${date === todayIso ? 'today-day' : ''}"><div class="day-head"><div class="day-name">${date === todayIso ? 'Today • ' : ''}${parseDate(date).toLocaleDateString(undefined, { weekday: 'long' })}</div><div class="day-date">${parseDate(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</div></div><div class="day-body">${events.join('')}</div></article>`;
    }).join('');
  }

  function render() { renderToday(); renderWeek(); }

  document.addEventListener('hub-cleaning-refresh', () => loadFeed());
  document.addEventListener('hub-associate-ready', () => { if (feed) render(); });
  document.addEventListener('hub-associate-session', () => loadFeed());
  async function loadFeed() {
    try {
      const r = await fetch(API, { cache: 'no-store' });
      if (!r.ok) throw new Error('Hub data unavailable.');
      feed = await r.json();
      render();
      maybeShowPopups();
    } catch (e) {
      $('todayCleaning').innerHTML = `<div class="empty">${escapeHtml(e.message || 'Hub data is unavailable.')}</div>`;
      $('todayAnnouncements').innerHTML = '<div class="empty">Unable to load announcements.</div>';
      $('todayPolicies').innerHTML = '<div class="empty">Unable to load policy updates.</div>';
      renderWeek();
    }
  }

  function toolCardHtml(tool) {
    const accentClass = tool.accent === 'green' ? ' green' : tool.accent === 'blue' ? ' blue' : '';
    if (tool.id === 'fairshift-rotations') {
      return `<a class="tool-card${accentClass}" data-tool-id="fairshift-rotations" href="#today"><div class="tool-top"><div class="iconbox">🧹</div><div class="open">Open modal ↗</div></div><div class="tool-label">Cleaning & rotations</div><h3>Cleaning Planner</h3><p>Plan fair weekly rotations, manage absences, and check cleaning history here in the Hub.</p></a>`;
    }
    return `<a class="tool-card${accentClass}" data-tool-id="${escapeHtml(tool.id || '')}" href="${escapeHtml(tool.url)}" target="_blank" rel="noopener"><div class="tool-top"><div class="iconbox">${escapeHtml(tool.icon || '◫')}</div><div class="open">Open ↗</div></div><div class="tool-label">${escapeHtml(tool.label || 'Team tool')}</div><h3>${escapeHtml(tool.title)}</h3><p>${escapeHtml(tool.description || `Open ${tool.title}.`)}</p></a>`;
  }

  function updateToolCount(count) {
    const badge = document.querySelector('.toolcount');
    if (badge) badge.innerHTML = `<span class="dot"></span> ${count} live tool${count === 1 ? '' : 's'}`;
  }

  function renderTools() {
    const grid = document.querySelector('.tool-grid');
    if (!grid) return;
    if (toolAccessState.signedIn === false) {
      grid.innerHTML = '<div class="empty">Sign in above to see the Hub tools available to you.</div>';
      updateToolCount(0);
      return;
    }
    if (!tools.length) {
      const who = toolAccessState.employeeName ? ` for ${escapeHtml(toolAccessState.employeeName)}` : '';
      grid.innerHTML = `<div class="empty">No Hub tools are assigned${who}. Ask an admin if you need access to another tool.</div>`;
      updateToolCount(0);
      return;
    }
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
      const r = await fetch(TOOLS_API, { cache: 'no-store', credentials: 'same-origin' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Tool cards unavailable.');
      tools = Array.isArray(j.tools) ? j.tools : [];
      toolAccessState = {
        signedIn: j.signedIn !== false,
        employeeName: j.employeeName || '',
        access: j.access || null,
      };
      renderTools();
    } catch (error) {
      const grid = document.querySelector('.tool-grid');
      if (grid) grid.innerHTML = `<div class="empty">${escapeHtml(error.message || 'Unable to load your Hub tools.')}</div>`;
      updateToolCount(0);
    }
  }

  document.querySelector('.tool-grid')?.addEventListener('click', (event) => {
    const card = event.target.closest('a[data-tool-id]');
    if (!card || !card.dataset.toolId) return;
    if (card.dataset.toolId === 'fairshift-rotations') {
      event.preventDefault();
      window.HubRotations?.open?.();
    }
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
    $('checkinAssignment').textContent = `${data.name || 'Cleaning'} • ${data.status === 'scheduled' ? 'Start' : 'Finish'} today’s cleaning assignment`;
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
    if (!r.ok) throw new Error(j.error || 'Admin request failed.');
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
      .team-person-row{display:grid;grid-template-columns:1.25fr 1fr .8fr auto auto auto;gap:8px;align-items:center;padding:10px 0;border-bottom:1px solid var(--line)}
      .pin-reset-dialog{width:min(510px,calc(100% - 24px))}
      .pin-reset-dialog .field{margin:12px 0}
      .pin-reset-dialog input{width:100%;border:1px solid #cfd6d0;border-radius:9px;padding:11px}
      .pin-reset-dialog .pin-reset-actions{display:flex;flex-wrap:wrap;gap:9px;align-items:center}
      .pin-reset-note{font-size:12px;color:var(--muted);line-height:1.5;margin:10px 0}
      .pin-reset-record{border-bottom:1px solid var(--line);padding:8px 0;font-size:12px}
      .pin-reset-record strong{font-size:12px}
      .pin-reset-record small{display:block;color:var(--muted);margin-top:4px}
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
      <p class="policy-meta team-manager-note">Manage the warehouse roster here. Admin is the Hub-wide designation for elevated access: Admins automatically get the Hub admin tools and full Warehouse Inventory management access after signing in with their Hub PIN.</p>
      <form id="teamAddForm" class="team-add-grid">
        <div class="field team-add-name"><label>Name</label><input name="name" required maxlength="100" placeholder="Team member name" /></div>
        <div class="field"><label>Home department</label><select name="homeDepartment" id="teamAddDepartment"></select></div>
        <div class="field"><label>Designation</label><select name="role"><option>Associate</option><option>Team Lead</option><option value="Manager">Admin</option></select></div>
        <button class="action" type="submit">Add person</button>
      </form>
      <div class="team-subhead">People</div>
      <div id="teamAdminList"></div>
      <div class="team-subhead">Recent PIN resets</div>
      <div id="teamPinResetHistory" class="policy-meta">Only Admins can reset and view PIN reset history.</div>
      <div class="team-subhead">Departments</div>
      <form id="departmentAddForm" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
        <input name="name" required maxlength="100" placeholder="New department" style="flex:1;min-width:190px;border:1px solid #cfd6d0;border-radius:9px;background:#fff;padding:10px;color:var(--ink)" />
        <button class="action" type="submit">Add department</button>
      </form>
      <div id="departmentAdminList"></div>
    `;
    managerGrid.appendChild(section);

    const pinDialog = document.createElement('dialog');
    pinDialog.className = 'dialog pin-reset-dialog';
    pinDialog.id = 'pinResetDialog';
    pinDialog.innerHTML = `
      <div class="dialog-head">
        <div><h3 id="pinResetTitle">Reset employee PIN</h3>
          <p class="pin-reset-note" id="pinResetScope">Warehouse Hub is the sign-in authority. Resetting here always changes the Hub PIN; cleaning PIN sync is handled separately when available.</p></div>
        <button id="pinResetClose" type="button" aria-label="Close">×</button>
      </div>
      <form id="pinResetForm" class="dialog-body">
        <input type="hidden" id="pinResetEmployeeId" />
        <input type="hidden" id="pinResetEmployeeName" />
        <p class="pin-reset-note">Set a new 4–8 digit PIN or generate a six-digit PIN. Existing PINs cannot be viewed.</p>
        <div class="field"><label for="pinResetNew">New PIN</label>
          <input id="pinResetNew" type="password" inputmode="numeric" pattern="[0-9]{4,8}"
            maxlength="8" autocomplete="new-password" required /></div>
        <div class="field"><label for="pinResetConfirm">Confirm new PIN</label>
          <input id="pinResetConfirm" type="password" inputmode="numeric" pattern="[0-9]{4,8}"
            maxlength="8" autocomplete="new-password" required /></div>
        <div class="pin-reset-actions">
          <button type="button" class="ghost" id="pinResetGenerate">Generate PIN</button>
          <label class="check"><input type="checkbox" id="pinResetReveal" /> Show PIN</label>
        </div>
        <p id="pinResetResult" class="pin-reset-note" aria-live="polite"></p>
        <div class="dialog-actions">
          <button class="action" type="submit" id="pinResetSubmit">Confirm PIN reset</button>
          <button class="ghost" type="button" id="pinResetCancel">Cancel</button>
        </div>
      </form>`;
    document.body.appendChild(pinDialog);
    const dismissPinDialog=()=>{
      pinDialog.close();
      $('pinResetForm').reset();
      $('pinResetResult').textContent='';
    };
    $('pinResetClose').onclick=dismissPinDialog;
    $('pinResetCancel').onclick=dismissPinDialog;
    $('pinResetGenerate').onclick=()=>{
      const random=new Uint32Array(1);
      crypto.getRandomValues(random);
      const generated=String(100000+(random[0]%900000));
      $('pinResetNew').value=generated;
      $('pinResetConfirm').value=generated;
      $('pinResetReveal').checked=true;
      $('pinResetNew').type='text';
      $('pinResetConfirm').type='text';
      $('pinResetResult').textContent='Generated PIN: '+generated+'. Give it privately to the employee.';
    };
    $('pinResetReveal').onchange=()=>{
      const mode=$('pinResetReveal').checked?'text':'password';
      $('pinResetNew').type=mode;
      $('pinResetConfirm').type=mode;
    };
    $('pinResetForm').onsubmit=async(event)=>{
      event.preventDefault();
      const id=Number($('pinResetEmployeeId').value);
      const employeeName=$('pinResetEmployeeName').value;
      const pin=$('pinResetNew').value,confirmPin=$('pinResetConfirm').value;
      if(!/^\d{4,8}$/.test(pin)||pin!==confirmPin){
        $('pinResetResult').textContent='Enter a matching 4–8 digit PIN.';
        return;
      }
      if(!window.confirm(`Reset the PIN for ${employeeName}? This changes the PIN used for future sign-ins.`))return;
      const submit=$('pinResetSubmit');
      submit.disabled=true;
      submit.textContent='Resetting…';
      try{
        const response=await fetch('/.netlify/functions/hub-auth',{
          method:'POST',credentials:'same-origin',cache:'no-store',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({action:'adminResetPin',employeeId:id,employeeName,pin,confirmPin}),
        });
        const result=await response.json().catch(()=>({}));
        if(!response.ok)throw new Error(result.error||'Could not reset the PIN.');
        $('pinResetResult').textContent=`PIN reset for ${employeeName} (${result.scope}). Give them the new PIN privately. `
          +(result.warning ? result.warning+' ' : '')
          +(normalizeName(employeeName)===normalizeName(window.HubAssociate?.getSession?.()?.name)
            ? 'You must sign out and back in with your new PIN.':'');
        submit.textContent='PIN reset saved';
        submit.disabled=true;
        await loadPinResetHistory();
        await window.HubAssociate?.refreshRoster?.().catch?.(()=>{});
      }catch(error){
        $('pinResetResult').textContent=error.message||'PIN reset failed. No success was recorded.';
        submit.textContent='Confirm PIN reset';
        submit.disabled=false;
      }
    };

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
          <option value="Manager"${employee.role === 'Manager' ? ' selected' : ''}>Admin</option>
        </select>
        <label class="check"><input data-field="active" type="checkbox"${employee.active !== false ? ' checked' : ''} /> Active</label>
        <button class="mini-edit" type="button" data-save-team="${escapeHtml(employee.id)}">Save</button>
        <button class="mini-edit" type="button" data-reset-team-pin="${escapeHtml(employee.id)}">Reset PIN</button>
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

    document.querySelectorAll('[data-reset-team-pin]').forEach(button=>{
      button.onclick=()=>{
        const employee=employees.find(person=>person.id===Number(button.dataset.resetTeamPin));
        if(!employee)return;
        $('pinResetForm').reset();
        $('pinResetNew').type='password';
        $('pinResetConfirm').type='password';
        $('pinResetEmployeeId').value=String(employee.id);
        $('pinResetEmployeeName').value=employee.name;
        $('pinResetTitle').textContent=`Reset PIN · ${employee.name}`;
        $('pinResetResult').textContent='';
        $('pinResetSubmit').disabled=false;
        $('pinResetSubmit').textContent='Confirm PIN reset';
        $('pinResetScope').textContent='The new PIN works right away for Hub sign-in and cleaning check-ins.';
        $('pinResetDialog').showModal();
        $('pinResetNew').focus();
      };
    });

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
            ? ' Saved. Sign out and back in once to activate your new Admin access.'
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

  async function loadPinResetHistory() {
    const target=$('teamPinResetHistory');
    if(!target)return;
    try{
      const response=await fetch('/.netlify/functions/hub-auth?action=pinResetHistory',{
        credentials:'same-origin',cache:'no-store',
      });
      const result=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(result.error||'Could not load PIN reset history.');
      const history=Array.isArray(result.history)?result.history:[];
      target.innerHTML=history.length?history.slice(0,15).map(row=>`
        <div class="pin-reset-record">
          <strong>${escapeHtml(row.employeeName)}</strong> · ${escapeHtml(row.scope)}
          <small>${escapeHtml(new Date(row.resetAt).toLocaleString())} · Reset by ${escapeHtml(row.resetBy)}</small>
        </div>`).join(''):'No PIN resets recorded yet.';
    }catch(error){
      target.textContent=error.message||'PIN reset history is unavailable.';
    }
  }

  async function refreshTeamAdmin(message = '') {
    teamAdminData = await teamAdminFetch();
    renderTeamAdmin();
    renderAccessManager();
    await window.HubAssociate?.refreshRoster?.().catch?.(() => {});
    await loadPinResetHistory();
    if (message) showMessage('managerMessage', message);
  }


  function injectAccessManager() {
    if ($('accessManagerSection')) return;
    const managerGrid = document.querySelector('.manager-grid');
    if (!managerGrid) return;

    const style = document.createElement('style');
    style.textContent = `
      .access-manager-section{grid-column:1/-1}
      .access-top{display:grid;grid-template-columns:1.3fr 1fr 1.2fr auto;gap:10px;align-items:end}
      .access-actions{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}
      .access-checks{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
      .access-tool{display:flex;gap:8px;align-items:flex-start;border:1px solid var(--line);background:#fff;border-radius:11px;padding:10px}
      .access-tool input{margin-top:3px}
      .access-tool span{display:grid;gap:2px}
      .access-tool small{color:var(--muted);line-height:1.35}
      .access-summary{margin-top:10px;color:var(--muted);font-size:12px;font-weight:750}
      @media(max-width:900px){.access-top{grid-template-columns:1fr 1fr}.access-checks{grid-template-columns:repeat(2,minmax(0,1fr))}}
      @media(max-width:620px){.access-top{grid-template-columns:1fr}.access-checks{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);

    const section = document.createElement('section');
    section.className = 'manager-section access-manager-section';
    section.id = 'accessManagerSection';
    section.innerHTML = `
      <h4>Hub access</h4>
      <p class="policy-meta">Choose a preset for speed, then add or remove individual tools. Anyone without a saved access profile keeps Full Access until you change them.</p>
      <div class="access-top">
        <div class="field"><label>Team member</label><select id="accessEmployee"></select></div>
        <div class="field"><label>Preset</label><select id="accessPreset"></select></div>
        <div class="field"><label>Copy access from</label><select id="accessCopyFrom"><option value="">Choose person…</option></select></div>
        <button class="action secondary" id="accessCopyBtn" type="button">Copy</button>
      </div>
      <div class="access-actions">
        <button class="action secondary" id="accessSelectAll" type="button">Select all</button>
        <button class="action secondary" id="accessClearAll" type="button">Clear all</button>
        <button class="action" id="accessSaveBtn" type="button">Save access</button>
      </div>
      <div id="accessToolChecks" class="access-checks"></div>
      <div id="accessSummary" class="access-summary"></div>
    `;
    const teamSection = $('teamManagerSection');
    if (teamSection) teamSection.insertAdjacentElement('afterend', section);
    else managerGrid.appendChild(section);

    $('accessEmployee').addEventListener('change', loadSelectedAccess);
    $('accessPreset').addEventListener('change', () => applyPreset($('accessPreset').value));
    $('accessSelectAll').addEventListener('click', () => {
      document.querySelectorAll('[data-access-tool]').forEach((box) => { box.checked = true; });
      $('accessPreset').value = 'full';
      updateAccessSummary();
    });
    $('accessClearAll').addEventListener('click', () => {
      document.querySelectorAll('[data-access-tool]').forEach((box) => { box.checked = false; });
      $('accessPreset').value = 'custom';
      updateAccessSummary();
    });
    $('accessCopyBtn').addEventListener('click', copyAccessFrom);
    $('accessSaveBtn').addEventListener('click', saveSelectedAccess);
  }

  function accessRows() {
    return Array.isArray(toolAdminData?.access) ? toolAdminData.access : [];
  }

  function accessPresets() {
    return Array.isArray(toolAdminData?.presets) ? toolAdminData.presets : [];
  }

  function activeAdminTools() {
    return (Array.isArray(toolAdminData?.tools) ? toolAdminData.tools : []).filter((tool) => tool.active !== false);
  }

  function accessForName(name) {
    const key = normalizeName(name);
    return accessRows().find((row) => normalizeName(row.employeeName) === key) || {
      employeeName: name,
      preset: 'full',
      allowedToolIds: [],
      defaulted: true,
    };
  }

  function idsForAccess(access) {
    const all = activeAdminTools().map((tool) => tool.id);
    if (!access || access.preset === 'full') return all;
    return Array.isArray(access.allowedToolIds) ? access.allowedToolIds : [];
  }

  function updateAccessSummary() {
    const checked = [...document.querySelectorAll('[data-access-tool]:checked')].length;
    const total = document.querySelectorAll('[data-access-tool]').length;
    const preset = accessPresets().find((item) => item.id === $('accessPreset')?.value);
    if ($('accessSummary')) $('accessSummary').textContent = `${checked} of ${total} tools visible · ${preset?.name || 'Custom'}`;
  }

  function renderAccessManager() {
    if (!$('accessManagerSection')) return;
    const employees = (Array.isArray(teamAdminData?.employees) ? teamAdminData.employees : [])
      .filter((person) => person.active !== false)
      .slice()
      .sort((a,b) => String(a.name).localeCompare(String(b.name)));

    const currentEmployee = $('accessEmployee').value;
    $('accessEmployee').innerHTML = employees.length
      ? employees.map((person) => `<option value="${escapeHtml(person.name)}">${escapeHtml(person.name)} · ${escapeHtml(person.role === 'Manager' ? 'Admin' : (person.role || 'Associate'))}</option>`).join('')
      : '<option value="">No active team members</option>';
    if (employees.some((person) => person.name === currentEmployee)) $('accessEmployee').value = currentEmployee;

    $('accessCopyFrom').innerHTML = '<option value="">Choose person…</option>' + employees
      .map((person) => `<option value="${escapeHtml(person.name)}">${escapeHtml(person.name)}</option>`).join('');

    $('accessPreset').innerHTML = accessPresets()
      .map((preset) => `<option value="${escapeHtml(preset.id)}">${escapeHtml(preset.name)}</option>`).join('');

    $('accessToolChecks').innerHTML = activeAdminTools().map((tool) => `
      <label class="access-tool">
        <input type="checkbox" data-access-tool value="${escapeHtml(tool.id)}" />
        <span><b>${escapeHtml(tool.title)}</b><small>${escapeHtml(tool.label || 'Team tool')}</small></span>
      </label>
    `).join('');

    document.querySelectorAll('[data-access-tool]').forEach((box) => box.addEventListener('change', () => {
      $('accessPreset').value = 'custom';
      updateAccessSummary();
    }));

    loadSelectedAccess();
  }

  function applyPreset(presetId) {
    const preset = accessPresets().find((item) => item.id === presetId);
    if (!preset || preset.id === 'custom') {
      updateAccessSummary();
      return;
    }
    const ids = new Set(preset.toolIds || []);
    document.querySelectorAll('[data-access-tool]').forEach((box) => { box.checked = ids.has(box.value); });
    updateAccessSummary();
  }

  function loadSelectedAccess() {
    const name = $('accessEmployee')?.value || '';
    if (!name) return;
    const access = accessForName(name);
    const ids = new Set(idsForAccess(access));
    const presetId = accessPresets().some((item) => item.id === access.preset) ? access.preset : 'custom';
    $('accessPreset').value = presetId;
    document.querySelectorAll('[data-access-tool]').forEach((box) => { box.checked = ids.has(box.value); });
    updateAccessSummary();
  }

  function copyAccessFrom() {
    const sourceName = $('accessCopyFrom')?.value || '';
    if (!sourceName) return;
    const source = accessForName(sourceName);
    const ids = new Set(idsForAccess(source));
    $('accessPreset').value = accessPresets().some((item) => item.id === source.preset) ? source.preset : 'custom';
    document.querySelectorAll('[data-access-tool]').forEach((box) => { box.checked = ids.has(box.value); });
    updateAccessSummary();
  }

  async function saveSelectedAccess() {
    const employeeName = $('accessEmployee')?.value || '';
    if (!employeeName) return;
    const preset = $('accessPreset')?.value || 'custom';
    const allowedToolIds = [...document.querySelectorAll('[data-access-tool]:checked')].map((box) => box.value);
    try {
      await toolAdminFetch({ action: 'setAccess', employeeName, preset, allowedToolIds });
      toolAdminData = await toolAdminFetch();
      renderAccessManager();
      await loadTools();
      showMessage('managerMessage', `Hub access saved for ${employeeName}.`);
    } catch (error) {
      showMessage('managerMessage', error.message || 'Could not save Hub access.', true);
    }
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
      const key = window.prompt('Admin access key');
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
      renderAccessManager();
      $('managerMessage').style.display = 'none';
      $('managerDialog').showModal();
      if (results[2].status !== 'fulfilled') showMessage('managerMessage', results[2].reason?.message || 'Team management is temporarily unavailable.', true);
    } catch (e) {
      managerKey = '';
      window.alert(e.message || 'Admin access denied.');
    }
  }

  function updateManagerButton() {
    const session = window.HubAssociate?.getSession?.() || {};
    const manager = session.signedIn && String(session.role || '').toLowerCase() === 'manager';
    $('manageBtn').textContent = manager ? 'Admin tools' : 'Admin';
    $('manageBtn').title = manager ? 'Open your Admin controls' : 'Admin controls';
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
      ? adminData.announcements.map((a) => `<div class="admin-row"><div><strong>${escapeHtml(a.title)}</strong><small>${escapeHtml(a.startDate)}${a.endDate ? ' → ' + escapeHtml(a.endDate) : ''}</small></div><div class="admin-row-actions"><button class="mini-toggle" type="button" data-edit-ann="${escapeHtml(a.id)}">Edit</button>${popupToggle('announcement', a)}<button class="mini-delete" data-del-ann="${escapeHtml(a.id)}">Delete</button></div></div>`).join('')
      : '<div class="policy-meta">None posted.</div>';
    $('policyAdminList').innerHTML = adminData.policies.length
      ? adminData.policies.map((p) => `<div class="admin-row"><div><strong>${escapeHtml(p.title)}</strong><small>Effective ${escapeHtml(p.effectiveDate)}</small></div><div class="admin-row-actions"><button class="mini-toggle" type="button" data-edit-pol="${escapeHtml(p.id)}">Edit</button>${popupToggle('policy', p)}<button class="mini-delete" data-del-pol="${escapeHtml(p.id)}">Delete</button></div></div>`).join('')
      : '<div class="policy-meta">None posted.</div>';
    bindAdminDeletes();
    renderTeamAdmin();
    renderToolAdmin();
    renderAccessManager();
    loadPinResetHistory();
    setDefaultDates();
  }

  const popupToggle = (kind, item) => `<button class="mini-toggle${item.showOnOpen ? ' on' : ''}" type="button" data-popup-kind="${kind}" data-popup-id="${escapeHtml(item.id)}" data-popup-on="${item.showOnOpen ? '1' : ''}" title="Open in a pop-up the first time someone opens the Hub each day">${item.showOnOpen ? '🔔 Pop-up on' : 'Pop-up off'}</button>`;

  // Edit: load a posted item back into its form; saving updates it in place.
  function startEdit(formId, item, values) {
    const form = $(formId);
    if (!form || !item) return;
    form.reset();
    Object.entries({ id: item.id, ...values }).forEach(([name, value]) => {
      const input = form.elements[name];
      if (!input) return;
      if (input.type === 'checkbox') input.checked = !!value; else input.value = value ?? '';
    });
    form.querySelector('.edit-banner').hidden = false;
    form.querySelector('[type=submit]').textContent = 'Save changes';
    form.classList.add('editing');
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    form.elements.title?.focus({ preventScroll: true });
  }
  function endEdit(formId) {
    const form = $(formId);
    if (!form) return;
    form.reset();
    form.elements.id.value = '';
    form.querySelector('.edit-banner').hidden = true;
    const submit = form.querySelector('[type=submit]');
    submit.textContent = submit.dataset.label;
    form.classList.remove('editing');
    setDefaultDates();
  }
  document.querySelectorAll('[data-cancel-edit]').forEach((b) => b.addEventListener('click', () => endEdit(b.dataset.cancelEdit)));

  function bindAdminDeletes() {
    document.querySelectorAll('[data-edit-ann]').forEach((b) => { b.onclick = () => {
      const a = adminData.announcements.find((x) => x.id === b.dataset.editAnn);
      startEdit('announcementForm', a, { title: a?.title, message: a?.message, startDate: a?.startDate, endDate: a?.endDate, department: a?.department, pinned: a?.pinned, showOnOpen: a?.showOnOpen });
    }; });
    document.querySelectorAll('[data-edit-pol]').forEach((b) => { b.onclick = () => {
      const p = adminData.policies.find((x) => x.id === b.dataset.editPol);
      startEdit('policyForm', p, { title: p?.title, summary: p?.summary, effectiveDate: p?.effectiveDate, readRequired: p?.readRequired, showOnOpen: p?.showOnOpen });
    }; });
    document.querySelectorAll('[data-popup-kind]').forEach((b) => { b.onclick = async () => {
      b.disabled = true;
      try {
        await adminFetch({ action: 'setShowOnOpen', kind: b.dataset.popupKind, id: b.dataset.popupId, on: !b.dataset.popupOn });
        await refreshAdmin(b.dataset.popupOn ? 'Pop-up turned off.' : 'Pop-up turned on. It shows once a day when someone opens the Hub.');
      } catch (e) {
        showMessage('managerMessage', e.message || 'Could not change the pop-up.', true);
        b.disabled = false;
      }
    }; });
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
    renderAccessManager();
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
      endEdit('announcementForm');
      await refreshAdmin(payload.id ? 'Announcement updated.' : 'Announcement posted.');
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
      endEdit('policyForm');
      await refreshAdmin(payload.id ? 'Policy updated.' : 'Policy update published.');
    } catch (err) {
      showMessage('managerMessage', err.message || 'Could not publish policy.', true);
    }
  });

  injectTeamManager();
  injectAccessManager();
  injectToolManager();
  setDefaultDates();
  loadFeed();
  loadTools();
  document.addEventListener('hub-associate-session', () => loadTools());
})();
