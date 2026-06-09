/* =========================================================
   auth-fetch.js — attach the signed-in user's token to backend calls
   ---------------------------------------------------------
   Loaded FIRST on every page so it wraps window.fetch before any module runs.
   It adds an Authorization: Bearer <token> header to same-origin
   /.netlify/functions/ requests so the server can authenticate the caller.

   Safe + dormant until the server actually enforces auth:
     - only touches /.netlify/functions/ URLs (same-origin API),
     - never overrides an Authorization header a caller already set,
     - is a no-op when signed out (no token),
     - never throws — auth plumbing must not break a request.
   ========================================================= */
(function installAuthFetch() {
  if (typeof window === 'undefined' || window.__hcAuthFetchInstalled) return;
  if (typeof window.fetch !== 'function') return;
  window.__hcAuthFetchInstalled = true;

  const _fetch = window.fetch.bind(window);

  function tokenNow() {
    try {
      const s = JSON.parse(localStorage.getItem('hcAuthUser') || 'null');
      return (s && s.token) || null;
    } catch (_) { return null; }
  }

  window.fetch = function (input, init) {
    try {
      const url = (typeof input === 'string') ? input
                : (typeof URL !== 'undefined' && input instanceof URL) ? input.href : '';
      if (url && url.indexOf('/.netlify/functions/') !== -1) {
        const tok = tokenNow();
        if (tok) {
          init = Object.assign({}, init);
          const h = new Headers((init && init.headers) || {});
          if (!h.has('Authorization')) {
            h.set('Authorization', 'Bearer ' + tok);
            init.headers = h;
          }
        }
      }
    } catch (_) { /* never let auth plumbing break a request */ }
    return _fetch(input, init);
  };
})();
