
const assemblyApiBase='/.netlify/functions/assembly';
const commentsApiBase='/.netlify/functions/flight-tracker-comments';
const REFRESH_MS = 60000;

// ── Comment modal state ────────────────────────────────────────────────────
const cmState = {
  pbId: '',
  pbName: '',
  so: '',
  account: '',
};

const state = {
  scheduled: [],
  board: [],
  filtered: [],
  updatedAt: null,
};

const STORAGE_KEYS = {
  board: 'ops_hub_assembly_board_v2',
  scheduled: 'ops_hub_scheduled_queue_v1',
  revenue: 'ops_hub_revenue_reference_v1',
};

function loadJsonLocal(key, fallback){
  try{
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  }catch{
    return fallback;
  }
}

function readLocalAssemblyState(){
  return {
    board: Array.isArray(loadJsonLocal(STORAGE_KEYS.board, [])) ? loadJsonLocal(STORAGE_KEYS.board, []) : [],
    scheduled: Array.isArray(loadJsonLocal(STORAGE_KEYS.scheduled, [])) ? loadJsonLocal(STORAGE_KEYS.scheduled, []) : [],
    revenue: Array.isArray(loadJsonLocal(STORAGE_KEYS.revenue, [])) ? loadJsonLocal(STORAGE_KEYS.revenue, []) : [],
  };
}

async function getAssemblyState(){
  try{
    const response = await fetch(assemblyApiBase, { headers: { Accept:'application/json' }});
    const raw = await response.text();
    let data = {};
    try{ data = raw ? JSON.parse(raw) : {}; }catch{ data = {}; }
    if(!response.ok) throw new Error(data?.error || `Board load failed (${response.status})`);
    return { state: data.state || {}, updated_at: data.updated_at || null, source: 'backend' };
  }catch(err){
    const localState = readLocalAssemblyState();
    const hasAnyLocalData = (localState.board?.length || localState.scheduled?.length || localState.revenue?.length);
    if(hasAnyLocalData){
      console.warn('Assembly board backend unavailable; using local browser copy.', err);
      return { state: localState, updated_at: new Date().toISOString(), source: 'local' };
    }
    throw err;
  }
}

const els = {
  lastUpdated: document.getElementById('lastUpdated'),
  refreshBtn: document.getElementById('refreshBtn'),
  searchInput: document.getElementById('searchInput'),
  dayFilter: document.getElementById('dayFilter'),
  accountFilter: document.getElementById('accountFilter'),
  statusFilter: document.getElementById('statusFilter'),
  boardContent: document.getElementById('boardContent'),
  statScheduledPbs: document.getElementById('statScheduledPbs'),
  statUnits: document.getElementById('statUnits'),
  statCompleted: document.getElementById('statCompleted'),
  statAtRisk: document.getElementById('statAtRisk'),
  statRevenue: document.getElementById('statRevenue'),
};

function escapeHtml(v){return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;')}
function formatNumber(value){return Number(value || 0).toLocaleString('en-US')}
function formatCurrencyWhole(value){return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(Number(value||0))}
function formatDateLabel(dateStr){
  if(!dateStr) return 'Unscheduled';
  const d=new Date(dateStr+'T00:00:00');
  if(Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'});
}
function formatLastUpdated(value){
  if(!value) return '—';
  const d=new Date(value);
  if(Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
}
function normalizeSalesOrderKey(value){return String(value||'').trim().toLowerCase();}
function buildRevenueLookup(rows){
  const map=new Map();
  (rows||[]).forEach(row=>{
    const key=normalizeSalesOrderKey(row.salesOrder || row.so);
    if(!key) return;
    if(!map.has(key)){map.set(key,row);return;}
    const existing=map.get(key);
    if(Number(row.originalSubtotal||0) > Number(existing.originalSubtotal||0)) existing.originalSubtotal=row.originalSubtotal;
    if(!existing.account && row.account) existing.account=row.account;
    if(!existing.ihd && row.ihd) existing.ihd=row.ihd;
  });
  return map;
}
function classifyStage(stage){
  const value=String(stage||'').trim().toLowerCase();
  if(value==='done') return 'stage-done';
  if(['aa','awaiting assembly','print','picked'].includes(value)) return 'stage-risk';
  return '';
}
function getStageLabel(value){
  const map = {
    aa:'Awaiting Assembly',
    print:'In Print',
    picked:'Picked',
    line:'On Line',
    dpmo:'QA Check',
    done:'Complete',
  };
  return map[String(value||'').trim().toLowerCase()] || (value || '—');
}
function getStatusLabel(value){
  const raw=String(value||'').trim();
  if(!raw) return '—';
  const map = {
    'qa approved':'QA Approved',
    'pick ready':'Pick Ready',
    'assembly ready':'Assembly Ready',
    'assembly in process':'Assembly In Process',
    'pending items':'Pending Items',
    'partially complete':'Partially Complete',
  };
  return map[raw.toLowerCase()] || raw;
}
function getUnits(row){
  if(Number(row.units||0) > 0) return Number(row.units||0);
  return Number(row.qty||0) * Number(row.products||0);
}
function getBoardMatch(scheduledRow){
  const date = String(scheduledRow.scheduledFor || '').trim();
  return (state.board || []).find(item => {
    const sameId = item.pbId && scheduledRow.pbId && item.pbId === scheduledRow.pbId;
    const sameFallback = (!item.pbId || !scheduledRow.pbId) &&
      String(item.pb||'').trim() === String(scheduledRow.pb||'').trim() &&
      String(item.so||'').trim() === String(scheduledRow.so||'').trim() &&
      String(item.date||'').trim() === date;
    return sameId || sameFallback;
  }) || null;
}
function hydrateRow(row, revenueLookup){
  const boardMatch = getBoardMatch(row) || {};
  const revenueMatch = revenueLookup.get(normalizeSalesOrderKey(row.so)) || {};
  return {
    ...row,
    stage: boardMatch.stage || row.stage || '',
    status: boardMatch.status || row.status || row.sourceStatus || '',
    ihd: row.ihd || boardMatch.ihd || revenueMatch.ihd || '',
    revenue: Number(boardMatch.subtotal || revenueMatch.originalSubtotal || row.subtotal || 0),
    rowLink: String(boardMatch.externalLink || '').trim() || (row.pdfUrl && row.pdfUrl !== '-' ? row.pdfUrl : ''),
  };
}
function getAtRiskCount(rows){
  const today = new Date();
  today.setHours(0,0,0,0);
  return rows.filter(row=>{
    const ihd = String(row.ihd||'').trim();
    if(!ihd) return false;
    const d=new Date(ihd+'T00:00:00');
    if(Number.isNaN(d.getTime())) return false;
    const diff=Math.round((d-today)/86400000);
    return diff <= 2 && getStageLabel(row.stage) !== 'Complete';
  }).length;
}
function updateFilters(rows){
  const unique = (items) => Array.from(new Set(items.filter(Boolean))).sort((a,b)=>String(a).localeCompare(String(b)));
  const currentDay = els.dayFilter.value;
  const currentAccount = els.accountFilter.value;
  const currentStatus = els.statusFilter.value;
  const days = unique(rows.map(r=>r.scheduledFor));
  const accounts = unique(rows.map(r=>r.account));
  const statuses = unique(rows.map(r=>getStatusLabel(r.status)));

  els.dayFilter.innerHTML = '<option value="">All scheduled days</option>' + days.map(v=>`<option value="${escapeHtml(v)}">${escapeHtml(formatDateLabel(v))}</option>`).join('');
  els.accountFilter.innerHTML = '<option value="">All accounts</option>' + accounts.map(v=>`<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
  els.statusFilter.innerHTML = '<option value="">All statuses</option>' + statuses.map(v=>`<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');

  els.dayFilter.value = days.includes(currentDay) ? currentDay : '';
  els.accountFilter.value = accounts.includes(currentAccount) ? currentAccount : '';
  els.statusFilter.value = statuses.includes(currentStatus) ? currentStatus : '';
}
function applyFilters(){
  const q = els.searchInput.value.trim().toLowerCase();
  const day = els.dayFilter.value;
  const account = els.accountFilter.value;
  const status = els.statusFilter.value;

  state.filtered = state.scheduled.filter(row=>{
    const statusLabel = getStatusLabel(row.status);
    const matchesSearch = !q || [
      row.pb,row.so,row.account,row.accountOwner,row.scheduleNote,row.rescheduleNote,statusLabel,getStageLabel(row.stage)
    ].some(v => String(v||'').toLowerCase().includes(q));
    const matchesDay = !day || row.scheduledFor === day;
    const matchesAccount = !account || row.account === account;
    const matchesStatus = !status || statusLabel === status;
    return matchesSearch && matchesDay && matchesAccount && matchesStatus;
  });

  renderStats(state.filtered);
  renderBoard(state.filtered);
}
function renderStats(rows){
  els.statScheduledPbs.textContent = formatNumber(rows.length);
  els.statUnits.textContent = formatNumber(rows.reduce((sum,row)=>sum+getUnits(row),0));
  els.statCompleted.textContent = formatNumber(rows.filter(row=>getStageLabel(row.stage)==='Complete').length);
  els.statAtRisk.textContent = formatNumber(getAtRiskCount(rows));
  const totalRevenue = rows.reduce((sum,row)=>sum+Number(row.revenue||0),0);
  els.statRevenue.textContent = formatCurrencyWhole(totalRevenue);
}
function renderBoard(rows){
  if(!rows.length){
    els.boardContent.innerHTML = `
      <section class="empty-state">
        <h2>No scheduled pack builders match this view</h2>
        <p>Try clearing a filter or refreshing the board.</p>
      </section>
    `;
    return;
  }

  const groups = new Map();
  rows.forEach(row=>{
    const key = row.scheduledFor || 'unscheduled';
    if(!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });

  const sortedKeys = Array.from(groups.keys()).sort((a,b)=>a.localeCompare(b));
  els.boardContent.innerHTML = sortedKeys.map(dateKey=>{
    const dayRows = groups.get(dateKey).slice().sort((a,b)=>String(a.account||'').localeCompare(String(b.account||'')) || String(a.pb||'').localeCompare(String(b.pb||'')));
    const dayUnits = dayRows.reduce((sum,row)=>sum+getUnits(row),0);
    const dayRevenue = dayRows.reduce((sum,row)=>sum+Number(row.revenue||0),0);
    return `
      <section class="day-card">
        <div class="day-header">
          <div>
            <h2 class="day-title">${escapeHtml(formatDateLabel(dateKey))}</h2>
          </div>
          <div class="day-summary">
            <span class="summary-chip">${formatNumber(dayRows.length)} PBs</span>
            <span class="summary-chip">${formatNumber(dayUnits)} units</span>
            <span class="summary-chip">${formatCurrencyWhole(dayRevenue)} revenue</span>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Pack Builder</th>
                <th>Sales Order</th>
                <th>Account</th>
                <th>Account Owner</th>
                <th>Units</th>
                <th>Stage</th>
                <th>Status</th>
                <th>IHD</th>
                <th>Revenue</th>
                <th>Reschedule Note</th>
                <th>Comments</th>
              </tr>
            </thead>
            <tbody>
              ${dayRows.map(row=>{
                const pbContent = row.rowLink
                  ? `<a class="row-link" href="${escapeHtml(row.rowLink)}" target="_blank" rel="noreferrer">${escapeHtml(row.pb||'—')}</a>`
                  : escapeHtml(row.pb||'—');
                const stageLabel = getStageLabel(row.stage);
                return `
                  <tr>
                    <td>${pbContent}</td>
                    <td>${escapeHtml(row.so||'—')}</td>
                    <td>${escapeHtml(row.account||'—')}</td>
                    <td>${escapeHtml(row.accountOwner||'—')}</td>
                    <td>${formatNumber(getUnits(row))}</td>
                    <td><span class="stage-badge ${classifyStage(row.stage)}">${escapeHtml(stageLabel)}</span></td>
                    <td><span class="status-badge">${escapeHtml(getStatusLabel(row.status))}</span></td>
                    <td>${escapeHtml(row.ihd||'—')}</td>
                    <td>${formatCurrencyWhole(row.revenue||0)}</td>
                    <td class="note-cell">${escapeHtml(row.scheduleNote || row.rescheduleNote || '—')}</td>
                    <td class="comment-cell">
                      <button
                        class="comment-btn"
                        type="button"
                        data-pbid="${escapeHtml(row.pbId||'')}"
                        data-pbname="${escapeHtml(row.pb||'')}"
                        data-so="${escapeHtml(row.so||'')}"
                        data-account="${escapeHtml(row.account||'')}">
                        💬 Comment
                      </button>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }).join('');
}
async function loadBoard(){
  els.refreshBtn.disabled = true;
  els.refreshBtn.textContent = 'Refreshing…';
  try{
    const payload = await getAssemblyState();
    const stateJson = payload.state || {};
    const revenueLookup = buildRevenueLookup(stateJson.revenue || []);
    state.board = Array.isArray(stateJson.board) ? stateJson.board : [];
    const scheduledRows = Array.isArray(stateJson.scheduled) ? stateJson.scheduled : [];
    state.scheduled = scheduledRows.map(row=>hydrateRow(row, revenueLookup));
    state.updatedAt = payload.updated_at || null;
    els.lastUpdated.textContent = formatLastUpdated(state.updatedAt) + (payload.source === 'local' ? ' · local copy' : '');
    updateFilters(state.scheduled);
    applyFilters();
  }catch(err){
    console.error(err);
    els.boardContent.innerHTML = `
      <section class="empty-state">
        <h2>Unable to load the live board</h2>
        <p>${escapeHtml(err.message || 'Unknown board error')}</p>
      </section>
    `;
  }finally{
    els.refreshBtn.disabled = false;
    els.refreshBtn.textContent = 'Refresh now';
  }
}

// ── Comment modal ──────────────────────────────────────────────────────────
const cmEls = {
  overlay:    document.getElementById('commentModal'),
  title:      document.getElementById('cmTitle'),
  eyebrow:    document.getElementById('cmEyebrow'),
  subtitle:   document.getElementById('cmSubtitle'),
  thread:     document.getElementById('cmThread'),
  close:      document.getElementById('cmClose'),
  author:     document.getElementById('cmAuthor'),
  category:   document.getElementById('cmCategory'),
  body:       document.getElementById('cmBody'),
  charCount:  document.getElementById('cmCharCount'),
  submit:     document.getElementById('cmSubmit'),
  error:      document.getElementById('cmError'),
};

const CATEGORY_LABELS = {
  priority:     '🔴 Priority Request',
  instructions: '📋 Special Instructions',
  general:      '💬 General Note',
};

function cmFormatTime(iso){
  const d = new Date(iso);
  if(Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
}

function cmRenderThread(comments){
  if(!comments.length){
    cmEls.thread.innerHTML = `<p class="cm-empty">No comments yet. Be the first to leave a note for the assembly team.</p>`;
    return;
  }
  cmEls.thread.innerHTML = comments.map(c=>`
    <div class="cm-comment cm-cat-${escapeHtml(c.category)}">
      <div class="cm-comment-meta">
        <span class="cm-cat-badge">${escapeHtml(CATEGORY_LABELS[c.category]||c.category)}</span>
        <span class="cm-comment-author">${escapeHtml(c.author_name||'Stakeholder')}</span>
        <span class="cm-comment-time">${escapeHtml(cmFormatTime(c.created_at))}</span>
      </div>
      <p class="cm-comment-body">${escapeHtml(c.body)}</p>
    </div>
  `).join('');
  cmEls.thread.scrollTop = cmEls.thread.scrollHeight;
}

async function cmLoadComments(){
  cmEls.thread.innerHTML = `<p class="cm-loading">Loading comments…</p>`;
  try{
    const key = cmState.pbId ? `pb_id=${encodeURIComponent(cmState.pbId)}` : `so=${encodeURIComponent(cmState.so)}`;
    const res = await fetch(`${commentsApiBase}?${key}`,{headers:{Accept:'application/json'}});
    const data = await res.json();
    if(!res.ok) throw new Error(data.error||`Load failed (${res.status})`);
    cmRenderThread(data.comments||[]);
  }catch(err){
    cmEls.thread.innerHTML = `<p class="cm-empty cm-err-text">Could not load comments: ${escapeHtml(err.message)}</p>`;
  }
}

function cmOpenModal(pbId, pbName, so, account){
  cmState.pbId    = pbId;
  cmState.pbName  = pbName;
  cmState.so      = so;
  cmState.account = account;
  cmEls.title.textContent   = pbName || so || 'Order';
  cmEls.subtitle.textContent = [so ? `SO: ${so}` : '', account ? `Account: ${account}` : ''].filter(Boolean).join(' · ');
  cmEls.error.hidden  = true;
  cmEls.overlay.hidden = false;
  document.body.style.overflow = 'hidden';
  cmLoadComments();
}

function cmCloseModal(){
  cmEls.overlay.hidden = true;
  document.body.style.overflow = '';
}

async function cmSubmitComment(){
  const body = cmEls.body.value.trim();
  const author = cmEls.author.value.trim() || 'Stakeholder';
  const category = cmEls.category.value;
  cmEls.error.hidden = true;
  if(!body){ cmEls.error.textContent='Please write a message before sending.'; cmEls.error.hidden=false; return; }
  cmEls.submit.disabled = true;
  cmEls.submit.textContent = 'Sending…';
  try{
    const res = await fetch(commentsApiBase,{
      method:'POST',
      headers:{'Content-Type':'application/json',Accept:'application/json'},
      body: JSON.stringify({
        pb_id:      cmState.pbId,
        pb_name:    cmState.pbName,
        so:         cmState.so,
        account:    cmState.account,
        author_name: author,
        category,
        body,
      }),
    });
    const data = await res.json();
    if(!res.ok) throw new Error(data.error||`Submit failed (${res.status})`);
    cmEls.body.value = '';
    cmEls.charCount.textContent = '0 / 2000';
    await cmLoadComments();
  }catch(err){
    cmEls.error.textContent = err.message||'Failed to send comment.';
    cmEls.error.hidden = false;
  }finally{
    cmEls.submit.disabled = false;
    cmEls.submit.textContent = 'Send';
  }
}

// Wire modal events
cmEls.close.addEventListener('click', cmCloseModal);
cmEls.overlay.addEventListener('click', e=>{ if(e.target===cmEls.overlay) cmCloseModal(); });
document.addEventListener('keydown', e=>{ if(e.key==='Escape' && !cmEls.overlay.hidden) cmCloseModal(); });
cmEls.submit.addEventListener('click', cmSubmitComment);
cmEls.body.addEventListener('input', ()=>{
  cmEls.charCount.textContent = `${cmEls.body.value.length} / 2000`;
});

// Delegate comment button clicks from the board (rows re-render on load)
document.getElementById('boardContent').addEventListener('click', e=>{
  const btn = e.target.closest('.comment-btn');
  if(!btn) return;
  cmOpenModal(
    btn.dataset.pbid||'',
    btn.dataset.pbname||'',
    btn.dataset.so||'',
    btn.dataset.account||''
  );
});

['input','change'].forEach(evt=>{
  els.searchInput.addEventListener(evt, applyFilters);
  els.dayFilter.addEventListener(evt, applyFilters);
  els.accountFilter.addEventListener(evt, applyFilters);
  els.statusFilter.addEventListener(evt, applyFilters);
});
els.refreshBtn.addEventListener('click', loadBoard);

loadBoard();
setInterval(loadBoard, REFRESH_MS);

// ── Phase 2: Mobile card view for Flight Tracker ──────────────────────────
function renderBoardCards(rows) {
  const container = document.getElementById('boardContentCards');
  if (!container) return;
  if (!rows.length) {
    container.innerHTML = '<section class="empty-state"><h2>No scheduled pack builders match this view</h2><p>Try clearing a filter or refreshing.</p></section>';
    return;
  }
  const groups = new Map();
  rows.forEach(row => {
    const key = row.scheduledFor || 'unscheduled';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });
  const sortedKeys = Array.from(groups.keys()).sort((a,b) => a.localeCompare(b));
  container.innerHTML = sortedKeys.map(dateKey => {
    const dayRows = groups.get(dateKey).slice().sort((a,b) =>
      String(a.account||'').localeCompare(String(b.account||'')) ||
      String(a.pb||'').localeCompare(String(b.pb||''))
    );
    const dayRevenue = dayRows.reduce((s,r) => s + Number(r.revenue||0), 0);
    const dayUnits   = dayRows.reduce((s,r) => s + getUnits(r), 0);
    return `<section class="mob-day-group">
      <div class="mob-day-header">
        <h3 class="mob-day-title">${escapeHtml(formatDateLabel(dateKey))}</h3>
        <div class="mob-day-chips">
          <span class="summary-chip">${formatNumber(dayRows.length)} PBs</span>
          <span class="summary-chip">${formatNumber(dayUnits)} units</span>
          <span class="summary-chip">${formatCurrencyWhole(dayRevenue)}</span>
        </div>
      </div>
      ${dayRows.map(row => {
        const stageLabel = getStageLabel(row.stage);
        const stageCls   = row.stage==='done' ? 'stage-done' : classifyStage(row.stage)==='' ? 'stage-mid' : classifyStage(row.stage);
        const pbContent  = row.rowLink
          ? `<a class="row-link" href="${escapeHtml(row.rowLink)}" target="_blank" rel="noreferrer">${escapeHtml(row.pb||'—')}</a>`
          : escapeHtml(row.pb||'—');
        const ihdStr = row.ihd || '—';
        return `<div class="mob-card mob-ft-card">
          <div class="mob-card-header">
            <div class="mob-card-title">
              <span class="mob-card-pb">${pbContent}</span>
              <span class="mob-card-account">${escapeHtml(row.account||'—')}</span>
            </div>
            <span class="mob-stage-badge ${stageCls}">${escapeHtml(stageLabel)}</span>
          </div>
          <div class="mob-card-meta">
            <div class="mob-meta-item"><span class="mob-meta-label">SO</span><strong>${escapeHtml(row.so||'—')}</strong></div>
            <div class="mob-meta-item"><span class="mob-meta-label">Units</span><strong>${formatNumber(getUnits(row))}</strong></div>
            <div class="mob-meta-item"><span class="mob-meta-label">Revenue</span><strong>${formatCurrencyWhole(row.revenue||0)}</strong></div>
            <div class="mob-meta-item"><span class="mob-meta-label">IHD</span><strong>${escapeHtml(ihdStr)}</strong></div>
          </div>
          <div class="mob-card-actions">
            <span class="status-badge" style="font-size:11px">${escapeHtml(getStatusLabel(row.status))}</span>
            <button class="comment-btn" type="button"
              data-pbid="${escapeHtml(row.pbId||'')}"
              data-pbname="${escapeHtml(row.pb||'')}"
              data-so="${escapeHtml(row.so||'')}"
              data-account="${escapeHtml(row.account||'')}">💬 Comment</button>
          </div>
        </div>`;
      }).join('')}
    </section>`;
  }).join('');
}

// Hook renderBoard to also call renderBoardCards
const _origRenderBoard = renderBoard;
renderBoard = function(rows) {
  _origRenderBoard(rows);
  renderBoardCards(rows);
};
