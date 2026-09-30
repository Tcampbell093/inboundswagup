'use strict';
// Browser Push API for signed-in Warehouse Hub Admins only.
// Manager access keys without an Admin Hub session cannot subscribe or test.
const {Pool}=require('pg');
const push=require('./_hub_push');
const pool=new Pool({connectionString:process.env.DATABASE_URL,
  ssl:process.env.DATABASE_URL?{rejectUnauthorized:false}:undefined});
const json=(statusCode,body)=>({statusCode,headers:{
  'Content-Type':'application/json','Cache-Control':'private, no-store'
},body:JSON.stringify(body)});
function sameOrigin(event){
  const origin=event.headers?.origin||event.headers?.Origin||'';
  if(!origin)return true; // legacy browsers / same-origin calls without Origin
  const host=event.headers?.host||event.headers?.Host||event.headers?.['x-forwarded-host']||'';
  try{const o=new URL(origin);return o.protocol==='https:'&&o.host===host;}catch{return false;}
}
exports.handler=async function(event){
  if(!process.env.DATABASE_URL)return json(503,{error:'Push storage is not configured.'});
  const admin=push.adminSession(event);
  if(!admin)return json(403,{error:'Sign in to Warehouse Hub as Admin to manage desktop notifications.'});
  if(!push.configured())return json(503,{error:'Desktop push is not configured yet.'});
  try{
    if(event.httpMethod==='GET'&&event.queryStringParameters?.action==='status'){
      const endpoint=event.queryStringParameters?.endpoint||'';
      const subscribed=await push.status(pool,admin,endpoint);
      return json(200,{ok:true,subscribed,publicKey:push.vapidPublic()});
    }
    if(event.httpMethod!=='POST')return json(405,{error:'Method not allowed.'});
    if(!sameOrigin(event))return json(403,{error:'Cross-origin requests are not allowed.'});
    if(!/application\/json/i.test(event.headers?.['content-type']||event.headers?.['Content-Type']||'')){
      return json(415,{error:'JSON request required.'});
    }
    const body=JSON.parse(event.body||'{}');
    if(body.action==='subscribe'){
      await push.subscribe(pool,admin,body.subscription);
      return json(200,{ok:true,subscribed:true});
    }
    if(body.action==='unsubscribe'){
      await push.disable(pool,admin,body.endpoint||'');
      return json(200,{ok:true,subscribed:false});
    }
    if(body.action==='test'){
      const endpoint=String(body.endpoint||'');
      if(!push.endpointValid(endpoint))return json(400,{error:'Invalid subscription.'});
      await push.ensureSchema(pool);
      const r=await pool.query(`
        UPDATE hub_admin_push_subscriptions SET last_test_at=NOW()
        WHERE endpoint=$1 AND employee_key=$2 AND employee_id=$3 AND enabled=TRUE
        AND (last_test_at IS NULL OR last_test_at<NOW()-INTERVAL '45 seconds')
        RETURNING endpoint,subscription
      `,[endpoint,admin.employeeKey,admin.employeeId]);
      if(!r.rows.length)return json(429,{error:'Enable notifications first, or wait 45 seconds before sending another test.'});
      const sent=await push.deliver(pool,r.rows[0],{
        title:'Warehouse Hub · Test notification',
        body:'Desktop notifications are working on this computer.',
        tag:'hub-desktop-test',url:'/inventory-control/'
      });
      return sent?json(200,{ok:true,delivered:true}):json(502,{error:'Push service did not accept the test. Check notification permissions and try again.'});
    }
    return json(400,{error:'Unsupported notification action.'});
  }catch(error){
    console.warn('hub-push API error:',error.message);
    return json(503,{error:'Unable to update desktop notifications right now. Please try again.'});
  }
};
