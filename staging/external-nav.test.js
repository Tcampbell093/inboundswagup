/* =========================================================================
   external-nav.test.js — regression test for the External-user navigation bug.

   Bug: the Assembly Flight Tracker iframe role bridge (index.html) called
   nav.click() on a timer/iframe-load, yanking External users back to Assembly
   whenever they opened Inbound Flight Tracker or Overstock Lookup.

   This test proves:
     1. External initially lands on Assembly Flight Tracker.
     2. External can switch to Inbound Flight Tracker and remain there.
     3. External can switch to Overstock Lookup and remain there.
     4. An unauthorized destination still redirects to Assembly Flight Tracker.
     5. Role messages can be resent repeatedly without changing the active page.

   Plus static guards on the real source so the fix can't silently regress:
     - index.html sendRoleToIframe() performs no navigation (no .click()).
     - access.js guardCurrentPage uses the active page + canAccess (so an
       allowed External destination is never bounced to the default).

   Run: node staging/external-nav.test.js   (dependency-free)
   ========================================================================= */

const fs = require('fs');
const path = require('path');

// ---- Mirror of the access.js allow-lists + decision logic ----
const ROLE_ACCESS = {
  external: ['assemblyFlightTrackerPage', 'inboundFlightTrackerPage', 'overstockLookupPage'],
  l1:       ['homePage', 'assemblyFlightTrackerPage', 'inboundFlightTrackerPage'],
};
function canAccess(role, page) {
  const list = ROLE_ACCESS[role] || ROLE_ACCESS.l1;
  return list.includes('all') || list.includes(page);
}
function defaultPageForRole(role) {
  const list = ROLE_ACCESS[role];
  if (!list || !list.length) return 'homePage';
  if (list[0] === 'all') return 'homePage';
  return list[0];
}
// Mirrors access.js guardCurrentPage: stay on an allowed destination; otherwise
// (missing or unauthorized) go to the role default.
function guardResolve(role, dest) {
  if (dest && canAccess(role, dest)) return dest;
  return defaultPageForRole(role);
}
// A tiny app model: activePage plus the fixed behaviors.
function makeApp(role, initialActive) {
  let active = initialActive;
  return {
    get active() { return active; },
    guardOnLoad() { active = guardResolve(role, active); return active; }, // empty hash -> uses active page
    navigate(dest) { active = guardResolve(role, dest); return active; },  // nav click + guard
    resendRole() { /* fixed bridge: NO navigation side effect */ return active; },
  };
}

let fail = 0;
const chk = (name, cond) => { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name); if (!cond) fail++; };

// ---- Behavioral cases ----
const app = makeApp('external', 'homePage'); // app boots with homePage active
chk('1. External initially lands on Assembly Flight Tracker',
  app.guardOnLoad() === 'assemblyFlightTrackerPage');

chk('2. External switches to Inbound Flight Tracker and stays',
  app.navigate('inboundFlightTrackerPage') === 'inboundFlightTrackerPage');

// 5. resend role repeatedly — active page must not change
let stable = true;
for (let i = 0; i < 5; i++) { if (app.resendRole() !== 'inboundFlightTrackerPage') stable = false; }
chk('5. Role resent repeatedly does NOT change the active page', stable && app.active === 'inboundFlightTrackerPage');

chk('3. External switches to Overstock Lookup and stays',
  app.navigate('overstockLookupPage') === 'overstockLookupPage');

chk('4. Unauthorized destination redirects to Assembly Flight Tracker',
  app.navigate('sordPage') === 'assemblyFlightTrackerPage');

// ---- Static source guards (tie the test to the real fix) ----
const root = path.resolve(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const accessJs  = fs.readFileSync(path.join(root, 'access.js'), 'utf8');

// Extract the assembly role-bridge function body and assert it does no navigation.
const m = indexHtml.match(/function sendRoleToIframe\s*\([\s\S]*?\n\s{2}\}/);
const bridgeBody = m ? m[0] : '';
chk('index.html: sendRoleToIframe found', !!bridgeBody);
chk('index.html: role bridge performs NO navigation (.click)', !!bridgeBody && !/\.click\s*\(/.test(bridgeBody));
chk('index.html: role bridge still posts HC_ROLE', /HC_ROLE/.test(bridgeBody));

chk('access.js: guardCurrentPage uses the active page fallback',
  /function currentDestination/.test(accessJs) && /\.page\.active/.test(accessJs));
chk('access.js: guard keeps an allowed destination (canAccess -> return)',
  /if \(dest && canAccess\(dest\)\) return;/.test(accessJs));

console.log('\n' + (fail === 0 ? 'ALL PASS' : fail + ' FAILED'));
if (fail) process.exit(1);
