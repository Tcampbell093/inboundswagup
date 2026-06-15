/* =========================================================
   chat-widget.js — Houston Control team chat (front-end)
   ---------------------------------------------------------
   Facebook-style docked 1-on-1 chat. A launcher pill sits bottom-right with
   an unread badge; clicking it opens a contacts list; clicking a contact opens
   a small chat window you can minimize or close. New messages arrive by polling
   the chat function every few seconds (same approach as notifications).

   Self-contained: injects its own CSS, namespaced under .hcc-*, and only runs
   once a user is signed in (window.hcCurrentUser). Never runs inside an iframe
   embed — the top-level portal owns the widget.
   ========================================================= */
(function () {
  'use strict';

  // Don't render a second copy inside an embedded module (e.g. the inbound
  // iframe). The top-level portal shows the chat.
  let embedded = false;
  try { embedded = (window.self !== window.top); } catch (_) { embedded = true; }
  if (embedded) return;
  if (window.__hcChatInstalled) return;
  window.__hcChatInstalled = true;

  const API = '/.netlify/functions/chat';
  const POLL_MS = 4000;

  const state = {
    me: null,
    maxId: '0',
    unread: {},                 // email -> count
    roster: [],                 // [{email,name,role}]
    rosterByEmail: {},          // email -> {name,role}
    windows: new Map(),         // email -> { el, body, input, minimized, ids:Set }
    pollTimer: null,
    contactsOpen: false,
  };

  // ── tiny helpers ───────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function gt(a, b) { // compare two numeric id strings (bigint-safe)
    try { return BigInt(a) > BigInt(b); } catch (_) { return Number(a) > Number(b); }
  }
  function timeLabel(ts) {
    try {
      const d = new Date(ts);
      return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    } catch (_) { return ''; }
  }
  function nameFor(email) {
    const r = state.rosterByEmail[email];
    return (r && r.name) || email;
  }
  function initials(name) {
    const parts = String(name || '?').trim().split(/\s+/);
    return ((parts[0] || '')[0] || '?').toUpperCase() + ((parts[1] || '')[0] || '').toUpperCase();
  }

  async function api(qs, opts) {
    const res = await fetch(API + qs, opts);
    if (!res.ok) throw new Error('chat ' + res.status);
    return res.json();
  }

  // ── styles ─────────────────────────────────────────────────
  function injectCss() {
    if (document.getElementById('hcc-style')) return;
    const css = `
    .hcc-launcher{position:fixed;right:20px;bottom:20px;z-index:9000;display:flex;align-items:center;gap:8px;
      background:#185FA5;color:#fff;border:none;border-radius:24px;padding:10px 16px;font:700 14px Inter,system-ui,sans-serif;
      cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.25);transition:background .15s,transform .1s;}
    .hcc-launcher:hover{background:#1a6cbd;}
    .hcc-launcher:active{transform:translateY(1px);}
    .hcc-launcher .hcc-badge{background:#e8413a;color:#fff;border-radius:10px;min-width:20px;height:20px;
      padding:0 6px;font-size:12px;font-weight:800;display:none;align-items:center;justify-content:center;line-height:1;}
    .hcc-launcher .hcc-badge.on{display:inline-flex;}

    .hcc-contacts{position:fixed;right:20px;bottom:74px;z-index:9001;width:300px;max-height:60vh;
      background:#fff;border:1px solid #e2e8f0;border-radius:14px;box-shadow:0 18px 48px rgba(0,0,0,.28);
      display:none;flex-direction:column;overflow:hidden;font-family:Inter,system-ui,sans-serif;}
    .hcc-contacts.on{display:flex;}
    .hcc-contacts header{padding:12px 14px;font-weight:800;font-size:15px;color:#0f2444;border-bottom:1px solid #eef2f7;
      display:flex;align-items:center;justify-content:space-between;}
    .hcc-contacts header button{background:none;border:none;font-size:18px;cursor:pointer;color:#64748b;line-height:1;}
    .hcc-search{margin:10px 12px;padding:9px 12px;border:1px solid #e2e8f0;border-radius:10px;font-size:14px;outline:none;}
    .hcc-search:focus{border-color:#185FA5;}
    .hcc-list{overflow-y:auto;padding:0 6px 8px;}
    .hcc-row{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:10px;cursor:pointer;}
    .hcc-row:hover{background:#f1f5f9;}
    .hcc-avatar{width:34px;height:34px;border-radius:50%;background:#cfe0f2;color:#185FA5;font-weight:800;font-size:13px;
      display:flex;align-items:center;justify-content:center;flex-shrink:0;}
    .hcc-row .hcc-meta{flex:1;min-width:0;}
    .hcc-row .hcc-name{font-weight:700;font-size:14px;color:#1e293b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .hcc-row .hcc-sub{font-size:12px;color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .hcc-row .hcc-dot{background:#e8413a;color:#fff;border-radius:9px;min-width:18px;height:18px;padding:0 5px;
      font-size:11px;font-weight:800;display:none;align-items:center;justify-content:center;}
    .hcc-row .hcc-dot.on{display:inline-flex;}
    .hcc-empty{padding:18px;text-align:center;color:#94a3b8;font-size:13px;}

    .hcc-win{position:fixed;bottom:0;z-index:9002;width:300px;height:380px;background:#fff;border:1px solid #e2e8f0;
      border-bottom:none;border-radius:12px 12px 0 0;box-shadow:0 18px 48px rgba(0,0,0,.28);
      display:flex;flex-direction:column;overflow:hidden;font-family:Inter,system-ui,sans-serif;}
    .hcc-win.min{height:46px;}
    .hcc-win header{background:#185FA5;color:#fff;padding:0 8px 0 12px;height:46px;display:flex;align-items:center;gap:8px;
      cursor:pointer;flex-shrink:0;}
    .hcc-win header .hcc-h-name{flex:1;font-weight:700;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .hcc-win header button{background:none;border:none;color:#fff;font-size:18px;cursor:pointer;line-height:1;padding:4px 6px;border-radius:6px;}
    .hcc-win header button:hover{background:rgba(255,255,255,.18);}
    .hcc-body{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:6px;background:#f8fafc;}
    .hcc-win.min .hcc-body,.hcc-win.min .hcc-foot{display:none;}
    .hcc-msg{max-width:80%;padding:7px 11px;border-radius:14px;font-size:13.5px;line-height:1.4;word-wrap:break-word;white-space:pre-wrap;}
    .hcc-msg.me{align-self:flex-end;background:#185FA5;color:#fff;border-bottom-right-radius:4px;}
    .hcc-msg.them{align-self:flex-start;background:#e9eef4;color:#1e293b;border-bottom-left-radius:4px;}
    .hcc-msg .hcc-t{display:block;font-size:10px;opacity:.65;margin-top:3px;}
    .hcc-day{align-self:center;font-size:11px;color:#94a3b8;margin:4px 0;}
    .hcc-foot{display:flex;gap:6px;padding:8px;border-top:1px solid #eef2f7;flex-shrink:0;}
    .hcc-foot textarea{flex:1;resize:none;border:1px solid #e2e8f0;border-radius:18px;padding:9px 12px;font:14px Inter,system-ui,sans-serif;
      outline:none;max-height:80px;}
    .hcc-foot textarea:focus{border-color:#185FA5;}
    .hcc-foot button{background:#185FA5;border:none;color:#fff;border-radius:50%;width:38px;height:38px;font-size:16px;cursor:pointer;flex-shrink:0;}
    .hcc-foot button:disabled{opacity:.5;cursor:default;}
    @media (max-width:560px){
      .hcc-win{width:100vw;left:0;right:0;border-radius:0;}
      .hcc-contacts{right:0;left:0;width:auto;border-radius:0;}
    }`;
    const el = document.createElement('style');
    el.id = 'hcc-style';
    el.textContent = css;
    document.head.appendChild(el);
  }

  // ── launcher + contacts ────────────────────────────────────
  let launcherEl, badgeEl, contactsEl, listEl, searchEl;

  function buildLauncher() {
    launcherEl = document.createElement('button');
    launcherEl.className = 'hcc-launcher';
    launcherEl.type = 'button';
    launcherEl.innerHTML = '<span>💬 Chat</span><span class="hcc-badge"></span>';
    badgeEl = launcherEl.querySelector('.hcc-badge');
    launcherEl.addEventListener('click', toggleContacts);
    document.body.appendChild(launcherEl);

    contactsEl = document.createElement('div');
    contactsEl.className = 'hcc-contacts';
    contactsEl.innerHTML =
      '<header>Messages<button type="button" aria-label="Close">&times;</button></header>' +
      '<input class="hcc-search" type="text" placeholder="Search people…">' +
      '<div class="hcc-list"></div>';
    listEl   = contactsEl.querySelector('.hcc-list');
    searchEl = contactsEl.querySelector('.hcc-search');
    contactsEl.querySelector('header button').addEventListener('click', closeContacts);
    searchEl.addEventListener('input', renderContacts);
    document.body.appendChild(contactsEl);

    document.addEventListener('click', function (e) {
      if (!state.contactsOpen) return;
      if (contactsEl.contains(e.target) || launcherEl.contains(e.target)) return;
      closeContacts();
    });
  }

  function toggleContacts() { state.contactsOpen ? closeContacts() : openContacts(); }
  async function openContacts() {
    state.contactsOpen = true;
    contactsEl.classList.add('on');
    if (!state.roster.length) await loadRoster();
    renderContacts();
    setTimeout(() => { try { searchEl.focus(); } catch (_) {} }, 30);
  }
  function closeContacts() { state.contactsOpen = false; contactsEl.classList.remove('on'); }

  async function loadRoster() {
    try {
      const data = await api('?action=roster');
      state.roster = data.users || [];
      state.rosterByEmail = {};
      state.roster.forEach(u => { state.rosterByEmail[u.email] = u; });
    } catch (e) { console.warn('chat: roster failed', e.message); }
  }

  const ROLE_LABEL = { admin: 'Admin', manager: 'Manager', l2: 'Associate L2', l1: 'Associate L1', external: 'Stakeholder' };

  function renderContacts() {
    const q = (searchEl.value || '').trim().toLowerCase();
    const rows = state.roster.filter(u =>
      !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
    if (!rows.length) {
      listEl.innerHTML = '<div class="hcc-empty">' + (q ? 'No matches' : 'No teammates yet') + '</div>';
      return;
    }
    listEl.innerHTML = rows.map(u => {
      const n = state.unread[u.email] || 0;
      return '<div class="hcc-row" data-email="' + esc(u.email) + '">' +
        '<div class="hcc-avatar">' + esc(initials(u.name)) + '</div>' +
        '<div class="hcc-meta"><div class="hcc-name">' + esc(u.name) + '</div>' +
        '<div class="hcc-sub">' + esc(ROLE_LABEL[u.role] || u.role) + '</div></div>' +
        '<span class="hcc-dot' + (n ? ' on' : '') + '">' + (n > 9 ? '9+' : n) + '</span></div>';
    }).join('');
    listEl.querySelectorAll('.hcc-row').forEach(row => {
      row.addEventListener('click', () => { openWindow(row.getAttribute('data-email')); closeContacts(); });
    });
  }

  // ── chat windows ───────────────────────────────────────────
  function positionWindows() {
    let right = 90; // leave room for the launcher pill on the far right
    state.windows.forEach(win => {
      win.el.style.right = right + 'px';
      right += 312;
    });
  }

  async function openWindow(email) {
    if (!email || email === state.me) return;
    let win = state.windows.get(email);
    if (win) { // already open — un-minimize and focus
      win.minimized = false;
      win.el.classList.remove('min');
      win.input.focus();
      return;
    }
    const display = nameFor(email);
    const el = document.createElement('div');
    el.className = 'hcc-win';
    el.innerHTML =
      '<header><div class="hcc-avatar" style="width:28px;height:28px;font-size:11px">' + esc(initials(display)) + '</div>' +
      '<span class="hcc-h-name">' + esc(display) + '</span>' +
      '<button class="hcc-min" type="button" aria-label="Minimize">&#8211;</button>' +
      '<button class="hcc-close" type="button" aria-label="Close">&times;</button></header>' +
      '<div class="hcc-body"><div class="hcc-empty">Loading…</div></div>' +
      '<div class="hcc-foot"><textarea rows="1" placeholder="Message ' + esc(display) + '…"></textarea>' +
      '<button class="hcc-send" type="button" aria-label="Send">&#10148;</button></div>';
    document.body.appendChild(el);

    win = {
      email, el,
      body:  el.querySelector('.hcc-body'),
      input: el.querySelector('textarea'),
      minimized: false,
      ids: new Set(),
    };
    state.windows.set(email, win);
    positionWindows();

    // Header click toggles minimize (but not when clicking the buttons).
    el.querySelector('header').addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      toggleMinimize(email);
    });
    el.querySelector('.hcc-min').addEventListener('click', () => toggleMinimize(email));
    el.querySelector('.hcc-close').addEventListener('click', () => closeWindow(email));

    const send = () => sendFrom(win);
    el.querySelector('.hcc-send').addEventListener('click', send);
    win.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
    win.input.addEventListener('input', () => {
      win.input.style.height = 'auto';
      win.input.style.height = Math.min(80, win.input.scrollHeight) + 'px';
    });

    await loadHistory(win);
    win.input.focus();
  }

  function toggleMinimize(email) {
    const win = state.windows.get(email);
    if (!win) return;
    win.minimized = !win.minimized;
    win.el.classList.toggle('min', win.minimized);
    if (!win.minimized) { markRead(email); win.input.focus(); }
  }

  function closeWindow(email) {
    const win = state.windows.get(email);
    if (!win) return;
    win.el.remove();
    state.windows.delete(email);
    positionWindows();
  }

  function dayLabel(ts) {
    try {
      const d = new Date(ts), now = new Date();
      const sameDay = d.toDateString() === now.toDateString();
      if (sameDay) return 'Today';
      return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    } catch (_) { return ''; }
  }

  function appendMessage(win, msg) {
    if (win.ids.has(msg.id)) return;
    win.ids.add(msg.id);
    const empty = win.body.querySelector('.hcc-empty');
    if (empty) empty.remove();
    const mine = msg.from === state.me;
    const div = document.createElement('div');
    div.className = 'hcc-msg ' + (mine ? 'me' : 'them');
    div.innerHTML = esc(msg.body) + '<span class="hcc-t">' + esc(timeLabel(msg.createdAt)) + '</span>';
    const nearBottom = win.body.scrollHeight - win.body.scrollTop - win.body.clientHeight < 60;
    win.body.appendChild(div);
    if (nearBottom || mine) win.body.scrollTop = win.body.scrollHeight;
  }

  async function loadHistory(win) {
    try {
      const data = await api('?action=history&with=' + encodeURIComponent(win.email));
      win.body.innerHTML = '';
      const msgs = data.messages || [];
      if (!msgs.length) {
        win.body.innerHTML = '<div class="hcc-empty">No messages yet. Say hello 👋</div>';
      } else {
        msgs.forEach(m => appendMessage(win, m));
        // bump our seen-id watermark so the poller won't re-deliver these
        msgs.forEach(m => { if (gt(m.id, state.maxId)) state.maxId = m.id; });
      }
      win.body.scrollTop = win.body.scrollHeight;
      // Viewing the thread clears its unread count.
      delete state.unread[win.email];
      renderBadge();
      renderContacts();
    } catch (e) {
      win.body.innerHTML = '<div class="hcc-empty">Couldn\'t load messages.</div>';
      console.warn('chat: history failed', e.message);
    }
  }

  async function sendFrom(win) {
    const text = (win.input.value || '').trim();
    if (!text) return;
    const btn = win.el.querySelector('.hcc-send');
    btn.disabled = true;
    try {
      const data = await api('?action=send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: win.email, body: text }),
      });
      win.input.value = '';
      win.input.style.height = 'auto';
      if (data.message) {
        appendMessage(win, data.message);
        if (gt(data.message.id, state.maxId)) state.maxId = data.message.id;
      }
    } catch (e) {
      console.warn('chat: send failed', e.message);
      alert('Message failed to send. Check your connection and try again.');
    } finally {
      btn.disabled = false;
      win.input.focus();
    }
  }

  async function markRead(email) {
    try {
      await api('?action=read', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ with: email }),
      });
      delete state.unread[email];
      renderBadge();
      renderContacts();
    } catch (_) {}
  }

  // ── badge ──────────────────────────────────────────────────
  function renderBadge() {
    let total = 0;
    for (const k in state.unread) total += state.unread[k] || 0;
    if (total > 0) {
      badgeEl.textContent = total > 99 ? '99+' : total;
      badgeEl.classList.add('on');
    } else {
      badgeEl.classList.remove('on');
    }
  }

  // ── polling ────────────────────────────────────────────────
  async function sync() {
    try {
      const data = await api('?action=sync&since=' + encodeURIComponent(state.maxId));
      if (data.maxId && gt(data.maxId, state.maxId)) state.maxId = data.maxId;

      (data.messages || []).forEach(msg => {
        const other = msg.from === state.me ? msg.to : msg.from;
        const win = state.windows.get(other);
        if (win) appendMessage(win, msg);
      });

      state.unread = data.unread || {};
      // If an open, non-minimized window has the page's focus, treat its
      // incoming messages as read so the badge doesn't linger.
      if (document.hasFocus()) {
        state.windows.forEach((win, email) => {
          if (!win.minimized && state.unread[email]) markRead(email);
        });
      }
      renderBadge();
      if (state.contactsOpen) renderContacts();
    } catch (e) {
      // stay quiet on transient poll errors
    }
  }

  function startPolling() {
    if (state.pollTimer) return;
    sync();
    state.pollTimer = setInterval(sync, POLL_MS);
    // Catch up promptly when the tab regains focus.
    window.addEventListener('focus', sync);
  }

  // ── boot: wait for sign-in, then start ─────────────────────
  function bootWhenReady() {
    let tries = 0;
    const t = setInterval(function () {
      tries++;
      const u = window.hcCurrentUser;
      if (u && u.email) {
        clearInterval(t);
        state.me = String(u.email).toLowerCase();
        injectCss();
        buildLauncher();
        loadRoster().then(startPolling);
      } else if (tries > 60) {     // ~30s — user never signed in here
        clearInterval(t);
      }
    }, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootWhenReady);
  } else {
    bootWhenReady();
  }
})();
