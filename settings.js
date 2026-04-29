/* =========================================================
   settings.js — Houston Control User Management
   Powers the Settings page admin panel
   ========================================================= */
(function () {
  'use strict';

  const USERS_API = '/.netlify/functions/users';

  // ── Helpers ───────────────────────────────────────────────
  function getToken() {
    try {
      const d = JSON.parse(localStorage.getItem('hcAuthUser') || '{}');
      return d.token || null;
    } catch(_) { return null; }
  }

  function authHeaders() {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getToken()}`
    };
  }

  function roleLabel(role) {
    return { admin: 'Admin', manager: 'Manager', l2: 'Associate L2', l1: 'Associate L1' }[role] || role;
  }

  function formatDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // ── State ─────────────────────────────────────────────────
  let allUsers = [];
  let selectedUserId = null;

  // ── DOM refs ──────────────────────────────────────────────
  function el(id) { return document.getElementById(id); }

  // ── Load users ────────────────────────────────────────────
  async function loadUsers() {
    const list = el('settingsUserList');
    if (!list) return;
    list.innerHTML = '<div style="text-align:center;padding:24px;color:var(--muted);">Loading users…</div>';

    try {
      const res = await fetch(`${USERS_API}?action=list`, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load users');
      allUsers = data.users || [];
      renderUserTable();
    } catch(e) {
      list.innerHTML = `<div style="text-align:center;padding:24px;color:#e55;">Error: ${e.message}</div>`;
    }
  }

  // ── Render user table ─────────────────────────────────────
  function renderUserTable() {
    const list = el('settingsUserList');
    if (!list) return;

    if (!allUsers.length) {
      list.innerHTML = '<div style="text-align:center;padding:24px;color:var(--muted);">No users found.</div>';
      return;
    }

    list.innerHTML = `
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead>
            <tr style="border-bottom:2px solid var(--blue2);text-align:left;">
              <th style="padding:10px 12px;font-weight:800;color:var(--muted);text-transform:uppercase;font-size:11px;letter-spacing:.06em;">Name / Email</th>
              <th style="padding:10px 12px;font-weight:800;color:var(--muted);text-transform:uppercase;font-size:11px;letter-spacing:.06em;">Role</th>
              <th style="padding:10px 12px;font-weight:800;color:var(--muted);text-transform:uppercase;font-size:11px;letter-spacing:.06em;">Status</th>
              <th style="padding:10px 12px;font-weight:800;color:var(--muted);text-transform:uppercase;font-size:11px;letter-spacing:.06em;">Last Login</th>
              <th style="padding:10px 12px;font-weight:800;color:var(--muted);text-transform:uppercase;font-size:11px;letter-spacing:.06em;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${allUsers.map(u => `
              <tr style="border-bottom:1px solid var(--blue2);${u.suspended ? 'opacity:.5;' : ''}">
                <td style="padding:12px;">
                  <div style="font-weight:700;">${u.name || '—'}</div>
                  <div style="color:var(--muted);font-size:12px;">${u.email}</div>
                  ${u.tempAdmin ? `<div style="font-size:11px;color:#f5a623;font-weight:700;margin-top:2px;">⚡ Temp Admin${u.tempAdminExpiry ? ' · expires ' + formatDate(u.tempAdminExpiry) : ''}</div>` : ''}
                </td>
                <td style="padding:12px;">
                  <span style="background:var(--blue1);border:1px solid var(--blue2);border-radius:999px;padding:3px 10px;font-size:12px;font-weight:700;">${roleLabel(u.role)}</span>
                </td>
                <td style="padding:12px;">
                  <span style="color:${u.suspended ? '#e55' : '#2ecc71'};font-weight:700;font-size:12px;">
                    ${u.suspended ? '⛔ Suspended' : '✓ Active'}
                  </span>
                </td>
                <td style="padding:12px;color:var(--muted);font-size:12px;">${formatDate(u.lastLogin)}</td>
                <td style="padding:12px;">
                  <button class="btn secondary" style="font-size:12px;padding:5px 12px;" onclick="window.hcSettings.openUserDrawer('${u.id}')">
                    Edit
                  </button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  // ── User drawer ───────────────────────────────────────────
  function openUserDrawer(userId) {
    const user = allUsers.find(u => u.id === userId);
    if (!user) return;
    selectedUserId = userId;

    const drawer = el('settingsUserDrawer');
    const content = el('settingsUserDrawerContent');
    if (!drawer || !content) return;

    const moduleOverrides = [
      { key: 'workflowInboundPage', label: 'QA Inbound' },
      { key: 'fulfillmentScanPage', label: 'Fulfillment Scan-Out' },
      { key: 'returnsPage', label: 'Returns' },
      { key: 'cycleCountPage', label: 'Cycle Count' },
      { key: 'assemblyPage', label: 'Assembly Planner' },
      { key: 'assemblyFlightTrackerPage', label: 'Flight Tracker' },
      { key: 'calendarPage', label: 'Calendar' },
      { key: 'policyPage', label: 'Policy & SOPs' },
      { key: 'huddlePage', label: 'Daily Brief' },
      { key: 'attendancePage', label: 'Attendance' },
      { key: 'queuePage', label: 'Pack Builder Queue' },
      { key: 'errorsPage', label: 'Error Log' },
      { key: 'sordPage', label: 'Daily Tools Dossier' },
      { key: 'productivityPage', label: 'Productivity' },
      { key: 'importHubPage', label: 'Import Hub' },
    ];

    content.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;">
        <div>
          <div style="font-weight:800;font-size:17px;">${user.name || user.email}</div>
          <div style="color:var(--muted);font-size:13px;">${user.email}</div>
        </div>
        <button class="btn secondary" style="font-size:12px;padding:5px 12px;" onclick="document.getElementById('settingsUserDrawer').hidden=true">✕ Close</button>
      </div>

      <!-- Role -->
      <div style="margin-bottom:20px;">
        <label style="font-size:12px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;display:block;margin-bottom:8px;">Base Role</label>
        <select id="drawerRole" style="width:100%;padding:10px;border-radius:8px;border:1px solid var(--blue2);background:var(--blue1);font-size:14px;font-weight:700;">
          <option value="l1" ${user.role==='l1'?'selected':''}>Associate L1</option>
          <option value="l2" ${user.role==='l2'?'selected':''}>Associate L2</option>
          <option value="manager" ${user.role==='manager'?'selected':''}>Manager</option>
          <option value="admin" ${user.role==='admin'?'selected':''}>Admin</option>
        </select>
      </div>

      <!-- Module overrides -->
      <div style="margin-bottom:20px;">
        <label style="font-size:12px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;display:block;margin-bottom:8px;">Module Overrides <span style="font-weight:400;text-transform:none;">(overrides base role)</span></label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          ${moduleOverrides.map(m => {
            const override = user.overrides?.[m.key];
            const checked = override === true ? 'checked' : '';
            const denied  = override === false ? 'checked' : '';
            return `
              <div style="background:var(--blue1);border:1px solid var(--blue2);border-radius:8px;padding:10px 12px;display:flex;align-items:center;justify-content:space-between;gap:8px;">
                <span style="font-size:13px;font-weight:600;">${m.label}</span>
                <select data-override="${m.key}" style="font-size:12px;padding:4px 6px;border-radius:6px;border:1px solid var(--blue2);background:var(--bg);">
                  <option value="" ${!override && override!==false?'selected':''}>Default</option>
                  <option value="true" ${override===true?'selected':''}>✓ Allow</option>
                  <option value="false" ${override===false?'selected':''}>✕ Deny</option>
                </select>
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <!-- Temp Admin -->
      <div style="margin-bottom:20px;background:var(--blue1);border:1px solid var(--blue2);border-radius:10px;padding:16px;">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
          <input type="checkbox" id="drawerTempAdmin" ${user.tempAdmin?'checked':''} style="width:16px;height:16px;cursor:pointer;">
          <label for="drawerTempAdmin" style="font-size:14px;font-weight:700;cursor:pointer;">⚡ Grant Temp Admin</label>
        </div>
        <div>
          <label style="font-size:12px;font-weight:700;color:var(--muted);display:block;margin-bottom:6px;">Expiry Date</label>
          <input type="date" id="drawerTempAdminExpiry" value="${user.tempAdminExpiry ? user.tempAdminExpiry.split('T')[0] : ''}" style="padding:8px;border-radius:8px;border:1px solid var(--blue2);background:var(--bg);font-size:13px;width:100%;">
        </div>
      </div>

      <!-- Suspend -->
      <div style="margin-bottom:24px;background:${user.suspended?'#fff5f5':'var(--blue1)'};border:1px solid ${user.suspended?'#ffc0c0':'var(--blue2)'};border-radius:10px;padding:16px;display:flex;align-items:center;gap:12px;">
        <input type="checkbox" id="drawerSuspended" ${user.suspended?'checked':''} style="width:16px;height:16px;cursor:pointer;">
        <label for="drawerSuspended" style="font-size:14px;font-weight:700;cursor:pointer;color:${user.suspended?'#e55':'inherit'};">⛔ Suspend Account</label>
      </div>

      <!-- Save -->
      <div style="display:flex;gap:10px;">
        <button class="btn" id="drawerSaveBtn" onclick="window.hcSettings.saveUser()" style="flex:1;">Save Changes</button>
        <button class="btn secondary" onclick="document.getElementById('settingsUserDrawer').hidden=true" style="flex:1;">Cancel</button>
      </div>
      <div id="drawerStatus" style="margin-top:12px;font-size:13px;text-align:center;min-height:20px;"></div>
    `;

    drawer.hidden = false;
  }

  // ── Save user changes ─────────────────────────────────────
  async function saveUser() {
    const user = allUsers.find(u => u.id === selectedUserId);
    if (!user) return;

    const statusEl = el('drawerStatus');
    if (statusEl) statusEl.textContent = 'Saving…';

    const role = el('drawerRole')?.value || user.role;
    const tempAdmin = el('drawerTempAdmin')?.checked || false;
    const tempAdminExpiry = el('drawerTempAdminExpiry')?.value
      ? new Date(el('drawerTempAdminExpiry').value).toISOString()
      : null;
    const suspended = el('drawerSuspended')?.checked || false;

    // Collect overrides
    const overrides = {};
    document.querySelectorAll('[data-override]').forEach(sel => {
      const key = sel.getAttribute('data-override');
      if (sel.value === 'true')  overrides[key] = true;
      if (sel.value === 'false') overrides[key] = false;
    });

    try {
      const res = await fetch(`${USERS_API}?action=update`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          userId:    selectedUserId,
          targetEmail: user.email,
          role, overrides, suspended, tempAdmin, tempAdminExpiry,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');

      if (statusEl) statusEl.innerHTML = '<span style="color:#2ecc71;">✓ Saved successfully</span>';

      // Refresh user list
      await loadUsers();

      // Close drawer after short delay
      setTimeout(() => {
        const drawer = el('settingsUserDrawer');
        if (drawer) drawer.hidden = true;
      }, 1200);

    } catch(e) {
      if (statusEl) statusEl.innerHTML = `<span style="color:#e55;">Error: ${e.message}</span>`;
    }
  }

  // ── Invite user modal ─────────────────────────────────────
  function openInviteModal() {
    const modal = el('settingsInviteModal');
    if (modal) modal.hidden = false;
  }

  async function sendInvite() {
    const email = el('inviteEmail')?.value?.trim();
    const role  = el('inviteRole')?.value || 'l1';
    const statusEl = el('inviteStatus');

    if (!email) {
      if (statusEl) statusEl.innerHTML = '<span style="color:#e55;">Email is required</span>';
      return;
    }

    if (statusEl) statusEl.textContent = 'Sending invite…';

    try {
      const res = await fetch(`${USERS_API}?action=invite`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ email, role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Invite failed');

      if (statusEl) statusEl.innerHTML = '<span style="color:#2ecc71;">✓ Invite sent!</span>';
      if (el('inviteEmail')) el('inviteEmail').value = '';

      await loadUsers();
      setTimeout(() => {
        const modal = el('settingsInviteModal');
        if (modal) modal.hidden = true;
        if (statusEl) statusEl.textContent = '';
      }, 1500);

    } catch(e) {
      if (statusEl) statusEl.innerHTML = `<span style="color:#e55;">Error: ${e.message}</span>`;
    }
  }

  // ── Load audit log ────────────────────────────────────────
  async function loadAuditLog() {
    const logEl = el('settingsAuditLog');
    if (!logEl) return;
    logEl.innerHTML = '<div style="text-align:center;padding:16px;color:var(--muted);">Loading…</div>';

    try {
      const res = await fetch(`${USERS_API}?action=audit`, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load audit log');

      if (!data.entries?.length) {
        logEl.innerHTML = '<div style="text-align:center;padding:16px;color:var(--muted);">No audit entries yet.</div>';
        return;
      }

      logEl.innerHTML = `
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead>
            <tr style="border-bottom:2px solid var(--blue2);text-align:left;">
              <th style="padding:8px 12px;font-weight:800;color:var(--muted);font-size:11px;text-transform:uppercase;">When</th>
              <th style="padding:8px 12px;font-weight:800;color:var(--muted);font-size:11px;text-transform:uppercase;">Actor</th>
              <th style="padding:8px 12px;font-weight:800;color:var(--muted);font-size:11px;text-transform:uppercase;">Target</th>
              <th style="padding:8px 12px;font-weight:800;color:var(--muted);font-size:11px;text-transform:uppercase;">Action</th>
            </tr>
          </thead>
          <tbody>
            ${data.entries.map(e => `
              <tr style="border-bottom:1px solid var(--blue2);">
                <td style="padding:8px 12px;color:var(--muted);font-size:12px;">${formatDate(e.created_at)}</td>
                <td style="padding:8px 12px;font-weight:600;">${e.actor}</td>
                <td style="padding:8px 12px;">${e.target}</td>
                <td style="padding:8px 12px;">
                  <span style="background:var(--blue1);border:1px solid var(--blue2);border-radius:999px;padding:2px 8px;font-size:11px;font-weight:700;">${e.action}</span>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    } catch(e) {
      logEl.innerHTML = `<div style="text-align:center;padding:16px;color:#e55;">Error: ${e.message}</div>`;
    }
  }

  // ── Auto-load when Settings page becomes active ───────────
  function watchForSettingsPage() {
    const observer = new MutationObserver(function() {
      const page = document.getElementById('settingsPage');
      if (page && page.classList.contains('active')) {
        const user = window.hcCurrentUser;
        if (user && ['admin', 'manager'].includes(user.role)) {
          loadUsers();
          loadAuditLog();
        }
      }
    });
    observer.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['class'] });
  }

  // ── Expose publicly ───────────────────────────────────────
  window.hcSettings = {
    loadUsers,
    loadAuditLog,
    openUserDrawer,
    saveUser,
    openInviteModal,
    sendInvite,
  };

  // ── Init ──────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', watchForSettingsPage);
  } else {
    watchForSettingsPage();
  }

})();
