/* =========================================================
   meeting-hub.js — Houston Control Daily Meeting Hub
   Phase 1: AM Floor Huddle, Leadership Huddle, PM Inbound
   Sits on top of existing huddle-module.js — does not modify it.
   ========================================================= */
(function () {
  'use strict';

  const STORAGE_KEY = 'ops_hub_meeting_hub_v1';
  const DEPARTMENTS = ['Fulfillment','Inventory','QA Receiving','QA Prepping','Assembly'];

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
    lhState.deptIdx = 0;
    lhState.innerStep = 0;
    lhRender();
    openModal('meetingHubLeadershipModal');
  }

  // ── Leadership Huddle Wizard ──────────────────────────────
  const LH_DEPTS = ['Fulfillment','Inventory','QA Receiving','QA Prepping','Assembly'];
  const LH_STEPS = ['lead','status','volume','absences','pto','notes'];
  const lhState  = { deptIdx: 0, innerStep: 0 };

  function lhGetDeptData(dept) {
    const day = getDay(activeDate);
    if (!day.leadershipHuddle) day.leadershipHuddle = { departments:{} };
    if (!day.leadershipHuddle.departments) day.leadershipHuddle.departments = {};
    if (!day.leadershipHuddle.departments[dept]) day.leadershipHuddle.departments[dept] = { lead:'', status:'', volume:'', pto:[], notes:'' };
    return day.leadershipHuddle.departments[dept];
  }

  function lhSaveCurrent() {
    const dept = LH_DEPTS[lhState.deptIdx];
    const step = LH_STEPS[lhState.innerStep];
    const d    = lhGetDeptData(dept);
    if (step === 'notes') d.notes = el('lhNotesInput') ? el('lhNotesInput').value : d.notes;
    saveDay(activeDate, getDay(activeDate));
  }

  function lhNav(dir) {
    lhSaveCurrent();
    lhState.innerStep += dir;
    if (lhState.innerStep < 0) {
      if (lhState.deptIdx > 0) { lhState.deptIdx--; lhState.innerStep = LH_STEPS.length - 1; }
      else { lhState.innerStep = 0; return; }
    }
    if (lhState.innerStep >= LH_STEPS.length) {
      if (lhState.deptIdx < LH_DEPTS.length - 1) { lhState.deptIdx++; lhState.innerStep = 0; }
      else { lhRenderDone(); return; }
    }
    lhRender();
  }

  function lhJumpDept(idx) {
    lhSaveCurrent();
    lhState.deptIdx = idx;
    lhState.innerStep = 0;
    lhRender();
  }

  function lhSelectLead(name) {
    lhGetDeptData(LH_DEPTS[lhState.deptIdx]).lead = name;
    saveDay(activeDate, getDay(activeDate));
    lhRender();
  }

  function lhSelectStatus(val) {
    lhGetDeptData(LH_DEPTS[lhState.deptIdx]).status = val;
    saveDay(activeDate, getDay(activeDate));
    lhRender();
  }

  function lhSelectVolume(val) {
    lhGetDeptData(LH_DEPTS[lhState.deptIdx]).volume = val;
    saveDay(activeDate, getDay(activeDate));
    lhRender();
  }

  function lhAddPTO(name) {
    const dept = LH_DEPTS[lhState.deptIdx];
    const dateEl = el('lhPtoDate');
    const date = dateEl ? dateEl.value : '';
    if (!date) return;
    const d = lhGetDeptData(dept);
    d.pto = (d.pto || []).filter(function(p){ return p.name !== name; });
    d.pto.push({ name: name, date: date });
    saveDay(activeDate, getDay(activeDate));
    lhRenderPTO(dept);
  }

  function lhRemovePTO(name) {
    const dept = LH_DEPTS[lhState.deptIdx];
    const d = lhGetDeptData(dept);
    d.pto = (d.pto || []).filter(function(p){ return p.name !== name; });
    saveDay(activeDate, getDay(activeDate));
    lhRenderPTO(dept);
  }

  function lhRenderPTO(dept) {
    const list = el('lhPtoList');
    if (!list) return;
    const items = lhGetDeptData(dept).pto || [];
    list.innerHTML = items.length
      ? items.map(function(p){ return '<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:8px;background:var(--blue1);border:1px solid var(--blue2);margin-bottom:6px;font-size:13px;"><span style=\'flex:1;font-weight:700;\'>' + esc(p.name) + '</span><span style=\'color:var(--muted);font-size:12px;\'>' + esc(p.date) + '</span><button onclick=\'window.hcMeeting.lhRemovePTO("' + esc(p.name) + '")\'  style=\'background:none;border:none;color:#e74c3c;cursor:pointer;font-size:16px;padding:0 4px;\'  type=\'button\'>×</button></div>'; }).join('')
      : '<div style="font-size:13px;color:var(--muted);">None logged yet</div>';
  }

  function lhGetAbsences(dept) {
    try {
      const today = isoToday();
      const records = (typeof attendanceRecords !== 'undefined' && Array.isArray(attendanceRecords)) ? attendanceRecords : [];
      return records
        .filter(function(r){ return r.date === today && ['Absent','Call Out','No Call No Show'].includes(r.mark); })
        .filter(function(r){
          const empDept = (r.department || '').toLowerCase().replace(/\s+/g,'');
          const target  = dept.toLowerCase().replace(/\s+/g,'');
          return empDept === target || empDept.includes(target) || target.includes(empDept);
        })
        .map(function(r){ return r.name || r.employee || ''; });
    } catch(e){ return []; }
  }

  function lhGetEmployees(dept) {
    try {
      var roster = [];
      var keys = ['ops_hub_attendance_settings_v1','ops_hub_employees_v1'];
      for (var k = 0; k < keys.length; k++) {
        try {
          var raw = localStorage.getItem(keys[k]);
          if (raw) {
            var parsed = JSON.parse(raw);
            var emps = parsed.employees || parsed.roster || [];
            if (emps.length) { roster = emps; break; }
          }
        } catch(e2){}
      }
      return roster
        .filter(function(e){
          var empDept = (e.department || '').toLowerCase().replace(/\s+/g,'');
          var target  = dept.toLowerCase().replace(/\s+/g,'');
          return empDept === target || empDept.includes(target) || target.includes(empDept);
        })
        .map(function(e){ return e.name || e.adpName || ''; })
        .filter(Boolean);
    } catch(e){ return []; }
  }

  function lhRender() {
    const form = el('leadershipHuddleForm');
    if (!form) return;
    const dept  = LH_DEPTS[lhState.deptIdx];
    const step  = LH_STEPS[lhState.innerStep];
    const d     = lhGetDeptData(dept);
    const emps  = lhGetEmployees(dept);
    const abs   = lhGetAbsences(dept);
    const total = LH_DEPTS.length * LH_STEPS.length;
    const curr  = lhState.deptIdx * LH_STEPS.length + lhState.innerStep + 1;
    const pct   = Math.round((curr / total) * 100);
    const stepLabels = { lead:'Lead', status:'Status', volume:'Volume', absences:'Absences', pto:'Time Off', notes:'Notes' };

    const pills = LH_DEPTS.map(function(d2, i) {
      const isDone   = i < lhState.deptIdx;
      const isActive = i === lhState.deptIdx;
      const dd       = lhGetDeptData(d2);
      const sc       = { Green:'#2ecc71', Yellow:'#f1c40f', Red:'#e74c3c' }[dd.status] || 'var(--blue2)';
      const border   = isActive ? '#1a73e8' : isDone ? sc : 'var(--blue2)';
      const bg       = isActive ? '#e8f0fe' : 'var(--blue1)';
      const color    = isActive ? '#1a73e8' : 'var(--text)';
      const prefix   = isDone ? '\u2713 ' : '';
      return '<button onclick="window.hcMeeting.lhJumpDept(' + i + ')" type="button"' +
        ' style="padding:6px 14px;border-radius:999px;border:1.5px solid ' + border + ';background:' + bg + ';color:' + color + ';font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;">' +
        prefix + d2 + '</button>';
    }).join('');

    let content = '';
    if (step === 'lead') {
      const btns = emps.length
        ? emps.map(function(n) {
            const sel = d.lead === n;
            return '<button onclick="window.hcMeeting.lhSelectLead(this.dataset.name)" data-name="' + esc(n) + '" type="button"' +
              ' style="padding:10px 18px;border-radius:10px;border:2px solid ' + (sel ? '#1a73e8' : 'var(--blue2)') + ';background:' + (sel ? '#e8f0fe' : 'var(--blue1)') + ';color:' + (sel ? '#1a73e8' : 'var(--text)') + ';font-size:14px;font-weight:700;cursor:pointer;">' +
              esc(n) + '</button>';
          }).join('')
        : '<div style="font-size:13px;color:var(--muted);">No employees found for this department. Add them via the Employee module.</div>';
      content = '<div style="font-size:13px;color:var(--muted);margin-bottom:12px;">Who is leading ' + esc(dept) + ' today?</div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:10px;">' + btns + '</div>';
    }
    else if (step === 'status') {
      const opts = [
        { val:'Green',  label:'on track',   border:'#2ecc71', bg:'#e6f9ee', color:'#1e7e34', icon:'🟢' },
        { val:'Yellow', label:'watch it',   border:'#f1c40f', bg:'#fef9e7', color:'#7d5a00', icon:'🟡' },
        { val:'Red',    label:'needs help', border:'#e74c3c', bg:'#fce8e6', color:'#a01a1a', icon:'🔴' },
      ];
      content = '<div style="font-size:13px;color:var(--muted);margin-bottom:12px;">Overall status for ' + esc(dept) + '</div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:10px;">' +
        opts.map(function(o) {
          const sel = d.status === o.val;
          return '<button onclick="window.hcMeeting.lhSelectStatus(this.dataset.val)" data-val="' + o.val + '" type="button"' +
            ' style="padding:12px 22px;border-radius:10px;border:2px solid ' + (sel ? o.border : 'var(--blue2)') + ';background:' + (sel ? o.bg : 'var(--blue1)') + ';color:' + (sel ? o.color : 'var(--text)') + ';font-size:14px;font-weight:700;cursor:pointer;">' +
            o.icon + ' ' + o.val + ' \u2014 ' + o.label + '</button>';
        }).join('') + '</div>';
    }
    else if (step === 'volume') {
      content = '<div style="font-size:13px;color:var(--muted);margin-bottom:12px;">Volume today for ' + esc(dept) + '</div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:10px;">' +
        ['Low','Medium','High'].map(function(v) {
          const sel = d.volume === v;
          return '<button onclick="window.hcMeeting.lhSelectVolume(this.dataset.vol)" data-vol="' + v + '" type="button"' +
            ' style="padding:12px 28px;border-radius:10px;border:2px solid ' + (sel ? '#1a73e8' : 'var(--blue2)') + ';background:' + (sel ? '#e8f0fe' : 'var(--blue1)') + ';color:' + (sel ? '#1a73e8' : 'var(--text)') + ';font-size:14px;font-weight:700;cursor:pointer;">' +
            v + '</button>';
        }).join('') + '</div>';
    }
    else if (step === 'absences') {
      content = '<div style="font-size:13px;color:var(--muted);margin-bottom:12px;">Absences pulled from today\'s attendance \u2014 ' + esc(dept) + '</div>' +
        (abs.length
          ? abs.map(function(n) { return '<div style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:8px;background:#fce8e6;border:1px solid #e74c3c;color:#a01a1a;font-size:13px;font-weight:700;margin:0 6px 6px 0;">Absent: ' + esc(n) + '</div>'; }).join('')
          : '<div style="padding:14px;border-radius:10px;background:var(--blue1);border:1px solid var(--blue2);font-size:13px;color:var(--muted);">No absences recorded today for this department \u2713</div>');
    }
    else if (step === 'pto') {
      const ptoBtns = emps.length
        ? emps.map(function(n) {
            return '<button onclick="window.hcMeeting.lhAddPTO(this.dataset.name)" data-name="' + esc(n) + '" type="button"' +
              ' style="padding:8px 14px;border-radius:8px;border:1px solid var(--blue2);background:var(--blue1);color:var(--text);font-size:13px;font-weight:600;cursor:pointer;">' +
              esc(n) + '</button>';
          }).join('')
        : '<div style="font-size:13px;color:var(--muted);">No employees in roster</div>';
      content = '<div style="font-size:13px;color:var(--muted);margin-bottom:12px;">Scheduled time off this week \u2014 ' + esc(dept) + '</div>' +
        '<div style="margin-bottom:10px;">' +
        '<label style="font-size:12px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px;">Pick a date first, then tap a name</label>' +
        '<input type="date" id="lhPtoDate" style="padding:8px 12px;border-radius:8px;border:1px solid var(--blue2);background:var(--blue1);font-size:13px;margin-bottom:10px;">' +
        '<div style="display:flex;flex-wrap:wrap;gap:8px;">' + ptoBtns + '</div></div>' +
        '<div id="lhPtoList" style="margin-top:10px;"></div>';
    }
    else if (step === 'notes') {
      content = '<div style="font-size:13px;color:var(--muted);margin-bottom:8px;">Things of note for ' + esc(dept) + ' \u2014 priorities, blockers, safety, anything else</div>' +
        '<textarea id="lhNotesInput" placeholder="Type anything \u2014 rough bullets are fine. AI will clean it up in the summary."' +
        ' style="width:100%;padding:12px;border-radius:10px;border:1px solid var(--blue2);background:var(--blue1);font-size:14px;min-height:120px;resize:vertical;color:var(--text);">' +
        esc(d.notes || '') + '</textarea>';
    }

    const isFirst = lhState.deptIdx === 0 && lhState.innerStep === 0;
    const isLast  = lhState.deptIdx === LH_DEPTS.length - 1 && lhState.innerStep === LH_STEPS.length - 1;

    form.innerHTML =
      '<div style="margin-bottom:16px;display:flex;flex-wrap:wrap;gap:6px;">' + pills + '</div>' +
      '<div style="height:3px;background:var(--blue2);border-radius:2px;margin-bottom:20px;">' +
        '<div style="height:3px;width:' + pct + '%;background:#1a73e8;border-radius:2px;transition:width .3s;"></div>' +
      '</div>' +
      '<div style="margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;">' +
        '<span style="font-size:12px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;">' + esc(dept) + ' \u2014 ' + stepLabels[step] + '</span>' +
        '<span style="font-size:12px;color:var(--muted);">Step ' + (lhState.innerStep + 1) + ' of ' + LH_STEPS.length + '</span>' +
      '</div>' +
      '<div style="min-height:160px;">' + content + '</div>' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:20px;padding-top:16px;border-top:1px solid var(--blue2);">' +
        '<button class="btn secondary" onclick="window.hcMeeting.lhNav(-1)" type="button"' + (isFirst ? ' disabled' : '') + '>\u25c4 Back</button>' +
        '<button class="btn" onclick="window.hcMeeting.lhNav(1)" type="button"' + (isLast ? ' style="background:#0f9d58;border-color:#0f9d58;"' : '') + '>' + (isLast ? '\u2728 Generate Summary' : 'Next \u25ba') + '</button>' +
      '</div>' +
      '<div id="lhStatus" style="min-height:18px;font-size:13px;margin-top:8px;text-align:center;"></div>';

    if (step === 'pto') lhRenderPTO(dept);
  }

  function copyLeadSummary() { copyText(window._lhSummary || '', 'lhCopyBtn'); }

  function lhGoBack() {
    lhState.deptIdx = LH_DEPTS.length - 1;
    lhState.innerStep = LH_STEPS.length - 1;
    lhRender();
  }

  // ═══════════════════════════════════════════════════════════
  // PM INBOUND HUDDLE
  // ═══════════════════════════════════════════════════════════


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
    saveAM, savePM,
    generateAMScript, generatePMRecap,
    copyAMScript, copyLeadSummary, copyPMRecap,
    // Leadership wizard
    lhNav, lhJumpDept,
    lhSelectLead, lhSelectStatus, lhSelectVolume,
    lhAddPTO, lhRemovePTO,
    lhRenderDone, lhGoBack,
    // AM date nav
    amPrevDay:   () => { activeDate = shiftDate(-1); renderAMForm(); },
    amNextDay:   () => { activeDate = shiftDate(1);  renderAMForm(); },
    amSetDate:   (d) => { activeDate = d || isoToday(); renderAMForm(); },
    // PM date nav
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
