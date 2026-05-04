/* =========================================================
   auth.js — Houston Control Authentication
   Redirects to login.html for auth, reads session on return
   ========================================================= */
(function () {
  'use strict';

  const USER_KEY    = 'qaWorkflowCurrentUserV2';
  const HC_USER_KEY = 'hcAuthUser';
  const API_URL     = 'https://inboundswagup.netlify.app/.netlify/identity';

  window.hcCurrentUser = null;

  function init() {
    const overlay     = document.getElementById('hcLoginOverlay');
    const logoutBtn   = document.getElementById('hcLogoutBtn');
    const userDisplay = document.getElementById('hcUserDisplay');

    function showLogin() {
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
        token:     data.token || null,
      };

      localStorage.setItem(USER_KEY, data.name);
      hideLogin();

      if (userDisplay) {
        const label = { admin:'Admin', manager:'Manager', l2:'Associate L2', l1:'Associate L1' }[data.role] || 'Associate';
        userDisplay.textContent = `${data.name} · ${label}`;
        userDisplay.hidden = false;
      }

      console.log('HC Auth: logged in as', data.name, '/', data.role);

      // Apply role guards immediately
      if (window.hcAccess) window.hcAccess.applyGuards();
    }

    // ── Logout button — always attach regardless of session ───
    if (logoutBtn) {
      logoutBtn.addEventListener('click', function() {
        const d = JSON.parse(localStorage.getItem(HC_USER_KEY) || '{}');
        localStorage.removeItem(HC_USER_KEY);
        localStorage.removeItem(USER_KEY);
        window.hcCurrentUser = null;
        if (d.token) {
          fetch(API_URL + '/logout', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + d.token }
          }).finally(function() { window.location.href = 'login.html'; });
        } else {
          window.location.href = 'login.html';
        }
      });
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
            const name = (user.user_metadata && (user.user_metadata.full_name || user.user_metadata.name)) || user.email;
            return fetch('/.netlify/functions/users?action=upsert', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: user.id, email: user.email, name: name })
            })
            .then(function(r) { return r.json(); })
            .then(function(dbUser) {
              if (dbUser.unauthorized) {
                localStorage.removeItem(HC_USER_KEY);
                localStorage.removeItem(USER_KEY);
                window.location.href = 'login.html?reason=unauthorized';
                return;
              }
              const refreshed = {
                id:        user.id,
                email:     user.email,
                name:      name,
                role:      dbUser.role || 'l1',
                overrides: dbUser.overrides || {},
                tempAdmin: dbUser.tempAdmin || false,
                suspended: dbUser.suspended || false,
                token:     data.token
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
