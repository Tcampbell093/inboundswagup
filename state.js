// Shared state for queue + assembly modules.
// Owns the storage keys, normalize/save helpers, and the mutable row arrays
// previously declared in script.js. Loaded after storage.js, before queue.js.

const assemblyBoardStorageKey="ops_hub_assembly_board_v2";
const queueStorageKey="ops_hub_available_queue_v1";
const scheduledQueueStorageKey="ops_hub_scheduled_queue_v1";
const incompleteQueueStorageKey="ops_hub_incomplete_queue_v1";
const revenueReferenceStorageKey="ops_hub_revenue_reference_v1";

function inferLegacyStage(item){if(item.done) return 'done'; if(item.dpmo) return 'dpmo'; if(item.line) return 'line'; if(item.picked) return 'picked'; if(item.print) return 'print'; return 'aa';}
function normalizeAssemblyBoardRows(list){return(list||[]).map(item=>({id:item.id||Date.now()+Math.random(),date:item.date||new Date().toISOString().slice(0,10),pb:String(item.pb||'').trim(),so:String(item.so||'').trim(),account:String(item.account||'').trim(),qty:Number(item.qty||0),products:Number(item.products||0),status:String(item.status||'').trim(),ihd:item.ihd||'',subtotal:Number(item.subtotal||0),stage:String(item.stage||inferLegacyStage(item)||'aa').trim(),rescheduleNote:String(item.rescheduleNote||'').trim(),pbId:String(item.pbId||'').trim(),pdfUrl:String(item.pdfUrl||'').trim(),workType:String(item.workType||'pack_builder').trim(),externalLink:String(item.externalLink||'').trim(),isPartial:!!item.isPartial,fullQty:Number(item.fullQty||item.qty||0),accountOwner:String(item.accountOwner||'').trim(),sourceQueue:String(item.sourceQueue||'').trim(),sourceStatus:String(item.sourceStatus||item.status||'').trim()}))}
function normalizeQueueRows(list){return(list||[]).map(item=>({id:item.id||Date.now()+Math.random(),priority:!!item.priority,pb:String(item.pb||'').trim(),pbId:String(item.pbId||'').trim(),so:String(item.so||'').trim(),account:String(item.account||'').trim(),qty:Number(item.qty||0),products:Number(item.products||0),units:Number(item.units||0),ihd:String(item.ihd||'').trim(),accountOwner:String(item.accountOwner||'').trim(),pdfUrl:String(item.pdfUrl||'').trim(),status:String(item.status||'').trim(),subtotal:Number(item.subtotal||item.revenue||0),revenue:Number(item.revenue||item.subtotal||0)}))}
function normalizeScheduledQueueRows(list){return(list||[]).map(item=>({id:item.id||Date.now()+Math.random(),priority:!!item.priority,pb:String(item.pb||'').trim(),pbId:String(item.pbId||'').trim(),so:String(item.so||'').trim(),account:String(item.account||'').trim(),qty:Number(item.qty||0),products:Number(item.products||0),units:Number(item.units||0),ihd:String(item.ihd||'').trim(),accountOwner:String(item.accountOwner||'').trim(),pdfUrl:String(item.pdfUrl||'').trim(),scheduledFor:String(item.scheduledFor||'').trim(),scheduledAt:String(item.scheduledAt||'').trim(),scheduleNote:String(item.scheduleNote||'').trim(),status:String(item.status||'').trim(),subtotal:Number(item.subtotal||item.revenue||0),revenue:Number(item.revenue||item.subtotal||0),sourceQueue:String(item.sourceQueue||'ready').trim(),sourceStatus:String(item.sourceStatus||item.status||'').trim()}))}
function normalizeRevenueReferenceRows(list){return(list||[]).map(item=>({id:item.id||Date.now()+Math.random(),salesOrder:String(item.salesOrder||'').trim(),originalSubtotal:Number(item.originalSubtotal||0),ihd:String(item.ihd||'').trim(),account:String(item.account||'').trim()})).filter(item=>item.salesOrder)}

let assemblyBoardRows=normalizeAssemblyBoardRows(loadJson(assemblyBoardStorageKey,[]));
let availableQueueRows=normalizeQueueRows(loadJson(queueStorageKey,[]));
let scheduledQueueRows=normalizeScheduledQueueRows(loadJson(scheduledQueueStorageKey,[]));
let incompleteQueueRows=normalizeQueueRows(loadJson(incompleteQueueStorageKey,[]));
let queueRawRowCount=0;
let revenueReferenceRows=normalizeRevenueReferenceRows(loadJson(revenueReferenceStorageKey,[]));

function setAssemblyBoardRows(next){assemblyBoardRows=next;}
function setAvailableQueueRows(next){availableQueueRows=next;}
function setScheduledQueueRows(next){scheduledQueueRows=next;}
function setIncompleteQueueRows(next){incompleteQueueRows=next;}
function setQueueRawRowCount(next){queueRawRowCount=next;}
function setRevenueReferenceRows(next){revenueReferenceRows=next;}

function prependAssemblyBoardRow(row){assemblyBoardRows.unshift(row);}
function prependScheduledQueueRow(row){scheduledQueueRows.unshift(row);}

function saveRevenueReference(){saveJson(revenueReferenceStorageKey,revenueReferenceRows)}
function saveQueue(){saveJson(queueStorageKey,availableQueueRows)}
function saveScheduledQueue(){saveJson(scheduledQueueStorageKey,scheduledQueueRows)}
function saveIncompleteQueue(){saveJson(incompleteQueueStorageKey,incompleteQueueRows)}
