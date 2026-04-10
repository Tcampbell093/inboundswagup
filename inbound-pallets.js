/* =============================================================
   INBOUND PALLETS MODULE  —  inbound-pallets.js
   v4 — location picker on create, forgiving edits at any stage,
        reversible routing & stage, pull-back, delete anywhere
   ============================================================= */

const PALLET_STATUS = { DRAFT:'draft', RECEIVING:'receiving', PREP:'prep', DONE:'done' };

const STATUS_LABELS = {
  en: { draft:'At Dock', receiving:'Ready for Receiving', prep:'Ready for Prep', done:'Completed' },
  es: { draft:'En Muelle', receiving:'Lista p/ Recepción', prep:'Lista p/ Preparación', done:'Completada' },
};
const ROUTING_LABELS = {
  en: { sts:'Short-Term Storage', lts:'Long-Term Storage', overstock:'Overstock' },
  es: { sts:'Almac. Corto Plazo', lts:'Almac. Largo Plazo', overstock:'Exceso' },
};
const EVENT_LABELS = {
  en: {
    created:'Pallet created', label_changed:'Pallet renamed', date_changed:'Pallet date changed',
    po_added:'PO added', po_removed:'PO removed', po_edited:'PO updated',
    po_received:'PO marked received', po_unrecv:'PO unmarked received',
    po_routed:'PO routed', po_unrouted:'PO destination cleared',
    po_transfer:'PO transferred',
    po_prior_receipt:'PO added — partial order continuation',
    po_recv_qty:'Receiving count updated', po_recv_done:'Receiving count marked done',
    po_prep_qty:'Prep count updated', po_prep_verified:'Prep count marked done',
    po_partial:'PO marked partial — awaiting remainder',
    advanced:'Sent to next stage', pulled_back:'Pulled back to previous stage',
    deleted_restored:'Pallet restored',
  },
  es: {
    created:'Tarima creada', label_changed:'Tarima renombrada', date_changed:'Fecha de tarima cambiada',
    po_added:'OC agregada', po_removed:'OC eliminada', po_edited:'OC actualizada',
    po_received:'OC marcada recibida', po_unrecv:'OC desmarcada',
    po_routed:'OC enrutada', po_unrouted:'Destino de OC limpiado',
    po_transfer:'OC transferida',
    po_prior_receipt:'OC agregada — continuación de pedido parcial',
    po_recv_qty:'Cantidad de recepción actualizada', po_recv_done:'Conteo de recepción marcado listo',
    po_prep_qty:'Cantidad de prep actualizada', po_prep_verified:'Conteo de prep marcado listo',
    po_partial:'OC marcada parcial — se espera el resto',
    advanced:'Enviada a siguiente etapa', pulled_back:'Regresada a etapa anterior',
    deleted_restored:'Tarima restaurada',
  },
};

/* ---- helpers ---- */
function plt_lang()    { return (typeof state!=='undefined'&&state.language==='es')?'es':'en'; }
function plt_t(en,es)  { return plt_lang()==='es'?es:en; }
function plt_sl(k)     { return (STATUS_LABELS[plt_lang()]||STATUS_LABELS.en)[k]||k; }
function plt_rl(k)     { return (ROUTING_LABELS[plt_lang()]||ROUTING_LABELS.en)[k]||k; }
function plt_el(k)     { return (EVENT_LABELS[plt_lang()]||EVENT_LABELS.en)[k]||k; }
function plt_sc(s)     { return {draft:'pallet-status-draft',receiving:'pallet-status-receiving',prep:'pallet-status-prep',done:'pallet-status-done'}[s]||'pallet-status-draft'; }
function plt_id()      { return 'p'+Math.random().toString(36).slice(2,10); }
function plt_esc(v)    { if(!v)return''; return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function plt_user()    { return(typeof state!=='undefined'&&state.currentUser)?state.currentUser:'—'; }
function plt_cats()    { if(typeof state!=='undefined'&&Array.isArray(state.masters.categories))return state.masters.categories; return['Drinkware','Apparel','Electronics','Kitchen','Toys','Misc']; }
function plt_locs()    { if(typeof state!=='undefined'&&Array.isArray(state.masters.locations)&&state.masters.locations.length)return state.masters.locations; return['Dock-1','Dock-2','Dock-3']; }
function plt_now()     { return Date.now(); }
function plt_isToday(ts){ if(!ts)return false; return new Date(ts).toISOString().slice(0,10)===new Date().toISOString().slice(0,10); }
function plt_fmtTime(ts){ if(!ts)return'—'; return new Date(ts).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}); }
function plt_fmtDT(ts)  { if(!ts)return'—'; return new Date(ts).toLocaleString([],{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}); }

/* ---- day color helpers ---- */
function plt_dowFromDate(dateStr) {
  if(!dateStr) return -1;
  const [y,m,d] = dateStr.split('-').map(Number);
  return new Date(y, m-1, d).getDay();
}

const PLT_DAY_COLORS = {
  1: { bg:'#fcecd8', border:'#d4845a', label:'Monday',    es:'Lunes'      },
  2: { bg:'#f7f7c8', border:'#9a9a28', label:'Tuesday',   es:'Martes'     },
  3: { bg:'#fcdee8', border:'#c0547a', label:'Wednesday', es:'Miércoles'  },
  4: { bg:'#fde0d0', border:'#c25c38', label:'Thursday',  es:'Jueves'     },
  5: { bg:'#d8efd8', border:'#3e8c3e', label:'Friday',    es:'Viernes'    },
};

function plt_dayColor(dateStr) {
  return PLT_DAY_COLORS[plt_dowFromDate(dateStr)] || null;
}

function plt_dayColorFromLabel(label) {
  if(!label) return null;
  const l = label.toLowerCase();
  if(l.includes('mon') || l.includes('lun')) return PLT_DAY_COLORS[1];
  if(l.includes('tue') || l.includes('mar')) return PLT_DAY_COLORS[2];
  if(l.includes('wed') || l.includes('mié') || l.includes('mie')) return PLT_DAY_COLORS[3];
  if(l.includes('thu') || l.includes('jue')) return PLT_DAY_COLORS[4];
  if(l.includes('fri') || l.includes('vie')) return PLT_DAY_COLORS[5];
  return null;
}

function plt_getColor(pallet) {
  return plt_dayColor(pallet.date) || plt_dayColorFromLabel(pallet.label);
}

/* ---- data ---- */
function plt_all()    { if(!Array.isArray(state.data.pallets))state.data.pallets=[]; return state.data.pallets; }
function plt_get(id)  { return plt_all().find(p=>p.id===id)||null; }
function plt_save()   { if(typeof persistData==='function')persistData(); }

function plt_log(pallet, type, detail, poNum) {
  if(!Array.isArray(pallet.events))pallet.events=[];
  pallet.events.push({id:plt_id(),type,detail:detail||'',poNum:poNum||'',by:plt_user(),ts:plt_now()});
  pallet.updatedAt=plt_now();
}

function plt_create(label, date) {
  const today = new Date().toISOString().slice(0,10);
  const p={id:plt_id(),label,date:date||today,status:'draft',createdBy:plt_user(),createdAt:plt_now(),updatedAt:plt_now(),pos:[],events:[]};
  plt_log(p,'created',`${label} (${p.date})`);
  plt_all().unshift(p);
  plt_save(); return p;
}

function plt_updateMeta(id, updates) {
  const p = plt_get(id); if (!p) return false;
  const nextLabel = String(updates?.label ?? p.label ?? '').trim();
  const nextDate = String(updates?.date ?? p.date ?? '').trim();
  if (!nextLabel) return false;

  let changed = false;
  if (nextLabel !== String(p.label || '')) {
    const old = p.label || '';
    p.label = nextLabel;
    plt_log(p, 'label_changed', `"${old}" → "${p.label}"`);
    changed = true;
  }
  if (nextDate && nextDate !== String(p.date || '')) {
    const oldDate = p.date || '—';
    p.date = nextDate;
    plt_log(p, 'date_changed', `${oldDate} → ${p.date}`);
    changed = true;
  }

  if (changed) plt_save();
  return changed;
}

function plt_renameLabel(id, newLabel) {
  return plt_updateMeta(id, { label: newLabel });
}

/* Advance one stage forward */
function plt_advance(id) {
  const p=plt_get(id); if(!p)return;
  const flow=['draft','receiving','prep','done'];
  const i=flow.indexOf(p.status);
  if(i<flow.length-1){p.status=flow[i+1];plt_log(p,'advanced',plt_sl(p.status));plt_save();}
}

/* Pull back one stage */
function plt_pullBack(id) {
  const p=plt_get(id); if(!p)return;
  const flow=['draft','receiving','prep','done'];
  const i=flow.indexOf(p.status);
  if(i>0){p.status=flow[i-1];plt_log(p,'pulled_back',plt_sl(p.status));plt_save();}
}

/* Delete — available at any stage */
function plt_delete(id) {
  state.data.pallets=plt_all().filter(p=>p.id!==id);
  plt_save();
}

/* Add PO */
/* ------------------------------------------------------------------
   CROSS-PALLET PO HISTORY LOOKUP
   Scans ALL pallets (any status, any date) for the same PO number.
   Returns a summary of prior receipts so the associate knows if this
   PO was partially received before on a different pallet/day.
   ------------------------------------------------------------------ */
function plt_findPriorReceipts(poNumber, excludePalletId) {
  if(!poNumber) return null;
  const norm = String(poNumber).trim().toLowerCase();
  const hits = [];

  plt_all().forEach(pallet=>{
    if(pallet.id === excludePalletId) return; // skip current pallet
    (pallet.pos||[]).forEach(po=>{
      if(String(po.po).trim().toLowerCase() === norm){
        hits.push({
          palletId:   pallet.id,
          palletLabel:pallet.label,
          palletDate: pallet.date||'',
          orderedQty: po.orderedQty,
          receivedQty:po.receivedQty,
          prepQty:    po.prepReceivedQty,
          category:   po.category,
          receivingDone: po.receivingDone,
          prepVerified:  po.prepVerified,
          createdAt:  pallet.createdAt,
        });
      }
    });
  });

  if(!hits.length) return null;

  // Aggregate
  const totalOrdered  = hits.reduce((s,h)=>s + Number(h.orderedQty||0), 0);
  const totalReceived = hits.reduce((s,h)=>s + Number(h.receivedQty||0), 0);
  // The "canonical" ordered qty is the first non-null value found (should be same across all)
  const canonicalOrdered = hits.find(h=>plt_hasVal(h.orderedQty))?.orderedQty ?? null;
  const outstanding = plt_hasVal(canonicalOrdered)
    ? Math.max(0, Number(canonicalOrdered) - totalReceived)
    : null;

  return { hits, totalOrdered, totalReceived, canonicalOrdered, outstanding };
}

/* Build the inline partial-receipt notice HTML */
function plt_priorReceiptBannerHtml(info, poNumber) {
  if(!info) return '';
  const hitCount = info.hits.length;
  const palletList = info.hits.map(h=>{
    const recvStr = plt_hasVal(h.receivedQty) ? h.receivedQty : plt_t('not counted yet','sin contar');
    return `<li><strong>${plt_esc(h.palletLabel)}</strong>${h.palletDate?' · 📅 '+h.palletDate:''} — ${plt_t('received','recibido')}: <strong>${recvStr}</strong></li>`;
  }).join('');

  const outstandingLine = plt_hasVal(info.outstanding)
    ? `<div class="plt-prior-outstanding">${info.outstanding > 0
        ? `⚠️ <strong>${info.outstanding}</strong> ${plt_t('units still outstanding from the original order','unidades aún pendientes del pedido original')}`
        : `✓ ${plt_t('Fully received across all pallets','Recibido completamente en todas las tarimas')}`
      }</div>`
    : '';

  return `<div class="plt-prior-receipt-banner">
    <div class="plt-prior-receipt-title">
      📦 ${plt_t('Partial order — this PO has prior receipts on','OC parcial — esta OC tiene recibos previos en')}
      <strong>${hitCount} ${hitCount===1?plt_t('other pallet','otra tarima'):plt_t('other pallets','otras tarimas')}</strong>
    </div>
    <ul class="plt-prior-receipt-list">${palletList}</ul>
    <div class="plt-prior-receipt-totals">
      ${plt_hasVal(info.canonicalOrdered)?`${plt_t('Total ordered','Total ordenado')}: <strong>${info.canonicalOrdered}</strong> &nbsp;·&nbsp; `:''}
      ${plt_t('Total received so far','Total recibido hasta ahora')}: <strong>${info.totalReceived}</strong>
    </div>
    ${outstandingLine}
    <div class="plt-prior-receipt-note">${plt_t(
      'You are adding a new receipt for this PO. The ordered quantity above has been pre-filled from prior records.',
      'Estás agregando un nuevo recibo para esta OC. La cantidad ordenada arriba se ha llenado automáticamente.'
    )}</div>
  </div>`;
}

function plt_addPo(palletId,data) {
  const p=plt_get(palletId); if(!p)return null;
  if(!Array.isArray(p.pos))p.pos=[];
  const po={
    id:plt_id(),
    po:data.po||'',
    category:data.category||'',
    boxes: data.boxes!=null ? Number(data.boxes) : null,  // physical box count (Dock)
    orderedQty: data.orderedQty!=null ? Number(data.orderedQty) : null, // Dock enters this
    receivedQty:null,      // QA Receiving enters this
    prepReceivedQty:null,  // QA Prep enters this (independent verification)
    dockNotes: data.dockNotes||'',    // notes at Dock stage
    receivingNotes:'',
    prepNotes:'',
    destination:'',   // kept for legacy compat; split routing uses stsQty/ltsQty
    stsQty:null,       // Short-Term Storage qty (set at Prep)
    ltsQty:null,       // Long-Term Storage qty (set at Prep)
    // overstockQty is COMPUTED as receivedQty - orderedQty (not stored)
    receivingDone:false,
    prepVerified:false,
    sizeBreakdown: data.sizeBreakdown || null,
    createdAt:plt_now()
  };
  p.pos.push(po);
  if(data.hasPriorReceipts){
    plt_log(p,'po_prior_receipt',`PO# ${po.po} — continuation of partial order · ${data.priorReceiptCount} prior pallet(s) · ${data.priorTotalReceived} already received`,po.po);
  }
  const sizeNote = po.sizeBreakdown ? ` · sizes: ${Object.entries(po.sizeBreakdown).map(([s,q])=>`${s}:${q}`).join(' ')}` : '';
  plt_log(p,'po_added',`PO# ${po.po} · ordered ${po.orderedQty??'?'} · ${po.boxes??0} boxes · ${po.category}${sizeNote}`,po.po);
  plt_save(); return po;
}

/* Update PO — always allowed regardless of stage */
function plt_updatePo(palletId,poId,fields) {
  const p=plt_get(palletId); if(!p)return;
  const po=(p.pos||[]).find(r=>r.id===poId); if(!po)return;
  const before={...po};
  Object.assign(po,fields);
  // Pick the most meaningful log type
  if(fields.receivingDone===true  && !before.receivingDone) plt_log(p,'po_recv_done',`PO# ${po.po} — receiving count done, counted ${po.receivedQty??'?'}`,po.po);
  else if(fields.receivingDone===false && before.receivingDone) plt_log(p,'po_unrecv',`PO# ${po.po}`,po.po);
  else if(fields.prepVerified===true && !before.prepVerified) plt_log(p,'po_prep_verified',`PO# ${po.po} prep count ${po.prepReceivedQty??'?'}`,po.po);
  else if('destination' in fields && fields.destination && fields.destination!==before.destination)
    plt_log(p,'po_routed',`PO# ${po.po} → ${plt_rl(fields.destination)}`,po.po);
  else if('destination' in fields && !fields.destination && before.destination)
    plt_log(p,'po_unrouted',`PO# ${po.po} cleared from ${plt_rl(before.destination)}`,po.po);
  else if('receivedQty' in fields && fields.receivedQty!==before.receivedQty)
    plt_log(p,'po_recv_qty',`PO# ${po.po} receiving count → ${fields.receivedQty}`,po.po);
  else if('prepReceivedQty' in fields && fields.prepReceivedQty!==before.prepReceivedQty)
    plt_log(p,'po_prep_qty',`PO# ${po.po} prep count → ${fields.prepReceivedQty}`,po.po);
  else plt_log(p,'po_edited',`PO# ${po.po}`,po.po);
  plt_save();
}

/* Delete PO */
function plt_deletePo(palletId,poId) {
  const p=plt_get(palletId); if(!p)return;
  const po=(p.pos||[]).find(r=>r.id===poId);
  if(po)plt_log(p,'po_removed',`PO# ${po.po}`,po.po);
  p.pos=(p.pos||[]).filter(r=>r.id!==poId); plt_save();
}

/* Transfer PO to another pallet */
function plt_transferPo(fromId,poId,toId) {
  const from=plt_get(fromId); const to=plt_get(toId);
  if(!from||!to)return false;
  const po=(from.pos||[]).find(r=>r.id===poId); if(!po)return false;
  const transferred={...po,id:plt_id(),createdAt:plt_now()};
  if(!Array.isArray(to.pos))to.pos=[];
  to.pos.push(transferred);
  from.pos=(from.pos||[]).filter(r=>r.id!==poId);
  plt_log(from,'po_transfer',`PO# ${po.po} → ${to.label}`,po.po);
  plt_log(to,  'po_transfer',`PO# ${po.po} ← from ${from.label}`,po.po);
  plt_save(); return true;
}

/* ---- receiving/prep qty helpers ---- */
function plt_hasVal(v) { return v!==null && v!==undefined && v!==''; }

// Extras = receivedQty - orderedQty (what needs to go to overstock)
function plt_extras(po) {
  if(!plt_hasVal(po.receivedQty) || !plt_hasVal(po.orderedQty)) return null;
  return Number(po.receivedQty) - Number(po.orderedQty);
}

function plt_extrasHtml(po) {
  const diff = plt_extras(po);
  if(diff===null) return '';
  if(diff>0) return `<span class="plt-extras plt-extras-over">+${diff} ${plt_t('extras → Overstock','extra → Exceso')}</span>`;
  if(diff<0) return `<span class="plt-extras plt-extras-short">${diff} ${plt_t('short','faltante')}</span>`;
  return `<span class="plt-extras plt-extras-exact">✓ ${plt_t('Exact','Exacto')}</span>`;
}

// PO fulfillment status based on received vs ordered
function plt_fulfillmentStatus(po) {
  if(!plt_hasVal(po.receivedQty) || !plt_hasVal(po.orderedQty)) return null;
  const recv = Number(po.receivedQty);
  const ord  = Number(po.orderedQty);
  if(recv === ord) return 'exact';
  if(recv < ord)  return 'partial';   // missing units
  return 'over';                      // extras / overstock
}

function plt_fulfillmentBadge(po) {
  const s = plt_fulfillmentStatus(po);
  if(!s) return '';
  const rem = plt_hasVal(po.orderedQty)&&plt_hasVal(po.receivedQty)
    ? Number(po.orderedQty)-Number(po.receivedQty) : null;
  if(s==='exact') return `<span class="plt-fulfil plt-fulfil-exact">✓ ${plt_t('Exact','Exacto')}</span>`;
  if(s==='partial') return `<span class="plt-fulfil plt-fulfil-partial">⚠ ${plt_t('Partial','Parcial')} (${rem} ${plt_t('missing','faltante')})</span>`;
  if(s==='over') {
    const over=Number(po.receivedQty)-Number(po.orderedQty);
    return `<span class="plt-fulfil plt-fulfil-over">+${over} ${plt_t('Over received','Excedente recibido')}</span>`;
  }
  return '';
}

// Discrepancy = prepReceivedQty vs receivedQty (the two-pair-of-eyes check)
function plt_discrepancyHtml(po) {
  if(!plt_hasVal(po.prepReceivedQty) || !plt_hasVal(po.receivedQty)) return '';
  const diff = Number(po.prepReceivedQty) - Number(po.receivedQty);
  if(diff===0) return `<span class="plt-extras plt-extras-exact">✓ ${plt_t('Counts match','Conteos coinciden')}</span>`;
  return `<span class="plt-extras plt-extras-short">⚠️ ${plt_t('Discrepancy','Discrepancia')}: ${diff>0?'+':''}${diff} ${plt_t('vs Receiving','vs Recepción')}</span>`;
}

function plt_prepOverstockQty(po) {
  if(!plt_hasVal(po.prepReceivedQty) || !plt_hasVal(po.orderedQty)) return null;
  return Math.max(0, Number(po.prepReceivedQty) - Number(po.orderedQty));
}

function plt_prepVsOrderedHtml(po) {
  if(!plt_hasVal(po.prepReceivedQty) || !plt_hasVal(po.orderedQty)) return '';
  const diff = Number(po.prepReceivedQty) - Number(po.orderedQty);
  if(diff > 0) return `<span class="plt-extras plt-extras-over">📤 +${diff} ${plt_t('to Overstock','a Exceso')}</span>`;
  if(diff < 0) return `<span class="plt-extras plt-extras-short">⚠️ ${diff} ${plt_t('vs Ordered','vs Ordenado')}</span>`;
  return `<span class="plt-extras plt-extras-exact">✓ ${plt_t('Exact to order','Exacto al pedido')}</span>`;
}

/* ---- modal stack ---- */
let plt_stack=[];
let plt_currentEditorPalletId = null; // track which pallet this browser has open

// Called by app.js poll to refresh the warning in any open modal
function plt_refreshEditorWarning() {
  const overlay = document.getElementById('palletDetailOverlay');
  if (!overlay) return;
  const palletId = overlay.dataset.pid;
  if (!palletId) return;
  const banner = overlay.querySelector('#plt_editorWarning');
  if (!banner) return;
  const warningHtml = plt_editorWarningHtml(palletId);
  banner.innerHTML = warningHtml;
  banner.style.display = warningHtml ? 'block' : 'none';
}

function plt_editorWarningHtml(palletId) {
  const editors = (typeof plt_getActiveEditors === 'function') ? plt_getActiveEditors() : {};
  const myUser = plt_user();
  const entry = editors[palletId];
  if (!entry || !entry.user || entry.user === myUser) return '';
  const name = plt_esc(entry.user);
  return `
    <div class="plt-conflict-banner">
      <div class="plt-conflict-icon">⚠️</div>
      <div class="plt-conflict-text">
        <strong>${name} ${plt_t('is also in this pallet right now.','también está en esta tarima ahora.')}</strong><br>
        ${plt_t('Your changes and theirs may conflict. Coordinate before saving.','Tus cambios y los suyos pueden entrar en conflicto. Coordinen antes de guardar.')}
      </div>
    </div>`;
}

function plt_closeAll(){
  // Deregister self as editor when closing any modal
  if (plt_currentEditorPalletId) {
    if (typeof workflowRegisterEditor === 'function') {
      workflowRegisterEditor(plt_currentEditorPalletId, 'close');
    }
    plt_currentEditorPalletId = null;
  }
  plt_stack.forEach(el=>el.remove()); plt_stack=[]; document.removeEventListener('keydown',plt_escH);
}
function plt_escH(e){ if(e.key==='Escape'){plt_closeAll();plt_renderAllPanels();} }
function plt_push(el){ plt_stack.push(el); document.body.appendChild(el); if(plt_stack.length===1)document.addEventListener('keydown',plt_escH); }
function plt_overlay(id){ const el=document.createElement('div'); el.className='pallet-overlay'; el.id=id; return el; }

/* ---- pallet card html ---- */
function plt_cardHtml(p,dept) {
  const pos=p.pos||[];
  const received=pos.filter(po=>po.receivingDone).length;
  const routed=pos.filter(po=>po.destination).length;
  const progress=dept==='receiving'&&pos.length>0
    ?`<div class="pallet-card-meta">${received}/${pos.length} ${plt_t('received','recibidas')}</div>`
    :dept==='prep'&&pos.length>0
    ?`<div class="pallet-card-meta">${routed}/${pos.length} ${plt_t('routed','enrutadas')}</div>`
    :`<div class="pallet-card-meta">${pos.length} ${plt_t('PO(s)','OC(s)')}</div>`;
  const action={dock:plt_t('Open →','Abrir →'),receiving:plt_t('Receive →','Recepcionar →'),prep:plt_t('Route →','Enrutar →')}[dept]||'→';

  // Day color — from date field first, then inferred from label text
  const col = plt_getColor(p);
  const cardStyle = col
    ? `background:${col.bg};border:2px solid ${col.border};`
    : '';
  const dayBadge = col
    ? `<span class="plt-day-badge" style="background:${col.border}22;color:${col.border};border:1.5px solid ${col.border};">${plt_lang()==='es'?col.es:col.label}</span>`
    : '';
  const dateStr = p.date
    ? `<div class="pallet-card-meta act-dim" style="font-size:0.72rem;">📅 ${p.date}</div>`
    : '';

  return`<div class="pallet-card" data-pid="${p.id}" role="button" tabindex="0" style="${cardStyle}">
    <div class="pallet-card-num" style="${col?`color:${col.border};`:''}">${plt_esc(p.label)||'—'}</div>
    ${dayBadge}
    <span class="pallet-status ${plt_sc(p.status)}">${plt_esc(plt_sl(p.status))}</span>
    ${progress}
    ${dateStr}
    <div class="pallet-card-meta act-dim">${plt_t('Created','Creada')} ${plt_fmtTime(p.createdAt)}</div>
    <div class="pallet-card-action" style="${col?`color:${col.border};font-weight:700;`:''}">${action}</div>
  </div>`;
}

/* ------------------------------------------------------------------
   PANEL RENDERERS
   ------------------------------------------------------------------ */
function plt_renderDockPanel() {
  const c=document.getElementById('palletDockPanel'); if(!c)return;
  const pallets=plt_all().filter(p=>p.status==='draft');
  c.innerHTML=`
    <div class="pallet-panel">
      <div class="pallet-panel-header">
        <div><h2>🏷️ ${plt_t('Pallets at Dock','Tarimas en el Muelle')}</h2>
          <p>${plt_t('Create a pallet, add POs, then send it to Receiving.','Crea una tarima, agrega OCs y envíala a Recepción.')}</p></div>
        <button class="pallet-btn-primary" id="plt_openCreate">+ ${plt_t('New Pallet','Nueva Tarima')}</button>
      </div>
      ${pallets.length===0
        ?`<div class="pallet-empty"><div class="pallet-empty-icon">📦</div>${plt_t('No pallets at dock. Create one to get started.','Sin tarimas. Crea una para comenzar.')}</div>`
        :`<div class="pallet-grid">${pallets.map(p=>plt_cardHtml(p,'dock')).join('')}</div>`}
    </div>`;
  c.querySelector('#plt_openCreate')?.addEventListener('click',plt_openCreateModal);
  c.querySelectorAll('.pallet-card[data-pid]').forEach(el=>el.addEventListener('click',()=>plt_openPalletModal(el.dataset.pid,'dock')));
}

function plt_renderReceivingPanel() {
  const c=document.getElementById('palletReceivingPanel'); if(!c)return;
  const pallets=plt_all().filter(p=>p.status==='receiving');
  c.innerHTML=`
    <div class="pallet-panel">
      <div class="pallet-panel-header">
        <div><h2>📋 ${plt_t('Pallets for Receiving','Tarimas para Recepción')}</h2>
          <p>${plt_t('Pick a pallet from the pool, fill in each PO, then send to Prep.','Toma una tarima, completa cada OC y envíala a Prep.')}</p></div>
        <span class="pallet-status pallet-status-receiving">${pallets.length} ${plt_t('ready','lista(s)')}</span>
      </div>
      ${pallets.length===0
        ?`<div class="pallet-empty"><div class="pallet-empty-icon">⏳</div>${plt_t('No pallets ready for Receiving yet.','Sin tarimas para Recepción aún.')}</div>`
        :`<div class="pallet-grid">${pallets.map(p=>plt_cardHtml(p,'receiving')).join('')}</div>`}
    </div>`;
  c.querySelectorAll('.pallet-card[data-pid]').forEach(el=>el.addEventListener('click',()=>plt_openPalletModal(el.dataset.pid,'receiving')));
}

function plt_renderPrepPanel() {
  const c=document.getElementById('palletPrepPanel'); if(!c)return;
  const pallets=plt_all().filter(p=>p.status==='prep');
  c.innerHTML=`
    <div class="pallet-panel">
      <div class="pallet-panel-header">
        <div><h2>🔀 ${plt_t('Pallets for Prep','Tarimas para Preparación')}</h2>
          <p>${plt_t('Pick a pallet, route each PO to its destination, then complete.','Toma una tarima, enruta cada OC y complétala.')}</p></div>
        <span class="pallet-status pallet-status-prep">${pallets.length} ${plt_t('ready','lista(s)')}</span>
      </div>
      ${pallets.length===0
        ?`<div class="pallet-empty"><div class="pallet-empty-icon">⏳</div>${plt_t('No pallets ready for Prep yet.','Sin tarimas para Prep aún.')}</div>`
        :`<div class="pallet-grid">${pallets.map(p=>plt_cardHtml(p,'prep')).join('')}</div>`}
    </div>`;
  c.querySelectorAll('.pallet-card[data-pid]').forEach(el=>el.addEventListener('click',()=>plt_openPalletModal(el.dataset.pid,'prep')));
}

/* ---- Activity log ---- */
/* ---- Activity log ---- */

// Per-panel selected date — persists across re-renders, defaults to today each page load
const plt_activityDates = {};
function plt_getActivityDate(cid) {
  if(!plt_activityDates[cid]) plt_activityDates[cid] = new Date().toISOString().slice(0,10);
  return plt_activityDates[cid];
}

function plt_renderActivityPanel(containerId) {
  const c = document.getElementById(containerId); if(!c) return;

  const today     = new Date().toISOString().slice(0,10);
  const yesterday = new Date(Date.now()-86400000).toISOString().slice(0,10);
  const selDate   = plt_getActivityDate(containerId);
  const panelDept = containerId==='palletDockActivity' ? 'dock'
                  : containerId==='palletReceivingActivity' ? 'receiving'
                  : containerId==='palletPrepActivity' ? 'prep' : 'dock';

  const isToday     = selDate===today;
  const isYesterday = selDate===yesterday;
  const dateLbl     = isToday ? plt_t('Today','Hoy')
                    : isYesterday ? plt_t('Yesterday','Ayer')
                    : selDate;

  // Include pallets whose assigned date matches OR had any events/updates on selDate
  const selPallets = plt_all().filter(p=>{
    if(p.date===selDate) return true;
    const allTs=[...(p.events||[]).map(e=>e.ts),p.createdAt,p.updatedAt].filter(Boolean);
    return allTs.some(ts=>new Date(ts).toISOString().slice(0,10)===selDate);
  }).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));

  // Build the date-chooser header — always rendered so the panel is never blank
  const dateChooser = `
    <div class="plt-date-chooser">
      <button class="plt-date-btn ${isToday?'plt-date-btn-active':''}" data-date="${today}">${plt_t('Today','Hoy')}</button>
      <button class="plt-date-btn ${isYesterday?'plt-date-btn-active':''}" data-date="${yesterday}">${plt_t('Yesterday','Ayer')}</button>
      <input type="date" class="plt-date-input" value="${selDate}" title="${plt_t('Pick a date','Elegir fecha')}"/>
    </div>`;

  if(!selPallets.length){
    c.innerHTML=`<div class="pallet-panel act-panel">
      <div class="pallet-panel-header">
        <div><h2>📊 ${plt_t('Activity','Actividad')} — ${dateLbl}</h2>
          <p>${plt_t('All pallets touched on the selected day.','Todas las tarimas trabajadas en el día seleccionado.')}</p></div>
        ${dateChooser}
      </div>
      <div class="pallet-empty" style="padding:28px 16px;">
        <div class="pallet-empty-icon">📭</div>
        ${plt_t('No pallet activity found for','Sin actividad para')} <strong>${dateLbl}</strong>
      </div>
    </div>`;
    // Wire date buttons even in empty state
    c.querySelectorAll('.plt-date-btn[data-date]').forEach(btn=>{
      btn.addEventListener('click',()=>{ plt_activityDates[containerId]=btn.dataset.date; plt_renderActivityPanel(containerId); });
    });
    c.querySelector('.plt-date-input')?.addEventListener('change',e=>{
      if(e.target.value){ plt_activityDates[containerId]=e.target.value; plt_renderActivityPanel(containerId); }
    });
    return;
  }

  const rows = selPallets.map(p=>{
    const pos=p.pos||[];
    const selEvents=(p.events||[]).filter(e=>new Date(e.ts).toISOString().slice(0,10)===selDate);
    const totalBoxes      = pos.reduce((s,po)=>s+Number(po.boxes||0),0);
    const totalOrdered    = pos.reduce((s,po)=>s+Number(po.orderedQty||0),0);
    const totalRecvQty    = pos.reduce((s,po)=>s+Number(po.receivedQty||0),0);   // Receiving dept count
    const totalPrepQty    = pos.reduce((s,po)=>s+Number(po.prepReceivedQty||0),0); // Prep dept count
    const hasAnyRecvQty   = pos.some(po=>plt_hasVal(po.receivedQty));
    const hasAnyPrepQty   = pos.some(po=>plt_hasVal(po.prepReceivedQty));
    const recvCount       = pos.filter(po=>po.receivingDone).length;
    const routedCount     = pos.filter(po=>po.destination||po.stsQty||po.ltsQty).length;

    // Unique ID for this pallet's count-reveal toggle
    const countRevealId = `actCounts_${p.id}`;

    const poTableRows=pos.length===0
      ?`<tr><td colspan="9" class="act-empty-cell">${plt_t('No POs on this pallet.','Sin OCs en esta tarima.')}</td></tr>`
      :pos.map(po=>{
        const destBadge=po.destination
          ?`<span class="act-dest-badge act-dest-${po.destination}">${plt_rl(po.destination)}</span>`
          :(plt_hasVal(po.stsQty)||plt_hasVal(po.ltsQty))
          ?`<span class="act-dim">${plt_hasVal(po.stsQty)?'STS:'+po.stsQty:''}${(plt_hasVal(po.stsQty)&&plt_hasVal(po.ltsQty))?' / ':''}${plt_hasVal(po.ltsQty)?'LTS:'+po.ltsQty:''}</span>`
          :`<span class="act-dim">—</span>`;
        const recvBadge=po.receivingDone
          ?`<span class="act-recv-badge act-recv-yes">✓ ${plt_t('Done','Listo')}</span>`
          :`<span class="act-recv-badge act-recv-no">${plt_t('Pending','Pend.')}</span>`;
        const hasOrd  = plt_hasVal(po.orderedQty);
        const hasRecv = plt_hasVal(po.receivedQty);
        const hasPrep = plt_hasVal(po.prepReceivedQty);
        const fulfilBadge = plt_fulfillmentBadge(po);
        const extrasCell  = plt_extrasHtml(po)||'<span class="act-dim">—</span>';
        const notes=[po.dockNotes,po.receivingNotes,po.prepNotes].filter(Boolean).join(' · ')||'';
        return`<tr>
          <td class="act-po-num">PO# ${plt_esc(po.po)}</td>
          <td>${plt_esc(po.category)||'—'}</td>
          <td class="act-num">${hasOrd?po.orderedQty:'—'}</td>
          <td class="act-num act-count-cell ${hasRecv&&hasOrd&&Number(po.receivedQty)!==Number(po.orderedQty)?'act-mismatch':''}"
              data-reveal="${countRevealId}">${hasRecv?po.receivedQty:'—'}</td>
          <td class="act-num act-count-cell ${hasPrep&&hasRecv&&Number(po.prepReceivedQty)!==Number(po.receivedQty)?'act-mismatch':''}"
              data-reveal="${countRevealId}">${hasPrep?po.prepReceivedQty:'—'}</td>
          <td>${fulfilBadge||extrasCell}</td>
          <td>${recvBadge}</td>
          <td>${destBadge}</td>
          <td class="act-time">${plt_fmtTime(po.createdAt)}</td>
        </tr>${notes?`<tr class="act-notes-row"><td colspan="9">📝 ${plt_esc(notes)}</td></tr>`:''}`
      }).join('');

    const eventsHtml=selEvents.length===0?'':`<div class="act-timeline">${
      selEvents.map(ev=>`<div class="act-event">
        <span class="act-event-time">${plt_fmtTime(ev.ts)}</span>
        <span class="act-event-dot"></span>
        <span class="act-event-label">${plt_esc(plt_el(ev.type))}${ev.detail?` — <em>${plt_esc(ev.detail)}</em>`:''}</span>
        <span class="act-event-by">${plt_esc(ev.by||'—')}</span>
      </div>`).join('')
    }</div>`;

    const actCol=plt_getColor(p);
    const actDayBadge=actCol?`<span class="plt-day-badge" style="background:${actCol.border}22;color:${actCol.border};border:1.5px solid ${actCol.border};">${plt_lang()==='es'?actCol.es:actCol.label}</span>`:'';
    const actDateStr=p.date?`📅 ${p.date} · `:'';
    const actRowStyle=actCol?`border-left:4px solid ${actCol.border};`:'';

    return`<div class="act-pallet-row" data-pid="${p.id}" data-dept="${panelDept}" style="${actRowStyle}">
      <div class="act-pallet-head">
        <strong class="act-pallet-label">📦 ${plt_esc(p.label)}</strong>
        ${actDayBadge}
        <span class="pallet-status ${plt_sc(p.status)}">${plt_esc(plt_sl(p.status))}</span>
        <span class="act-dim">${actDateStr}${plt_t('by','por')} ${plt_esc(p.createdBy||'—')} @ ${plt_fmtTime(p.createdAt)}</span>
        <button type="button" class="pallet-btn-secondary act-open-btn" data-pid="${p.id}" data-dept="${panelDept}">${plt_t('Open Pallet','Abrir Tarima')}</button>
      </div>
      <div class="act-summary-chips">
        <span class="act-chip">${pos.length} ${plt_t('PO(s)','OC(s)')}</span>
        <span class="act-chip">${totalBoxes} ${plt_t('boxes','cajas')}</span>
        <span class="act-chip">${totalOrdered||'—'} ${plt_t('ordered','ordenado')}</span>
        ${recvCount>0?`<span class="act-chip act-chip-recv">${recvCount}/${pos.length} ${plt_t('recv done','recep. listas')}</span>`:''}
        ${routedCount>0?`<span class="act-chip act-chip-routed">${routedCount} ${plt_t('routed','enrutadas')}</span>`:''}
        ${(hasAnyRecvQty||hasAnyPrepQty)?`<button type="button" class="plt-reveal-toggle act-count-reveal-btn" data-reveal-target="${countRevealId}">
          👁 ${plt_t('Show counts','Ver conteos')}
        </button>
        <span class="act-count-summary hidden" id="${countRevealId}">
          ${hasAnyRecvQty?`<span class="act-chip act-chip-recv">📦 ${plt_t('Recv','Recep.')}: ${totalRecvQty}</span>`:''}
          ${hasAnyPrepQty?`<span class="act-chip act-chip-prep">🔀 ${plt_t('Prep','Prep')}: ${totalPrepQty}</span>`:''}
        </span>`:''}
      </div>
      <div class="act-table-wrap"><table class="act-po-table">
        <thead><tr>
          <th>${plt_t('PO #','OC #')}</th>
          <th>${plt_t('Category','Categoría')}</th>
          <th>${plt_t('Ordered','Ordenado')}</th>
          <th class="act-count-header" data-reveal="${countRevealId}">👁 ${plt_t('Recv Count','Cont. Recep.')}</th>
          <th class="act-count-header" data-reveal="${countRevealId}">👁 ${plt_t('Prep Count','Cont. Prep')}</th>
          <th>${plt_t('Status','Estado')}</th>
          <th>${plt_t('Recv Done','Recep. Lista')}</th>
          <th>${plt_t('Destination','Destino')}</th>
          <th>${plt_t('Time','Hora')}</th>
        </tr></thead>
        <tbody>${poTableRows}</tbody>
        ${pos.length>1?`<tfoot><tr class="act-totals-row">
          <td><strong>${plt_t('Totals','Totales')}</strong></td><td>—</td>
          <td class="act-num"><strong>${totalOrdered||'—'}</strong></td>
          <td class="act-num act-count-cell" data-reveal="${countRevealId}"><strong>${totalRecvQty||'—'}</strong></td>
          <td class="act-num act-count-cell" data-reveal="${countRevealId}"><strong>${totalPrepQty||'—'}</strong></td>
          <td>—</td>
          <td>${recvCount}/${pos.length} ${plt_t('done','listas')}</td>
          <td>—</td><td>—</td>
        </tr></tfoot>`:''}
      </table></div>
      ${eventsHtml}
    </div>`;
  }).join('');

  c.innerHTML=`<div class="pallet-panel act-panel">
    <div class="pallet-panel-header">
      <div>
        <h2>📊 ${plt_t('Activity','Actividad')} — ${dateLbl}</h2>
        <p>${plt_t('All pallets touched on the selected day — full detail and event history.','Todas las tarimas trabajadas en el día seleccionado.')}</p>
      </div>
      ${dateChooser}
    </div>
    <div class="act-list">${rows}</div>
  </div>`;

  // Wire date chooser
  c.querySelectorAll('.plt-date-btn[data-date]').forEach(btn=>{
    btn.addEventListener('click',()=>{ plt_activityDates[containerId]=btn.dataset.date; plt_renderActivityPanel(containerId); });
  });
  c.querySelector('.plt-date-input')?.addEventListener('change',e=>{
    if(e.target.value){ plt_activityDates[containerId]=e.target.value; plt_renderActivityPanel(containerId); }
  });

  // Wire open-pallet buttons
  c.querySelectorAll('.act-open-btn[data-pid]').forEach(btn=>{
    btn.addEventListener('click',e=>{
      e.preventDefault(); e.stopPropagation();
      plt_openPalletModal(btn.dataset.pid, btn.dataset.dept||panelDept);
    });
  });

  // Wire count-reveal toggles — show/hide Recv and Prep count columns per pallet row
  c.querySelectorAll('.act-count-reveal-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const targetId = btn.dataset.revealTarget;
      const summarySpan = c.querySelector(`#${targetId}`);
      const countCells  = c.querySelectorAll(`[data-reveal="${targetId}"]`);
      const isHidden    = summarySpan ? summarySpan.classList.contains('hidden') : true;
      if(summarySpan) summarySpan.classList.toggle('hidden', !isHidden);
      countCells.forEach(el=>el.classList.toggle('act-count-hidden', isHidden ? false : true));
      btn.textContent = isHidden
        ? '🙈 '+plt_t('Hide counts','Ocultar conteos')
        : '👁 '+plt_t('Show counts','Ver conteos');
    });
  });

  // Count cells start hidden — apply initial hidden state after render
  c.querySelectorAll('.act-count-cell').forEach(el=>el.classList.add('act-count-hidden'));
  c.querySelectorAll('.act-count-header').forEach(el=>el.classList.add('act-count-hidden'));
}

function plt_renderAllActivity() {
  plt_renderActivityPanel('palletDockActivity');
  plt_renderActivityPanel('palletReceivingActivity');
  plt_renderActivityPanel('palletPrepActivity');
}

/* ------------------------------------------------------------------
   CREATE PALLET MODAL — location picker from settings
   ------------------------------------------------------------------ */
function plt_openCreateModal() {
  plt_closeAll();
  const locs=plt_locs();
  const locOpts=locs.map(l=>`<option value="${plt_esc(l)}">${plt_esc(l)}</option>`).join('');

  const overlay=plt_overlay('palletCreateOverlay');
  overlay.innerHTML=`
    <div class="pallet-modal" role="dialog" aria-modal="true">
      <div class="pallet-modal-header">
        <div><h3>📦 ${plt_t('Create New Pallet','Crear Nueva Tarima')}</h3>
          <p class="pallet-modal-sub">${plt_t('Pick a dock location. You can add POs right after.','Elige una ubicación. Puedes agregar OCs de inmediato.')}</p></div>
        <button class="pallet-modal-close">✕</button>
      </div>
      <div class="pallet-modal-body">
        <div class="pallet-form-row">
          <div class="pallet-form-field" style="flex:1;">
            <label>${plt_t('Dock Location / Pallet Name','Ubicación / Nombre de Tarima')} *</label>
            <select id="plt_newLabelSelect">
              <option value="">${plt_t('— Select location —','— Seleccionar ubicación —')}</option>
              ${locOpts}
            </select>
          </div>
        </div>
        <div class="pallet-form-row">
          <div class="pallet-form-field" style="flex:1;">
            <label>${plt_t('Or type a custom name (optional)','O escribe un nombre personalizado (opcional)')}</label>
            <input id="plt_newLabelCustom" type="text" placeholder="${plt_t('e.g. Pallet 3 overflow','Ej. Tarima 3 extra')}" autocomplete="off"/>
          </div>
        </div>
        <div class="pallet-form-row">
          <div class="pallet-form-field" style="flex:1;">
            <label>📅 ${plt_t('Date','Fecha')} — ${plt_t('defaults to today','por defecto hoy')}</label>
            <input id="plt_newDate" type="date" value="${new Date().toISOString().slice(0,10)}" style="font-size:1rem;"/>
          </div>
        </div>
        <p style="font-size:0.78rem;color:var(--text-secondary,#888);margin:0;">
          ${plt_t('Custom name overrides the dropdown. Date sets the day-color on the card.','El nombre personalizado sobreescribe la selección. La fecha controla el color del día.')}
        </p>
      </div>
      <div class="pallet-modal-footer">
        <button class="pallet-btn-secondary" id="plt_cancelCreate">${plt_t('Cancel','Cancelar')}</button>
        <button class="pallet-btn-primary"   id="plt_confirmCreate">${plt_t('Create Pallet','Crear Tarima')}</button>
      </div>
    </div>`;
  plt_push(overlay);
  overlay.querySelector('#plt_newLabelSelect').focus();

  const doCreate=()=>{
    const custom=overlay.querySelector('#plt_newLabelCustom').value.trim();
    const fromSelect=overlay.querySelector('#plt_newLabelSelect').value;
    const label=custom||fromSelect;
    if(!label){
      overlay.querySelector('#plt_newLabelSelect').style.borderColor='#dc2626';
      overlay.querySelector('#plt_newLabelSelect').focus(); return;
    }
    const date=overlay.querySelector('#plt_newDate').value||new Date().toISOString().slice(0,10);
    const p=plt_create(label, date);
    plt_closeAll(); plt_renderAllPanels();
    plt_openPalletModal(p.id,'dock');
  };

  overlay.querySelector('#plt_confirmCreate').addEventListener('click',doCreate);
  overlay.querySelector('#plt_cancelCreate').addEventListener('click',()=>{plt_closeAll();plt_renderAllPanels();});
  overlay.querySelector('.pallet-modal-close').addEventListener('click',()=>{plt_closeAll();plt_renderAllPanels();});
  overlay.querySelector('#plt_newLabelCustom').addEventListener('keydown',e=>{if(e.key==='Enter')doCreate();});
  overlay.addEventListener('click',e=>{if(e.target===overlay){plt_closeAll();plt_renderAllPanels();}});
}

/* ------------------------------------------------------------------
   MAIN PALLET MODAL
   ------------------------------------------------------------------ */
function plt_openPalletModal(palletId,dept){
  const pallet=plt_get(palletId); if(!pallet)return;
  plt_closeAll(); plt_buildPalletModal(pallet,dept);
}

function plt_buildPalletModal(pallet,dept){
  if(!pallet)return;
  const overlay=plt_overlay('palletDetailOverlay');
  overlay.dataset.pid=pallet.id;

  // Register self as editing this pallet
  plt_currentEditorPalletId = pallet.id;
  if (typeof workflowRegisterEditor === 'function') {
    workflowRegisterEditor(pallet.id, 'open');
  }

  const pos=pallet.pos||[];
  const order=['draft','receiving','prep','done'];
  const ci=order.indexOf(pallet.status);
  const steps=[
    {key:'draft',    label:plt_t('Dock','Muelle')},
    {key:'receiving',label:plt_t('Receiving','Recepción')},
    {key:'prep',     label:plt_t('Prep','Prep')},
    {key:'done',     label:plt_t('Done','Listo')},
  ];
  const progressHtml=steps.map((s,i)=>{
    const done=i<ci,active=i===ci;
    const lc=done?'done':active?'active':'';
    const line=i<steps.length-1?`<div class="pallet-progress-line ${i<ci?'done':''}"></div>`:'';
    return`<div class="pallet-progress-step"><div class="pallet-progress-dot ${lc}">${done?'✓':i+1}</div><div class="pallet-progress-label ${lc}">${s.label}</div></div>${line}`;
  }).join('');

  const advLabels={
    draft:     plt_t('Send to Receiving ▶','Enviar a Recepción ▶'),
    receiving: plt_t('Send to Prep ▶','Enviar a Prep ▶'),
    prep:      plt_t('Mark Complete ✓','Marcar Completa ✓'),
  };
  const pullLabels={
    receiving: plt_t('◀ Pull Back to Dock','◀ Regresar al Muelle'),
    prep:      plt_t('◀ Pull Back to Receiving','◀ Regresar a Recepción'),
    done:      plt_t('◀ Re-open to Prep','◀ Reabrir en Prep'),
  };

  const instr={
    dock:      plt_t('Add POs and send to Receiving when ready.','Agrega OCs y envía a Recepción cuando estés listo.'),
    receiving: plt_t('Fill in each PO, then send to Prep. You can edit anything here.','Completa cada OC y envía a Prep. Puedes editar todo aquí.'),
    prep:      plt_t('Route each PO to its destination, then complete. All edits still allowed.','Enruta cada OC. Aún puedes editar todos los campos.'),
  };

  const catOpts=plt_cats().map(c=>`<option value="${plt_esc(c)}">${plt_esc(c)}</option>`).join('');
  const otherPallets=plt_all().filter(p=>p.id!==pallet.id&&p.status!=='done');
  const isDone=pallet.status==='done';
  // For add-PO form: always show at dock; also show at receiving and prep (forgiving)
  const showAddPo=!isDone;

    // Day color accent for modal
  const modalCol = plt_getColor(pallet);
  const modalTopStyle = modalCol
    ? `border-top:4px solid ${modalCol.border};background:linear-gradient(to bottom,${modalCol.bg} 0%,var(--surface,#fff) 70px);`
    : '';
  const modalDayBadge = modalCol
    ? `<span class="plt-day-badge" style="background:${modalCol.border}22;color:${modalCol.border};border:1.5px solid ${modalCol.border};">${plt_lang()==='es'?modalCol.es:modalCol.label}</span>`
    : '';
  const palletDate = pallet.date || new Date().toISOString().slice(0,10);

  overlay.innerHTML=`
    <div class="pallet-modal pallet-modal-wide" role="dialog" aria-modal="true" style="${modalTopStyle}">
      <div class="pallet-modal-header">
        <div>
          <div class="plt-label-row">
            <h3 id="plt_palletTitle">📦 ${plt_esc(pallet.label)}</h3>
            ${modalDayBadge}
            ${!isDone?`<button class="pallet-btn-ghost plt-tiny" id="plt_renameLabelBtn">✏️ ${plt_t('Edit','Editar')}</button>`:''}          </div>
          <p class="pallet-modal-sub">
            <span class="pallet-status ${plt_sc(pallet.status)}">${plt_esc(plt_sl(pallet.status))}</span>
            &nbsp;📅 <strong>${palletDate}</strong>
            &nbsp;· ${plt_esc(isDone?plt_t('Complete. Pull back to re-open.','Completa. Puedes regresar si necesitas.'):(instr[dept]||''))}
          </p>
        </div>
        <button class="pallet-modal-close">✕</button>
      </div>

      <div class="pallet-modal-body">
        <!-- Concurrent editor warning — shown when another associate has this pallet open -->
        ${(()=>{ const w=plt_editorWarningHtml(pallet.id); return `<div id="plt_editorWarning" style="${w?'':'display:none;'}">${w}</div>`; })()}
        <!-- name + date inline editor (hidden by default) -->
        <div class="plt-rename-row hidden" id="plt_renameRow">
          <div class="plt-rename-fields">
            <div class="pallet-form-field" style="flex:2;min-width:140px;">
              <label>${plt_t('Pallet name','Nombre de tarima')}</label>
              <input id="plt_renameInput" type="text" value="${plt_esc(pallet.label)}"/>
            </div>
            <div class="pallet-form-field" style="flex:1;min-width:130px;">
              <label>📅 ${plt_t('Date','Fecha')}</label>
              <input id="plt_dateInput" type="date" value="${palletDate}"/>
            </div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
            <button class="pallet-btn-primary plt-tiny" id="plt_renameSave">${plt_t('Save Changes','Guardar Cambios')}</button>
            <button class="pallet-btn-ghost plt-tiny" id="plt_renameCancel">${plt_t('Cancel','Cancelar')}</button>
          </div>
        </div>

        <div class="pallet-progress">${progressHtml}</div>

        <div class="pallet-section-title">
          ${plt_t('Purchase Orders','Órdenes de Compra')}
          <span style="font-weight:400;text-transform:none;margin-left:6px;">(${pos.length} ${plt_t('total','total')})</span>
        </div>

        <div class="po-list" id="plt_poList">
          ${pos.length===0
            ?`<div class="pallet-empty">${plt_t('No POs yet. Add one below.','Sin OCs. Agrega una abajo.')}</div>`
            :pos.map(po=>plt_poCardHtml(pallet,po,dept,otherPallets)).join('')}
        </div>

        ${showAddPo?plt_addPoFormHtml(catOpts):''}
        ${pallet.status==='prep'?plt_routingSummaryHtml(pallet):''}

        <div class="pallet-section-title" style="margin-top:20px;">
          🕐 ${plt_t('History','Historial')}
          <button class="pallet-btn-ghost plt-tiny" id="plt_toggleLog" style="margin-left:8px;">${plt_t('Show','Mostrar')}</button>
        </div>
        <div class="plt-log-wrap hidden" id="plt_logWrap">${plt_eventLogHtml(pallet)}</div>
      </div>

      <div class="pallet-modal-footer">
        <!-- Delete always available -->
        <button class="pallet-btn-danger" id="plt_deleteBtn">${plt_t('Delete','Eliminar')}</button>
        <!-- Pull back if not at dock -->
        ${pallet.status!=='draft'?`<button class="pallet-btn-secondary" id="plt_pullBackBtn" style="font-size:0.82rem;">${pullLabels[pallet.status]||'◀ Back'}</button>`:''}
        <button class="pallet-btn-secondary" id="plt_closeBtn">${plt_t('Close','Cerrar')}</button>
        ${pallet.status!=='done'?`<button class="pallet-advance-btn" id="plt_advanceBtn">${advLabels[pallet.status]||''}</button>`:''}
      </div>
    </div>`;

  plt_push(overlay);

  const closeR=()=>{plt_closeAll();plt_renderAllPanels();};
  overlay.querySelector('.pallet-modal-close').addEventListener('click',closeR);
  overlay.querySelector('#plt_closeBtn').addEventListener('click',closeR);
  overlay.addEventListener('click',e=>{if(e.target===overlay)closeR();});

  /* rename pallet label inline */
  overlay.querySelector('#plt_renameLabelBtn')?.addEventListener('click',()=>{
    overlay.querySelector('#plt_renameRow').classList.remove('hidden');
    overlay.querySelector('#plt_renameInput').focus();
    overlay.querySelector('#plt_renameInput').select();
  });
  overlay.querySelector('#plt_renameCancel')?.addEventListener('click',()=>{
    overlay.querySelector('#plt_renameRow').classList.add('hidden');
  });
  overlay.querySelector('#plt_renameSave')?.addEventListener('click',()=>{
    const val = overlay.querySelector('#plt_renameInput').value.trim();
    const nextDate = overlay.querySelector('#plt_dateInput')?.value || pallet.date || '';
    if(!val) return showToast(plt_t('Pallet name is required.','El nombre de la tarima es obligatorio.'), 'error');
    const changed = plt_updateMeta(pallet.id,{ label: val, date: nextDate });
    if (!changed) {
      overlay.querySelector('#plt_renameRow').classList.add('hidden');
      return;
    }
    plt_closeAll(); plt_buildPalletModal(plt_get(pallet.id),dept); plt_renderAllPanels();
  });
  overlay.querySelector('#plt_renameInput')?.addEventListener('keydown',e=>{
    if(e.key==='Enter'){ overlay.querySelector('#plt_renameSave').click(); }
    if(e.key==='Escape'){ overlay.querySelector('#plt_renameRow').classList.add('hidden'); }
  });

  /* delete — always available, confirm first */
  overlay.querySelector('#plt_deleteBtn')?.addEventListener('click',()=>{
    const msg=plt_t(
      `Delete "${pallet.label}"? All POs and history will be lost.`,
      `¿Eliminar "${pallet.label}"? Se perderán todas las OCs e historial.`
    );
    if(window.confirm(msg)){ plt_delete(pallet.id); closeR(); }
  });

  /* pull back */
  overlay.querySelector('#plt_pullBackBtn')?.addEventListener('click',()=>{
    const msg=plt_t(
      `Pull "${pallet.label}" back to the previous stage?`,
      `¿Regresar "${pallet.label}" a la etapa anterior?`
    );
    if(window.confirm(msg)){
      plt_pullBack(pallet.id);
      plt_closeAll(); plt_buildPalletModal(plt_get(pallet.id),dept); plt_renderAllPanels();
    }
  });

  /* advance */
  overlay.querySelector('#plt_advanceBtn')?.addEventListener('click',()=>{
    plt_advance(pallet.id);
    plt_closeAll();        // close the modal — the pallet has moved to next dept
    plt_renderAllPanels(); // refresh the queue panels
  });

  /* toggle history */
  overlay.querySelector('#plt_toggleLog')?.addEventListener('click',()=>{
    const wrap=overlay.querySelector('#plt_logWrap');
    const btn=overlay.querySelector('#plt_toggleLog');
    const hidden=wrap.classList.toggle('hidden');
    btn.textContent=hidden?plt_t('Show','Mostrar'):plt_t('Hide','Ocultar');
  });

  /* add PO form */
  const addForm=overlay.querySelector('#plt_addPoForm');
  if(addForm) plt_bindAddPoForm(addForm,pallet.id,dept);

  /* PO card actions — delegated to shared helper */
  plt_bindPoCardEvents(overlay.querySelector('#plt_poList'), pallet, dept);
}

/* ------------------------------------------------------------------
   PO CARD HTML — edit always shown at all stages
   ------------------------------------------------------------------ */
function plt_poCardHtml(pallet,po,dept,otherPallets){
  const canTransfer = pallet.status!=='done' && otherPallets && otherPallets.length>0;
  const isPrep = dept==='prep'  && pallet.status==='prep';
  const isRecv = dept==='receiving' && pallet.status==='receiving';
  const isDock = dept==='dock'  || pallet.status==='draft';
  const isDone = pallet.status==='done';

  // Status pill
  let stCls='po-status-open', stLbl=plt_t('Open','Abierta');
  if(po.destination)         { stCls='po-status-prepped';  stLbl=plt_t('Routed','Enrutada');  }
  else if(po.prepVerified)   { stCls='po-status-received'; stLbl=plt_t('Prep ✓','Prep ✓');   }
  else if(po.receivingDone)  { stCls='po-status-received'; stLbl=plt_t('Received','Recibida'); }

  const chipCls = dest => po.destination===dest
    ? `routing-chip selected-${dest==='sts'?'sts':dest==='lts'?'lts':'over'}`
    : 'routing-chip';

  // Value presence checks
  const hasOrd      = plt_hasVal(po.orderedQty);
  const hasRecv     = plt_hasVal(po.receivedQty);
  const hasPrep     = plt_hasVal(po.prepReceivedQty);

  // ── DOCK VIEW ────────────────────────────────────────────────────────────
  // Shows what the Docker entered: PO#, ordered qty, category. Clean read-only.
  const hasBoxes = plt_hasVal(po.boxes);
  const dockView = `
    <div class="po-card-grid">
      <div class="po-field">
        <label>${plt_t('Ordered Qty','Cant. Ordenada')}</label>
        <span class="plt-qty-big">${hasOrd ? po.orderedQty : '—'}</span>
      </div>
      <div class="po-field">
        <label>${plt_t('Boxes','Cajas')}</label>
        <span class="plt-qty-big">${hasBoxes ? po.boxes : '—'}</span>
      </div>
      <div class="po-field">
        <label>${plt_t('Category','Categoría')}</label>
        <span>${plt_esc(po.category)||'—'}</span>
      </div>
    </div>
    ${po.dockNotes?`<p class="po-note">📦 ${plt_esc(po.dockNotes)}</p>`:''}
    ${po.sizeBreakdown && Object.keys(po.sizeBreakdown).length
      ? `<p class="po-note" style="color:#6b7280;">👕 ${plt_t('Sizes','Tallas')}: ${Object.entries(po.sizeBreakdown).map(([s,q])=>`${plt_esc(s)}:${q}`).join(' · ')}</p>`
      : ''}
    <div class="po-card-actions">
      <button class="pallet-btn-ghost plt-tiny plt-po-edit">${plt_t('Edit','Editar')}</button>
      ${canTransfer?`<button class="pallet-btn-ghost plt-tiny plt-po-transfer">⇄ ${plt_t('Transfer','Transferir')}</button>`:''}
      <button class="pallet-btn-danger plt-tiny plt-po-delete">✕ ${plt_t('Remove','Eliminar')}</button>
    </div>`;

  // ── RECEIVING VIEW ────────────────────────────────────────────────────────
  // Dock numbers are HIDDEN by default — associate enters their own count first.
  // Dock numbers only revealed on demand to prevent count anchoring/bias.
  const recvRevealId = `recvReveal_${po.id}`;
  const recvView = `
    <div class="plt-recv-meta-strip">
      <span class="plt-recv-cat">📦 ${plt_esc(po.category)||'—'}</span>
      ${hasOrd
        ? `<span class="plt-ordered-badge">📋 ${plt_t('Ordered','Ordenado')}: <strong>${po.orderedQty}</strong></span>`
        : `<span class="plt-ordered-badge plt-ordered-missing">📋 ${plt_t('Ordered: not set','Ordenado: no ingresado')}</span>`}
      <button type="button" class="plt-reveal-toggle plt-recv-reveal-btn" data-target="${recvRevealId}">
        👁 ${plt_t('Show dock details','Ver detalles del muelle')}
      </button>
    </div>
    <div class="plt-prev-dept-block hidden" id="${recvRevealId}">
      <div class="plt-prev-dept-label">⚠️ ${plt_t('Dock reference — verify only after your own count. Do not let these numbers anchor your count.','Referencia del muelle — verifica solo después de tu propio conteo.')}</div>
      <div class="plt-ref-row">
        <span class="plt-ref-label">📋 ${plt_t('Ordered (Dock)','Ordenado (Muelle)')}</span>
        <span class="plt-ref-value">${hasOrd ? po.orderedQty : plt_t('Not set','No ingresado')}</span>
      </div>
      <div class="plt-ref-row">
        <span class="plt-ref-label">📦 ${plt_t('Boxes','Cajas')}</span>
        <span class="plt-ref-value">${plt_hasVal(po.boxes) ? po.boxes : '—'}</span>
      </div>
      ${po.dockNotes?`<p class="po-note" style="margin:4px 0 0;">📦 ${plt_esc(po.dockNotes)}</p>`:''}
    </div>
    <div class="plt-recv-entry">
      <div class="plt-recv-inputs">
        <div class="plt-recv-field">
          <label>${plt_t('Your count — Qty Received','Tu conteo — Cant. Recibida')} ✏️</label>
          <input type="number" min="0"
            class="plt-qty-input plt-received-qty" data-po-id="${po.id}"
            value="${hasRecv?po.receivedQty:''}" placeholder="0"/>
        </div>
        <div class="plt-recv-field plt-extras-field">
          <label>${plt_t('vs Ordered','vs Ordenado')}</label>
          <div class="plt-extras-display" id="extrasDisplay_${po.id}">
            ${plt_extrasHtml(po)||'<span class="act-dim">—</span>'}
          </div>
        </div>
      </div>
      ${plt_fulfillmentBadge(po)?`<div style="margin-top:6px;">${plt_fulfillmentBadge(po)}</div>`:''}
      ${po.receivingNotes?`<p class="po-note">📝 ${plt_esc(po.receivingNotes)}</p>`:''}
    </div>
    <div class="po-card-actions">
      <label class="plt-check-label">
        <input type="checkbox" class="plt-recv-check" ${po.receivingDone?'checked':''}/>
        ${po.receivingDone
          ? `<span class="plt-done-label">✓ ${plt_t('Receiving count done','Conteo de recepción listo')}</span>`
          : plt_t('Mark receiving count done','Marcar conteo de recepción como listo')}
      </label>
      <button class="pallet-btn-ghost plt-tiny plt-po-edit">${plt_t('Notes','Notas')}</button>
      ${canTransfer?`<button class="pallet-btn-ghost plt-tiny plt-po-transfer">⇄ ${plt_t('Transfer','Transferir')}</button>`:''}
      <button class="pallet-btn-danger plt-tiny plt-po-delete">✕</button>
    </div>`;

  // ── PREP VIEW ─────────────────────────────────────────────────────────────
  // Receiving numbers are HIDDEN by default — Prep enters their own count first.
  // Overstock auto-calculated. Receiving count revealed only on demand.
  const overstockQty = plt_prepOverstockQty(po);
  const hasSts = plt_hasVal(po.stsQty);
  const hasLts = plt_hasVal(po.ltsQty);
  const prepRevealId = `prepReveal_${po.id}`;

  const prepView = `
    <!-- Identity strip — ordered qty always visible, counts hidden by default -->
    <div class="plt-recv-meta-strip">
      <span class="plt-recv-cat">📦 ${plt_esc(po.category)||'—'}</span>
      ${hasOrd
        ? `<span class="plt-ordered-badge">📋 ${plt_t('Ordered','Ordenado')}: <strong>${po.orderedQty}</strong></span>`
        : `<span class="plt-ordered-badge plt-ordered-missing">📋 ${plt_t('Ordered: not set','Ordenado: no ingresado')}</span>`}
      <button type="button" class="plt-reveal-toggle plt-prep-reveal-btn" data-target="${prepRevealId}">
        👁 ${plt_t('Show previous counts','Ver conteos anteriores')}
      </button>
    </div>

    <!-- Hidden reference block — receiving count + notes, shown on demand -->
    <div class="plt-prev-dept-block hidden" id="${prepRevealId}">
      <div class="plt-prev-dept-label">⚠️ ${plt_t('Previous dept numbers — enter your own count first, then compare.','Números de deptamento anterior — ingresa tu conteo primero, luego compara.')}</div>
      <div class="plt-ref-row">
        <span class="plt-ref-label">📋 ${plt_t('Ordered (Dock)','Ordenado (Muelle)')}</span>
        <span class="plt-ref-value">${hasOrd ? po.orderedQty : '—'}</span>
      </div>
      <div class="plt-ref-row">
        <span class="plt-ref-label">📦 ${plt_t('Receiving count','Conteo Recepción')}</span>
        <span class="plt-ref-value">${hasRecv ? po.receivedQty : '—'}</span>
      </div>
      <div class="plt-ref-row plt-overstock-auto">
        <span class="plt-ref-label">📤 ${plt_t('To Overstock (from Prep count)','A Exceso (desde Prep)')}</span>
        <span class="plt-ref-value">
          ${overstockQty!==null
            ? (overstockQty>0
                ? `<span class="plt-extras plt-extras-over">+${overstockQty} ${plt_t('units → Overstock','unidades → Exceso')}</span>`
                : `<span class="plt-extras plt-extras-exact">0 — ${plt_t('no extras','sin excedentes')}</span>`)
            : `<span class="act-dim">${plt_t('Enter Prep count first','Ingresa conteo de Prep primero')}</span>`}
        </span>
      </div>
      ${plt_fulfillmentBadge(po)?`<div style="margin:6px 0;">${plt_fulfillmentBadge(po)}</div>`:''}
    </div>

    <!-- Prep's own independent count -->
    <div class="plt-recv-entry" style="margin-top:8px;">
      <div class="plt-recv-inputs" style="grid-template-columns:1fr 1fr 1fr;">
        <div class="plt-recv-field">
          <label>${plt_t('Your count — Prep Count','Tu conteo — Conteo Prep')} ✏️</label>
          <input type="number" min="0" class="plt-qty-input plt-prep-qty" data-po-id="${po.id}"
            value="${hasPrep?po.prepReceivedQty:''}" placeholder="0"/>
        </div>
        <div class="plt-recv-field plt-extras-field">
          <label>${plt_t('Prep vs Receiving','Prep vs Recepción')}</label>
          <div class="plt-extras-display" id="prepDiscrepDisplay_${po.id}">
            ${plt_discrepancyHtml(po)||'<span class="act-dim">—</span>'}
          </div>
        </div>
        <div class="plt-recv-field plt-extras-field">
          <label>${plt_t('Prep vs Ordered / To Overstock','Prep vs Ordenado / A Exceso')}</label>
          <div class="plt-extras-display" id="prepOrderVarianceDisplay_${po.id}">
            ${plt_prepVsOrderedHtml(po)||'<span class="act-dim">—</span>'}
          </div>
        </div>
      </div>
    </div>

    <!-- Storage split -->
    <div class="plt-routing-split">
      <div class="plt-routing-split-title">
        ${plt_t('Storage routing — enter qty for each (can split between both):','Enrutamiento — cantidad para cada destino (puede dividirse):')}
      </div>
      <div class="plt-routing-split-row">
        <div class="plt-recv-field">
          <label>📦 ${plt_rl('sts')}</label>
          <input type="number" min="0" class="plt-qty-input plt-sts-qty" data-po-id="${po.id}"
            value="${hasSts?po.stsQty:''}" placeholder="0"/>
        </div>
        <div class="plt-recv-field">
          <label>🏭 ${plt_rl('lts')}</label>
          <input type="number" min="0" class="plt-qty-input plt-lts-qty" data-po-id="${po.id}"
            value="${hasLts?po.ltsQty:''}" placeholder="0"/>
        </div>
        <div class="plt-recv-field">
          <label>${plt_t('Storage total','Total almacenado')}</label>
          <div class="plt-extras-display" id="routedTotalDisplay_${po.id}">
            <span class="act-dim">—</span>
          </div>
        </div>
      </div>
    </div>

    <div class="po-card-actions" style="flex-wrap:wrap;gap:8px;margin-top:10px;">
      <label class="plt-check-label">
        <input type="checkbox" class="plt-prep-verify-check" ${po.prepVerified?'checked':''}/>
        ${po.prepVerified
          ? `<span class="plt-done-label">✓ ${plt_t('Prep count done','Conteo de prep listo')}</span>`
          : plt_t('Mark prep count done','Marcar conteo de prep como listo')}
      </label>
      <button class="pallet-btn-ghost plt-tiny plt-po-edit">${plt_t('Notes','Notas')}</button>
      ${canTransfer?`<button class="pallet-btn-ghost plt-tiny plt-po-transfer">⇄ ${plt_t('Transfer','Transferir')}</button>`:''}
      <button class="pallet-btn-danger plt-tiny plt-po-delete">✕</button>
    </div>
    ${po.prepNotes?`<p class="po-note">🔀 ${plt_esc(po.prepNotes)}</p>`:''}`;

  // ── READ-ONLY summary (done state or non-active dept) ─────────────────────
  const readonlyView = `
    <div class="po-card-grid">
      <div class="po-field"><label>${plt_t('Category','Categoría')}</label><span>${plt_esc(po.category)||'—'}</span></div>
      <div class="po-field"><label>${plt_t('Ordered','Ordenado')}</label><span>${hasOrd?po.orderedQty:'—'}</span></div>
      <div class="po-field"><label>${plt_t('Received','Recibido')}</label><span>${hasRecv?po.receivedQty:'—'}</span></div>
      <div class="po-field"><label>${plt_t('Prep Count','Prep')}</label><span>${hasPrep?po.prepReceivedQty:'—'}</span></div>
      ${po.destination?`<div class="po-field"><label>${plt_t('Destination','Destino')}</label><span>${plt_esc(plt_rl(po.destination))}</span></div>`:''}
    </div>
    ${plt_discrepancyHtml(po)?`<div style="margin:6px 0;">${plt_discrepancyHtml(po)}</div>`:''}
    ${(plt_hasVal(po.stsQty)||plt_hasVal(po.ltsQty))?`<div class="plt-recv-summary" style="margin-top:6px;">
      ${plt_hasVal(po.stsQty)?`<span class="plt-recv-pair"><span class="plt-recv-pair-label">📦 STS</span><strong>${po.stsQty}</strong></span>`:''}
      ${plt_hasVal(po.ltsQty)?`<span class="plt-recv-pair"><span class="plt-recv-pair-label">🏭 LTS</span><strong>${po.ltsQty}</strong></span>`:''}
      ${(plt_prepOverstockQty(po) && plt_prepOverstockQty(po)>0)?`<span class="plt-recv-pair"><span class="plt-recv-pair-label" style="color:#854d0e;">📤 Overstock</span><strong>+${plt_prepOverstockQty(po)}</strong></span>`:''}
    </div>`:''}
    ${plt_discrepancyHtml(po)?`<div style="margin:4px 0;">${plt_discrepancyHtml(po)}</div>`:''}
    ${plt_prepVsOrderedHtml(po)?`<div style="margin:4px 0;">${plt_prepVsOrderedHtml(po)}</div>`:''}
    ${po.receivingNotes?`<p class="po-note">📝 ${plt_esc(po.receivingNotes)}</p>`:''}
    ${po.prepNotes     ?`<p class="po-note">🔀 ${plt_esc(po.prepNotes)}</p>`:''}
    ${!isDone?`<div class="po-card-actions">
      <button class="pallet-btn-ghost plt-tiny plt-po-edit">${plt_t('Edit','Editar')}</button>
      ${canTransfer?`<button class="pallet-btn-ghost plt-tiny plt-po-transfer">⇄ ${plt_t('Transfer','Transferir')}</button>`:''}
      <button class="pallet-btn-danger plt-tiny plt-po-delete">✕</button>
    </div>`:`<div class="po-card-actions">
      <button class="pallet-btn-ghost plt-tiny plt-po-edit">${plt_t('View / Edit','Ver / Editar')}</button>
    </div>`}`;

  return `<div class="po-card" data-po-id="${po.id}">
    <div class="po-card-head">
      <span class="po-card-number">PO# ${plt_esc(po.po)}</span>
      <span class="po-card-status ${stCls}">${stLbl}</span>
    </div>
    ${isRecv ? recvView : isPrep ? prepView : isDock ? dockView : readonlyView}
  </div>`;
}

/* ------------------------------------------------------------------
   ADD PO FORM — available at all non-done stages
   ------------------------------------------------------------------ */
function plt_addPoFormHtml(catOpts){
  return`
    <div class="plt-add-po-section">
      <div class="plt-add-po-title">+ ${plt_t('Add a PO to this Pallet','Agregar OC a esta Tarima')}</div>
      <div class="po-add-form" id="plt_addPoForm">

        <div class="plt-add-po-row plt-add-po-row-top">
          <div class="pallet-form-field plt-add-po-field-po">
            <label>${plt_t('PO Number','Número de OC')} *</label>
            <input id="plt_newPo" type="text" placeholder="${plt_t('e.g. 265923','Ej. 265923')}" autocomplete="off"/>
          </div>
          <div class="pallet-form-field plt-add-po-field-num">
            <label>${plt_t('Ordered Qty','Cant. Ordenada')} *</label>
            <input id="plt_newOrderedQty" type="number" min="0" placeholder="0"/>
          </div>
          <div class="pallet-form-field plt-add-po-field-num">
            <label>${plt_t('Boxes','Cajas')}</label>
            <input id="plt_newBoxes" type="number" min="0" placeholder="0"/>
          </div>
        </div>

        <div class="plt-add-po-row">
          <div class="pallet-form-field" style="flex:1;min-width:160px;">
            <label>${plt_t('Category','Categoría')} *</label>
            <select id="plt_newCat">
              <option value="">${plt_t('— Select —','— Seleccionar —')}</option>
              ${catOpts}
            </select>
          </div>
          <div class="pallet-form-field" style="flex:2;min-width:180px;">
            <label>${plt_t('Notes (optional)','Notas (opcional)')}</label>
            <input id="plt_newDockNotes" type="text" placeholder="${plt_t('Any notes about this PO…','Notas sobre esta OC…')}"/>
          </div>
        </div>

        <!-- Apparel size breakdown — shown when Apparel is selected -->
        <div id="plt_apparelSizesPanel" style="display:none;" class="plt-apparel-sizes-panel">
          <div class="plt-apparel-sizes-title">👕 ${plt_t('Size Breakdown (optional)','Desglose por Talla (opcional)')}</div>
          <div class="plt-apparel-sizes-grid">
            ${['XS','S','M','L','XL','2XL','3XL'].map(sz=>`
              <div class="plt-size-field">
                <label>${sz}</label>
                <input type="number" min="0" class="plt-size-input" data-size="${sz}" placeholder="0"/>
              </div>`).join('')}
          </div>
          <div id="plt_sizeTotal" class="plt-size-total-hint"></div>
        </div>

        <button class="pallet-btn-primary" id="plt_saveNewPo" type="button">
          + ${plt_t('Add PO','Agregar OC')}
        </button>

      </div>
    </div>`;
}

function plt_bindAddPoForm(formEl,palletId,dept){
  const poInput   = formEl.querySelector('#plt_newPo');
  const qtyInput  = formEl.querySelector('#plt_newOrderedQty');
  const boxInput  = formEl.querySelector('#plt_newBoxes');
  const catSelect = formEl.querySelector('#plt_newCat');
  const notesInput= formEl.querySelector('#plt_newDockNotes');
  const apparelPanel = formEl.querySelector('#plt_apparelSizesPanel');
  const sizeTotalEl  = formEl.querySelector('#plt_sizeTotal');

  // ── #7 Show apparel size panel when Apparel is selected ──────────────
  function updateApparelPanel() {
    if (!apparelPanel) return;
    const isApparel = (catSelect?.value || '').toLowerCase() === 'apparel';
    apparelPanel.style.display = isApparel ? '' : 'none';
  }
  function updateSizeTotals() {
    if (!sizeTotalEl) return;
    const total = [...(formEl.querySelectorAll('.plt-size-input') || [])].reduce((s,el)=>s+Number(el.value||0),0);
    const ordQty = Number(qtyInput?.value || 0);
    if (!total) { sizeTotalEl.textContent=''; return; }
    if (ordQty && total !== ordQty) {
      sizeTotalEl.style.color='#dc2626';
      sizeTotalEl.textContent=`${plt_t('Size total','Total tallas')}: ${total} — ${plt_t('does not match Ordered Qty','no coincide con Cant. Ordenada')} (${ordQty})`;
    } else {
      sizeTotalEl.style.color='#059669';
      sizeTotalEl.textContent=`${plt_t('Size total','Total tallas')}: ${total} ✓`;
    }
  }
  if (catSelect) catSelect.addEventListener('change', updateApparelPanel);
  formEl.querySelectorAll('.plt-size-input').forEach(el => el.addEventListener('input', updateSizeTotals));
  if (qtyInput) qtyInput.addEventListener('input', updateSizeTotals);

  // ── Prior-receipt lookup — fires when the PO number field loses focus ──
  // Shows a banner if this PO number was received before on another pallet.
  poInput?.addEventListener('blur', ()=>{
    const poNum = poInput.value.trim();
    // Remove any existing banner
    formEl.querySelector('.plt-prior-receipt-banner')?.remove();
    if(!poNum) return;

    const info = plt_findPriorReceipts(poNum, palletId);
    if(!info) return; // no prior receipts — nothing to show

    // Insert banner above the Save button
    const banner = document.createElement('div');
    banner.innerHTML = plt_priorReceiptBannerHtml(info, poNum);
    const saveBtn = formEl.querySelector('#plt_saveNewPo');
    formEl.insertBefore(banner.firstElementChild, saveBtn);

    // Lock ordered qty — it was established on the first pallet and cannot change
    if(plt_hasVal(info.canonicalOrdered)){
      qtyInput.value = info.canonicalOrdered;
      qtyInput.readOnly = true;
      qtyInput.classList.add('plt-qty-locked');
      qtyInput.title = plt_t(
        'Locked — ordered quantity set on the original pallet and cannot be changed here.',
        'Bloqueado — la cantidad ordenada se estableció en la tarima original y no puede cambiarse aquí.'
      );
    }

    // Pre-fill category if empty and consistent across prior receipts
    if(!catSelect.value){
      const cats = [...new Set(info.hits.map(h=>h.category).filter(Boolean))];
      if(cats.length===1) catSelect.value = cats[0];
    }
  });

  // NOTE: no input listener to clear the lock — once locked it stays locked for this session

  // Allow Enter on last visible input to submit
  [poInput, qtyInput, boxInput, notesInput].forEach(el=>{
    el?.addEventListener('keydown', e=>{ if(e.key==='Enter') formEl.querySelector('#plt_saveNewPo')?.click(); });
  });

  formEl.querySelector('#plt_saveNewPo')?.addEventListener('click',()=>{
    const po         = poInput?.value.trim();
    const orderedQty = qtyInput?.value;
    const boxes      = boxInput?.value;
    const category   = catSelect?.value;
    const dockNotes  = notesInput?.value.trim()||'';

    // Validation
    if(!po){
      poInput.style.borderColor='#dc2626'; poInput.focus(); return;
    }
    if(orderedQty===''||orderedQty===null||orderedQty===undefined){
      qtyInput.style.borderColor='#dc2626'; qtyInput.focus(); return;
    }
    if(!category){
      catSelect.style.borderColor='#dc2626'; catSelect.focus(); return;
    }

    // Reset borders
    [poInput,qtyInput,catSelect].forEach(el=>{ if(el) el.style.borderColor=''; });

    const priorInfo = plt_findPriorReceipts(po, palletId);
    // If prior receipts exist, enforce the canonical ordered qty regardless of what the field says
    const finalOrderedQty = (priorInfo && plt_hasVal(priorInfo.canonicalOrdered))
      ? priorInfo.canonicalOrdered
      : orderedQty;

    // Collect size breakdown if Apparel
    const sizeBreakdown = {};
    let hasSizes = false;
    formEl.querySelectorAll('.plt-size-input').forEach(el => {
      const v = Number(el.value || 0);
      if (v > 0) { sizeBreakdown[el.dataset.size] = v; hasSizes = true; }
    });

    plt_addPo(palletId, {po, orderedQty: finalOrderedQty, boxes, category, dockNotes, hasPriorReceipts: !!priorInfo, priorReceiptCount: priorInfo?.hits?.length||0, priorTotalReceived: priorInfo?.totalReceived||0, sizeBreakdown: hasSizes ? sizeBreakdown : undefined});

    // Clear form for fast multi-entry
    poInput.value=''; qtyInput.value=''; if(boxInput) boxInput.value='';
    catSelect.value=''; if(notesInput) notesInput.value='';
    formEl.querySelectorAll('.plt-size-input').forEach(el=>el.value='');
    if(apparelPanel) apparelPanel.style.display='none';
    if(sizeTotalEl) sizeTotalEl.textContent='';
    poInput.focus();

    // Re-render the PO list in place without closing the modal
    const pallet = plt_get(palletId);
    if(!pallet) return;
    const poListEl = document.getElementById('plt_poList');
    if(poListEl){
      const otherPallets=plt_all().filter(p=>p.id!==palletId&&p.status!=='done');
      poListEl.innerHTML = pallet.pos.length===0
        ? `<div class="pallet-empty">${plt_t('No POs yet.','Sin OCs.')}</div>`
        : pallet.pos.map(po=>plt_poCardHtml(pallet,po,dept,otherPallets)).join('');
      // Re-bind the new cards
      plt_bindPoCardEvents(document.getElementById('plt_poList'), pallet, dept);
    }
    plt_renderAllPanels();
  });
}

/* Bind PO card events — extracted so we can re-bind after live list refresh */
function plt_bindPoCardEvents(container, pallet, dept){
  if(!container) return;
  container.querySelectorAll('.po-card[data-po-id]').forEach(card=>{
    const poId=card.dataset.poId;
    card.querySelector('.plt-po-edit')?.addEventListener('click',()=>plt_openPoEditModal(pallet.id,poId,dept));
    card.querySelector('.plt-po-delete')?.addEventListener('click',()=>{
      if(window.confirm(plt_t('Remove this PO?','¿Eliminar esta OC?'))){
        plt_deletePo(pallet.id,poId);
        const p=plt_get(pallet.id);
        if(!p) return plt_closeAll(),plt_renderAllPanels();
        container.innerHTML = p.pos.length===0
          ? `<div class="pallet-empty">${plt_t('No POs yet.','Sin OCs.')}</div>`
          : p.pos.map(po=>plt_poCardHtml(p,po,dept,plt_all().filter(x=>x.id!==p.id&&x.status!=='done'))).join('');
        plt_bindPoCardEvents(container, p, dept);
        plt_renderAllPanels();
      }
    });
    card.querySelector('.plt-po-transfer')?.addEventListener('click',()=>plt_openTransferModal(pallet.id,poId,dept));
    card.querySelector('.plt-recv-check')?.addEventListener('change',e=>{
      plt_updatePo(pallet.id,poId,{receivingDone:e.target.checked});
      plt_renderAllPanels();
    });

    // ── Reveal toggles — show/hide previous dept numbers (default: hidden) ──
    card.querySelectorAll('.plt-reveal-toggle[data-target]').forEach(btn=>{
      btn.addEventListener('click',()=>{
        const panel = card.querySelector('#'+btn.dataset.target);
        if(!panel) return;
        const hidden = panel.classList.toggle('hidden');
        btn.textContent = hidden
          ? '👁 '+(btn.classList.contains('plt-recv-reveal-btn')
              ? plt_t('Show dock numbers','Ver números del muelle')
              : plt_t('Show previous counts','Ver conteos anteriores'))
          : '🙈 '+(btn.classList.contains('plt-recv-reveal-btn')
              ? plt_t('Hide dock numbers','Ocultar números del muelle')
              : plt_t('Hide previous counts','Ocultar conteos anteriores'));
      });
    });

    // ── Prep verify checkbox ──
    card.querySelector('.plt-prep-verify-check')?.addEventListener('change',e=>{
      plt_updatePo(pallet.id,poId,{prepVerified:e.target.checked});
      plt_renderAllPanels();
    });
    // Inline receiving qty inputs
    const ordInput  = card.querySelector('.plt-ordered-qty');
    const recvInput = card.querySelector('.plt-received-qty');
    const extrasEl  = card.querySelector('.plt-extras-display');
    function recalc(){
      if(!extrasEl) return;
      const oVal=ordInput?ordInput.value:''; const rVal=recvInput?recvInput.value:'';
      if(oVal===''||rVal===''){extrasEl.innerHTML='<span class="act-dim">—</span>';return;}
      const diff=Number(rVal)-Number(oVal);
      if(diff>0) extrasEl.innerHTML=`<span class="plt-extras plt-extras-over">+${diff} ${plt_t('extras → Overstock','extra → Exceso')}</span>`;
      else if(diff<0) extrasEl.innerHTML=`<span class="plt-extras plt-extras-short">${diff} ${plt_t('short','faltante')}</span>`;
      else extrasEl.innerHTML=`<span class="plt-extras plt-extras-exact">✓ ${plt_t('Exact','Exacto')}</span>`;
    }
    if(ordInput)  ordInput.addEventListener('input',recalc);
    if(recvInput) recvInput.addEventListener('input',recalc);
    function saveQty(){
      const po=(plt_get(pallet.id)?.pos||[]).find(r=>r.id===poId); if(!po) return;
      const nextFields = {};
      const oVal = ordInput
        ? (ordInput.value !== '' ? Number(ordInput.value) : null)
        : po.orderedQty;
      const rVal = recvInput
        ? (recvInput.value !== '' ? Number(recvInput.value) : null)
        : po.receivedQty;

      if (ordInput && oVal !== po.orderedQty) nextFields.orderedQty = oVal;
      if (recvInput && rVal !== po.receivedQty) nextFields.receivedQty = rVal;
      if (!Object.keys(nextFields).length) return;

      plt_updatePo(pallet.id, poId, nextFields);
      plt_renderAllPanels();
    }
    if(ordInput)  ordInput.addEventListener('blur',saveQty);
    if(recvInput) recvInput.addEventListener('blur',saveQty);
    // Dock toggle
    const dockToggle=card.querySelector('.plt-dock-toggle');
    if(dockToggle){
      dockToggle.addEventListener('click',()=>{
        const panel=card.querySelector('#'+dockToggle.dataset.target);
        if(!panel) return;
        const hidden=panel.classList.toggle('hidden');
        dockToggle.textContent=hidden
          ?'▾ '+plt_t('Show dock values','Ver valores del muelle')
          :'▴ '+plt_t('Hide dock values','Ocultar valores del muelle');
      });
    }
    // Routing chips (legacy — kept for compat)
    card.querySelectorAll('.routing-chip[data-dest]').forEach(chip=>{
      chip.addEventListener('click',()=>{
        const dest=chip.dataset.dest;
        const po=(plt_get(pallet.id)?.pos||[]).find(r=>r.id===poId);
        const newDest=(po&&po.destination===dest)?'':dest;
        plt_updatePo(pallet.id,poId,{destination:newDest});
        plt_closeAll(); plt_buildPalletModal(plt_get(pallet.id),dept); plt_renderAllPanels();
      });
    });

    // ── STS / LTS qty inputs (Prep tab) ────────────────────────────────────
    const stsInput   = card.querySelector('.plt-sts-qty');
    const ltsInput   = card.querySelector('.plt-lts-qty');
    const routedDisp = card.querySelector(`#routedTotalDisplay_${poId}`);

    function plt_recalcRouted(){
      if(!routedDisp) return;
      const sts  = stsInput  && stsInput.value!==''  ? Number(stsInput.value)  : 0;
      const lts  = ltsInput  && ltsInput.value!==''  ? Number(ltsInput.value)  : 0;
      const total = sts + lts;
      // Get the PO to compute overstock
      const po = (plt_get(pallet.id)?.pos||[]).find(r=>r.id===poId);
      if(!po || (!stsInput?.value && !ltsInput?.value)) {
        routedDisp.innerHTML='<span class="act-dim">—</span>'; return;
      }
      const prepCount = plt_hasVal(po.prepReceivedQty) ? Number(po.prepReceivedQty) : null;
      const ordered = plt_hasVal(po.orderedQty) ? Number(po.orderedQty) : null;
      const over = prepCount!==null && ordered!==null ? Math.max(0, prepCount-ordered) : 0;
      const expected = prepCount!==null ? prepCount - over : null; // units to route after true prep extras
      if(expected!==null && total===expected)
        routedDisp.innerHTML=`<span class="plt-extras plt-extras-exact">✓ ${total}</span>`;
      else if(expected!==null && total>expected)
        routedDisp.innerHTML=`<span class="plt-extras plt-extras-over">${total} (+${total-expected})</span>`;
      else if(expected!==null && total<expected)
        routedDisp.innerHTML=`<span class="plt-extras plt-extras-short">${total} (${total-expected})</span>`;
      else
        routedDisp.innerHTML=`<strong>${total}</strong>`;
    }

    if(stsInput) stsInput.addEventListener('input', plt_recalcRouted);
    if(ltsInput) ltsInput.addEventListener('input', plt_recalcRouted);

    function plt_saveRouting(){
      const po=(plt_get(pallet.id)?.pos||[]).find(r=>r.id===poId); if(!po) return;
      const sVal = stsInput&&stsInput.value!=='' ? Number(stsInput.value) : null;
      const lVal = ltsInput&&ltsInput.value!=='' ? Number(ltsInput.value) : null;
      if(sVal===po.stsQty && lVal===po.ltsQty) return;
      plt_updatePo(pallet.id, poId, {stsQty:sVal, ltsQty:lVal});
      plt_renderAllPanels();
    }

    if(stsInput) stsInput.addEventListener('blur', plt_saveRouting);
    if(ltsInput) ltsInput.addEventListener('blur', plt_saveRouting);

    // Kick off display if values already set
    plt_recalcRouted();
  });
}

/* ------------------------------------------------------------------
   ROUTING SUMMARY
   ------------------------------------------------------------------ */
function plt_routingSummaryHtml(pallet){
  const pos=pallet.pos||[];
  // Tally units by destination
  let totSts=0, totLts=0, totOverstock=0, posNeedingRouting=0;
  pos.forEach(po=>{
    const recv   = plt_hasVal(po.receivedQty) ? Number(po.receivedQty) : 0;
    const ord    = plt_hasVal(po.orderedQty)  ? Number(po.orderedQty)  : 0;
    const over   = Math.max(0, recv - ord);
    const sts    = plt_hasVal(po.stsQty) ? Number(po.stsQty) : 0;
    const lts    = plt_hasVal(po.ltsQty) ? Number(po.ltsQty) : 0;
    totOverstock += over;
    totSts       += sts;
    totLts       += lts;
    // A PO still needs routing if recv>0 and neither STS nor LTS is set
    if(recv>0 && !sts && !lts && (recv-over)>0) posNeedingRouting++;
  });
  const allRouted = posNeedingRouting===0 && pos.length>0;
  return`<div class="pallet-section-title">${plt_t('Routing Summary','Resumen de Enrutamiento')}</div>
    <div class="pallet-routing-summary">
      <div class="pallet-routing-summary-row">
        <span>📦 ${plt_rl('sts')}</span>
        <strong>${totSts} ${plt_t('units','unidades')}</strong>
      </div>
      <div class="pallet-routing-summary-row">
        <span>🏭 ${plt_rl('lts')}</span>
        <strong>${totLts} ${plt_t('units','unidades')}</strong>
      </div>
      <div class="pallet-routing-summary-row" style="background:#fef9c3;border-radius:6px;padding:4px 8px;">
        <span>📤 ${plt_rl('overstock')} <em style="font-size:0.7rem;font-weight:400;">${plt_t('(auto-calculated)','(calculado automáticamente)')}</em></span>
        <strong>${totOverstock} ${plt_t('units','unidades')}</strong>
      </div>
      ${!allRouted&&pos.length>0?`<div class="pallet-routing-summary-row" style="color:#92400e;background:#fef3c7;border-radius:6px;padding:4px 8px;">
        <span>⚠️ ${plt_t('Some POs still need STS/LTS routing','Algunas OCs aún necesitan enrutamiento')}</span>
        <strong>${posNeedingRouting}</strong>
      </div>`:`<div class="pallet-routing-summary-row" style="color:#166534;">✓ ${plt_t('All POs have routing set','Todas las OCs tienen destino asignado')}</div>`}
    </div>`;
}

/* ------------------------------------------------------------------
   EVENT LOG HTML
   ------------------------------------------------------------------ */
function plt_eventLogHtml(pallet){
  const events=[...(pallet.events||[])].reverse();
  if(!events.length)return`<div class="act-dim" style="padding:8px 0;">${plt_t('No history yet.','Sin historial aún.')}</div>`;
  return`<div class="act-timeline">${events.map(ev=>`<div class="act-event">
    <span class="act-event-time">${plt_fmtDT(ev.ts)}</span>
    <span class="act-event-dot"></span>
    <span class="act-event-label">${plt_esc(plt_el(ev.type))}${ev.detail?` — <em>${plt_esc(ev.detail)}</em>`:''}</span>
    <span class="act-event-by">${plt_esc(ev.by||'—')}</span>
  </div>`).join('')}</div>`;
}

/* ------------------------------------------------------------------
   EDIT PO MODAL — all fields always editable
   ------------------------------------------------------------------ */
function plt_openPoEditModal(palletId,poId,dept){
  const pallet=plt_get(palletId); if(!pallet)return;
  const po=(pallet.pos||[]).find(r=>r.id===poId); if(!po)return;
  plt_closeAll();
  const catOpts=plt_cats().map(c=>`<option value="${plt_esc(c)}" ${c===po.category?'selected':''}>${plt_esc(c)}</option>`).join('');
  const overlay=plt_overlay('palletPoEditOverlay');
  overlay.innerHTML=`
    <div class="pallet-modal" style="max-width:500px;" role="dialog" aria-modal="true">
      <div class="pallet-modal-header">
        <div><h3>${plt_t('Edit PO','Editar OC')} — ${plt_esc(po.po)}</h3><p class="pallet-modal-sub">${plt_esc(pallet.label)}</p></div>
        <button class="pallet-modal-close">✕</button>
      </div>
      <div class="pallet-modal-body">
        <div class="pallet-form-row"><div class="pallet-form-field" style="flex:1;"><label>${plt_t('PO Number','Número de OC')}</label><input id="plt_ePo" type="text" value="${plt_esc(po.po)}"/></div></div>
        <div class="pallet-form-row">
          <div class="pallet-form-field"><label>${plt_t('Ordered Qty','Cant. Ordenada')}</label><input id="plt_eOrderedQty" type="number" min="0" value="${plt_hasVal(po.orderedQty)?po.orderedQty:''}" placeholder="0"/></div>
          <div class="pallet-form-field"><label>${plt_t('Boxes','Cajas')}</label><input id="plt_eBoxes" type="number" min="0" value="${plt_hasVal(po.boxes)?po.boxes:''}" placeholder="0"/></div>
        </div>
        <div class="pallet-form-row"><div class="pallet-form-field" style="flex:1;"><label>${plt_t('Category','Categoría')}</label>
          <select id="plt_eCat"><option value="">${plt_t('— Select —','— Seleccionar —')}</option>${catOpts}</select>
        </div></div>
        <div class="pallet-form-row"><div class="pallet-form-field" style="flex:1;min-width:100%;"><label>${plt_t('Dock Notes','Notas del Muelle')}</label>
          <input id="plt_eDockNotes" type="text" value="${plt_esc(po.dockNotes||'')}" placeholder="${plt_t('Optional…','Opcional…')}"/></div></div>
        <div class="pallet-form-row"><div class="pallet-form-field" style="flex:1;min-width:100%;"><label>${plt_t('Receiving Notes','Notas de Recepción')}</label>
          <input id="plt_eRecvNotes" type="text" value="${plt_esc(po.receivingNotes||'')}" placeholder="${plt_t('Optional…','Opcional…')}"/></div></div>
        <div class="pallet-form-row"><div class="pallet-form-field" style="flex:1;min-width:100%;"><label>${plt_t('Prep Notes','Notas de Prep')}</label>
          <input id="plt_ePrepNotes" type="text" value="${plt_esc(po.prepNotes||'')}" placeholder="${plt_t('Optional…','Opcional…')}"/></div></div>
      </div>
      <div class="pallet-modal-footer">
        <button class="pallet-btn-secondary" id="plt_eCancel">${plt_t('Cancel','Cancelar')}</button>
        <button class="pallet-btn-primary"   id="plt_eSave">${plt_t('Save Changes','Guardar Cambios')}</button>
      </div>
    </div>`;
  plt_push(overlay);
  const goBack=()=>{plt_closeAll();plt_buildPalletModal(plt_get(palletId),dept);};
  overlay.querySelector('.pallet-modal-close').addEventListener('click',goBack);
  overlay.querySelector('#plt_eCancel').addEventListener('click',goBack);
  overlay.addEventListener('click',e=>{if(e.target===overlay)goBack();});
  overlay.querySelector('#plt_eSave').addEventListener('click',()=>{
    const eOrdQty = overlay.querySelector('#plt_eOrderedQty')?.value;
    const eBoxes  = overlay.querySelector('#plt_eBoxes')?.value;
    const updates={
      po:        overlay.querySelector('#plt_ePo')?.value.trim()||po.po,
      orderedQty: eOrdQty!==''&&eOrdQty!=null ? Number(eOrdQty) : po.orderedQty,
      boxes:      eBoxes!==''&&eBoxes!=null    ? Number(eBoxes)  : po.boxes,
      category:      overlay.querySelector('#plt_eCat')?.value||po.category,
      dockNotes:     overlay.querySelector('#plt_eDockNotes')?.value.trim()||'',
      receivingNotes:overlay.querySelector('#plt_eRecvNotes')?.value.trim()||'',
      prepNotes:     overlay.querySelector('#plt_ePrepNotes')?.value.trim()||'',
    };
    plt_updatePo(palletId,poId,updates);
    plt_renderAllPanels(); goBack();
  });
}

/* ------------------------------------------------------------------
   TRANSFER PO MODAL
   ------------------------------------------------------------------ */
function plt_openTransferModal(fromPalletId,poId,dept){
  const from=plt_get(fromPalletId); if(!from)return;
  const po=(from.pos||[]).find(r=>r.id===poId); if(!po)return;
  const others=plt_all().filter(p=>p.id!==fromPalletId&&p.status!=='done');
  plt_closeAll();
  if(!others.length){
    showToast(plt_t('No other pallets available to transfer to.','No hay otras tarimas disponibles.'), 'error');
    plt_buildPalletModal(plt_get(fromPalletId),dept); return;
  }
  const palletOpts=others.map(p=>`<option value="${p.id}">${plt_esc(p.label)} — ${plt_esc(plt_sl(p.status))}</option>`).join('');
  const overlay=plt_overlay('palletTransferOverlay');
  overlay.innerHTML=`
    <div class="pallet-modal" style="max-width:440px;" role="dialog" aria-modal="true">
      <div class="pallet-modal-header">
        <div><h3>⇄ ${plt_t('Transfer PO','Transferir OC')}</h3>
          <p class="pallet-modal-sub">PO# ${plt_esc(po.po)} ${plt_t('from','desde')} <strong>${plt_esc(from.label)}</strong></p></div>
        <button class="pallet-modal-close">✕</button>
      </div>
      <div class="pallet-modal-body">
        <div class="plt-transfer-info">
          <div class="plt-transfer-detail"><span>${plt_t('PO','OC')}:</span><strong>${plt_esc(po.po)}</strong></div>
          <div class="plt-transfer-detail"><span>${plt_t('Boxes','Cajas')}:</span><strong>${po.boxes||'—'}</strong></div>
          <div class="plt-transfer-detail"><span>${plt_t('Units','Unidades')}:</span><strong>${po.units||'—'}</strong></div>
          <div class="plt-transfer-detail"><span>${plt_t('Category','Categoría')}:</span><strong>${plt_esc(po.category)||'—'}</strong></div>
        </div>
        <div class="pallet-form-field" style="margin-top:16px;">
          <label>${plt_t('Transfer to pallet:','Transferir a tarima:')}</label>
          <select id="plt_transferTarget" style="width:100%;">${palletOpts}</select>
        </div>
        <p class="plt-transfer-note">⚠️ ${plt_t('The PO will move out of this pallet immediately.','La OC saldrá de esta tarima de inmediato.')}</p>
      </div>
      <div class="pallet-modal-footer">
        <button class="pallet-btn-secondary" id="plt_tCancel">${plt_t('Cancel','Cancelar')}</button>
        <button class="pallet-btn-primary"   id="plt_tConfirm">${plt_t('Transfer PO','Transferir OC')}</button>
      </div>
    </div>`;
  plt_push(overlay);
  const goBack=()=>{plt_closeAll();plt_buildPalletModal(plt_get(fromPalletId),dept);};
  overlay.querySelector('.pallet-modal-close').addEventListener('click',goBack);
  overlay.querySelector('#plt_tCancel').addEventListener('click',goBack);
  overlay.addEventListener('click',e=>{if(e.target===overlay)goBack();});
  overlay.querySelector('#plt_tConfirm').addEventListener('click',()=>{
    const targetId=overlay.querySelector('#plt_transferTarget').value;
    if(plt_transferPo(fromPalletId,poId,targetId)){
      plt_renderAllPanels(); plt_closeAll(); plt_buildPalletModal(plt_get(fromPalletId),dept);
    }
  });
}

/* ------------------------------------------------------------------
   RENDER ALL
   ------------------------------------------------------------------ */
function plt_renderAllPanels(){
  plt_renderDockPanel();
  plt_renderReceivingPanel();
  plt_renderPrepPanel();
  plt_renderAllActivity();
  if(typeof renderStats==='function') renderStats();
}

/* ------------------------------------------------------------------
   INIT
   ------------------------------------------------------------------ */
function plt_init(){
  if(typeof state!=='undefined'&&!Array.isArray(state.data.pallets))state.data.pallets=[];
  plt_renderAllPanels();
  window.addEventListener('qa-workflow-data-changed',()=>plt_renderAllPanels());
}

if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',plt_init);
else setTimeout(plt_init,0);
