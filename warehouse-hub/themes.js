// Seasonal Hub themes. An Admin picks one in Admin tools (or Standard for
// none); everyone's Hub picks it up from the feed. To add a holiday, add an
// entry to THEMES with its CSS (scoped to html[data-hub-theme="<key>"]) and,
// optionally, a banner and decorations.
(() => {
  const STORE = 'hubTheme';
  const THEMES = {
    halloween: {
      label: 'Halloween 🎃',
      fonts: 'https://fonts.googleapis.com/css2?family=Creepster&display=swap',
      banner: '🎃 Happy Halloween from the Inbound team! · ¡Feliz Halloween! 🦇',
      css: `
        html[data-hub-theme="halloween"]{
          --paper:#fffaf1;--ink:#2b1638;--muted:#6f5b78;--line:#e6d5c3;
          --orange:#ff7518;--orange-soft:#ffecd9;--blue:#6b3fa0;--blue-soft:#f1e9fb;
          --shadow:0 16px 38px rgba(10,4,18,.35)}
        html[data-hub-theme="halloween"] body{
          background:
            radial-gradient(circle at 86% 7%,rgba(255,226,160,.55) 0,rgba(255,214,140,.16) 5%,transparent 14%),
            radial-gradient(ellipse at 50% 120%,rgba(255,117,24,.28),transparent 55%),
            linear-gradient(180deg,#160d24 0%,#22123a 48%,#2a1408 100%) fixed}
        html[data-hub-theme="halloween"] .topbar{background:rgba(22,13,36,.92);border-bottom-color:#3b2a52}
        html[data-hub-theme="halloween"] .brand{color:#e8dbf6}
        html[data-hub-theme="halloween"] .brandmark{background:#ff7518;box-shadow:0 8px 22px rgba(255,117,24,.45)}
        html[data-hub-theme="halloween"] .section-head h2,
        html[data-hub-theme="halloween"] .lb-where{color:#fff3e4;font-family:Creepster,Inter,system-ui,sans-serif;font-weight:400;letter-spacing:.02em}
        html[data-hub-theme="halloween"] .section-head .eyebrow{color:#ffa24d}
        html[data-hub-theme="halloween"] .section-note,
        html[data-hub-theme="halloween"] .lb-hello,
        html[data-hub-theme="halloween"] .lb-es{color:#d6c7e6}
        html[data-hub-theme="halloween"] .lb-mates b{color:#d6c7e6}
        html[data-hub-theme="halloween"] .lb,
        html[data-hub-theme="halloween"] .section,
        html[data-hub-theme="halloween"] .tools,
        html[data-hub-theme="halloween"] footer{border-color:#3b2a52}
        html[data-hub-theme="halloween"] footer{color:#a898b9}
        html[data-hub-theme="halloween"] .card,
        html[data-hub-theme="halloween"] .tool-card,
        html[data-hub-theme="halloween"] .lb-card{background:rgba(255,250,241,.96)}
        html[data-hub-theme="halloween"] .tool-card{border-top-color:#ff7518}
        html[data-hub-theme="halloween"] .tool-card:nth-child(3n+2){border-top-color:#8a4fd1}
        html[data-hub-theme="halloween"] .tool-card:nth-child(3n){border-top-color:#4d8a2c}
        html[data-hub-theme="halloween"] .view-switch{background:rgba(255,250,241,.9)}
        html[data-hub-theme="halloween"] .empty{background:rgba(255,250,241,.92);color:#5d4a68;border-color:#e6d5c3}
        .hub-theme-banner{position:relative;z-index:2;text-align:center;padding:9px 16px;font-weight:900;font-size:13px;letter-spacing:.04em;color:#2b1638;background:linear-gradient(90deg,#ff7518,#ffb347,#ff7518)}
        .hub-theme-decor{position:fixed;inset:0;pointer-events:none;z-index:0;overflow:hidden}
        html[data-hub-theme="halloween"] main,html[data-hub-theme="halloween"] footer,html[data-hub-theme="halloween"] .topbar{position:relative;z-index:1}
        html[data-hub-theme="halloween"] .topbar{position:sticky;z-index:5}
        .hub-bat{position:absolute;font-size:26px;opacity:.75;animation:hubBat 22s linear infinite;filter:drop-shadow(0 2px 4px rgba(0,0,0,.4))}
        .hub-bat:nth-child(2){font-size:18px;animation-duration:30s;animation-delay:-9s}
        .hub-bat:nth-child(3){font-size:22px;animation-duration:26s;animation-delay:-17s}
        .hub-web{position:absolute;top:74px;left:0;width:150px;height:150px;opacity:.35}
        .hub-pumpkins{position:absolute;bottom:6px;right:14px;font-size:30px;opacity:.9;letter-spacing:6px}
        @keyframes hubBat{
          0%{transform:translate(-8vw,22vh) rotate(-6deg)}25%{transform:translate(28vw,10vh) rotate(6deg)}
          50%{transform:translate(58vw,26vh) rotate(-6deg)}75%{transform:translate(84vw,12vh) rotate(6deg)}
          100%{transform:translate(108vw,20vh) rotate(-6deg)}}
        @media (prefers-reduced-motion:reduce){.hub-bat{animation:none;display:none}}
        @media (max-width:700px){.hub-pumpkins{font-size:22px}.hub-web{width:100px;height:100px}}
      `,
      decor: `<span class="hub-bat">🦇</span><span class="hub-bat">🦇</span><span class="hub-bat">🦇</span>
        <svg class="hub-web" viewBox="0 0 100 100" aria-hidden="true"><g fill="none" stroke="#e8dbf6" stroke-width=".7">
          <path d="M0 0L100 100M0 0L45 100M0 0L100 45M0 0L0 100M0 0L100 0"/>
          <path d="M0 20Q14 14 20 0M0 40Q28 30 40 0M0 62Q44 46 62 0M0 84Q60 62 84 0"/></g></svg>
        <span class="hub-pumpkins">🎃🕸️🎃</span>`,
    },
  };

  let current = '';
  let fontsLoaded = {};
  function apply(key) {
    const theme = THEMES[key] ? key : '';
    try { localStorage.setItem(STORE, theme); } catch {}
    if (theme === current) return;
    current = theme;
    document.getElementById('hubThemeStyle')?.remove();
    document.querySelector('.hub-theme-banner')?.remove();
    document.querySelector('.hub-theme-decor')?.remove();
    if (!theme) { delete document.documentElement.dataset.hubTheme; return; }
    const t = THEMES[theme];
    document.documentElement.dataset.hubTheme = theme;
    const style = document.createElement('style');
    style.id = 'hubThemeStyle';
    style.textContent = t.css;
    document.head.appendChild(style);
    if (t.fonts && !fontsLoaded[t.fonts]) {
      const link = document.createElement('link');
      link.rel = 'stylesheet'; link.href = t.fonts;
      document.head.appendChild(link);
      fontsLoaded[t.fonts] = true;
    }
    const place = () => {
      if (current !== theme || !document.body) return;
      if (t.banner && !document.querySelector('.hub-theme-banner')) {
        const banner = document.createElement('div');
        banner.className = 'hub-theme-banner';
        banner.textContent = t.banner;
        document.querySelector('.topbar')?.after(banner);
      }
      if (t.decor && !document.querySelector('.hub-theme-decor')) {
        const decor = document.createElement('div');
        decor.className = 'hub-theme-decor';
        decor.setAttribute('aria-hidden', 'true');
        decor.innerHTML = t.decor;
        document.body.prepend(decor);
      }
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', place, { once: true }); else place();
  }

  // Show the last theme right away (no flash), then the feed confirms it.
  try { apply(localStorage.getItem(STORE) || ''); } catch {}

  window.HubTheme = {
    apply,
    current: () => current,
    list: () => [{ key: '', label: 'Standard' }, ...Object.entries(THEMES).map(([key, t]) => ({ key, label: t.label }))],
  };
})();
