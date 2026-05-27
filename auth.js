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
            const identityName = (user.user_metadata && (user.user_metadata.full_name || user.user_metadata.name)) || user.email;
            return fetch('/.netlify/functions/users?action=upsert', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: user.id, email: user.email, name: identityName })
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
