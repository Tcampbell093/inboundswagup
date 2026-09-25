(() => {
  const API = '/.netlify/functions/warehouse-inventory';
  const topActions = document.querySelector('.top-actions');
  if (!topActions) return;

  let state = {
    signedIn: false,
    subscribed: false,
    unseenCount: 0,
    requestUnseenCount: 0,
    requestAlerts: [],
    bingoEligible: false,
    bingoUnseenCount: 0,
    bingoWins: [],
    seenThrough: null,
  };

  const style = document.createElement('style');
  style.textContent = `
    .request-alert-btn{position:relative;cursor:pointer}
    .request-alert-btn .request-alert-badge{position:absolute;top:-7px;right:-5px;min-width:19px;height:19px;border-radius:999px;background:#c92f26;color:#fff;border:2px solid var(--bg);display:grid;place-items:center;padding:0 5px;font-size:10px;font-weight:950;line-height:1}
    .request-alert-btn .request-alert-badge[hidden]{display:none}
    .request-alert-dialog{border:0;border-radius:22px;padding:0;max-width:min(620px,calc(100% - 28px));width:100%;background:var(--bg);color:var(--ink);box-shadow:0 30px 90px rgba(18,61,52,.28)}
    .request-alert-dialog::backdrop{background:rgba(16,32,28,.45);backdrop-filter:blur(3px)}
    .request-alert-body{padding:18px 20px 22px}
    .request-alert-intro{margin:0 0 14px;color:var(--muted);font-size:13px;line-height:1.5}
    .request-alert-section{margin-top:15px}
    .request-alert-section:first-child{margin-top:0}
    .request-alert-section-title{font-size:11px;font-weight:950;letter-spacing:.09em;text-transform:uppercase;color:var(--muted);margin:0 0 8px}
    .request-alert-list{display:grid;gap:9px;max-height:52vh;overflow:auto}
    .request-alert-row{border:1px solid var(--line);background:var(--paper);border-radius:14px;padding:12px 13px}
    .request-alert-row.bingo-win{border-color:#e9d6a2;background:#fffaf0}
    .request-alert-top{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
    .request-alert-item{font-weight:900;font-size:14px}
    .request-alert-urgency{font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.06em;padding:5px 7px;border-radius:999px;background:var(--orange-soft);color:#ad4a22;white-space:nowrap}
    .request-alert-urgency.winner{background:#f7e7b3;color:#79530a}
    .request-alert-meta{margin-top:5px;font-size:12px;color:var(--muted);line-height:1.45}
    .request-alert-empty{border:1px dashed var(--line);border-radius:14px;padding:20px;text-align:center;color:var(--muted);background:rgba(255,255,255,.5)}
    .request-alert-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;margin-top:15px}
    .request-alert-link{display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--line);background:var(--paper);border-radius:11px;padding:10px 12px;font-size:12px;font-weight:850;cursor:pointer}
    @media(max-width:700px){
      .request-alert-btn .request-alert-label{display:none}
      .request-alert-btn{padding:8px 10px}
    }
  `;
  document.head.appendChild(style);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'manage-btn request-alert-btn';
  button.id = 'requestAlertBtn';
  button.innerHTML = '<span aria-hidden="true">🔔</span><span class="request-alert-label">Alerts</span><span class="request-alert-badge" id="requestAlertBadge" hidden>0</span>';
  topActions.insertBefore(button, document.getElementById('manageBtn') || null);

  const dialog = document.createElement('dialog');
  dialog.className = 'request-alert-dialog';
  dialog.id = 'requestAlertDialog';
  dialog.innerHTML = `
    <div class="dialog-head"><h3>Warehouse alerts</h3><button class="close" id="requestAlertClose" type="button">×</button></div>
    <div class="request-alert-body">
      <p class="request-alert-intro" id="requestAlertIntro">New Warehouse Inventory requests and Bingo winners show up here.</p>
      <div id="requestAlertContent"></div>
      <div class="request-alert-actions" id="requestAlertActions"></div>
    </div>
  `;
  document.body.appendChild(dialog);

  const badge = document.getElementById('requestAlertBadge');
  const content = document.getElementById('requestAlertContent');
  const actions = document.getElementById('requestAlertActions');
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));

  function session() {
    return window.HubAssociate?.getSession?.() || { signedIn: false };
  }

  function fmtTime(value) {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  function hydrate(data) {
    state.subscribed = !!data.subscribed;
    state.unseenCount = Number(data.unseenCount || 0);
    state.requestUnseenCount = Number(data.requestUnseenCount || 0);
    state.requestAlerts = Array.isArray(data.requestAlerts) ? data.requestAlerts : (Array.isArray(data.alerts) ? data.alerts : []);
    state.bingoEligible = !!data.bingoEligible;
    state.bingoUnseenCount = Number(data.bingoUnseenCount || 0);
    state.bingoWins = Array.isArray(data.bingoWins) ? data.bingoWins : [];
    state.seenThrough = data.seenThrough || null;
  }

  function updateButton() {
    const s = session();
    state.signedIn = !!s.signedIn;
    button.hidden = !state.signedIn;

    const count = Number(state.unseenCount || 0);
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.hidden = !state.signedIn || count < 1;

    if (count > 0) {
      const parts = [];
      if (state.requestUnseenCount) parts.push(`${state.requestUnseenCount} new request${state.requestUnseenCount === 1 ? '' : 's'}`);
      if (state.bingoUnseenCount) parts.push(`${state.bingoUnseenCount} Bingo winner${state.bingoUnseenCount === 1 ? '' : 's'}`);
      button.title = parts.join(' · ');
    } else if (state.bingoEligible && state.subscribed) {
      button.title = 'No new Warehouse alerts';
    } else if (state.bingoEligible) {
      button.title = 'Bingo winner alerts are on · Inventory request alerts are off';
    } else {
      button.title = state.subscribed ? 'No new inventory request alerts' : 'Inventory request alerts are off';
    }
  }

  async function api(query = '', options = {}) {
    const response = await fetch(`${API}${query}`, { cache: 'no-store', ...options });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Warehouse alerts are unavailable.');
    return body;
  }

  async function refreshCount() {
    const s = session();
    if (!s.signedIn) {
      state = {
        signedIn: false,
        subscribed: false,
        unseenCount: 0,
        requestUnseenCount: 0,
        requestAlerts: [],
        bingoEligible: false,
        bingoUnseenCount: 0,
        bingoWins: [],
        seenThrough: null,
      };
      updateButton();
      return;
    }

    try {
      const data = await api('?alerts=1');
      state.signedIn = true;
      hydrate(data);
      updateButton();
    } catch {
      state.unseenCount = 0;
      updateButton();
    }
  }

  async function setSubscribed(enabled) {
    const data = await api('', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'alertSubscribe', enabled }),
    });
    state.subscribed = !!data.subscribed;
    state.requestUnseenCount = 0;
    state.unseenCount = state.bingoUnseenCount;
    updateButton();
    await openAlerts();
  }

  async function markSeen() {
    try {
      await api('', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'alertMarkSeen', seenThrough: state.seenThrough }),
      });
      state.unseenCount = 0;
      state.requestUnseenCount = 0;
      state.bingoUnseenCount = 0;
      updateButton();
    } catch {}
  }

  function requestRows(alerts) {
    if (!alerts.length) return '<div class="request-alert-empty">No new inventory requests since you last checked.</div>';
    return '<div class="request-alert-list">' + alerts.map((request) => {
      const qty = request.quantity == null ? '' : ` · Qty ${esc(request.quantity)}`;
      const department = request.department ? ` · ${esc(request.department)}` : '';
      return `<div class="request-alert-row">
        <div class="request-alert-top"><div class="request-alert-item">${esc(request.itemName || 'Inventory request')}</div><div class="request-alert-urgency">${esc(request.urgency || 'Normal')}</div></div>
        <div class="request-alert-meta">Requested by <strong>${esc(request.requestedBy || 'Unknown')}</strong>${qty}${department}</div>
        <div class="request-alert-meta">${esc(fmtTime(request.createdAt))} · ${esc(request.status || 'Requested')}</div>
      </div>`;
    }).join('') + '</div>';
  }

  function bingoRows(wins) {
    if (!wins.length) return '<div class="request-alert-empty">No new Bingo winners since you last checked.</div>';
    return '<div class="request-alert-list">' + wins.map((winner) => `
      <div class="request-alert-row bingo-win">
        <div class="request-alert-top">
          <div class="request-alert-item">🏆 ${esc(winner.employeeName || 'Someone')} won Warehouse Bingo</div>
          <div class="request-alert-urgency winner">Winner</div>
        </div>
        <div class="request-alert-meta">${esc(fmtTime(winner.wonAt))}</div>
      </div>
    `).join('') + '</div>';
  }

  function renderAlerts() {
    const sections = [];

    if (state.bingoEligible) {
      sections.push(
        '<section class="request-alert-section"><div class="request-alert-section-title">Bingo winners</div>' +
        bingoRows(state.bingoWins) +
        '</section>'
      );
    }

    if (state.subscribed) {
      sections.push(
        '<section class="request-alert-section"><div class="request-alert-section-title">Inventory requests</div>' +
        requestRows(state.requestAlerts) +
        '</section>'
      );
    } else {
      sections.push(
        '<section class="request-alert-section"><div class="request-alert-section-title">Inventory requests</div>' +
        '<div class="request-alert-empty"><strong>Request alerts are off.</strong><div style="margin-top:5px">Subscribe and the Hub will show a red badge whenever new Warehouse Inventory requests are submitted.</div></div>' +
        '</section>'
      );
    }

    content.innerHTML = sections.join('');

    const total = Number(state.unseenCount || 0);
    if (total) {
      const parts = [];
      if (state.requestUnseenCount) parts.push(`${state.requestUnseenCount} new inventory request${state.requestUnseenCount === 1 ? '' : 's'}`);
      if (state.bingoUnseenCount) parts.push(`${state.bingoUnseenCount} new Bingo winner${state.bingoUnseenCount === 1 ? '' : 's'}`);
      document.getElementById('requestAlertIntro').textContent = parts.join(' · ') + '.';
    } else {
      document.getElementById('requestAlertIntro').textContent = 'You’re caught up.';
    }

    actions.innerHTML =
      (state.subscribed
        ? '<button class="request-alert-link" id="requestAlertToggle" type="button">Turn off request alerts</button>'
        : '<button class="request-alert-link" id="requestAlertToggle" type="button">Subscribe to request alerts</button>') +
      '<a class="action" href="/inventory-control/">Open Warehouse Inventory ↗</a>';

    document.getElementById('requestAlertToggle').onclick = () => setSubscribed(!state.subscribed);
  }

  async function openAlerts() {
    const s = session();
    if (!s.signedIn) {
      window.HubAssociate?.open?.();
      return;
    }

    content.innerHTML = '<div class="request-alert-empty">Loading Warehouse alerts…</div>';
    actions.innerHTML = '';
    document.getElementById('requestAlertIntro').textContent = 'New Warehouse Inventory requests and Bingo winners show up here.';
    if (!dialog.open) dialog.showModal();

    try {
      const data = await api('?alerts=1&list=1');
      hydrate(data);
      updateButton();
      renderAlerts();
      if (state.unseenCount > 0) await markSeen();
    } catch (error) {
      content.innerHTML = `<div class="request-alert-empty">${esc(error.message || 'Could not load Warehouse alerts.')}</div>`;
    }
  }

  button.addEventListener('click', openAlerts);
  document.getElementById('requestAlertClose').addEventListener('click', () => dialog.close());
  document.addEventListener('hub-associate-session', () => setTimeout(refreshCount, 80));
  window.addEventListener('focus', refreshCount);

  button.hidden = true;
  setTimeout(refreshCount, 650);
  setInterval(refreshCount, 60000);
})();
