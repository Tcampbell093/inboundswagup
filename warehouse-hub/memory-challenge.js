(() => {
  const API='/api/memory-challenge', app=document.getElementById('memoryApp');
  if(!app)return;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let state={viewer:null,challenge:null,attempt:null,lead:null},timer=null,imageData='',adminData=null;
  const sess=()=>window.HubAssociate?.getSession?.()||{signedIn:false};
  const lead=()=>!!state.viewer?.isLead, manager=()=>!!state.viewer?.isManager;
  async function api(url=API,opt={}){const r=await fetch(url,{cache:'no-store',credentials:'same-origin',...opt});const j=await r.json().catch(()=>({}));if(!r.ok){const e=new Error(j.error||'Memory Challenge request failed.');e.status=r.status;throw e;}return j;}
  const post=(action,p={})=>api(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...p})});
  function stop(){if(timer)clearInterval(timer);timer=null;}
  function topBtns(){return '<div class="memory-top-actions">'+(lead()?'<button class="secondary memory-small-btn" data-mem-review>Review results</button>':'')+(manager()?'<button class="action memory-small-btn" data-mem-manage>Manage challenges</button>':'')+'</div>';}
  function bindTop(){app.querySelector('[data-mem-review]')?.addEventListener('click',openReview);app.querySelectorAll('[data-mem-manage]').forEach(b=>b.addEventListener('click',openAdmin));}
  function render(){stop();if(!sess().signedIn||!state.viewer)return signIn();if(!state.challenge)return empty();if(!state.attempt)return intro();if(state.attempt.state==='viewing')return viewing(API+'?image='+encodeURIComponent(state.challenge.id)+'&t='+Date.now());if(state.attempt.state==='answering')return answering();return done();}
  function signIn(){app.innerHTML='<div class="memory-shell"><div class="memory-center-card"><div class="memory-icon">🧠</div><div class="memory-kicker">Memory Challenge</div><h3>Sign in to play</h3><p>Each person gets one timed attempt.</p><button class="action" data-mem-signin>Sign in</button></div></div>';app.querySelector('[data-mem-signin]')?.addEventListener('click',()=>window.HubAssociate?.open?.());}
  function empty(){app.innerHTML='<div class="memory-shell">'+topBtns()+'<div class="memory-center-card"><div class="memory-icon">🧠</div><div class="memory-kicker">Memory Challenge</div><h3>No challenge is active</h3><p>'+(manager()?'Create o