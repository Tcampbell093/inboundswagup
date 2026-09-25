const $=s=>document.querySelector(s);
let page=1,total=0,lastRecords=[];

function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

function card(r,i){
  return `<button class="record" data-i="${i}"><div><strong>PO ${esc(r.po||'—')}</strong><div class="meta">${esc(r.delivery_id||'No delivery ID')}</div></div><div><b>${esc(r.category||'Uncategorized')}</b><div class="meta">Category</div></div><div><b>${esc(r.location||'—')}</b><div class="meta">Location</div></div><div><b>${esc(r.activity_date||'Date unavailable')}</b><div class="meta">Latest recorded activity</div></div><div><span class="pill ${r.lifecycle_state==='archived'?'archived':''}">${esc(r.lifecycle_state)}</span></div></button>`;
}

async function load(){
  $('#message').textContent='';
  $('#records').innerHTML='<p>Loading records…</p>';
  const p=new URLSearchParams({q:$('#search').value,scope:$('#scope').value,sort:$('#sort').value,page:String(page),pageSize:'40'});
  try{
    const res=await fetch('/api/po-history?'+p,{cache:'no-store'});
    const data=await res.json().catch(()=>({}));
    if(res.status===401){
      lastRecords=[];total=0;$('#count').textContent='0';$('#records').innerHTML='';
      $('#message').textContent='Sign in with your Warehouse Hub PIN to view PO History.';
      window.HubAssociate?.open?.();
      return;
    }
    if(!res.ok){
      $('#records').innerHTML='';
      $('#message').textContent=data.error||'Unable to load PO history.';
      return;
    }
    lastRecords=data.records||[];
    total=data.total||0;
    $('#count').textContent=total.toLocaleString();
    $('#records').innerHTML=lastRecords.length?lastRecords.map(card).join(''):'<p>No matching records yet. Run the updated Excel sync to copy workbook history here.</p>';
    $('#page').textContent=`Page ${page} of ${Math.max(1,Math.ceil(total/40))}`;
    $('#prev').disabled=page<=1;
    $('#next').disabled=page*40>=total;
    const s=data.lastSync;
    $('#syncStatus').textContent=s?`Last workbook copy: ${new Date(s.synced_at).toLocaleString()} · ${(data.totalStored||0).toLocaleString()} stored rows`:'Waiting for the first workbook copy.';
  }catch(error){
    $('#records').innerHTML='';
    $('#message').textContent=error?.message||'Unable to load PO history.';
  }
}

function details(r){
  $('#detailState').textContent=`${r.lifecycle_state} · ${r.source_sheet}`;
  $('#detailTitle').textContent=`PO ${r.po||'details'}`;
  const entries=Object.entries(r.row_json||{}).filter(([,v])=>String(v??'').trim());
  $('#detailBody').innerHTML=entries.map(([k,v])=>`<dl class="detail"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></dl>`).join('');
  $('#details').showModal();
}

document.addEventListener('click',e=>{const c=e.target.closest('.record');if(c)details(lastRecords[Number(c.dataset.i)]);});
document.addEventListener('hub-associate-session',e=>{if(e.detail?.signedIn){page=1;load();}});
let timer;
$('#search').addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(()=>{page=1;load()},250)});
['scope','sort'].forEach(id=>$('#'+id).addEventListener('change',()=>{page=1;load()}));
$('#refresh').onclick=load;
$('#prev').onclick=()=>{page--;load()};
$('#next').onclick=()=>{page++;load()};
$('#close').onclick=()=>$('#details').close();
load();
