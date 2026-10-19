(() => {
  'use strict';

  const API = '/.netlify/functions/hub-analytics';
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[ch]));

  const FEATURE_LABELS = {
    cleaning: 'Cleaning',
    week_view: 'Week view',
    bingo: 'Bingo',
    memory_challenge: 'Memory Challenge',
    hub_settings: 'Hub Settings',
    prize_questions: 'Prize Questions',
    hub_alerts: 'Hub Alerts',
    notifications: 'Notifications',
    qa_challenge: 'QA Challenge',
    donation_training: 'Donation Trainer'
  };

  let analyticsDays = 30;
  let analyticsLoading = false;

  function session() {
    return window.HubAssociate?.getSession?.() || {};
  }

  function isAdmin() {
    const s = session();
    return !!s.signedIn && String(s.role || '').toLowerCase() === 'manager';
  }

  function userVisitId() {
    const s = session();
    if (!s.signedIn || !s.name) return '';
    const key = String(s.name).trim().toLowerCase();
    const storedUser = sessionStorage.getItem('hubAnalyticsVisitUser') || '';
    let id = sessionStorage.getItem('hubAnalyticsVisitId') || '';
    if (!id || storedUser !== key) {
      id = (globalThis.crypto?.randomUUID?.() || ('visit-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)));
      sessionStorage.setItem('hubAnalyticsVisitId', id);
      sessionStorage.setItem('hubAnalyticsVisitUser', key);
    }
    return id;
  }

  function sendEvent(eventType, eventKey = '', eventLabel = '') {
    const s = session();
    if (!s.signedIn) return;
    const body = JSON.stringify({
      action: 'recordEvent',
      eventType,
      eventKey,
      eventLabel,
      sessionId: userVisitId()
    });
    try {
      if (navigator.sendBeacon) {
        const sent = navigator.sendBeacon(API, new Blob([body], { type: 'application/json' }));
        if (sent) return;
      }
    } catch {}
    fetch(API, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type':'application/json' },
      body,
      keepalive: true
    }).catch(() => {});
  }

  function recordVisit() {
    const s = session();
    if (!s.signedIn) return;
    sendEvent('hub_visit', 'warehouse_hub', 'Warehouse Hub');
  }

  function slug(value) {
    return String(value || '').trim().toLowerCase().normalize('NFKD')
      .replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,120);
  }

  function trackClick(event) {
    const target = event.target.closest('a,button');
    if (!target) return;

    const card = target.closest('a.tool-card');
    if (card) {
      const title = card.querySelector('h3')?.textContent?.trim() || 'Hub tool';
      const toolId = card.dataset.toolId;
      if (toolId) {
        sendEvent('tool_open', toolId, title);
      } else {
        const href = card.getAttribute('href') || '';
        const key = title.toLowerCase().includes('qa challenge') ? 'qa_challenge'
          : title.toLowerCase().includes('donation') ? 'donation_training'
          : slug(title || href);
        sendEvent('feature_open', key, title);
      }
      return;
    }

    if (target.id === 'hubRotationsBtn') return sendEvent('feature_open','cleaning','Cleaning');
    if (target.id === 'manageBtn') return sendEvent('feature_open','hub_settings','Hub Settings');
    if (target.id === 'bingoRewardBtn') return sendEvent('feature_open','bingo','Bingo');
    if (target.classList.contains('question-reward-btn')) return sendEvent('feature_open','prize_questions','Prize Questions');
    if (target.id === 'requestAlertBtn') return sendEvent('feature_open','hub_alerts','Hub Alerts');
    if (target.id === 'hubPushButton') return sendEvent('feature_open','notifications','Notifications');
  }

  function dateLabel(value, includeTime = false) {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return new Intl.DateTimeFormat('en-US', includeTime
      ? { month:'short', day:'numeric', hour:'numeric', minute:'2-digit', timeZone:'America/New_York' }
      : { month:'short', day:'numeric', timeZone:'America/New_York' }
    ).format(d);
  }

  function hourLabel(hour) {
    const h = Number(hour);
    if (h === 0) return '12 AM';
    if (h < 12) return h + ' AM';
    if (h === 12) return '12 PM';
    return (h - 12) + ' PM';
  }

  function injectStyles() {
    if ($('hubAnalyticsStyles')) return;
    const style = document.createElement('style');
    style.id = 'hubAnalyticsStyles';
    style.textContent = `
      .hub-analytics-section{grid-column:1/-1}
      .analytics-head{display:flex;gap:14px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap}
      .analytics-head h4{margin:0 0 5px}
      .analytics-controls{display:flex;gap:7px;align-items:center;flex-wrap:wrap}
      .analytics-period{display:inline-flex;border:1px solid var(--line);border-radius:999px;background:#fff;padding:3px}
      .analytics-period button{border:0;background:transparent;border-radius:999px;padding:7px 10px;font-size:11px;font-weight:850;color:var(--muted);cursor:pointer}
      .analytics-period button.active{background:var(--green);color:#fff}
      .analytics-refresh{border:1px solid var(--line);background:#fff;border-radius:999px;padding:8px 11px;font-size:11px;font-weight:850;cursor:pointer;color:var(--ink)}
      .analytics-status{font-size:11px;color:var(--muted);margin-top:8px;line-height:1.45}
      .analytics-stats{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:9px;margin:16px 0}
      .analytics-stat{border:1px solid var(--line);border-radius:13px;background:#fff;padding:12px}
      .analytics-stat strong{display:block;font-size:22px;line-height:1;color:var(--green);margin-bottom:6px}
      .analytics-stat span{font-size:10px;text-transform:uppercase;letter-spacing:.07em;font-weight:900;color:var(--muted)}
      .analytics-grid{display:grid;grid-template-columns:1.15fr .85fr;gap:12px;margin-top:12px}
      .analytics-card{border:1px solid var(--line);border-radius:15px;background:#fff;padding:14px;min-width:0}
      .analytics-card h5{margin:0 0 4px;font-size:13px}
      .analytics-card-note{margin:0 0 12px;color:var(--muted);font-size:10px;line-height:1.45}
      .analytics-chart{width:100%;height:170px;display:block;overflow:visible}
      .analytics-axis-label{font-size:8px;fill:#6d7974}
      .analytics-line{fill:none;stroke:currentColor;stroke-width:2.2;vector-effect:non-scaling-stroke;color:var(--green)}
      .analytics-area{fill:rgba(18,61,52,.08)}
      .analytics-point{fill:var(--green)}
      .analytics-table-wrap{overflow:auto;max-height:320px;border:1px solid var(--line);border-radius:11px}
      .analytics-table{width:100%;border-collapse:collapse;font-size:11px}
      .analytics-table th,.analytics-table td{padding:9px 10px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}
      .analytics-table th{position:sticky;top:0;background:#f7f9f8;color:var(--muted);font-size:9px;text-transform:uppercase;letter-spacing:.05em;z-index:1}
      .analytics-table tbody tr:last-child td{border-bottom:0}
      .analytics-rank{color:var(--muted);font-weight:900;width:26px}
      .analytics-empty{padding:18px;text-align:center;color:var(--muted);font-size:11px}
      .analytics-bars{display:grid;gap:8px}
      .analytics-bar-row{display:grid;grid-template-columns:82px 1fr 42px;gap:9px;align-items:center;font-size:10px}
      .analytics-bar-track{height:9px;border-radius:999px;background:#edf1ef;overflow:hidden}
      .analytics-bar-fill{height:100%;border-radius:999px;background:var(--green)}
      .analytics-feature-list{display:grid;gap:7px}
      .analytics-feature{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid var(--line);font-size:11px}
      .analytics-feature:last-child{border-bottom:0}
      .analytics-feature small{display:block;color:var(--muted);margin-top:2px}
      .analytics-feature b{font-size:13px;color:var(--green)}
      .analytics-note{margin-top:12px;border:1px solid #d9e4de;background:#f7faf8;border-radius:11px;padding:10px 12px;color:var(--muted);font-size:10px;line-height:1.5}
      @media(max-width:980px){.analytics-stats{grid-template-columns:repeat(3,1fr)}.analytics-grid{grid-template-columns:1fr}}
      @media(max-width:620px){.analytics-stats{grid-template-columns:repeat(2,1fr)}.analytics-stat strong{font-size:19px}.analytics-bar-row{grid-template-columns:68px 1fr 36px}}
    `;
    document.head.appendChild(style);
  }

  function injectAnalyticsSection() {
    if ($('usageAnalyticsSection')) return;
    const grid = document.querySelector('#managerDialog .manager-grid');
    if (!grid) return;
    injectStyles();

    const section = document.createElement('section');
    section.className = 'manager-section hub-analytics-section';
    section.id = 'usageAnalyticsSection';
    section.innerHTML = `
      <div class="analytics-head">
        <div>
          <h4>Usage Analytics</h4>
          <p class="policy-meta" style="margin:0">See how often the Hub is being used, which tools people open, and whether team adoption is growing.</p>
        </div>
        <div class="analytics-controls">
          <div class="analytics-period" aria-label="Analytics period">
            <button type="button" data-analytics-days="7">7 days</button>
            <button type="button" data-analytics-days="30" class="active">30 days</button>
            <button type="button" data-analytics-days="90">90 days</button>
          </div>
          <button class="analytics-refresh" id="analyticsRefresh" type="button">Refresh</button>
        </div>
      </div>
      <div id="analyticsStatus" class="analytics-status">Analytics will load when Hub Settings opens.</div>
      <div id="analyticsContent"></div>
    `;
    grid.insertBefore(section, grid.firstChild);

    section.querySelectorAll('[data-analytics-days]').forEach((button) => {
      button.addEventListener('click', () => {
        analyticsDays = Number(button.dataset.analyticsDays) || 30;
        section.querySelectorAll('[data-analytics-days]').forEach((b) => b.classList.toggle('active', b === button));
        loadAnalytics();
      });
    });
    $('analyticsRefresh')?.addEventListener('click', () => loadAnalytics());
  }

  function chartSvg(rows) {
    const data = Array.isArray(rows) ? rows : [];
    if (!data.length) return '<div class="analytics-empty">No daily activity yet.</div>';
    const width = 720, height = 170, left = 28, right = 8, top = 12, bottom = 28;
    const w = width - left - right, h = height - top - bottom;
    const max = Math.max(1, ...data.map((row) => Number(row.visits || 0)));
    const step = data.length > 1 ? w / (data.length - 1) : 0;
    const points = data.map((row, i) => {
      const x = left + i * step;
      const y = top + h - (Number(row.visits || 0) / max) * h;
      return { x, y, row };
    });
    const poly = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const area = points.length
      ? `${left},${top+h} ${poly} ${left+w},${top+h}`
      : '';
    const labelEvery = data.length <= 7 ? 1 : data.length <= 30 ? 5 : 15;
    const labels = points.map((p, i) => {
      if (i !== 0 && i !== points.length - 1 && i % labelEvery !== 0) return '';
      const label = new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',timeZone:'UTC'}).format(new Date(p.row.date + 'T12:00:00Z'));
      return `<text class="analytics-axis-label" x="${p.x}" y="${height-8}" text-anchor="${i===0?'start':i===points.length-1?'end':'middle'}">${esc(label)}</text>`;
    }).join('');
    const circles = points.map((p) => `<circle class="analytics-point" cx="${p.x}" cy="${p.y}" r="2.8"><title>${esc(p.row.date)}: ${Number(p.row.visits||0)} visits · ${Number(p.row.users||0)} users</title></circle>`).join('');
    return `<svg class="analytics-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Hub visits by day">
      <line x1="${left}" y1="${top+h}" x2="${left+w}" y2="${top+h}" stroke="#d8dfdb" stroke-width="1"/>
      <polygon class="analytics-area" points="${area}"></polygon>
      <polyline class="analytics-line" points="${poly}"></polyline>
      ${circles}${labels}
      <text class="analytics-axis-label" x="3" y="${top+4}">${max}</text>
      <text class="analytics-axis-label" x="3" y="${top+h}">0</text>
    </svg>`;
  }

  function renderTools(rows) {
    const tools = Array.isArray(rows) ? rows : [];
    if (!tools.length) return '<div class="analytics-empty">No tool opens recorded in this period yet.</div>';
    return `<div class="analytics-table-wrap"><table class="analytics-table">
      <thead><tr><th></th><th>Tool</th><th>${analyticsDays}d opens</th><th>Users</th><th>All-time</th><th>Last used</th></tr></thead>
      <tbody>${tools.map((row, index) => `<tr>
        <td class="analytics-rank">${index + 1}</td>
        <td><strong>${esc(row.title || row.key)}</strong></td>
        <td>${Number(row.opens || 0)}</td>
        <td>${Number(row.users || 0)}</td>
        <td>${Number(row.lifetimeOpens || 0)}</td>
        <td>${dateLabel(row.lastUsed || row.lifetimeLastUsed, true)}</td>
      </tr>`).join('')}</tbody>
    </table></div>`;
  }

  function renderUsers(rows) {
    const users = Array.isArray(rows) ? rows : [];
    if (!users.length) return '<div class="analytics-empty">No signed-in usage recorded in this period yet.</div>';
    return `<div class="analytics-table-wrap"><table class="analytics-table">
      <thead><tr><th>Team member</th><th>Department</th><th>Visits</th><th>Actions</th><th>Last active</th></tr></thead>
      <tbody>${users.map((row) => `<tr>
        <td><strong>${esc(row.name)}</strong></td>
        <td>${esc(row.department || 'Unassigned')}</td>
        <td>${Number(row.visits || 0)}</td>
        <td>${Number(row.interactions || 0)}</td>
        <td>${dateLabel(row.lastActive, true)}</td>
      </tr>`).join('')}</tbody>
    </table></div>`;
  }

  function renderDepartments(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const max = Math.max(1, ...list.map((row) => Number(row.visits || 0)));
    if (!list.length) return '<div class="analytics-empty">No department usage yet.</div>';
    return `<div class="analytics-bars">${list.map((row) => `
      <div class="analytics-bar-row">
        <span title="${esc(row.department)}">${esc(row.department)}</span>
        <div class="analytics-bar-track"><div class="analytics-bar-fill" style="width:${Math.max(3,(Number(row.visits||0)/max)*100)}%"></div></div>
        <b>${Number(row.visits || 0)}</b>
      </div>`).join('')}</div>`;
  }

  function renderHours(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const max = Math.max(1, ...list.map((row) => Number(row.interactions || 0)));
    if (!list.length) return '<div class="analytics-empty">No activity by hour yet.</div>';
    return `<div class="analytics-bars">${list.map((row) => `
      <div class="analytics-bar-row">
        <span>${hourLabel(row.hour)}</span>
        <div class="analytics-bar-track"><div class="analytics-bar-fill" style="width:${Math.max(3,(Number(row.interactions||0)/max)*100)}%"></div></div>
        <b>${Number(row.interactions || 0)}</b>
      </div>`).join('')}</div>`;
  }

  function renderFeatures(rows) {
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) return '<div class="analytics-empty">No Hub feature activity yet.</div>';
    return `<div class="analytics-feature-list">${list.map((row) => `
      <div class="analytics-feature">
        <div><strong>${esc(FEATURE_LABELS[row.key] || row.label || row.key)}</strong><small>${Number(row.users || 0)} user${Number(row.users||0)===1?'':'s'} · last ${dateLabel(row.lastUsed,true)}</small></div>
        <b>${Number(row.opens || 0)}</b>
      </div>`).join('')}</div>`;
  }

  function renderAnalytics(data) {
    const content = $('analyticsContent');
    const status = $('analyticsStatus');
    if (!content || !status) return;
    const s = data.summary || {};
    const adoption = s.adoptionPct == null ? '—' : `${s.adoptionPct}%`;
    const started = data.trackingStarted ? dateLabel(data.trackingStarted, true) : 'now';

    status.textContent = data.trackingStarted
      ? `Detailed tracking started ${started}. Period shown: last ${data.days} days.`
      : 'Detailed tracking starts now. All-time tool totals may include earlier clicks.';

    content.innerHTML = `
      <div class="analytics-stats">
        <div class="analytics-stat"><strong>${Number(s.visits || 0)}</strong><span>Hub visits</span></div>
        <div class="analytics-stat"><strong>${Number(s.activeUsers || 0)}</strong><span>Active users</span></div>
        <div class="analytics-stat"><strong>${adoption}</strong><span>Team adoption</span></div>
        <div class="analytics-stat"><strong>${Number(s.avgVisitsPerDay || 0)}</strong><span>Visits / day</span></div>
        <div class="analytics-stat"><strong>${Number(s.interactions || 0)}</strong><span>Total actions</span></div>
      </div>

      <div class="analytics-card">
        <h5>Daily Hub usage</h5>
        <p class="analytics-card-note">A visit counts once per signed-in browser tab session. Refreshing the same tab does not create another visit.</p>
        ${chartSvg(data.daily)}
      </div>

      <div class="analytics-grid">
        <div class="analytics-card">
          <h5>Most-used tools</h5>
          <p class="analytics-card-note">Period opens are tracked from the analytics rollout forward. All-time opens use the Hub's older click counter too.</p>
          ${renderTools(data.tools)}
        </div>
        <div class="analytics-card">
          <h5>Hub features</h5>
          <p class="analytics-card-note">Internal areas such as Cleaning, Bingo, Memory Challenge, alerts, and settings.</p>
          ${renderFeatures(data.features)}
        </div>
      </div>

      <div class="analytics-grid">
        <div class="analytics-card">
          <h5>Team activity</h5>
          <p class="analytics-card-note">Usage only — this is not a productivity score.</p>
          ${renderUsers(data.users)}
        </div>
        <div>
          <div class="analytics-card" style="margin-bottom:12px">
            <h5>Visits by department</h5>
            <p class="analytics-card-note">Based on each person's Hub department at the time of use.</p>
            ${renderDepartments(data.departments)}
          </div>
          <div class="analytics-card">
            <h5>Most active times</h5>
            <p class="analytics-card-note">Total recorded Hub actions by hour, Eastern Time.</p>
            ${renderHours(data.hours)}
          </div>
        </div>
      </div>

      <div class="analytics-note">
        <strong>How this works:</strong> analytics are stored in the same Warehouse Hub database. No Google Analytics or third-party tracking is used. A new visit is recorded when a signed-in person opens the Hub in a new browser tab/session; tool and feature opens are counted separately.
      </div>
    `;
  }

  async function loadAnalytics() {
    if (!isAdmin() || analyticsLoading) return;
    injectAnalyticsSection();
    const content = $('analyticsContent');
    const status = $('analyticsStatus');
    if (!content || !status) return;
    analyticsLoading = true;
    status.textContent = 'Loading usage analytics…';
    content.innerHTML = '<div class="analytics-empty">Loading…</div>';
    $('analyticsRefresh')?.setAttribute('disabled','');
    try {
      const response = await fetch(`${API}?days=${analyticsDays}`, {
        cache:'no-store',
        credentials:'same-origin'
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Analytics are unavailable.');
      renderAnalytics(body);
    } catch (error) {
      status.textContent = 'Could not load analytics.';
      content.innerHTML = `<div class="analytics-empty">${esc(error.message || 'Analytics are unavailable.')}</div>`;
    } finally {
      analyticsLoading = false;
      $('analyticsRefresh')?.removeAttribute('disabled');
    }
  }

  injectAnalyticsSection();

  document.addEventListener('click', trackClick, true);
  document.addEventListener('hub-view-changed', (event) => {
    const view = String(event.detail?.view || '');
    if (view === 'week') sendEvent('feature_open','week_view','Week view');
    if (view === 'bingo') sendEvent('feature_open','bingo','Bingo');
    if (view === 'memory') sendEvent('feature_open','memory_challenge','Memory Challenge');
  });
  document.addEventListener('hub-associate-ready', () => {
    recordVisit();
    if (isAdmin() && $('managerDialog')?.open) loadAnalytics();
  });
  document.addEventListener('hub-associate-session', () => {
    recordVisit();
    if (isAdmin() && $('managerDialog')?.open) loadAnalytics();
  });

  $('manageBtn')?.addEventListener('click', () => {
    setTimeout(() => {
      if (isAdmin() && $('managerDialog')?.open) loadAnalytics();
    }, 500);
  });

  // Covers the case where associate-auth completed before this script loaded.
  setTimeout(recordVisit, 700);

  window.HubAnalytics = {
    refresh: loadAnalytics,
    recordFeature: (key, label) => sendEvent('feature_open', key, label || key),
    recordTool: (key, label) => sendEvent('tool_open', key, label || key)
  };
})();