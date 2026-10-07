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
    @media(max-width:900px){.lb{grid-template-columns:1fr;gap:24px;padding-top:36px}}
  `;
  document.head.appendChild(style);

  function floorCard(d, myDept) {
    if (!d.board.some((r) => r.pos !== null || r.units !== null)) {
      return `<div class="lb-card"><h3>On the floor this morning</h3><p class="lb-date">${esc(d.dateLabel)}</p>
        <p class="lb-empty">A Team Lead hasn't posted this morning's numbers yet.</p></div>`;
    }
    const rows = d.board.map((r) => `<tr${r.department === myDept ? ' class="lb-mine"' : ''}>
      <td>${esc(r.department)}${r.department === myDept ? '<small class="lb-yours">your team</small>' : ''}</td>
      <td class="lb-num">${fmt(r.pos)}</td><td class="lb-num">${fmt(r.units)}</td></tr>`).join('');
    const total = d.board.reduce((t, r) => ({ pos: t.pos + (r.pos || 0), units: t.units + (r.units || 0) }), { pos: 0, units: 0 });
    return `<div class="lb-card"><h3>On the floor this morning</h3><p class="lb-date">${esc(d.dateLabel)}${d.boardBy ? ` · posted by ${esc(d.boardBy)} at ${esc(d.boardAt)}` : ''}</p>
      <table class="lb-table"><thead><tr><th></th><th class="lb-num">POs</th><th class="lb-num">Units</th></tr></thead><tbody>${rows}</tbody>
      <tfoot><tr><td>Total</td><td class="lb-num">${fmt(total.pos)}</td><td class="lb-num">${fmt(total.units)}</td></tr></tfoot></table></div>`;
  }

  function uphCard(d, myDept) {
    const rows = d.uph.map((r) => {
      const p = pct(r.yesterday, r.goal);
      const behind = r.minimum !== null && r.goal && r.minimum > r.goal;
      return `<tr${r.department === myDept ? ' class="lb-mine"' : ''}><td>${esc(r.department)}<small>goal ${fmt(r.goal)}</small></td>
        <td class="lb-num">${fmt(r.yesterday)}${p !== null ? `<em class="${p >= 100 ? 'lb-good' : 'lb-warn'}">${p}%</em>` : ''}</td>
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
      form = `<div class="lb-card lb-form"><h3>Morning board · ${esc(d.dateLabel)}</h3><p class="lb-date">This morning's POs and units, plus UPH for a workday. Everyone sees it as soon as you save.</p>
        <p class="lb-date">UPH for <input type="date" data-lb-day value="${esc(day)}" max="${esc(d.lastWorkday)}" style="text-align:left"> ${day === d.lastWorkday ? '(last workday)' : '(correcting a past day)'}</p>
        <table class="lb-table"><thead><tr><th></th><th class="lb-num">POs</th><th class="lb-num">Units</th><th class="lb-num">UPH</th><th class="lb-num">Goal</th></tr></thead><tbody>
        ${d.board.map((r) => { const u = d.uph.find((x) => x.department === r.department) || {}; const h = past(r.department); return `<tr data-dept="${esc(r.department)}"><td><b>${esc(r.department)}</b></td>
          <td class="lb-num"><input inputmode="numeric" name="pos" value="${r.pos ?? ''}" style="width:64px" aria-label="${esc(r.department)} POs"></td>
          <td class="lb-num"><input inputmode="numeric" name="units" value="${r.units ?? ''}" style="width:82px" aria-label="${esc(r.department)} units"></td>
          <td class="lb-num"><input inputmode="decimal" name="uph" value="${h.uph ?? ''}" style="width:72px" aria-label="${esc(r.department)} UPH"></td>
          <td class="lb-num"><input inputmode="numeric" name="goal" value="${u.goal ?? ''}" style="width:58px" aria-label="${esc(r.department)} goal"></td></tr>`; }).join('')}
        </tbody></table>
        <div class="lb-actions" style="margin-top:12px"><button type="button" data-lb-save="board">Save board</button><button type="button" class="ghost" data-lb-close>Cancel</button></div></div>`;
    } else if (panel === 'people') {
      form = `<div class="lb-card lb-form"><h3>Who works where today</h3><p class="lb-date">Everyone starts in their home department. Changes reset tomorrow.</p>
        <table class="lb-table">${d.roster.map((p) => `<tr data-id="${p.id}"><td><b>${esc(p.name)}</b>${p.today !== p.home ? `<small>home: ${esc(p.home)}</small>` : ''}</td>
          <td class="lb-num"><select aria-label="${esc(p.name)} works in">${d.departments.map((dep) => `<option${dep === p.today ? ' selected' : ''}>${esc(dep)}</option>`).join('')}</select></td></tr>`).join('')}</table>
        <div class="lb-actions" style="margin-top:12px"><button type="button" data-lb-save="people">Save</button><button type="button" class="ghost" data-lb-close>Cancel</button></div></div>`;
    }
    return `<div class="lb-actions"><button type="button" data-lb-open="board">Morning board</button><button type="button" class="ghost" data-lb-open="people">Who works where</button></div>
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
          <h2 class="lb-where"><small>Today you work in</small>${esc(me.department)}</h2>
          <p class="lb-es">Hoy trabajas en ${esc(me.departmentEs)}${me.moved ? ` · moved from ${esc(me.homeDepartment)} for today` : ''}</p>
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
        pos: tr.querySelector('[name=pos]').value, units: tr.querySelector('[name=units]').value,
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
