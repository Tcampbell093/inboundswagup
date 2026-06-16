/* =========================================================
   settings.js — Houston Control User Management
   Powers the Settings page admin panel
   ========================================================= */
(function () {
  'use strict';

  const USERS_API = '/.netlify/functions/users';

  // HTML-escape for error/status text rendered into innerHTML.
  function stEsc(v){return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');}

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
    return { admin: 'Admin', manager: 'Manager', l2: 'Associate L2', l1: 'Associate L1', external: 'External' }[role] || role;
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
      list.innerHTML = `<div style="text-align:center;padding:24px;color:#e55;">Error: ${stEsc(e.message)}</div>`;
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
      { key: 'inboundFlightTrackerPage', label: 'Inbound Flight Tracker' },
      { key: 'overstockLookupPage', label: 'Overstock Lookup' },
      { key: 'fulfillmentScanPage', label: 'Fulfillment Scan-Out' },
      { key: 'returnsPage', label: 'Returns' },
      { key: 'cycleCountPage', label: 'Cycle Count' },
      { key: 'inventoryPage', label: 'Inventory' },
      { key: 'assemblyPage', label: 'Assembly Planner' },
      { key: 'assemblyFlightTrackerPage', label: 'Assembly Flight Tracker' },
      { key: 'queuePage', label: 'Pack Builder Queue' },
      { key: 'calendarPage', label: 'Calendar' },
      { key: 'policyPage', label: 'Policy & SOPs' },
      { key: 'attendancePage', label: 'Attendance' },
      { key: 'errorsPage', label: 'Error Log' },
      { key: 'sordPage', label: 'Daily Tools Dossier' },
      { key: 'productivityPage', label: 'Productivity' },
      { key: 'importHubPage', label: 'Import Hub' },
      { key: 'historyPage', label: 'History Log' },
      { key: 'helpPage', label: 'Help & Guide' },
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
        <select id="drawerRole" style="width:100%;padding:10px;border-radius:8px;border:1px solid var(--blue2);background:#fff;color:#0f172a;font-size:14px;font-weight:700;">
          <option value="l1" ${user.role==='l1'?'selected':''}>Associate L1</option>
          <option value="l2" ${user.role==='l2'?'selected':''}>Associate L2</option>
          <option value="manager" ${user.role==='manager'?'selected':''}>Manager</option>
          <option value="admin" ${user.role==='admin'?'selected':''}>Admin</option>
          <option value="external" ${user.role==='external'?'selected':''}>External</option>
        </select>
      </div>

      <!-- Module overrides -->
      <div style="margin-bottom:20px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;gap:8px;">
          <label style="font-size:12px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;">Module Overrides <span style="font-weight:400;text-transform:none;">(overrides base role)</span></label>
          ${Object.keys(user.overrides || {}).length > 0 ? `
            <button type="button" onclick="window.hcSettings.clearAllOverrides()" style="font-size:11px;font-weight:700;padding:5px 10px;border-radius:6px;border:1px solid #fecaca;background:#fff;color:#991b1b;cursor:pointer;">Clear all overrides</button>
          ` : ''}
        </div>
        ${(() => {
          // Detect stale overrides — keys saved in the DB that don't appear in
          // our moduleOverrides UI list. These are usually leftover from a
          // previous version. Surface them so the user knows they exist.
          const knownKeys = new Set(moduleOverrides.map(m => m.key));
          const staleKeys = Object.keys(user.overrides || {}).filter(k => !knownKeys.has(k));
          if (staleKeys.length === 0) return '';
          return `
            <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:10px 12px;margin-bottom:10px;font-size:12px;color:#854d0e;">
              <strong>⚠️ Stale overrides found:</strong> ${staleKeys.map(k => `<code style="background:#fef3c7;padding:1px 5px;border-radius:4px;">${k}: ${user.overrides[k]}</code>`).join(' ')}
              <br><span style="font-size:11px;">These keys aren't in the current UI. Click "Clear all overrides" to remove them, or save the drawer to keep them as-is.</span>
            </div>
          `;
        })()}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          ${moduleOverrides.map(m => {
            const override = user.overrides?.[m.key];
            return `
              <div style="background:var(--blue1);border:1px solid var(--blue2);border-radius:8px;padding:10px 12px;display:flex;align-items:center;justify-content:space-between;gap:8px;">
                <span style="font-size:13px;font-weight:600;">${m.label}</span>
                <select data-override="${m.key}" style="font-size:12px;font-weight:700;padding:4px 6px;border-radius:6px;border:1px solid var(--blue2);background:#fff;color:#0f172a;">
                  <option value="" ${override!==true && override!==false?'selected':''}>Default</option>
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
          <input type="date" id="drawerTempAdminExpiry" value="${user.tempAdminExpiry ? user.tempAdminExpiry.split('T')[0] : ''}" style="padding:8px;border-radius:8px;border:1px solid var(--blue2);background:#fff;color:#0f172a;font-size:13px;width:100%;">
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

      <!-- Danger zone: permanent account removal -->
      <div style="margin-top:24px;padding-top:16px;border-top:1px solid #fee2e2;">
        <div style="font-size:11px;font-weight:800;color:#991b1b;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px;">Danger zone</div>
        <button class="btn" id="drawerDeleteBtn" onclick="window.hcSettings.deleteUser()" style="width:100%;background:#fff;color:#991b1b;border:1px solid #fecaca;font-weight:700;">🗑️ Delete Account Permanently</button>
        <p style="font-size:11px;color:#64748b;margin:8px 0 0;line-height:1.4;">Removes the user from Houston Control entirely. They can no longer sign in. This is recoverable only by re-inviting them.</p>
      </div>
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
      if (statusEl) statusEl.innerHTML = `<span style="color:#e55;">Error: ${stEsc(e.message)}</span>`;
    }
  }

  // ── Clear all module overrides ────────────────────────────
  // Sets every override <select> to "Default" so the next saveUser writes
  // an empty overrides object, removing any stale or unwanted denials.
  function clearAllOverrides() {
    document.querySelectorAll('[data-override]').forEach(sel => { sel.value = ''; });
    const statusEl = el('drawerStatus');
    if (statusEl) statusEl.innerHTML = '<span style="color:#64748b;font-size:12px;">All overrides cleared. Click <strong>Save Changes</strong> to commit.</span>';
  }

  // ── Delete user (permanent) ───────────────────────────────
  // Removes the user's row from hc_users on the backend. They lose access
  // immediately. Recoverable only by re-inviting them via the invite flow.
  async function deleteUser() {
    const user = allUsers.find(u => u.id === selectedUserId);
    if (!user) return;

    const displayName = user.name || user.email;
    // Double-confirm — this is destructive and not recoverable without a re-invite
    if (!confirm(`Delete ${displayName} permanently?\n\nThis removes their access entirely. They can no longer sign in to Houston Control. The only way to restore access is to re-invite them.\n\nProceed?`)) return;

    const statusEl = el('drawerStatus');
    if (statusEl) statusEl.textContent = 'Deleting…';

    try {
      const res = await fetch(`${USERS_API}?action=delete`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ targetEmail: user.email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Delete failed');

      if (statusEl) statusEl.innerHTML = `<span style="color:#2ecc71;">✓ Account deleted</span>`;

      // Refresh + close drawer
      await loadUsers();
      setTimeout(() => {
        const drawer = el('settingsUserDrawer');
        if (drawer) drawer.hidden = true;
      }, 800);

    } catch (e) {
      if (statusEl) statusEl.innerHTML = `<span style="color:#e55;">Error: ${stEsc(e.message)}</span>`;
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

      // identityCreated === false means the in-app (hc_users) invite saved but
      // auto-adding them to Netlify Identity didn't complete — surface it so the
      // admin can do the one-off Netlify invite as a fallback.
      const identityFailed = data.identityCreated === false;
      if (statusEl) {
        statusEl.innerHTML = identityFailed
          ? `<span style="color:#e0a020;">✓ Invited in-app — but couldn't auto-add to Netlify Identity (${data.identityWarning || 'unknown'}). They may need a manual Netlify invite.</span>`
          : '<span style="color:#2ecc71;">✓ Invited — they can sign in with Google.</span>';
      }
      if (el('inviteEmail')) el('inviteEmail').value = '';

      await loadUsers();
      setTimeout(() => {
        const modal = el('settingsInviteModal');
        if (modal) modal.hidden = true;
        if (statusEl) statusEl.textContent = '';
      }, identityFailed ? 5000 : 1800);

    } catch(e) {
      if (statusEl) statusEl.innerHTML = `<span style="color:#e55;">Error: ${stEsc(e.message)}</span>`;
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
      logEl.innerHTML = `<div style="text-align:center;padding:16px;color:#e55;">Error: ${stEsc(e.message)}</div>`;
    }
  }

  // ── Build info display ────────────────────────────────────
  function renderBuildInfo() {
    const info = window.__BUILD_INFO || {};
    const shaEl = el('appInfoBuildSha');
    const branchEl = el('appInfoBuildBranch');
    const timeEl = el('appInfoBuildTime');
    if (shaEl) shaEl.textContent = info.sha ? String(info.sha).slice(0, 7) : 'unknown';
    if (branchEl) branchEl.textContent = info.branch || 'unknown';
    if (timeEl) {
      timeEl.textContent = info.builtAt
        ? new Date(info.builtAt).toLocaleString()
        : 'unknown';
    }
  }

  // ── Export all locally-stored Ops Hub data ────────────────
  function exportAllData() {
    const snapshot = { exportedAt: new Date().toISOString(), version: window.__BUILD_INFO || null, data: {} };
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith('ops_hub_')) continue;
      const raw = localStorage.getItem(key);
      try {
        snapshot.data[key] = JSON.parse(raw);
      } catch (_) {
        snapshot.data[key] = raw;
      }
    }
    const keyCount = Object.keys(snapshot.data).length;
    if (!keyCount) {
      alert('No Ops Hub data found in this browser to export.');
      return;
    }
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ops-hub-backup-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ── Auto-load when Settings page becomes active ───────────
  function watchForSettingsPage() {
    const observer = new MutationObserver(function() {
      const page = document.getElementById('settingsPage');
      if (page && page.classList.contains('active')) {
        renderBuildInfo();
        const user = window.hcCurrentUser;
        if (user && ['admin', 'manager'].includes(user.role)) {
          loadUsers();
          loadAuditLog();
        }
      }
    });
    observer.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['class'] });
  }

  // ── Language toggle (Settings card) ───────────────────────
  function bindLanguageToggle() {
    var card = document.getElementById('settingsLangToggle');
    if (!card || card.dataset.bound === '1') return;
    card.dataset.bound = '1';
    function syncActive() {
      var lang = (window.HC_I18N && window.HC_I18N.getLang && window.HC_I18N.getLang()) || 'en';
      card.querySelectorAll('.hc-lang-btn').forEach(function (b) {
        b.classList.toggle('active', b.getAttribute('data-lang') === lang);
      });
    }
    card.addEventListener('click', function (e) {
      var btn = e.target.closest('.hc-lang-btn');
      if (!btn) return;
      var lang = btn.getAttribute('data-lang');
      if (!lang || !window.HC_I18N) return;
      window.HC_I18N.setLang(lang);
      syncActive();
    });
    if (window.HC_I18N && window.HC_I18N.onChange) {
      window.HC_I18N.onChange(syncActive);
    }
    syncActive();
  }

  // ── Expose publicly ───────────────────────────────────────
  window.hcSettings = {
    loadUsers,
    loadAuditLog,
    openUserDrawer,
    saveUser,
    deleteUser,
    clearAllOverrides,
    openInviteModal,
    sendInvite,
    exportAllData,
    bindLanguageToggle,
  };

  // ── Init ──────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      watchForSettingsPage();
      bindLanguageToggle();
    });
  } else {
    watchForSettingsPage();
    bindLanguageToggle();
  }

})();
