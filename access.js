/* =========================================================
   access.js — Houston Control Role-Based Access Control
   Reads hcCurrentUser from auth.js and hides nav items
   the current user doesn't have access to.
   ========================================================= */

(function () {
  'use strict';

  // ── Role definitions ────────────────────────────────────────
  // Each role lists the pages it can access.
  // 'all' means full access to everything.
  // Pages not listed are hidden from that role.

  const ROLE_ACCESS = {
    admin:   ['all'],
    manager: [
      'homePage',
      'attendancePage', 'workflowInboundPage', 'fulfillmentScanPage',
      'returnsPage', 'cycleCountPage', 'inventoryPage', 'errorsPage',
      'assemblyPage', 'queuePage', 'assemblyFlightTrackerPage',
      'inboundFlightTrackerPage', 'overstockLookupPage',
      'sordPage', 'calendarPage', 'productivityPage', 'policyPage',
      'helpPage', 'importHubPage', 'historyPage'
    ],
    l2: [
      'homePage',
      'workflowInboundPage', 'fulfillmentScanPage',
      'returnsPage', 'cycleCountPage', 'inventoryPage',
      'assemblyPage', 'assemblyFlightTrackerPage',
      'inboundFlightTrackerPage',
      'calendarPage', 'policyPage', 'helpPage'
    ],
    l1: [
      'homePage',
      'workflowInboundPage', 'fulfillmentScanPage',
      'returnsPage', 'cycleCountPage', 'inventoryPage',
      'assemblyPage', 'assemblyFlightTrackerPage',
      'inboundFlightTrackerPage',
      'calendarPage', 'policyPage', 'helpPage'
    ],
    external: [
      // External users land directly on a flight tracker — they don't
      // need (or have access to) the home page. The first item in this
      // list is treated as their default landing page.
      'assemblyFlightTrackerPage',
      'inboundFlightTrackerPage',
      'overstockLookupPage'
    ],
  };

  // Read-only access (can see page but certain actions are disabled)
  // Reserved for future use — currently informational only
  const READ_ONLY = {
    manager: [],
    l2: [],
    l1: [],
  };

  // Normalize role to lowercase + trimmed so 'External', 'external ', etc.
  // all map to the same allowlist. Without this, an unexpected casing would
  // silently fall through to `l1` access which is very wrong.
  function normRole(r) {
    return String(r || '').trim().toLowerCase();
  }

  // The first allowed page in a role's list is treated as the default
  // landing page. For external, that's the assembly flight tracker.
  function defaultPageForRole(role) {
    const r = normRole(role);
    const list = ROLE_ACCESS[r];
    if (!list || !list.length) return 'homePage';
    if (list[0] === 'all') return 'homePage';
    return list[0];
  }

  // ── canAccess(page) ─────────────────────────────────────────
  // Returns true if the current user can access the given page.
  function canAccess(page) {
    const user = window.hcCurrentUser;
    if (!user) return false;

    // Check per-user overrides first
    if (user.overrides && typeof user.overrides[page] === 'boolean') {
      const result = user.overrides[page];
      if (!result) {
        console.warn('HC Access: page', page, 'DENIED by user override (overrides:', user.overrides, ')');
      }
      return result;
    }

    // Temp admin gets full access
    if (user.tempAdmin) return true;

    const role = normRole(user.role);
    const allowed = ROLE_ACCESS[role] || ROLE_ACCESS['l1'];
    const result = allowed.includes('all') || allowed.includes(page);
    if (!result) {
      console.warn('HC Access: page', page, 'DENIED by role', role, '— allowed list:', allowed);
    }
    return result;
  }

  // ── isReadOnly(page) ───────────────────────────────────────
  function isReadOnly(page) {
    const user = window.hcCurrentUser;
    if (!user) return false;
    if (user.tempAdmin) return false;
    const ro = READ_ONLY[normRole(user.role)] || [];
    return ro.includes(page);
  }

  // ── applyGuards() ──────────────────────────────────────────
  // Hides nav buttons for pages the user can't access.
  function applyGuards() {
    const user = window.hcCurrentUser;
    if (!user) return;

    // Get all nav buttons with a data-page attribute
    const navBtns = document.querySelectorAll('.nav-btn[data-page]');

    navBtns.forEach(function(btn) {
      const page = btn.getAttribute('data-page');
      if (!canAccess(page)) {
        btn.hidden = true;
        btn.setAttribute('aria-hidden', 'true');
      } else {
        btn.hidden = false;
        btn.removeAttribute('aria-hidden');
        if (isReadOnly(page)) {
          btn.setAttribute('data-readonly', 'true');
          btn.title = btn.title + ' (Read Only)';
        }
      }
    });

    // Hide nav groups that have no visible buttons
    const navGroups = document.querySelectorAll('.nav-group');
    navGroups.forEach(function(group) {
      const visibleBtns = group.querySelectorAll('.nav-btn[data-page]:not([hidden])');
      const groupHeader = group.querySelector('.nav-group-header');
      if (visibleBtns.length === 0 && groupHeader) {
        group.hidden = true;
      } else {
        group.hidden = false;
      }
    });

    console.log('HC Access: guards applied for role', user.role);
  }

  // ── Page-level guard ───────────────────────────────────────
  // If the user lands on a page they can't access (via hash, click, or
  // saved-state restore), redirect them to their role's default landing
  // page — NOT always 'homePage'. External users have no homePage access,
  // so falling back to 'homePage' would leave them stranded.
  function guardCurrentPage() {
    const user = window.hcCurrentUser;
    if (!user) return;
    const hash = window.location.hash.replace('#', '');
    if (!hash) return; // empty hash: let the app's default-load logic decide
    if (canAccess(hash)) return; // allowed — nothing to do

    const dest = defaultPageForRole(user.role);
    console.warn('HC Access: blocked', hash, '→ redirecting to', dest);
    // Use activatePage if available so the click/saved state stays in sync;
    // fall back to hash mutation otherwise.
    if (typeof window.goToPage === 'function') {
      window.goToPage(dest);
    } else {
      window.location.hash = dest;
    }
  }

  // ── Expose publicly ────────────────────────────────────────
  window.hcAccess = {
    canAccess:          canAccess,
    isReadOnly:         isReadOnly,
    applyGuards:        applyGuards,
    guardCurrentPage:   guardCurrentPage,
    defaultPageForRole: defaultPageForRole,
    ROLE_ACCESS:        ROLE_ACCESS,
  };

  // ── Re-guard on every navigation event ────────────────────
  // The original code only guarded once at startup. That left a window
  // where (a) saved state could restore a forbidden page, or (b) a nav
  // button click could land somewhere unallowed if hidden buttons remained
  // clickable somehow. Re-guarding on hashchange catches both.
  window.addEventListener('hashchange', function() {
    if (window.hcCurrentUser) guardCurrentPage();
  });

  // Also intercept nav-button clicks BEFORE the page activates, so a
  // forbidden destination never even briefly renders. Capture phase
  // ensures we run before navigation.js's listener.
  document.addEventListener('click', function(e) {
    const btn = e.target && e.target.closest && e.target.closest('.nav-btn[data-page]');
    if (!btn) return;
    const page = btn.getAttribute('data-page');
    if (!page) return;
    if (!canAccess(page)) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      console.warn('HC Access: blocked click to', page);
      const dest = defaultPageForRole((window.hcCurrentUser||{}).role);
      if (typeof window.goToPage === 'function') window.goToPage(dest);
    }
  }, true); // capture phase

  // ── Auto-apply when user is ready ─────────────────────────
  // auth.js sets hcCurrentUser — we poll briefly for it since
  // the token verification is async
  function waitForUserAndApply() {
    if (window.hcCurrentUser && window.hcCurrentUser.role) {
      applyGuards();
      guardCurrentPage();
      return;
    }
    let attempts = 0;
    const interval = setInterval(function() {
      attempts++;
      if (window.hcCurrentUser && window.hcCurrentUser.role) {
        clearInterval(interval);
        applyGuards();
        guardCurrentPage();
      } else if (attempts > 150) {
        clearInterval(interval);
        console.warn('HC Access: user never set, guards not applied');
      }
    }, 100);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitForUserAndApply);
  } else {
    waitForUserAndApply();
  }

})();
