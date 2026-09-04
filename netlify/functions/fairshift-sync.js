const { Pool } = require('pg');
const crypto = require('crypto');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : undefined,
});
let schemaReady=false;
function json(statusCode,body){return{statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(body)}}
function text(v,max=200){return String(v==null?'':v).trim().slice(0,max)}
function date(v){const s=text(v,10);return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:''}
function safeEqual(a,b){if(!a||!b)return false;const aa=Buffer.from(String(a)),bb=Buffer.from(String(b));return aa.length===bb.length&&crypto.timingSafeEqual(aa,bb)}
async function ensureSchema(){if(schemaReady)return;await pool.query(`CREATE TABLE IF NOT EXISTS hub_cleaning_assignments (id TEXT PRIMARY KEY,work_date DATE NOT NULL,area TEXT NOT NULL,task TEXT,employee_name TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'scheduled',started_at TIMESTAMPTZ,finished_at TIMESTAMPTZ,completed_by TEXT,credit_minutes INTEGER NOT NULL DEFAULT 0,source TEXT NOT NULL DEFAULT 'hub',updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()); CREATE INDEX IF NOT EXISTS hub_cleaning_work_date_idx ON hub_cleaning_assignments(work_date);`);schemaReady=true}
exports.handler=async function handler(event){
  if(event.httpMethod!=='POST')return json(405,{error:'Method not allowed'});
  const key=event.headers?.['x-hub-sync-key']||event.headers?.['X-Hub-Sync-Key']||'';
  if(!safeEqual(key,process.env.HUB_SYNC_KEY||''))return json(401,{error:'Sync access denied.'});
  if(!process.env.DATABASE_URL)return json(500,{error:'DATABASE_URL is not configured'});
  try{
    await ensureSchema();
    const body=JSON.parse(event.body||'{}');
    if(!Array.isArray(body.assignments))return json(400,{error:'assignments array is required.'});
    if(body.assignments.length>100)return json(400,{error:'Too many assignments in one sync.'});
    let saved=0;
    for(const input of body.assignments){
      const workDate=date(input.date),area=text(input.area,100),employeeName=text(input.employeeName,100),id=text(input.id,80);
      if(!workDate||!area||!employeeName||!id)continue;
      await pool.query(`INSERT INTO hub_cleaning_assignments(id,work_date,area,task,employee_name,status,source,updated_at) VALUES($1,$2,$3,$4,$5,'scheduled','fairshift',NOW()) ON CONFLICT(id) DO UPDATE SET work_date=EXCLUDED.work_date,area=EXCLUDED.area,task=EXCLUDED.task,employee_name=EXCLUDED.employee_name,source='fairshift',updated_at=NOW()`,[id,workDate,area,text(input.task,240),employeeName]);
      saved+=1;
    }
    return json(200,{ok:true,saved});
  }catch(error){return json(400,{error:text(error?.message||'Sync failed.',300)})}
};
