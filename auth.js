/* =========================================================
   auth.js — Houston Control Authentication
   Uses direct OAuth redirect instead of popup widget
   ========================================================= */
(function () {
  'use strict';

  const USER_KEY    = 'qaWorkflowCurrentUserV2';
  const HC_USER_KEY = 'hcAuthUser';
  const API_URL     = 'https://inboundswagup.netlify.app/.netlify/identity';

  window.hcCurrentUser = null;

  function init() {
    const overlay     = document.getElementById('hcLoginOverlay');
    const loginBtn    = document.getElementById('hcGoogleLoginBtn');
    const logoutBtn   = document.getElementById('hcLogoutBtn');
    const userDisplay = document.getElementById('hcUserDisplay');

    function showLogin() {
      if (overlay) overlay.hidden = false;
      document.body.style.overflow = 'hidden';
    }

    function hideLogin() {
      if (overlay) overlay.hidden = true;
      document.body.style.overflow = '';
    }

    function isSuspended(data) {
      return data?.suspended === true;
    }

    function applyUser(data) {
      if (!data || isSuspended(data)) {
        localStorage.removeItem(HC_USER_KEY);
        localStorage.removeItem(USER_KEY);
        showLogin();
        return;
      }

      const name = data.user_metadata?.full_name
                || data.user_metadata?.name
                || data.email
                || 'User';
      const role = data.app_metadata?.role || 'l1';

      window.hcCurrentUser = {
        id:        data.id,
        email:     data.email,
        name,      role,
        overrides: data.app_metadata?.overrides || {},
        tempAdmin: data.app_metadata?.tempAdmin  || false,
        token:     data.access_token || null,
      };

      localStorage.setItem(USER_KEY, name);
      localStorage.setItem(HC_USER_KEY, JSON.stringify({
        id: data.id, email: data.email, name, role,
        overrides: data.app_metadata?.overrides || {},
        tempAdmin: data.app_metadata?.tempAdmin  || false,
        token:     data.access_token || null,
      }));

      hideLogin();

      if (userDisplay) {
        const label = { admin:'Admin', manager:'Manager', l2:'Associate L2', l1:'Associate L1' }[role] || 'Associate';
        userDisplay.textContent = `${name} · ${label}`;
        userDisplay.hidden = false;
      }
    }

    // ── Handle OAuth callback in URL hash ──────────────────────
    // After Google redirects back, the token is in the URL hash
    function handleOAuthCallback() {
      const hash = window.location.hash;
      if (!hash.includes('access_token=')) return false;

      const params = new URLSearchParams(hash.replace(/^#/, ''));
      const accessToken = params.get('access_token');
      if (!accessToken) return false;

      console.log('HC Auth: OAuth callback detected, fetching user info');

      // Exchange token for user info
      fetch(`${API_URL}/user`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      })
      .then(r => r.json())
      .then(data => {
        data.access_token = accessToken;
        applyUser(data);
        // Clean the token from URL without reloading
        history.replaceState(null, '', window.location.pathname);
      })
      .catch(err => {
        console.error('HC Auth: failed to get user info', err);
        showLogin();
      });

      return true;
    }

    // ── Google login via direct redirect ───────────────────────
    if (loginBtn) {
      loginBtn.addEventListener('click', function () {
        console.log('HC Auth: redirecting to Google via Netlify Identity');
        const redirectTo = encodeURIComponent(window.location.origin + window.location.pathname);
        window.location.href = `${API_URL}/authorize?provider=google&redirect_to=${redirectTo}`;
      });
    }

    // ── Logout ─────────────────────────────────────────────────
    if (logoutBtn) {
      logoutBtn.addEventListener('click', function () {
        const saved = JSON.parse(localStorage.getItem(HC_USER_KEY) || '{}');
        const token = saved.token;
        if (token) {
          fetch(`${API_URL}/logout`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
          }).finally(() => {
            localStorage.removeItem(HC_USER_KEY);
            localStorage.removeItem(USER_KEY);
            window.hcCurrentUser = null;
            if (userDisplay) userDisplay.hidden = true;
            showLogin();
          });
        } else {
          localStorage.removeItem(HC_USER_KEY);
          localStorage.removeItem(USER_KEY);
          window.hcCurrentUser = null;
          if (userDisplay) userDisplay.hidden = true;
          showLogin();
        }
      });
    }

    // ── On load: check for OAuth callback or existing session ──
    if (handleOAuthCallback()) return; // token in URL, handled above

    const saved = localStorage.getItem(HC_USER_KEY);
    if (saved) {
      try {
        const data = JSON.parse(saved);
        // Verify token is still valid
        if (data.token) {
          fetch(`${API_URL}/user`, {
            headers: { 'Authorization': `Bearer ${data.token}` }
          })
          .then(r => {
            if (r.ok) return r.json();
            throw new Error('Token expired');
          })
          .then(freshData => {
            freshData.access_token = data.token;
            applyUser(freshData);
          })
          .catch(() => {
            localStorage.removeItem(HC_USER_KEY);
            showLogin();
          });
          return;
        }
      } catch (_) {}
    }

    showLogin();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
