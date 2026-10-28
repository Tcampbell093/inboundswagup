// Labor board (under "Today at a glance"): where you work today, what's on the
// floor this morning, and UPH. Team Leads and Admins fill it in each morning.
(() => {
  const API = '/.netlify/functions/hub-today';
  const host = document.getElementById('laborBoard');
  if (!host) return;
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => (n === null || n === undefined || n === '' ? '—' : Number(n).toLocaleString());
  const pct = (uph, goal) => (goal && uph !== null ? Math.round((uph / goal) * 100) : null);
  let state = null;
  let panel = '';
  let message = '';
  let uphDay = '';

  const style = document.createElement('style');
  style.textContent = `
    .lb{padding:56px 0 50px;border-top:1px solid var(--line);display:grid;grid-template-columns:1.05fr .95fr;gap:44px;align-items:start}
    .lb-hello{font-size:14px;font-weight:800;color:var(--muted);margin:18px 0 6px}
    .lb-where{font-size:clamp(44px,6vw,78px);line-height:.92;letter-spacing:-.06em;margin:0 0 10px;color:var(--ink)}
    .lb-where small{display:block;font-size:.42em;letter-spacing:-.02em;color:var(--muted);margin-bottom:6px;font-weight:800}
    .lb-es{font-size:17px;color:#56635e;margin:0 0 18px}
    .lb-mates{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:0 0 16px}
    .lb-mates span{font-size:13px;font-weight:800;border:1px solid var(--line);background:var(--paper);border-radius:999px;padding:6px 11px}
    .lb-mates b{font-size:12px;color:var(--muted);font-weight:800;margin-right:4px}
    .lb-clean{display:flex;gap:10px;align-items:center;border:1px solid #f6c6ad;background:var(--orange-soft);color:#a74921;border-radius:14px;padding:12px 14px;font-size:14px;font-weight:800;margin:0 0 18px;max-width:560px}
    .lb-side{display:grid;gap:14px}
    .lb-moved{display:inline-flex;flex-direction:column;gap:2px;margin:0 0 18px;padding:10px 14px;border:2px solid #c05026;background:var(--orange-soft);border-radius:14px;font-size:14px}
    .lb-moved b{color:#a74921}
    .lb-card{background:rgba(255,255,255,.86);border:1px solid var(--line);border-radius:22px;padding:18px 20px;box-shadow:var(--shadow)}
    .lb-card h3{margin:0 0 2px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#c05026}
    .lb-date{font-size:13px;color:var(--muted);margin:0 0 10px}
    .lb-note{font-size:12px;color:var(--muted);margin:8px 0 0;line-height:1.45}
    .lb-table{width:100%;border-collapse:collapse;font-size:14px}
    .lb-table th{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);font-weight:900;padding:0 4px 6px;text-align:left}
    .lb-table td{padding:9px 4px;border-top:1px solid var(--line);color:#3d4a45}
    .lb-table td small{display:block;font-size:11px;color:var(--muted);font-weight:800}
    .lb-table .lb-num{text-align:right;font-variant-numeric:tabular-nums}
    .lb-table td.lb-num{font-size:18px;font-weight:800;color:var(--ink)}
    .lb-table td.lb-num em{font-style:normal;font-size:11px;font-weight:900;margin-left:6px}
    .lb-table tr.lb-mine td{background:var(--green-soft)}
    .lb-table tr.lb-mine td:first-child{border-radius:10px 0 0 10px;font-weight:800;color:var(--ink)}
    .lb-table tr.lb-mine td:last-child{border-radius:0 10px 10px 0}
    .lb-table tr.lb-mine small.lb-yours{color:var(--green)}
    .lb-table tfoot td{font-weight:900;color:var(--ink)}
    .lb-table tfoot td.lb-num{font-size:15px}
    .lb-table td.lb-need{border-left:1px dashed var(--line)}
    .lb-good{color:var(--green)}.lb-warn{color:#b26a00}.lb-behind{color:#c05026!important}.lb-ahead{color:var(--green)!important}
    .lb-floor{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
    .lb-floor div{border:1px solid var(--line);border-radius:14px;padding:10px 12px;background:var(--paper)}
    .lb-floor b{display:block;font-size:14px}.lb-floor small{font-size:12px;color:var(--muted)}
    .lb-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:4px}
    .lb-actions button{border:1px solid var(--ink);background:var(--ink);color:#fff;border-radius:12px;padding:10px 14px;font-weight:900;cursor:pointer}
    .lb-actions button.ghost{background:var(--paper);color:var(--ink);border-color:var(--line)}
    .lb-actions button:disabled{opacity:.6;cursor:default}
    .lb-form{margin-top:12px}
    .lb-form input,.lb-form select{font:inherit;font-size:14px;border:1px solid var(--line);border-radius:9px;padding:6px 8px;background:#fff;text-align:right}
    .lb-form select{text-align:left}
    .lb-msg{font-size:13px;font-weight:800;margin:10px 0 0}
    .lb-msg.err{color:#8f2d22}.lb-msg.ok{color:var(--green)}
    .lb-empty{font-size:14px;color:var(--muted);padding:6px 0}
    .lb-expect{margin:12px 0 0;padding-top:12px;border-top:1px solid var(--line);font-size:15px;line-height:1.5;color:var(--ink);white-space:pre-line}
    .lb-expect b{display:block;font-size:12px;color:var(--muted);margin-bottom:2px}
    .lb-table td small.lb-read{color:var(--muted);font-size:11px}
    @media(max-width:900px){.lb{grid-template-columns:1fr;gap:24px;padding-top:36px}}
  `;
  document.head.appendChild(style);

  function floorCard(d, myDept) {
    if (!d.board.some((r) => r.pos !== null || r.units !== null)) {
      return `<div class="lb-card"><h3>On the floor today</h3><p class="lb-date">${esc(d.dateLabel)}</p>
        <p class="lb-empty">A Team Lead hasn't posted today's numbers yet.</p>${d.expect ? `<p class="lb-expect"><b>What to expect · Qué esperar</b>${esc(d.expect)}</p>` : ''}</div>`;
    }
    const rows = d.board.map((r) => {
      const asm = r.department === 'Assembly';
      return `<tr${r.department === myDept ? ' class="lb-mine"' : ''}>
      <td>${esc(r.department)}${r.department === myDept ? '<small class="lb-yours">your team</small>' : ''}${asm && r.packs !== null ? `<small>${fmt(r.packs)} packs</small>` : ''}</td>
      <td class="lb-num">${fmt(r.pos)}<small>${asm ? 'orders' : 'POs'}</small></td><td class="lb-num">${fmt(r.units)}<small>units</small></td></tr>`;
    }).join('');
    const units = d.board.reduce((t, r) => t + (r.units || 0), 0);
    return `<div class="lb-card"><h3>On the floor today</h3><p class="lb-date">${esc(d.dateLabel)}${d.boardBy ? ` · posted by ${esc(d.boardBy)}` : ''}</p>
      <table class="lb-table"><tbody>${rows}</tbody>
      <tfoot><tr><td>Total units</td><td></td><td class="lb-num">${fmt(units)}</td></tr></tfoot></table>${d.expect ? `<p class="lb-expect"><b>What to expect · Qué esperar</b>${esc(d.expect)}</p>` : ''}</div>`;
  }

  function uphCard(d, myDept) {
    const rows = d.uph.map((r) => {
      const p = pct(r.yesterday, r.goal);
      const behind = r.minimum !== null && r.goal && r.minimum > r.goal;
      return `<tr${r.department === myDept ? ' class="lb-mine"' : ''}><td>${esc(r.department)}<small>goal ${fmt(r.goal)}</small></td>
        <td class="lb-num">${fmt(r.yesterday)}${p !== null ? `<em class="${p >= 100 ? 'lb-good' : 'lb-warn'}">${p}%</em>` : ''}${r.yesterday === null && r.read ? `<small class="lb-read">pending ADP · we thought: ${esc(r.read)}</small>` : ''}</td>
        <td class="lb-num">${fmt(r.month)}</td>
        <td class="lb-num lb-need ${behind ? 'lb-behind' : 'lb-ahead'}">${fmt(r.minimum)}</td></tr>`;
    }).join('');
    return `<div class="lb-card"><h3>UPH</h3><p class="lb-date">Yesterday = ${esc(d.lastWorkdayLabel)} · Month = ${esc(d.monthName)}</p>
      <table class="lb-table"><thead><tr><th></th><th class="lb-num">Yesterday</th><th class="lb-num">Month avg</th><th class="lb-num">Today's minimum</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="lb-note">Month avg is the average of the daily UPHs entered this month. Today's minimum is what each team needs to average today and every workday left this month (Mon–Fri) to finish ${esc(d.monthName)} at its goal. Orange means the team is behind and has to beat its goal to catch up.</p></div>`;
  }

  function leadTools(d) {
    if (!d.canEdit) return '';
    let form = '';
    if (panel === 'board') {
      const day = uphDay || d.lastWorkday;
      const past = (dept) => (d.history || []).find((h) => h.date === day && h.department === dept) || {};
      form = `<div class="lb-card lb-form"><h3>Morning board · ${esc(d.dateLabel)}</h3><p class="lb-date">Enter official UPH from ADP, or fix today's floor numbers. Everyone sees it as soon as you save.</p>
        <p class="lb-date">UPH for <input type="date" data-lb-day value="${esc(day)}" max="${esc(d.lastWorkday)}" style="text-align:left"> ${day === d.lastWorkday ? '(last workday)' : '(correcting a past day)'}</p>
        <table class="lb-table"><thead><tr><th></th><th class="lb-num">POs / orders</th><th class="lb-num">Units</th><th class="lb-num">Packs</th><th class="lb-num">UPH</th><th class="lb-num">Goal</th></tr></thead><tbody>
        ${d.board.map((r) => { const u = d.uph.find((x) => x.department === r.department) || {}; const h = past(r.department); return `<tr data-dept="${esc(r.department)}"><td><b>${esc(r.department)}</b></td>
          <td class="lb-num"><input inputmode="numeric" name="pos" value="${r.pos ?? ''}" style="width:64px" aria-label="${esc(r.department)} POs"></td>
          <td class="lb-num"><input inputmode="numeric" name="units" value="${r.units ?? ''}" style="width:82px" aria-label="${esc(r.department)} units"></td>
          <td class="lb-num">${r.department === 'Assembly' ? `<input inputmode="numeric" name="packs" value="${r.packs ?? ''}" style="width:64px" aria-label="Assembly packs">` : ''}</td>
          <td class="lb-num"><input inputmode="decimal" name="uph" value="${h.uph ?? ''}" style="width:72px" aria-label="${esc(r.department)} UPH"></td>
          <td class="lb-num"><input inputmode="numeric" name="goal" value="${u.goal ?? ''}" style="width:58px" aria-label="${esc(r.department)} goal"></td></tr>`; }).join('')}
        </tbody></table>
        <div class="lb-actions" style="margin-top:12px"><button type="button" data-lb-save="board">Save board</button><button type="button" class="ghost" data-lb-close>Cancel</button></div></div>`;
    } else if (panel === 'people') {
      form = `<div class="lb-card lb-form"><h3>Who works where today</h3><p class="lb-date">Same-day changes to today's plan. Tomorrow's plan is set in End of day.</p>
        <table class="lb-table">${d.roster.map((p) => `<tr data-id="${p.id}"><td><b>${esc(p.name)}</b>${p.today !== p.home ? `<small>home: ${esc(p.home)}</small>` : ''}</td>
          <td class="lb-num"><select aria-label="${esc(p.name)} works in">${[...d.departments, 'Off'].map((dep) => `<option${dep === p.today ? ' selected' : ''}>${esc(dep)}</option>`).join('')}</select></td></tr>`).join('')}</table>
        <div class="lb-actions" style="margin-top:12px"><button type="button" data-lb-save="people">Save</button><button type="button" class="ghost" data-lb-close>Cancel</button></div></div>`;
    }
    return `<div class="lb-actions"><button type="button" data-lb-eod>End of day</button><button type="button" data-lb-huddle>Start huddle</button><button type="button" class="ghost" data-lb-open="board">Enter UPH</button><button type="button" class="ghost" data-lb-open="people">Who works where</button></div>
      ${message ? `<p class="lb-msg ${message.startsWith('!') ? 'err' : 'ok'}">${esc(message.replace(/^!/, ''))}</p>` : ''}${form}`;
  }

  function render() {
    const d = state;
    if (!d) return;
    const me = d.me;
    if (me) {
      host.innerHTML = `
        <div>
          <div class="kicker">✣ ${esc(d.dateLabel)}</div>
          <p class="lb-hello">Good morning, ${esc(me.name)}</p>
          ${me.department === 'Off' ? `<h2 class="lb-where"><small>Today</small>You're off</h2><p class="lb-es">Hoy no trabajas</p>` : `<h2 class="lb-where"><small>Today you work in</small>${esc(me.department)}</h2>
          <p class="lb-es">Hoy trabajas en ${esc(me.departmentEs)}</p>
          ${me.moved ? `<p class="lb-moved"><b>Moved for today</b>You usually work in ${esc(me.homeDepartment)}.</p>` : ''}`}
          ${me.teammates.length ? `<div class="lb-mates"><b>With you today:</b>${me.teammates.map((n) => `<span>${esc(n)}</span>`).join('')}</div>` : ''}
          ${me.cleaning ? `<div class="lb-clean">🧹 You're also on cleaning today: ${esc(me.cleaning.area)} · 15 min <a href="#today" style="margin-left:auto;color:inherit">Open ↗</a></div>` : ''}
          ${leadTools(d)}
        </div>
        <div class="lb-side">${floorCard(d, me.department)}${uphCard(d, me.department)}</div>`;
    } else {
      host.innerHTML = `
        <div><div class="kicker">✣ ${esc(d.dateLabel)}</div>
          <h2 class="lb-where" style="margin-top:22px">Where do you<br>work today?</h2>
          <p class="lb-es">Sign in to see your station and your team.<br>Inicia sesión para ver dónde trabajas hoy.</p>
          <a class="primary" href="#" data-lb-signin>Sign in to see yours ↗</a>
          <div class="lb-card" style="margin-top:22px;max-width:520px"><h3>Where the team is today</h3><p class="lb-date">Names show after you sign in.</p>
            <div class="lb-floor">${d.floor.map((f) => `<div><b>${esc(f.department)}</b><small>${f.count} ${f.count === 1 ? 'person' : 'people'}</small></div>`).join('')}</div></div></div>
        <div class="lb-side">${floorCard(d, '')}${uphCard(d, '')}</div>`;
    }
    wire();
  }

  function wire() {
    host.querySelector('[data-lb-signin]')?.addEventListener('click', (e) => { e.preventDefault(); window.HubAssociate?.open?.(); });
    host.querySelectorAll('[data-lb-open]').forEach((b) => { b.onclick = () => { panel = panel === b.dataset.lbOpen ? '' : b.dataset.lbOpen; message = ''; render(); }; });
    host.querySelectorAll('[data-lb-close]').forEach((b) => { b.onclick = () => { panel = ''; render(); }; });
    host.querySelector('[data-lb-eod]')?.addEventListener('click', openEndOfDay);
    host.querySelector('[data-lb-huddle]')?.addEventListener('click', openHuddle);
    host.querySelectorAll('[data-lb-save]').forEach((b) => { b.onclick = () => save(b.dataset.lbSave, b); });
    host.querySelector('[data-lb-day]')?.addEventListener('change', (e) => {
      // Keep typed POs/units; reload UPH for the chosen day.
      const typed = [...host.querySelectorAll('tr[data-dept]')].map((tr) => [tr.dataset.dept, tr.querySelector('[name=pos]').value, tr.querySelector('[name=units]').value]);
      uphDay = e.target.value;
      render();
      typed.forEach(([dept, pos, units]) => { const tr = host.querySelector(`tr[data-dept="${CSS.escape(dept)}"]`); if (tr) { tr.querySelector('[name=pos]').value = pos; tr.querySelector('[name=units]').value = units; } });
    });
  }

  async function save(kind, button) {
    const body = kind === 'board'
      ? { action: 'saveBoard', uphDate: uphDay || state.lastWorkday, board: [...host.querySelectorAll('tr[data-dept]')].map((tr) => ({
        department: tr.dataset.dept,
        pos: tr.querySelector('[name=pos]').value, units: tr.querySelector('[name=units]').value, packs: tr.querySelector('[name=packs]')?.value ?? '',
        uph: tr.querySelector('[name=uph]').value, goal: tr.querySelector('[name=goal]').value,
      })) }
      : { action: 'saveAssignments', assignments: [...host.querySelectorAll('tr[data-id]')].map((tr) => ({ id: Number(tr.dataset.id), department: tr.querySelector('select').value })) };
    button.disabled = true;
    try {
      const response = await fetch(API, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not save.');
      state = data;
      panel = '';
      uphDay = '';
      message = kind === 'board' ? 'Morning board saved.' : "Today's assignments saved.";
    } catch (error) {
      message = `!${error.message || 'Could not save.'}`;
    }
    render();
  }

  // ---- End of day (Team Leads and Admins): a 4-step close-out in a modal ----
  // Saves how today went (for today) and the plan (for the next workday).
  const DEPTS3 = ['QA Receiving', 'QA Prep', 'Assembly'];
  const READS = ['On track', 'Close', 'Behind', 'Unsure'];
  let eod = null;
  const eodStyle = document.createElement('style');
  eodStyle.textContent = `
    .eod-back{position:fixed;inset:0;z-index:1000;background:rgba(22,48,42,.55);display:flex;justify-content:center;align-items:flex-start;padding:4vh 12px;overflow-y:auto}
    .eod{width:100%;max-width:1040px;background:#fcfbf8;border-radius:24px;box-shadow:0 24px 60px rgba(0,0,0,.25);display:flex;flex-direction:column;overflow:hidden;color:var(--ink)}
    .eod-head{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:18px 24px;border-bottom:1px solid var(--line)}
    .eod-head h3{margin:0;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#c05026}
    .eod-head p{margin:2px 0 0;font-size:13px;color:var(--muted)}
    .eod-head-main{min-width:0;flex:1}
    .eod-head-tools{display:flex;align-items:center;gap:9px;flex-wrap:wrap;justify-content:flex-end}
    .eod-date{display:flex;align-items:center;gap:7px;font-size:11px;font-weight:900;color:var(--muted);white-space:nowrap}
    .eod-date input{font:inherit;font-size:13px;font-weight:800;min-height:40px;padding:7px 9px;border:1px solid var(--line);border-radius:10px;background:#fff;color:var(--ink)}
    .eod-history-note{font-size:11px;font-weight:800;color:#a74921}
    .eod-x{min-width:44px;min-height:44px;border-radius:12px;border:1px solid var(--line);background:#fff;font-size:20px;cursor:pointer}
    .eod-steps{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;padding:12px 24px 0}
    .eod-steps button{font:inherit;text-align:left;display:flex;gap:8px;align-items:center;padding:10px;border-radius:12px;border:none;background:transparent;cursor:pointer;font-weight:800;font-size:13px;color:var(--ink);min-height:48px}
    .eod-steps button span{width:24px;height:24px;flex-shrink:0;border-radius:999px;display:grid;place-items:center;font-size:12px;border:2px solid #b9b3a3;color:var(--muted)}
    .eod-steps button.on{background:var(--ink);color:#fff}.eod-steps button.on span{background:#fff;border-color:#fff;color:var(--ink)}
    .eod-steps button.done span{background:var(--green);border-color:var(--green);color:#fff}
    .eod-body{padding:22px 24px;display:flex;flex-direction:column;gap:18px;max-height:64vh;overflow-y:auto}
    .eod-body h2{margin:0;font-size:26px;letter-spacing:-.02em}.eod-sub{margin:4px 0 0;font-size:14px;color:var(--muted)}
    .eod-read{display:grid;grid-template-columns:140px 1fr;gap:14px;padding:12px 0;border-top:1px solid var(--line);align-items:center}
    .eod-read div{display:flex;gap:8px;flex-wrap:wrap}
    .eod-chip{font:inherit;font-size:13px;font-weight:800;min-height:44px;padding:0 14px;border-radius:12px;border:1px solid #d6d1c4;background:#fff;color:var(--ink);cursor:pointer}
    .eod-chip.on{background:var(--ink);border-color:var(--ink);color:#fff}.eod-chip.on.behind{background:#a2461f;border-color:#a2461f}
    .eod label.eod-l{display:flex;flex-direction:column;gap:6px;font-size:13px;font-weight:800}
    .eod textarea,.eod input{font:inherit;font-size:15px;color:var(--ink);border:1px solid #d6d1c4;border-radius:12px;padding:10px 12px;background:#fff}
    .eod textarea{resize:vertical;min-height:84px}
    .eod-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px}
    .eod-col{border:1px solid var(--line);background:#fff;border-radius:16px;padding:12px;display:flex;flex-direction:column;gap:6px;min-height:120px}
    .eod-col.off{border-style:dashed;background:transparent}.eod-col.over{border:2px solid #c05026;background:var(--orange-soft)}
    .eod-col header{display:flex;justify-content:space-between;font-weight:800;font-size:14px}.eod-col header span{color:var(--muted);font-weight:700}
    .eod-p{font:inherit;text-align:left;min-height:44px;padding:6px 10px;border-radius:10px;border:1px solid var(--line);background:#f7f5ef;color:var(--ink);font-weight:700;cursor:grab;display:flex;flex-direction:column;justify-content:center}
    .eod-p small{font-size:11px;color:#8e3a17}.eod-p.moved{border:2px solid #c05026;background:var(--orange-soft)}.eod-p.picked{border:2px solid var(--ink);background:#dce8e2}
    .eod-here{font:inherit;font-size:13px;font-weight:800;min-height:44px;border-radius:10px;border:2px dashed #c05026;background:var(--orange-soft);color:#8e3a17;cursor:pointer}
    .eod-floor{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}
    .eod-floor section{border:1px solid var(--line);background:#fff;border-radius:16px;padding:16px;display:flex;flex-direction:column;gap:10px}
    .eod-floor input{font-size:20px;font-weight:800;min-height:48px}
    .eod-rev{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}
    .eod-rev section{border:1px solid var(--line);background:#fff;border-radius:16px;padding:16px;display:flex;flex-direction:column;gap:6px;font-size:14px}
    .eod-rev h4{margin:0 0 4px;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#c05026}
    .eod-rev div{display:flex;justify-content:space-between;gap:8px}.eod-rev p{margin:6px 0 0;padding-top:6px;border-top:1px solid var(--line);white-space:pre-line;color:#3d5a50}
    .eod-foot{display:flex;justify-content:space-between;gap:12px;padding:14px 24px;border-top:1px solid var(--line);background:#f7f5ef;align-items:center;flex-wrap:wrap}
    .eod-foot button{font:inherit;font-size:15px;font-weight:900;min-height:48px;padding:0 22px;border-radius:14px;cursor:pointer}
    .eod-foot .ghost{border:1px solid #d6d1c4;background:#fff;color:var(--ink)}.eod-foot .go{border:none;background:var(--ink);color:#fff}
    .eod-msg{font-size:13px;font-weight:800;color:#8f2d22}
    @media(max-width:700px){.eod-steps{grid-template-columns:repeat(2,minmax(0,1fr))}.eod-read{grid-template-columns:1fr}}
    .hud{position:fixed;inset:0;z-index:1000;background:#16302a;color:#fff;overflow-y:auto;padding:32px clamp(16px,4vw,48px);display:flex;flex-direction:column}
    .hud-in{max-width:1200px;width:100%;margin:0 auto;display:flex;flex-direction:column;gap:26px;flex-grow:1}
    .hud-top{display:flex;justify-content:space-between;align-items:center;gap:12px}
    .hud-top b{font-size:14px;letter-spacing:.16em;text-transform:uppercase;color:#f3d9cb}
    .hud h1{margin:0;font-size:clamp(44px,6vw,72px);letter-spacing:-.04em;line-height:1}
    .hud-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:18px}
    .hud-card{background:#21443b;border-radius:24px;padding:24px;display:flex;flex-direction:column;gap:8px}
    .hud-card.pend{background:transparent;border:2px dashed #4e6e66}
    .hud-big{font-size:clamp(56px,7vw,92px);font-weight:900;line-height:.9;letter-spacing:-.04em}
    .hud-dim{color:#b9cbc4;font-size:17px}
    .hud-tag{align-self:flex-start;font-size:17px;font-weight:900;padding:7px 13px;border-radius:12px}
    .hud-hit{background:#cfe8db;color:#16302a}.hud-miss{background:#f3d9cb;color:#6e2a0e}.hud-wait{border:2px solid #8fa8a0;color:#d5e0db}
    .hud-note{background:#21443b;border-radius:20px;padding:20px 24px;font-size:21px;line-height:1.45;white-space:pre-line}
    .hud-note b{display:block;font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#f3d9cb;margin-bottom:4px}
    .hud-moves{display:flex;flex-wrap:wrap;gap:10px}.hud-moves span{font-size:21px;padding:10px 16px;border-radius:14px;background:#f3d9cb;color:#16302a}
    .hud-names{font-size:23px;line-height:1.55;font-weight:700}
    .hud-nums{display:flex;gap:26px;flex-wrap:wrap}.hud-nums div{font-size:56px;font-weight:900;line-height:1}.hud-nums small{display:block;font-size:15px;font-weight:600;color:#b9cbc4}
    .hud-foot{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:auto}
    .hud-foot button{font:inherit;font-weight:900;font-size:17px;min-height:56px;padding:0 24px;border-radius:16px;cursor:pointer}
    .hud-prev{border:2px solid #4e6e66;background:transparent;color:#fff}.hud-next{border:none;background:#f3d9cb;color:#16302a}.hud-x{border:2px solid #4e6e66;background:transparent;color:#fff;min-width:56px}
  `;
  document.head.appendChild(eodStyle);

  const EOD_DRAFT_PREFIX = 'hubEodDraft:';
  function eodDraftKey(day) { return EOD_DRAFT_PREFIX + String(day || ''); }
  function readEodDraft(day) {
    try {
      const raw = localStorage.getItem(eodDraftKey(day));
      const draft = raw ? JSON.parse(raw) : null;
      return draft && draft.workDate === day ? draft : null;
    } catch { return null; }
  }
  function persistEodDraft() {
    if (!eod?.workDate || eod.busy) return;
    try {
      localStorage.setItem(eodDraftKey(eod.workDate), JSON.stringify({
        workDate: eod.workDate,
        reads: eod.reads,
        issues: eod.issues,
        expect: eod.expect,
        at: eod.at,
        floor: eod.floor,
        updatedAt: Date.now(),
      }));
    } catch {}
  }
  function clearEodDraft(day) {
    try { localStorage.removeItem(eodDraftKey(day)); } catch {}
  }
  function buildEod(c) {
    const floor = {};
    c.floor.forEach((r) => { floor[r.department] = { pos: r.pos ?? '', units: r.units ?? '', packs: r.packs ?? '' }; });
    const base = {
      step: 1,
      workDate: c.today,
      closeOut: c,
      reads: { ...c.reads },
      issues: c.issues || '',
      expect: c.expect || '',
      at: Object.fromEntries(c.people.map((p) => [p.id, p.plan])),
      floor,
      picked: null,
      over: '',
      busy: false,
      loading: false,
      error: '',
      restoredDraft: false,
    };
    const draft = readEodDraft(c.today);
    if (!draft) return base;
    return {
      ...base,
      reads: { ...base.reads, ...(draft.reads || {}) },
      issues: draft.issues ?? base.issues,
      expect: draft.expect ?? base.expect,
      at: { ...base.at, ...(draft.at || {}) },
      floor: { ...base.floor, ...(draft.floor || {}) },
      restoredDraft: true,
    };
  }
  function openEndOfDay() {
    const c = state?.closeOut;
    if (!c) return;
    eod = buildEod(c);
    document.body.style.overflow = 'hidden';
    drawEod();
  }
  async function loadEodDate(day) {
    if (!eod || !day || day === eod.workDate) return;
    persistEodDraft();
    eod.loading = true;
    eod.error = '';
    drawEod();
    try {
      const response = await fetch(API + '?closeOutDate=' + encodeURIComponent(day), { cache: 'no-store', credentials: 'same-origin' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not load that End-of-Day date.');
      eod = buildEod(data.closeOut);
      drawEod();
    } catch (error) {
      eod.loading = false;
      eod.error = error.message || 'Could not load that End-of-Day date.';
      drawEod();
    }
  }
  function closeEod() { eod = null; document.querySelector('.eod-back')?.remove(); document.body.style.overflow = ''; }

  function eodStepHtml(c) {
    if (eod.step === 1) {
      return `<div><h2>How did today go?</h2><p class="eod-sub">Your read before ADP. Official UPH gets entered tomorrow with Enter UPH.</p></div>
        <div>${DEPTS3.map((dep) => `<div class="eod-read"><b>${esc(dep)}</b><div>${READS.map((r) => `<button type="button" class="eod-chip${eod.reads[dep] === r ? ' on' : ''}${r === 'Behind' ? ' behind' : ''}" data-read="${esc(dep)}" data-val="${esc(r)}" aria-pressed="${eod.reads[dep] === r}">${esc(r)}</button>`).join('')}</div></div>`).join('')}</div>
        <label class="eod-l">Issues today<textarea data-f="issues" rows="4" placeholder="Short staffed, equipment, late trucks…">${esc(eod.issues)}</textarea></label>`;
    }
    if (eod.step === 2) {
      const cols = [...(state.departments || []), 'Off'];
      const pickedName = eod.picked ? c.people.find((p) => p.id === eod.picked)?.name : '';
      return `<div><h2>Who goes where ${esc(c.planLabel.split(',')[0])}?</h2><p class="eod-sub">Drag a name to a department, or tap a name and then "Move here". Everyone starts in their home department.</p></div>
        <div class="eod-cols">${cols.map((dep) => {
          const ppl = c.people.filter((p) => eod.at[p.id] === dep);
          return `<div class="eod-col${dep === 'Off' ? ' off' : ''}${eod.over === dep ? ' over' : ''}" data-col="${esc(dep)}"><header>${esc(dep === 'Off' ? 'Off / not in' : dep)}<span>${ppl.length}</span></header>
            ${ppl.map((p) => `<button type="button" draggable="true" class="eod-p${p.home !== dep ? ' moved' : ''}${eod.picked === p.id ? ' picked' : ''}" data-pid="${p.id}" aria-pressed="${eod.picked === p.id}">${esc(p.name)}${p.home !== dep ? `<small>from ${esc(p.home)}</small>` : ''}</button>`).join('')}
            ${eod.picked && eod.at[eod.picked] !== dep ? `<button type="button" class="eod-here" data-here="${esc(dep)}">Move ${esc(pickedName)} here</button>` : ''}</div>`;
        }).join('')}</div>
        <div class="lb-actions"><button type="button" class="ghost" data-home>Everyone back home</button></div>`;
    }
    if (eod.step === 3) {
      const f = eod.floor;
      const field = (dep, key, labelText) => `<label class="eod-l">${labelText}<input inputmode="numeric" placeholder="0" data-floor="${esc(dep)}" data-key="${key}" value="${esc(f[dep][key])}"></label>`;
      return `<div><h2>What's on the floor ${esc(c.planLabel.split(',')[0])}?</h2><p class="eod-sub">What each department should expect to work on.</p></div>
        <div class="eod-floor">
          <section><b>QA Receiving</b>${field('QA Receiving', 'pos', 'POs')}${field('QA Receiving', 'units', 'Units')}</section>
          <section><b>QA Prep</b>${field('QA Prep', 'pos', 'POs')}${field('QA Prep', 'units', 'Units')}</section>
          <section><b>Assembly</b>${field('Assembly', 'pos', 'Orders')}${field('Assembly', 'units', 'Total units')}${field('Assembly', 'packs', 'Packs')}</section>
        </div>
        <label class="eod-l">What to expect ${esc(c.planLabel.split(',')[0])}<textarea data-f="expect" rows="3" placeholder="Big POs landing, priorities, who's in late…">${esc(eod.expect)}</textarea></label>`;
    }
    const moves = c.people.filter((p) => eod.at[p.id] !== p.home);
    const f = eod.floor;
    const v = (x) => (x === '' || x === null ? '—' : esc(x));
    return `<div><h2>Look it over, then save</h2><p class="eod-sub">Associates see the plan on the morning of ${esc(c.planLabel)}.</p></div>
      <div class="eod-rev">
        <section><h4>Today (${esc(c.todayLabel)})</h4>${DEPTS3.map((d) => `<div><span>${esc(d)}</span><b>${esc(eod.reads[d] || 'Not set')}</b></div>`).join('')}<p>${esc(eod.issues || 'No issues noted.')}</p></section>
        <section><h4>Moves for ${esc(c.planLabel.split(',')[0])}</h4>${moves.length ? moves.map((p) => `<div><b>${esc(p.name)}</b><span>${esc(p.home)} → <b>${esc(eod.at[p.id])}</b></span></div>`).join('') : '<div>Everyone in their home department.</div>'}</section>
        <section><h4>On the floor</h4>
          <div><span>QA Receiving</span><b>${v(f['QA Receiving'].pos)} POs · ${v(f['QA Receiving'].units)} units</b></div>
          <div><span>QA Prep</span><b>${v(f['QA Prep'].pos)} POs · ${v(f['QA Prep'].units)} units</b></div>
          <div><span>Assembly</span><b>${v(f.Assembly.pos)} orders · ${v(f.Assembly.units)} units · ${v(f.Assembly.packs)} packs</b></div>
          <p>${esc(eod.expect || 'No notes for tomorrow.')}</p></section>
      </div>`;
  }

  function drawEod() {
    if (!eod) return;
    const c = eod.closeOut;
    let back = document.querySelector('.eod-back');
    if (!back) { back = document.createElement('div'); back.className = 'eod-back'; document.body.appendChild(back); }
    const titles = ['How today went', 'Who goes where', 'Floor & expect', 'Review & save'];
    const scroll = back.querySelector('.eod-body')?.scrollTop || 0;
    back.innerHTML = `<div class="eod" role="dialog" aria-modal="true" aria-label="End of day">
      <div class="eod-head"><div class="eod-head-main"><h3>End of day · ${esc(c.todayLabel)}</h3><p>${eod.workDate === state.today ? 'Close out today' : 'Edit this workday'}, plan ${esc(c.planLabel)}${c.closedBy ? ` · last saved by ${esc(c.closedBy)}` : ''}</p>${eod.restoredDraft ? '<div class="eod-history-note">Unsaved draft restored for this date.</div>' : ''}</div><div class="eod-head-tools"><label class="eod-date">Workday <input type="date" data-eod-date value="${esc(eod.workDate)}" max="${esc(state.today)}"></label><button type="button" class="eod-x" data-x aria-label="Close">×</button></div></div>
      <div class="eod-steps">${titles.map((t, i) => `<button type="button" data-step="${i + 1}" class="${eod.step === i + 1 ? 'on' : eod.step > i + 1 ? 'done' : ''}"><span>${eod.step > i + 1 ? '✓' : i + 1}</span>${esc(t)}</button>`).join('')}</div>
      <div class="eod-body">${eodStepHtml(c)}</div>
      <div class="eod-foot"><button type="button" class="ghost" data-prev style="${eod.step === 1 ? 'visibility:hidden' : ''}">Back</button>
        ${eod.error ? `<span class="eod-msg">${esc(eod.error)}</span>` : ''}
        <button type="button" class="go" data-next ${eod.busy || eod.loading ? 'disabled' : ''}>${eod.loading ? 'Loading…' : (eod.step === 4 ? (eod.busy ? 'Saving…' : 'Save close-out & plan') : 'Next')}</button></div></div>`;
    back.querySelector('.eod-body').scrollTop = scroll;
    wireEod(back);
  }

  function wireEod(back) {
    const move = (id, dep) => { if (!id) return; eod.at[id] = dep; eod.picked = null; eod.over = ''; persistEodDraft(); drawEod(); };
    back.querySelector('[data-x]').onclick = closeEod;
    const dateInput = back.querySelector('[data-eod-date]');
    if (dateInput) dateInput.onchange = () => loadEodDate(dateInput.value);
    back.querySelectorAll('[data-step]').forEach((b) => { b.onclick = () => { eod.step = Number(b.dataset.step); drawEod(); }; });
    back.querySelector('[data-prev]').onclick = () => { eod.step = Math.max(1, eod.step - 1); drawEod(); };
    back.querySelector('[data-next]').onclick = () => { if (eod.step < 4) { eod.step += 1; drawEod(); } else submitEod(); };
    back.querySelectorAll('[data-read]').forEach((b) => { b.onclick = () => { const d = b.dataset.read; eod.reads[d] = eod.reads[d] === b.dataset.val ? '' : b.dataset.val; persistEodDraft(); drawEod(); }; });
    back.querySelectorAll('[data-f]').forEach((t) => { t.oninput = () => { eod[t.dataset.f] = t.value; persistEodDraft(); }; });
    back.querySelectorAll('[data-floor]').forEach((i) => { i.oninput = () => { i.value = i.value.replace(/[^0-9,]/g, ''); eod.floor[i.dataset.floor][i.dataset.key] = i.value; persistEodDraft(); }; });
    back.querySelector('[data-home]')?.addEventListener('click', () => { eod.closeOut.people.forEach((p) => { eod.at[p.id] = p.home; }); eod.picked = null; persistEodDraft(); drawEod(); });
    back.querySelectorAll('[data-pid]').forEach((b) => {
      const id = Number(b.dataset.pid);
      b.onclick = () => { eod.picked = eod.picked === id ? null : id; drawEod(); };
      b.ondragstart = (e) => { e.dataTransfer.setData('text/plain', String(id)); e.dataTransfer.effectAllowed = 'move'; };
    });
    back.querySelectorAll('[data-here]').forEach((b) => { b.onclick = () => move(eod.picked, b.dataset.here); });
    back.querySelectorAll('[data-col]').forEach((col) => {
      const dep = col.dataset.col;
      col.ondragover = (e) => { e.preventDefault(); if (eod.over !== dep) { eod.over = dep; back.querySelectorAll('[data-col]').forEach((x) => x.classList.toggle('over', x === col)); } };
      col.ondragleave = (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove('over'); };
      col.ondrop = (e) => { e.preventDefault(); move(Number(e.dataTransfer.getData('text/plain')), dep); };
    });
  }

  async function submitEod() {
    const c = eod.closeOut;
    eod.busy = true; eod.error = ''; drawEod();
    const body = {
      action: 'closeOut', workDate: eod.workDate, reads: eod.reads, issues: eod.issues, expect: eod.expect,
      assignments: c.people.map((p) => ({ id: p.id, department: eod.at[p.id] })),
      floor: DEPTS3.map((dep) => ({ department: dep, ...eod.floor[dep] })),
    };
    try {
      const response = await fetch(API, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not save.');
      state = data;
      clearEodDraft(eod.workDate);
      message = `End of day saved for ${c.todayLabel}. ${c.planLabel} is planned.`;
      closeEod();
      render();
    } catch (error) {
      eod.busy = false; eod.error = error.message || 'Could not save.'; drawEod();
    }
  }

  // ---- Morning huddle: full-screen slides from yesterday's close-out ----
  let hud = 0;
  function openHuddle() { hud = 0; document.body.style.overflow = 'hidden'; drawHuddle(); }
  function closeHuddle() { document.querySelector('.hud')?.remove(); document.body.style.overflow = ''; document.removeEventListener('keydown', hudKeys); }
  function hudKeys(e) { if (e.key === 'Escape') closeHuddle(); if (e.key === 'ArrowRight') { hud = Math.min(2, hud + 1); drawHuddle(); } if (e.key === 'ArrowLeft') { hud = Math.max(0, hud - 1); drawHuddle(); } }
  function drawHuddle() {
    const d = state;
    let el = document.querySelector('.hud');
    if (!el) { el = document.createElement('div'); el.className = 'hud'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Morning huddle'); document.body.appendChild(el); document.addEventListener('keydown', hudKeys); }
    const titles = [`How ${d.lastWorkdayLabel.split(',')[0]} went`, 'Who goes where', 'On the floor today'];
    let slide = '';
    if (hud === 0) {
      slide = `<h1>${esc(titles[0])}</h1><div class="hud-grid">${d.uph.map((r) => {
        if (r.yesterday === null) return `<div class="hud-card pend"><b style="font-size:19px">${esc(r.department)}</b><div class="hud-big" style="color:#8fa8a0">—</div><div class="hud-dim">Goal ${fmt(r.goal)}${r.read ? ` · We thought: ${esc(r.read)}` : ''}</div><span class="hud-tag hud-wait">Waiting on ADP</span></div>`;
        const hit = r.goal && r.yesterday >= r.goal;
        return `<div class="hud-card"><b style="font-size:19px">${esc(r.department)}</b><div class="hud-big">${fmt(r.yesterday)}</div><div class="hud-dim">Goal ${fmt(r.goal)}</div><span class="hud-tag ${hit ? 'hud-hit' : 'hud-miss'}">${hit ? '✓ Hit it' : `✕ Missed by ${fmt(r.goal - r.yesterday)}`}</span></div>`;
      }).join('')}</div>${d.lastIssues ? `<div class="hud-note"><b>What got in the way</b>${esc(d.lastIssues)}</div>` : ''}`;
    } else if (hud === 1) {
      const moves = (d.roster || []).filter((p) => p.today !== p.home);
      const groups = {};
      (d.roster || []).forEach((p) => { if (p.today !== 'Off') (groups[p.today] = groups[p.today] || []).push(p.name); });
      slide = `<h1>Who goes where</h1>
        ${moves.length ? `<div class="hud-moves">${moves.map((p) => `<span><b>${esc(p.name)}</b> ${p.today === 'Off' ? '· off' : `→ ${esc(p.today)}`}</span>`).join('')}</div>` : ''}
        <div class="hud-grid">${Object.entries(groups).map(([dep, names]) => `<div class="hud-card"><b style="font-size:15px;letter-spacing:.12em;text-transform:uppercase;color:#b9cbc4">${esc(dep)}</b><div class="hud-names">${names.map(esc).join('<br>')}</div></div>`).join('')}</div>`;
    } else {
      slide = `<h1>On the floor today</h1><div class="hud-grid">${d.board.map((r) => `<div class="hud-card"><b style="font-size:19px">${esc(r.department)}</b><div class="hud-nums">
        <div>${fmt(r.pos)}<small>${r.department === 'Assembly' ? 'orders' : 'POs'}</small></div><div>${fmt(r.units)}<small>units</small></div>${r.department === 'Assembly' ? `<div>${fmt(r.packs)}<small>packs</small></div>` : ''}</div></div>`).join('')}</div>
        ${d.expect ? `<div class="hud-note"><b>What to expect</b>${esc(d.expect)}</div>` : ''}`;
    }
    el.innerHTML = `<div class="hud-in"><div class="hud-top"><b>Morning huddle · ${esc(d.dateLabel)}</b><span class="hud-dim">${hud + 1} of 3</span></div>${slide}
      <div class="hud-foot"><button type="button" class="hud-x" data-hx aria-label="Close huddle">×</button><div style="display:flex;gap:10px">
      ${hud > 0 ? `<button type="button" class="hud-prev" data-hp>Back</button>` : ''}${hud < 2 ? `<button type="button" class="hud-next" data-hn>${esc(titles[hud + 1])}</button>` : `<button type="button" class="hud-next" data-hx2>Done</button>`}</div></div></div>`;
    el.querySelector('[data-hx]').onclick = closeHuddle;
    el.querySelector('[data-hx2]')?.addEventListener('click', closeHuddle);
    el.querySelector('[data-hp]')?.addEventListener('click', () => { hud -= 1; drawHuddle(); });
    el.querySelector('[data-hn]')?.addEventListener('click', () => { hud += 1; drawHuddle(); });
  }

  async function load() {
    try {
      const response = await fetch(API, { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) return;
      state = await response.json();
      render();
    } catch { /* leave the section empty */ }
  }

  host.classList.add('lb');
  document.addEventListener('hub-associate-session', load);
  document.addEventListener('hub-associate-ready', load);
  load();
})();
