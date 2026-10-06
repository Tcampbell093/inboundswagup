// Warns associates when their Hub sign-in has run out (sign-ins last one
// shift). Without this, a tab left open overnight still looks signed in and
// actions quietly fail. Shared by every page that relies on the Hub sign-in.
//
// The banner appears when:
//  - the sign-in reaches its expiry time while the page is open,
//  - the tab comes back into view after the sign-in has expired,
//  - any Hub request is refused because nobody is signed in (HTTP 401).
(() => {
  if (window.HubSigninReminder) return;
  const SESSION_API = '/.netlify/functions/hub-auth?action=session';
  const nativeFetch = window.fetch.bind(window);
  let expiresAt = 0;
  let signedIn = null; // null until the first check
  let lastCheck = 0;
  let checking = null;
  let hiddenUntil = 0; // closing the banner quiets it for a while

  const style = document.createElement('style');
  style.textContent = `
    .hub-signin-banner{position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:2147483000;
      width:min(640px,calc(100% - 24px));display:flex;align-items:center;gap:12px;padding:13px 14px 13px 16px;
      border-radius:14px;background:#fff4ec;color:#7a2f12;border:1px solid #f3c3aa;
      box-shadow:0 18px 50px rgba(18,61,52,.22);font:600 13px/1.4 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
    .hub-signin-banner[hidden]{display:none}
    .hub-signin-banner.ok{background:#eaf6f1;color:#1d5f4f;border-color:#9fcdbd}
    .hub-signin-banner .msg{flex:1}.hub-signin-banner .msg b{display:block;font-size:14px}
    .hub-signin-banner .msg span{display:block;font-weight:500;opacity:.9}
    .hub-signin-banner button,.hub-signin-banner a{border:0;border-radius:10px;padding:9px 12px;font:800 12px Inter,ui-sans-serif,system-ui,sans-serif;
      background:#123d34;color:#fff;cursor:pointer;white-space:nowrap;text-decoration:none}
    .hub-signin-banner .close{background:transparent;color:inherit;font-size:18px;padding:4px 6px}
    @media(max-width:560px){.hub-signin-banner{flex-wrap:wrap}.hub-signin-banner .msg{flex-basis:calc(100% - 40px)}}
  `;
  document.head.appendChild(style);

  const banner = document.createElement('div');
  banner.className = 'hub-signin-banner';
  banner.setAttribute('role', 'alert');
  banner.hidden = true;
  const mount = () => document.body && !banner.isConnected && document.body.appendChild(banner);
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);

  const canOpenDialog = () => typeof window.HubAssociate?.open === 'function';

  function showExpired() {
    banner.className = 'hub-signin-banner';
    banner.innerHTML = `
      <div class="msg"><b>⚠ Please sign in for today</b>
        <span>Your Hub sign-in has expired, so nothing you do here will be saved until you sign in again.</span>
        <span>Tu sesión expiró. Vuelve a iniciar sesión para que se guarde lo que hagas.</span></div>
      ${canOpenDialog()
        ? '<button type="button" data-signin>Sign in · Iniciar sesión</button>'
        : '<a href="/warehouse-hub/" target="_blank" rel="noopener">Sign in · Iniciar sesión</a>'}
      <button type="button" class="close" aria-label="Hide" data-hide>×</button>`;
    banner.querySelector('[data-signin]')?.addEventListener('click', () => window.HubAssociate.open());
    banner.querySelector('[data-hide]').addEventListener('click', () => {
      banner.hidden = true;
      hiddenUntil = Date.now() + 10 * 60000;
    });
    mount();
    banner.hidden = false;
  }

  // Pages without the Hub sign-in dialog read the session only once, so after
  // signing in on the Hub they need a reload to pick it up.
  function showRestored() {
    if (banner.hidden) return;
    if (canOpenDialog()) { banner.hidden = true; return; }
    banner.className = 'hub-signin-banner ok';
    banner.innerHTML = `
      <div class="msg"><b>✓ You’re signed in again</b><span>Reload this page to continue. · Recarga esta página para continuar.</span></div>
      <button type="button" data-reload>Reload · Recargar</button>
      <button type="button" class="close" aria-label="Hide" data-hide>×</button>`;
    banner.querySelector('[data-reload]').addEventListener('click', () => location.reload());
    banner.querySelector('[data-hide]').addEventListener('click', () => { banner.hidden = true; });
  }

  // reason: 'load' (quiet), 'expiry' / 'visible' (warn if it was signed in), '401' (always warn).
  async function check(reason) {
    if (checking) return checking;
    checking = (async () => {
      lastCheck = Date.now();
      let session = { signedIn: false };
      try {
        const response = await nativeFetch(SESSION_API, { cache: 'no-store', credentials: 'same-origin' });
        if (!response.ok) return; // can't tell; don't nag
        session = await response.json();
      } catch {
        return;
      }
      const wasSignedIn = signedIn;
      signedIn = !!session.signedIn;
      expiresAt = signedIn ? Date.parse(session.expiresAt) || 0 : 0;
      if (signedIn) {
        showRestored();
        return;
      }
      if (wasSignedIn === true || (reason === '401' && Date.now() >= hiddenUntil)) {
        showExpired();
        // Let the Hub page update its own signed-in state and buttons.
        if (wasSignedIn) document.dispatchEvent(new CustomEvent('hub-session-expired'));
      }
    })().finally(() => { checking = null; });
    return checking;
  }

  // Any same-origin Hub request refused for lack of a sign-in.
  window.fetch = async (...args) => {
    const response = await nativeFetch(...args);
    if (response.status === 401) {
      try {
        const url = new URL(typeof args[0] === 'string' ? args[0] : args[0]?.url || '', location.href);
        const hubRequest = url.origin === location.origin
          && (url.pathname.startsWith('/.netlify/functions/') || url.pathname.startsWith('/api/'))
          && !url.pathname.includes('hub-auth');
        if (hubRequest) check('401');
      } catch {}
    }
    return response;
  };

  // Timers stall while a computer sleeps, so also check on a regular tick.
  setInterval(() => {
    if (signedIn && expiresAt && Date.now() >= expiresAt) check('expiry');
  }, 60000);
  const onVisible = () => {
    if (document.visibilityState !== 'visible') return;
    if ((signedIn && expiresAt && Date.now() >= expiresAt) || Date.now() - lastCheck > 5 * 60000 || !banner.hidden) check('visible');
  };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', onVisible);
  document.addEventListener('hub-associate-session', (event) => {
    signedIn = !!event.detail?.signedIn;
    expiresAt = signedIn ? Date.parse(event.detail?.expiresAt) || expiresAt : 0;
    if (signedIn) showRestored();
  });

  window.HubSigninReminder = { check };
  check('load');
})();
