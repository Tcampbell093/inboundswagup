(() => {
  const API = '/.netlify/functions/warehouse-inventory';
  const topActions = document.querySelector('.top-actions');
  if (!topActions) return;

  let state = { signedIn: false, subscribed: false, unseenCount: 0, alerts: [] };

  const style = document.createElement('style');
  style.textContent = `
    .request-alert-btn{position:relative;cursor:pointer}
    .request-alert-btn .request-alert-badge{position:absolute;top:-7px;right:-5px;min-width:19px;height:19px;border-radius:999px;background:#c92f26;color:#fff;border:2px solid var(--bg);display:grid;place-items:center;padding:0 5px;font-size:10px;font-weight:950;line-height:1}
    .request-alert-btn .request-alert-badge[hidden]{display:none}
    .request-alert-dialog{border:0;border-radius:22px;padding:0;max-width:min(590px,calc(100% - 28px));width:100%;background:var(--bg);color:var(--ink);box-shadow:0 30px 90px rgba(18,61,52,.28)}
    .request-alert-dialog::backdrop{background:rgba(16,32,28,.45);backdrop-filter:blur(3px)}
    .request-alert-body{padding:18px 20px 22px}
    .request-alert-intro{margin:0 0 14px;color:var(--muted);font-size:13px;line-height:1.5}
    .request-alert-list{display:grid;gap:9px;max-height:52vh;overflow:auto}
    .request-alert-row{border:1px solid var(--line);background:var(--paper);border-radius:14px;padding:12px 13px}
    .request-alert-top{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
    .request-alert-item{font-weight:900;font-size:14px}
    .request-alert-urgency{font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.06em;padding:5px 7px;border-radius:999px;background:var(--orange-soft);color:#ad4a22;white-space:nowrap}
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
    <div class="dialog-head"><h3>Inventory request alerts</h3><button class="close" id="requestAlertClose" type="button">×</button></div>
    <div class="request-alert-body">
      <p class="request-alert-intro" id="requestAlertIntro">See new Warehouse Inventory requests since the last time you checked.</p>
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

  function updateButton() {
    const s = session();
    state.signedIn = !!s.signedIn;
    button.hidden = !state.signedIn;
    const count = Number(state.unseenCount || 0);
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.hidden = !state.signedIn || !state.subscribed || count < 1;
    button.title = state.subscribed
      ? (count ? `${count} new inventory request alert${count === 1 ? '' : 's'}` : 'No new inventory request alerts')
      : 'Inventory request alerts are off';
  }

  async function api(query = '', options = {}) {
    const response = await fetch(`${API}${query}`, { cache: 'no-store', ...options });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Request alerts are unavailable.');
    return body;
  }

  async function refreshCount() {
    const s = session();
    if (!s.signedIn) {
      state = { signedIn: false, subscribed: false, unseenCount: 0, alerts: [] };
      updateButton();
      return;
    }
    try {
      const data = await api('?alerts=1');
      state.signedIn = true;
      state.subscribed = !!data.subscribed;
      state.unseenCount = Number(data.unseenCount || 0);
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
    state.unseenCount = 0;
    updateButton();
    await openAlerts();
  }

  async function markSeen() {
    try {
      await api('', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'alertMarkSeen' }),
      });
      state.unseenCount = 0;
      updateButton();
    } catch {}
  }

  function renderUnsubscribed() {
    content.innerHTML = '<div class="request-alert-empty"><strong>Request alerts are off.</strong><div style="margin-top:5px">Subscribe and the Hub will show a red badge whenever new Warehouse Inventory requests are submitted.</div></div>';
    actions.innerHTML = '<button class="action" id="requestAlertSubscribe" type="button">Subscribe to request alerts</button><a class="request-alert-link" href="/inventory-control/">Open Inventory</a>';
    document.getElementById('requestAlertSubscribe').onclick = () => setSubscribed(true);
  }

  function renderAlerts(alerts, count) {
    if (!alerts.length) {
      content.innerHTML = '<div class="request-alert-empty">No new inventory requests since you last checked.</div>';
    } else {
      content.innerHTML = '<div class="request-alert-list">' + alerts.map((request) => {
        const qty = request.quantity == null ? '' : ` · Qty ${esc(request.quantity)}`;
        const department = request.department ? ` · ${esc(request.department)}` : '';
        return `<div class="request-alert-row">
          <div class="request-alert-top"><div class="request-alert-item">${esc(request.itemName || 'Inventory request')}</div><div class="request-alert-urgency">${esc(request.urgency || 'Normal')}</div></div>
          <div class="request-alert-meta">Requested by <strong>${esc(request.requestedBy || 'Unknown')}</strong>${qty}${department}</div>
          <div class="request-alert-meta">${esc(fmtTime(request.createdAt))} · ${esc(request.status || 'Requested')}</div>
        </div>`;
      }).join('') + '</div>';
    }
    const label = count ? `${count} new request${count === 1 ? '' : 's'}` : 'You’re caught up';
    document.getElementById('requestAlertIntro').textContent = label + '. New requests will continue to appear here until you check them.';
    actions.innerHTML = '<button class="request-alert-link" id="requestAlertUnsubscribe" type="button">Turn off alerts</button><a class="action" href="/inventory-control/">Open Warehouse Inventory ↗</a>';
    document.getElementById('requestAlertUnsubscribe').onclick = () => setSubscribed(false);
  }

  async function openAlerts() {
    const s = session();
    if (!s.signedIn) {
      window.HubAssociate?.open?.();
      return;
    }

    content.innerHTML = '<div class="request-alert-empty">Loading request alerts…</div>';
    actions.innerHTML = '';
    document.getElementById('requestAlertIntro').textContent = 'See new Warehouse Inventory requests since the last time you checked.';
    if (!dialog.open) dialog.showModal();

    try {
      const data = await api('?alerts=1&list=1');
      state.subscribed = !!data.subscribed;
      state.unseenCount = Number(data.unseenCount || 0);
      state.alerts = Array.isArray(data.alerts) ? data.alerts : [];
      updateButton();

      if (!state.subscribed) {
        renderUnsubscribed();
        return;
      }

      renderAlerts(state.alerts, state.unseenCount);
      if (state.unseenCount > 0) await markSeen();
    } catch (error) {
      content.innerHTML = `<div class="request-alert-empty">${esc(error.message || 'Could not load request alerts.')}</div>`;
    }
  }

  button.addEventListener('click', openAlerts);
  document.getElementById('requestAlertClose').addEventListener('click', () => dialog.close());
  document.addEventListener('hub-associate-session', () => setTimeout(refreshCount, 80));
  window.addEventListener('focus', refreshCount);

  button.hidden = true;
  setTimeout(refreshCount, 650);
})();
