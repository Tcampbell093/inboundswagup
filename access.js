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
      'homePage', 'huddlePage',
      'attendancePage', 'workflowInboundPage', 'fulfillmentScanPage',
      'returnsPage', 'cycleCountPage', 'errorsPage',
      'assemblyPage', 'queuePage', 'assemblyFlightTrackerPage',
      'sordPage', 'calendarPage', 'productivityPage', 'policyPage',
      'helpPage', 'importHubPage'
    ],
    l2: [
      'homePage',
      'workflowInboundPage', 'fulfillmentScanPage',
      'returnsPage', 'cycleCountPage',
      'assemblyPage', 'assemblyFlightTrackerPage',
      'calendarPage', 'policyPage', 'helpPage'
    ],
    l1: [
      'homePage',
      'workflowInboundPage', 'fulfillmentScanPage',
      'returnsPage', 'cycleCountPage',
      'assemblyPage', 'assemblyFlightTrackerPage',
      'calendarPage', 'policyPage', 'helpPage'
    ],
  };

  // Read-only access (can see page but certain actions are disabled)
  // Reserved for future use — currently informational only
  const READ_ONLY = {
    manager: [],
    l2: [],
    l1: [],
  };

  // ── canAccess(page) ─────────────────────────────────────────
  // Returns true if the current user can access the given page.
  function canAccess(page) {
    const user = window.hcCurrentUser;
    if (!user) return false;

    // Check per-user overrides first
    if (user.overrides && typeof user.overrides[page] === 'boolean') {
      return user.overrides[page];
    }

    // Temp admin gets full access
    if (user.tempAdmin) return true;

    const allowed = ROLE_ACCESS[user.role] || ROLE_ACCESS['l1'];
    return allowed.includes('all') || allowed.includes(page);
  }

  // ── isReadOnly(page) ───────────────────────────────────────
  function isReadOnly(page) {
    const user = window.hcCurrentUser;
    if (!user) return false;
    if (user.tempAdmin) return false;
    const ro = READ_ONLY[user.role] || [];
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
  // If someone navigates directly to a restricted page via hash,
  // redirect them to homePage.
  function guardCurrentPage() {
    const hash = window.location.hash.replace('#', '');
    if (!hash || hash === 'homePage') return;
    if (!canAccess(hash)) {
      console.warn('HC Access: blocked direct navigation to', hash);
      window.location.hash = 'homePage';
    }
  }

  // ── Expose publicly ────────────────────────────────────────
  window.hcAccess = {
    canAccess:    canAccess,
    isReadOnly:   isReadOnly,
    applyGuards:  applyGuards,
    ROLE_ACCESS:  ROLE_ACCESS,
  };

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
