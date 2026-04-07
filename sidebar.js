// ═══════════════════════════════════════════════════════════════
// SIDEBAR — Responsive drawer + collapsible rail + group toggle
// ═══════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const app      = document.querySelector('.app');
  const sidebar  = document.getElementById('appSidebar');
  const overlay  = document.getElementById('sidebarOverlay');
  const openBtn  = document.getElementById('mobileMenuBtn');
  const closeBtn = document.getElementById('sidebarCloseBtn');
  const railBtn  = document.getElementById('sidebarRailToggle');
  const navBtns  = document.querySelectorAll('.nav-btn');

  if (!sidebar) return;

  // ── Collapsed rail state ──────────────────────────────────────
  const RAIL_KEY = 'ops_sidebar_collapsed';
  let isCollapsed = localStorage.getItem(RAIL_KEY) === 'true';

  function applyCollapsed() {
    app && app.classList.toggle('sidebar-collapsed', isCollapsed);
  }
  applyCollapsed();

  if (railBtn) {
    railBtn.addEventListener('click', () => {
      isCollapsed = !isCollapsed;
      localStorage.setItem(RAIL_KEY, isCollapsed);
      applyCollapsed();
    });
  }

  // ── Group collapsing ──────────────────────────────────────────
  document.querySelectorAll('.nav-group-header').forEach(header => {
    const targetId = header.getAttribute('aria-controls');
    const list = document.getElementById(targetId);
    if (!list) return;

    // Restore saved state
    const key = 'ops_navgroup_' + targetId;
    const saved = localStorage.getItem(key);
    if (saved === 'false') {
      header.setAttribute('aria-expanded', 'false');
      list.classList.add('collapsed');
    }

    header.addEventListener('click', () => {
      const expanded = header.getAttribute('aria-expanded') === 'true';
      header.setAttribute('aria-expanded', String(!expanded));
      list.classList.toggle('collapsed', expanded);
      localStorage.setItem(key, String(!expanded));
    });
  });

  // ── Open / close mobile drawer ────────────────────────────────
  function openSidebar() {
    sidebar.classList.add('open');
    overlay && overlay.classList.add('active');
    if (openBtn) openBtn.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
    const firstBtn = sidebar.querySelector('.nav-btn');
    if (firstBtn) firstBtn.focus();
  }

  function closeSidebar() {
    sidebar.classList.remove('open');
    overlay && overlay.classList.remove('active');
    if (openBtn) openBtn.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
    if (openBtn) openBtn.focus();
  }

  function isMobileMode() {
    return window.innerWidth <= 1100;
  }

  if (openBtn)  openBtn.addEventListener('click', openSidebar);
  if (closeBtn) closeBtn.addEventListener('click', closeSidebar);
  if (overlay)  overlay.addEventListener('click', closeSidebar);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sidebar.classList.contains('open')) closeSidebar();
  });

  navBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (isMobileMode()) setTimeout(closeSidebar, 120);
    });
  });

  // ── Swipe gestures ────────────────────────────────────────────
  let touchStartX = 0;
  let touchStartY = 0;

  sidebar.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });

  sidebar.addEventListener('touchend', (e) => {
    if (!isMobileMode()) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = Math.abs(e.changedTouches[0].clientY - touchStartY);
    if (dx < -60 && dy < 80) closeSidebar();
  }, { passive: true });

  document.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });

  document.addEventListener('touchend', (e) => {
    if (!isMobileMode()) return;
    if (sidebar.classList.contains('open')) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = Math.abs(e.changedTouches[0].clientY - touchStartY);
    if (touchStartX < 24 && dx > 60 && dy < 80) openSidebar();
  }, { passive: true });

  window.addEventListener('resize', () => {
    if (!isMobileMode() && sidebar.classList.contains('open')) closeSidebar();
  });

})();
