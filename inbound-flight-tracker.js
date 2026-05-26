'use strict';
/* =========================================================
   INBOUND PO FLIGHT TRACKER  —  inbound-flight-tracker.js
   External-facing visibility for inbound POs.
   Mirrors the structure of assembly-flight-tracker.js.
   Data source: /.netlify/functions/workflow-sync (GET)
   Fallback   : localStorage key used by inbound-pallets.js
   ========================================================= */

const workflowApiBase = '/.netlify/functions/workflow-sync';
const REFRESH_MS      = 60000;

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  pallets:   [],      // raw pallets from backend
  rows:      [],      // flattened+aggregated PO rows (one per PO#)
  filtered:  [],
  updatedAt: null,
  groupBy:   'stage', // 'stage' | 'day' | 'pallet'
};

let ftUserRole = 'external';

function normRole(role) { return String(role || '').trim().toLowerCase(); }
function resolveFtRole() {
  const liveRole = normRole(window.hcCurrentUser && window.hcCurrentUser.role);
  if (liveRole) return liveRole;
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
window.addEventListener('message', function (e) {
  if (e.data && e.data.type === 'HC_ROLE') {
    ftUserRole = normRole(e.data.role) || 'external';
  }
});

// ── Helpers ────────────────────────────────────────────────────────────────
function esc(v){ return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;'); }
function fmtN(v){ return Number(v||0).toLocaleString('en-US'); }
function hasVal(v){ return v !== null && v !== undefined && v !== ''; }
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

// ── Stage definitions (customer-facing labels) ─────────────────────────────
const STAGES = [
  { key:'dock',      label:'At Dock',       order:1 },
  { key:'receiving', label:'Receiving',     order:2 },
  { key:'prep',      label:'Prep',          order:3 },
  { key:'routed',    label:'Routed',        order:4 },
  { key:'done',      label:'Complete',      order:5 },
];
const STAGE_ORDER = { dock:1, receiving:2, prep:3, routed:4, done:5 };
function stageLabel(k){ const s = STAGES.find(x=>x.key===k); return s ? s.label : (k||'—'); }

// ── Derive a stage from a single PO entry on a single pallet ───────────────
function derivePoStage(po, pallet) {
  // If the pallet itself is "done", the PO has completed all stages
  const pStatus = String(pallet && pallet.status || '').toLowerCase();
  if (pStatus === 'done') return 'done';

  // Routed = Prep verified AND has destination/stsQty/ltsQty assigned
  const hasRouting = !!(po.destination) ||
                     Number(po.stsQty||0) > 0 ||
                     Number(po.ltsQty||0) > 0;
  if (po.prepVerified && hasRouting)        return 'routed';
  if (po.prepVerified)                       return 'prep';      // verified but not routed yet
  if (po.receivingDone)                      return 'receiving'; // received, awaiting prep
  return 'dock';
}

// ── Flatten pallets into per-PO occurrences ────────────────────────────────
//    Each PO# can appear on multiple pallets (partial / continuation
//    receipts). We collect every occurrence first, then aggregate.
function flattenOccurrences(pallets) {
  const out = [];
  (pallets || []).forEach(p => {
    if (!p || !Array.isArray(p.pos)) return;
    p.pos.forEach(po => {
      const poNum = String(po.po || '').trim();
      if (!poNum) return;
      out.push({
        poNum,
        category:        po.category || '',
        orderedQty:      hasVal(po.orderedQty)      ? Number(po.orderedQty)      : null,
        receivedQty:     hasVal(po.receivedQty)     ? Number(po.receivedQty)     : null,
        prepReceivedQty: hasVal(po.prepReceivedQty) ? Number(po.prepReceivedQty) : null,
        boxes:           hasVal(po.boxes) ? Number(po.boxes) : null,
        destination:     po.destination || '',
        stsQty:          hasVal(po.stsQty) ? Number(po.stsQty) : null,
        ltsQty:          hasVal(po.ltsQty) ? Number(po.ltsQty) : null,
        receivingDone:   !!po.receivingDone,
        prepVerified:    !!po.prepVerified,
        createdAt:       po.createdAt || 0,
        // pallet context
        palletId:        p.id || '',
        palletLabel:     p.label || '',
        palletDate:      p.date || '',
        palletStatus:    p.status || '',
        palletCreatedAt: p.createdAt || 0,
        stage:           derivePoStage(po, p),
      });
    });
  });
  return out;
}

// ── Aggregate occurrences by PO# into one row per PO ───────────────────────
//    Rationale: external owners care about "their PO" — not the pallet it
//    happens to sit on. If a PO spans multiple pallets, the row represents
//    the most-advanced occurrence but totals sum across all of them.
function aggregateByPo(occurrences) {
  const map = new Map();
  occurrences.forEach(occ => {
    const key = occ.poNum.toLowerCase();
    if (!map.has(key)) {
      map.set(key, {
        poNum:        occ.poNum,
        category:     occ.category,
        // sums across all pallet appearances
        receivedQty:  0,
        prepReceivedQty: 0,
        boxes:        0,
        stsQty:       0,
        ltsQty:       0,
        // taken from "canonical" first non-null
        orderedQty:   null,
        // furthest stage reached
        stage:        'dock',
        stageOrder:   1,
        // most-recent pallet info (for primary display)
        palletLabel:  occ.palletLabel,
        palletId:     occ.palletId,
        palletDate:   occ.palletDate,
        // tracking
        occurrences: [],
        latestActivity: 0,
      });
    }
    const agg = map.get(key);
    agg.occurrences.push(occ);

    // Canonical ordered qty — first non-null we see (should be same across)
    if (agg.orderedQty == null && occ.orderedQty != null) agg.orderedQty = occ.orderedQty;

    // Sums (treat null as 0)
    agg.receivedQty     += Number(occ.receivedQty || 0);
    agg.prepReceivedQty += Number(occ.prepReceivedQty || 0);
    agg.boxes           += Number(occ.boxes || 0);
    agg.stsQty          += Number(occ.stsQty || 0);
    agg.ltsQty          += Number(occ.ltsQty || 0);

    // Carry the most-advanced stage and the most-recent pallet
    const occOrder = STAGE_ORDER[occ.stage] || 1;
    if (occOrder > agg.stageOrder) {
      agg.stage      = occ.stage;
      agg.stageOrder = occOrder;
    }
    const occTs = Number(occ.palletCreatedAt || occ.createdAt || 0);
    if (occTs > agg.latestActivity) {
      agg.latestActivity = occTs;
      agg.palletLabel = occ.palletLabel;
      agg.palletId    = occ.palletId;
      agg.palletDate  = occ.palletDate;
    }
    // Inherit category if missing
    if (!agg.category && occ.category) agg.category = occ.category;
  });

  // Derive flags + zero-out empties for cleaner display
  const rows = [];
  map.forEach(r => {
    // If after summing the values are still 0 AND no occurrence reported them,
    // we want to show "—" instead of "0".
    const anyRecv = r.occurrences.some(o => o.receivedQty != null);
    const anyPrep = r.occurrences.some(o => o.prepReceivedQty != null);
    if (!anyRecv) r.receivedQty = null;
    if (!anyPrep) r.prepReceivedQty = null;

    // Flags
    r.isPartial         = r.occurrences.length > 1;
    r.recvVsOrdered     = (r.receivedQty != null && r.orderedQty != null) ? r.receivedQty - r.orderedQty : null;
    r.prepVsRecv        = (r.prepReceivedQty != null && r.receivedQty != null) ? r.prepReceivedQty - r.receivedQty : null;
    r.hasOverstock      = r.recvVsOrdered != null && r.recvVsOrdered > 0;
    r.hasShortage       = r.recvVsOrdered != null && r.recvVsOrdered < 0 && r.stage === 'done';
    r.hasCountMismatch  = r.prepVsRecv != null && r.prepVsRecv !== 0;
    r.hasIssue          = r.hasShortage || r.hasCountMismatch ||
                          (r.stage === 'done' && r.hasOverstock); // overstock only flagged after done
    rows.push(r);
  });
  return rows;
}

// ── Local storage fallback (used by inbound-pallets.js inside main app) ────
function loadLocalPallets() {
  // The main app stores pallets inside the broader workflow state object.
  // The most common keys we may see:
  const keys = ['workflow_state_v1', 'workflowState', 'ops_hub_workflow_v1'];
  for (const k of keys) {
    try {
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (parsed && parsed.data && Array.isArray(parsed.data.pallets)) {
        return parsed.data.pallets;
      }
      if (parsed && Array.isArray(parsed.pallets)) {
        return parsed.pallets;
      }
    } catch (_) { /* try next */ }
  }
  return [];
}

// ── Fetch from backend ─────────────────────────────────────────────────────
async function getInboundState() {
  try {
    const res  = await fetch(workflowApiBase, { headers: { Accept: 'application/json' } });
    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
    if (!res.ok) throw new Error((data && data.error) || ('Inbound load failed (' + res.status + ')'));
    const pallets = (data && data.data && Array.isArray(data.data.pallets)) ? data.data.pallets : [];
    return { pallets, updated_at: data.updated_at || null, source: 'backend' };
  } catch (err) {
    const localPallets = loadLocalPallets();
    if (localPallets.length) {
      console.warn('Workflow backend unavailable; using local copy.', err);
      return { pallets: localPallets, updated_at: new Date().toISOString(), source: 'local' };
    }
    throw err;
  }
}

// ── DOM refs ───────────────────────────────────────────────────────────────
const els = {
  lastUpdated:    document.getElementById('lastUpdated'),
  refreshBtn:     document.getElementById('refreshBtn'),
  searchInput:    document.getElementById('searchInput'),
  groupBySelect:  document.getElementById('groupBySelect'),
  stageFilter:    document.getElementById('stageFilter'),
  categoryFilter: document.getElementById('categoryFilter'),
  dayFilter:      document.getElementById('dayFilter'),
  onlyIssues:     document.getElementById('onlyIssues'),
  boardContent:   document.getElementById('boardContent'),
  statTotalPos:   document.getElementById('statTotalPos'),
  statDock:       document.getElementById('statDock'),
  statReceiving:  document.getElementById('statReceiving'),
  statPrep:       document.getElementById('statPrep'),
  statDone:       document.getElementById('statDone'),
  statIssues:     document.getElementById('statIssues'),
};

// ── Filters ────────────────────────────────────────────────────────────────
function updateFilters(rows) {
  const unique = arr => Array.from(new Set(arr.filter(Boolean))).sort((a,b)=>String(a).localeCompare(String(b)));
  const curStage    = els.stageFilter.value;
  const curCategory = els.categoryFilter.value;
  const curDay      = els.dayFilter.value;

  const stages     = STAGES.map(s => s.label);
  const categories = unique(rows.map(r => r.category));
  const days       = unique(rows.map(r => r.palletDate));

  els.stageFilter.innerHTML    = '<option value="">All stages</option>' +
    stages.map(v => '<option value="' + esc(v) + '">' + esc(v) + '</option>').join('');
  els.categoryFilter.innerHTML = '<option value="">All categories</option>' +
    categories.map(v => '<option value="' + esc(v) + '">' + esc(v) + '</option>').join('');
  els.dayFilter.innerHTML      = '<option value="">All days</option>' +
    days.map(v => '<option value="' + esc(v) + '">' + esc(fmtDateLabel(v)) + '</option>').join('');

  if (stages.includes(curStage))         els.stageFilter.value    = curStage;
  if (categories.includes(curCategory))  els.categoryFilter.value = curCategory;
  if (days.includes(curDay))             els.dayFilter.value      = curDay;
}

function applyFilters() {
  const q          = els.searchInput.value.trim().toLowerCase();
  const stage      = els.stageFilter.value;
  const category   = els.categoryFilter.value;
  const day        = els.dayFilter.value;
  const onlyIssues = !!els.onlyIssues.checked;
  state.groupBy    = els.groupBySelect.value;

  state.filtered = state.rows.filter(r => {
    const matchSearch   = !q || [r.poNum, r.category, r.palletLabel, stageLabel(r.stage)]
      .some(v => String(v||'').toLowerCase().includes(q));
    const matchStage    = !stage    || stageLabel(r.stage) === stage;
    const matchCategory = !category || r.category === category;
    const matchDay      = !day      || r.palletDate === day;
    const matchIssue    = !onlyIssues || r.hasIssue;
    return matchSearch && matchStage && matchCategory && matchDay && matchIssue;
  });

  renderStats(state.filtered);
  renderBoard(state.filtered);
}

// ── Stats ──────────────────────────────────────────────────────────────────
function renderStats(rows) {
  els.statTotalPos.textContent  = fmtN(rows.length);
  els.statDock.textContent      = fmtN(rows.filter(r => r.stage === 'dock').length);
  els.statReceiving.textContent = fmtN(rows.filter(r => r.stage === 'receiving').length);
  els.statPrep.textContent      = fmtN(rows.filter(r => r.stage === 'prep' || r.stage === 'routed').length);
  els.statDone.textContent      = fmtN(rows.filter(r => r.stage === 'done').length);
  const issues = rows.filter(r => r.hasIssue).length;
  els.statIssues.textContent    = fmtN(issues);
  const issueChip = els.statIssues.closest('.stat-chip');
  if (issueChip) issueChip.classList.toggle('stat-chip-risk-active', issues > 0);
}

// ── Journey card per PO ────────────────────────────────────────────────────
function poJourneyCard(row) {
  const curOrder  = STAGE_ORDER[row.stage] || 1;
  const cardCls   = (row.hasIssue ? ' has-issue' : '') + (row.stage === 'done' ? ' is-done' : '');
  const stageCls  = 'ipt-stage-' + row.stage;
  const stageLbl  = stageLabel(row.stage);

  // Journey dots — reuse .ft-j-* classes from assembly-flight-tracker.css
  let stepsHtml = '';
  STAGES.forEach(function (s, i) {
    const stepDone   = curOrder > s.order;
    const stepActive = curOrder === s.order;
    const isLast = i === STAGES.length - 1;
    const dotCls = stepDone ? 'ft-j-dot done'
                 : stepActive && row.hasIssue ? 'ft-j-dot risk'
                 : stepActive ? 'ft-j-dot active'
                 : 'ft-j-dot';
    const lblCls = stepDone ? 'ft-j-label done'
                 : stepActive && row.hasIssue ? 'ft-j-label risk'
                 : stepActive ? 'ft-j-label active'
                 : 'ft-j-label';
    const lineCls = stepDone ? 'ft-j-line done' : 'ft-j-line';
    const dotContent = stepDone ? '✓' : stepActive ? '→' : '';
    stepsHtml +=
      '<div class="ft-j-step">' +
        (!isLast ? '<div class="' + lineCls + '"></div>' : '') +
        '<div class="' + dotCls + '">' + dotContent + '</div>' +
        '<div class="' + lblCls + '">' + s.label + '</div>' +
      '</div>';
  });

  // Quantities block — show what is known
  const ordTxt  = row.orderedQty != null ? fmtN(row.orderedQty) : '—';
  const recvTxt = row.receivedQty != null ? fmtN(row.receivedQty) : '—';
  const prepTxt = row.prepReceivedQty != null ? fmtN(row.prepReceivedQty) : '—';
  const recvMismatch = row.recvVsOrdered != null && row.recvVsOrdered !== 0;
  const prepMismatch = row.prepVsRecv != null && row.prepVsRecv !== 0;

  // Routing summary (only meaningful past prep)
  let routingTxt = '';
  if (row.stsQty || row.ltsQty) {
    const parts = [];
    if (row.stsQty) parts.push(fmtN(row.stsQty) + ' STS');
    if (row.ltsQty) parts.push(fmtN(row.ltsQty) + ' LTS');
    routingTxt = parts.join(' · ');
  }

  // Issue badges
  const badges = [];
  if (row.isPartial) {
    badges.push('<span class="ipt-partial-chip">Partial · ' + row.occurrences.length + ' pallets</span>');
  }
  if (row.hasOverstock) {
    badges.push('<span class="ipt-overstock-chip">+' + fmtN(row.recvVsOrdered) + ' overstock</span>');
  }
  if (row.hasShortage) {
    badges.push('<span class="ipt-issue-chip">Short by ' + fmtN(Math.abs(row.recvVsOrdered)) + '</span>');
  }
  if (row.hasCountMismatch) {
    const sign = row.prepVsRecv > 0 ? '+' : '';
    badges.push('<span class="ipt-issue-chip">Prep mismatch ' + sign + fmtN(row.prepVsRecv) + '</span>');
  }

  // Pallet date label
  const dateLbl = row.palletDate ? fmtDateLabel(row.palletDate) : '—';

  return '<div class="ipt-card' + cardCls + '">' +
    '<div class="ipt-card-body">' +
      '<div class="ipt-top">' +
        '<span class="ipt-po-num">PO# ' + esc(row.poNum) + '</span>' +
        (row.category ? '<span class="ipt-cat-chip">' + esc(row.category) + '</span>' : '') +
        (row.palletLabel ? '<span class="ipt-pallet-chip">' + esc(row.palletLabel) + '</span>' : '') +
        '<span class="ipt-stage-badge ' + stageCls + '">' + esc(stageLbl) + '</span>' +
      '</div>' +
      '<div class="ipt-journey">' + stepsHtml + '</div>' +
      '<div class="ipt-bottom">' +
        '<span class="ipt-qty-cell">Ordered: <span class="ipt-qty-num">' + ordTxt + '</span></span>' +
        '<span class="ipt-qty-cell">Received: <span class="ipt-qty-num' + (recvMismatch ? ' mismatch' : '') + '">' + recvTxt + '</span></span>' +
        '<span class="ipt-qty-cell">Prep-verified: <span class="ipt-qty-num' + (prepMismatch ? ' mismatch' : '') + '">' + prepTxt + '</span></span>' +
        (row.boxes ? '<span>' + fmtN(row.boxes) + ' boxes</span>' : '') +
        (routingTxt ? '<span><strong>' + esc(routingTxt) + '</strong></span>' : '') +
        '<span>Day: <strong>' + esc(dateLbl) + '</strong></span>' +
      '</div>' +
      (badges.length ? '<div class="ipt-bottom" style="margin-top:6px;">' + badges.join('') + '</div>' : '') +
    '</div>' +
  '</div>';
}

// ── Group renderers ────────────────────────────────────────────────────────
function renderByStage(rows) {
  const order = STAGES.map(s => s.key);
  const groups = new Map();
  order.forEach(k => groups.set(k, []));
  rows.forEach(r => {
    if (!groups.has(r.stage)) groups.set(r.stage, []);
    groups.get(r.stage).push(r);
  });
  let html = '';
  order.forEach(stageKey => {
    const list = groups.get(stageKey) || [];
    if (!list.length) return;
    // Sort issues first, then partial, then by recency
    list.sort((a,b) => {
      if (a.hasIssue !== b.hasIssue) return a.hasIssue ? -1 : 1;
      if (a.isPartial !== b.isPartial) return a.isPartial ? -1 : 1;
      return (b.latestActivity||0) - (a.latestActivity||0);
    });
    const issueCount = list.filter(r => r.hasIssue).length;
    html += '<div class="ipt-group">' +
      '<div class="ipt-group-label">' +
        esc(stageLabel(stageKey)) +
        '<span class="ipt-group-chip">' + fmtN(list.length) + ' PO' + (list.length !== 1 ? 's' : '') + '</span>' +
        (issueCount ? '<span class="ft-day-risk">⚠ ' + issueCount + ' need attention</span>' : '') +
      '</div>' +
      list.map(poJourneyCard).join('') +
    '</div>';
  });
  return html || '<section class="empty-state"><h2>No matching POs</h2><p>Try clearing your filters.</p></section>';
}

function renderByDay(rows) {
  const groups = new Map();
  rows.forEach(r => {
    const k = r.palletDate || 'unscheduled';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  });
  const keys = Array.from(groups.keys()).sort((a,b) => a.localeCompare(b));
  let html = '';
  keys.forEach(dateKey => {
    const list = groups.get(dateKey).slice()
      .sort((a,b) => (STAGE_ORDER[a.stage]||9) - (STAGE_ORDER[b.stage]||9) || a.poNum.localeCompare(b.poNum));
    const issueCount = list.filter(r => r.hasIssue).length;
    html += '<div class="ipt-group">' +
      '<div class="ipt-group-label">' +
        esc(fmtDateLabel(dateKey)) +
        '<span class="ipt-group-chip">' + fmtN(list.length) + ' PO' + (list.length !== 1 ? 's' : '') + '</span>' +
        (issueCount ? '<span class="ft-day-risk">⚠ ' + issueCount + ' need attention</span>' : '') +
      '</div>' +
      list.map(poJourneyCard).join('') +
    '</div>';
  });
  return html || '<section class="empty-state"><h2>No matching POs</h2><p>Try clearing your filters.</p></section>';
}

function renderByPallet(rows) {
  const groups = new Map();
  rows.forEach(r => {
    const k = r.palletLabel || 'No pallet';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  });
  const keys = Array.from(groups.keys()).sort();
  let html = '';
  keys.forEach(palletKey => {
    const list = groups.get(palletKey).slice()
      .sort((a,b) => (STAGE_ORDER[a.stage]||9) - (STAGE_ORDER[b.stage]||9) || a.poNum.localeCompare(b.poNum));
    const issueCount = list.filter(r => r.hasIssue).length;
    html += '<div class="ipt-group">' +
      '<div class="ipt-group-label">' +
        esc(palletKey) +
        '<span class="ipt-group-chip">' + fmtN(list.length) + ' PO' + (list.length !== 1 ? 's' : '') + '</span>' +
        (issueCount ? '<span class="ft-day-risk">⚠ ' + issueCount + ' need attention</span>' : '') +
      '</div>' +
      list.map(poJourneyCard).join('') +
    '</div>';
  });
  return html || '<section class="empty-state"><h2>No matching POs</h2><p>Try clearing your filters.</p></section>';
}

function renderBoard(rows) {
  if (!rows.length) {
    els.boardContent.innerHTML =
      '<section class="empty-state"><h2>No POs found</h2><p>Try clearing your filters or check back once new pallets are added.</p></section>';
    return;
  }
  let html;
  switch (state.groupBy) {
    case 'day':    html = renderByDay(rows); break;
    case 'pallet': html = renderByPallet(rows); break;
    case 'stage':
    default:       html = renderByStage(rows);
  }
  els.boardContent.innerHTML = html;
}

// ── Load + refresh ─────────────────────────────────────────────────────────
async function loadBoard() {
  try {
    const data = await getInboundState();
    state.pallets   = data.pallets || [];
    state.updatedAt = data.updated_at;
    const occ = flattenOccurrences(state.pallets);
    state.rows = aggregateByPo(occ);
    // Default sort: issues first, then by latest activity
    state.rows.sort((a,b) => {
      if (a.hasIssue !== b.hasIssue) return a.hasIssue ? -1 : 1;
      return (b.latestActivity||0) - (a.latestActivity||0);
    });
    els.lastUpdated.textContent = fmtUpdated(state.updatedAt);
    updateFilters(state.rows);
    applyFilters();
  } catch (err) {
    console.error('Inbound flight tracker load failed:', err);
    els.boardContent.innerHTML =
      '<section class="empty-state"><h2>Unable to load board</h2><p>' + esc(err.message || 'Unknown error') + '</p></section>';
  }
}

// ── Wire up ────────────────────────────────────────────────────────────────
function init() {
  els.refreshBtn.addEventListener('click', loadBoard);
  els.searchInput.addEventListener('input', applyFilters);
  els.groupBySelect.addEventListener('change', applyFilters);
  els.stageFilter.addEventListener('change', applyFilters);
  els.categoryFilter.addEventListener('change', applyFilters);
  els.dayFilter.addEventListener('change', applyFilters);
  els.onlyIssues.addEventListener('change', applyFilters);
  loadBoard();
  setInterval(loadBoard, REFRESH_MS);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
