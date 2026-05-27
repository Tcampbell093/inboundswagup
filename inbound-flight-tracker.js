'use strict';
/* =========================================================
   INBOUND PO FLIGHT TRACKER  —  inbound-flight-tracker.js
   External-facing visibility for inbound POs.
   Mirrors the structure of assembly-flight-tracker.js.
   Data source: /.netlify/functions/workflow-sync (GET)
   Fallback   : localStorage key used by inbound-pallets.js
   ========================================================= */

const workflowApiBase = '/.netlify/functions/workflow-sync';
const priorityApiBase = '/.netlify/functions/inbound-po-priorities';
const commentsApiBase = '/.netlify/functions/inbound-po-comments';
const REFRESH_MS      = 60000;
const WATCHLIST_KEY   = 'ipt_watchlist_v1';
const AUTHOR_KEY      = 'ipt_author_name';

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  pallets:       [],      // raw pallets from backend
  rows:          [],      // flattened+aggregated PO rows (one per PO#) + pending-arrival rows
  filtered:      [],
  updatedAt:     null,
  groupBy:       'stage', // 'stage' | 'day' | 'pallet'
  priorities:    {},      // poNum (lowercased) -> { note, set_by, set_at }
  watchlist:     new Set(), // poNum lowercased
  commentCounts: {},      // poNum (lowercased) -> { total, unread, hasPriority, latestAt }
};

let ftUserRole = 'external';
let ftUserName = '';
let ftUserEmail = '';

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
function resolveFtIdentity() {
  // Best-effort: try the live window first, then localStorage.
  // Parent will overwrite these via postMessage as soon as it can.
  try {
    if (window.hcCurrentUser) {
      ftUserName  = window.hcCurrentUser.name  || ftUserName;
      ftUserEmail = window.hcCurrentUser.email || ftUserEmail;
    }
    const raw = localStorage.getItem('hcAuthUser');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed) {
        ftUserName  = parsed.name  || ftUserName;
        ftUserEmail = parsed.email || ftUserEmail;
      }
    }
  } catch(_){}
}
ftUserRole = resolveFtRole();
resolveFtIdentity();

window.addEventListener('message', function (e) {
  if (!e.data) return;
  if (e.data.type === 'HC_ROLE') {
    ftUserRole  = normRole(e.data.role) || 'external';
    if (e.data.name)  ftUserName  = e.data.name;
    if (e.data.email) ftUserEmail = e.data.email;
    // Refresh any open compose surfaces so the "Posting as" line is current
    if (typeof applyIdentityToModals === 'function') applyIdentityToModals();
    return;
  }
  // Parent app saved new workflow data — refresh the board now so the user
  // sees changes from the inbound module without waiting for the 60s poll.
  if (e.data.type === 'HC_INBOUND_DATA_CHANGED') {
    if (typeof loadBoard === 'function') {
      setTimeout(loadBoard, 400);
    }
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

// ── PO key normalizer (used everywhere for case-insensitive lookups) ───────
function poKey(v){ return String(v||'').trim().toLowerCase(); }

// ── Watchlist (per-browser, localStorage) ──────────────────────────────────
function loadWatchlist(){
  try {
    const raw = localStorage.getItem(WATCHLIST_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.map(poKey).filter(Boolean) : []);
  } catch(_) { return new Set(); }
}
function saveWatchlist(){
  try { localStorage.setItem(WATCHLIST_KEY, JSON.stringify(Array.from(state.watchlist))); } catch(_){}
}
function isWatched(poNum){ return state.watchlist.has(poKey(poNum)); }
function toggleWatch(poNum){
  const k = poKey(poNum);
  if (!k) return;
  if (state.watchlist.has(k)) state.watchlist.delete(k);
  else state.watchlist.add(k);
  saveWatchlist();
}

// ── Priority (shared, backend) ─────────────────────────────────────────────
function isPriority(poNum){ return !!state.priorities[poKey(poNum)]; }
function priorityInfo(poNum){ return state.priorities[poKey(poNum)] || null; }
async function loadPriorities(){
  try {
    const res = await fetch(priorityApiBase, { headers:{Accept:'application/json'} });
    if (!res.ok) return;
    const data = await res.json();
    const map = {};
    (data.priorities || []).forEach(p => {
      if (p && p.po_num) map[poKey(p.po_num)] = p;
    });
    state.priorities = map;
  } catch(_) { /* non-fatal */ }
}
async function setPriorityRemote(poNum, note, setBy){
  const res = await fetch(priorityApiBase, {
    method:'POST',
    headers:{ 'Content-Type':'application/json', Accept:'application/json' },
    body: JSON.stringify({ poNum, note, setBy })
  });
  if (!res.ok) {
    let msg = 'Failed to save priority';
    try { const j = await res.json(); if (j && j.error) msg = j.error; } catch(_){}
    throw new Error(msg);
  }
  const data = await res.json();
  if (data && data.priority) state.priorities[poKey(poNum)] = data.priority;
}
async function clearPriorityRemote(poNum){
  const res = await fetch(priorityApiBase + '?po=' + encodeURIComponent(poNum), { method:'DELETE' });
  if (!res.ok) throw new Error('Failed to clear priority');
  delete state.priorities[poKey(poNum)];
}

// ── Comments (per-PO threads) ──────────────────────────────────────────────
//   Persisted in backend table inbound_po_comments. We fetch the last 500
//   on every board refresh to build a per-PO count + unread + priority-flag
//   map, which the cards use to render their comment button.
function readerIdentity(){
  // Used as the reader key for unread tracking. Prefer the authenticated
  // email when we have one (most stable identifier), then the verified name,
  // then a locally-cached author key as a final fallback.
  if (ftUserEmail) return String(ftUserEmail).toLowerCase();
  if (ftUserName)  return String(ftUserName).toLowerCase();
  try {
    const saved = (localStorage.getItem(AUTHOR_KEY) || '').trim();
    if (saved) return saved.toLowerCase();
  } catch(_){}
  return '';
}

// Push the current authenticated identity into any compose surfaces that
// are currently rendered or about to open. Called when an HC_ROLE message
// arrives and when modals open.
function applyIdentityToModals(){
  // Comment modal — set hidden author + "Posting as" line
  if (cmEls && cmEls.author) {
    cmEls.author.value = ftUserName || '';
  }
  const asLine = document.getElementById('cmAsLine');
  const asName = document.getElementById('cmAsName');
  if (asLine && asName) {
    if (ftUserName) {
      asName.textContent = ftUserName;
      asLine.hidden = false;
    } else {
      asLine.hidden = true;
    }
  }
  // Priority modal — set hidden by-input + hint
  const priBy   = document.getElementById('priorityByInput');
  const priHint = document.getElementById('priorityModalAsHint');
  const priAs   = document.getElementById('priorityAsName');
  if (priBy)   priBy.value = ftUserName || '';
  if (priHint && priAs) {
    if (ftUserName) {
      priAs.textContent = ftUserName;
      priHint.hidden = false;
    } else {
      priHint.hidden = true;
    }
  }
}
async function loadCommentCounts(){
  try {
    const res = await fetch(commentsApiBase + '?latest=500', { headers:{Accept:'application/json'} });
    if (!res.ok) return;
    const data = await res.json();
    const reader = readerIdentity();
    const map = {};
    (data.comments || []).forEach(c => {
      if (!c || !c.po_num) return;
      const k = poKey(c.po_num);
      if (!map[k]) map[k] = { total:0, unread:0, hasPriority:false, latestAt:0 };
      map[k].total++;
      if (c.category === 'priority' || c.category === 'damage_report' || c.category === 'vendor_issue') {
        map[k].hasPriority = true;
      }
      const ts = c.created_at ? new Date(c.created_at).getTime() : 0;
      if (ts > map[k].latestAt) map[k].latestAt = ts;
      if (reader && Array.isArray(c.read_by) && !c.read_by.includes(reader)) {
        map[k].unread++;
      } else if (!reader) {
        // No reader identity yet — treat everything as unread so the
        // user sees the dot until they enter a name.
        map[k].unread++;
      }
    });
    state.commentCounts = map;
  } catch(_) { /* non-fatal */ }
}
function getCommentInfo(poNum){
  return state.commentCounts[poKey(poNum)] || { total:0, unread:0, hasPriority:false, latestAt:0 };
}
async function markCommentsRead(poNum){
  const reader = readerIdentity();
  if (!reader) return;
  try {
    await fetch(commentsApiBase, {
      method:'PATCH',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ reader, po_num: poNum })
    });
    // Optimistic — zero out unread for this PO
    const info = state.commentCounts[poKey(poNum)];
    if (info) info.unread = 0;
  } catch(_) { /* non-fatal */ }
}

// ── Age tier (how long has the PO been pending QA?) ────────────────────────
//   Tiers based on hours since the relevant "clock start":
//     dock/receiving stage → clock starts at earliest pallet creation
//     prep stage           → clock starts at earliest pallet creation (same — receiving completion timestamp isn't on the PO record)
//   Tier thresholds:
//     <24h   → 'fresh' (calm)
//     24-48h → 'tier1' (amber)
//     48-72h → 'tier2' (orange)
//     ≥72h   → 'tier3' (red, pulsing)
//   Done POs have no age signal.
function ageInfo(row){
  if (row.stage === 'done')   return { hours:0, tier:'done',  label:'' };
  if (row.pendingArrival)     return { hours:0, tier:'pending', label:'Awaiting first pallet' };
  const start = Number(row.qaWaitStart || 0);
  if (!start)                 return { hours:0, tier:'fresh', label:'New' };
  const hours = Math.floor((Date.now() - start) / 3600000);
  let tier = 'fresh';
  if (hours >= 72)      tier = 'tier3';
  else if (hours >= 48) tier = 'tier2';
  else if (hours >= 24) tier = 'tier1';
  // Human-friendly label
  let label;
  if (hours < 1)        label = '<1h pending';
  else if (hours < 24)  label = hours + 'h pending';
  else {
    const days = Math.floor(hours / 24);
    const rem  = hours - days * 24;
    label = days + 'd' + (rem ? ' ' + rem + 'h' : '') + ' pending';
  }
  return { hours, tier, label };
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
//   The pallet's status is the authoritative signal — it tells us which
//   physical panel the pallet currently sits in. We layer per-PO flags
//   on top only to distinguish "routed vs prep" within the Prep stage.
//
//     pallet.status='draft'      → 'dock'         (POs sitting on the dock)
//     pallet.status='receiving'  → 'receiving'    (QA Receiving in progress)
//     pallet.status='prep'       → 'prep'         (default in Prep panel)
//                                → 'routed'       (if this PO is prepVerified AND assigned)
//     pallet.status='done'       → 'done'
//
//   We deliberately ignore per-PO receivingDone here — that flag just means
//   "the associate finished QA'ing this one PO". The pallet stays in the
//   Receiving panel until the whole pallet advances, and that's what
//   external owners care about.
function derivePoStage(po, pallet) {
  const pStatus = String(pallet && pallet.status || '').toLowerCase();
  if (pStatus === 'done')      return 'done';
  if (pStatus === 'prep') {
    const hasRouting = !!(po.destination) ||
                       Number(po.stsQty||0) > 0 ||
                       Number(po.ltsQty||0) > 0;
    if (po.prepVerified && hasRouting) return 'routed';
    return 'prep';
  }
  if (pStatus === 'receiving') return 'receiving';
  return 'dock'; // draft or unknown
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
        // Active case (single shared slot) — null if no active case.
        // Shape: { openedAt, openedBy, openedAtStage, link, ref, note, status }
        case:            po.case || null,
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
        // earliest timestamp the PO entered the system on a still-pending pallet
        // (used for the "how long has this been pending QA?" age signal)
        qaWaitStart: 0,
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
    // QA-pending clock: earliest pallet creation timestamp across all occurrences
    // that are NOT yet done. We use earliest so partial POs reflect their longest-waiting leg.
    if (occ.stage !== 'done' && occTs > 0) {
      if (!agg.qaWaitStart || occTs < agg.qaWaitStart) agg.qaWaitStart = occTs;
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

    // Active case — first non-null wins. Same PO across two pallets should
    // share one case anyway (one PO = one case at a time).
    r.case = null;
    r.occurrences.forEach(o => { if (!r.case && o.case) r.case = o.case; });
    r.hasCase = !!r.case;

    // Flags
    r.isPartial         = r.occurrences.length > 1;
    r.recvVsOrdered     = (r.receivedQty != null && r.orderedQty != null) ? r.receivedQty - r.orderedQty : null;
    r.prepVsRecv        = (r.prepReceivedQty != null && r.receivedQty != null) ? r.prepReceivedQty - r.receivedQty : null;
    r.hasOverstock      = r.recvVsOrdered != null && r.recvVsOrdered > 0;
    r.hasShortage       = r.recvVsOrdered != null && r.recvVsOrdered < 0 && r.stage === 'done';
    r.hasCountMismatch  = r.prepVsRecv != null && r.prepVsRecv !== 0;
    r.hasIssue          = r.hasShortage || r.hasCountMismatch || r.hasCase ||
                          (r.stage === 'done' && r.hasOverstock);
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
  onlyWatchlist:  document.getElementById('onlyWatchlist'),
  onlyPriority:   document.getElementById('onlyPriority'),
  onlyCases:      document.getElementById('onlyCases'),
  boardContent:   document.getElementById('boardContent'),
  statTotalPos:   document.getElementById('statTotalPos'),
  statDock:       document.getElementById('statDock'),
  statReceiving:  document.getElementById('statReceiving'),
  statPrep:       document.getElementById('statPrep'),
  statDone:       document.getElementById('statDone'),
  statPriority:   document.getElementById('statPriority'),
  statCases:      document.getElementById('statCases'),
  statUnreadComments: document.getElementById('statUnreadComments'),
  statIssues:     document.getElementById('statIssues'),
  // Priority modal
  markPriorityBtn:   document.getElementById('markPriorityBtn'),
  priorityModal:     document.getElementById('priorityModal'),
  priorityModalSub:  document.getElementById('priorityModalSub'),
  priorityModalClose:document.getElementById('priorityModalClose'),
  priorityPoInput:   document.getElementById('priorityPoInput'),
  priorityByInput:   document.getElementById('priorityByInput'),
  priorityNoteInput: document.getElementById('priorityNoteInput'),
  priorityModalError:document.getElementById('priorityModalError'),
  priorityMarkBtn:   document.getElementById('priorityMarkBtn'),
  priorityUnmarkBtn: document.getElementById('priorityUnmarkBtn'),
  // Case details modal
  caseDetailsModal:   document.getElementById('caseDetailsModal'),
  caseDetailsTitle:   document.getElementById('caseDetailsTitle'),
  caseDetailsSub:     document.getElementById('caseDetailsSub'),
  caseDetailsBody:    document.getElementById('caseDetailsBody'),
  caseDetailsClose:   document.getElementById('caseDetailsClose'),
  caseDetailsDismiss: document.getElementById('caseDetailsDismiss'),
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
  const q             = els.searchInput.value.trim().toLowerCase();
  const stage         = els.stageFilter.value;
  const category      = els.categoryFilter.value;
  const day           = els.dayFilter.value;
  const onlyIssues    = !!els.onlyIssues.checked;
  const onlyWatchlist = !!(els.onlyWatchlist && els.onlyWatchlist.checked);
  const onlyPriority  = !!(els.onlyPriority  && els.onlyPriority.checked);
  const onlyCases     = !!(els.onlyCases     && els.onlyCases.checked);
  state.groupBy       = els.groupBySelect.value;

  state.filtered = state.rows.filter(r => {
    const matchSearch   = !q || [r.poNum, r.category, r.palletLabel, stageLabel(r.stage)]
      .some(v => String(v||'').toLowerCase().includes(q));
    const matchStage    = !stage    || stageLabel(r.stage) === stage;
    const matchCategory = !category || r.category === category;
    const matchDay      = !day      || r.palletDate === day;
    const matchIssue    = !onlyIssues    || r.hasIssue;
    const matchWatch    = !onlyWatchlist || r.watched;
    const matchPri      = !onlyPriority  || r.priority;
    const matchCase     = !onlyCases     || r.hasCase;
    return matchSearch && matchStage && matchCategory && matchDay
        && matchIssue && matchWatch && matchPri && matchCase;
  });

  renderStats(state.filtered);
  renderBoard(state.filtered);
}

// ── Stats ──────────────────────────────────────────────────────────────────
function renderStats(rows) {
  els.statTotalPos.textContent  = fmtN(rows.length);
  els.statDock.textContent      = fmtN(rows.filter(r => r.stage === 'dock' && !r.pendingArrival).length);
  els.statReceiving.textContent = fmtN(rows.filter(r => r.stage === 'receiving').length);
  els.statPrep.textContent      = fmtN(rows.filter(r => r.stage === 'prep' || r.stage === 'routed').length);
  els.statDone.textContent      = fmtN(rows.filter(r => r.stage === 'done').length);

  const priCount = rows.filter(r => r.priority).length;
  if (els.statPriority) els.statPriority.textContent = fmtN(priCount);

  // Open cases = POs with at least one case flag set (receiving or prep)
  const caseCount = rows.filter(r => r.hasCase).length;
  if (els.statCases) {
    els.statCases.textContent = fmtN(caseCount);
    const chip = els.statCases.closest('.stat-chip');
    if (chip) chip.classList.toggle('has-cases', caseCount > 0);
  }

  // Sum unread comments across the visible rows
  let unreadTotal = 0;
  rows.forEach(r => { unreadTotal += getCommentInfo(r.poNum).unread; });
  if (els.statUnreadComments) {
    els.statUnreadComments.textContent = fmtN(unreadTotal);
    const chip = els.statUnreadComments.closest('.stat-chip');
    if (chip) chip.classList.toggle('has-unread', unreadTotal > 0);
  }

  const issues = rows.filter(r => r.hasIssue).length;
  els.statIssues.textContent    = fmtN(issues);
  const issueChip = els.statIssues.closest('.stat-chip');
  if (issueChip) issueChip.classList.toggle('stat-chip-risk-active', issues > 0);
}

// ── Journey card per PO ────────────────────────────────────────────────────
//  Quantities are intentionally NOT shown — external owners only see stage,
//  age-since-pending, priority/watchlist state, and discrepancy flags.
function poJourneyCard(row) {
  const curOrder  = STAGE_ORDER[row.stage] || 1;
  const cardCls   = (row.hasIssue ? ' has-issue' : '')
                  + (row.stage === 'done' ? ' is-done' : '')
                  + (row.priority ? ' is-priority' : '')
                  + (row.pendingArrival ? ' pending-arrival' : '');
  const stageCls  = 'ipt-stage-' + row.stage;
  const stageLbl  = stageLabel(row.stage);

  // Journey dots — reuse .ft-j-* classes from assembly-flight-tracker.css.
  // For pending-arrival rows we render all dots as inactive (clock hasn't started).
  // Case markers ride the connector line between stages:
  //   • receiving-case marker → between Receiving (idx 1) and Prep (idx 2)
  //     → rendered inside the Prep step block (i=2)
  //   • prep-case marker → between Prep (idx 2) and Routed (idx 3)
  //     → rendered inside the Routed step block (i=3)
  let stepsHtml = '';
  STAGES.forEach(function (s, i) {
    const stepDone   = !row.pendingArrival && curOrder >  s.order;
    const stepActive = !row.pendingArrival && curOrder === s.order;
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

    // Pick the relevant case marker (if any) for this connector.
    // The single shared case lives in row.case; we read openedAtStage to
    // decide which connector the marker sits on:
    //   receiving → marker between Receiving (1) and Prep (2)        → step i=2
    //   prep      → marker between Prep (2) and Routed (3)           → step i=3
    let caseMarker = '';
    if (row.case) {
      const targetIdx = row.case.openedAtStage === 'prep' ? 3 : 2;
      if (i === targetIdx) {
        const tip = (row.case.ref ? row.case.ref + ' · ' : '') +
                    'Case opened during ' + (row.case.openedAtStage || '?') +
                    (row.case.note ? ' — ' + row.case.note : '');
        caseMarker = '<div class="ipt-case-marker" data-case-po="' + esc(row.poNum) +
          '" title="' + esc(tip) + '">📁</div>';
      }
    }

    stepsHtml +=
      '<div class="ft-j-step">' +
        (!isLast ? '<div class="' + lineCls + '"></div>' : '') +
        caseMarker +
        '<div class="' + dotCls + '">' + dotContent + '</div>' +
        '<div class="' + lblCls + '">' + s.label + '</div>' +
      '</div>';
  });

  // Issue & status badges (no quantities)
  const badges = [];
  if (row.isPartial)        badges.push('<span class="ipt-partial-chip">Partial · ' + row.occurrences.length + ' pallets</span>');
  if (row.hasOverstock)     badges.push('<span class="ipt-overstock-chip">Overstock received</span>');
  if (row.hasShortage)      badges.push('<span class="ipt-issue-chip">Short receipt</span>');
  if (row.hasCountMismatch) badges.push('<span class="ipt-issue-chip">Receiving / Prep count mismatch</span>');
  if (row.case) {
    const stg = row.case.openedAtStage || '?';
    const stgLbl = stg === 'prep' ? 'Prep' : 'Receiving';
    badges.push('<span class="ipt-case-chip">📁 Case open · ' + esc(stgLbl) + '</span>');
  }

  // Age signal (24h tiers)
  const age = ageInfo(row);
  let ageHtml = '';
  if (age.tier === 'pending') {
    ageHtml = '<span class="ipt-age-badge ipt-age-fresh">' + esc(age.label) + '</span>';
  } else if (age.tier !== 'done') {
    const cls = 'ipt-age-' + age.tier;
    ageHtml = '<span class="ipt-age-badge ' + cls + '" title="Hours since this PO entered the warehouse without completing QA">⏱ ' + esc(age.label) + '</span>';
  }

  // Pallet/date label
  const dateLbl = row.palletDate ? fmtDateLabel(row.palletDate) : '';

  // Watch + priority action buttons
  const watchBtn = '<button class="ipt-action-btn ipt-watch-btn' + (row.watched ? ' is-on' : '') + '"' +
    ' type="button" data-watch="' + esc(row.poNum) + '"' +
    ' title="' + (row.watched ? 'Remove from your watchlist' : 'Add to your watchlist') + '">' +
    (row.watched ? '★' : '☆') + '</button>';
  const priBtn   = '<button class="ipt-action-btn ipt-pri-btn' + (row.priority ? ' is-on' : '') + '"' +
    ' type="button" data-priority="' + esc(row.poNum) + '"' +
    ' title="' + (row.priority ? 'Edit or remove priority' : 'Mark as priority for everyone') + '">' +
    (row.priority ? '🔥 Priority' : 'Mark priority') + '</button>';

  // Comment button — always shown so external users can ask a question even
  // when there are no comments yet. Shows count + unread dot when applicable.
  const cInfo = getCommentInfo(row.poNum);
  const cmtCls = 'ipt-action-btn ipt-comment-btn' + (cInfo.total ? ' has-thread' : '');
  const cmtLabel = cInfo.total
    ? '💬 <span class="ipt-comment-count">' + cInfo.total + '</span>'
    : '💬 Ask / comment';
  const cmtTitle = cInfo.total
    ? (cInfo.total + ' comment' + (cInfo.total!==1?'s':'') + ' on this PO' + (cInfo.unread ? ' · ' + cInfo.unread + ' new' : ''))
    : 'Start a conversation about this PO with the inbound team';
  const cmtBtn = '<button class="' + cmtCls + '" type="button"' +
    ' data-comment="' + esc(row.poNum) + '"' +
    ' title="' + cmtTitle + '">' +
    cmtLabel +
    (cInfo.unread ? '<span class="ipt-unread-dot" aria-label="' + cInfo.unread + ' unread"></span>' : '') +
    '</button>';

  // Optional priority note
  let priNote = '';
  if (row.priority && row.priorityInfo && row.priorityInfo.note) {
    const by = row.priorityInfo.set_by ? ' — ' + esc(row.priorityInfo.set_by) : '';
    priNote = '<div class="ipt-priority-note">★ ' + esc(row.priorityInfo.note) + by + '</div>';
  } else if (row.pendingArrival) {
    priNote = '<div class="ipt-priority-note">★ Flagged before warehouse arrival — visible to everyone</div>';
  }

  // Case context line — content depends on viewer role:
  //   externals see only that a case is open (the chip already says that).
  //   internal users get a thin row with "View details" that opens the link/ref/note modal.
  let caseNotes = '';
  if (row.case) {
    const isInternal = ftUserRole && ftUserRole !== 'external';
    if (isInternal) {
      const by = row.case.openedBy ? ' by ' + esc(row.case.openedBy) : '';
      const openedTs = row.case.openedAt
        ? new Date(row.case.openedAt).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})
        : '';
      caseNotes = '<div class="ipt-case-note">' +
        '📁 Case opened during ' + esc(row.case.openedAtStage || '?') + by +
        (openedTs ? ' · ' + esc(openedTs) : '') +
        ' <button type="button" class="ipt-case-details-btn" data-case-po="' + esc(row.poNum) + '">View details ›</button>' +
        '</div>';
    }
    // external users: no caseNotes line — the chip is the whole signal.
  }

  // Top-row chips
  const chips = [];
  if (row.category)       chips.push('<span class="ipt-cat-chip">' + esc(row.category) + '</span>');
  if (row.palletLabel)    chips.push('<span class="ipt-pallet-chip">' + esc(row.palletLabel) + '</span>');
  if (row.pendingArrival) chips.push('<span class="ipt-pending-chip">Pending arrival</span>');
  if (row.priority)       chips.push('<span class="ipt-priority-chip">★ Priority</span>');
  if (cInfo.hasPriority)  chips.push('<span class="ipt-issue-chip" title="A priority, vendor, or damage comment is on this PO">💬 Flagged in comments</span>');

  // Bottom row — context, no quantities
  const bottomBits = [];
  if (dateLbl) bottomBits.push('Day: <strong>' + esc(dateLbl) + '</strong>');
  if (row.pendingArrival) bottomBits.push('Waiting for first pallet receipt');

  return '<div class="ipt-card' + cardCls + '">' +
    '<div class="ipt-card-body">' +
      '<div class="ipt-top">' +
        '<span class="ipt-po-num">PO# ' + esc(row.poNum) + '</span>' +
        chips.join('') +
        ageHtml +
        '<span class="ipt-stage-badge ' + stageCls + '" style="margin-left:auto;">' + esc(stageLbl) + '</span>' +
      '</div>' +
      '<div class="ipt-journey">' + stepsHtml + '</div>' +
      (bottomBits.length || badges.length || true
        ? '<div class="ipt-bottom">' +
            bottomBits.map(b => '<span>' + b + '</span>').join('') +
            badges.join('') +
            '<span style="margin-left:auto;display:inline-flex;gap:6px;">' + cmtBtn + watchBtn + priBtn + '</span>' +
          '</div>'
        : '') +
      caseNotes +
      priNote +
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
    // Sort: priority first, then issues, then oldest-pending, then partial, then recency
    list.sort((a,b) => {
      if (a.priority !== b.priority) return a.priority ? -1 : 1;
      if (a.hasIssue !== b.hasIssue) return a.hasIssue ? -1 : 1;
      // Oldest pending QA first within a stage (so longest-waiting POs surface)
      const ageDelta = (a.qaWaitStart || Infinity) - (b.qaWaitStart || Infinity);
      if (ageDelta !== 0) return ageDelta;
      if (a.isPartial !== b.isPartial) return a.isPartial ? -1 : 1;
      return (b.latestActivity||0) - (a.latestActivity||0);
    });
    const issueCount = list.filter(r => r.hasIssue).length;
    const priCount   = list.filter(r => r.priority).length;
    html += '<div class="ipt-group">' +
      '<div class="ipt-group-label">' +
        esc(stageLabel(stageKey)) +
        '<span class="ipt-group-chip">' + fmtN(list.length) + ' PO' + (list.length !== 1 ? 's' : '') + '</span>' +
        (priCount   ? '<span class="ipt-priority-chip">★ ' + priCount + ' priority</span>' : '') +
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
      .sort((a,b) => {
        if (a.priority !== b.priority) return a.priority ? -1 : 1;
        return (STAGE_ORDER[a.stage]||9) - (STAGE_ORDER[b.stage]||9) || a.poNum.localeCompare(b.poNum);
      });
    const issueCount = list.filter(r => r.hasIssue).length;
    const priCount   = list.filter(r => r.priority).length;
    html += '<div class="ipt-group">' +
      '<div class="ipt-group-label">' +
        esc(fmtDateLabel(dateKey)) +
        '<span class="ipt-group-chip">' + fmtN(list.length) + ' PO' + (list.length !== 1 ? 's' : '') + '</span>' +
        (priCount   ? '<span class="ipt-priority-chip">★ ' + priCount + ' priority</span>' : '') +
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
      .sort((a,b) => {
        if (a.priority !== b.priority) return a.priority ? -1 : 1;
        return (STAGE_ORDER[a.stage]||9) - (STAGE_ORDER[b.stage]||9) || a.poNum.localeCompare(b.poNum);
      });
    const issueCount = list.filter(r => r.hasIssue).length;
    const priCount   = list.filter(r => r.priority).length;
    html += '<div class="ipt-group">' +
      '<div class="ipt-group-label">' +
        esc(palletKey) +
        '<span class="ipt-group-chip">' + fmtN(list.length) + ' PO' + (list.length !== 1 ? 's' : '') + '</span>' +
        (priCount   ? '<span class="ipt-priority-chip">★ ' + priCount + ' priority</span>' : '') +
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
    // Kick off pallet + priority + comment-count fetches in parallel
    const [data] = await Promise.all([
      getInboundState(),
      loadPriorities(),     // updates state.priorities side-effect
      loadCommentCounts(),  // updates state.commentCounts side-effect
    ]);
    state.pallets   = data.pallets || [];
    state.updatedAt = data.updated_at;

    // 1. Flatten + aggregate POs found on pallets
    const occ = flattenOccurrences(state.pallets);
    const rows = aggregateByPo(occ);

    // 2. Mark priority + watched on each row
    rows.forEach(r => {
      r.priority    = isPriority(r.poNum);
      r.priorityInfo = priorityInfo(r.poNum);
      r.watched     = isWatched(r.poNum);
    });

    // 3. Append pending-arrival rows for priority POs that aren't on any pallet yet
    const knownKeys = new Set(rows.map(r => poKey(r.poNum)));
    Object.values(state.priorities).forEach(p => {
      if (!p || !p.po_num) return;
      const k = poKey(p.po_num);
      if (knownKeys.has(k)) return;
      // Build a synthetic pending-arrival row — no pallet attached yet
      rows.push({
        poNum:            p.po_num,
        category:         '',
        orderedQty:       null,
        receivedQty:      null,
        prepReceivedQty:  null,
        boxes:            0,
        stsQty:           0,
        ltsQty:           0,
        stage:            'dock',
        stageOrder:       1,
        palletLabel:      '',
        palletId:         '',
        palletDate:       '',
        occurrences:      [],
        latestActivity:   p.set_at ? new Date(p.set_at).getTime() : Date.now(),
        qaWaitStart:      0,
        isPartial:        false,
        recvVsOrdered:    null,
        prepVsRecv:       null,
        hasOverstock:     false,
        hasShortage:      false,
        hasCountMismatch: false,
        hasIssue:         false,
        priority:         true,
        priorityInfo:     p,
        watched:          isWatched(p.po_num),
        pendingArrival:   true,
      });
    });

    state.rows = rows;
    // Default sort: priority first, then issues, then by latest activity
    state.rows.sort((a,b) => {
      if (a.priority   !== b.priority)   return a.priority   ? -1 : 1;
      if (a.hasIssue   !== b.hasIssue)   return a.hasIssue   ? -1 : 1;
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

// ── Comment modal ──────────────────────────────────────────────────────────
const cmState = { poNum: '', category: 'general' };
const cmEls = {
  overlay:   document.getElementById('commentModal'),
  title:     document.getElementById('cmTitle'),
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

const CM_CAT_LABELS = {
  general:       '💬 General Note',
  question:      '❓ Question',
  instructions:  '📋 Special Instructions',
  priority:      '🔴 Priority Request',
  vendor_issue:  '🏭 Vendor Issue',
  damage_report: '⚠️ Damage Report',
};

function cmFmtTime(iso){
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
}

function cmRenderThread(comments){
  if (!cmEls.thread) return;
  if (!comments.length) {
    cmEls.thread.innerHTML = '<p class="cm-empty">No comments yet. Start a conversation with the inbound team.</p>';
    return;
  }
  cmEls.thread.innerHTML = comments.map(c => {
    const name = String(c.author_name||'').trim() || 'Stakeholder';
    const isInternal = /\(internal\)|\[team\]|warehouse|inbound team/i.test(name);
    const displayName = name.replace(/\s*\(internal\)/i,'').replace(/\s*\[team\]/i,'').trim();
    const catLbl = CM_CAT_LABELS[c.category] || c.category;
    return '<div class="cm-comment cm-cat-' + esc(c.category) + (isInternal ? ' cm-internal' : '') + '">' +
      '<div class="cm-comment-meta">' +
        '<span class="cm-cat-badge">' + esc(catLbl) + '</span>' +
        '<span class="cm-comment-author">' + esc(displayName) + '</span>' +
        '<span class="cm-comment-time">' + esc(cmFmtTime(c.created_at)) + '</span>' +
      '</div>' +
      '<p class="cm-comment-body">' + esc(c.body) + '</p>' +
    '</div>';
  }).join('');
  cmEls.thread.scrollTop = cmEls.thread.scrollHeight;
}

async function cmLoadComments(){
  if (!cmEls.thread) return;
  cmEls.thread.innerHTML = '<p class="cm-loading">Loading comments…</p>';
  try {
    const res  = await fetch(commentsApiBase + '?po_num=' + encodeURIComponent(cmState.poNum), {
      headers:{Accept:'application/json'}
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || ('Load failed (' + res.status + ')'));
    cmRenderThread(data.comments || []);
  } catch (err) {
    cmEls.thread.innerHTML = '<p class="cm-empty cm-err-text">Could not load comments: ' + esc(err.message) + '</p>';
  }
}

function cmOpenModal(poNum, context){
  if (!cmEls.overlay) return;
  cmState.poNum = poNum;
  cmEls.title.textContent    = 'PO# ' + poNum;
  cmEls.subtitle.textContent = context || '';
  if (cmEls.error) cmEls.error.hidden = true;
  cmEls.overlay.hidden  = false;
  document.body.style.overflow = 'hidden';
  // Apply the verified user identity to the hidden author field + posting-as line
  applyIdentityToModals();
  // Update character counter for any pre-existing text
  if (cmEls.body && cmEls.charCount) {
    cmEls.charCount.textContent = (cmEls.body.value.length || 0) + ' / 2000';
  }
  cmLoadComments();
  // Mark thread as read in the background
  markCommentsRead(poNum).then(() => {
    // Refresh stats so the unread dot in the header goes away
    if (state.filtered && state.filtered.length) renderStats(state.filtered);
  });
}

function cmCloseModal(){
  if (!cmEls.overlay) return;
  cmEls.overlay.hidden = true;
  document.body.style.overflow = '';
}

async function cmSubmit(){
  if (!cmState.poNum) return;
  // Identity comes from the parent app via postMessage. Fall back to the
  // hidden author field (which applyIdentityToModals keeps in sync).
  const author   = (ftUserName || (cmEls.author && cmEls.author.value) || '').trim();
  const category = cmEls.category.value || 'general';
  const body     = (cmEls.body.value || '').trim();
  cmEls.error.hidden = true;
  if (!body) {
    cmEls.error.textContent = 'Please enter a message before sending.';
    cmEls.error.hidden = false;
    return;
  }
  if (!author) {
    cmEls.error.textContent = 'Your account does not have a display name. Click your name in the top-right corner to set one.';
    cmEls.error.hidden = false;
    return;
  }
  cmEls.submit.disabled = true;
  try {
    const res = await fetch(commentsApiBase, {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({
        po_num:      cmState.poNum,
        author_name: author,
        category:    category,
        body:        body,
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || ('Send failed (' + res.status + ')'));
    cmEls.body.value = '';
    cmEls.charCount.textContent = '0 / 2000';
    // Reload thread + refresh counts in background
    await cmLoadComments();
    await loadCommentCounts();
    applyFilters();
  } catch (err) {
    cmEls.error.textContent = err.message || 'Could not send.';
    cmEls.error.hidden = false;
  } finally {
    cmEls.submit.disabled = false;
  }
}

// ── Case details modal (internal-only viewer) ─────────────────────────────
function openCaseDetailsModal(poNum) {
  if (!els.caseDetailsModal) return;
  const row = state.rows.find(r => poKey(r.poNum) === poKey(poNum));
  if (!row || !row.case) return;
  const c = row.case;
  els.caseDetailsTitle.textContent = 'PO# ' + row.poNum + ' — Case open';
  const subBits = [];
  if (c.openedAtStage) subBits.push('Opened during ' + (c.openedAtStage === 'prep' ? 'Prep' : 'Receiving'));
  if (c.openedBy)      subBits.push('by ' + c.openedBy);
  if (c.openedAt)      subBits.push(new Date(c.openedAt).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}));
  els.caseDetailsSub.textContent = subBits.join(' · ');

  // Body content
  const bodyParts = [];
  if (c.ref) {
    bodyParts.push('<div class="ipt-modal-field"><span>Case reference</span>' +
      '<div style="padding:9px 12px;border:1px solid var(--line);border-radius:8px;background:var(--bg);font-size:13px;color:var(--text);font-weight:400;">' +
      esc(c.ref) + '</div></div>');
  }
  if (c.link) {
    const safeLink = esc(c.link);
    bodyParts.push('<div class="ipt-modal-field"><span>Case link</span>' +
      '<div style="padding:9px 12px;border:1px solid var(--line);border-radius:8px;background:var(--bg);font-size:13px;font-weight:400;">' +
      '<a href="' + safeLink + '" target="_blank" rel="noopener" style="color:#0C447C;text-decoration:underline;word-break:break-all;">' + safeLink + '</a>' +
      '</div></div>');
  }
  if (c.note) {
    bodyParts.push('<div class="ipt-modal-field"><span>Note</span>' +
      '<div style="padding:9px 12px;border:1px solid var(--line);border-radius:8px;background:var(--bg);font-size:13px;color:var(--text);font-weight:400;white-space:pre-wrap;">' +
      esc(c.note) + '</div></div>');
  }
  if (!bodyParts.length) {
    bodyParts.push('<p class="ipt-modal-hint">No link, reference, or note was added when this case was opened. The warehouse team can add details from the QA Inbound module.</p>');
  } else {
    bodyParts.push('<p class="ipt-modal-hint">Cases auto-close from the QA Inbound module when replacement units are received and verified.</p>');
  }
  els.caseDetailsBody.innerHTML = bodyParts.join('');
  els.caseDetailsModal.hidden = false;
}
function closeCaseDetailsModal() {
  if (els.caseDetailsModal) els.caseDetailsModal.hidden = true;
}

// ── Priority modal helpers ─────────────────────────────────────────────────
function openPriorityModal(prefillPo, opts) {
  opts = opts || {};
  els.priorityModalError.hidden = true;
  els.priorityModalError.textContent = '';
  els.priorityPoInput.value   = prefillPo || '';
  els.priorityNoteInput.value = '';
  // Identity now comes from the parent app. applyIdentityToModals will fill
  // the hidden by-input and the "Posting as" hint.
  applyIdentityToModals();
  // If this PO is already priority, show its current note + reveal the remove button
  if (prefillPo) {
    const info = priorityInfo(prefillPo);
    if (info) {
      els.priorityNoteInput.value   = info.note   || '';
      els.priorityModalSub.textContent = 'This PO is already flagged. Update the note or remove the flag.';
      els.priorityUnmarkBtn.hidden = false;
      els.priorityMarkBtn.textContent = 'Update priority';
    } else {
      els.priorityModalSub.textContent = 'Priority POs are flagged for everyone and pinned to the top of the board.';
      els.priorityUnmarkBtn.hidden = true;
      els.priorityMarkBtn.textContent = 'Mark as priority';
    }
    els.priorityPoInput.readOnly = !!opts.lockPo;
  } else {
    els.priorityModalSub.textContent = 'Priority POs are flagged for everyone and pinned to the top of the board.';
    els.priorityUnmarkBtn.hidden = true;
    els.priorityMarkBtn.textContent = 'Mark as priority';
    els.priorityPoInput.readOnly = false;
  }
  els.priorityModal.hidden = false;
  setTimeout(() => { try { els.priorityPoInput.focus(); } catch(_){} }, 30);
}

function closePriorityModal() {
  els.priorityModal.hidden = true;
}

async function submitPriorityMark() {
  const poNum = els.priorityPoInput.value.trim();
  const note  = els.priorityNoteInput.value.trim();
  // Identity from parent — fall back to hidden field for older sessions
  const setBy = (ftUserName || (els.priorityByInput && els.priorityByInput.value) || '').trim();
  if (!poNum) {
    els.priorityModalError.textContent = 'PO number is required.';
    els.priorityModalError.hidden = false;
    return;
  }
  els.priorityMarkBtn.disabled = true;
  try {
    await setPriorityRemote(poNum, note, setBy);
    closePriorityModal();
    await loadBoard();
  } catch (err) {
    els.priorityModalError.textContent = err.message || 'Could not save priority.';
    els.priorityModalError.hidden = false;
  } finally {
    els.priorityMarkBtn.disabled = false;
  }
}

async function submitPriorityUnmark() {
  const poNum = els.priorityPoInput.value.trim();
  if (!poNum) { closePriorityModal(); return; }
  if (!confirm('Remove priority flag from PO# ' + poNum + '? Everyone will see it as no longer priority.')) return;
  els.priorityUnmarkBtn.disabled = true;
  try {
    await clearPriorityRemote(poNum);
    closePriorityModal();
    await loadBoard();
  } catch (err) {
    els.priorityModalError.textContent = err.message || 'Could not remove priority.';
    els.priorityModalError.hidden = false;
  } finally {
    els.priorityUnmarkBtn.disabled = false;
  }
}

// ── Board click delegation (watch + priority + comment buttons) ────────────
function handleBoardClick(e) {
  const watchBtn = e.target.closest('[data-watch]');
  if (watchBtn) {
    const po = watchBtn.getAttribute('data-watch');
    toggleWatch(po);
    // Update row in place + re-render
    state.rows.forEach(r => { if (poKey(r.poNum) === poKey(po)) r.watched = isWatched(po); });
    applyFilters();
    return;
  }
  const priBtn = e.target.closest('[data-priority]');
  if (priBtn) {
    const po = priBtn.getAttribute('data-priority');
    openPriorityModal(po, { lockPo: true });
    return;
  }
  const cmtBtn = e.target.closest('[data-comment]');
  if (cmtBtn) {
    const po = cmtBtn.getAttribute('data-comment');
    // Build a small context line from the row state
    const row = state.rows.find(r => poKey(r.poNum) === poKey(po));
    const bits = [];
    if (row) {
      bits.push(stageLabel(row.stage));
      if (row.category)    bits.push(row.category);
      if (row.palletLabel) bits.push(row.palletLabel);
      if (row.priority)    bits.push('★ Priority');
    }
    cmOpenModal(po, bits.join(' · '));
    return;
  }
  // Case details — internal-only link inside the card
  const caseBtn = e.target.closest('.ipt-case-details-btn');
  if (caseBtn) {
    const po = caseBtn.getAttribute('data-case-po');
    openCaseDetailsModal(po);
    return;
  }
  // The journey marker (📁 diamond) also opens details for internal viewers
  const caseMarker = e.target.closest('.ipt-case-marker');
  if (caseMarker && ftUserRole && ftUserRole !== 'external') {
    const po = caseMarker.getAttribute('data-case-po');
    if (po) openCaseDetailsModal(po);
    return;
  }
}

// ── Wire up ────────────────────────────────────────────────────────────────
function init() {
  // Load watchlist from localStorage
  state.watchlist = loadWatchlist();

  els.refreshBtn.addEventListener('click', loadBoard);
  els.searchInput.addEventListener('input', applyFilters);
  els.groupBySelect.addEventListener('change', applyFilters);
  els.stageFilter.addEventListener('change', applyFilters);
  els.categoryFilter.addEventListener('change', applyFilters);
  els.dayFilter.addEventListener('change', applyFilters);
  els.onlyIssues.addEventListener('change', applyFilters);
  if (els.onlyWatchlist) els.onlyWatchlist.addEventListener('change', applyFilters);
  if (els.onlyPriority)  els.onlyPriority.addEventListener('change', applyFilters);
  if (els.onlyCases)     els.onlyCases.addEventListener('change', applyFilters);

  // Board card buttons (watch + priority)
  els.boardContent.addEventListener('click', handleBoardClick);

  // Priority modal
  if (els.markPriorityBtn) {
    els.markPriorityBtn.addEventListener('click', () => openPriorityModal('', { lockPo:false }));
  }
  if (els.priorityModalClose) els.priorityModalClose.addEventListener('click', closePriorityModal);
  if (els.priorityModal) {
    els.priorityModal.addEventListener('click', (e) => {
      if (e.target === els.priorityModal) closePriorityModal();
    });
  }
  if (els.priorityMarkBtn)   els.priorityMarkBtn.addEventListener('click', submitPriorityMark);
  if (els.priorityUnmarkBtn) els.priorityUnmarkBtn.addEventListener('click', submitPriorityUnmark);

  // Comment modal
  if (cmEls.close)  cmEls.close.addEventListener('click', cmCloseModal);
  if (cmEls.submit) cmEls.submit.addEventListener('click', cmSubmit);
  if (cmEls.body && cmEls.charCount) {
    cmEls.body.addEventListener('input', () => {
      cmEls.charCount.textContent = (cmEls.body.value.length || 0) + ' / 2000';
    });
  }
  if (cmEls.overlay) {
    cmEls.overlay.addEventListener('click', (e) => {
      if (e.target === cmEls.overlay) cmCloseModal();
    });
  }

  // Case details modal
  if (els.caseDetailsClose)   els.caseDetailsClose.addEventListener('click', closeCaseDetailsModal);
  if (els.caseDetailsDismiss) els.caseDetailsDismiss.addEventListener('click', closeCaseDetailsModal);
  if (els.caseDetailsModal) {
    els.caseDetailsModal.addEventListener('click', (e) => {
      if (e.target === els.caseDetailsModal) closeCaseDetailsModal();
    });
  }

  // Esc closes any open modal
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (els.priorityModal && !els.priorityModal.hidden) closePriorityModal();
    else if (cmEls.overlay && !cmEls.overlay.hidden) cmCloseModal();
    else if (els.caseDetailsModal && !els.caseDetailsModal.hidden) closeCaseDetailsModal();
  });

  loadBoard();
  setInterval(loadBoard, REFRESH_MS);
  // Re-render every 5 min to advance the age tier signals even when there's no data change
  setInterval(() => { if (state.filtered.length) renderBoard(state.filtered); }, 5 * 60 * 1000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
