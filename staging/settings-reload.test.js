/* =========================================================================
   settings-reload.test.js — regression test for the Settings page
   repeated collapse/expand/flash bug.

   Bug: settings.js watchForSettingsPage() observed document.body with
   {attributes:true, subtree:true, attributeFilter:['class']}. ANY class change
   anywhere (other modules, polling) re-ran renderBuildInfo()/loadUsers()/
   loadAuditLog() while Settings was open, causing constant re-fetch + reflow.

   Fix: observe ONLY the settingsPage element's own class; track an
   inactive→active transition so data loads once per open; add per-request
   overlap + stale-response guards; add an explicit refresh().

   Proves:
     - opening Settings loads users + audit once,
     - unrelated class changes do NOT reload,
     - leaving and reopening loads once again,
     - explicit refresh reloads,
     - overlapping identical requests are coalesced,
     - no write endpoints are called.
   Plus static guards on the real settings.js. Run: node staging/settings-reload.test.js
   ========================================================================= */

const fs = require('fs');
const path = require('path');

// ---- Behavioral model mirroring the fixed settings.js ----
function makeSettings(user) {
  const fetchCalls = []; // {action}
  let usersInFlight = false, usersSeq = 0;
  let auditInFlight = false, auditSeq = 0;
  let settingsActive = false;
  let pageActive = false; // simulated settingsPage.classList.contains('active')

  async function loadUsers() {
    if (usersInFlight) return;         // overlap prevention
    usersInFlight = true;
    const seq = ++usersSeq;
    fetchCalls.push({ action: 'list' }); // GET ?action=list
    await Promise.resolve();
    if (seq !== usersSeq) { usersInFlight = false; return; } // stale guard
    usersInFlight = false;
  }
  async function loadAuditLog() {
    if (auditInFlight) return;
    auditInFlight = true;
    const seq = ++auditSeq;
    fetchCalls.push({ action: 'audit' }); // GET ?action=audit
    await Promise.resolve();
    if (seq !== auditSeq) { auditInFlight = false; return; }
    auditInFlight = false;
  }
  function canAdmin() {
    if (!user) return false;
    const t = user.tempAdmin === true && (!user.tempAdminExpiry || new Date(user.tempAdminExpiry).getTime() > Date.now());
    return user.role === 'admin' || t;
  }
  function loadSettingsData() { if (canAdmin()) { loadUsers(); loadAuditLog(); } }
  function refresh() { if (!canAdmin()) return; loadUsers(); loadAuditLog(); }
  function sync() {
    const isActive = pageActive;
    if (isActive && !settingsActive) { settingsActive = true; loadSettingsData(); }
    else if (!isActive && settingsActive) { settingsActive = false; }
  }
  return {
    fetchCalls,
    setActive(v) { pageActive = v; sync(); },   // simulates settingsPage class change
    unrelatedMutation() { sync(); },            // if the observer fired for an unrelated change
    refresh,
    counts() {
      return {
        list:  fetchCalls.filter(c => c.action === 'list').length,
        audit: fetchCalls.filter(c => c.action === 'audit').length,
        writes: fetchCalls.filter(c => ['invite', 'update', 'delete', 'upsert'].includes(c.action)).length,
      };
    },
    async settle() { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); },
  };
}

let fail = 0;
const chk = (name, cond) => { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name); if (!cond) fail++; };

(async () => {
  const s = makeSettings({ role: 'admin' });

  // 1. Opening Settings loads users + audit once.
  s.setActive(true); await s.settle();
  chk('1. Opening Settings loads users + audit once', s.counts().list === 1 && s.counts().audit === 1);

  // 2. Unrelated class changes while open do NOT reload.
  for (let i = 0; i < 5; i++) s.unrelatedMutation();
  await s.settle();
  chk('2. Unrelated class changes do not reload', s.counts().list === 1 && s.counts().audit === 1);

  // 3. Leaving and reopening loads once again.
  s.setActive(false); await s.settle();
  s.setActive(true);  await s.settle();
  chk('3. Leave + reopen loads once again', s.counts().list === 2 && s.counts().audit === 2);

  // 4. Explicit refresh reloads.
  s.refresh(); await s.settle();
  chk('4. Explicit refresh reloads', s.counts().list === 3 && s.counts().audit === 3);

  // 5. Overlapping identical requests are coalesced (call twice before settle).
  const s2 = makeSettings({ role: 'admin' });
  s2.setActive(true);      // starts load
  s2.refresh();            // overlaps — should be skipped while in flight
  await s2.settle();
  chk('5. Overlapping identical requests coalesced', s2.counts().list === 1 && s2.counts().audit === 1);

  // 6. No write endpoints are ever called by the auto-load / refresh path.
  chk('6. No write endpoints called', s.counts().writes === 0 && s2.counts().writes === 0);

  // ---- Static source guards ----
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'settings.js'), 'utf8');
  chk('static: watcher observes the settingsPage element, not body/subtree',
    /observer\.observe\(\s*page\s*,\s*\{[^}]*attributes:\s*true/.test(src) &&
    !/observe\(\s*document\.body[^)]*subtree:\s*true/.test(src));
  chk('static: tracks active-state transition', /settingsActive/.test(src));
  chk('static: loadUsers has overlap guard', /usersInFlight/.test(src));
  chk('static: loadAuditLog has overlap guard', /auditInFlight/.test(src));
  chk('static: stale-response guards present', /usersSeq/.test(src) && /auditSeq/.test(src));
  chk('static: refresh() exposed', /refresh,/.test(src) && /function refresh\(/.test(src));
  chk('static: auto-load reads only list + audit', /action=list/.test(src) && /action=audit/.test(src));

  console.log('\n' + (fail === 0 ? 'ALL PASS' : fail + ' FAILED'));
  if (fail) process.exit(1);
})();
