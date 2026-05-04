'use strict';

const assemblyApiBase  = '/.netlify/functions/assembly';
const commentsApiBase  = '/.netlify/functions/flight-tracker-comments';
const REFRESH_MS       = 60000;

// ── State ──────────────────────────────────────────────────────────────────
const cmState = { pbId:'', pbName:'', so:'', account:'' };

const state = {
  scheduled:  [],
  board:      [],
  held:       [],
  filtered:   [],
  commentCounts: {},   // pbId|so -> count
  hasPriority:   {},   // pbId|so -> bool
  requestFlags:  {},   // pbId|so -> 'hold' | 'date'
  updatedAt:  null,
  groupBy:    'day',   // 'day' | 'sord'
};

const STORAGE_KEYS = {
  board:     'ops_hub_assembly_board_v2',
  scheduled: 'ops_hub_scheduled_queue_v1',
  revenue:   'ops_hub_revenue_reference_v1',
  held:      'ops_hub_issue_hold_queue_v1',
};

// Photo feature state (defined early so renderBoard can reference it)
const PHOTOS_API_EARLY = '/.netlify/functions/flight-tracker-photos';
const photoCountCache = {};
let ftUserRole = 'external';

function normRole(role) {
  return String(role || '').trim().toLowerCase();
}

function resolveFtRole() {
  // Prefer in-memory auth user when available
  const liveRole = normRole(window.hcCurrentUser && window.hcCurrentUser.role);
  if (liveRole) return liveRole;

  // Fall back to persisted auth session
  try {
    const raw = localStorage.getItem('hcAuthUser');
    if (raw) {
      const parsed = JSON.parse(raw);
      const storedRole = normRole(parsed && parsed.role);
      if (storedRole) return storedRole;
    }
  } catch (_) { /* non-fatal */ }

  return 'external';
}

ftUserRole = resolveFtRole();
window.addEventListener('message', function(e) {
  if (e.data && e.data.type === 'HC_ROLE') {
    ftUserRole = normRole(e.data.role) || 'external';
  }
});
function canTakePhotos() {
  return ['admin','manager','l2','l1'].includes(normRole(ftUserRole));
}
async function loadPhotoCountsBatch(rows) {
  const ids = rows.map(function(r){ return r.pbId || r.pb; }).filter(Boolean);
  if (!ids.length) return;
  try {
    const res = await fetch(PHOTOS_API_EARLY + '?batch=' + encodeURIComponent(ids.join(',')));
    const data = await res.json();
    Object.assign(photoCountCache, data.counts || {});
  } catch(e) { /* non-fatal */ }
}
function getPhotoCount(row) {
  const key = row.pbId || row.pb || '';
  return photoCountCache[key] || 0;
}
function photoBtn(row) {
  const key   = row.pbId || row.pb || '';
  const count = getPhotoCount(row);
  const cls   = count > 0 ? 'photo-btn has-photos' : 'photo-btn';
  const label = count > 0 ? '&#128247; ' + count : '&#128247;';
  return '<button class="' + cls + '" type="button"' +
    ' data-photo-pb="' + esc(row.pbId||row.pb||'') + '"' +
    ' data-photo-name="' + esc(row.pb||'') + '"' +
    ' data-photo-account="' + esc(row.account||'') + '"' +
    ' style="margin-left:6px;">' + label + '</button>';
}

// ── Helpers ────────────────────────────────────────────────────────────────
function esc(v){ return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;'); }
function fmtN(v){ return Number(v||0).toLocaleString('en-US'); }
function fmtMoney(v){ return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(Number(v||0)); }
function fmtDateLabel(d){
  if(!d) return 'Unscheduled';
  const dt = new Date(d+'T00:00:00');
  if(isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'});
}
function fmtUpdated(v){
  if(!v) return '—';
  const d = new Date(v);
  if(isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
}
function normSoKey(v){ return String(v||'').trim().toLowerCase(); }

// ── Stage labels — customer-facing translations ────────────────────────────
const STAGE_CUSTOMER_LABEL = {
  aa:     'In Production',
  print:  'In Production',
  picked: 'In Production',
  line:   'Finalizing',
  dpmo:   'Quality Check',
  done:   'Complete',
};
const STAGE_INTERNAL_LABEL = {
  aa:'Awaiting Assembly', print:'In Print', picked:'Picked',
  line:'On Line', dpmo:'QA Check', done:'Complete',
};
// Progress order 0-5
const STAGE_ORDER = { aa:0, print:1, picked:2, line:3, dpmo:4, done:5 };

function getStageKey(raw){ return String(raw||'').trim().toLowerCase(); }
function customerStageLabel(raw){
  return STAGE_CUSTOMER_LABEL[getStageKey(raw)] || (raw||'—');
}
function internalStageLabel(raw){
  return STAGE_INTERNAL_LABEL[getStageKey(raw)] || (raw||'—');
}
function stageProgress(raw){ // 0–100
  const order = STAGE_ORDER[getStageKey(raw)];
  return order == null ? 0 : Math.round((order / 5) * 100);
}

// ── Risk classification — stage-aware ─────────────────────────────────────
/*
  critical  = IHD ≤ 0 days AND stage not done
  high      = IHD 1–2 days AND stage in [aa, print, picked]
  watch     = IHD 1–2 days AND stage in [line, dpmo]
  none      = done or IHD > 2 days
*/
function getRisk(row){
  const sk = getStageKey(row.stage);
  if(sk === 'done') return 'none';
  const ihd = String(row.ihd||'').trim();
  if(!ihd) return 'none';
  const today = new Date(); today.setHours(0,0,0,0);
  const d = new Date(ihd+'T00:00:00');
  if(isNaN(d.getTime())) return 'none';
  const diff = Math.round((d - today) / 86400000);
  if(diff < 0)  return 'critical';
  if(diff === 0) return 'critical';
  if(diff <= 2 && ['aa','print','picked'].includes(sk)) return 'high';
  if(diff <= 2 && ['line','dpmo'].includes(sk))         return 'watch';
  return 'none';
}
function riskSortScore(risk){
  return { critical:0, high:1, watch:2, none:3 }[risk] ?? 3;
}

// ── Local storage fallback ─────────────────────────────────────────────────
function loadLocal(key, fb){ try{ const r=localStorage.getItem(key); return r?JSON.parse(r):fb; }catch{ return fb; } }

function readLocalState(){
  return {
    board:     loadLocal(STORAGE_KEYS.board,[]),
    scheduled: loadLocal(STORAGE_KEYS.scheduled,[]),
    revenue:   loadLocal(STORAGE_KEYS.revenue,[]),
    held:      loadLocal(STORAGE_KEYS.held,[]),
  };
}

// ── Backend fetch ──────────────────────────────────────────────────────────
async function getAssemblyState(){
  try{
    const res  = await fetch(assemblyApiBase,{headers:{Accept:'application/json'}});
    const text = await res.text();
    let data = {};
    try{ data = text ? JSON.parse(text) : {}; }catch{ data={}; }
    if(!res.ok) throw new Error(data?.error||`Board load failed (${res.status})`);
    return { state: data.state||{}, updated_at: data.updated_at||null, source:'backend' };
  }catch(err){
    const local = readLocalState();
    if(local.board?.length || local.scheduled?.length || local.revenue?.length){
      console.warn('Backend unavailable; using local copy.',err);
      return { state:local, updated_at:new Date().toISOString(), source:'local' };
    }
    throw err;
  }
}

// ── Revenue lookup ─────────────────────────────────────────────────────────
function buildRevenueLookup(rows){
  const map = new Map();
  (rows||[]).forEach(row=>{
    const key = normSoKey(row.salesOrder||row.so);
    if(!key) return;
    if(!map.has(key)){ map.set(key,row); return; }
    const ex = map.get(key);
    if(Number(row.originalSubtotal||0) > Number(ex.originalSubtotal||0)) ex.originalSubtotal=row.originalSubtotal;
    if(!ex.account && row.account) ex.account=row.account;
    if(!ex.ihd && row.ihd) ex.ihd=row.ihd;
  });
  return map;
}

// ── Board row matching ─────────────────────────────────────────────────────
function getBoardMatch(sched){
  const date = String(sched.scheduledFor||'').trim();
  return (state.board||[]).find(item=>{
    const sameId = item.pbId && sched.pbId && item.pbId===sched.pbId;
    const sameFb = (!item.pbId||!sched.pbId) &&
      String(item.pb||'').trim()===String(sched.pb||'').trim() &&
      String(item.so||'').trim()===String(sched.so||'').trim() &&
      String(item.date||'').trim()===date;
    return sameId||sameFb;
  })||null;
}

function hydrateRow(row, revLookup){
  const bm = getBoardMatch(row)||{};
  const rm = revLookup.get(normSoKey(row.so))||{};
  return {
    ...row,
    stage:    bm.stage  || row.stage  || '',
    status:   bm.status || row.status || row.sourceStatus || '',
    ihd:      row.ihd   || bm.ihd     || rm.ihd || '',
    revenue:  Number(bm.subtotal || rm.originalSubtotal || row.subtotal || 0),
    rowLink:  String(bm.externalLink||'').trim() || (row.pdfUrl&&row.pdfUrl!=='-'?row.pdfUrl:''),
  };
}

// ── Comment counts batch fetch ─────────────────────────────────────────────
async function loadCommentCounts(rows){
  // Fetch recent comments to build a count map — uses ?latest=N approach
  // For now fetch last 500 comments and build counts client-side
  // This avoids N+1 per row and works with the existing backend
  try{
    const res  = await fetch(`${commentsApiBase}?latest=500`,{headers:{Accept:'application/json'}});
    if(!res.ok) return;
    const data = await res.json();
    const comments = data.comments || (data.comment ? [data.comment] : []);
    const counts = {};
    const hasPri = {};
    const requestFlags = {};
    comments.forEach(c=>{
      const key = c.pb_id || c.so || '';
      if(!key) return;
      counts[key]  = (counts[key]||0)+1;
      if(c.category==='priority') hasPri[key]=true;
      if(c.category==='hold_request') requestFlags[key]='hold';
      if(c.category==='date_change_request' && requestFlags[key]!=='hold') requestFlags[key]='date';
      // also key by so for rows without pbId
      if(c.so && c.pb_id && c.so!==c.pb_id){
        counts[c.so]  = (counts[c.so]||0)+1;
        if(c.category==='priority') hasPri[c.so]=true;
        if(c.category==='hold_request') requestFlags[c.so]='hold';
        if(c.category==='date_change_request' && requestFlags[c.so]!=='hold') requestFlags[c.so]='date';
      }
    });
    state.commentCounts = counts;
    state.hasPriority   = hasPri;
    state.requestFlags  = requestFlags;
  }catch(e){
    // non-fatal
  }
}

function commentKey(row){
  return row.pbId || row.so || '';
}
function getCommentCount(row){
  const k = commentKey(row);
  return state.commentCounts[k] || state.commentCounts[row.so] || 0;
}
function hasPriorityComment(row){
  const k = commentKey(row);
  return !!(state.hasPriority[k] || state.hasPriority[row.so]);
}
function getRequestType(row){
  const k = commentKey(row);
  return state.requestFlags[k] || state.requestFlags[row.so] || '';
}
function requestBadge(row){
  const req = getRequestType(row);
  if(req==='hold') return '<span class="ft-request-chip ft-request-hold">Hold requested</span>';
  if(req==='date') return '<span class="ft-request-chip ft-request-date">Date change requested</span>';
  return '';
}

// ── DOM refs ───────────────────────────────────────────────────────────────
const els = {
  lastUpdated:    document.getElementById('lastUpdated'),
  refreshBtn:     document.getElementById('refreshBtn'),
  searchInput:    document.getElementById('searchInput'),
  groupBySelect:  document.getElementById('groupBySelect'),
  dayFilter:      document.getElementById('dayFilter'),
  accountFilter:  document.getElementById('accountFilter'),
  stageFilter:    document.getElementById('stageFilter'),
  boardContent:   document.getElementById('boardContent'),
  holdSection:    document.getElementById('holdSection'),
  statScheduledPbs: document.getElementById('statScheduledPbs'),
  statUnits:        document.getElementById('statUnits'),
  statCompleted:    document.getElementById('statCompleted'),
  statAtRisk:       document.getElementById('statAtRisk'),
  statRevenue:      document.getElementById('statRevenue'),
};

// ── IHD display helper ─────────────────────────────────────────────────────
function ihdDisplay(row){
  const ihd = String(row.ihd||'').trim();
  if(!ihd) return '—';
  const risk = getRisk(row);
  if(risk==='critical') return `<span class="ihd-badge ihd-critical">${esc(ihd)} ⚠ Overdue</span>`;
  if(risk==='high')     return `<span class="ihd-badge ihd-high">${esc(ihd)} · Due soon</span>`;
  if(risk==='watch')    return `<span class="ihd-badge ihd-watch">${esc(ihd)}</span>`;
  return `<span class="ihd-badge">${esc(ihd)}</span>`;
}

// ── Stage badge ────────────────────────────────────────────────────────────
function stageBadge(row, showInternal=false){
  const sk    = getStageKey(row.stage);
  const label = showInternal ? internalStageLabel(row.stage) : customerStageLabel(row.stage);
  const prog  = stageProgress(row.stage);
  const risk  = getRisk(row);
  let cls = 'stage-badge';
  if(sk==='done')                   cls += ' stage-done';
  else if(risk==='critical')        cls += ' stage-critical';
  else if(risk==='high')            cls += ' stage-high';
  else if(risk==='watch')           cls += ' stage-watch';
  else if(['line','dpmo'].includes(sk)) cls += ' stage-active';
  else                              cls += ' stage-pending';

  return `<span class="${cls}" title="Progress: ${prog}%">
    ${esc(label)}
    <span class="stage-prog-bar"><span class="stage-prog-fill" style="width:${prog}%"></span></span>
  </span>`;
}

// ── Comment button ─────────────────────────────────────────────────────────
function commentBtn(row){
  const count   = getCommentCount(row);
  const hasPri  = hasPriorityComment(row);
  const countTxt = count ? ` ${count}` : '';
  const priDot  = hasPri ? '<span class="cm-priority-dot"></span>' : '';
  const cls     = hasPri ? 'comment-btn comment-btn-priority' : count ? 'comment-btn comment-btn-has' : 'comment-btn';
  return `<button
    class="${cls}"
    type="button"
    data-pbid="${esc(row.pbId||'')}"
    data-pbname="${esc(row.pb||'')}"
    data-so="${esc(row.so||'')}"
    data-account="${esc(row.account||'')}">
    ${priDot}💬${countTxt ? `<span class="cm-count">${countTxt}</span>` : ''}
  </button>`;
}

function requestActionBtn(row, type){
  const cls = type==='hold' ? 'ft-req-btn ft-req-hold' : 'ft-req-btn ft-req-date';
  const label = type==='hold' ? '⏸ Hold' : '📅 Date';
  const action = type==='hold' ? 'hold' : 'date_change';
  return `<button class="${cls}" type="button"
    data-request-action="${action}"
    data-pbid="${esc(row.pbId||'')}"
    data-pbname="${esc(row.pb||'')}"
    data-so="${esc(row.so||'')}"
    data-account="${esc(row.account||'')}">${label}</button>`;
}

// ── Filters ────────────────────────────────────────────────────────────────
function updateFilters(rows){
  const unique = arr => Array.from(new Set(arr.filter(Boolean))).sort((a,b)=>String(a).localeCompare(String(b)));
  const curDay     = els.dayFilter.value;
  const curAccount = els.accountFilter.value;
  const curStage   = els.stageFilter.value;

  const days     = unique(rows.map(r=>r.scheduledFor));
  const accounts = unique(rows.map(r=>r.account));
  const stages   = unique(rows.map(r=>customerStageLabel(r.stage)));

  els.dayFilter.innerHTML     = '<option value="">All scheduled days</option>' + days.map(v=>`<option value="${esc(v)}">${esc(fmtDateLabel(v))}</option>`).join('');
  els.accountFilter.innerHTML = '<option value="">All accounts</option>'       + accounts.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');
  els.stageFilter.innerHTML   = '<option value="">All stages</option>'         + stages.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');

  if(days.includes(curDay))         els.dayFilter.value     = curDay;
  if(accounts.includes(curAccount)) els.accountFilter.value = curAccount;
  if(stages.includes(curStage))     els.stageFilter.value   = curStage;
}

function applyFilters(){
  const q       = els.searchInput.value.trim().toLowerCase();
  const day     = els.dayFilter.value;
  const account = els.accountFilter.value;
  const stage   = els.stageFilter.value;
  state.groupBy = els.groupBySelect.value;

  state.filtered = state.scheduled.filter(row=>{
    const sl = customerStageLabel(row.stage);
    const matchSearch = !q || [row.pb,row.so,row.account,row.accountOwner,sl,internalStageLabel(row.stage)]
      .some(v=>String(v||'').toLowerCase().includes(q));
    const matchDay     = !day     || row.scheduledFor===day;
    const matchAccount = !account || row.account===account;
    const matchStage   = !stage   || sl===stage;
    return matchSearch && matchDay && matchAccount && matchStage;
  });

  renderStats(state.filtered);
  renderBoard(state.filtered);
  renderHold(state.held);
}

// ── Stats ──────────────────────────────────────────────────────────────────
function renderStats(rows){
  els.statScheduledPbs.textContent = fmtN(rows.length);
  els.statUnits.textContent        = fmtN(rows.reduce((s,r)=>s+getUnits(r),0));
  els.statCompleted.textContent    = fmtN(rows.filter(r=>getStageKey(r.stage)==='done').length);
  const atRisk = rows.filter(r=>['critical','high'].includes(getRisk(r))).length;
  els.statAtRisk.textContent       = fmtN(atRisk);
  els.statAtRisk.closest('.stat-chip').classList.toggle('stat-chip-risk-active', atRisk > 0);
  els.statRevenue.textContent      = fmtMoney(rows.reduce((s,r)=>s+Number(r.revenue||0),0));
}

function getUnits(row){
  if(Number(row.units||0)>0) return Number(row.units||0);
  return Number(row.qty||0)*Number(row.products||0);
}

// ── Permalink support ──────────────────────────────────────────────────────
function applyUrlParams(){
  const params = new URLSearchParams(window.location.search);
  const so      = params.get('so');
  const account = params.get('account');
  const day     = params.get('day');
  const groupBy = params.get('view');
  if(so)      { els.searchInput.value = so; }
  if(account) { /* set after filter options populated */ els.accountFilter._pendingValue = account; }
  if(day)     { els.dayFilter._pendingValue = day; }
  if(groupBy && ['day','sord'].includes(groupBy)) {
    els.groupBySelect.value = groupBy;
    state.groupBy = groupBy;
  }
}
function flushPendingFilterValues(){
  if(els.accountFilter._pendingValue){
    els.accountFilter.value = els.accountFilter._pendingValue;
    delete els.accountFilter._pendingValue;
  }
  if(els.dayFilter._pendingValue){
    els.dayFilter.value = els.dayFilter._pendingValue;
    delete els.dayFilter._pendingValue;
  }
}

// ── Hold section ───────────────────────────────────────────────────────────
function renderHold(heldRows){
  const el = els.holdSection;
  if(!el) return;
  if(!heldRows || !heldRows.length){ el.hidden=true; return; }
  el.hidden = false;
  el.innerHTML = `
    <div class="hold-header">
      <span class="hold-icon">⏸</span>
      <div>
        <div class="hold-title">On Hold — ${heldRows.length} Pack Builder${heldRows.length!==1?'s':''}</div>
        <div class="hold-sub">These orders are temporarily paused. We'll update you when they're back in production.</div>
      </div>
    </div>
    <div class="hold-list">
      ${heldRows.map(r=>`
        <div class="hold-row">
          <div class="hold-row-main">
            <span class="hold-pb">${esc(r.pb||'—')}</span>
            <span class="hold-so">${esc(r.so||'—')}</span>
            <span class="hold-account">${esc(r.account||'—')}</span>
          </div>
          <div class="hold-row-meta">
            <span class="hold-reason-badge">${esc(r.issueType||'On Hold')}</span>
            ${r.holdNote ? `<span class="hold-note">${esc(r.holdNote)}</span>` : ''}
            ${r.ihd      ? `<span class="hold-ihd">IHD ${esc(r.ihd)}</span>` : ''}
            ${commentBtn(r)}
          </div>
        </div>
      `).join('')}
    </div>`;
}

// ── Row renderer (shared for table) ───────────────────────────────────────
function buildTableRow(row){
  const pbContent = row.rowLink
    ? `<a class="row-link" href="${esc(row.rowLink)}" target="_blank" rel="noreferrer">${esc(row.pb||'—')}</a>`
    : esc(row.pb||'—');
  const req = getRequestType(row);
  return `<tr class="risk-${getRisk(row)}${req ? ` request-${req}` : ''}">
    <td>${pbContent}</td>
    <td>${esc(row.so||'—')}</td>
    <td>${esc(row.account||'—')}</td>
    <td>${esc(row.accountOwner||'—')}</td>
    <td>${fmtN(getUnits(row))}</td>
    <td>${stageBadge(row)}</td>
    <td>${ihdDisplay(row)}${requestBadge(row)}</td>
    <td>${fmtMoney(row.revenue||0)}</td>
    <td class="note-cell">${esc(row.scheduleNote||row.rescheduleNote||'—')}</td>
    <td class="comment-cell">${commentBtn(row)}${requestActionBtn(row,'hold')}${requestActionBtn(row,'date_change')}${photoBtn(row)}</td>
  </tr>`;
}

// ── Board — grouped by Day ─────────────────────────────────────────────────
// ── Journey card helper ──────────────────────────────────────────────────────
function journeyCard(row) {
  const risk  = getRisk(row);
  const sk    = getStageKey(row.stage||'');
  const isDone = sk === 'done';

  // Avatar initials + color class
  const initials = (row.account||row.pb||'?').split(/\s+/).map(w=>w[0]).join('').slice(0,2).toUpperCase();
  const avCls = isDone ? 'ft-av done' : risk==='critical'||risk==='high' ? 'ft-av risk' : 'ft-av';

  // Status badge
  let badge = '';
  if (risk==='critical') badge = '<span class="ft-badge ft-badge-risk">⚠ Overdue</span>';
  else if (risk==='high') badge = '<span class="ft-badge ft-badge-final">Due soon</span>';
  else if (isDone) badge = '<span class="ft-badge ft-badge-done">✓ Complete</span>';
  else {
    const lbl = customerStageLabel(sk);
    const cls = sk==='line'||sk==='dpmo' ? 'ft-badge-final' : sk==='done' ? 'ft-badge-done' : 'ft-badge-prod';
    badge = `<span class="ft-badge ${cls}">${esc(lbl)}</span>`;
  }

  // Journey steps: Received, Scheduled, In Production, Finalizing, Complete
  const STEPS = [
    { key:'sched',   label:'Scheduled',    order:1 },
    { key:'prod',    label:'In Production',order:2 },
    { key:'final',   label:'Finalizing',   order:3 },
    { key:'qa',      label:'Quality Check',order:4 },
    { key:'done',    label:'Complete',     order:5 },
  ];
  const STAGE_ORDER_FT = { aa:2, print:2, picked:2, line:3, dpmo:4, done:5 };
  const curOrder = STAGE_ORDER_FT[sk] || 1;

  let stepsHtml = '';
  STEPS.forEach(function(step, i) {
    const stepDone   = curOrder > step.order;
    const stepActive = curOrder === step.order;
    const isLast = i === STEPS.length - 1;
    const dotCls = stepDone ? 'ft-j-dot done'
                 : stepActive && (risk==='critical') ? 'ft-j-dot risk'
                 : stepActive && (risk==='high'||risk==='watch') ? 'ft-j-dot watch'
                 : stepActive ? 'ft-j-dot active'
                 : 'ft-j-dot';
    const lblCls = stepDone ? 'ft-j-label done'
                 : stepActive && risk==='critical' ? 'ft-j-label risk'
                 : stepActive ? 'ft-j-label active'
                 : 'ft-j-label';
    const lineCls = stepDone ? 'ft-j-line done' : 'ft-j-line';
    const dotContent = stepDone ? '✓' : stepActive ? '→' : '';
    stepsHtml +=
      `<div class="ft-j-step">` +
        (!isLast ? `<div class="${lineCls}"></div>` : '') +
        `<div class="${dotCls}">${dotContent}</div>` +
        `<div class="${lblCls}">${step.label}</div>` +
      `</div>`;
  });

  // IHD display
  let ihdHtml = '—';
  const ihd = String(row.ihd||'').trim();
  if (ihd) {
    if (risk==='critical') ihdHtml = `<span class="ft-ihd-crit">${esc(ihd)} — overdue</span>`;
    else if (risk==='high'||risk==='watch') ihdHtml = `<span class="ft-ihd-warn">${esc(ihd)}</span>`;
    else ihdHtml = `<span class="ft-ihd-ok">${esc(ihd)}</span>`;
  }

  const req = getRequestType(row);
  const reqHtml = req==='hold' ? '<span class="ft-req-chip ft-req-hold">Hold requested</span>'
                : req==='date' ? '<span class="ft-req-chip ft-req-date">Date change requested</span>'
                : '';

  const note = row.scheduleNote||row.rescheduleNote||'';
  const cardCls = risk==='critical' ? ' risk-critical' : risk==='high' ? ' risk-high' : '';

  return `<div class="ft-card${cardCls}">
    <div class="ft-card-inner">
      <div class="ft-card-body">
        <div class="ft-top">
          <div class="${avCls}">${esc(initials)}</div>
          <div style="flex:1;min-width:0;">
            <div class="ft-name">${esc(row.account||'—')}</div>
            <div class="ft-meta">${esc(row.pb||'—')} · ${esc(row.so||'—')}</div>
          </div>
          ${badge}
          ${commentBtn(row)}
          ${photoBtn(row)}
          ${requestActionBtn(row,'hold')}
          ${requestActionBtn(row,'date_change')}
        </div>
        <div class="ft-journey">${stepsHtml}</div>
        <div class="ft-bottom">
          <span>In-hands: <strong>${ihdHtml}</strong></span>
          <span>${fmtN(getUnits(row))} units</span>
          ${row.accountOwner ? `<span>Owner: <strong>${esc(row.accountOwner)}</strong></span>` : ''}
          ${fmtMoney(row.revenue||0) !== '$0' ? `<span>${fmtMoney(row.revenue||0)}</span>` : ''}
          ${note ? `<span class="ft-note">${esc(note)}</span>` : ''}
          ${reqHtml}
        </div>
      </div>
    </div>
  </div>`;
}

// ── Board — grouped by Day ────────────────────────────────────────────────
function renderByDay(rows){
  const groups = new Map();
  rows.forEach(r=>{
    const k = r.scheduledFor||'unscheduled';
    if(!groups.has(k)) groups.set(k,[]);
    groups.get(k).push(r);
  });
  const keys = Array.from(groups.keys()).sort((a,b)=>a.localeCompare(b));
  return keys.map(dateKey=>{
    const dayRows = groups.get(dateKey)
      .slice()
      .sort((a,b)=> riskSortScore(getRisk(a)) - riskSortScore(getRisk(b)) ||
                    String(a.account||'').localeCompare(String(b.account||'')));
    const dayUnits   = dayRows.reduce((s,r)=>s+getUnits(r),0);
    const dayRevenue = dayRows.reduce((s,r)=>s+Number(r.revenue||0),0);
    const atRisk     = dayRows.filter(r=>['critical','high'].includes(getRisk(r))).length;
    return `<div class="day-card">
      <div class="ft-day-label">
        ${esc(fmtDateLabel(dateKey))}
        <span class="ft-day-chip">${fmtN(dayRows.length)} order${dayRows.length!==1?'s':''} · ${fmtN(dayUnits)} units · ${fmtMoney(dayRevenue)}</span>
        ${atRisk ? `<span class="ft-day-risk">⚠ ${atRisk} needs attention</span>` : ''}
      </div>
      ${dayRows.map(journeyCard).join('')}
    </div>`;
  }).join('');
}

// ── Board — grouped by SORD ───────────────────────────────────────────────
function renderBySord(rows){
  const groups = new Map();
  rows.forEach(r=>{
    const k = r.so||'No Sales Order';
    if(!groups.has(k)) groups.set(k,{rows:[],account:r.account||'',accountOwner:r.accountOwner||''});
    groups.get(k).rows.push(r);
  });
  const keys = Array.from(groups.keys()).sort((a,b)=>a.localeCompare(b));
  return keys.map(soKey=>{
    const g     = groups.get(soKey);
    const sRows = g.rows.slice().sort((a,b)=>
      riskSortScore(getRisk(a))-riskSortScore(getRisk(b)) ||
      String(a.scheduledFor||'').localeCompare(String(b.scheduledFor||'')));
    const totalUnits   = sRows.reduce((s,r)=>s+getUnits(r),0);
    const totalRevenue = sRows.reduce((s,r)=>s+Number(r.revenue||0),0);
    const doneCount    = sRows.filter(r=>getStageKey(r.stage)==='done').length;
    const atRisk       = sRows.filter(r=>['critical','high'].includes(getRisk(r))).length;
    const pct          = sRows.length ? Math.round((doneCount/sRows.length)*100) : 0;
    const allIhds      = sRows.map(r=>r.ihd).filter(Boolean).sort();
    const earliestIhd  = allIhds[0]||'';
    return `<div class="day-card">
      <div class="ft-sord-header">
        <div>
          <div class="ft-sord-eyebrow">${esc(g.account||'Unknown account')}${g.accountOwner ? ' · '+esc(g.accountOwner) : ''}</div>
          <div class="ft-sord-title">${esc(soKey)}</div>
          ${atRisk ? `<span class="ft-day-risk" style="display:inline-block;margin-top:4px;">⚠ ${atRisk} PB${atRisk!==1?'s':''} needs attention</span>` : ''}
        </div>
        <div style="text-align:right;">
          <div class="ft-sord-prog-outer"><div class="ft-sord-prog-fill" style="width:${pct}%"></div></div>
          <div class="ft-sord-prog-label">${doneCount} / ${sRows.length} complete</div>
          <div style="margin-top:4px;font-size:11px;color:var(--muted);">${fmtN(totalUnits)} units · ${fmtMoney(totalRevenue)}${earliestIhd ? ' · IHD '+esc(earliestIhd) : ''}</div>
        </div>
      </div>
      ${sRows.map(journeyCard).join('')}
    </div>`;
  }).join('');
}

// ── Main board render ──────────────────────────────────────────────────────
function renderBoard(rows){
  if(!rows.length){
    els.boardContent.innerHTML = `<section class="empty-state"><h2>No pack builders match this view</h2><p>Try clearing a filter or refreshing.</p></section>`;
    renderBoardCards([]);
    return;
  }
  els.boardContent.innerHTML = state.groupBy==='sord' ? renderBySord(rows) : renderByDay(rows);
  renderBoardCards(rows);
  // Load photo counts and update badges
  if (rows.length) loadPhotoCountsBatch(rows).then(function() {
    rows.forEach(function(r) {
      const key = r.pbId || r.pb || '';
      const count = photoCountCache[key] || 0;
      if (count > 0) {
        document.querySelectorAll(`[data-photo-pb="${key}"]`).forEach(function(btn) {
          btn.innerHTML = '&#128247; ' + count;
          btn.classList.add('has-photos');
        });
      }
    });
  });
}

// ── Mobile card view ───────────────────────────────────────────────────────
function renderBoardCards(rows){
  const container = document.getElementById('boardContentCards');
  if(!container) return;
  if(!rows.length){
    container.innerHTML = '<section class="empty-state"><h2>No scheduled pack builders match this view</h2></section>';
    return;
  }
  const groups = new Map();
  rows.forEach(r=>{
    const k = state.groupBy==='sord' ? (r.so||'No Sales Order') : (r.scheduledFor||'unscheduled');
    if(!groups.has(k)) groups.set(k,[]);
    groups.get(k).push(r);
  });
  const keys = Array.from(groups.keys()).sort((a,b)=>a.localeCompare(b));
  container.innerHTML = keys.map(key=>{
    const gRows    = groups.get(key).slice().sort((a,b)=>riskSortScore(getRisk(a))-riskSortScore(getRisk(b)));
    const dayRevenue = gRows.reduce((s,r)=>s+Number(r.revenue||0),0);
    const dayUnits   = gRows.reduce((s,r)=>s+getUnits(r),0);
    const groupLabel = state.groupBy==='sord' ? key : fmtDateLabel(key);
    return `<section class="mob-day-group">
      <div class="mob-day-header">
        <h3 class="mob-day-title">${esc(groupLabel)}</h3>
        <div class="mob-day-chips">
          <span class="summary-chip">${fmtN(gRows.length)} PBs</span>
          <span class="summary-chip">${fmtN(dayUnits)} units</span>
          <span class="summary-chip">${fmtMoney(dayRevenue)}</span>
        </div>
      </div>
      ${gRows.map(r=>{
        const pbContent = r.rowLink
          ? `<a class="row-link" href="${esc(r.rowLink)}" target="_blank" rel="noreferrer">${esc(r.pb||'—')}</a>`
          : esc(r.pb||'—');
        const req = getRequestType(r);
        return `<div class="mob-card mob-ft-card risk-card-${getRisk(r)}${req ? ` request-card-${req}` : ''}">
          <div class="mob-card-header">
            <div class="mob-card-title">
              <span class="mob-card-pb">${pbContent}</span>
              <span class="mob-card-account">${esc(r.account||'—')}</span>
            </div>
            ${stageBadge(r)}
          </div>
          <div class="mob-card-meta">
            <div class="mob-meta-item"><span class="mob-meta-label">SO</span><strong>${esc(r.so||'—')}</strong></div>
            <div class="mob-meta-item"><span class="mob-meta-label">Units</span><strong>${fmtN(getUnits(r))}</strong></div>
            <div class="mob-meta-item"><span class="mob-meta-label">Revenue</span><strong>${fmtMoney(r.revenue||0)}</strong></div>
            <div class="mob-meta-item"><span class="mob-meta-label">In-Hands</span><strong>${ihdDisplay(r)}${requestBadge(r)}</strong></div>
          </div>
          <div class="mob-card-actions">${commentBtn(r)}${requestActionBtn(r,'hold')}${requestActionBtn(r,'date_change')}${photoBtn(r)}</div>
        </div>`;
      }).join('')}
    </section>`;
  }).join('');
}

// ── Main load ──────────────────────────────────────────────────────────────
async function loadBoard(){
  els.refreshBtn.disabled    = true;
  els.refreshBtn.textContent = 'Refreshing…';
  try{
    const payload   = await getAssemblyState();
    const sj        = payload.state||{};
    const revLookup = buildRevenueLookup(sj.revenue||[]);

    state.board     = Array.isArray(sj.board)     ? sj.board     : [];
    state.held      = Array.isArray(sj.held) ? sj.held : [];
    const scheduled = Array.isArray(sj.scheduled)  ? sj.scheduled  : [];
    state.scheduled = scheduled.map(r=>hydrateRow(r,revLookup));
    state.updatedAt = payload.updated_at||null;

    els.lastUpdated.textContent = fmtUpdated(state.updatedAt) +
      (payload.source==='local' ? ' · local copy' : '');

    // Load comment counts in background (non-blocking)
    loadCommentCounts(state.scheduled).then(()=>{
      renderBoard(state.filtered.length ? state.filtered : state.scheduled);
      renderHold(state.held);
    });

    updateFilters(state.scheduled);
    flushPendingFilterValues();
    applyFilters();
  }catch(err){
    console.error(err);
    els.boardContent.innerHTML = `<section class="empty-state"><h2>Unable to load the live board</h2><p>${esc(err.message||'Unknown error')}</p></section>`;
  }finally{
    els.refreshBtn.disabled    = false;
    els.refreshBtn.textContent = 'Refresh';
  }
}

// ── Comment modal ──────────────────────────────────────────────────────────
const cmEls = {
  overlay:   document.getElementById('commentModal'),
  title:     document.getElementById('cmTitle'),
  eyebrow:   document.getElementById('cmEyebrow'),
  subtitle:  document.getElementById('cmSubtitle'),
  thread:    document.getElementById('cmThread'),
  close:     document.getElementById('cmClose'),
  author:    document.getElementById('cmAuthor'),
  category:  document.getElementById('cmCategory'),
  body:      document.getElementById('cmBody'),
  charCount: document.getElementById('cmCharCount'),
  submit:    document.getElementById('cmSubmit'),
  error:     document.getElementById('cmError'),
};
const CAT_LABELS = {
  priority:     '🔴 Priority Request',
  instructions: '📋 Special Instructions',
  general:      '💬 General Note',
  hold_request: '⏸ Hold Request',
  date_change_request: '📅 Date Change Request',
};
function cmFmtTime(iso){
  const d = new Date(iso);
  if(isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
}
function cmRenderThread(comments){
  if(!comments.length){
    cmEls.thread.innerHTML = `<p class="cm-empty">No comments yet. Be the first to leave a note.</p>`;
    return;
  }
  cmEls.thread.innerHTML = comments.map(c=>{
    const isInternal = String(c.author_name||'').toLowerCase().includes('(internal)') || String(c.author_name||'').toLowerCase().includes('[team]');
    const displayName = String(c.author_name||'').replace(/\s*\(internal\)/i,'').replace(/\s*\[team\]/i,'').trim() || (isInternal ? 'Assembly Team' : 'Stakeholder');
    return `<div class="cm-comment cm-cat-${esc(c.category)}${isInternal?' cm-internal':''}">
      <div class="cm-comment-meta">
        <span class="cm-cat-badge">${esc(CAT_LABELS[c.category]||c.category)}</span>
        <span class="cm-comment-author">${esc(displayName)}</span>
        <span class="cm-comment-time">${esc(cmFmtTime(c.created_at))}</span>
      </div>
      <p class="cm-comment-body">${esc(c.body)}</p>
    </div>`;
  }).join('');
  cmEls.thread.scrollTop = cmEls.thread.scrollHeight;
}
async function cmLoadComments(){
  cmEls.thread.innerHTML = `<p class="cm-loading">Loading comments…</p>`;
  try{
    const key = cmState.pbId ? `pb_id=${encodeURIComponent(cmState.pbId)}` : `so=${encodeURIComponent(cmState.so)}`;
    const res  = await fetch(`${commentsApiBase}?${key}`,{headers:{Accept:'application/json'}});
    const data = await res.json();
    if(!res.ok) throw new Error(data.error||`Load failed (${res.status})`);
    cmRenderThread(data.comments||[]);
  }catch(err){
    cmEls.thread.innerHTML = `<p class="cm-empty cm-err-text">Could not load comments: ${esc(err.message)}</p>`;
  }
}
function cmOpenModal(pbId, pbName, so, account){
  cmState.pbId    = pbId;
  cmState.pbName  = pbName;
  cmState.so      = so;
  cmState.account = account;
  cmEls.title.textContent    = pbName||so||'Order';
  cmEls.subtitle.textContent = [so?`SO: ${so}`:'', account?`Account: ${account}`:''].filter(Boolean).join(' · ');
  cmEls.error.hidden    = true;
  cmEls.overlay.hidden  = false;
  document.body.style.overflow = 'hidden';
  // Pre-fill author from localStorage if previously saved
  if (!cmEls.author.value) {
    const saved = localStorage.getItem('ft_author_name') || '';
    if (saved) cmEls.author.value = saved;
  }
  cmLoadComments();
  // Mark thread as read in background for this reader
  const reader = cmEls.author.value.trim();
  if (reader) _ftMarkRead(pbId||'', so||'', reader);
}

async function _ftMarkRead(pbId, so, reader) {
  if (!reader) return;
  try {
    const body = { reader };
    if (pbId) body.pb_id = pbId;
    else if (so) body.so = so;
    await fetch(commentsApiBase, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch { /* non-fatal */ }
}
function cmCloseModal(){
  cmEls.overlay.hidden = true;
  document.body.style.overflow = '';
}
async function cmSubmitComment(){
  const body    = cmEls.body.value.trim();
  const author  = cmEls.author.value.trim()||'Stakeholder';
  const category = cmEls.category.value;
  cmEls.error.hidden = true;
  if(!body){ cmEls.error.textContent='Please write a message before sending.'; cmEls.error.hidden=false; return; }
  cmEls.submit.disabled    = true;
  cmEls.submit.textContent = 'Sending…';
  try{
    const res = await fetch(commentsApiBase,{
      method:'POST',
      headers:{'Content-Type':'application/json',Accept:'application/json'},
      body: JSON.stringify({ pb_id:cmState.pbId, pb_name:cmState.pbName, so:cmState.so,
        account:cmState.account, author_name:author, category, body }),
    });
    const data = await res.json();
    if(!res.ok) throw new Error(data.error||`Submit failed (${res.status})`);
    // Persist author name for next visit
    if(author) localStorage.setItem('ft_author_name', author);
    cmEls.body.value         = '';
    cmEls.charCount.textContent = '0 / 2000';
    await cmLoadComments();
    // Notify parent to refresh badge immediately
    try { window.parent.postMessage({ type: 'FT_COMMENT_POSTED' }, '*'); } catch(_) {}
    // refresh counts in background
    loadCommentCounts(state.scheduled).then(()=>renderBoard(state.filtered));
  }catch(err){
    cmEls.error.textContent = err.message||'Failed to send comment.';
    cmEls.error.hidden      = false;
  }finally{
    cmEls.submit.disabled    = false;
    cmEls.submit.textContent = 'Send';
  }
}

async function submitQuickRequest(action, pbId, pbName, so, account){
  const isHold = action === 'hold';
  const promptMsg = isHold
    ? 'Enter a reason for the hold request:'
    : 'Enter the requested new date and reason:';
  const notes = window.prompt(promptMsg, '');
  if(notes == null) return;
  const cleaned = String(notes).trim();
  if(!cleaned) return;
  const author = (localStorage.getItem('ft_author_name') || 'Stakeholder').trim() || 'Stakeholder';
  const category = isHold ? 'hold_request' : 'date_change_request';
  const body = isHold
    ? `Hold request: ${cleaned}`
    : `Date change request: ${cleaned}`;
  try{
    const res = await fetch(commentsApiBase,{
      method:'POST',
      headers:{'Content-Type':'application/json',Accept:'application/json'},
      body: JSON.stringify({
        pb_id: pbId||'',
        pb_name: pbName||'',
        so: so||'',
        account: account||'',
        author_name: author,
        category,
        body
      }),
    });
    const data = await res.json();
    if(!res.ok) throw new Error(data.error||`Request failed (${res.status})`);
    await loadCommentCounts(state.scheduled);
    renderBoard(state.filtered.length ? state.filtered : state.scheduled);
    renderHold(state.held);
  }catch(err){
    alert('Could not submit request: ' + (err.message||'Unknown error'));
  }
}

// ── Event wiring ───────────────────────────────────────────────────────────
cmEls.close.addEventListener('click', cmCloseModal);
cmEls.overlay.addEventListener('click', e=>{ if(e.target===cmEls.overlay) cmCloseModal(); });
document.addEventListener('keydown', e=>{ if(e.key==='Escape' && !cmEls.overlay.hidden) cmCloseModal(); });
cmEls.submit.addEventListener('click', cmSubmitComment);
cmEls.body.addEventListener('input', ()=>{ cmEls.charCount.textContent=`${cmEls.body.value.length} / 2000`; });

document.addEventListener('click', e=>{
  const btn = e.target.closest('.comment-btn');
  if(!btn) return;
  cmOpenModal(btn.dataset.pbid||'', btn.dataset.pbname||'', btn.dataset.so||'', btn.dataset.account||'');
});
document.addEventListener('click', e=>{
  const btn = e.target.closest('[data-request-action]');
  if(!btn) return;
  submitQuickRequest(
    btn.dataset.requestAction || '',
    btn.dataset.pbid || '',
    btn.dataset.pbname || '',
    btn.dataset.so || '',
    btn.dataset.account || ''
  );
});

['input','change'].forEach(evt=>{
  els.searchInput.addEventListener(evt, applyFilters);
  els.groupBySelect.addEventListener(evt, applyFilters);
  els.dayFilter.addEventListener(evt, applyFilters);
  els.accountFilter.addEventListener(evt, applyFilters);
  els.stageFilter.addEventListener(evt, applyFilters);
});
els.refreshBtn.addEventListener('click', loadBoard);

// ── Init ───────────────────────────────────────────────────────────────────
applyUrlParams();
loadBoard();
setInterval(loadBoard, REFRESH_MS);

// ══════════════════════════════════════════════════════════════
// PHOTO FEATURE — Modal, camera, upload
// ══════════════════════════════════════════════════════════════

const PHOTOS_API = PHOTOS_API_EARLY; // alias

// ── Photo Modal ───────────────────────────────────────────────
let photoModalPb = { id:'', name:'', account:'' };
const photoCarousel = { photos: [], index: 0 };

const photoModal     = document.getElementById('photoModal');
const photoModalClose= document.getElementById('photoModalClose');
const photoStrip     = document.getElementById('photoStrip');
const photoAddArea   = document.getElementById('photoAddArea');
const photoStatus    = document.getElementById('photoStatus');
const photoFileInput = document.getElementById('photoFileInput');

if (photoModalClose) {
  photoModalClose.addEventListener('click', closePhotoModal);
}
if (photoModal) {
  photoModal.addEventListener('click', function(e) {
    if (e.target === photoModal) closePhotoModal();
  });
}

function closePhotoModal() {
  if (photoModal) photoModal.hidden = true;
  document.body.style.overflow = '';
}

async function openPhotoModal(pbId, pbName, account) {
  // Re-resolve in case auth finished after initial script load
  ftUserRole = resolveFtRole();
  photoModalPb = { id: pbId, name: pbName, account };
  const titleEl = document.getElementById('photoModalTitle');
  const subEl   = document.getElementById('photoModalSub');
  if (titleEl) titleEl.textContent = pbName || pbId || 'Pack Builder';
  if (subEl)   subEl.textContent   = account || '';
  if (!photoStatus || !photoStrip || !photoAddArea || !photoModal) {
    console.error('Photo modal is missing required DOM nodes.', {
      hasModal: !!photoModal,
      hasStatus: !!photoStatus,
      hasStrip: !!photoStrip,
      hasAddArea: !!photoAddArea
    });
    return;
  }
  photoStatus.textContent = 'Loading photos…';
  photoStrip.innerHTML = '';
  photoAddArea.innerHTML = '';
  if (photoModal) { photoModal.hidden = false; document.body.style.overflow = 'hidden'; }
  await renderPhotoStrip(pbId);
}

async function renderPhotoStrip(pbId) {
  try {
    const res  = await fetch(`${PHOTOS_API}?pb_id=${encodeURIComponent(pbId)}`);
    const data = await res.json();
    const photos = data.photos || [];

    photoCountCache[pbId] = photos.length;
    photoStatus.textContent = '';

    if (!photos.length && !canTakePhotos()) {
      photoStrip.innerHTML = '<div style="font-size:13px;color:#888;padding:8px 0;">No photos taken yet.</div>';
      photoCarousel.photos = [];
      photoCarousel.index = 0;
    } else {
      const hydrated = await Promise.all(photos.map(async function(p) {
        const detail = await fetchPhotoData(p.id);
        return {
          id: p.id,
          taken_by: detail.taken_by || p.taken_by || '',
          taken_at: detail.taken_at || p.taken_at || '',
          photo_data: detail.photo_data || ''
        };
      }));
      photoCarousel.photos = hydrated;
      photoCarousel.index = Math.min(photoCarousel.index, Math.max(0, hydrated.length - 1));
      renderPhotoCarousel();
    }

    // Add photo button (associates only, max 3)
    if (canTakePhotos() && photos.length < 3) {
      photoAddArea.innerHTML = `<div style="display:flex;align-items:center;gap:10px;margin-top:4px;">
        <button class="photo-add-btn" type="button" data-photo-action="add">
          <span style="font-size:22px;">&#43;</span>
          <span>Add photo</span>
        </button>
        <span style="font-size:12px;color:#888;">${3 - photos.length} slot${3-photos.length!==1?'s':''} remaining</span>
      </div>`;
    } else if (canTakePhotos() && photos.length >= 3) {
      photoAddArea.innerHTML = '<div style="font-size:12px;color:#888;margin-top:4px;">Max 3 photos reached.</div>';
    }
  } catch(e) {
    photoStatus.textContent = 'Could not load photos.';
  }
}

function renderPhotoCarousel() {
  const photos = photoCarousel.photos || [];
  if (!photos.length) {
    photoStrip.innerHTML = '<div style="font-size:13px;color:#888;padding:8px 0;">No photos taken yet.</div>';
    return;
  }
  const current = photos[photoCarousel.index] || photos[0];
  const total = photos.length;
  const takenBy = current.taken_by ? String(current.taken_by).split(' ')[0] : '';
  const imgHtml = current.photo_data
    ? `<img src="${current.photo_data}" alt="Confirmation photo" />`
    : '<span style="font-size:22px;">&#128247;</span>';
  const navPrevDisabled = total <= 1 ? 'disabled' : '';
  const navNextDisabled = total <= 1 ? 'disabled' : '';
  photoStrip.innerHTML = `
    <div class="photo-carousel">
      <button type="button" class="photo-carousel-nav" data-photo-nav="prev" ${navPrevDisabled} aria-label="Previous photo">&#8249;</button>
      <div class="photo-carousel-stage">
        <button type="button" class="photo-thumb photo-thumb-large" data-photo-open="${current.id}">
          ${imgHtml}
        </button>
        <div class="photo-carousel-meta">
          <span>${takenBy || 'Associate'}</span>
          <span>${photoCarousel.index + 1} / ${total}</span>
        </div>
      </div>
      <button type="button" class="photo-carousel-nav" data-photo-nav="next" ${navNextDisabled} aria-label="Next photo">&#8250;</button>
    </div>
  `;
}

async function fetchPhotoData(photoId) {
  try {
    const res  = await fetch(`${PHOTOS_API}?id=${photoId}`);
    const data = await res.json();
    if (!res.ok) return {};
    return data || {};
  } catch (_) {
    return {};
  }
}

async function loadThumbImage(photoId) {
  try {
    const res  = await fetch(`${PHOTOS_API}?id=${photoId}`);
    const data = await res.json();
    if (!data.photo_data) return;
    const thumb = document.querySelector(`[data-photo-id="${photoId}"]`);
    if (thumb) {
      thumb.innerHTML = `<img src="${data.photo_data}" alt="Confirmation photo" />`;
      thumb._photoData = data.photo_data;
      thumb._photoMeta = { taken_at: data.taken_at, taken_by: data.taken_by };
    }
  } catch(e) { /* non-fatal */ }
}

function viewPhotoFull(photoId) {
  // Prevent stacked overlays if user taps repeatedly.
  document.querySelectorAll('.photo-lightbox-bg').forEach(function(el) { el.remove(); });
  const carouselPhoto = (photoCarousel.photos || []).find(function(p) { return Number(p.id) === Number(photoId); });
  const thumb = document.querySelector(`[data-photo-id="${photoId}"]`);
  const src   = carouselPhoto?.photo_data || thumb?._photoData;
  if (!src) return;
  const meta  = carouselPhoto ? { taken_at: carouselPhoto.taken_at, taken_by: carouselPhoto.taken_by } : (thumb?._photoMeta || {});
  const bg = document.createElement('div');
  bg.className = 'photo-lightbox-bg';
  const inner = document.createElement('div');
  inner.className = 'photo-lightbox-inner';
  const takenAt = meta.taken_at ? new Date(meta.taken_at).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}) : '';
  inner.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
      <div>
        <div style="font-size:13px;font-weight:700;">${photoModalPb.name}</div>
        <div style="font-size:12px;color:#666;">${takenAt}${meta.taken_by?' · '+meta.taken_by:''}</div>
      </div>
      <button type="button" data-lightbox-close style="background:none;border:none;font-size:20px;cursor:pointer;color:#666;">&#215;</button>
    </div>
    <img src="${src}" alt="Confirmation photo" style="width:100%;border-radius:8px;" />
  `;
  bg.appendChild(inner);
  inner.addEventListener('click', function(e) {
    const closeBtn = e.target.closest('[data-lightbox-close]');
    if (closeBtn) {
      e.preventDefault();
      e.stopPropagation();
      bg.remove();
    }
  });
  bg.addEventListener('click', function(e) { if (e.target === bg) bg.remove(); });
  document.body.appendChild(bg);
}

function triggerCamera() {
  if (photoFileInput) photoFileInput.click();
}

if (photoAddArea) {
  photoAddArea.addEventListener('click', function(e) {
    const addBtn = e.target.closest('[data-photo-action="add"]');
    if (!addBtn) return;
    triggerCamera();
  });
}

if (photoStrip) {
  photoStrip.addEventListener('click', function(e) {
    const navBtn = e.target.closest('[data-photo-nav]');
    if (navBtn) {
      if (!photoCarousel.photos.length) return;
      const dir = navBtn.getAttribute('data-photo-nav');
      const total = photoCarousel.photos.length;
      if (dir === 'prev') photoCarousel.index = (photoCarousel.index - 1 + total) % total;
      if (dir === 'next') photoCarousel.index = (photoCarousel.index + 1) % total;
      renderPhotoCarousel();
      return;
    }
    const openBtn = e.target.closest('[data-photo-open]');
    if (!openBtn) return;
    const photoId = Number(openBtn.getAttribute('data-photo-open'));
    if (!photoId) return;
    viewPhotoFull(photoId);
  });
}

if (photoFileInput) {
  photoFileInput.addEventListener('change', async function() {
    const file = photoFileInput.files[0];
    if (!file) return;
    photoStatus.textContent = 'Processing photo…';
    photoAddArea.innerHTML  = '';
    try {
      const base64 = await compressAndEncode(file);
      photoStatus.textContent = 'Uploading…';
      const takenBy = localStorage.getItem('ft_author_name') || 'Associate';
      const res = await fetch(PHOTOS_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pb_id:      photoModalPb.id,
          pb_name:    photoModalPb.name,
          account:    photoModalPb.account,
          photo_data: base64,
          taken_by:   takenBy,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      photoStatus.textContent = '✓ Photo saved';
      setTimeout(function() { photoStatus.textContent = ''; }, 2000);
      await renderPhotoStrip(photoModalPb.id);
      // refresh board photo count badge
      const c = photoCountCache[photoModalPb.id] || 0;
      document.querySelectorAll(`[data-photo-pb="${photoModalPb.id}"]`).forEach(function(btn) {
        btn.innerHTML = `&#128247; ${c}`;
        btn.classList.add('has-photos');
      });
    } catch(e) {
      photoStatus.textContent = 'Error: ' + e.message;
    }
    photoFileInput.value = '';
  });
}

function compressAndEncode(file) {
  return new Promise(function(resolve, reject) {
    const reader = new FileReader();
    reader.onload = function(e) {
      const img = new Image();
      img.onload = function() {
        const MAX = 1200;
        let w = img.width, h = img.height;
        if (w > MAX || h > MAX) {
          if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
          else       { w = Math.round(w * MAX / h); h = MAX; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.75));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Wire photo button clicks
document.addEventListener('click', function(e) {
  const btn = e.target.closest('[data-photo-pb]');
  if (!btn) return;
  openPhotoModal(
    btn.getAttribute('data-photo-pb'),
    btn.getAttribute('data-photo-name'),
    btn.getAttribute('data-photo-account')
  );
});

// Photo counts are updated inside renderBoard above
