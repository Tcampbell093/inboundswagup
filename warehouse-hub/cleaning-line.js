// Cleaning line: who cleans next, kept as a pure planner so it can be tested
// outside the browser. Rules, in order:
//  1. Inbound people clean Inbound areas, Outbound people clean Outbound areas
//     (a person's side comes from their home department).
//  2. Nobody marked unavailable is scheduled.
//  3. Nobody cleans two working days in a row (Friday -> Monday counts) unless
//     there is literally nobody else.
//  4. Whoever has worked the most days since their last clean goes first.
//     Days someone is out don't count, so leave pauses their place in line.
//  5. Each chosen person gets the area they have cleaned least recently.
// Backups are the next people in line and do not move anyone's place.
// Any assignment that isn't missed counts as happening, including today's and
// next week's, so planning ahead never waits for duties to be marked done.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HubCleaningLine = api;
})(typeof self !== 'undefined' ? self : this, () => {
  'use strict';
  const SIDE_RE = /fulfill?ment|outbound|inventory|shipping|dispatch|pack.?out/i;
  const iso = d => d.toISOString().slice(0, 10);
  const addDays = (day, n) => { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
  const dow = day => new Date(day + 'T12:00:00Z').getUTCDay();
  const isWorkday = day => dow(day) >= 1 && dow(day) <= 5;
  const prevWorkday = day => { let d = addDays(day, -1); while (!isWorkday(d)) d = addDays(d, -1); return d; };
  const nextWorkday = day => { let d = addDays(day, 1); while (!isWorkday(d)) d = addDays(d, 1); return d; };
  const weekStart = day => addDays(day, -(dow(day) === 0 ? 6 : dow(day) - 1));
  const lower = v => String(v || '').trim().toLowerCase();
  // Stable tie-breaker so ties don't always favour the same (alphabetical) person.
  const jitter = (id, day) => { let h = 2166136261; for (const c of id + '|' + day) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };

  function model(data) {
    const departments = Array.isArray(data?.departments) ? data.departments : [];
    const deptByName = new Map(departments.map(d => [lower(d.name), d]));
    const areaSide = area => {
      const d = deptByName.get(lower(area));
      return d?.side === 'Outbound' || d?.side === 'Inbound' ? d.side : SIDE_RE.test(String(area || '')) ? 'Outbound' : 'Inbound';
    };
    const areas = departments.filter(d => d.active !== false && d.cleaningActive).map(d => d.name);
    const people = (data?.employees || []).filter(e => e.active !== false && e.role === 'Associate');
    // A home department that isn't a real department leaves the person off both lines
    // rather than guessing which side they belong to.
    const personSide = e => {
      const home = lower(e.homeDepartment);
      if (!home || home === 'unassigned' || !deptByName.has(home)) return null;
      return areaSide(e.homeDepartment);
    };
    const pools = { Inbound: [], Outbound: [] }, unplaced = [];
    for (const e of people) { const s = personSide(e); if (s) pools[s].push(e); else unplaced.push(e); }
    const away = new Set((data?.availability || []).filter(x => x.status === 'unavailable').map(x => x.employeeId + '|' + x.date));
    const available = (id, date) => !away.has(Number(id) + '|' + date);
    const rows = (data?.assignments || []).filter(a => a.status !== 'missed');
    const cleanerOf = a => Number(a.actualEmployeeId || a.employeeId) || 0;
    return { areas, areaSide, pools, unplaced, personSide, available, rows, cleanerOf, people };
  }

  // Replays history day by day and fills the open slots in date order.
  // open: Set of 'date|area' keys to (re)plan; every other row is kept as-is.
  function simulate(data, { today, open = new Set(), until }) {
    const m = model(data);
    const kept = m.rows.filter(a => !open.has(a.date + '|' + a.area));
    const keptByDate = new Map();
    for (const a of kept) { if (!keptByDate.has(a.date)) keptByDate.set(a.date, []); keptByDate.get(a.date).push(a); }
    const openByDate = new Map();
    for (const key of open) { const [date, area] = key.split('|'); if (!openByDate.has(date)) openByDate.set(date, []); openByDate.get(date).push(area); }
    const dates = [...keptByDate.keys(), ...openByDate.keys()].sort();
    const start = dates[0] && dates[0] < addDays(today, -120) ? dates[0] : addDays(today, -120);
    const end = [until, dates[dates.length - 1], today].filter(Boolean).sort().pop();

    const state = new Map(m.people.map(e => [e.id, { waiting: 0, last: null, lastArea: {}, recent: [] }]));
    const cleanersOn = new Map();
    const markCleaner = (date, id) => { if (!cleanersOn.has(date)) cleanersOn.set(date, new Set()); cleanersOn.get(date).add(id); };
    for (const a of kept) markCleaner(a.date, m.cleanerOf(a));
    const applyClean = (id, date, area) => {
      const s = state.get(id); if (!s) return;
      s.waiting = 0; s.last = date; s.lastArea[lower(area)] = date; s.recent.push(date);
    };
    const recentCount = (s, date) => s.recent.filter(d => d > addDays(date, -90)).length;
    const daysSince = (s, area, date) => {
      const d = s.lastArea[lower(area)];
      return d ? Math.round((Date.parse(date) - Date.parse(d)) / 86400000) : 9999;
    };
    const lineOrder = (pool, date) => pool.slice().sort((a, b) => {
      const sa = state.get(a.id), sb = state.get(b.id);
      return sb.waiting - sa.waiting || recentCount(sa, date) - recentCount(sb, date) || jitter(a.id, date) - jitter(b.id, date);
    });

    const planned = [], snapshots = new Map(), notes = [];
    for (let date = start; date <= end; date = addDays(date, 1)) {
      if (!isWorkday(date)) continue;
      // The line shown to leads is "who's next" after today's duties.
      if (date > today && !snapshots.has('today')) snapshots.set('today', snapshotLine());
      const todayKept = keptByDate.get(date) || [];
      const occupied = new Set(todayKept.flatMap(a => [a.employeeId, a.alternateEmployeeId, a.actualEmployeeId]).filter(Boolean).map(Number));
      for (const side of ['Inbound', 'Outbound']) {
        const areasHere = (openByDate.get(date) || []).filter(a => m.areaSide(a) === side);
        if (!areasHere.length) continue;
        const prev = cleanersOn.get(prevWorkday(date)) || new Set(), next = cleanersOn.get(nextWorkday(date)) || new Set();
        const eligible = lineOrder(m.pools[side].filter(p => m.available(p.id, date) && !occupied.has(p.id)), date);
        const rested = eligible.filter(p => !prev.has(p.id) && !next.has(p.id));
        const tired = eligible.filter(p => prev.has(p.id) || next.has(p.id));
        const chosen = [...rested, ...tired].slice(0, areasHere.length);
        for (const p of chosen.filter(p => tired.includes(p))) notes.push({ date, employeeId: p.id, text: 'back-to-back: not enough people available' });
        // Give each chosen person the area they've cleaned least recently: try every
        // pairing (there are only a handful) and keep the one whose worst repeat is
        // furthest back, then the best total.
        const pairing = bestPairing(chosen, areasHere, (p, a) => daysSince(state.get(p.id), a, date));
        for (const p of chosen) occupied.add(p.id);
        const leftover = eligible.filter(p => !occupied.has(p.id));
        const backupPool = [...leftover.filter(p => !prev.has(p.id) && !next.has(p.id)), ...leftover.filter(p => prev.has(p.id) || next.has(p.id))];
        for (const area of areasHere) {
          const p = pairing.get(area);
          if (!p) { planned.push({ assignmentDate: date, department: area, employeeId: 0, alternateEmployeeId: null }); notes.push({ date, area, text: 'nobody available' }); continue; }
          const backup = backupPool.shift() || null;
          if (backup) occupied.add(backup.id);
          planned.push({ assignmentDate: date, department: area, employeeId: p.id, alternateEmployeeId: backup?.id || null });
        }
      }
      // End of day: today's cleaners reset, everyone else who was here moves up a place.
      const cleaned = new Map();
      for (const a of todayKept) cleaned.set(m.cleanerOf(a), a.area);
      for (const r of planned.filter(r => r.assignmentDate === date && r.employeeId)) { cleaned.set(r.employeeId, r.department); markCleaner(date, r.employeeId); }
      for (const [id, s] of state) {
        if (cleaned.has(id)) applyClean(id, date, cleaned.get(id));
        else if (m.available(id, date)) s.waiting++;
      }
      if (date === today) snapshots.set('today', snapshotLine());
    }
    if (!snapshots.has('today')) snapshots.set('today', snapshotLine());
    return { planned, notes, line: snapshots.get('today'), model: m };

    function snapshotLine() {
      const out = {};
      for (const side of ['Inbound', 'Outbound']) {
        out[side] = lineOrder(m.pools[side], today).map((p, i) => {
          const s = state.get(p.id);
          return { id: p.id, name: p.name, homeDepartment: p.homeDepartment, position: i + 1, waiting: s.waiting, last: s.last,
            lastArea: { ...s.lastArea }, recent: recentCount(s, today), availableToday: m.available(p.id, today) };
        });
      }
      return out;
    }
  }

  function bestPairing(people, areas, gap) {
    const result = new Map();
    if (!people.length) return result;
    const n = Math.min(people.length, areas.length);
    if (areas.length > 7) { // too many to try every order; fall back to greedy
      const left = people.slice();
      for (const a of areas) { left.sort((x, y) => gap(y, a) - gap(x, a)); const p = left.shift(); if (p) result.set(a, p); }
      return result;
    }
    let best = null;
    const permute = (rest, picked) => {
      if (picked.length === n) {
        const gaps = picked.map((p, i) => Math.min(gap(p, areas[i]), 9999));
        const score = [Math.min(...gaps), gaps.reduce((s, g) => s + g, 0)];
        if (!best || score[0] > best.score[0] || (score[0] === best.score[0] && score[1] > best.score[1])) best = { score, picked: picked.slice() };
        return;
      }
      for (let i = 0; i < rest.length; i++) permute([...rest.slice(0, i), ...rest.slice(i + 1)], [...picked, rest[i]]);
    };
    permute(people, []);
    best.picked.forEach((p, i) => result.set(areas[i], p));
    return result;
  }

  // Empty slots on or after today in the given dates.
  function suggest(data, { today, dates }) {
    const m = model(data);
    const taken = new Set((data?.assignments || []).map(a => a.date + '|' + a.area));
    const open = new Set();
    for (const date of dates) if (date >= today && isWorkday(date)) for (const area of m.areas) if (!taken.has(date + '|' + area)) open.add(date + '|' + area);
    const out = simulate(data, { today, open, until: dates[dates.length - 1] });
    return { ...out, planned: out.planned.filter(r => r.employeeId) };
  }

  // Rows that can still be rebuilt: future, not started, not handed to a backup.
  const replannable = (a, from, today) => a.date >= from && a.date >= today && a.status === 'scheduled';

  // Rebuild every changeable slot from `from` through the end of the last week that has
  // a schedule (or from's own week). Returns old vs new for each slot that would change.
  function replan(data, { today, from, only = null }) {
    const m = model(data);
    const all = data?.assignments || [];
    const lastScheduled = all.filter(a => a.date >= from).map(a => a.date).sort().pop() || from;
    const until = addDays(weekStart(lastScheduled > from ? lastScheduled : from), 4);
    const open = new Set();
    const existing = new Map(all.map(a => [a.date + '|' + a.area, a]));
    for (let date = from < today ? today : from; date <= until; date = addDays(date, 1)) {
      if (!isWorkday(date)) continue;
      for (const area of m.areas) {
        const key = date + '|' + area, row = existing.get(key);
        if (only && !only.has(key)) continue;
        if (!row || replannable(row, from, today)) open.add(key);
      }
    }
    const out = simulate(data, { today, open, until });
    const changes = out.planned.map(r => {
      const row = existing.get(r.assignmentDate + '|' + r.department);
      return { ...r, before: row ? { employeeId: Number(row.employeeId) || 0, alternateEmployeeId: Number(row.alternateEmployeeId) || null } : null };
    }).filter(r => !r.before ? r.employeeId : r.before.employeeId !== r.employeeId || r.before.alternateEmployeeId !== r.alternateEmployeeId)
      // Never wipe a published person just because nobody else could be found.
      .filter(r => r.employeeId || !r.before);
    return { changes, notes: out.notes, until };
  }

  // Problems with assignments that haven't happened yet.
  function conflicts(data, { today }) {
    const m = model(data);
    const issues = [];
    const future = m.rows.filter(a => a.date >= today && ['scheduled', 'alternate_assigned'].includes(a.status));
    const cleanersOn = new Map();
    for (const a of m.rows) { const s = cleanersOn.get(a.date) || new Set(); s.add(m.cleanerOf(a)); cleanersOn.set(a.date, s); }
    const byPerson = new Map();
    for (const a of m.rows) for (const id of new Set([m.cleanerOf(a), Number(a.alternateEmployeeId) || 0])) if (id) {
      const k = id + '|' + a.date; byPerson.set(k, (byPerson.get(k) || 0) + 1);
    }
    for (const a of future) {
      const id = m.cleanerOf(a), backup = Number(a.alternateEmployeeId) || 0;
      const person = m.people.find(p => p.id === id), add = text => issues.push({ key: a.date + '|' + a.area, date: a.date, area: a.area, employeeId: id, text });
      if (!person) { add('is no longer an active associate'); continue; }
      if (!m.available(id, a.date)) add('is marked out that day');
      if (m.personSide(person) && m.personSide(person) !== m.areaSide(a.area)) add(`is ${m.personSide(person)}, but ${a.area} is ${m.areaSide(a.area)}`);
      if ((cleanersOn.get(prevWorkday(a.date)) || new Set()).has(id)) add(`also cleans ${prevWorkday(a.date)} (back-to-back)`);
      if ((byPerson.get(id + '|' + a.date) || 0) > 1) add('is booked twice that day');
      if (a.status === 'scheduled' && backup && !m.available(backup, a.date)) add('has a backup who is marked out');
    }
    return issues;
  }

  return { simulate, suggest, replan, conflicts, model, prevWorkday, nextWorkday, weekStart, addDays, isWorkday };
});
