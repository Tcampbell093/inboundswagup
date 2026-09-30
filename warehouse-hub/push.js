(() => {
  'use strict';
  const API='/.netlify/functions/hub-push',WORKER='/warehouse-hub/push-sw.js';
  const top=document.querySelector('.top-actions');
  if(!top)return;
  const session=()=>window.HubAssociate?.getSession?.()||{};
  const admin=()=>session().signedIn&&String(session().role||'').toLowerCase()==='manager';
  const supported=()=>window.isSecureContext&&('serviceWorker'in navigator)&&('PushManager'in window)&&('Notification'in window);
  const button=document.createElement('button');
  button.type='button';button.className='toolcount hub-push-btn';button.id='hubPushButton';
  button.textContent='🔔 Desktop alerts';button.hidden=true;
  top.insertBefore(button,document.getElementById('manageBtn')||null);
  const style=document.createElement('style');
  style.textContent=`
    .hub-push-btn{cursor:pointer;color:var(--ink);border-color:#c6d7ce;white-space:nowrap}
    .hub-push-btn[hidden]{display:none!important}
    .hub-push-btn.is-enabled{background:var(--green-soft);border-color:#9dcdb9}
    .hub-push-modal{border:0;border-radius:19px;padding:0;width:min(450px,calc(100% - 26px));background:var(--bg);color:var(--ink);box-shadow:0 25px 90px rgba(12,34,25,.28)}
    .hub-push-modal::backdrop{background:rgba(16,32,28,.48)}
    .hub-push-head{display:flex;align-items:center;justify-content:space-between;padding:18px 20px;border-bottom:1px solid var(--line)}
    .hub-push-head h3{font-size:17px;margin:0}.hub-push-head button{border:0;border-radius:9px;background:#e7efea;width:33px;height:33px;cursor:pointer;font-size:22px}
    .hub-push-body{padding:19px 20px}.hub-push-body p{font-size:13px;line-height:1.55;color:var(--muted);margin:0 0 13px}
    .hub-push-state{padding:11px 12px;border-radius:10px;background:var(--paper);border:1px solid var(--line);font-size:12px;font-weight:800;margin:12px 0}
    .hub-push-state.error{background:#fff0eb;color:#913c27;border-color:#edc6b9}
    .hub-push-controls{display:flex;gap:9px;flex-wrap:wrap}.hub-push-controls button{cursor:pointer;border-radius:10px;padding:11px 13px;border:1px solid var(--line);font-size:12px;font-weight:850;background:var(--paper);color:var(--ink)}
    .hub-push-controls button.primary{background:var(--ink);color:#fff;border-color:var(--ink)}
    .hub-push-controls button:disabled{opacity:.45;cursor:default}
    @media(max-width:680px){.hub-push-btn:not([hidden]){display:inline-flex!important;padding:8px 9px;font-size:11px}}
  `;
  document.head.appendChild(style);
  const dialog=document.createElement('dialog');
  dialog.id='hubPushDialog';dialog.className='hub-push-modal';
  dialog.innerHTML=`
    <div class="hub-push-head"><h3>🔔 Desktop notifications</h3><button type="button" id="hubPushClose" aria-label="Close">×</button></div>
    <div class="hub-push-body">
      <p>Receive new Warehouse Inventory requests and low/out-of-stock alerts on this computer, including when the Hub tab is closed. Admin sign-in is required to enable notifications.</p>
      <div class="hub-push-state" id="hubPushState" role="status">Checking this computer…</div>
      <div class="hub-push-controls">
        <button type="button" class="primary" id="hubPushToggle" disabled>Enable notifications</button>
        <button type="button" id="hubPushTest" disabled>Send test</button>
      </div>
      <p style="margin-top:14px;font-size:11px">Permissions are per browser and computer. Disable notifications before signing out of a shared workstation. Delivery also depends on your browser and operating-system notification settings.</p>
    </div>
  `;
  document.body.appendChild(dialog);
  const stateEl=dialog.querySelector('#hubPushState'),toggle=dialog.querySelector('#hubPushToggle'),
    test=dialog.querySelector('#hubPushTest');
  let current=null,publicKey='',busy=false;
  function show(text,error=false){stateEl.textContent=text;stateEl.classList.toggle('error',error);}
  function syncButton(){
    button.hidden=!admin();
    if(!admin()&&dialog.open)dialog.close();
  }
  async function request(body){
    const response=await fetch(API,{method:'POST',credentials:'same-origin',cache:'no-store',
      headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||'Desktop notification request failed.');
    return data;
  }
  async function registered(){
    const reg=await navigator.serviceWorker.getRegistration('/warehouse-hub/');
    return reg||null;
  }
  async function worker(){
    const reg=await navigator.serviceWorker.register(WORKER,{scope:'/warehouse-hub/'});
    if(reg.active)return reg;
    await Promise.race([
      new Promise((resolve,reject)=>{
        const sw=reg.installing||reg.waiting;
        if(!sw)return reject(new Error('Service worker is not ready.'));
        if(sw.state==='activated')return resolve();
        sw.addEventListener('statechange',()=>{if(sw.state==='activated')resolve();else if(sw.state==='redundant')reject(new Error('Service worker could not activate.'));});
      }),
      new Promise((_,reject)=>setTimeout(()=>reject(new Error('Service worker took too long to start.')),9000))
    ]);
    return reg;
  }
  async function browserSub(){
    const reg=await registered();return reg?reg.pushManager.getSubscription():null;
  }
  function keyBytes(value){
    const pad='='.repeat((4-value.length%4)%4);
    const raw=atob(value.replace(/-/g,'+').replace(/_/g,'/')+pad);
    return Uint8Array.from(raw,c=>c.charCodeAt(0));
  }
  function updateState(enabled){
    current=!!enabled;
    toggle.disabled=false;toggle.textContent=current?'Disable notifications':'Enable notifications';
    test.disabled=!current;
    button.classList.toggle('is-enabled',current);
  }
  async function refresh(){
    syncButton();if(!admin()||!dialog.open)return;
    if(!supported()){show('This browser does not support background web push. Use a current Chrome, Edge, Firefox or Safari version on a supported desktop.',true);toggle.disabled=true;test.disabled=true;return;}
    if(Notification.permission==='denied'){
      show('Notifications are blocked in this browser. Allow notifications for this site in your browser settings, then reopen this window.',true);
      toggle.disabled=true;test.disabled=true;return;
    }
    try{
      show('Checking this computer…');toggle.disabled=true;test.disabled=true;
      const subscription=await browserSub();
      const query=subscription?'&endpoint='+encodeURIComponent(subscription.endpoint):'';
      const response=await fetch(API+'?action=status'+query,{credentials:'same-origin',cache:'no-store'});
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(data.error||'Notification settings are unavailable.');
      publicKey=data.publicKey||'';
      const enabled=!!(subscription&&data.subscribed&&Notification.permission==='granted');
      updateState(enabled);
      show(enabled?'Enabled on this computer. Inventory alerts can arrive while the Hub tab is closed.':
        'Not enabled on this computer. Click Enable to allow notifications.');
    }catch(error){show(error.message||'Could not load notification settings.',true);toggle.disabled=true;test.disabled=true;}
  }
  async function enable(){
    if(busy||!admin()||!supported()||!publicKey)return;
    busy=true;toggle.disabled=true;test.disabled=true;
    try{
      // Browser permission request must follow the button click directly.
      const permission=Notification.permission==='default'?await Notification.requestPermission():Notification.permission;
      if(permission!=='granted')throw new Error('Notification permission was not granted. Allow notifications in your browser settings to enable alerts.');
      show('Registering this computer…');
      const reg=await worker();
      let subscription=await reg.pushManager.getSubscription();
      if(subscription&&!current){await subscription.unsubscribe();subscription=null;}
      if(!subscription)subscription=await reg.pushManager.subscribe({
        userVisibleOnly:true,applicationServerKey:keyBytes(publicKey)
      });
      try{await request({action:'subscribe',subscription:subscription.toJSON()});}
      catch(error){await subscription.unsubscribe().catch(()=>{});throw error;}
      updateState(true);show('Desktop notifications enabled. You can send yourself a test now.');
    }catch(error){show(error.message||'Could not enable notifications.',true);toggle.disabled=false;}
    finally{busy=false;}
  }
  async function disable(silent=false){
    if(busy&&!silent)return false;
    const subscription=supported()?await browserSub().catch(()=>null):null;
    if(!subscription){if(!silent){updateState(false);show('Notifications are disabled on this computer.');}return true;}
    try{
      await request({action:'unsubscribe',endpoint:subscription.endpoint});
      await subscription.unsubscribe();
      if(!silent){updateState(false);show('Desktop notifications disabled on this computer.');}
      button.classList.remove('is-enabled');
      return true;
    }catch(error){if(!silent)show(error.message||'Could not disable notifications.',true);return false;}
  }
  toggle.onclick=async()=>{
    if(busy)return;
    if(current){busy=true;toggle.disabled=true;try{await disable();}finally{busy=false;if(current)toggle.disabled=false;}}
    else await enable();
  };
  test.onclick=async()=>{
    if(busy||!current||!admin())return;
    busy=true;test.disabled=true;
    try{
      const subscription=await browserSub();
      if(!subscription)throw new Error('This computer is not subscribed.');
      await request({action:'test',endpoint:subscription.endpoint});
      show('Test sent. Check your desktop notification center if a pop-up did not appear.');
    }catch(error){show(error.message||'Test notification failed.',true);}
    finally{busy=false;test.disabled=!current;}
  };
  button.onclick=async()=>{if(!admin())return;if(!dialog.open)dialog.showModal();await refresh();};
  dialog.querySelector('#hubPushClose').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>{current=null;});
  document.addEventListener('hub-associate-session',syncButton);
  window.HubPush={disableForSignout:()=>admin()?disable(true):Promise.resolve(true),refresh};
  // Associate auth checks the cookie asynchronously when a tab opens.
  window.HubAssociate?.refresh?.().then(syncButton).catch(syncButton);
  syncButton();
})();
