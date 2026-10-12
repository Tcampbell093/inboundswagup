// Seasonal Hub themes. An Admin picks one in Admin tools (or Standard for
// none); everyone's Hub picks it up from the feed. To add a holiday, add an
// entry to THEMES built with seasonal({...}): colors, banner, decorations.
// Every theme paints a dark page background and keeps cards and pop-up
// windows light, so text stays readable.
(() => {
  const STORE = 'hubTheme';
  const GF = 'https://fonts.googleapis.com/css2?family=';

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
        ${T} .hub-theme-banner{color:${o.bannerText};background:${o.bannerBg}${o.bannerEdge ? `;border-bottom:6px solid transparent;border-image:${o.bannerEdge} 1` : ''}}
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

    newyear: seasonal({
      key: 'newyear', label: "New Year's 🎆",
      fonts: GF + 'Cinzel+Decorative:wght@700&display=swap',
      headingFont: '"Cinzel Decorative",Georgia,serif', headingWeight: 700, headingSpacing: '0',
      banner: '🎆 Happy New Year from the Inbound team! · ¡Feliz Año Nuevo! 🥂',
      ink: '#1c1a2e', muted: '#615d74', line: '#e6dfcb', paper: '#fffdf6',
      accent: '#c9a227', accentSoft: '#fbf3d9', accent2: '#3d3a78', accent2Soft: '#ebeaf7', glow: 'rgba(201,162,39,.45)',
      background: `radial-gradient(circle at 20% 12%,rgba(255,215,120,.22) 0,transparent 18%),radial-gradient(circle at 80% 30%,rgba(160,140,255,.18) 0,transparent 20%),linear-gradient(180deg,#0b0b1e 0%,#15153a 55%,#1e1a3c 100%) fixed`,
      topbar: 'rgba(11,11,30,.92)', edge: '#2e2c55', onDark: '#d8d4ee', headline: '#fff6d8', eyebrow: '#f2cf5b', footer: '#a6a2c4',
      tool: ['#c9a227', '#3d3a78', '#b8b8c8'],
      bannerText: '#1c1a2e', bannerBg: 'linear-gradient(90deg,#c9a227,#f7e27a,#c9a227)',
      decor: `${floaters('fall', ['✨', '🎉', '🎊', '⭐'], 12, [14, 24])}<span class="hub-corner">🎆🥂🎇</span>`,
    }),

    reyes: seasonal({
      key: 'reyes', label: 'Día de Reyes 👑',
      fonts: GF + 'Cinzel:wght@700&display=swap',
      headingFont: 'Cinzel,Georgia,serif', headingWeight: 700, headingSpacing: '0',
      banner: '👑 ¡Feliz Día de Reyes! · Happy Three Kings Day from the Inbound team ⭐',
      ink: '#2a1a3e', muted: '#6c5c80', line: '#e8dcc6', paper: '#fffaf0',
      accent: '#d4a017', accentSoft: '#fbf0d2', accent2: '#5b2a86', accent2Soft: '#efe5f8', glow: 'rgba(212,160,23,.45)',
      background: `radial-gradient(circle at 75% 10%,rgba(255,230,150,.45) 0,rgba(255,220,130,.12) 6%,transparent 16%),linear-gradient(180deg,#120b26 0%,#24124a 55%,#2e1a3e 100%) fixed`,
      topbar: 'rgba(18,11,38,.92)', edge: '#3a2a5e', onDark: '#ddd0ee', headline: '#fff5d6', eyebrow: '#f2c94c', footer: '#a99bc0',
      tool: ['#d4a017', '#5b2a86', '#b2402c'],
      bannerText: '#2a1a3e', bannerBg: 'linear-gradient(90deg,#d4a017,#f6dc7c,#d4a017)',
      decor: `${floaters('fall', ['⭐', '✨'], 8, [12, 20])}<span class="hub-corner">👑🐪🎁</span>`,
    }),

    winter: seasonal({
      key: 'winter', label: 'Winter ❄️',
      fonts: GF + 'Comfortaa:wght@700&display=swap',
      headingFont: 'Comfortaa,Inter,sans-serif', headingWeight: 700, headingSpacing: '-.01em',
      banner: '❄️ Stay warm out there! · ¡Abríguense bien! ☕',
      ink: '#13304a', muted: '#5a7086', line: '#d9e6f0', paper: '#fbfdff',
      accent: '#3a86c8', accentSoft: '#e3f0fa', accent2: '#6aa5d6', accent2Soft: '#eaf3fb', glow: 'rgba(58,134,200,.45)',
      background: `radial-gradient(circle at 80% 10%,rgba(220,240,255,.25) 0,transparent 18%),linear-gradient(180deg,#0c1b2e 0%,#14304d 55%,#1b3a58 100%) fixed`,
      topbar: 'rgba(12,27,46,.92)', edge: '#29476a', onDark: '#cfe0ef', headline: '#f3faff', eyebrow: '#9fd0ff', footer: '#9db4c9',
      tool: ['#3a86c8', '#9fd0ff', '#5a7086'],
      bannerText: '#13304a', bannerBg: 'linear-gradient(90deg,#cfe8fb,#ffffff,#cfe8fb)',
      decor: `${floaters('fall', ['❄️', '❅', '❆'], 12, [12, 22])}<span class="hub-corner">☕⛄❄️</span>`,
    }),

    appreciation: seasonal({
      key: 'appreciation', label: 'Employee Appreciation ⭐',
      fonts: GF + 'Fredoka:wght@600&display=swap',
      headingFont: 'Fredoka,Inter,sans-serif', headingWeight: 600, headingSpacing: '-.01em',
      banner: '⭐ Thank you, team! We appreciate everything you do · ¡Gracias, equipo! ⭐',
      ink: '#1e2a4a', muted: '#5d6886', line: '#e3e3d6',
      accent: '#f2a900', accentSoft: '#fff3d1', accent2: '#2f5bd3', accent2Soft: '#e7eefc', glow: 'rgba(242,169,0,.45)',
      background: `radial-gradient(circle at 80% 10%,rgba(255,215,90,.35) 0,transparent 20%),linear-gradient(180deg,#101a3a 0%,#1a2a5c 55%,#22306a 100%) fixed`,
      topbar: 'rgba(16,26,58,.92)', edge: '#2f3f75', onDark: '#d5ddf3', headline: '#fff8e1', eyebrow: '#ffd25a', footer: '#a8b3d4',
      tool: ['#f2a900', '#2f5bd3', '#e05a47'],
      bannerText: '#1e2a4a', bannerBg: 'linear-gradient(90deg,#f2a900,#ffe08a,#f2a900)',
      decor: `${floaters('fall', ['⭐', '🌟', '🎉'], 10, [14, 24])}<span class="hub-corner">🏆⭐🙌</span>`,
    }),

    stpatricks: seasonal({
      key: 'stpatricks', label: "St. Patrick's Day ☘️",
      fonts: GF + 'Uncial+Antiqua&display=swap',
      headingFont: '"Uncial Antiqua",Georgia,serif', headingSpacing: '0',
      banner: "☘️ Happy St. Patrick's Day from the Inbound team! · ¡Feliz Día de San Patricio! 🍀",
      ink: '#123a22', muted: '#577060', line: '#d9e8dc', paper: '#fbfff9',
      accent: '#1e8a3e', accentSoft: '#e1f4e6', accent2: '#c9a227', accent2Soft: '#fbf3d9', glow: 'rgba(30,138,62,.45)',
      background: `radial-gradient(circle at 80% 10%,rgba(160,255,170,.20) 0,transparent 20%),linear-gradient(180deg,#07210f 0%,#0d3a1c 55%,#124424 100%) fixed`,
      topbar: 'rgba(7,33,15,.92)', edge: '#1f5232', onDark: '#cbe8d3', headline: '#f1fff3', eyebrow: '#f2cf5b', footer: '#97bba2',
      tool: ['#1e8a3e', '#c9a227', '#5fbf6a'],
      bannerText: '#fff', bannerBg: 'linear-gradient(90deg,#1e8a3e,#36b257,#1e8a3e)',
      decor: `${floaters('fall', ['☘️', '🍀', '🪙'], 10, [14, 24])}<span class="hub-corner">🍀🌈🪙</span>`,
    }),

    spring: seasonal({
      key: 'spring', label: 'Spring 🌸',
      fonts: GF + 'Fredoka:wght@600&display=swap',
      headingFont: 'Fredoka,Inter,sans-serif', headingWeight: 600, headingSpacing: '-.01em',
      banner: '🌸 Happy spring from the Inbound team! · ¡Feliz primavera! 🌷',
      ink: '#2d3a2a', muted: '#68765f', line: '#e5ead9', paper: '#fffdfa',
      accent: '#e86a9a', accentSoft: '#fde6ef', accent2: '#5aa356', accent2Soft: '#e7f4e4', glow: 'rgba(232,106,154,.4)',
      background: `radial-gradient(circle at 80% 10%,rgba(255,210,230,.30) 0,transparent 20%),linear-gradient(180deg,#1d2b22 0%,#2b4130 55%,#345038 100%) fixed`,
      topbar: 'rgba(29,43,34,.92)', edge: '#3d5a44', onDark: '#dbe9d6', headline: '#fff6fa', eyebrow: '#ffb3cf', footer: '#a9bfa5',
      tool: ['#e86a9a', '#5aa356', '#f2c14e'],
      bannerText: '#2d3a2a', bannerBg: 'linear-gradient(90deg,#ffc6dc,#fff1a8,#c8f0c0)',
      decor: `${floaters('fall', ['🌸', '🌼', '🦋'], 10, [14, 24])}<span class="hub-corner">🌷🌼🌸</span>`,
    }),

    easter: seasonal({
      key: 'easter', label: 'Easter 🐣',
      fonts: GF + 'Chewy&display=swap',
      headingFont: 'Chewy,Inter,sans-serif', headingSpacing: '.01em',
      banner: '🐣 Happy Easter from the Inbound team! · ¡Felices Pascuas! 🐰',
      ink: '#3b2a4f', muted: '#76688a', line: '#ece3f2', paper: '#fffdfe',
      accent: '#9b6bd3', accentSoft: '#f1e9fb', accent2: '#4fb8a4', accent2Soft: '#e2f5f1', glow: 'rgba(155,107,211,.4)',
      background: `radial-gradient(circle at 80% 10%,rgba(255,240,180,.30) 0,transparent 20%),linear-gradient(180deg,#2a2140 0%,#3a2f5a 55%,#3f3a62 100%) fixed`,
      topbar: 'rgba(42,33,64,.92)', edge: '#4c4272', onDark: '#e2dbf1', headline: '#fffaf0', eyebrow: '#ffd98a', footer: '#b3aacb',
      tool: ['#9b6bd3', '#4fb8a4', '#f5a3c0'],
      bannerText: '#3b2a4f', bannerBg: 'linear-gradient(90deg,#f5c6e0,#fff3b0,#c6f0e6,#d9c9f5)',
      decor: `${floaters('rise', ['🥚', '🐣', '🌷'], 8, [16, 24])}<span class="hub-corner">🐰🧺🥚</span>`,
    }),

    cincodemayo: seasonal({
      key: 'cincodemayo', label: 'Cinco de Mayo 🪅',
      fonts: GF + 'Lilita+One&display=swap',
      headingFont: '"Lilita One",Inter,sans-serif', headingSpacing: '.01em',
      banner: '🪅 ¡Feliz Cinco de Mayo! · Happy Cinco de Mayo from the Inbound team 🌮',
      ink: '#2b1d14', muted: '#6e5b4c', line: '#efdfcc',
      accent: '#e4572e', accentSoft: '#fde5dc', accent2: '#1a9e77', accent2Soft: '#ddf3ec', glow: 'rgba(228,87,46,.45)',
      background: `radial-gradient(circle at 80% 10%,rgba(255,200,90,.30) 0,transparent 20%),linear-gradient(180deg,#2b1206 0%,#3d1c0a 55%,#3a240c 100%) fixed`,
      topbar: 'rgba(43,18,6,.92)', edge: '#5a3018', onDark: '#f1dcc8', headline: '#fff4e2', eyebrow: '#ffc145', footer: '#c3a387',
      tool: ['#e4572e', '#1a9e77', '#ffc145'],
      bannerText: '#fff4e2', bannerBg: '#3d1c0a', bannerEdge: 'repeating-linear-gradient(90deg,#e4572e 0 40px,#ffc145 40px 80px,#1a9e77 80px 120px,#d62f8a 120px 160px,#2f7fd6 160px 200px)',
      decor: `${floaters('fall', ['🎉', '🌶️', '🪅'], 9, [16, 24])}<span class="hub-corner">🪅🌮🎺</span>`,
    }),

    madres: seasonal({
      key: 'madres', label: 'Día de las Madres 🌷',
      fonts: GF + 'Dancing+Script:wght@700&display=swap',
      headingFont: '"Dancing Script",Georgia,cursive', headingWeight: 700, headingSpacing: '0',
      banner: '🌷 ¡Feliz Día de las Madres! · Happy Mother’s Day to all the moms on our team 💐',
      ink: '#4a1f3a', muted: '#86617a', line: '#f1dce8', paper: '#fffafd',
      accent: '#d4508a', accentSoft: '#fce4ef', accent2: '#8c5bb8', accent2Soft: '#f1e8f8', glow: 'rgba(212,80,138,.4)',
      background: `radial-gradient(circle at 80% 10%,rgba(255,200,225,.30) 0,transparent 20%),linear-gradient(180deg,#2c1124 0%,#43193a 55%,#4a1f44 100%) fixed`,
      topbar: 'rgba(44,17,36,.92)', edge: '#5e2a52', onDark: '#f0d6e6', headline: '#fff2f8', eyebrow: '#ffa8cc', footer: '#c9a2bb',
      tool: ['#d4508a', '#8c5bb8', '#f2a3c4'],
      bannerText: '#4a1f3a', bannerBg: 'linear-gradient(90deg,#ffc6dc,#ffe9f2,#ffc6dc)',
      decor: `${floaters('rise', ['🌷', '🌸', '💐', '💗'], 9, [16, 24])}<span class="hub-corner">💐🌷💌</span>`,
    }),

    patriotic: seasonal({
      key: 'patriotic', label: 'Red, White & Blue 🇺🇸',
      fonts: GF + 'Alfa+Slab+One&display=swap',
      headingFont: '"Alfa Slab One",Georgia,serif', headingSpacing: '0',
      banner: '🇺🇸 Honoring those who serve, and celebrating together · Gracias a quienes sirven ⭐',
      ink: '#14213d', muted: '#5a6680', line: '#e1e4ec', paper: '#fdfdff',
      accent: '#c1272d', accentSoft: '#fbe2e3', accent2: '#2a4d9b', accent2Soft: '#e5ecf9', glow: 'rgba(193,39,45,.4)',
      background: `radial-gradient(circle at 80% 10%,rgba(255,255,255,.14) 0,transparent 20%),linear-gradient(180deg,#0a1630 0%,#122450 55%,#16285a 100%) fixed`,
      topbar: 'rgba(10,22,48,.92)', edge: '#26386b', onDark: '#d4dcf0', headline: '#ffffff', eyebrow: '#ff8a8f', footer: '#a3afcf',
      tool: ['#c1272d', '#2a4d9b', '#c9ced9'],
      bannerText: '#fff', bannerBg: '#14213d', bannerEdge: 'repeating-linear-gradient(90deg,#c1272d 0 24px,#ffffff 24px 48px)',
      decor: `${floaters('fall', ['⭐', '✨', '🎆'], 10, [14, 22])}<span class="hub-corner">🇺🇸⭐🎆</span>`,
    }),

    summer: seasonal({
      key: 'summer', label: 'Summer ☀️',
      fonts: GF + 'Righteous&display=swap',
      headingFont: 'Righteous,Inter,sans-serif', headingSpacing: '0',
      banner: '☀️ Stay cool and hydrated out there! · ¡Manténganse frescos e hidratados! 💧',
      ink: '#123b48', muted: '#56737c', line: '#dcebee', paper: '#fdffff',
      accent: '#ff8c42', accentSoft: '#ffeadb', accent2: '#1aa6b7', accent2Soft: '#ddf4f7', glow: 'rgba(255,140,66,.45)',
      background: `radial-gradient(circle at 82% 8%,rgba(255,220,120,.55) 0,rgba(255,200,90,.15) 7%,transparent 18%),linear-gradient(180deg,#0b2a3a 0%,#0f4157 55%,#135066 100%) fixed`,
      topbar: 'rgba(11,42,58,.92)', edge: '#1f5872', onDark: '#cfe9f0', headline: '#fffaf0', eyebrow: '#ffc15e', footer: '#9cc3cf',
      tool: ['#ff8c42', '#1aa6b7', '#ffd166'],
      bannerText: '#123b48', bannerBg: 'linear-gradient(90deg,#ffd166,#ffb36b,#7fdbe8)',
      decor: `${floaters('rise', ['🫧', '☀️', '🌊'], 8, [14, 22])}<span class="hub-corner">🌴🕶️🍉</span>`,
    }),

    safety: seasonal({
      key: 'safety', label: 'Safety Week 🦺',
      fonts: GF + 'Oswald:wght@700&display=swap',
      headingFont: 'Oswald,Inter,sans-serif', headingWeight: 700, headingSpacing: '.01em',
      banner: '🦺 Safety Week: lift with your legs, keep aisles clear, wear your PPE · ¡La seguridad primero! ⚠️',
      ink: '#1d1d1d', muted: '#5f5f5f', line: '#e6e1d3',
      accent: '#ff7a00', accentSoft: '#ffe9d3', accent2: '#f2c400', accent2Soft: '#fff6cc', glow: 'rgba(255,122,0,.45)',
      background: `linear-gradient(180deg,#151515 0%,#1f1f1f 55%,#262626 100%) fixed`,
      topbar: 'rgba(21,21,21,.94)', edge: '#3a3a3a', onDark: '#dedede', headline: '#ffffff', eyebrow: '#ffb000', footer: '#a7a7a7',
      tool: ['#ff7a00', '#f2c400', '#7a7a7a'],
      bannerText: '#1d1d1d', bannerBg: '#f2c400', bannerEdge: 'repeating-linear-gradient(135deg,#1d1d1d 0 12px,#f2c400 12px 24px)',
      decor: `<span class="hub-corner">🦺⛑️🧤</span>`,
    }),

    laborday: seasonal({
      key: 'laborday', label: 'Labor Day 🛠️',
      fonts: GF + 'Anton&display=swap',
      headingFont: 'Anton,Inter,sans-serif', headingSpacing: '.01em',
      banner: '🛠️ Happy Labor Day! Thank you for your hard work · ¡Feliz Día del Trabajo! 💪',
      ink: '#1f2a36', muted: '#5f6b78', line: '#e2e4e2',
      accent: '#d9822b', accentSoft: '#fbe9d6', accent2: '#2e5d8c', accent2Soft: '#e3edf7', glow: 'rgba(217,130,43,.45)',
      background: `radial-gradient(circle at 80% 10%,rgba(255,190,110,.25) 0,transparent 20%),linear-gradient(180deg,#141c26 0%,#1f2c3c 55%,#26364a 100%) fixed`,
      topbar: 'rgba(20,28,38,.92)', edge: '#34465c', onDark: '#d4dce6', headline: '#fff6ea', eyebrow: '#f5b26b', footer: '#a3b0bf',
      tool: ['#d9822b', '#2e5d8c', '#8a96a3'],
      bannerText: '#1f2a36', bannerBg: 'linear-gradient(90deg,#f5b26b,#ffe0b8,#f5b26b)',
      decor: `<span class="hub-corner">🛠️💪📦</span>`,
    }),

    warehouseworker: seasonal({
      key: 'warehouseworker', label: 'Warehouse Worker Day 📦',
      fonts: GF + 'Bebas+Neue&display=swap',
      headingFont: '"Bebas Neue",Inter,sans-serif', headingSpacing: '.03em',
      banner: '📦 Happy Warehouse Worker Day! Nothing ships without you · ¡Gracias por todo su trabajo! 🚚',
      ink: '#2a2118', muted: '#6d6152', line: '#e8dfd0', paper: '#fffcf6',
      accent: '#c98a3d', accentSoft: '#f8ead6', accent2: '#3d7a5a', accent2Soft: '#e2f1e8', glow: 'rgba(201,138,61,.45)',
      background: `radial-gradient(circle at 80% 10%,rgba(255,210,150,.25) 0,transparent 20%),linear-gradient(180deg,#1c150e 0%,#2b2016 55%,#33271b 100%) fixed`,
      topbar: 'rgba(28,21,14,.92)', edge: '#4a3a29', onDark: '#e6dacb', headline: '#fff6e8', eyebrow: '#f0b46a', footer: '#b5a690',
      tool: ['#c98a3d', '#3d7a5a', '#8a7a66'],
      bannerText: '#2a2118', bannerBg: 'linear-gradient(90deg,#c98a3d,#f0cf9a,#c98a3d)',
      decor: `${floaters('fly', ['📦', '🚚'], 3, [18, 26])}<span class="hub-corner">📦🚚🏷️</span>`,
    }),

    hispanic: seasonal({
      key: 'hispanic', label: 'Hispanic Heritage Month 🌎',
      fonts: GF + 'Lilita+One&display=swap',
      headingFont: '"Lilita One",Inter,sans-serif', headingSpacing: '.01em',
      banner: '🌎 Celebrating our heritage · Celebrando nuestra herencia · Hispanic Heritage Month 🎶',
      ink: '#2b1a2e', muted: '#6e5b70', line: '#ecdcd6',
      accent: '#e2402f', accentSoft: '#fde3df', accent2: '#1b8a6b', accent2Soft: '#dff3ec', glow: 'rgba(226,64,47,.45)',
      background: `radial-gradient(circle at 80% 10%,rgba(255,200,90,.28) 0,transparent 20%),linear-gradient(180deg,#1f0f24 0%,#331737 55%,#3c1c2e 100%) fixed`,
      topbar: 'rgba(31,15,36,.92)', edge: '#4f2c52', onDark: '#ead6e6', headline: '#fff4ea', eyebrow: '#ffc145', footer: '#bea4b8',
      tool: ['#e2402f', '#1b8a6b', '#f2b134'],
      bannerText: '#fff4ea', bannerBg: '#331737', bannerEdge: 'repeating-linear-gradient(90deg,#e2402f 0 40px,#f2b134 40px 80px,#1b8a6b 80px 120px,#2f6fd6 120px 160px)',
      decor: `${floaters('fall', ['🎶', '🌺', '✨'], 8, [14, 22])}<span class="hub-corner">🌎🎶🌺</span>`,
    }),

    fall: seasonal({
      key: 'fall', label: 'Fall 🍁',
      fonts: GF + 'Caveat+Brush&display=swap',
      headingFont: '"Caveat Brush",Georgia,cursive', headingSpacing: '0',
      banner: '🍁 Happy fall from the Inbound team! · ¡Feliz otoño! 🍂',
      ink: '#3a2414', muted: '#7a5e48', line: '#ecdcc6',
      accent: '#c4561d', accentSoft: '#fbe4d6', accent2: '#7a8b2c', accent2Soft: '#eef2dc', glow: 'rgba(196,86,29,.45)',
      background: `radial-gradient(circle at 80% 10%,rgba(255,190,110,.28) 0,transparent 20%),linear-gradient(180deg,#24140b 0%,#371f10 55%,#3f2914 100%) fixed`,
      topbar: 'rgba(36,20,11,.92)', edge: '#573620', onDark: '#ecd6be', headline: '#fff2df', eyebrow: '#f3a35b', footer: '#c0a184',
      tool: ['#c4561d', '#7a8b2c', '#d9a441'],
      bannerText: '#3a2414', bannerBg: 'linear-gradient(90deg,#d9a441,#ef8e4f,#c4561d,#ef8e4f,#d9a441)',
      decor: `${floaters('fall', ['🍁', '🍂'], 9, [16, 26])}<span class="hub-corner">🍁🎃🍎</span>`,
    }),

    muertos: seasonal({
      key: 'muertos', label: 'Día de los Muertos 💀',
      fonts: GF + 'Sancreek&display=swap',
      headingFont: 'Sancreek,Georgia,serif', headingSpacing: '.01em',
      banner: '💀 Día de los Muertos · Remembering and celebrating our loved ones 🌼',
      ink: '#2a1236', muted: '#6c5277', line: '#ead9e2',
      accent: '#f28c28', accentSoft: '#fde9d4', accent2: '#d6337f', accent2Soft: '#fbe2ee', glow: 'rgba(242,140,40,.45)',
      background: `radial-gradient(circle at 80% 10%,rgba(255,170,60,.28) 0,transparent 20%),radial-gradient(ellipse at 50% 120%,rgba(214,51,127,.25),transparent 55%),linear-gradient(180deg,#140a1f 0%,#26113a 55%,#2b1236 100%) fixed`,
      topbar: 'rgba(20,10,31,.92)', edge: '#3f2556', onDark: '#e3d2ee', headline: '#fff2e0', eyebrow: '#ffb347', footer: '#b39cc4',
      tool: ['#f28c28', '#d6337f', '#36b5a6'],
      bannerText: '#fff2e0', bannerBg: '#26113a', bannerEdge: 'repeating-linear-gradient(90deg,#f28c28 0 40px,#d6337f 40px 80px,#36b5a6 80px 120px,#ffd23f 120px 160px,#8e5bd6 160px 200px)',
      decor: `${floaters('fall', ['🌼', '🏵️'], 9, [16, 24])}<span class="hub-corner">💀🌼🕯️</span>`,
    }),

    peak: seasonal({
      key: 'peak', label: 'Peak Season 🚚',
      fonts: GF + 'Bungee&display=swap',
      headingFont: 'Bungee,Inter,sans-serif', headingSpacing: '0',
      banner: "🚚 Peak season — we've got this! Thank you for the extra push · ¡Vamos, equipo! 💪",
      ink: '#14213d', muted: '#5a6680', line: '#e1e4ec',
      accent: '#ff5a1f', accentSoft: '#ffe5da', accent2: '#00a6a6', accent2Soft: '#d9f4f4', glow: 'rgba(255,90,31,.45)',
      background: `radial-gradient(circle at 80% 10%,rgba(0,200,200,.18) 0,transparent 20%),linear-gradient(180deg,#0b1220 0%,#132036 55%,#182842 100%) fixed`,
      topbar: 'rgba(11,18,32,.92)', edge: '#25385a', onDark: '#d2dcec', headline: '#ffffff', eyebrow: '#ff9566', footer: '#a0aec6',
      tool: ['#ff5a1f', '#00a6a6', '#f2c14e'],
      bannerText: '#fff', bannerBg: 'linear-gradient(90deg,#ff5a1f,#ff8a4c,#ff5a1f)',
      decor: `${floaters('fly', ['🚚', '📦'], 3, [18, 26])}<span class="hub-corner">🚚📦💪</span>`,
    }),

    birthday: seasonal({
      key: 'birthday', label: 'Birthday month 🎂',
      fonts: GF + 'Baloo+2:wght@800&display=swap',
      headingFont: '"Baloo 2",Inter,sans-serif', headingWeight: 800, headingSpacing: '-.01em',
      banner: '🎂 Happy birthday to everyone celebrating this month! · ¡Feliz cumpleaños! 🎈',
      ink: '#2a1f4a', muted: '#6a618a', line: '#e6e0f2',
      accent: '#ff5c8a', accentSoft: '#ffe3ec', accent2: '#4a7bf7', accent2Soft: '#e5ecfe', glow: 'rgba(255,92,138,.45)',
      background: `radial-gradient(circle at 80% 10%,rgba(255,200,230,.25) 0,transparent 20%),linear-gradient(180deg,#181238 0%,#251c52 55%,#2b2160 100%) fixed`,
      topbar: 'rgba(24,18,56,.92)', edge: '#3a3070', onDark: '#dcd6f2', headline: '#fff7fb', eyebrow: '#ffb3c9', footer: '#aaa3cc',
      tool: ['#ff5c8a', '#4a7bf7', '#ffd23f'],
      bannerText: '#fff', bannerBg: 'linear-gradient(90deg,#ff5c8a,#ffb03b,#4a7bf7,#8e5bd6)',
      extra: `html[data-hub-theme="birthday"] .hub-theme-banner{text-shadow:0 1px 3px rgba(0,0,0,.45)}`,
      decor: `${floaters('rise', ['🎈', '🎈', '🎉'], 9, [18, 28])}<span class="hub-corner">🎂🎁🎈</span>`,
    }),
  };

  // ---- Automatic mode: a holiday calendar (Eastern time) ----
  // Holidays win over seasons; a season fills every other day.
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const utc = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
  const plus = (d, n) => new Date(d.getTime() + n * 86400000);
  const nthWeekday = (y, m, weekday, n) => { const first = utc(y, m, 1); return plus(first, ((weekday - first.getUTCDay() + 7) % 7) + (n - 1) * 7); };
  const lastWeekday = (y, m, weekday) => { const last = utc(y, m + 1, 0); return plus(last, -((last.getUTCDay() - weekday + 7) % 7)); };
  function easterSunday(y) { // Anonymous Gregorian algorithm
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return utc(y, month, day);
  }
  function calendar(y) {
    const r = (key, from, to, note) => ({ key, from: iso(from), to: iso(to), note });
    const easter = easterSunday(y);
    const firstFridayMarch = nthWeekday(y, 3, 5, 1);
    const memorial = lastWeekday(y, 5, 1);
    const safetyMonday = nthWeekday(y, 8, 1, 2);
    const laborDay = nthWeekday(y, 9, 1, 1);
    const workerDay = nthWeekday(y, 9, 0, 2); // second Sunday of September
    const thanksgiving = nthWeekday(y, 11, 4, 4);
    return [
      r('newyear', utc(y, 1, 1), utc(y, 1, 2), "New Year's"),
      r('reyes', utc(y, 1, 5), utc(y, 1, 6), 'Día de Reyes'),
      r('valentines', utc(y, 2, 7), utc(y, 2, 14), "Valentine's Day"),
      r('appreciation', plus(firstFridayMarch, -4), firstFridayMarch, 'Employee Appreciation Day'),
      r('stpatricks', utc(y, 3, 14), utc(y, 3, 17), "St. Patrick's Day"),
      r('easter', plus(easter, -3), plus(easter, 1), 'Easter'),
      r('cincodemayo', utc(y, 5, 1), utc(y, 5, 5), 'Cinco de Mayo'),
      r('madres', utc(y, 5, 8), utc(y, 5, 10), 'Día de las Madres'),
      r('patriotic', plus(memorial, -4), memorial, 'Memorial Day'),
      r('patriotic', utc(y, 6, 28), utc(y, 7, 5), 'Fourth of July'),
      r('safety', safetyMonday, plus(safetyMonday, 4), 'Safety Week'),
      r('laborday', plus(laborDay, -5), laborDay, 'Labor Day'),
      r('warehouseworker', plus(workerDay, -4), plus(workerDay, 1), 'Warehouse Worker Day'),
      r('hispanic', utc(y, 9, 15), utc(y, 10, 15), 'Hispanic Heritage Month'),
      r('halloween', utc(y, 10, 16), utc(y, 10, 31), 'Halloween'),
      r('muertos', utc(y, 11, 1), utc(y, 11, 2), 'Día de los Muertos'),
      r('patriotic', utc(y, 11, 9), utc(y, 11, 11), 'Veterans Day'),
      r('thanksgiving', plus(thanksgiving, -3), plus(thanksgiving, 3), 'Thanksgiving'),
      r('christmas', utc(y, 12, 1), utc(y, 12, 30), 'Christmas'),
      r('newyear', utc(y, 12, 31), utc(y, 12, 31), "New Year's"),
    ];
  }
  const SEASONS = [[1, 'winter'], [2, 'winter'], [3, 'spring'], [4, 'spring'], [5, 'spring'], [6, 'summer'], [7, 'summer'], [8, 'summer'], [9, 'fall'], [10, 'fall'], [11, 'fall'], [12, 'winter']];
  function easternToday() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  }
  function autoFor(day = easternToday()) {
    const y = Number(day.slice(0, 4));
    const hit = calendar(y).find((e) => day >= e.from && day <= e.to);
    if (hit) return { key: hit.key, note: hit.note };
    const season = SEASONS[Number(day.slice(5, 7)) - 1][1];
    return { key: season, note: THEMES[season].label.replace(/\s*\S+$/u, '') };
  }
  // The next few changes automatic mode will make, for the Admin picker.
  function upcoming(count = 6, from = easternToday()) {
    const out = [];
    let day = utc(Number(from.slice(0, 4)), Number(from.slice(5, 7)), Number(from.slice(8, 10)));
    let last = autoFor(iso(day)).key;
    for (let n = 1; n < 400 && out.length < count; n += 1) {
      const d = iso(plus(day, n));
      const pick = autoFor(d);
      if (pick.key !== last) { out.push({ date: d, ...pick, label: THEMES[pick.key].label }); last = pick.key; }
    }
    return out;
  }

  let current = '';
  let currentBanner = '';
  const fontsLoaded = {};
  // setting: '' (standard), 'auto' (holiday calendar) or a theme key.
  // banner: optional text that replaces the theme's own banner.
  function apply(setting, banner = '') {
    const resolved = setting === 'auto' ? autoFor().key : setting;
    const theme = THEMES[resolved] ? resolved : '';
    try { localStorage.setItem(STORE, JSON.stringify({ setting: setting || '', banner: banner || '' })); } catch {}
    if (theme === current && (banner || '') === currentBanner) return;
    current = theme;
    currentBanner = banner || '';
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
    const bannerText = currentBanner || t.banner;
    const place = () => {
      if (current !== theme || !document.body) return;
      if (bannerText && !document.querySelector('.hub-theme-banner')) {
        const el = document.createElement('div');
        el.className = 'hub-theme-banner';
        el.textContent = bannerText;
        document.querySelector('.topbar')?.after(el);
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
  try {
    const raw = localStorage.getItem(STORE) || '';
    const saved = raw.startsWith('{') ? JSON.parse(raw) : { setting: raw, banner: '' };
    apply(saved.setting || '', saved.banner || '');
  } catch {}

  window.HubTheme = {
    apply,
    current: () => current,
    auto: autoFor,
    upcoming,
    list: () => [{ key: '', label: 'Standard' }, ...Object.entries(THEMES).map(([key, t]) => ({ key, label: t.label }))],
  };
})();
