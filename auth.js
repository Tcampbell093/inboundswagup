/* =========================================================
   auth.js — Houston Control Authentication
   Redirects to login.html for auth, reads session on return
   ========================================================= */
(function () {
  'use strict';

  const USER_KEY    = 'qaWorkflowCurrentUserV2';
  const HC_USER_KEY = 'hcAuthUser';
  // Netlify Identity is served from the site's own origin, so deriving the base
  // from the current origin isolates each environment (production, staging,
  // deploy previews) automatically. Only trust the origin for real http(s)
  // pages — under file:// the origin is absent or the string "null", so fall
  // back to the production origin (never "null/.netlify/identity").
  const API_URL     = (function () {
    var loc = (typeof window !== 'undefined') ? window.location : null;
    var origin = loc && loc.origin;
    var proto  = loc && loc.protocol;
    var useOrigin = (proto === 'https:' || proto === 'http:') && !!origin && origin !== 'null';
    return (useOrigin ? origin : 'https://inboundswagup.netlify.app') + '/.netlify/identity';
  })();

  window.hcCurrentUser = null;

  // Are we running inside an iframe (e.g. the inbound module embedded in the
  // portal)? If so, the TOP-LEVEL document owns authentication: it already
  // verified the session and it owns background token renewal. The embedded
  // copy must NOT redirect to login or refresh independently — two refreshers
  // sharing one rotating refresh token would invalidate each other. The embed
  // just hydrates the in-memory user from shared localStorage so app.js can
  // attach the (top-level-kept-fresh) token to its sync requests.
  let isEmbedded = false;
  try { isEmbedded = (window.self !== window.top); } catch (_) { isEmbedded = true; }

  // ── Cross-frame auth bridge (top-level owner) ──────────────────────────
  // Embedded modules (the inbound iframe) may be unable to read the shared
  // hcAuthUser from their own localStorage when the browser partitions storage
  // for embedded documents (iPad Safari "Prevent Cross-Site Tracking", strict
  // Chrome privacy). We — the top-level window that always holds a working
  // session — hand the token down over postMessage: on request from a frame,
  // and proactively whenever the token changes (login + background refresh).
  function broadcastTokenToFrames() {
    if (isEmbedded) return; // only the top-level owner broadcasts
    const s = readSession();
    const token = (s && s.token) || (window.hcCurrentUser && window.hcCurrentUser.token) || null;
    if (!token) return;
    let frames;
    try { frames = document.querySelectorAll('iframe'); } catch (_) { return; }
    frames.forEach(function (f) {
      try { f.contentWindow && f.contentWindow.postMessage({ type: 'HC_AUTH_TOKEN', token: token }, window.location.origin); } catch (_) {}
    });
  }
  // Answer a frame that asks for the token, replying straight to the asker so
  // it works even before the frame is fully in the DOM at broadcast time.
  if (!isEmbedded) {
    window.addEventListener('message', function (e) {
      if (e.origin !== window.location.origin) return;
      if (!e.data || e.data.type !== 'HC_AUTH_TOKEN_REQUEST') return;
      const s = readSession();
      const token = (s && s.token) || (window.hcCurrentUser && window.hcCurrentUser.token) || null;
      if (token && e.source) {
        try { e.source.postMessage({ type: 'HC_AUTH_TOKEN', token: token }, window.location.origin); } catch (_) {}
      }
    });
  }

  // ── Background token renewal ───────────────────────────────────────────
  // Netlify Identity access tokens expire (~1h). Without renewal, a tablet
  // left open all day would start failing authenticated sync once the backend
  // enforces auth. We refresh shortly before expiry using the stored refresh
  // token and write the fresh token back to localStorage so every same-origin
  // context (including the embedded inbound iframe) picks it up.
  let refreshTimer = null;
  function readSession() {
    try { return JSON.parse(localStorage.getItem(HC_USER_KEY) || 'null'); } catch (_) { return null; }
  }
  function scheduleTokenRefresh() {
    if (isEmbedded) return; // top-level window owns renewal
    if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; }
    const s = readSession();
    if (!s || !s.refreshToken || !s.expiresAt) return; // pre-refresh-era session
    const lead = 5 * 60 * 1000; // renew 5 min before expiry
    const delay = Math.max(15 * 1000, s.expiresAt - Date.now() - lead);
    refreshTimer = setTimeout(doTokenRefresh, delay);
  }
  function doTokenRefresh() {
    const s = readSession();
    if (!s || !s.refreshToken) return;
    fetch(API_URL + '/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(s.refreshToken),
    })
      .then(function (r) { if (!r.ok) throw new Error('refresh ' + r.status); return r.json(); })
      .then(function (tok) {
        if (!tok || !tok.access_token) throw new Error('no access_token in refresh response');
        const cur = readSession() || s;
        cur.token = tok.access_token;
        if (tok.refresh_token) cur.refreshToken = tok.refresh_token;
        if (tok.expires_in)    cur.expiresAt    = Date.now() + tok.expires_in * 1000;
        localStorage.setItem(HC_USER_KEY, JSON.stringify(cur));
        if (window.hcCurrentUser) window.hcCurrentUser.token = cur.token;
        scheduleTokenRefresh();
        broadcastTokenToFrames();
      })
      .catch(function (err) {
        console.warn('HC Auth: token refresh failed:', err.message);
        // Retry once in a minute; if the refresh token is truly dead, the next
        // authenticated request will 401 and app.js will route to re-login.
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(doTokenRefresh, 60 * 1000);
      });
  }
  // Exposed so app.js can force a renewal after a 401 before retrying.
  window.hcRefreshToken = function () {
    return new Promise(function (resolve) {
      const s = readSession();
      if (!s || !s.refreshToken) { resolve(null); return; }
      fetch(API_URL + '/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(s.refreshToken),
      })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (tok) {
          if (!tok || !tok.access_token) { resolve(null); return; }
          const cur = readSession() || s;
          cur.token = tok.access_token;
          if (tok.refresh_token) cur.refreshToken = tok.refresh_token;
          if (tok.expires_in)    cur.expiresAt    = Date.now() + tok.expires_in * 1000;
          localStorage.setItem(HC_USER_KEY, JSON.stringify(cur));
          if (window.hcCurrentUser) window.hcCurrentUser.token = cur.token;
          resolve(cur.token);
          broadcastTokenToFrames();
        })
        .catch(function () { resolve(null); });
    });
  };

  function init() {
    const overlay     = document.getElementById('hcLoginOverlay');
    const logoutBtn   = document.getElementById('hcLogoutBtn');
    const userDisplay = document.getElementById('hcUserDisplay');

    function showLogin() {
      // When embedded (inbound module inside the portal), never redirect the
      // iframe to the login page — the top-level portal owns auth and will
      // handle an expired/absent session. Redirecting here would just render a
      // login card inside the iframe.
      if (isEmbedded) return;
      // Redirect to dedicated login page
      window.location.href = 'login.html';
    }

    function hideLogin() {
      if (overlay) overlay.hidden = true;
      document.body.style.overflow = '';
    }

    function applyUser(data) {
      if (!data || data.suspended) { showLogin(); return; }

      window.hcCurrentUser = {
        id:        data.id,
        email:     data.email,
        name:      data.name,
        role:      data.role || 'l1',
        overrides: data.overrides || {},
        tempAdmin: data.tempAdmin || false,
        tempAdminExpiry: data.tempAdminExpiry || null,
        token:     data.token || null,
      };

      localStorage.setItem(USER_KEY, data.name);
      hideLogin();

      if (userDisplay) {
        const label = { admin:'Admin', manager:'Manager', l2:'Associate L2', l1:'Associate L1', external:'External' }[data.role] || 'Associate';
        userDisplay.textContent = `${data.name} · ${label}`;
        userDisplay.hidden = false;
      }

      console.log('HC Auth: logged in as', data.name, '/', data.role);

      // Apply role guards immediately
      if (window.hcAccess) window.hcAccess.applyGuards();

      // Keep the session token fresh in the background (top-level only).
      scheduleTokenRefresh();

      // Hand the token down to any embedded modules (inbound iframe) so a
      // storage-partitioned frame can still authenticate its sync calls.
      broadcastTokenToFrames();
    }

    // ── Logout button — always attach regardless of session ───
    if (logoutBtn) {
      logoutBtn.addEventListener('click', function() {
        const d = JSON.parse(localStorage.getItem(HC_USER_KEY) || '{}');
        localStorage.removeItem(HC_USER_KEY);
        localStorage.removeItem(USER_KEY);
        window.hcCurrentUser = null;

        // Netlify Identity can't pass prompt=select_account to Google, so on a
        // browser with a single Google session the next sign-in silently reuses
        // it and skips the account chooser. To let a different user sign in
        // (e.g. on a shared tablet / incognito), we also sign the browser out of
        // Google here, then return to our login page. Google's logout honours
        // the continue= target back to login.html.
        const loginUrl    = window.location.origin + '/login.html';
        const googleLogout = 'https://accounts.google.com/Logout?continue=' +
          encodeURIComponent('https://appengine.google.com/_ah/logout?continue=' +
            encodeURIComponent(loginUrl));

        if (d.token) {
          // Clear the Netlify Identity session first, then the Google session.
          fetch(API_URL + '/logout', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + d.token }
          }).finally(function() { window.location.href = googleLogout; });
        } else {
          window.location.href = googleLogout;
        }
      });
    }

    // ── Embedded (iframe) short-circuit ────────────────────────
    // The portal already authenticated and owns token renewal. Here we only
    // hydrate the in-memory user from shared localStorage so app.js can attach
    // the token to sync requests. No network verification, no redirect, no
    // independent refresh — those belong to the top-level window.
    if (isEmbedded) {
      const s = readSession();
      if (s && s.token) {
        window.hcCurrentUser = {
          id: s.id, email: s.email, name: s.name,
          role: s.role || 'l1', overrides: s.overrides || {},
          tempAdmin: s.tempAdmin || false, tempAdminExpiry: s.tempAdminExpiry || null,
          token: s.token,
        };
        if (userDisplay) {
          const label = { admin:'Admin', manager:'Manager', l2:'Associate L2', l1:'Associate L1', external:'External' }[s.role] || 'Associate';
          userDisplay.textContent = `${s.name} · ${label}`;
          userDisplay.hidden = false;
        }
        if (window.hcAccess) window.hcAccess.applyGuards();
      }
      return; // never redirect from inside the iframe
    }

    // ── Check for saved session ────────────────────────────────
    const saved = localStorage.getItem(HC_USER_KEY);
    if (saved) {
      try {
        const data = JSON.parse(saved);
        if (data && data.token) {
          // Verify token is still valid
          fetch(API_URL + '/user', {
            headers: { 'Authorization': 'Bearer ' + data.token }
          })
          .then(function(r) {
            if (r.ok) return r.json();
            throw new Error('Session expired');
          })
          .then(function(user) {
            // Fetch role from our Neon DB
            const identityName = (user.user_metadata && (user.user_metadata.full_name || user.user_metadata.name)) || user.email;
            return fetch('/.netlify/functions/users?action=upsert', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + data.token },
              body: JSON.stringify({ name: identityName })
            })
            .then(function(r) { return r.json(); })
            .then(function(dbUser) {
              if (dbUser.unauthorized) {
                localStorage.removeItem(HC_USER_KEY);
                localStorage.removeItem(USER_KEY);
                window.location.href = 'login.html?reason=unauthorized';
                return;
              }
              // Prefer the name the user set in their profile (stored in
              // hc_users) over the Identity-provided one. If the DB name
              // is empty, fall back to Identity.
              const displayName = (dbUser.name && dbUser.name.trim()) || identityName;
              const refreshed = {
                id:        user.id,
                email:     user.email,
                name:      displayName,
                role:      dbUser.role || 'l1',
                overrides: dbUser.overrides || {},
                tempAdmin: dbUser.tempAdmin || false,
                tempAdminExpiry: dbUser.tempAdminExpiry || null,
                suspended: dbUser.suspended || false,
                token:     data.token,
                // Carry renewal fields forward so background refresh keeps working.
                refreshToken: data.refreshToken || '',
                expiresAt:    data.expiresAt || 0
              };
              localStorage.setItem(HC_USER_KEY, JSON.stringify(refreshed));
              applyUser(refreshed);
            });
          })
          .catch(function() {
            localStorage.removeItem(HC_USER_KEY);
            localStorage.removeItem(USER_KEY);
            showLogin();
          });
          return; // Wait for fetch
        }
      } catch(_) {}
    }

    // No valid session — go to login
    showLogin();
  }

  // ── Profile popover: edit display name without admin tools ──────────
  function initProfilePopover() {
    const chip     = document.getElementById('hcUserDisplay');
    const pop      = document.getElementById('hcProfilePopover');
    const emailEl  = document.getElementById('hcProfileEmail');
    const nameIn   = document.getElementById('hcProfileName');
    const statusEl = document.getElementById('hcProfileStatus');
    const saveBtn  = document.getElementById('hcProfileSave');
    const soBtn    = document.getElementById('hcProfileSignOut');
    if (!chip || !pop) return;

    function setStatus(msg, kind) {
      statusEl.textContent = msg || '';
      statusEl.classList.toggle('is-ok',  kind === 'ok');
      statusEl.classList.toggle('is-err', kind === 'err');
    }
    function open() {
      const user = window.hcCurrentUser; if (!user) return;
      emailEl.textContent = user.email || '';
      nameIn.value        = user.name || '';
      setStatus('');
      pop.hidden = false;
      chip.setAttribute('aria-expanded','true');
      setTimeout(() => { try { nameIn.focus(); nameIn.select(); } catch(_){} }, 20);
    }
    function close() {
      pop.hidden = true;
      chip.setAttribute('aria-expanded','false');
    }
    chip.addEventListener('click', function() {
      pop.hidden ? open() : close();
    });
    chip.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pop.hidden ? open() : close(); }
    });
    document.addEventListener('click', function(e) {
      if (pop.hidden) return;
      if (pop.contains(e.target) || chip.contains(e.target)) return;
      close();
    });
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && !pop.hidden) close();
    });

    saveBtn.addEventListener('click', async function() {
      const user = window.hcCurrentUser;
      if (!user || !user.token) { setStatus('Not signed in', 'err'); return; }
      const newName = (nameIn.value || '').trim();
      if (!newName) { setStatus('Name cannot be empty', 'err'); return; }
      if (newName === user.name) { setStatus('Already saved', 'ok'); return; }
      saveBtn.disabled = true;
      setStatus('Saving…');
      try {
        const res = await fetch('/.netlify/functions/users?action=update-profile', {
          method: 'POST',
          headers: { 'Content-Type':'application/json', 'Authorization':'Bearer ' + user.token },
          body: JSON.stringify({ name: newName }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Save failed');
        // Update in-memory user
        window.hcCurrentUser.name = data.name || newName;
        // Update local storage
        try {
          const saved = JSON.parse(localStorage.getItem('hcAuthUser') || '{}');
          saved.name = data.name || newName;
          localStorage.setItem('hcAuthUser', JSON.stringify(saved));
        } catch(_){}
        // Update the chip label
        const label = { admin:'Admin', manager:'Manager', l2:'Associate L2', l1:'Associate L1', external:'Stakeholder' }[user.role] || 'Associate';
        chip.textContent = (data.name || newName) + ' · ' + label;
        // Broadcast so iframes pick up the new name immediately
        window.dispatchEvent(new CustomEvent('hc-profile-updated', { detail: { name: data.name || newName } }));
        setStatus('Saved ✓', 'ok');
      } catch (err) {
        setStatus(err.message || 'Could not save', 'err');
      } finally {
        saveBtn.disabled = false;
      }
    });

    if (soBtn) {
      soBtn.addEventListener('click', function() {
        document.getElementById('hcLogoutBtn')?.click();
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initProfilePopover);
  } else {
    initProfilePopover();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
