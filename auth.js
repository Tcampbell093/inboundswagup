/* =========================================================
   auth.js — Houston Control Authentication
   Uses Netlify Identity widget correctly
   ========================================================= */
(function () {
  'use strict';

  const USER_KEY    = 'qaWorkflowCurrentUserV2';
  const HC_USER_KEY = 'hcAuthUser';

  window.hcCurrentUser = null;

  function init() {
    const overlay     = document.getElementById('hcLoginOverlay');
    const loginBtn    = document.getElementById('hcGoogleLoginBtn');
    const logoutBtn   = document.getElementById('hcLogoutBtn');
    const userDisplay = document.getElementById('hcUserDisplay');

    if (!window.netlifyIdentity) {
      console.error('HC Auth: netlifyIdentity not found');
      return;
    }

    function isSuspended(user) {
      return user?.app_metadata?.suspended === true;
    }

    function showLogin() {
      if (overlay) overlay.hidden = false;
      document.body.style.overflow = 'hidden';
    }

    function hideLogin() {
      if (overlay) overlay.hidden = true;
      document.body.style.overflow = '';
    }

    function applyUser(user) {
      console.log('HC Auth: applyUser', user?.email);
      if (!user || isSuspended(user)) { showLogin(); return; }

      const name = user.user_metadata?.full_name
                || user.user_metadata?.name
                || user.email || 'User';
      const role = user.app_metadata?.role || 'l1';

      window.hcCurrentUser = { id: user.id, email: user.email, name, role,
        overrides: user.app_metadata?.overrides || {},
        tempAdmin: user.app_metadata?.tempAdmin || false,
        token: user.token?.access_token || null };

      localStorage.setItem(USER_KEY, name);
      localStorage.setItem(HC_USER_KEY, JSON.stringify(window.hcCurrentUser));

      hideLogin();

      if (userDisplay) {
        const label = { admin:'Admin', manager:'Manager', l2:'Associate L2', l1:'Associate L1' }[role] || 'Associate';
        userDisplay.textContent = `${name} · ${label}`;
        userDisplay.hidden = false;
      }
    }

    // ── Init widget with explicit API URL ──────────────────────
    netlifyIdentity.init({
      APIUrl: 'https://inboundswagup.netlify.app/.netlify/identity',
      logo: false
    });

    // ── Events ─────────────────────────────────────────────────
    netlifyIdentity.on('init', function(user) {
      console.log('HC Auth: init event', user ? user.email : 'no user');
      if (user && !isSuspended(user)) {
        applyUser(user);
      } else {
        showLogin();
      }
    });

    netlifyIdentity.on('login', function(user) {
      console.log('HC Auth: login event', user?.email);
      netlifyIdentity.close();
      applyUser(user);
    });

    netlifyIdentity.on('logout', function() {
      console.log('HC Auth: logout event');
      window.hcCurrentUser = null;
      localStorage.removeItem(USER_KEY);
      localStorage.removeItem(HC_USER_KEY);
      if (userDisplay) userDisplay.hidden = true;
      showLogin();
    });

    netlifyIdentity.on('error', function(err) {
      console.error('HC Auth: error', err);
    });

    // ── Button: open widget modal ──────────────────────────────
    if (loginBtn) {
      loginBtn.addEventListener('click', function() {
        console.log('HC Auth: opening widget');
        netlifyIdentity.open('login');
      });
    }

    // ── Logout button ──────────────────────────────────────────
    if (logoutBtn) {
      logoutBtn.addEventListener('click', function() {
        netlifyIdentity.logout();
      });
    }
  }

  // Run after DOM + all scripts loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
