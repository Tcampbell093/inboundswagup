/* =========================================================
   auth.js — Houston Control Authentication
   ========================================================= */
(function () {
  'use strict';

  const USER_KEY    = 'qaWorkflowCurrentUserV2';
  const HC_USER_KEY = 'hcAuthUser';
  window.hcCurrentUser = null;

  // ── Wait for DOM + Identity widget to be ready ────────────────
  function init() {
    const overlay     = document.getElementById('hcLoginOverlay');
    const loginBtn    = document.getElementById('hcGoogleLoginBtn');
    const logoutBtn   = document.getElementById('hcLogoutBtn');
    const userDisplay = document.getElementById('hcUserDisplay');

    if (!window.netlifyIdentity) {
      console.error('HC Auth: Netlify Identity widget not found.');
      return;
    }

    // Init with explicit site URL so widget knows where to authenticate
    netlifyIdentity.init({
      APIUrl: 'https://inboundswagup.netlify.app/.netlify/identity'
    });

    // ── Bounce suspended users ──────────────────────────────────
    function isSuspended(user) {
      return user?.app_metadata?.suspended === true;
    }

    // ── Apply user to app state ─────────────────────────────────
    function applyUser(user) {
      if (!user) { showLogin(); return; }
      if (isSuspended(user)) { netlifyIdentity.logout(); return; }

      const name = user.user_metadata?.full_name
                || user.user_metadata?.name
                || user.email
                || 'User';
      const role = user.app_metadata?.role || 'l1';

      window.hcCurrentUser = {
        id:        user.id,
        email:     user.email,
        name,
        role,
        overrides: user.app_metadata?.overrides || {},
        tempAdmin: user.app_metadata?.tempAdmin  || false,
        token:     user.token?.access_token      || null,
      };

      localStorage.setItem(USER_KEY, name);
      localStorage.setItem(HC_USER_KEY, JSON.stringify({
        id: user.id, email: user.email, name, role,
        overrides: user.app_metadata?.overrides || {},
        tempAdmin: user.app_metadata?.tempAdmin  || false,
      }));

      hideLogin();
      if (userDisplay) {
        const label = { admin:'Admin', manager:'Manager', l2:'Associate L2', l1:'Associate L1' }[role] || 'Associate';
        userDisplay.textContent = `${name} · ${label}`;
        userDisplay.hidden = false;
      }
    }

    function showLogin() {
      if (overlay) { overlay.hidden = false; }
      document.body.style.overflow = 'hidden';
    }

    function hideLogin() {
      if (overlay) { overlay.hidden = true; }
      document.body.style.overflow = '';
    }

    // ── Button handlers ─────────────────────────────────────────
    if (loginBtn) {
      loginBtn.addEventListener('click', function () {
        netlifyIdentity.open('login');
      });
    }

    if (logoutBtn) {
      logoutBtn.addEventListener('click', function () {
        netlifyIdentity.logout();
      });
    }

    // ── Identity events ─────────────────────────────────────────
    netlifyIdentity.on('login', function (user) {
      netlifyIdentity.close();
      applyUser(user);
    });

    netlifyIdentity.on('logout', function () {
      window.hcCurrentUser = null;
      localStorage.removeItem(USER_KEY);
      localStorage.removeItem(HC_USER_KEY);
      if (userDisplay) userDisplay.hidden = true;
      showLogin();
    });

    netlifyIdentity.on('error', function (err) {
      console.error('HC Auth error:', err);
    });

    // ── Check if already logged in ──────────────────────────────
    const existing = netlifyIdentity.currentUser();
    if (existing && !isSuspended(existing)) {
      applyUser(existing);
    } else {
      showLogin();
    }
  }

  // Run after all scripts have loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
