// =======================
// PAGE NAVIGATION SYSTEM (CLEAN)
// =======================

const navButtons = document.querySelectorAll('.nav-btn');
const pages = document.querySelectorAll('.page');

// Core function
function activatePage(pageId) {
  pages.forEach(p => p.classList.remove('active'));
  navButtons.forEach(b => b.classList.remove('active'));

  const page = document.getElementById(pageId);
  const btn = document.querySelector(`.nav-btn[data-page="${pageId}"]`);

  if (page) page.classList.add('active');
  if (btn) btn.classList.add('active');

  // Save state
  localStorage.setItem('activePage', pageId);

  // Update URL hash
  window.location.hash = pageId;
}

// Click navigation
navButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    activatePage(btn.dataset.page);
  });
});

// Load correct page on refresh
function loadInitialPage() {
  const hash = window.location.hash.replace('#', '');
  const saved = localStorage.getItem('activePage');

  const pageToLoad = hash || saved || 'homePage';

  activatePage(pageToLoad);
}

// Run on load
window.addEventListener('DOMContentLoaded', loadInitialPage);



// =======================
// OPTIONAL: EXTERNAL NAV (like buttons inside pages)
// =======================

window.goToPage = function(pageId) {
  activatePage(pageId);
};
