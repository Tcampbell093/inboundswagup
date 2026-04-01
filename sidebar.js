
// ═══════════════════════════════════════════════════════════════
// SIDEBAR — Responsive drawer behaviour
// Works alongside navigation.js. Must load after DOM is ready.
// ═══════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const sidebar    = document.getElementById('appSidebar');
  const overlay    = document.getElementById('sidebarOverlay');
  const openBtn    = document.getElementById('mobileMenuBtn');
  const closeBtn   = document.getElementById('sidebarCloseBtn');
  const navBtns    = document.querySelectorAll('.nav-btn');

  if (!sidebar) return;

  // ── Open / close helpers ──────────────────────────────────────
  function openSidebar() {
    sidebar.classList.add('open');
    overlay.classList.add('active');
    if (openBtn) openBtn.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';   // prevent body scroll on mobile
    // Move focus into sidebar for accessibility
    const firstBtn = sidebar.querySelector('.nav-btn');
    if (firstBtn) firstBtn.focus();
  }

  function closeSidebar() {
    sidebar.classList.remove('open');
    overlay.classList.remove('active');
    if (openBtn) openBtn.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
    if (openBtn) openBtn.focus();
  }

  function isMobileMode() {
    return window.innerWidth <= 1100;
  }

  // ── Bindings ──────────────────────────────────────────────────
  if (openBtn)  openBtn.addEventListener('click', openSidebar);
  if (closeBtn) closeBtn.addEventListener('click', closeSidebar);
  if (overlay)  overlay.addEventListener('click', closeSidebar);

  // Close on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sidebar.classList.contains('open')) {
      closeSidebar();
    }
  });

  // Auto-close drawer after nav selection on mobile
  navBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (isMobileMode()) {
        // Small delay so the page transition isn't janky
        setTimeout(closeSidebar, 120);
      }
    });
  });

  // ── Swipe to close on mobile ──────────────────────────────────
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
    // Swipe left ≥ 60px and mostly horizontal → close
    if (dx < -60 && dy < 80) closeSidebar();
  }, { passive: true });

  // Swipe right from left edge of screen to open
  document.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });

  document.addEventListener('touchend', (e) => {
    if (!isMobileMode()) return;
    if (sidebar.classList.contains('open')) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = Math.abs(e.changedTouches[0].clientY - touchStartY);
    const startedFromEdge = touchStartX < 24;   // within 24px of left edge
    if (startedFromEdge && dx > 60 && dy < 80) openSidebar();
  }, { passive: true });

  // ── Resize guard ──────────────────────────────────────────────
  // If user resizes back to desktop, close the mobile drawer
  window.addEventListener('resize', () => {
    if (!isMobileMode() && sidebar.classList.contains('open')) {
      closeSidebar();
    }
  });

})();
