(() => {
  'use strict';

  const top = document.querySelector('.top-actions');
  if (!top) return;

  const live = document.getElementById('liveToolCount');
  if (live) live.hidden = true;

  const settings = document.getElementById('manageBtn');
  if (settings) {
    settings.classList.add('header-icon-btn','header-settings-btn');
    settings.textContent = '⚙';
    settings.setAttribute('aria-label','Hub Settings');
    settings.title = 'Hub Settings';
  }

  const adminWrap = document.createElement('div');
  adminWrap.className = 'header-menu-wrap';
  adminWrap.id = 'headerAdminWrap';
  adminWrap.innerHTML = `
    <button class="header-menu-btn" id="headerAdminBtn" type="button" aria-haspopup="true" aria-expanded="false">
      <span>Manage</span><span class="header-chevron">▾</span><span class="header-badge" id="headerAdminBadge" hidden>0</span>
    </button>
    <div class="header-menu" id="headerAdminMenu" hidden>
      <div class="header-menu-title">Manage</div>
      <div class="header-menu-items" id="headerAdminItems"></div>
    </div>`;

  const bellWrap = document.createElement('div');
  bellWrap.className = 'header-menu-wrap';
  bellWrap.id = 'headerBellWrap';
  bellWrap.innerHTML = `
    <button class="header-icon-btn header-bell-btn" id="headerBellBtn" type="button" aria-haspopup="true" aria-expanded="false" aria-label="Notifications" title="Notifications">
      <span aria-hidden="true">🔔</span><span class="header-badge" id="headerBellBadge" hidden>0</span>
    </button>
    <div class="header-menu header-notification-menu" id="headerBellMenu" hidden>
      <div class="header-menu-title">Notifications</div>
      <div class="header-menu-items" id="headerBellItems"></div>
    </div>`;

  const associate = document.getElementById('associateBtn');
  const cleaning = document.getElementById('hubRotationsBtn');
  const date = document.getElementById('currentDate');

  if (cleaning) top.insertBefore(adminWrap, cleaning.nextSibling);
  else if (date) top.insertBefore(adminWrap, date.nextSibling);
  else top.appendChild(adminWrap);

  top.insertBefore(bellWrap, settings || null);

  // Keep the user/sign-in pill immediately before the settings icon.
  if (associate && settings) top.insertBefore(associate, settings);

  const adminItems = document.getElementById('headerAdminItems');
  const bellItems = document.getElementById('headerBellItems');
  const adminBtn = document.getElementById('headerAdminBtn');
  const bellBtn = document.getElementById('headerBellBtn');
  const adminMenu = document.getElementById('headerAdminMenu');
  const bellMenu = document.getElementById('headerBellMenu');

  function moveExistingButtons() {
    const bingo = document.getElementById('bingoRewardBtn');
    const questions = document.querySelector('.question-reward-btn');
    const requestAlerts = document.getElementById('requestAlertBtn');
    const desktopAlerts = document.getElementById('hubPushButton');

    [bingo, questions].forEach((button) => {
      if (button && button.parentElement !== adminItems) {
        button.classList.add('header-menu-item');
        adminItems.appendChild(button);
      }
    });
    if (bingo) {
      const count = numericText(bingo.querySelector('.bingo-reward-count'));
      bingo.innerHTML = count > 0 ? `🎲 Bingo <span class="bingo-reward-count">${count}</span>` : '🎲 Bingo';
      bingo.title = 'Bingo';
    }
    if (questions) {
      const count = numericText(questions.querySelector('.question-reward-count'));
      questions.innerHTML = count > 0 ? `🏆 Prize Questions <span class="question-reward-count">${count}</span>` : '🏆 Prize Questions';
      questions.title = 'Prize Questions';
    }

    [requestAlerts, desktopAlerts].forEach((button) => {
      if (button && button.parentElement !== bellItems) {
        button.classList.add('header-menu-item');
        bellItems.appendChild(button);
      }
    });
    if (requestAlerts) {
      const badge = requestAlerts.querySelector('.request-alert-badge');
      requestAlerts.querySelector('.request-alert-label')?.replaceChildren('Hub Alerts');
      requestAlerts.title = 'Hub Alerts';
      if (badge) badge.setAttribute('aria-label','Unread Hub alerts');
    }
    if (desktopAlerts) {
      desktopAlerts.textContent = '🔔 Notifications';
      desktopAlerts.title = 'Notification settings';
    }

    if (settings && settings.parentElement !== top) top.appendChild(settings);
    if (associate && associate.parentElement !== top) top.insertBefore(associate, settings || null);
  }

  function visibleButton(button) {
    if (!button || button.hidden) return false;
    const style = getComputedStyle(button);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function numericText(el) {
    if (!el || el.hidden) return 0;
    const n = Number(String(el.textContent || '').replace(/[^0-9]/g,''));
    return Number.isFinite(n) ? n : 0;
  }

  function updateMenus() {
    moveExistingButtons();

    const bingo = document.getElementById('bingoRewardBtn');
    const questions = document.querySelector('.question-reward-btn');
    const requestAlerts = document.getElementById('requestAlertBtn');
    const desktopAlerts = document.getElementById('hubPushButton');

    const adminVisible = [bingo, questions].some(visibleButton);
    if (adminWrap.hidden === adminVisible) adminWrap.hidden = !adminVisible;
    if (!adminVisible) closeMenu(adminBtn, adminMenu);

    const bellVisible = [requestAlerts, desktopAlerts].some(visibleButton);
    if (bellWrap.hidden === bellVisible) bellWrap.hidden = !bellVisible;
    if (!bellVisible) closeMenu(bellBtn, bellMenu);

    const adminCount =
      numericText(bingo?.querySelector('.bingo-reward-count')) +
      numericText(questions?.querySelector('.question-reward-count'));
    const adminBadge = document.getElementById('headerAdminBadge');
    if (adminBadge.textContent !== String(adminCount)) adminBadge.textContent = String(adminCount);
    if (adminBadge.hidden !== (adminCount <= 0)) adminBadge.hidden = adminCount <= 0;

    const requestCount = numericText(document.getElementById('requestAlertBadge'));
    const bellBadge = document.getElementById('headerBellBadge');
    if (bellBadge.textContent !== String(requestCount)) bellBadge.textContent = String(requestCount);
    if (bellBadge.hidden !== (requestCount <= 0)) bellBadge.hidden = requestCount <= 0;

    // These are menu rows now, not topbar pills.
    [bingo, questions, requestAlerts, desktopAlerts].forEach((button) => {
      if (button) button.setAttribute('role','menuitem');
    });
  }

  function openMenu(button, menu) {
    const otherButton = button === adminBtn ? bellBtn : adminBtn;
    const otherMenu = menu === adminMenu ? bellMenu : adminMenu;
    closeMenu(otherButton, otherMenu);
    menu.hidden = false;
    button.setAttribute('aria-expanded','true');
  }
  function closeMenu(button, menu) {
    if (!button || !menu) return;
    if (!menu.hidden) menu.hidden = true;
    if (button.getAttribute('aria-expanded') !== 'false') button.setAttribute('aria-expanded','false');
  }
  function toggleMenu(button, menu) {
    if (menu.hidden) openMenu(button,menu);
    else closeMenu(button,menu);
  }

  adminBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleMenu(adminBtn,adminMenu);
  });
  bellBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleMenu(bellBtn,bellMenu);
  });

  [adminMenu,bellMenu].forEach((menu) => {
    menu.addEventListener('click', (event) => {
      const target = event.target.closest('button');
      if (!target) return;
      setTimeout(() => {
        closeMenu(adminBtn,adminMenu);
        closeMenu(bellBtn,bellMenu);
      }, 0);
    });
  });

  document.addEventListener('click', (event) => {
    if (!event.target.closest('.header-menu-wrap')) {
      closeMenu(adminBtn,adminMenu);
      closeMenu(bellBtn,bellMenu);
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeMenu(adminBtn,adminMenu);
      closeMenu(bellBtn,bellMenu);
    }
  });

  const observer = new MutationObserver(() => updateMenus());
  observer.observe(top, { subtree:true, childList:true, attributes:true, characterData:true, attributeFilter:['hidden','class'] });
  document.addEventListener('hub-associate-session', () => setTimeout(updateMenus, 0));
  document.addEventListener('hub-bingo-refresh', () => setTimeout(updateMenus, 0));

  updateMenus();
  setTimeout(updateMenus, 500);
  setTimeout(updateMenus, 1500);
})();