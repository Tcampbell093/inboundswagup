/* =========================================================================
   prerender-nav.test.js — regression test for the pre-render nav CSS bug.

   Bug: index.html's synchronous pre-render script injected
   `.nav-btn[...]{display:none!important;}` based only on data.role. For an L1
   temp-admin it permanently hid admin nav (Settings/Attendance/Queue/Import
   Hub); access.js applyGuards() set hidden=false but the !important rule won,
   so computed display stayed `none`. It also broke positive module overrides.

   Fix: (a) pre-render recognizes an ACTIVE temp-admin and honors boolean
   overrides; (b) the injected <style> elements get stable ids
   (hc-prerender-nav-style / hc-prerender-group-style); (c) applyGuards removes
   them first, then applies hidden/aria-hidden as the sole authority.

   Proves:
     - L1 + active temp-admin -> full navigation
     - L1 + expired temp-admin -> restricted
     - positive module override -> visible after applyGuards
     - negative module override -> hidden
     - injected nav + group styles are removed after applyGuards
     - ordinary L1 / Manager / External / Admin unchanged
   Plus static guards on the real source. Run: node staging/prerender-nav.test.js
   ========================================================================= */

const fs = require('fs');
const path = require('path');

// ---- Allow-lists (mirror access.js) ----
const ROLE_ACCESS = {
  admin: ['all'],
  manager: ['homePage','attendancePage','workflowInboundPage','fulfillmentScanPage','returnsPage','cycleCountPage','inventoryPage','errorsPage','assemblyPage','queuePage','assemblyFlightTrackerPage','inboundFlightTrackerPage','overstockLookupPage','sordPage','calendarPage','productivityPage','policyPage','helpPage','importHubPage','historyPage'],
  l2: ['homePage','workflowInboundPage','fulfillmentScanPage','returnsPage','cycleCountPage','inventoryPage','assemblyPage','assemblyFlightTrackerPage','inboundFlightTrackerPage','calendarPage','policyPage','helpPage'],
  l1: ['homePage','workflowInboundPage','fulfillmentScanPage','returnsPage','cycleCountPage','inventoryPage','assemblyPage','assemblyFlightTrackerPage','inboundFlightTrackerPage','calendarPage','policyPage','helpPage'],
  external: ['assemblyFlightTrackerPage','inboundFlightTrackerPage','overstockLookupPage'],
};
const ALL_NAV_PAGES = ['homePage','importHubPage','attendancePage','workflowInboundPage','inboundFlightTrackerPage','overstockLookupPage','fulfillmentScanPage','returnsPage','cycleCountPage','inventoryPage','errorsPage','assemblyPage','queuePage','assemblyFlightTrackerPage','sordPage','calendarPage','productivityPage','policyPage','historyPage','helpPage','settingsPage'];
const GROUPS_TO_PAGES = {
  overview: ['homePage','importHubPage'],
  floor:    ['attendancePage','workflowInboundPage','inboundFlightTrackerPage','overstockLookupPage','fulfillmentScanPage','returnsPage','cycleCountPage','inventoryPage','errorsPage'],
  assembly: ['assemblyPage','queuePage','assemblyFlightTrackerPage'],
  ops:      ['sordPage','calendarPage','productivityPage','policyPage','historyPage'],
};
const norm = (r) => String(r || '').trim().toLowerCase();
function tempActive(s) {
  if (s.tempAdmin !== true) return false;
  if (!s.tempAdminExpiry) return true;
  const t = new Date(s.tempAdminExpiry).getTime();
  return isFinite(t) && t > Date.now();
}
function canAccess(s, page) {
  const ov = s.overrides || {};
  if (typeof ov[page] === 'boolean') return ov[page];
  if (tempActive(s)) return true;
  const list = ROLE_ACCESS[norm(s.role)] || ROLE_ACCESS.l1;
  return list.includes('all') || list.includes(page);
}

// ---- Tiny DOM model ----
function makeDom() {
  const buttons = {}; ALL_NAV_PAGES.forEach((p) => { buttons[p] = { hidden: false }; });
  return { head: [] /* [{id, hides:Set}] */, buttons };
}
// Mirrors the FIXED pre-render script.
function preRender(s, dom) {
  if (norm(s.role) === 'admin' || tempActive(s)) return; // inject nothing
  const ov = s.overrides || {};
  const allowed = ROLE_ACCESS[norm(s.role)] || ROLE_ACCESS.l1;
  const allowedPre = (p) => (typeof ov[p] === 'boolean' ? ov[p] : allowed.includes(p));
  const navHidden = new Set(ALL_NAV_PAGES.filter((p) => !allowedPre(p)));
  if (navHidden.size) dom.head.push({ id: 'hc-prerender-nav-style', hides: navHidden });
  const emptyGroups = Object.keys(GROUPS_TO_PAGES).filter((g) => !GROUPS_TO_PAGES[g].some(allowedPre));
  if (emptyGroups.length) dom.head.push({ id: 'hc-prerender-group-style', hidesGroups: new Set(emptyGroups) });
}
// Mirrors the FIXED applyGuards: remove pre-render styles, then set hidden.
function applyGuards(s, dom) {
  dom.head = dom.head.filter((st) => st.id !== 'hc-prerender-nav-style' && st.id !== 'hc-prerender-group-style');
  ALL_NAV_PAGES.forEach((p) => { dom.buttons[p].hidden = !canAccess(s, p); });
}
// Computed visibility: 'none' if the button is hidden OR a live pre-render style still hides it.
function navDisplay(dom, page) {
  if (dom.buttons[page].hidden) return 'none';
  for (const st of dom.head) { if (st.hides && st.hides.has(page)) return 'none'; }
  return 'block';
}
function hasStyle(dom, id) { return dom.head.some((st) => st.id === id); }

let fail = 0;
const chk = (name, cond) => { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name); if (!cond) fail++; };
const future = new Date(Date.now() + 30 * 864e5).toISOString();
const past   = new Date(Date.now() - 2 * 864e5).toISOString();

// 1. L1 + active temp-admin -> full navigation
{
  const s = { role: 'l1', tempAdmin: true, tempAdminExpiry: future };
  const dom = makeDom(); preRender(s, dom); applyGuards(s, dom);
  const adminNav = ['settingsPage', 'attendancePage', 'queuePage', 'importHubPage'];
  chk('1. L1 active temp-admin sees full admin nav',
    adminNav.every((p) => navDisplay(dom, p) === 'block') && !hasStyle(dom, 'hc-prerender-nav-style'));
}
// 2. L1 + expired temp-admin -> restricted
{
  const s = { role: 'l1', tempAdmin: true, tempAdminExpiry: past };
  const dom = makeDom(); preRender(s, dom); applyGuards(s, dom);
  chk('2. L1 expired temp-admin stays restricted',
    navDisplay(dom, 'settingsPage') === 'none' && navDisplay(dom, 'attendancePage') === 'none'
      && navDisplay(dom, 'cycleCountPage') === 'block');
}
// 3. Positive module override -> visible after applyGuards
{
  const s = { role: 'l1', overrides: { settingsPage: true } };
  const dom = makeDom(); preRender(s, dom);
  const preHidden = navDisplay(dom, 'settingsPage'); // pre-render should already allow it
  applyGuards(s, dom);
  chk('3. Positive override visible after applyGuards (and not pre-hidden)',
    navDisplay(dom, 'settingsPage') === 'block' && preHidden === 'block');
}
// 4. Negative module override -> hidden
{
  const s = { role: 'l1', overrides: { cycleCountPage: false } };
  const dom = makeDom(); preRender(s, dom); applyGuards(s, dom);
  chk('4. Negative override stays hidden', navDisplay(dom, 'cycleCountPage') === 'none');
}
// 5. Injected nav + group styles removed after applyGuards
{
  const s = { role: 'external' }; // external hides many pages + empty groups -> both styles injected
  const dom = makeDom(); preRender(s, dom);
  const injected = hasStyle(dom, 'hc-prerender-nav-style') && hasStyle(dom, 'hc-prerender-group-style');
  applyGuards(s, dom);
  chk('5. Pre-render nav + group styles injected then removed',
    injected && !hasStyle(dom, 'hc-prerender-nav-style') && !hasStyle(dom, 'hc-prerender-group-style'));
}
// 6. Ordinary roles unchanged
{
  const mk = (s) => { const d = makeDom(); preRender(s, d); applyGuards(s, d); return d; };
  const l1 = mk({ role: 'l1' });
  const mgr = mk({ role: 'manager' });
  const ext = mk({ role: 'external' });
  const adm = mk({ role: 'admin' });
  chk('6a. Ordinary L1: floor visible, settings hidden',
    navDisplay(l1, 'cycleCountPage') === 'block' && navDisplay(l1, 'homePage') === 'block' && navDisplay(l1, 'settingsPage') === 'none');
  chk('6b. Manager: management visible, settings hidden',
    navDisplay(mgr, 'attendancePage') === 'block' && navDisplay(mgr, 'productivityPage') === 'block' && navDisplay(mgr, 'settingsPage') === 'none');
  chk('6c. External: only flight trackers/overstock',
    navDisplay(ext, 'assemblyFlightTrackerPage') === 'block' && navDisplay(ext, 'overstockLookupPage') === 'block' && navDisplay(ext, 'homePage') === 'none' && navDisplay(ext, 'settingsPage') === 'none');
  chk('6d. Admin: everything visible, no pre-render style',
    ALL_NAV_PAGES.every((p) => navDisplay(adm, p) === 'block') && !hasStyle(adm, 'hc-prerender-nav-style'));
}

// ---- Static source guards ----
const root = path.resolve(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const accessJs  = fs.readFileSync(path.join(root, 'access.js'), 'utf8');
chk('index.html: nav style has stable id', /id\s*=\s*['"]hc-prerender-nav-style['"]|\.id\s*=\s*['"]hc-prerender-nav-style['"]/.test(indexHtml));
chk('index.html: group style has stable id', /hc-prerender-group-style/.test(indexHtml));
chk('index.html: pre-render recognizes active temp-admin', /data\.tempAdmin\s*===\s*true/.test(indexHtml) && /tempAdminExpiry/.test(indexHtml));
chk('index.html: pre-render honors overrides', /allowedPre/.test(indexHtml) && /overrides/.test(indexHtml));
chk('access.js: applyGuards removes both pre-render styles',
  /hc-prerender-nav-style/.test(accessJs) && /hc-prerender-group-style/.test(accessJs) && /getElementById/.test(accessJs) && /removeChild/.test(accessJs));

console.log('\n' + (fail === 0 ? 'ALL PASS' : fail + ' FAILED'));
if (fail) process.exit(1);
