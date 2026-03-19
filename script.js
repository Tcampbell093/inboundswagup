// =======================
// NAVIGATION (SAFE PATCH)
// =======================

const navButtons = document.querySelectorAll('.nav-btn');
const pages = document.querySelectorAll('.page');

function activatePage(pageId, options = {}) {
  const { updateHash = true, persist = true } = options;
  if (!pageId) return;

  const targetPage = document.getElementById(pageId);
  if (!targetPage) return;

  pages.forEach(p => p.classList.remove('active'));
  navButtons.forEach(b => b.classList.remove('active'));

  targetPage.classList.add('active');

  const targetBtn = document.querySelector(`.nav-btn[data-page="${pageId}"]`);
  if (targetBtn) targetBtn.classList.add('active');

  if (persist) {
    localStorage.setItem('ops_hub_active_page', pageId);
  }

  if (updateHash) {
    if (window.location.hash !== `#${pageId}`) {
      history.replaceState(null, '', `#${pageId}`);
    }
  }
}

navButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    activatePage(btn.dataset.page);
  });
});

function restoreActivePage() {
  const hashPage = window.location.hash.replace('#', '').trim();
  const savedPage = localStorage.getItem('ops_hub_active_page');
  const defaultPage =
    document.querySelector('.nav-btn.active')?.dataset.page || 'homePage';

  const pageToOpen = hashPage || savedPage || defaultPage;

  activatePage(pageToOpen, {
    updateHash: !!hashPage || !!savedPage,
    persist: true
  });
}

window.goToPage = function (pageId) {
  activatePage(pageId);
};

window.addEventListener('DOMContentLoaded', restoreActivePage);


// =======================
// KEEP YOUR ORIGINAL CODE BELOW
// =======================


// ===== STORAGE HELPERS =====
function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}


// ===== SAMPLE ATTENDANCE =====
const attendanceSampleData = [
  { id: 1, employeeName: "Diana Parra", department: "Receiving", date: "2026-03-10", mark: "Present" }
];


// =======================
// CALENDAR (RESTORED)
// =======================

let currentDate = new Date();

function renderCalendar() {
  const calendarEl = document.getElementById("calendar");
  if (!calendarEl) return;

  calendarEl.innerHTML = "";

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const firstDay = new Date(year, month, 1).getDay();
  const lastDate = new Date(year, month + 1, 0).getDate();

  for (let i = 0; i < firstDay; i++) {
    const empty = document.createElement("div");
    calendarEl.appendChild(empty);
  }

  for (let day = 1; day <= lastDate; day++) {
    const cell = document.createElement("div");
    cell.className = "calendar-day";
    cell.innerText = day;

    const fullDate = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

    cell.addEventListener("click", () => {
      setAssemblyDateAndNavigate(fullDate);
    });

    calendarEl.appendChild(cell);
  }
}

document.getElementById("calendarPrev")?.addEventListener("click", () => {
  currentDate.setMonth(currentDate.getMonth() - 1);
  renderCalendar();
});

document.getElementById("calendarNext")?.addEventListener("click", () => {
  currentDate.setMonth(currentDate.getMonth() + 1);
  renderCalendar();
});


// =======================
// ASSEMBLY NAV LINK (FIXED)
// =======================

function setAssemblyDateAndNavigate(date) {
  const input = document.getElementById("assemblyDate");
  if (input) input.value = date;

  // 🔥 IMPORTANT: use new nav system
  activatePage("assemblyPage");
}


// =======================
// INIT
// =======================

document.addEventListener("DOMContentLoaded", () => {
  renderCalendar();
});
