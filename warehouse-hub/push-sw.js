/* Warehouse Hub service worker: receives Admin Web Push even without an open tab. */
'use strict';
self.addEventListener('install',event=>{self.skipWaiting();});
self.addEventListener('activate',event=>{event.waitUntil(self.clients.claim());});
self.addEventListener('push',event=>{
  let data={};
  try{data=event.data?event.data.json():{};}catch{data={};}
  const raw=String(data.url||'/inventory-control/');
  let target='/inventory-control/';
  try{
    const url=new URL(raw,self.location.origin);
    if(url.origin===self.location.origin&&url.pathname.startsWith('/inventory-control/'))target=url.pathname+url.search+url.hash;
  }catch{}
  const title=String(data.title||'Warehouse Hub · Inventory alert').slice(0,120);
  const options={
    body:String(data.body||'A new warehouse inventory alert is available.').slice(0,240),
    tag:String(data.tag||'hub-inventory-alert').slice(0,160),
    data:{url:target}
  };
  event.waitUntil(self.registration.showNotification(title,options));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const url=new URL(event.notification.data?.url||'/inventory-control/',self.location.origin).href;
  event.waitUntil((async()=>{
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const tab of windows){
      try{
        if(new URL(tab.url).origin===self.location.origin&&new URL(tab.url).pathname.startsWith('/inventory-control/')){
          if(tab.navigate&&tab.url!==url)await tab.navigate(url);
          return tab.focus();
        }
      }catch{}
    }
    return self.clients.openWindow?self.clients.openWindow(url):null;
  })());
});
