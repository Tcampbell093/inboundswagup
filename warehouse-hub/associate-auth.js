(() => {
  const API = '/.netlify/functions/hub-auth';
  const root = document.documentElement;
  let session = { signedIn: false };
  let roster = [];
  let selected = null;

  const style = document.createElement('style');
  style.textContent = `
    .associate-btn{cursor:pointer;max-width:230px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .associate-btn.signed-in{color:var(--ink);border-color:#c6d8cf;background:var(--green-soft)}
    .associate-modal{border:0;border-radius:22px;padding:0;max-width:min(500px,calc(100% - 28px));width:100%;background:var(--bg);color:var(--ink);box-shadow:0 30px 90px rgba(18,61,52,.28)}
    .associate-modal::backdrop{background:rgba(16,32,28,.45);backdrop-filter:blur(3px)}
    .associate-body{padding:22px}
    .associate-intro{margin:0 0 16px;color:var(--muted);font-size:14px;line-height:1.55}
    .associate-state{border:1px solid var(--line);border-radius:16px;background:var(--paper);padding:14px;margin:12px 0 16px;display:none}
    .associate-state.show{display:block}
    .associate-state strong{display:block;margin-bottom:4px}
    .associate-state span{font-size:13px;color:var(--muted);line-height:1.45}
    .associate-form{display:grid;gap:12px}
    .associate-form label{display:grid;gap:6px;font-size:12px;font-weight:850;color:#5f6b65}
    .associate-form select,.associate-form input{width:100%;border:1px solid #cfd6d0;border-radius:11px;background:#fff;padding:12px;color:var(--ink);font-size:16px}
    .associate-actions{display:flex;gap:9px;flex-wrap:wrap;margin-top:4px}
    .associate-actions .action{flex:1;min-width:150px}
    .associate-link{border:0;background:transparent;color:var(--muted);font-weight:800;cursor:pointer;padding:10px}
    .associate-note{font-size:12px;color:var(--muted);line-height:1.5;margin-top:12px}
    .associate-error{display:none;border-radius:11px;padding:10px 12px;background:#f8e9e6;color:#8f2d22;font-size:13px;font-weight:750}
    .associate-error.show{display:block}
    .associate-success{display:none;border-radius:11px;padding:10px 12px;background:var(--green-soft);color:var(--green);font-size:13px;font-weight:800}
    .associate-success.show{display:block}
    @media(max-width:620px){.associate-btn{max-width:145px}.associate-actions{display:grid}.associate-actions .action{width:100%}}
  `;
  document.head.appendChild(style);

  const topActions = document.querySelector('.top-actions');
  if (!topActions) return;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'toolcount associate-btn';
  btn.id = 'associateBtn';
  btn.textContent = 'Who’s using Hub?';
  topActions.insertBefore(btn, document.getElementById('manageBtn') || null);

  const dialog = document.createElement('dialog');
  dialog.className = 'associate-modal';
  dialog.id = 'associateDialog';
  dialog.innerHTML = `
    <div class="dialog-head"><h3 id="associateTitle">Who’s using the Hub?</h3><button class="close" id="associateClose" type="button">×</button></div>
    <div class="associate-body">
      <p class="associate-intro" id="associateIntro">Choose your name once for the shift. After that, cleaning check-in and other personal Hub features can recognize you without asking for your PIN again.</p>
      <div class="associate-success" id="associateSuccess"></div>
      <div class="associate-error" id="associateError"></div>
      <div class="associate-state" id="associateCurrent"></div>
      <form class="associate-form" id="associateForm">
        <label>Your name
          <select id="associateName"><option value="">Choose your name…</option></select>
        </label>
        <div id="associatePinWrap" style="display:none">
          <label id="associatePinLabel">PIN
            <input id="associatePin" type="password" inputmode="numeric" maxlength="8" autocomplete="off" placeholder="4–8 digits" />
          </label>
        </div>
        <div id="associateConfirmWrap" style="display:none">
          <label>Confirm PIN
            <input id="associateConfirm" type="password" inputmode="numeric" maxlength="8" autocomplete="off" placeholder="Enter it again" />
          </label>
        </div>
        <div class="associate-actions" id="associateActions">
          <button class="action" id="associateSubmit" type="submit">Continue</button>
          <button class="associate-link" id="associateNotNow" type="button">Not now</button>
        </div>
      </form>
      <div class="associate-note" id="associateNote">If you already use a FairShift cleaning PIN, use that same PIN here. New associates can create a PIN when one has not been set yet.</div>
    </div>`;
  document.body.appendChild(dialog);

  const nameEl = document.getElementById('associateName');
  const pinEl = document.getElementById('associatePin');
  const confirmEl = document.getElementById('associateConfirm');
  const pinWrap = document.getElementById('associatePinWrap');
  const confirmWrap = document.getElementById('associateConfirmWrap');
  const submit = document.getElementById('associateSubmit');
  const current = document.getElementById('associateCurrent');
  const form = document.getElementById('associateForm');
  const error = document.getElementById('associateError');
  const success = document.getElementById('associateSuccess');
  const note = document.getElementById('associateNote');

  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  const normalize = (v) => String(v || '').trim().toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-');

  function setError(message = '') {
    error.textContent = message;
    error.classList.toggle('show', !!message);
  }
  function setSuccess(message = '') {
    success.textContent = message;
    success.classList.toggle('show', !!message);
  }

  function updateButton() {
    if (session.signedIn) {
      btn.textContent = `${session.name}${session.department ? ' · ' + session.department : ''}`;
      btn.classList.add('signed-in');
      btn.title = 'Associate signed in for this shift';
    } else {
      btn.textContent = 'Who’s using Hub?';
      btn.classList.remove('signed-in');
      btn.title = 'Sign in once for this shift';
    }
  }

  function resetForm() {
    setError('');
    setSuccess('');
    selected = null;
    nameEl.value = '';
    pinEl.value = '';
    confirmEl.value = '';
    pinWrap.style.display = 'none';
    confirmWrap.style.display = 'none';
    submit.textContent = 'Continue';
    submit.disabled = false;
    note.textContent = 'If you already use a FairShift cleaning PIN, use that same PIN here. New associates can create a PIN when one has not been set yet.';
  }

  function showSignedInState() {
    current.classList.add('show');
    current.innerHTML = `<strong>Signed in as ${esc(session.name)}</strong><span>${esc(session.department || 'Warehouse team')} · Your Hub session stays active for this shift.</span>`;
    form.style.display = 'none';
    const existing = current.querySelector('[data-signout]');
    if (!existing) {
      const out = document.createElement('button');
      out.type = 'button';
      out.className = 'action secondary';
      out.dataset.signout = '1';
      out.style.marginTop = '12px';
      out.textContent = 'Change associate / Sign out';
      out.addEventListener('click', logout);
      current.appendChild(out);
    }
  }

  function showSignInState(prefillName = '') {
    current.classList.remove('show');
    current.innerHTML = '';
    form.style.display = 'grid';
    resetForm();
    if (prefillName) {
      const match = roster.find((person) => normalize(person.name) === normalize(prefillName));
      if (match) {
        nameEl.value = match.name;
        nameEl.dispatchEvent(new Event('change'));
      }
    }
  }

  function openDialog(prefillName = '') {
    if (session.signedIn && !prefillName) showSignedInState();
    else showSignInState(prefillName);
    if (!dialog.open) dialog.showModal();
  }

  async function api(path = '', options = {}) {
    const response = await fetch(`${API}${path}`, { cache: 'no-store', ...options });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Hub sign-in is unavailable.');
    return body;
  }

  async function loadRoster() {
    const data = await api('?action=roster');
    roster = Array.isArray(data.employees) ? data.employees : [];
    nameEl.innerHTML = `<option value="">Choose your name…</option>${roster.map((person) => `<option value="${esc(person.name)}">${esc(person.name)}${person.department ? ' · ' + esc(person.department) : ''}</option>`).join('')}`;
    if (data.selfServiceConnected === false) {
      note.textContent = 'If you already have a FairShift cleaning PIN, use the same one here. First-time PIN setup is available in the Hub; FairShift syncing will follow the same PIN when its self-service update is active.';
    }
  }

  async function loadSession() {
    try {
      session = await api('?action=session');
    } catch {
      session = { signedIn: false };
    }
    updateButton();
  }

  nameEl.addEventListener('change', () => {
    setError('');
    setSuccess('');
    selected = roster.find((person) => person.name === nameEl.value) || null;
    if (!selected) {
      pinWrap.style.display = 'none';
      confirmWrap.style.display = 'none';
      submit.textContent = 'Continue';
      return;
    }
    pinWrap.style.display = 'block';
    const configured = selected.hubPinConfigured || selected.pinConfigured === true;
    if (configured) {
      document.getElementById('associatePinLabel').firstChild.nodeValue = 'PIN';
      confirmWrap.style.display = 'none';
      submit.textContent = 'Sign in for this shift';
      note.textContent = 'Enter your existing PIN once. You should not need to enter it again for cleaning during this Hub session.';
    } else {
      document.getElementById('associatePinLabel').firstChild.nodeValue = 'Create a PIN';
      confirmWrap.style.display = 'block';
      submit.textContent = 'Create PIN & sign in';
      note.textContent = 'Choose a private 4–8 digit PIN you can remember. If you already have a FairShift cleaning PIN, use that same number here.';
    }
    setTimeout(() => pinEl.focus(), 30);
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setError('');
    setSuccess('');
    if (!selected) return setError('Choose your name first.');
    const pin = pinEl.value.trim();
    if (!/^\d{4,8}$/.test(pin)) return setError('Enter a 4–8 digit PIN.');
    const configured = selected.hubPinConfigured || selected.pinConfigured === true;
    const action = configured ? 'login' : 'setup';
    if (action === 'setup' && pin !== confirmEl.value.trim()) return setError('The two PINs do not match.');
    submit.disabled = true;
    submit.textContent = action === 'setup' ? 'Saving PIN…' : 'Signing in…';
    try {
      const data = await api('', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, employeeName: selected.name, pin, confirmPin: confirmEl.value.trim() }),
      });
      session = data;
      updateButton();
      sessionStorage.removeItem('hubAssociatePromptDismissed');
      setSuccess(action === 'setup' ? 'PIN saved. You’re signed in for this shift.' : 'You’re signed in for this shift.');
      setTimeout(() => dialog.close(), 650);
      document.dispatchEvent(new CustomEvent('hub-associate-session', { detail: session }));
    } catch (err) {
      setError(err.message || 'Could not sign in.');
      submit.disabled = false;
      submit.textContent = action === 'setup' ? 'Create PIN & sign in' : 'Sign in for this shift';
    }
  });

  async function logout() {
    try {
      await api('', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'logout' }) });
    } catch {}
    session = { signedIn: false };
    updateButton();
    showSignInState();
    document.dispatchEvent(new CustomEvent('hub-associate-session', { detail: session }));
  }

  btn.addEventListener('click', () => openDialog());
  document.getElementById('associateClose').addEventListener('click', () => dialog.close());
  document.getElementById('associateNotNow').addEventListener('click', () => {
    sessionStorage.setItem('hubAssociatePromptDismissed', '1');
    dialog.close();
  });

  window.HubAssociate = {
    getSession: () => ({ ...session }),
    open: (name = '') => openDialog(name),
    refresh: async () => { await loadSession(); return { ...session }; },
  };

  Promise.allSettled([loadRoster(), loadSession()]).then(() => {
    if (!session.signedIn && !sessionStorage.getItem('hubAssociatePromptDismissed') && roster.length) {
      setTimeout(() => openDialog(), 450);
    }
  });
})();
