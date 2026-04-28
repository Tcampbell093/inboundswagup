/* =========================================================
   auth.js — Houston Control Authentication
   Handles Netlify Identity + Google login/logout
   Sets window.hcCurrentUser and qaWorkflowCurrentUserV2
   ========================================================= */

(function () {
  'use strict';

  const USER_KEY = 'qaWorkflowCurrentUserV2';
  const HC_USER_KEY = 'hcAuthUser';

  // ── Expose current user globally so all modules can read it ──
  window.hcCurrentUser = null;

  // ── Elements ──────────────────────────────────────────────────
  const overlay     = document.getElementById('hcLoginOverlay');
  const loginBtn    = document.getElementById('hcGoogleLoginBtn');
  const logoutBtn   = document.getElementById('hcLogoutBtn');
  const userDisplay = document.getElementById('hcUserDisplay');

  // ── Netlify Identity init ─────────────────────────────────────
  if (!window.netlifyIdentity) {
    console.error('Netlify Identity widget not loaded.');
    return;
  }

  netlifyIdentity.init({ container: '#hcLoginOverlay' });

  // ── Show/hide the login overlay ───────────────────────────────
  function showLogin() {
    if (overlay) overlay.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function hideLogin() {
    if (overlay) overlay.hidden = true;
    document.body.style.overflow = '';
  }

  // ── Apply logged-in user to app state ─────────────────────────
  function applyUser(user) {
    if (!user) return;

    const displayName = user.user_metadata?.full_name
      || user.user_metadata?.name
      || user.email
      || 'User';

    const role = user.app_metadata?.role || 'l1';
    const suspended = user.app_metadata?.suspended || false;

    // Bounce suspended users immediately
    if (suspended) {
      netlifyIdentity.logout();
      return;
    }

    window.hcCurrentUser = {
      id:          user.id,
      email:       user.email,
      name:        displayName,
      role:        role,
      overrides:   user.app_metadata?.overrides || {},
      tempAdmin:   user.app_metadata?.tempAdmin  || false,
      token:       user.token?.access_token      || null,
    };

    // Write display name into the legacy key all modules read
    localStorage.setItem(USER_KEY, displayName);

    // Persist auth user for session restore
    localStorage.setItem(HC_USER_KEY, JSON.stringify({
      id:        user.id,
      email:     user.email,
      name:      displayName,
      role:      role,
      overrides: user.app_metadata?.overrides || {},
      tempAdmin: user.app_metadata?.tempAdmin  || false,
    }));

    hideLogin();
    updateUserDisplay(displayName, role);
  }

  // ── Update the top-bar user chip ──────────────────────────────
  function updateUserDisplay(name, role) {
    if (!userDisplay) return;
    const roleLabel = {
      admin:   'Admin',
      manager: 'Manager',
      l2:      'Associate L2',
      l1:      'Associate L1',
    }[role] || 'Associate';
    userDisplay.textContent = `${name} · ${roleLabel}`;
    userDisplay.hidden = false;
  }

  // ── Google login button ───────────────────────────────────────
  if (loginBtn) {
    loginBtn.addEventListener('click', () => {
      netlifyIdentity.open('login');
    });
  }

  // ── Logout ────────────────────────────────────────────────────
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      netlifyIdentity.logout();
    });
  }

  // ── Identity event listeners ──────────────────────────────────
  netlifyIdentity.on('login', (user) => {
    netlifyIdentity.close();
    applyUser(user);
  });

  netlifyIdentity.on('logout', () => {
    window.hcCurrentUser = null;
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(HC_USER_KEY);
    if (userDisplay) userDisplay.hidden = true;
    showLogin();
  });

  netlifyIdentity.on('error', (err) => {
    console.error('Netlify Identity error:', err);
  });

  // ── On page load — check if already logged in ─────────────────
  const existingUser = netlifyIdentity.currentUser();
  if (existingUser) {
    applyUser(existingUser);
  } else {
    // Check for persisted session
    try {
      const saved = localStorage.getItem(HC_USER_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Still show overlay — let Identity confirm the session
        // applyUser will fire via the 'login' event if token is valid
      }
    } catch (_) {}
    showLogin();
  }

})();
