/* =============================================================
   PUT-AWAY MODULE  —  putaway.js
   Tracks pallet containers from Prep-complete through
   location assignment in the warehouse.
   ============================================================= */

const PUTAWAY_API = '/.netlify/functions/putaway-sync';

// ── Helpers ──────────────────────────────────────────────────────────────
function pa_esc(v){ return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function pa_id(){ return 'pa'+Math.random().toString(36).slice(2,10)+Date.now().toString(36); }
function pa_fmt(ts){ if(!ts)return'—'; return new Date(ts).toLocaleString([],{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}); }
function pa_fmtDate(s){ if(!s)return'—'; return new Date(s+'T00:00:00').toLocaleDateString([],{weekday:'short',month:'short',day:'numeric'}); }

// Validate location code: QA-QZ + 1-10 + A-E + 1-2  e.g. QE5-C1
function pa_validLoc(code){
  if(!code) return false;
  const m = String(code).toUpperCase().match(/^Q([A-Z])(\d{1,2})-([A-E])([12])$/);
  if(!m) return false;
  const bay = parseInt(m[2]);
  return bay >= 1 && bay <= 10;
}
function pa_normLoc(code){ return String(code||'').toUpperCase().trim(); }

// Status labels
const PA_STATUS = {
  staging:     { label:'Staging',     cls:'pa-status-staging'     },
  in_progress: { label:'In Progress', cls:'pa-status-progress'    },
  complete:    { label:'Complete',    cls:'pa-status-complete'    },
};
const PA_LINE_STATUS = {
  unassigned: { label:'Unassigned', cls:'pa-line-unassigned' },
  partial:    { label:'Partial',    cls:'pa-line-partial'    },
  complete:   { label:'Complete',   cls:'pa-line-complete'   },
};
const PA_DEST = { lts:'Long-Term Storage', sts:'Short-Term Storage' };
const PA_PULL_REASONS = [
  'Fulfilling order','Cycle count','QA check','Damaged — dispose',
  'Return to vendor','Transfer to another location','Other',
];

// ── State ─────────────────────────────────────────────────────────────────
const paState = {
  containers: [],       // summary list
  activeContainer: null,// full container detail
  activeLines: [],
  activePlacements: [],
  searchResults: null,
  view: 'list',         // 'list' | 'detail' | 'assign' | 'search'
  assigningLine: null,  // po_line object being assigned
  loading: false,
  error: null,
};

// ── DOM refs ──────────────────────────────────────────────────────────────
function paEl(id){ return document.getElementById(id); }
const paRoot = () => paEl('putawayModuleRoot');

// ── API ───────────────────────────────────────────────────────────────────
async function paFetch(url, opts={}){
  const res = await fetch(url, { headers:{ Accept:'application/json', ...opts.headers }, ...opts });
  const data = await res.json();
  if(!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

async function paLoadList(){
  paState.loading = true; paRender();
  try {
    const data = await paFetch(`${PUTAWAY_API}?action=list`);
    paState.containers = data.containers || [];
    paState.error = null;
  } catch(e){ paState.error = e.message; }
  paState.loading = false; paRender();
}

async function paLoadContainer(id){
  paState.loading = true; paRender();
  try {
    const data = await paFetch(`${PUTAWAY_API}?action=container&id=${encodeURIComponent(id)}`);
    paState.activeContainer = data.container;
    paState.activeLines = data.lines || [];
    paState.activePlacements = data.placements || [];
    paState.view = 'detail';
    paState.error = null;
  } catch(e){ paState.error = e.message; }
  paState.loading = false; paRender();
}

async function paSearchPo(po){
  paState.loading = true; paRender();
  try {
    const data = await paFetch(`${PUTAWAY_API}?action=search_po&po=${encodeURIComponent(po)}`);
    paState.searchResults = { query: po, lines: data.lines||[], placements: data.placements||[] };
    paState.view = 'search';
    paState.error = null;
  } catch(e){ paState.error = e.message; }
  paState.loading = false; paRender();
}

async function paAddPlacement(lineId, locationCode, unitsPlaced, boxesPlaced, notes){
  const line = paState.activeLines.find(l=>l.id===lineId);
  if(!line) return;
  const placement = {
    id: pa_id(),
    container_id: paState.activeContainer.id,
    pallet_id: paState.activeContainer.pallet_id,
    po_line_id: lineId,
    po_number: line.po_number,
    location_code: pa_normLoc(locationCode),
    units_placed: Number(unitsPlaced)||0,
    boxes_placed: boxesPlaced ? Number(boxesPlaced) : null,
    placed_by: (typeof plt_user === 'function') ? plt_user() : '—',
    placed_at: new Date().toISOString(),
    notes: notes||'',
  };
  try {
    await paFetch(PUTAWAY_API, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ action:'add_placement', placement }),
    });
    await paLoadContainer(paState.activeContainer.id);
    paState.assigningLine = null;
  } catch(e){ paState.error = e.message; paRender(); }
}

// Called automatically when a pallet advances to 'done' in inbound-pallets.js
async function pa_createContainerFromPallet(pallet){
  if(!pallet) return;
  const containerId = 'pac-' + pallet.id;
  const lines = [];
  (pallet.pos || []).forEach(po => {
    const stsQty = Number(po.stsQty||0);
    const ltsQty = Number(po.ltsQty||0);
    if(stsQty > 0){
      lines.push({
        id: pa_id(),
        po_number: po.po,
        category: po.category||'',
        destination_type: 'sts',
        total_units: stsQty,
        total_boxes: po.boxes ? Math.ceil(Number(po.boxes) * stsQty / Math.max(1,Number(po.prepReceivedQty||po.orderedQty||1))) : null,
        size_breakdown: po.sizeBreakdown || null,
      });
    }
    if(ltsQty > 0){
      lines.push({
        id: pa_id(),
        po_number: po.po,
        category: po.category||'',
        destination_type: 'lts',
        total_units: ltsQty,
        total_boxes: po.boxes ? Math.ceil(Number(po.boxes) * ltsQty / Math.max(1,Number(po.prepReceivedQty||po.orderedQty||1))) : null,
        size_breakdown: po.sizeBreakdown || null,
      });
    }
  });
  if(!lines.length) return; // nothing to put away
  try {
    await paFetch(PUTAWAY_API, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        action: 'create_container',
        container: {
          id: containerId,
          pallet_id: pallet.id,
          pallet_label: pallet.label||pallet.id,
          pallet_date: pallet.date||'',
          notes: '',
        },
        lines,
      }),
    });
  } catch(e){ console.warn('Put-Away container creation failed:', e.message); }
}
window.pa_createContainerFromPallet = pa_createContainerFromPallet;

// ── Rendering ─────────────────────────────────────────────────────────────
function paRender(){
  const root = paRoot();
  if(!root) return;

  if(paState.loading){
    root.innerHTML = `<div class="pa-loading">Loading…</div>`;
    return;
  }

  if(paState.view === 'detail' && paState.activeContainer){
    root.innerHTML = paDetailHtml();
    paBindDetail();
    return;
  }

  if(paState.view === 'assign' && paState.assigningLine){
    root.innerHTML = paAssignHtml();
    paBindAssign();
    return;
  }

  if(paState.view === 'search'){
    root.innerHTML = paSearchHtml();
    paBindSearch();
    return;
  }

  root.innerHTML = paListHtml();
  paBindList();
}

// ── List view ─────────────────────────────────────────────────────────────
function paListHtml(){
  const cs = paState.containers;
  const statusFilter = ['staging','in_progress','complete'];

  const grouped = {};
  statusFilter.forEach(s=>{ grouped[s]=[]; });
  cs.forEach(c=>{ if(grouped[c.status]) grouped[c.status].push(c); });

  const sectionHtml = (status, items) => {
    if(!items.length) return '';
    const st = PA_STATUS[status] || { label: status, cls:'' };
    return `
      <div class="pa-group">
        <div class="pa-group-header">
          <span class="pa-status-pill ${st.cls}">${st.label}</span>
          <span class="pa-group-count">${items.length} pallet${items.length===1?'':'s'}</span>
        </div>
        <div class="pa-cards">
          ${items.map(c => `
            <div class="pa-card" data-cid="${pa_esc(c.id)}">
              <div class="pa-card-title">${pa_esc(c.pallet_label)}</div>
              <div class="pa-card-sub">${pa_fmtDate(c.pallet_date)}</div>
              <div class="pa-card-meta">
                <span>${c.line_count} PO line${c.line_count==1?'':'s'}</span>
                <span>${Number(c.units_placed||0).toLocaleString()} / ${Number(c.total_units||0).toLocaleString()} units placed</span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>`;
  };

  return `
    <div class="pa-toolbar">
      <div class="pa-search-row">
        <input id="paPOSearch" class="pa-search-input" type="text" placeholder="Search by PO number…" />
        <button id="paPOSearchBtn" class="pa-btn pa-btn-secondary">Find PO</button>
      </div>
      <button id="paRefreshBtn" class="pa-btn pa-btn-secondary">↻ Refresh</button>
    </div>
    ${paState.error ? `<div class="pa-error">${pa_esc(paState.error)}</div>` : ''}
    ${!cs.length
      ? `<div class="pa-empty"><p>No put-away containers yet.</p><p class="pa-empty-sub">Containers are created automatically when a pallet completes Prep in the Inbound module.</p></div>`
      : `${sectionHtml('staging', grouped.staging)}
         ${sectionHtml('in_progress', grouped.in_progress)}
         ${sectionHtml('complete', grouped.complete)}`
    }`;
}

function paBindList(){
  paEl('paRefreshBtn')?.addEventListener('click', paLoadList);
  paEl('paPOSearchBtn')?.addEventListener('click', ()=>{
    const q = paEl('paPOSearch')?.value?.trim();
    if(q) paSearchPo(q);
  });
  paEl('paPOSearch')?.addEventListener('keydown', e=>{
    if(e.key==='Enter'){ const q=e.target.value.trim(); if(q) paSearchPo(q); }
  });
  paRoot()?.querySelectorAll('.pa-card[data-cid]').forEach(el=>{
    el.addEventListener('click', ()=> paLoadContainer(el.dataset.cid));
  });
}

// ── Detail view ───────────────────────────────────────────────────────────
function paDetailHtml(){
  const c = paState.activeContainer;
  const lines = paState.activeLines;
  const placements = paState.activePlacements;
  const st = PA_STATUS[c.status] || { label: c.status, cls:'' };

  const linesHtml = lines.map(line => {
    const lst = PA_LINE_STATUS[line.status] || { label:line.status, cls:'' };
    const remaining = Number(line.total_units) - Number(line.units_placed);
    const linePlacements = placements.filter(p=>p.po_line_id===line.id);
    const sizes = line.size_breakdown ? Object.entries(line.size_breakdown).map(([s,q])=>`${s}:${q}`).join(', ') : '';

    return `
      <div class="pa-line ${lst.cls}" data-lid="${pa_esc(line.id)}">
        <div class="pa-line-header">
          <div>
            <span class="pa-line-po">PO# ${pa_esc(line.po_number)}</span>
            <span class="pa-dest-badge pa-dest-${pa_esc(line.destination_type)}">${PA_DEST[line.destination_type]||line.destination_type}</span>
            ${line.category ? `<span class="pa-cat-badge">${pa_esc(line.category)}</span>` : ''}
          </div>
          <span class="pa-line-status-pill ${lst.cls}">${lst.label}</span>
        </div>
        <div class="pa-line-meta">
          <span><strong>${Number(line.total_units).toLocaleString()}</strong> units total</span>
          <span><strong>${Number(line.units_placed).toLocaleString()}</strong> placed</span>
          ${remaining > 0 ? `<span class="pa-remaining"><strong>${remaining.toLocaleString()}</strong> remaining</span>` : ''}
          ${line.total_boxes ? `<span>${line.total_boxes} box${line.total_boxes==1?'':'es'}</span>` : ''}
          ${sizes ? `<span class="pa-sizes">${pa_esc(sizes)}</span>` : ''}
        </div>
        ${linePlacements.length ? `
          <div class="pa-placements-mini">
            ${linePlacements.map(p=>`
              <div class="pa-placement-chip">
                <span class="pa-loc-code">${pa_esc(p.location_code)}</span>
                <span>${Number(p.units_placed).toLocaleString()} units</span>
                ${p.boxes_placed ? `<span>${p.boxes_placed} boxes</span>` : ''}
                <span class="pa-placed-by">${pa_esc(p.placed_by||'—')} · ${pa_fmt(p.placed_at)}</span>
              </div>`).join('')}
          </div>` : ''}
        ${line.status !== 'complete' ? `
          <button class="pa-btn pa-btn-primary pa-assign-btn" data-lid="${pa_esc(line.id)}">
            + Assign to Location
          </button>` : `<span class="pa-complete-check">✓ Fully placed</span>`}
      </div>`;
  }).join('');

  return `
    <div class="pa-back-bar">
      <button class="pa-btn pa-btn-ghost" id="paBackBtn">← All Pallets</button>
      <span class="pa-status-pill ${st.cls}">${st.label}</span>
    </div>
    <div class="pa-detail-header">
      <h2 class="pa-detail-title">${pa_esc(c.pallet_label)}</h2>
      <div class="pa-detail-sub">${pa_fmtDate(c.pallet_date)} · ${lines.length} PO line${lines.length===1?'':'s'}</div>
    </div>
    ${paState.error ? `<div class="pa-error">${pa_esc(paState.error)}</div>` : ''}
    <div class="pa-lines">${linesHtml || '<div class="pa-empty"><p>No PO lines on this container.</p></div>'}</div>`;
}

function paBindDetail(){
  paEl('paBackBtn')?.addEventListener('click', ()=>{
    paState.view='list'; paState.activeContainer=null;
    paState.activeLines=[]; paState.activePlacements=[];
    paRender();
  });
  paRoot()?.querySelectorAll('.pa-assign-btn[data-lid]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const lid = btn.dataset.lid;
      paState.assigningLine = paState.activeLines.find(l=>l.id===lid) || null;
      if(paState.assigningLine){ paState.view='assign'; paRender(); }
    });
  });
}

// ── Assign view ───────────────────────────────────────────────────────────
function paAssignHtml(){
  const line = paState.assigningLine;
  const placed = Number(line.units_placed||0);
  const remaining = Number(line.total_units||0) - placed;

  return `
    <div class="pa-back-bar">
      <button class="pa-btn pa-btn-ghost" id="paAssignBackBtn">← Back to Pallet</button>
    </div>
    <div class="pa-assign-card">
      <div class="pa-assign-header">
        <div class="eyebrow">Assign to Location</div>
        <h3>PO# ${pa_esc(line.po_number)}</h3>
        <div class="pa-assign-sub">
          <span class="pa-dest-badge pa-dest-${pa_esc(line.destination_type)}">${PA_DEST[line.destination_type]||line.destination_type}</span>
          ${line.category ? `<span class="pa-cat-badge">${pa_esc(line.category)}</span>` : ''}
        </div>
      </div>
      <div class="pa-assign-stats">
        <div class="pa-stat"><span>Total</span><strong>${Number(line.total_units).toLocaleString()}</strong></div>
        <div class="pa-stat"><span>Placed so far</span><strong>${placed.toLocaleString()}</strong></div>
        <div class="pa-stat pa-stat-remaining"><span>Remaining</span><strong>${remaining.toLocaleString()}</strong></div>
      </div>

      <div class="pa-assign-form">
        <div class="pa-field">
          <label>Location Code</label>
          <div class="pa-loc-input-wrap">
            <input id="paLocCode" class="pa-loc-input" type="text"
              placeholder="e.g. QE5-C1"
              autocomplete="off" autocapitalize="characters" />
            <span class="pa-loc-hint" id="paLocHint"></span>
          </div>
          <div class="pa-loc-format">Format: Q[A-Z][1-10]-[A-E][1-2]</div>
        </div>
        <div class="pa-field-row">
          <div class="pa-field">
            <label>Units to place</label>
            <input id="paUnitsPlaced" type="number" min="1" max="${remaining}"
              value="${remaining}" class="pa-num-input" />
          </div>
          <div class="pa-field">
            <label>Boxes (optional)</label>
            <input id="paBoxesPlaced" type="number" min="0" class="pa-num-input"
              placeholder="—" />
          </div>
        </div>
        <div class="pa-field">
          <label>Notes (optional)</label>
          <input id="paPlacementNotes" type="text" class="pa-text-input"
            placeholder="Any notes about this placement…" />
        </div>
        <div id="paAssignError" class="pa-error" hidden></div>
        <button id="paConfirmAssign" class="pa-btn pa-btn-primary pa-btn-lg">Confirm Placement</button>
      </div>
    </div>`;
}

function paBindAssign(){
  paEl('paAssignBackBtn')?.addEventListener('click', ()=>{
    paState.view='detail'; paState.assigningLine=null; paRender();
  });

  const locInput = paEl('paLocCode');
  const hint = paEl('paLocHint');
  locInput?.addEventListener('input', ()=>{
    const v = locInput.value.trim();
    if(!v){ hint.textContent=''; hint.className='pa-loc-hint'; return; }
    if(pa_validLoc(v)){
      hint.textContent='✓ Valid';
      hint.className='pa-loc-hint pa-loc-valid';
    } else {
      hint.textContent='Invalid format';
      hint.className='pa-loc-hint pa-loc-invalid';
    }
  });

  paEl('paConfirmAssign')?.addEventListener('click', async ()=>{
    const locCode = paEl('paLocCode')?.value?.trim();
    const units = parseInt(paEl('paUnitsPlaced')?.value||'0');
    const boxes = paEl('paBoxesPlaced')?.value?.trim();
    const notes = paEl('paPlacementNotes')?.value?.trim()||'';
    const errEl = paEl('paAssignError');
    errEl.hidden = true;

    if(!pa_validLoc(locCode)){
      errEl.textContent = 'Enter a valid location code (e.g. QE5-C1).';
      errEl.hidden = false; return;
    }
    if(!units || units < 1){
      errEl.textContent = 'Units to place must be at least 1.';
      errEl.hidden = false; return;
    }
    const remaining = Number(paState.assigningLine.total_units) - Number(paState.assigningLine.units_placed);
    if(units > remaining){
      errEl.textContent = `Cannot place more than the ${remaining} remaining units.`;
      errEl.hidden = false; return;
    }

    paEl('paConfirmAssign').disabled = true;
    paEl('paConfirmAssign').textContent = 'Saving…';
    await paAddPlacement(
      paState.assigningLine.id,
      locCode, units,
      boxes ? parseInt(boxes) : null,
      notes
    );
  });
}

// ── Search view ───────────────────────────────────────────────────────────
function paSearchHtml(){
  const sr = paState.searchResults;
  if(!sr) return `<div class="pa-empty"><p>No results.</p></div>`;

  const placementsByLine = {};
  (sr.placements||[]).forEach(p=>{
    if(!placementsByLine[p.po_line_id]) placementsByLine[p.po_line_id]=[];
    placementsByLine[p.po_line_id].push(p);
  });

  return `
    <div class="pa-back-bar">
      <button class="pa-btn pa-btn-ghost" id="paSearchBackBtn">← Back</button>
      <span class="pa-search-query">Results for: <strong>${pa_esc(sr.query)}</strong></span>
    </div>
    ${!sr.lines.length
      ? `<div class="pa-empty"><p>No PO lines found for "${pa_esc(sr.query)}".</p></div>`
      : sr.lines.map(line => {
          const lst = PA_LINE_STATUS[line.status] || { label:line.status, cls:'' };
          const linePlacements = placementsByLine[line.id] || [];
          return `
            <div class="pa-search-result">
              <div class="pa-line-header">
                <div>
                  <span class="pa-line-po">PO# ${pa_esc(line.po_number)}</span>
                  <span class="pa-dest-badge pa-dest-${pa_esc(line.destination_type)}">${PA_DEST[line.destination_type]||line.destination_type}</span>
                </div>
                <span class="pa-line-status-pill ${lst.cls}">${lst.label}</span>
              </div>
              <div class="pa-line-meta">
                <span>Pallet: <strong>${pa_esc(line.pallet_label)}</strong></span>
                <span>${pa_fmtDate(line.pallet_date)}</span>
                <span>${Number(line.units_placed||0).toLocaleString()} / ${Number(line.total_units||0).toLocaleString()} units placed</span>
              </div>
              ${linePlacements.length ? `
                <div class="pa-placements-mini">
                  ${linePlacements.map(p=>`
                    <div class="pa-placement-chip">
                      <span class="pa-loc-code">${pa_esc(p.location_code)}</span>
                      <span>${Number(p.units_placed).toLocaleString()} units</span>
                      <span class="pa-placed-by">${pa_esc(p.placed_by||'—')} · ${pa_fmt(p.placed_at)}</span>
                    </div>`).join('')}
                </div>` : `<div class="pa-empty-placements">Not yet placed in any location.</div>`}
              <button class="pa-btn pa-btn-secondary pa-goto-btn" data-cid="${pa_esc(line.container_id)}">
                Open Pallet →
              </button>
            </div>`;
        }).join('')
    }`;
}

function paBindSearch(){
  paEl('paSearchBackBtn')?.addEventListener('click', ()=>{
    paState.view='list'; paState.searchResults=null; paRender();
  });
  paRoot()?.querySelectorAll('.pa-goto-btn[data-cid]').forEach(btn=>{
    btn.addEventListener('click', ()=> paLoadContainer(btn.dataset.cid));
  });
}

// ── Init ──────────────────────────────────────────────────────────────────
function paInit(){
  const root = paRoot();
  if(!root) return;
  paLoadList();
}

// Boot when the page becomes active
document.addEventListener('DOMContentLoaded', ()=>{
  // Delay slightly to let navigation settle
  setTimeout(paInit, 200);
});

// Re-init if the page is navigated to
const paNavObserver = new MutationObserver(()=>{
  const page = document.getElementById('putawayPage');
  if(page && page.classList.contains('active') && !paState.containers.length && !paState.loading){
    paLoadList();
  }
});
const putawayPage = document.getElementById('putawayPage');
if(putawayPage) paNavObserver.observe(putawayPage, { attributes:true, attributeFilter:['class'] });
