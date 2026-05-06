function loadJson(key,fallback){try{const raw=localStorage.getItem(key);return raw?JSON.parse(raw):fallback}catch{return fallback}}
function saveJson(key,value){
  localStorage.setItem(key,JSON.stringify(value));
  if(assemblySyncKeys.has(key)) scheduleAssemblySync();
}
function scheduleAssemblySync(){
  if(!assemblySyncEnabled||!assemblySyncLoaded) return;
  if(assemblySyncTimer) clearTimeout(assemblySyncTimer);
  assemblySyncTimer=setTimeout(()=>{assemblySyncTimer=null;syncAssemblyState();},250);
}
async function assemblyApiRequest(method='GET',body){
  const options={method,headers:{'Accept':'application/json'}};
  if(body!==undefined){options.headers['Content-Type']='application/json';options.body=JSON.stringify(body);}
  const response=await fetch(assemblyApiBase,options);
  const raw=await response.text();
  let data={};
  try{data=raw?JSON.parse(raw):{}}catch{data={raw}}
  if(!response.ok) throw new Error(data?.error||`Assembly sync failed (${response.status})`);
  return data;
}
function buildAssemblySyncPayload(){
  let queueImportMeta = null;
  let revenueImportMeta = null;
  try { queueImportMeta   = JSON.parse(localStorage.getItem('ops_hub_queue_import_meta_v1')   || 'null'); } catch(_) {}
  try { revenueImportMeta = JSON.parse(localStorage.getItem('ops_hub_revenue_import_meta_v1') || 'null'); } catch(_) {}
  return {
    board:assemblyBoardRows,
    available:availableQueueRows,
    scheduled:scheduledQueueRows,
    incomplete:incompleteQueueRows,
    held: typeof window.getIssueHoldQueueRows === 'function' ? window.getIssueHoldQueueRows() : [],
    revenue:revenueReferenceRows,
    queueImportMeta,
    revenueImportMeta
  };
}
function applyAssemblySyncPayload(payload={}){
  if(Array.isArray(payload.board)){
    assemblyBoardRows=normalizeAssemblyBoardRows(payload.board);
    localStorage.setItem(assemblyBoardStorageKey,JSON.stringify(assemblyBoardRows));
  }
  if(Array.isArray(payload.available)){
    availableQueueRows=normalizeQueueRows(payload.available);
    localStorage.setItem(queueStorageKey,JSON.stringify(availableQueueRows));
  }
  if(Array.isArray(payload.scheduled)){
    scheduledQueueRows=normalizeScheduledQueueRows(payload.scheduled);
    localStorage.setItem(scheduledQueueStorageKey,JSON.stringify(scheduledQueueRows));
  }
  if(Array.isArray(payload.incomplete)){
    incompleteQueueRows=normalizeQueueRows(payload.incomplete);
    localStorage.setItem(incompleteQueueStorageKey,JSON.stringify(incompleteQueueRows));
  }
  if(Array.isArray(payload.revenue)){
    revenueReferenceRows=normalizeRevenueReferenceRows(payload.revenue);
    localStorage.setItem(revenueReferenceStorageKey,JSON.stringify(revenueReferenceRows));
  }
  let metaUpdated=false;
  if(payload.queueImportMeta && typeof payload.queueImportMeta === 'object'){
    try { localStorage.setItem('ops_hub_queue_import_meta_v1', JSON.stringify(payload.queueImportMeta)); metaUpdated=true; } catch(_){}
  }
  if(payload.revenueImportMeta && typeof payload.revenueImportMeta === 'object'){
    try { localStorage.setItem('ops_hub_revenue_import_meta_v1', JSON.stringify(payload.revenueImportMeta)); metaUpdated=true; } catch(_){}
  }
  if(metaUpdated){
    try { window.dispatchEvent(new CustomEvent('importHubMetaSynced')); } catch(_){}
  }
}
async function loadAssemblyFromBackend(){
  try{
    const data=await assemblyApiRequest('GET');
    if(data&&data.state){
      applyAssemblySyncPayload(data.state);
    }
    assemblySyncEnabled=true;
  }catch(err){
    console.warn('Assembly sync unavailable, using browser storage.',err);
    assemblySyncEnabled=false;
  }finally{
    assemblySyncLoaded=true;
  }
}
async function syncAssemblyState(){
  if(!assemblySyncEnabled||!assemblySyncLoaded){return;}
  if(assemblySyncInFlight){assemblySyncQueued=true;return;}
  assemblySyncInFlight=true;
  try{
    const data=await assemblyApiRequest('POST',{state:buildAssemblySyncPayload()});
    if(data&&data.state) applyAssemblySyncPayload(data.state);
  }catch(err){
    console.warn('Assembly sync save failed; keeping local copy.',err);
    assemblySyncEnabled=false;
  }finally{
    assemblySyncInFlight=false;
    if(assemblySyncQueued){assemblySyncQueued=false;syncAssemblyState();}
  }
}
