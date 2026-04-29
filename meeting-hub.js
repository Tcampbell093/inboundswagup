/* =========================================================
   meeting-hub.js — Houston Control Daily Meeting Hub
   Phase 1: AM Floor Huddle, Leadership Huddle, PM Inbound
   Sits on top of existing huddle-module.js — does not modify it.
   ========================================================= */
(function () {
  'use strict';

  const STORAGE_KEY = 'ops_hub_meeting_hub_v1';
  const DEPARTMENTS = ['QA Receiving','Prep','Inventory','Fulfillment','Assembly','Office/Admin','Facilities'];

  // ── Helpers ───────────────────────────────────────────────
  function isoToday() { return new Date().toISOString().slice(0, 10); }
  function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, m =>
      ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
  }
  function el(id) { return document.getElementById(id); }
  function fld(id) { return (el(id) || {}).value || ''; }

  // ── Storage ───────────────────────────────────────────────
  function loadData() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch(_) { return {}; }
  }
  function saveData(data) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch(_) {}
  }
  function getDay(date) {
    const data = loadData();
    return data[date] || { date, amFloorHuddle:{}, leadershipHuddle:{ departments:{}, actionItems:[] }, pmInboundHuddle:{} };
  }
  function saveDay(date, day) {
    const data = loadData();
    data[date] = day;
    saveData(data);
  }

  // ── State ─────────────────────────────────────────────────
  let activeDate   = isoToday();
  let activeModal  = null;

  // ── Open / close modals ───────────────────────────────────
  function openModal(id) {
    closeModal();
    const m = el(id);
    if (!m) return;
    m.hidden = false;
    activeModal = id;
    document.body.style.overflow = 'hidden';
  }
  function closeModal() {
    if (activeModal) {
      const m = el(activeModal);
      if (m) m.hidden = true;
      activeModal = null;
    }
    document.body.style.overflow = '';
  }

  // ── Copy to clipboard ─────────────────────────────────────
  function copyText(text, btnId) {
    navigator.clipboard.writeText(text).then(() => {
      const btn = el(btnId);
      if (btn) { const orig = btn.textContent; btn.textContent = '✓ Copied!'; setTimeout(() => btn.textContent = orig, 2000); }
    }).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
    });
  }

  // ═══════════════════════════════════════════════════════════
  // AM FLOOR HUDDLE
  // ═══════════════════════════════════════════════════════════

  function openAM() {
    renderAMForm();
    openModal('meetingHubAMModal');
  }

  function renderAMForm() {
    const day  = getDay(activeDate);
    const d    = day.amFloorHuddle || {};
    const form = el('amHuddleForm');
    if (!form) return;

    form.innerHTML = `
      <div class="mh-date-bar">
        <button class="btn secondary" onclick="window.hcMeeting.amPrevDay()" type="button">◀</button>
        <input type="date" id="amHuddleDate" value="${esc(activeDate)}" style="padding:8px 12px;border-radius:8px;border:1px solid var(--blue2);background:var(--blue1);font-size:14px;font-weight:700;" onchange="window.hcMeeting.amSetDate(this.value)">
        <button class="btn secondary" onclick="window.hcMeeting.amSetDate('${isoToday()}')" type="button">Today</button>
        <button class="btn secondary" onclick="window.hcMeeting.amNextDay()" type="button">▶</button>
      </div>

      <div class="mh-grid-2">
        ${mhField('amYesterdayUnits','📦 Yesterday Units Completed',d.yesterdayUnits,'e.g. 3,200')}
        ${mhField('amYesterdayUPH','⚡ Yesterday UPH',d.yesterdayUPH,'e.g. 85')}
        ${mhField('amYesterdayWin','🏆 Yesterday Win / Improvement',d.yesterdayWin,'What went well?')}
        ${mhField('amTodayUnits','📋 Today Units on Floor',d.todayUnits,'e.g. 2,800')}
        ${mhField('amTodayTarget','🎯 Today Target / Goal',d.todayTarget,'e.g. 3,000')}
        ${mhTextarea('amPriorityWork','🔥 Priority Work Today',d.priorityWork,'What must get done first?')}
        ${mhField('amAttendanceNotes','👥 Attendance Notes',d.attendanceNotes,'e.g. 2 absent, 1 late')}
        ${mhField('amSafetyNotes','🦺 Safety Notes',d.safetyNotes,'Any safety reminders?')}
        ${mhTextarea('amAnnouncements','📢 General Announcements',d.announcements,'Any news for the floor?')}
      </div>

      <div class="mh-section-head">🗣️ Word of the Day</div>
      <div class="mh-grid-2">
        ${mhField('amWordEN','English Word',d.wordEN,'e.g. Efficiency')}
        ${mhField('amWordES','Spanish Word',d.wordES,'e.g. Eficiencia')}
        ${mhField('amSentenceEN','English Example Sentence',d.sentenceEN,'Use the word in a sentence')}
        ${mhField('amSentenceES','Spanish Example Sentence',d.sentenceES,'Usa la palabra en una oración')}
      </div>

      <div class="mh-section-head">🤸 Stretch Routine</div>
      <div style="display:flex;align-items:center;gap:12px;padding:12px 0;">
        <label style="display:flex;align-items:center;gap:8px;font-size:14px;font-weight:700;cursor:pointer;">
          <input type="checkbox" id="amStretch" ${d.stretchDone ? 'checked' : ''} style="width:18px;height:18px;">
          Stretch routine completed today
        </label>
      </div>

      <div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap;">
        <button class="btn" onclick="window.hcMeeting.saveAM()" type="button">💾 Save</button>
        <button class="btn secondary" onclick="window.hcMeeting.generateAMScript()" type="button">📝 Generate Script</button>
      </div>
      <div id="amSaveStatus" style="min-height:20px;font-size:13px;margin-top:8px;"></div>
      <div id="amScriptOutput" style="display:none;margin-top:20px;"></div>
    `;
  }

  function saveAM() {
    const day = getDay(activeDate);
    day.amFloorHuddle = {
      yesterdayUnits: fld('amYesterdayUnits'),
      yesterdayUPH:   fld('amYesterdayUPH'),
      yesterdayWin:   fld('amYesterdayWin'),
      todayUnits:     fld('amTodayUnits'),
      todayTarget:    fld('amTodayTarget'),
      priorityWork:   fld('amPriorityWork'),
      attendanceNotes:fld('amAttendanceNotes'),
      safetyNotes:    fld('amSafetyNotes'),
      announcements:  fld('amAnnouncements'),
      wordEN:         fld('amWordEN'),
      wordES:         fld('amWordES'),
      sentenceEN:     fld('amSentenceEN'),
      sentenceES:     fld('amSentenceES'),
      stretchDone:    (el('amStretch') || {}).checked || false,
      savedAt:        new Date().toISOString(),
    };
    saveDay(activeDate, day);
    const s = el('amSaveStatus');
    if (s) s.innerHTML = '<span style="color:#2ecc71;">✓ Saved</span>';
    setTimeout(() => { if (s) s.textContent = ''; }, 2000);
  }

  function generateAMScript() {
    saveAM();
    const d = getDay(activeDate).amFloorHuddle || {};
    const dateStr = new Date(activeDate + 'T00:00:00').toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' });

    let script = `Good morning everyone — let's get started.\n\n`;
    script += `Today is ${dateStr}.\n\n`;

    if (d.yesterdayUnits || d.yesterdayUPH) {
      script += `YESTERDAY'S RESULTS\n`;
      if (d.yesterdayUnits) script += `We completed ${d.yesterdayUnits} units yesterday.\n`;
      if (d.yesterdayUPH)   script += `Our UPH came in at ${d.yesterdayUPH}.\n`;
      if (d.yesterdayWin)   script += `A big win from yesterday: ${d.yesterdayWin}\n`;
      script += `\n`;
    }

    if (d.todayUnits || d.todayTarget) {
      script += `TODAY'S PLAN\n`;
      if (d.todayUnits)   script += `We have ${d.todayUnits} units on the floor today.\n`;
      if (d.todayTarget)  script += `Our goal is to hit ${d.todayTarget} units.\n`;
      if (d.priorityWork) script += `Priority work today: ${d.priorityWork}\n`;
      script += `\n`;
    }

    if (d.attendanceNotes) script += `ATTENDANCE\n${d.attendanceNotes}\n\n`;
    if (d.safetyNotes)     script += `SAFETY\n${d.safetyNotes} — let's make sure everyone stays safe today.\n\n`;
    if (d.announcements)   script += `ANNOUNCEMENTS\n${d.announcements}\n\n`;

    if (d.wordEN || d.wordES) {
      script += `WORD OF THE DAY\n`;
      if (d.wordEN) script += `English: "${d.wordEN}"`;
      if (d.wordES) script += ` — Spanish: "${d.wordES}"`;
      script += `\n`;
      if (d.sentenceEN) script += `"${d.sentenceEN}"\n`;
      if (d.sentenceES) script += `"${d.sentenceES}"\n`;
      script += `\n`;
    }

    if (d.stretchDone) script += `Let's do our stretch routine before we get going.\n\n`;

    script += `Let's have a great day — stay focused, stay safe. Let's go!`;

    const out = el('amScriptOutput');
    if (!out) return;
    out.style.display = 'block';
    out.innerHTML = `
      <div style="background:var(--blue1);border:1px solid var(--blue2);border-radius:12px;padding:20px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
          <strong style="font-size:14px;">📝 AM Huddle Script</strong>
          <button class="btn secondary" id="amCopyBtn" onclick="window.hcMeeting.copyAMScript()" style="font-size:12px;padding:5px 12px;" type="button">Copy Script</button>
        </div>
        <pre style="white-space:pre-wrap;font-family:Inter,sans-serif;font-size:13px;line-height:1.7;margin:0;">${esc(script)}</pre>
      </div>
    `;
    out.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    window._amScript = script;
  }

  function copyAMScript() { copyText(window._amScript || '', 'amCopyBtn'); }

  // ═══════════════════════════════════════════════════════════
  // LEADERSHIP HUDDLE
  // ═══════════════════════════════════════════════════════════

  function openLeadership() {
    renderLeadershipForm();
    openModal('meetingHubLeadershipModal');
  }

  function renderLeadershipForm() {
    const day  = getDay(activeDate);
    const h    = day.leadershipHuddle || { departments:{}, actionItems:[] };
    const form = el('leadershipHuddleForm');
    if (!form) return;

    const statusColors = { Green:'#2ecc71', Yellow:'#f1c40f', Red:'#e74c3c' };

    form.innerHTML = `
      <div class="mh-date-bar">
        <button class="btn secondary" onclick="window.hcMeeting.leadPrevDay()" type="button">◀</button>
        <input type="date" id="leadHuddleDate" value="${esc(activeDate)}" style="padding:8px 12px;border-radius:8px;border:1px solid var(--blue2);background:var(--blue1);font-size:14px;font-weight:700;" onchange="window.hcMeeting.leadSetDate(this.value)">
        <button class="btn secondary" onclick="window.hcMeeting.leadSetDate('${isoToday()}')" type="button">Today</button>
        <button class="btn secondary" onclick="window.hcMeeting.leadNextDay()" type="button">▶</button>
      </div>

      <div class="mh-section-head">Department Check-ins</div>
      <div class="mh-dept-grid" id="leadDeptCards">
        ${DEPARTMENTS.map(dept => {
          const dd = (h.departments || {})[dept] || {};
          return `
          <div class="mh-dept-card">
            <div class="mh-dept-card-head">
              <strong>${esc(dept)}</strong>
              <select class="mh-status-select" data-dept="${esc(dept)}" data-field="status" style="border-color:${statusColors[dd.status] || 'var(--blue2)'};">
                <option value="">Status</option>
                <option value="Green" ${dd.status==='Green'?'selected':''}>🟢 Green</option>
                <option value="Yellow" ${dd.status==='Yellow'?'selected':''}>🟡 Yellow</option>
                <option value="Red" ${dd.status==='Red'?'selected':''}>🔴 Red</option>
              </select>
            </div>
            <div class="mh-dept-fields">
              ${mhDeptField(dept,'leadName','Lead Name',dd.leadName,'')}
              <div style="display:flex;gap:8px;">
                <div style="flex:1;">
                  <label style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;">Volume</label>
                  <select class="mh-status-select" data-dept="${esc(dept)}" data-field="volume" style="width:100%;">
                    <option value="">Volume</option>
                    <option value="Low" ${dd.volume==='Low'?'selected':''}>Low</option>
                    <option value="Medium" ${dd.volume==='Medium'?'selected':''}>Medium</option>
                    <option value="High" ${dd.volume==='High'?'selected':''}>High</option>
                  </select>
                </div>
                <div style="flex:1;">
                  ${mhDeptField(dept,'absences','Absences Today',dd.absences,'')}
                </div>
              </div>
              ${mhDeptField(dept,'staffingStatus','Staffing Status',dd.staffingStatus,'Fully staffed / short-handed?')}
              ${mhDeptField(dept,'scheduledTimeOff','Scheduled Time Off',dd.scheduledTimeOff,'Later this week?')}
              ${mhDeptField(dept,'mainPriority','Main Priority Today',dd.mainPriority,'')}
              ${mhDeptField(dept,'currentBlocker','Current Blocker',dd.currentBlocker,'What is slowing you down?')}
              ${mhDeptField(dept,'helpNeeded','Help Needed From',dd.helpNeeded,'Which dept can help?')}
              ${mhDeptField(dept,'othersShouldKnow','Others Should Know',dd.othersShouldKnow,'Cross-dept awareness')}
              ${mhDeptField(dept,'safetyConcern','Safety Concern',dd.safetyConcern,'Any safety issues?')}
              ${mhDeptField(dept,'suppliesNeeded','Supplies / Equipment',dd.suppliesNeeded,'What do you need?')}
            </div>
          </div>`;
        }).join('')}
      </div>

      <div class="mh-section-head" style="margin-top:24px;">Action Items</div>
      <div id="leadActionItems"></div>
      <button class="btn secondary" onclick="window.hcMeeting.addActionItem()" type="button" style="margin-top:8px;">+ Add Action Item</button>

      <div style="display:flex;gap:10px;margin-top:20px;flex-wrap:wrap;">
        <button class="btn" onclick="window.hcMeeting.saveLead()" type="button">💾 Save</button>
        <button class="btn secondary" onclick="window.hcMeeting.generateLeadSummary()" type="button">📋 Generate Summary</button>
      </div>
      <div id="leadSaveStatus" style="min-height:20px;font-size:13px;margin-top:8px;"></div>
      <div id="leadSummaryOutput" style="display:none;margin-top:20px;"></div>
    `;

    renderActionItems(h.actionItems || []);

    // Wire dept field changes
    form.querySelectorAll('[data-dept][data-field]').forEach(sel => {
      sel.addEventListener('change', () => {
        if (sel.getAttribute('data-field') === 'status') {
          const colors = { Green:'#2ecc71', Yellow:'#f1c40f', Red:'#e74c3c' };
          sel.style.borderColor = colors[sel.value] || 'var(--blue2)';
        }
      });
    });
  }

  function mhDeptField(dept, field, label, value, placeholder) {
    return `<div>
      <label style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;display:block;margin-bottom:4px;">${esc(label)}</label>
      <input type="text" class="mh-dept-input" data-dept="${esc(dept)}" data-field="${esc(field)}"
        value="${esc(value||'')}" placeholder="${esc(placeholder)}"
        style="width:100%;padding:7px 10px;border-radius:7px;border:1px solid var(--blue2);background:var(--blue1);font-size:13px;">
    </div>`;
  }

  function renderActionItems(items) {
    const container = el('leadActionItems');
    if (!container) return;
    if (!items.length) {
      container.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:8px 0;">No action items yet.</div>';
      return;
    }
    container.innerHTML = items.map((item, idx) => `
      <div class="mh-action-item" data-idx="${idx}">
        <div class="mh-grid-3">
          <input type="text" placeholder="Task title" value="${esc(item.title||'')}" data-action-field="title" data-idx="${idx}" style="padding:8px;border-radius:7px;border:1px solid var(--blue2);background:var(--bg);font-size:13px;font-weight:700;">
          <input type="text" placeholder="Assigned to" value="${esc(item.assignedTo||'')}" data-action-field="assignedTo" data-idx="${idx}" style="padding:8px;border-radius:7px;border:1px solid var(--blue2);background:var(--bg);font-size:13px;">
          <input type="text" placeholder="Department" value="${esc(item.department||'')}" data-action-field="department" data-idx="${idx}" style="padding:8px;border-radius:7px;border:1px solid var(--blue2);background:var(--bg);font-size:13px;">
        </div>
        <div class="mh-grid-3" style="margin-top:6px;">
          <input type="date" value="${esc(item.dueDate||'')}" data-action-field="dueDate" data-idx="${idx}" style="padding:8px;border-radius:7px;border:1px solid var(--blue2);background:var(--bg);font-size:13px;">
          <select data-action-field="priority" data-idx="${idx}" style="padding:8px;border-radius:7px;border:1px solid var(--blue2);background:var(--bg);font-size:13px;">
            <option value="Low" ${item.priority==='Low'?'selected':''}>Low Priority</option>
            <option value="Medium" ${item.priority==='Medium'?'selected':''}>Medium Priority</option>
            <option value="High" ${item.priority==='High'?'selected':''}>High Priority</option>
          </select>
          <select data-action-field="status" data-idx="${idx}" style="padding:8px;border-radius:7px;border:1px solid var(--blue2);background:var(--bg);font-size:13px;">
            <option value="Open" ${item.status==='Open'?'selected':''}>Open</option>
            <option value="In Progress" ${item.status==='In Progress'?'selected':''}>In Progress</option>
            <option value="Done" ${item.status==='Done'?'selected':''}>Done</option>
            <option value="Blocked" ${item.status==='Blocked'?'selected':''}>Blocked</option>
          </select>
        </div>
        <div style="display:flex;gap:8px;margin-top:6px;align-items:center;">
          <input type="text" placeholder="Notes" value="${esc(item.notes||'')}" data-action-field="notes" data-idx="${idx}" style="flex:1;padding:8px;border-radius:7px;border:1px solid var(--blue2);background:var(--bg);font-size:13px;">
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;">
            <input type="checkbox" data-action-field="needsLeadership" data-idx="${idx}" ${item.needsLeadership?'checked':''}>
            Needs Leadership
          </label>
          <button class="btn secondary" onclick="window.hcMeeting.removeActionItem(${idx})" style="font-size:12px;padding:5px 10px;" type="button">✕</button>
        </div>
      </div>
    `).join('');
  }

  function addActionItem() {
    const day = getDay(activeDate);
    if (!day.leadershipHuddle) day.leadershipHuddle = { departments:{}, actionItems:[] };
    if (!day.leadershipHuddle.actionItems) day.leadershipHuddle.actionItems = [];
    day.leadershipHuddle.actionItems.push({ title:'', assignedTo:'', department:'', dueDate:'', priority:'Medium', status:'Open', notes:'', needsLeadership:false });
    saveDay(activeDate, day);
    renderActionItems(day.leadershipHuddle.actionItems);
  }

  function removeActionItem(idx) {
    const day = getDay(activeDate);
    day.leadershipHuddle.actionItems.splice(idx, 1);
    saveDay(activeDate, day);
    renderActionItems(day.leadershipHuddle.actionItems);
  }

  function collectLeadData() {
    const form  = el('leadershipHuddleForm');
    const depts = {};

    DEPARTMENTS.forEach(dept => {
      const dd = {};
      form.querySelectorAll(`[data-dept="${dept}"][data-field]`).forEach(inp => {
        dd[inp.getAttribute('data-field')] = inp.type === 'checkbox' ? inp.checked : inp.value;
      });
      depts[dept] = dd;
    });

    const actionItems = [];
    const itemEls = (el('leadActionItems') || {}).querySelectorAll ? el('leadActionItems').querySelectorAll('[data-idx]') : [];
    const seen = new Set();
    itemEls.forEach(inp => {
      const idx = parseInt(inp.getAttribute('data-idx'));
      if (!seen.has(idx)) { seen.add(idx); actionItems[idx] = actionItems[idx] || {}; }
      const field = inp.getAttribute('data-action-field');
      if (field) actionItems[idx][field] = inp.type === 'checkbox' ? inp.checked : inp.value;
    });

    return { departments: depts, actionItems: actionItems.filter(Boolean), savedAt: new Date().toISOString() };
  }

  function saveLead() {
    const day = getDay(activeDate);
    day.leadershipHuddle = collectLeadData();
    saveDay(activeDate, day);
    const s = el('leadSaveStatus');
    if (s) s.innerHTML = '<span style="color:#2ecc71;">✓ Saved</span>';
    setTimeout(() => { if (s) s.textContent = ''; }, 2000);
  }

  function generateLeadSummary() {
    saveLead();
    const h = getDay(activeDate).leadershipHuddle || {};
    const depts = h.departments || {};
    const items = h.actionItems || [];
    const dateStr = new Date(activeDate + 'T00:00:00').toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' });

    let summary = `LEADERSHIP HUDDLE SUMMARY — ${dateStr}\n${'─'.repeat(50)}\n\n`;

    // Overall status
    const reds    = DEPARTMENTS.filter(d => depts[d]?.status === 'Red');
    const yellows = DEPARTMENTS.filter(d => depts[d]?.status === 'Yellow');
    const greens  = DEPARTMENTS.filter(d => depts[d]?.status === 'Green');
    summary += `FLOOR STATUS OVERVIEW\n`;
    if (greens.length)   summary += `✅ Green: ${greens.join(', ')}\n`;
    if (yellows.length)  summary += `⚠️ Yellow: ${yellows.join(', ')}\n`;
    if (reds.length)     summary += `🔴 Red: ${reds.join(', ')}\n`;
    summary += `\n`;

    // Dept by dept
    summary += `DEPARTMENT UPDATES\n`;
    DEPARTMENTS.forEach(dept => {
      const dd = depts[dept] || {};
      if (!dd.leadName && !dd.mainPriority && !dd.currentBlocker) return;
      summary += `\n${dept}`;
      if (dd.leadName)        summary += ` (${dd.leadName})`;
      if (dd.status)          summary += ` — ${dd.status}`;
      if (dd.volume)          summary += ` · Volume: ${dd.volume}`;
      summary += `\n`;
      if (dd.staffingStatus)  summary += `  Staffing: ${dd.staffingStatus}\n`;
      if (dd.absences)        summary += `  Absences: ${dd.absences}\n`;
      if (dd.mainPriority)    summary += `  Priority: ${dd.mainPriority}\n`;
      if (dd.currentBlocker)  summary += `  Blocker: ${dd.currentBlocker}\n`;
      if (dd.helpNeeded)      summary += `  Needs help from: ${dd.helpNeeded}\n`;
      if (dd.othersShouldKnow) summary += `  FYI: ${dd.othersShouldKnow}\n`;
    });
    summary += `\n`;

    // Safety
    const safetyItems = DEPARTMENTS.filter(d => depts[d]?.safetyConcern);
    if (safetyItems.length) {
      summary += `SAFETY CONCERNS\n`;
      safetyItems.forEach(d => summary += `  ${d}: ${depts[d].safetyConcern}\n`);
      summary += `\n`;
    }

    // Supplies
    const supplyItems = DEPARTMENTS.filter(d => depts[d]?.suppliesNeeded);
    if (supplyItems.length) {
      summary += `SUPPLIES / EQUIPMENT NEEDED\n`;
      supplyItems.forEach(d => summary += `  ${d}: ${depts[d].suppliesNeeded}\n`);
      summary += `\n`;
    }

    // Action items
    if (items.length) {
      summary += `ACTION ITEMS\n`;
      items.forEach((item, i) => {
        summary += `  ${i+1}. ${item.title || 'Untitled'}`;
        if (item.assignedTo)  summary += ` → ${item.assignedTo}`;
        if (item.dueDate)     summary += ` (Due: ${item.dueDate})`;
        if (item.priority)    summary += ` [${item.priority}]`;
        if (item.status)      summary += ` · ${item.status}`;
        if (item.needsLeadership) summary += ` ⚑ NEEDS LEADERSHIP`;
        summary += `\n`;
        if (item.notes)       summary += `     Notes: ${item.notes}\n`;
      });
      summary += `\n`;
    }

    // Staffing risks
    const staffingRisks = DEPARTMENTS.filter(d => depts[d]?.scheduledTimeOff);
    if (staffingRisks.length) {
      summary += `UPCOMING STAFFING RISKS\n`;
      staffingRisks.forEach(d => summary += `  ${d}: ${depts[d].scheduledTimeOff}\n`);
    }

    const out = el('leadSummaryOutput');
    if (!out) return;
    out.style.display = 'block';
    out.innerHTML = `
      <div style="background:var(--blue1);border:1px solid var(--blue2);border-radius:12px;padding:20px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
          <strong style="font-size:14px;">📋 Leadership Summary</strong>
          <button class="btn secondary" id="leadCopyBtn" onclick="window.hcMeeting.copyLeadSummary()" style="font-size:12px;padding:5px 12px;" type="button">Copy Summary</button>
        </div>
        <pre style="white-space:pre-wrap;font-family:Inter,sans-serif;font-size:13px;line-height:1.7;margin:0;">${esc(summary)}</pre>
      </div>
    `;
    out.scrollIntoView({ behavior:'smooth', block:'nearest' });
    window._leadSummary = summary;
  }

  function copyLeadSummary() { copyText(window._leadSummary || '', 'leadCopyBtn'); }

  // ═══════════════════════════════════════════════════════════
  // PM INBOUND HUDDLE
  // ═══════════════════════════════════════════════════════════

  function openPM() {
    renderPMForm();
    openModal('meetingHubPMModal');
  }

  function renderPMForm() {
    const day  = getDay(activeDate);
    const d    = day.pmInboundHuddle || {};
    const form = el('pmHuddleForm');
    if (!form) return;

    form.innerHTML = `
      <div class="mh-date-bar">
        <button class="btn secondary" onclick="window.hcMeeting.pmPrevDay()" type="button">◀</button>
        <input type="date" id="pmHuddleDate" value="${esc(activeDate)}" style="padding:8px 12px;border-radius:8px;border:1px solid var(--blue2);background:var(--blue1);font-size:14px;font-weight:700;" onchange="window.hcMeeting.pmSetDate(this.value)">
        <button class="btn secondary" onclick="window.hcMeeting.pmSetDate('${isoToday()}')" type="button">Today</button>
        <button class="btn secondary" onclick="window.hcMeeting.pmNextDay()" type="button">▶</button>
      </div>

      <div class="mh-section-head">Today's Closeout</div>
      <div class="mh-grid-2">
        ${mhField('pmUnitsCompleted','📦 Units Completed Today',d.unitsCompleted,'')}
        ${mhField('pmUnitsLeft','📋 Units Left on Floor',d.unitsLeft,'')}
        ${mhField('pmReceivingStatus','📥 Receiving Status',d.receivingStatus,'Where does Receiving stand?')}
        ${mhField('pmPrepStatus','🔄 Prep Status',d.prepStatus,'Where does Prep stand?')}
        ${mhField('pmPutawayStatus','📦 Putaway / Overstock Status',d.putawayStatus,'')}
        ${mhTextarea('pmWhatWentWell','✅ What Went Well Today',d.whatWentWell,'')}
        ${mhTextarea('pmWhatSlowedUs','🐢 What Slowed Us Down',d.whatSlowedUs,'')}
        ${mhTextarea('pmComplexRemaining','⚙️ Complex Work Remaining',d.complexRemaining,'Any tricky POs still open?')}
      </div>

      <div class="mh-section-head">Tomorrow's Plan</div>
      <div class="mh-grid-2">
        ${mhField('pmTmrwUnits','📦 Expected Units Tomorrow',d.tmrwUnits,'')}
        ${mhField('pmTmrwHeadcount','👥 Required Inbound Headcount',d.tmrwHeadcount,'')}
        ${mhField('pmTmrwStayingInbound','✅ Staying in Inbound',d.tmrwStayingInbound,'Names')}
        ${mhField('pmTmrwFlexing','🔀 Flexing to Overstock / Auditing',d.tmrwFlexing,'Names')}
        ${mhField('pmPBsReady','✅ Pack Builders Ready',d.pbsReady,'PBs cleared for tomorrow')}
        ${mhField('pmPBsPendingRcv','⏳ PBs Pending Receiving',d.pbsPendingRcv,'')}
        ${mhField('pmPBsPendingPrep','⏳ PBs Pending Prep',d.pbsPendingPrep,'')}
        ${mhField('pmPBsCanAdd','➕ PBs That Can Be Added If Cleared',d.pbsCanAdd,'')}
        ${mhField('pmPBsPushed','➡️ PBs Pushed to Next Day',d.pbsPushed,'')}
        ${mhTextarea('pmTmrwPriority','🔥 Tomorrow\'s Main Priority',d.tmrwPriority,'')}
        ${mhTextarea('pmSupportNeeded','🙋 Support Needed Tomorrow',d.supportNeeded,'What do you need from leadership or other depts?')}
      </div>

      <div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap;">
        <button class="btn" onclick="window.hcMeeting.savePM()" type="button">💾 Save</button>
        <button class="btn secondary" onclick="window.hcMeeting.generatePMRecap()" type="button">📝 Generate Recap</button>
      </div>
      <div id="pmSaveStatus" style="min-height:20px;font-size:13px;margin-top:8px;"></div>
      <div id="pmRecapOutput" style="display:none;margin-top:20px;"></div>
    `;
  }

  function savePM() {
    const day = getDay(activeDate);
    day.pmInboundHuddle = {
      unitsCompleted:      fld('pmUnitsCompleted'),
      unitsLeft:           fld('pmUnitsLeft'),
      receivingStatus:     fld('pmReceivingStatus'),
      prepStatus:          fld('pmPrepStatus'),
      putawayStatus:       fld('pmPutawayStatus'),
      whatWentWell:        fld('pmWhatWentWell'),
      whatSlowedUs:        fld('pmWhatSlowedUs'),
      complexRemaining:    fld('pmComplexRemaining'),
      tmrwUnits:           fld('pmTmrwUnits'),
      tmrwHeadcount:       fld('pmTmrwHeadcount'),
      tmrwStayingInbound:  fld('pmTmrwStayingInbound'),
      tmrwFlexing:         fld('pmTmrwFlexing'),
      pbsReady:            fld('pmPBsReady'),
      pbsPendingRcv:       fld('pmPBsPendingRcv'),
      pbsPendingPrep:      fld('pmPBsPendingPrep'),
      pbsCanAdd:           fld('pmPBsCanAdd'),
      pbsPushed:           fld('pmPBsPushed'),
      tmrwPriority:        fld('pmTmrwPriority'),
      supportNeeded:       fld('pmSupportNeeded'),
      savedAt:             new Date().toISOString(),
    };
    saveDay(activeDate, day);
    const s = el('pmSaveStatus');
    if (s) s.innerHTML = '<span style="color:#2ecc71;">✓ Saved</span>';
    setTimeout(() => { if (s) s.textContent = ''; }, 2000);
  }

  function generatePMRecap() {
    savePM();
    const d = getDay(activeDate).pmInboundHuddle || {};
    const dateStr = new Date(activeDate + 'T00:00:00').toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' });

    let recap = `PM INBOUND HUDDLE RECAP — ${dateStr}\n${'─'.repeat(50)}\n\n`;

    recap += `TODAY'S CLOSEOUT\n`;
    if (d.unitsCompleted) recap += `Units completed: ${d.unitsCompleted}\n`;
    if (d.unitsLeft)      recap += `Units remaining on floor: ${d.unitsLeft}\n`;
    if (d.receivingStatus) recap += `Receiving: ${d.receivingStatus}\n`;
    if (d.prepStatus)     recap += `Prep: ${d.prepStatus}\n`;
    if (d.putawayStatus)  recap += `Putaway/Overstock: ${d.putawayStatus}\n`;
    if (d.whatWentWell)   recap += `What went well: ${d.whatWentWell}\n`;
    if (d.whatSlowedUs)   recap += `What slowed us down: ${d.whatSlowedUs}\n`;
    if (d.complexRemaining) recap += `Complex work remaining: ${d.complexRemaining}\n`;
    recap += `\n`;

    recap += `TOMORROW'S LABOR PLAN\n`;
    if (d.tmrwUnits)          recap += `Expected units: ${d.tmrwUnits}\n`;
    if (d.tmrwHeadcount)      recap += `Required inbound headcount: ${d.tmrwHeadcount}\n`;
    if (d.tmrwStayingInbound) recap += `Staying in inbound: ${d.tmrwStayingInbound}\n`;
    if (d.tmrwFlexing)        recap += `Flexing to Overstock/Auditing: ${d.tmrwFlexing}\n`;
    recap += `\n`;

    recap += `PACK BUILDER FORECAST\n`;
    if (d.pbsReady)       recap += `Ready for tomorrow: ${d.pbsReady}\n`;
    if (d.pbsPendingRcv)  recap += `Pending Receiving: ${d.pbsPendingRcv}\n`;
    if (d.pbsPendingPrep) recap += `Pending Prep: ${d.pbsPendingPrep}\n`;
    if (d.pbsCanAdd)      recap += `Can be added if cleared: ${d.pbsCanAdd}\n`;
    if (d.pbsPushed)      recap += `Pushed to next day: ${d.pbsPushed}\n`;
    recap += `\n`;

    if (d.tmrwPriority)   recap += `TOMORROW'S PRIORITY\n${d.tmrwPriority}\n\n`;
    if (d.supportNeeded)  recap += `SUPPORT NEEDED\n${d.supportNeeded}\n`;

    const out = el('pmRecapOutput');
    if (!out) return;
    out.style.display = 'block';
    out.innerHTML = `
      <div style="background:var(--blue1);border:1px solid var(--blue2);border-radius:12px;padding:20px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
          <strong style="font-size:14px;">📝 PM Inbound Recap</strong>
          <button class="btn secondary" id="pmCopyBtn" onclick="window.hcMeeting.copyPMRecap()" style="font-size:12px;padding:5px 12px;" type="button">Copy Recap</button>
        </div>
        <pre style="white-space:pre-wrap;font-family:Inter,sans-serif;font-size:13px;line-height:1.7;margin:0;">${esc(recap)}</pre>
      </div>
    `;
    out.scrollIntoView({ behavior:'smooth', block:'nearest' });
    window._pmRecap = recap;
  }

  function copyPMRecap() { copyText(window._pmRecap || '', 'pmCopyBtn'); }

  // ═══════════════════════════════════════════════════════════
  // CARRYOVER PANEL
  // ═══════════════════════════════════════════════════════════

  function renderCarryover() {
    const panel = el('meetingHubCarryover');
    if (!panel) return;

    // Look at yesterday
    const yesterday = new Date(activeDate + 'T00:00:00');
    yesterday.setDate(yesterday.getDate() - 1);
    const yDate = yesterday.toISOString().slice(0, 10);
    const yDay  = getDay(yDate);
    const items  = (yDay.leadershipHuddle?.actionItems || []).filter(i => i.status !== 'Done');
    const blockers = [];

    Object.entries(yDay.leadershipHuddle?.departments || {}).forEach(([dept, dd]) => {
      if (dd.currentBlocker) blockers.push({ dept, blocker: dd.currentBlocker });
    });

    const pmD = yDay.pmInboundHuddle || {};

    if (!items.length && !blockers.length && !pmD.pbsPendingRcv && !pmD.pbsPendingPrep && !pmD.supportNeeded) {
      panel.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:12px 0;">No carryover items from yesterday.</div>';
      return;
    }

    let html = '';

    if (blockers.length) {
      html += `<div class="mh-section-head" style="margin-top:0;">🚧 Unresolved Blockers from ${yDate}</div>`;
      html += blockers.map(b => `<div class="mh-carryover-item" style="border-left:3px solid #e74c3c;">
        <strong>${esc(b.dept)}</strong>: ${esc(b.blocker)}
      </div>`).join('');
    }

    if (items.length) {
      html += `<div class="mh-section-head">⚡ Open Action Items from ${yDate}</div>`;
      html += items.map(i => `<div class="mh-carryover-item" style="border-left:3px solid #f1c40f;">
        <strong>${esc(i.title||'Untitled')}</strong>
        ${i.assignedTo ? ` → ${esc(i.assignedTo)}` : ''}
        <span style="color:var(--muted);font-size:12px;margin-left:8px;">${esc(i.status||'Open')}</span>
        ${i.needsLeadership ? ' <span style="color:#e74c3c;font-size:11px;font-weight:800;">⚑ NEEDS LEADERSHIP</span>' : ''}
      </div>`).join('');
    }

    if (pmD.pbsPendingRcv || pmD.pbsPendingPrep) {
      html += `<div class="mh-section-head">📦 Pending Pack Builders from ${yDate}</div>`;
      if (pmD.pbsPendingRcv)  html += `<div class="mh-carryover-item" style="border-left:3px solid #3498db;">Pending Receiving: ${esc(pmD.pbsPendingRcv)}</div>`;
      if (pmD.pbsPendingPrep) html += `<div class="mh-carryover-item" style="border-left:3px solid #9b59b6;">Pending Prep: ${esc(pmD.pbsPendingPrep)}</div>`;
    }

    if (pmD.supportNeeded) {
      html += `<div class="mh-section-head">🙋 Support Needed from ${yDate}</div>`;
      html += `<div class="mh-carryover-item" style="border-left:3px solid #2ecc71;">${esc(pmD.supportNeeded)}</div>`;
    }

    panel.innerHTML = html;
  }

  // ═══════════════════════════════════════════════════════════
  // SHARED FIELD HELPERS
  // ═══════════════════════════════════════════════════════════

  function mhField(id, label, value, placeholder) {
    return `<div>
      <label style="font-size:11px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;display:block;margin-bottom:6px;">${esc(label)}</label>
      <input type="text" id="${id}" value="${esc(value||'')}" placeholder="${esc(placeholder)}"
        style="width:100%;padding:9px 12px;border-radius:8px;border:1px solid var(--blue2);background:var(--blue1);font-size:13px;">
    </div>`;
  }

  function mhTextarea(id, label, value, placeholder) {
    return `<div>
      <label style="font-size:11px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;display:block;margin-bottom:6px;">${esc(label)}</label>
      <textarea id="${id}" placeholder="${esc(placeholder)}"
        style="width:100%;padding:9px 12px;border-radius:8px;border:1px solid var(--blue2);background:var(--blue1);font-size:13px;min-height:72px;resize:vertical;">${esc(value||'')}</textarea>
    </div>`;
  }

  // ═══════════════════════════════════════════════════════════
  // DATE NAVIGATION
  // ═══════════════════════════════════════════════════════════

  function shiftDate(days) {
    const d = new Date(activeDate + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }

  // ═══════════════════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════════════════

  function init() {
    // Render carryover when Daily Brief page becomes visible
    const observer = new MutationObserver(function() {
      const page = document.getElementById('huddlePage');
      if (page && page.classList.contains('active')) {
        renderCarryover();
      }
    });
    observer.observe(document.body, { attributes:true, subtree:true, attributeFilter:['class'] });

    // ESC to close modals
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') closeModal();
    });
  }

  // ── Public API ────────────────────────────────────────────
  window.hcMeeting = {
    openAM, openLeadership, openPM, closeModal,
    saveAM, saveLead, savePM,
    generateAMScript, generateLeadSummary, generatePMRecap,
    copyAMScript, copyLeadSummary, copyPMRecap,
    addActionItem, removeActionItem,
    // Date nav
    amPrevDay:   () => { activeDate = shiftDate(-1); renderAMForm(); },
    amNextDay:   () => { activeDate = shiftDate(1);  renderAMForm(); },
    amSetDate:   (d) => { activeDate = d || isoToday(); renderAMForm(); },
    leadPrevDay: () => { activeDate = shiftDate(-1); renderLeadershipForm(); },
    leadNextDay: () => { activeDate = shiftDate(1);  renderLeadershipForm(); },
    leadSetDate: (d) => { activeDate = d || isoToday(); renderLeadershipForm(); },
    pmPrevDay:   () => { activeDate = shiftDate(-1); renderPMForm(); },
    pmNextDay:   () => { activeDate = shiftDate(1);  renderPMForm(); },
    pmSetDate:   (d) => { activeDate = d || isoToday(); renderPMForm(); },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
