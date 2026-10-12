// Seasonal Hub themes. An Admin picks one in Admin tools (or Standard for
// none); everyone's Hub picks it up from the feed. To add a holiday, add an
// entry to THEMES built with seasonal({...}): colors, banner, decorations.
// Every theme paints a dark page background and keeps cards and pop-up
// windows light, so text stays readable.
(() => {
  const STORE = 'hubTheme';

  // Shared by every theme: banner, decoration layer and floating animations.
  const BASE_CSS = `
    .hub-theme-banner{position:relative;z-index:2;text-align:center;padding:9px 16px;font-weight:900;font-size:13px;letter-spacing:.04em}
    .hub-theme-decor{position:fixed;inset:0;pointer-events:none;z-index:0;overflow:hidden}
    html[data-hub-theme] main,html[data-hub-theme] footer{position:relative;z-index:1}
    html[data-hub-theme] .topbar{position:sticky;z-index:5}
    .hub-float{position:absolute;top:0;left:0;opacity:.8;filter:drop-shadow(0 2px 4px rgba(0,0,0,.35));will-change:transform}
    .hub-float.fly{animation:hubFly 24s linear infinite}
    .hub-float.fall{animation:hubFall 18s linear infinite}
    .hub-float.rise{animation:hubRise 20s linear infinite}
    .hub-corner{position:absolute;bottom:6px;right:14px;font-size:30px;opacity:.9;letter-spacing:6px}
    .hub-web{position:absolute;top:108px;left:0;width:150px;height:150px;opacity:.35}
    .hub-lights{position:absolute;top:108px;left:0;right:0;height:22px;opacity:.95}
    @keyframes hubFly{0%{transform:translate(-8vw,22vh) rotate(-6deg)}25%{transform:translate(28vw,10vh) rotate(6deg)}50%{transform:translate(58vw,26vh) rotate(-6deg)}75%{transform:translate(84vw,12vh) rotate(6deg)}100%{transform:translate(108vw,20vh) rotate(-6deg)}}
    @keyframes hubFall{0%{transform:translate(var(--x),-8vh) rotate(0)}50%{transform:translate(calc(var(--x) + 4vw),50vh) rotate(160deg)}100%{transform:translate(calc(var(--x) - 2vw),108vh) rotate(320deg)}}
    @keyframes hubRise{0%{transform:translate(var(--x),108vh) scale(.9)}50%{transform:translate(calc(var(--x) + 3vw),50vh) scale(1.05)}100%{transform:translate(calc(var(--x) - 2vw),-10vh) scale(.9)}}
    @media (prefers-reduced-motion:reduce){.hub-float{display:none}}
    @media (max-width:700px){.hub-corner{font-size:22px}.hub-web{width:100px;height:100px}}
  `;

  // Floating decorations: `count` copies of `chars`, spread across the page.
  function floaters(kind, chars, count, size = [18, 28]) {
    return Array.from({ length: count }, (_, i) => {
      const ch = chars[i % chars.length];
      const x = (i * 37 + 11) % 100;
      const px = size[0] + ((i * 7) % (size[1] - size[0] + 1));
      const dur = kind === 'fly' ? 22 + (i % 3) * 5 : 14 + (i % 5) * 3;
      return `<span class="hub-float ${kind}" style="--x:${x}vw;font-size:${px}px;animation-duration:${dur}s;animation-delay:-${(i * 3.7) % dur}s">${ch}</span>`;
    }).join('');
  }

  function seasonal(o) {
    const T = `html[data-hub-theme="${o.key}"]`;
    return {
      label: o.label,
      fonts: o.fonts,
      banner: o.banner,
      decor: o.decor,
      css: `
        ${T}{--paper:${o.paper || '#fffaf1'};--ink:${o.ink};--muted:${o.muted};--line:${o.line};
          --orange:${o.accent};--orange-soft:${o.accentSoft};--blue:${o.accent2};--blue-soft:${o.accent2Soft};
          --shadow:0 16px 38px rgba(0,0,0,.33)}
        ${T} body{background:${o.background}}
        ${T} .topbar{background:${o.topbar};border-bottom-color:${o.edge}}
        ${T} .brand{color:${o.onDark}}
        ${T} .brandmark{background:${o.accent};box-shadow:0 8px 22px ${o.glow}}
        ${T} .section-head h2,${T} .lb-where{color:${o.headline};font-family:${o.headingFont};font-weight:${o.headingWeight || 400};letter-spacing:${o.headingSpacing || '.01em'}}
        ${T} .section-head .eyebrow{color:${o.eyebrow}}
        ${T} .section-note,${T} .lb-hello,${T} .lb-es,${T} .lb-mates b{color:${o.onDark}}
        ${T} .lb,${T} .section,${T} .tools,${T} footer{border-color:${o.edge}}
        ${T} footer{color:${o.footer}}
        ${T} .card,${T} .tool-card,${T} .lb-card{background:${o.cardBg || 'rgba(255,250,241,.96)'}}
        ${T} .tool-card{border-top-color:${o.tool[0]}}
        ${T} .tool-card:nth-child(3n+2){border-top-color:${o.tool[1]}}
        ${T} .tool-card:nth-child(3n){border-top-color:${o.tool[2]}}
        ${T} .view-switch{background:rgba(255,250,241,.9)}
        ${T} .empty{background:rgba(255,250,241,.92);color:${o.muted};border-color:${o.line}}
        ${T} .hub-theme-banner{color:${o.bannerText};background:${o.bannerBg}}
        ${o.extra || ''}
      `,
    };
  }

  const THEMES = {
    halloween: seasonal({
      key: 'halloween', label: 'Halloween 🎃',
      fonts: 'https://fonts.googleapis.com/css2?family=Creepster&display=swap',
      headingFont: 'Creepster,Inter,system-ui,sans-serif', headingSpacing: '.02em',
      banner: '🎃 Happy Halloween from the Inbound team! · ¡Feliz Halloween! 🦇',
      ink: '#2b1638', muted: '#6f5b78', line: '#e6d5c3',
      accent: '#ff7518', accentSoft: '#ffecd9', accent2: '#6b3fa0', accent2Soft: '#f1e9fb', glow: 'rgba(255,117,24,.45)',
      background: `radial-gradient(circle at 86% 7%,rgba(255,226,160,.55) 0,rgba(255,214,140,.16) 5%,transparent 14%),
        radial-gradient(ellipse at 50% 120%,rgba(255,117,24,.28),transparent 55%),
        linear-gradient(180deg,#160d24 0%,#22123a 48%,#2a1408 100%) fixed`,
      topbar: 'rgba(22,13,36,.92)', edge: '#3b2a52', onDark: '#d6c7e6', headline: '#fff3e4', eyebrow: '#ffa24d', footer: '#a898b9',
      tool: ['#ff7518', '#8a4fd1', '#4d8a2c'],
      bannerText: '#2b1638', bannerBg: 'linear-gradient(90deg,#ff7518,#ffb347,#ff7518)',
      decor: `${floaters('fly', ['🦇'], 3, [18, 26])}
        <svg class="hub-web" viewBox="0 0 100 100" aria-hidden="true"><g fill="none" stroke="#e8dbf6" stroke-width=".7">
          <path d="M0 0L100 100M0 0L45 100M0 0L100 45M0 0L0 100M0 0L100 0"/>
          <path d="M0 20Q14 14 20 0M0 40Q28 30 40 0M0 62Q44 46 62 0M0 84Q60 62 84 0"/></g></svg>
        <span class="hub-corner">🎃🕸️🎃</span>`,
    }),

    thanksgiving: seasonal({
      key: 'thanksgiving', label: 'Thanksgiving 🦃',
      fonts: 'https://fonts.googleapis.com/css2?family=Rye&display=swap',
      headingFont: 'Rye,Georgia,serif', headingSpacing: '0',
      banner: '🦃 Happy Thanksgiving! Thank you for all you do · ¡Feliz Día de Acción de Gracias! 🍂',
      ink: '#3a1f12', muted: '#7a5a45', line: '#ead8bf',
      accent: '#c8641e', accentSoft: '#fbe7d3', accent2: '#8f2d1f', accent2Soft: '#f7e3dd', glow: 'rgba(200,100,30,.45)',
      background: `radial-gradient(circle at 80% 6%,rgba(255,200,120,.38) 0,rgba(255,180,90,.12) 7%,transparent 18%),
        radial-gradient(ellipse at 50% 120%,rgba(217,164,65,.30),transparent 55%),
        linear-gradient(180deg,#2a140a 0%,#3d1d0e 50%,#4a2a10 100%) fixed`,
      topbar: 'rgba(42,20,10,.92)', edge: '#5a3520', onDark: '#ead2b8', headline: '#fff1dc', eyebrow: '#f0a24a', footer: '#bfa084',
      tool: ['#c8641e', '#8f2d1f', '#d9a441'],
      bannerText: '#3a1f12', bannerBg: 'linear-gradient(90deg,#d9a441,#e9874a,#c8641e,#e9874a,#d9a441)',
      decor: `${floaters('fall', ['🍂', '🍁', '🍂'], 10, [18, 28])}<span class="hub-corner">🦃🥧🌽</span>`,
    }),

    christmas: seasonal({
      key: 'christmas', label: 'Christmas 🎄',
      fonts: 'https://fonts.googleapis.com/css2?family=Mountains+of+Christmas:wght@700&display=swap',
      headingFont: '"Mountains of Christmas",Georgia,serif', headingWeight: 700, headingSpacing: '0',
      banner: '🎄 Merry Christmas & Happy Holidays from the Inbound team! · ¡Feliz Navidad! ❄️',
      ink: '#14321f', muted: '#5b6e60', line: '#dfe6dc', paper: '#fffdf8',
      accent: '#c8102e', accentSoft: '#fbe3e6', accent2: '#1f7a46', accent2Soft: '#e4f3ea', glow: 'rgba(200,16,46,.4)',
      background: `radial-gradient(circle at 18% 10%,rgba(255,255,255,.10) 0,transparent 22%),
        radial-gradient(ellipse at 50% 120%,rgba(232,195,90,.20),transparent 55%),
        linear-gradient(180deg,#0b1d2e 0%,#0e2a22 55%,#0b2016 100%) fixed`,
      topbar: 'rgba(10,28,40,.92)', edge: '#24443a', onDark: '#cfe2d6', headline: '#fffaf0', eyebrow: '#e8c35a', footer: '#9fb8aa',
      tool: ['#c8102e', '#1f7a46', '#e8c35a'],
      bannerText: '#fff', bannerBg: 'repeating-linear-gradient(135deg,#c8102e 0 18px,#a50d26 18px 36px)',
      extra: `html[data-hub-theme="christmas"] .hub-theme-banner{text-shadow:0 1px 2px rgba(0,0,0,.35)}`,
      decor: `${floaters('fall', ['❄️', '❅', '❆'], 14, [12, 22])}
        <svg class="hub-lights" viewBox="0 0 1000 22" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0 4 Q25 16 50 4 T100 4 T150 4 T200 4 T250 4 T300 4 T350 4 T400 4 T450 4 T500 4 T550 4 T600 4 T650 4 T700 4 T750 4 T800 4 T850 4 T900 4 T950 4 T1000 4" fill="none" stroke="#2c4a3a" stroke-width="1.5"/>
          ${Array.from({ length: 20 }, (_, i) => `<circle cx="${25 + i * 50}" cy="12" r="4.5" fill="${['#ff4d5e', '#ffd166', '#4dd38a', '#5fb3ff'][i % 4]}"/>`).join('')}
        </svg>
        <span class="hub-corner">🎄🎁⛄</span>`,
    }),

    valentines: seasonal({
      key: 'valentines', label: "Valentine's Day 💘",
      fonts: 'https://fonts.googleapis.com/css2?family=Pacifico&display=swap',
      headingFont: 'Pacifico,Georgia,cursive', headingSpacing: '0',
      banner: "💘 Happy Valentine's Day from the Inbound team! · ¡Feliz Día del Amor y la Amistad! 💕",
      ink: '#4a1030', muted: '#85566c', line: '#f1d5e0', paper: '#fffafc',
      accent: '#e0245e', accentSoft: '#fde4ec', accent2: '#b0306a', accent2Soft: '#f9e5ef', glow: 'rgba(224,36,94,.45)',
      background: `radial-gradient(circle at 82% 8%,rgba(255,170,200,.35) 0,rgba(255,150,190,.10) 8%,transparent 20%),
        radial-gradient(ellipse at 50% 120%,rgba(255,110,160,.28),transparent 55%),
        linear-gradient(180deg,#2a0b1c 0%,#4a1230 55%,#5c1533 100%) fixed`,
      topbar: 'rgba(42,11,28,.92)', edge: '#5d2343', onDark: '#f2cfdd', headline: '#fff0f5', eyebrow: '#ff8fb1', footer: '#c99aae',
      cardBg: 'rgba(255,250,252,.96)',
      tool: ['#e0245e', '#ff8fb1', '#b0306a'],
      bannerText: '#fff', bannerBg: 'linear-gradient(90deg,#e0245e,#ff6f9c,#e0245e)',
      decor: `${floaters('rise', ['❤️', '💕', '💗', '💖'], 9, [16, 26])}<span class="hub-corner">💘🌹💌</span>`,
    }),
  };

  let current = '';
  const fontsLoaded = {};
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
    style.textContent = BASE_CSS + t.css;
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
