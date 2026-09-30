'use strict';
// Shared Admin-only Web Push storage and delivery. Never expose VAPID secrets
// to the client, and never permit a manager access key to subscribe a device.
const crypto = require('node:crypto');
const webpush = require('web-push');
const COOKIE = 'hub_associate_session';
const SESSION_VERSION = 2;
let schemaReady = false;

function clean(value,max=160){return String(value==null?'':value).trim().slice(0,max);}
function slug(value){return clean(value,100).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,80);}
function cookieMap(event){
  const cookie=event.headers?.cookie||event.headers?.Cookie||'';
  return Object.fromEntries(String(cookie).split(';').map(x=>x.trim()).filter(Boolean).map(x=>{
    const i=x.indexOf('=');return i<0?[x,'']:[x.slice(0,i),x.slice(i+1)];
  }));
}
function adminSession(event){
  try{
    const token=cookieMap(event)[COOKIE],secret=process.env.HUB_ASSOCIATE_SESSION_SECRET;
    if(!token||!secret)return null;
    const [ivText,tagText,dataText]=String(token).split('.');
    if(!ivText||!tagText||!dataText)return null;
    const decipher=crypto.createDecipheriv('aes-256-gcm',crypto.createHash('sha256').update(secret).digest(),Buffer.from(ivText,'base64url'));
    decipher.setAuthTag(Buffer.from(tagText,'base64url'));
    const session=JSON.parse(Buffer.concat([decipher.update(Buffer.from(dataText,'base64url')),decipher.final()]).toString('utf8'));
    if(session?.v!==SESSION_VERSION||!session.name||!Number(session.employeeId)||Number(session.exp||0)<=Date.now()
       ||clean(session.role,40).toLowerCase()!=='manager')return null;
    return {employeeKey:slug(session.name),name:clean(session.name,100),employeeId:Number(session.employeeId)};
  }catch{return null;}
}
async function ensureSchema(pool){
  if(schemaReady)return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hub_admin_push_subscriptions(
      endpoint TEXT PRIMARY KEY,
      employee_key TEXT NOT NULL,
      employee_name TEXT NOT NULL,
      employee_id BIGINT NOT NULL,
      subscription JSONB NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_test_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS hub_admin_push_employee_idx ON hub_admin_push_subscriptions(employee_key,enabled);
    CREATE TABLE IF NOT EXISTS hub_admin_push_events(
      event_key TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  schemaReady=true;
}
function vapidPublic(){return clean(process.env.HUB_VAPID_PUBLIC_KEY||'',256);}
function configured(){return !!(vapidPublic()&&process.env.HUB_VAPID_PRIVATE_KEY);}
function configure(){
  if(!configured())throw new Error('Desktop push delivery is not configured.');
  const email=clean(process.env.HUB_VAPID_CONTACT||process.env.ADMIN_EMAIL||'warehouse@example.com',180);
  webpush.setVapidDetails('mailto:'+email,vapidPublic(),process.env.HUB_VAPID_PRIVATE_KEY);
}
function endpointValid(value){
  try{
    const url=new URL(value);
    if(url.protocol!=='https:'||url.username||url.password||url.port||value.length>2048)return false;
    const host=url.hostname.toLowerCase();
    return ['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com',
      'push.services.mozilla.com','push.apple.com'].some(h=>host===h||host.endsWith('.'+h))
      ||host.endsWith('.notify.windows.com');
  }catch{return false;}
}
function validSubscription(s){
  if(!s||typeof s!=='object'||!endpointValid(s.endpoint))return false;
  if(!s.keys||typeof s.keys!=='object')return false;
  if(!/^[a-zA-Z0-9_-]{80,120}$/.test(s.keys.p256dh||'')||!/^[a-zA-Z0-9_-]{20,26}$/.test(s.keys.auth||''))return false;
  try{return Buffer.from(s.keys.p256dh,'base64url').length===65&&Buffer.from(s.keys.auth,'base64url').length===16;}
  catch{return false;}
}
async function subscribe(pool,admin,subscription){
  if(!validSubscription(subscription))throw new Error('Browser returned an invalid push subscription.');
  await ensureSchema(pool);
  const safe={endpoint:subscription.endpoint,expirationTime:subscription.expirationTime||null,
    keys:{p256dh:subscription.keys.p256dh,auth:subscription.keys.auth}};
  await pool.query(`
    INSERT INTO hub_admin_push_subscriptions(endpoint,employee_key,employee_name,employee_id,subscription,enabled,created_at,updated_at)
    VALUES($1,$2,$3,$4,$5::jsonb,TRUE,NOW(),NOW())
    ON CONFLICT(endpoint) DO UPDATE SET employee_key=EXCLUDED.employee_key,employee_name=EXCLUDED.employee_name,
      employee_id=EXCLUDED.employee_id,subscription=EXCLUDED.subscription,enabled=TRUE,updated_at=NOW()
  `,[safe.endpoint,admin.employeeKey,admin.name,admin.employeeId,JSON.stringify(safe)]);
}
async function disable(pool,admin,endpoint){
  if(!endpointValid(endpoint))return;
  await ensureSchema(pool);
  await pool.query('DELETE FROM hub_admin_push_subscriptions WHERE endpoint=$1 AND employee_key=$2 AND employee_id=$3',
    [endpoint,admin.employeeKey,admin.employeeId]);
}
async function status(pool,admin,endpoint){
  await ensureSchema(pool);
  if(!endpointValid(endpoint))return false;
  const r=await pool.query(`SELECT 1 FROM hub_admin_push_subscriptions
    WHERE endpoint=$1 AND employee_key=$2 AND employee_id=$3 AND enabled=TRUE LIMIT 1`,
    [endpoint,admin.employeeKey,admin.employeeId]);
  return !!r.rows.length;
}
async function deliver(pool,row,message){
  try{
    configure();
    await webpush.sendNotification(row.subscription,JSON.stringify(message),{
      TTL:3600,urgency:'high',timeout:5500
    });
    return true;
  }catch(error){
    if([404,410].includes(Number(error?.statusCode))){
      await pool.query('DELETE FROM hub_admin_push_subscriptions WHERE endpoint=$1',[row.endpoint]).catch(()=>{});
    }
    console.warn('Admin push delivery failed:',error?.statusCode||error?.message||'unknown');
    return false;
  }
}
async function sendAdmins(pool,{eventKey,title,body,url='/inventory-control/',tag}){
  if(!configured())return {sent:0,reason:'push-not-configured'};
  try{
    await ensureSchema(pool);
    const r=await pool.query(`SELECT endpoint,subscription FROM hub_admin_push_subscriptions
      WHERE enabled=TRUE ORDER BY updated_at DESC LIMIT 80`);
    if(!r.rows.length)return {sent:0,reason:'no-subscribers'};
    if(!eventKey||eventKey.length>180)throw new Error('Missing notification event key.');
    const lock=await pool.query(`INSERT INTO hub_admin_push_events(event_key) VALUES($1)
      ON CONFLICT(event_key) DO NOTHING RETURNING event_key`,[eventKey]);
    if(!lock.rows.length)return {sent:0,reason:'already-dispatched'};
    const payload={title:clean(title,120),body:clean(body,240),
      url:url==='/inventory-control/?view=requests'?url:'/inventory-control/',tag:clean(tag||eventKey,160)};
    let sent=0;
    // Limit simultaneous push requests to avoid exhaustively opening connections.
    for(let i=0;i<r.rows.length;i+=8){
      const results=await Promise.all(r.rows.slice(i,i+8).map(row=>deliver(pool,row,payload)));
      sent+=results.filter(Boolean).length;
    }
    return {sent};
  }catch(error){
    console.warn('Admin push event failed:',error?.message||'unknown');
    return {sent:0,reason:'send-failed'};
  }
}
module.exports={adminSession,ensureSchema,vapidPublic,configured,validSubscription,
  subscribe,disable,status,deliver,sendAdmins,endpointValid};
