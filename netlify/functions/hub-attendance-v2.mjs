import pg from 'pg';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import seedCipher from './attendance-seed-data.mjs';

const { Pool } = pg;
let poolInstance=null, schemaReady=false, seedCache=null;
const SESSION_COOKIE='hub_associate_session', SESSION_VERSION=2;
const DEFAULT_STATUSES=[
{id:'present',label:'Present',points:0,tone:'good'},{id:'late-under-4',label:'Late < 4hrs',points:.5,tone:'warn'},{id:'late-over-4',label:'Late > 4hrs',points:1,tone:'warn'},{id:'early-under-4',label:'Early Departure < 4hrs',points:.5,tone:'warn'},{id:'early-over-4',label:'Early Departure > 4hrs',points:1,tone:'warn'},{id:'call-out',label:'Call Out',points:2,tone:'bad'},{id:'ncns',label:'NCNS',points:3,tone:'bad'},{id:'excused',label:'Excused Absence',points:0,tone:'neutral'},{id:'sick',label:'Sick Time',points:0,tone:'neutral'},{id:'pto',label:'PTO',points:0,tone:'neutral'},{id:'maternity',label:'Maternity',points:0,tone:'neutral'},{id:'streak',label:'30 Day Streak',points:-1,tone:'good'}];
const DEFAULT_THRESHOLDS=[{id:'verbal',label:'Verbal Warning',points:5},{id:'written',label:'Written Warning',points:7},{id:'termination-review',label:'Termination Review',points:12}];

const env=n=>globalThis.Netlify?.env?.get(n)||'';
function pool(){const c=env('DATABASE_URL');if(!c)throw new Error('DATABASE_URL is not configured');if(!poolInstance)poolInstance=new Pool({connectionString:c,ssl:{rejectUnauthorized:false}});return poolInstance}
const json=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
const clean=(v,m=500)=>String(v==null?'':v).trim().slice(0,m);
const slug=v=>clean(v,140).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,120);
function cookieMap(request){const raw=request.headers.get('cookie')||'';return Object.fromEntries(raw.split(';').map(p=>p.trim()).filter(Boolean).map(p=>{const i=p.indexOf('=');return i===-1?[p,'']:[p.slice(0,i),p.slice(i+1)]}))}
function hubSession(request){try{const secret=env('HUB_ASSOCIATE_SESSION_SECRET'),token=cookieMap(request)[SESSION_COOKIE];if(!secret||!token)return null;const key=crypto.createHash('sha256').update(secret).digest(),[iv,tag,data]=String(token).split('.');if(!iv||!tag||!data)return null;const d=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(iv,'base64url'));d.setAuthTag(Buffer.from(tag,'base64url'));const p=JSON.parse(Buffer.concat([d.update(Buffer.from(data,'base64url')),d.final()]).toString('utf8'));if(p?.v!==SESSION_VERSION||!p?.name||Number(p.exp||0)<=Date.now())return null;return p}catch{return null}}
function attendanceSession(request){
 const s=hubSession(request),role=String(s?.role||'').toLowerCase();
 return s&&(role==='manager'||role==='team lead')?s:null
}
function isManager(session){return String(session?.role||'').toLowerCase()==='manager'}
const validDate=v=>/^\d{4}-\d{2}-\d{2}$/.test(clean(v,10))?clean(v,10):'';
const nameKey=v=>clean(v,160).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,' ').trim();

function seedData(){
 if(seedCache)return seedCache;
 const key=Buffer.from(env('ATTENDANCE_IMPORT_KEY'),'base64');
 if(key.length!==32)throw new Error('Attendance history key is unavailable.');
 const raw=Buffer.from(seedCipher,'base64'),nonce=raw.subarray(0,12),body=raw.subarray(12),tag=body.subarray(body.length-16),cipher=body.subarray(0,body.length-16);
 const d=crypto.createDecipheriv('aes-256-gcm',key,nonce);
 d.setAAD(Buffer.from('attendance-import-v1'));
 d.setAuthTag(tag);
 const parsed=JSON.parse(zlib.inflateSync(Buffer.concat([d.update(cipher),d.final()])).toString('utf8'));
 if(parsed?.version!==1||!Array.isArray(parsed.people)||!Array.isArray(parsed.records))throw new Error('Attendance history payload is invalid.');
 seedCache=parsed;
 return seedCache;
}

async function ensureSchema(){
 if(schemaReady)return;const db=pool();
 await db.query(`
 CREATE TABLE IF NOT EXISTS hub_attendance_settings(settings_key TEXT PRIMARY KEY,statuses_json JSONB NOT NULL DEFAULT '[]'::jsonb,thresholds_json JSONB NOT NULL DEFAULT '[]'::jsonb,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_by TEXT NOT NULL DEFAULT '');
 CREATE TABLE IF NOT EXISTS hub_attendance_people(person_key TEXT PRIMARY KEY,name TEXT NOT NULL,current_department TEXT NOT NULL DEFAULT 'Unassigned',sizes TEXT NOT NULL DEFAULT '',active BOOLEAN NOT NULL DEFAULT TRUE,source TEXT NOT NULL DEFAULT 'manual',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 CREATE TABLE IF NOT EXISTS hub_attendance_departments(name TEXT PRIMARY KEY,active BOOLEAN NOT NULL DEFAULT TRUE,sort_order INTEGER NOT NULL DEFAULT 100,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 CREATE TABLE IF NOT EXISTS hub_attendance_records(id UUID PRIMARY KEY,employee_key TEXT NOT NULL,employee_name TEXT NOT NULL,department TEXT NOT NULL,attendance_date DATE NOT NULL,status_id TEXT NOT NULL,status_label TEXT NOT NULL,points NUMERIC(8,2) NOT NULL DEFAULT 0,note TEXT NOT NULL DEFAULT '',recorded_by TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 CREATE TABLE IF NOT EXISTS hub_attendance_audit(id BIGSERIAL PRIMARY KEY,employee_key TEXT NOT NULL,employee_name TEXT NOT NULL,attendance_date DATE NOT NULL,previous_status TEXT NOT NULL DEFAULT '',new_status TEXT NOT NULL DEFAULT '',previous_points NUMERIC(8,2) NOT NULL DEFAULT 0,new_points NUMERIC(8,2) NOT NULL DEFAULT 0,actor TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 CREATE TABLE IF NOT EXISTS hub_attendance_day_overrides(person_key TEXT NOT NULL,attendance_date DATE NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_by TEXT NOT NULL DEFAULT '',PRIMARY KEY(person_key,attendance_date));
 `);
 await db.query(`
 ALTER TABLE hub_attendance_records ADD COLUMN IF NOT EXISTS assignment TEXT NOT NULL DEFAULT '';
 ALTER TABLE hub_attendance_records ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';
 ALTER TABLE hub_attendance_records ADD COLUMN IF NOT EXISTS source_ref TEXT NOT NULL DEFAULT '';
 ALTER TABLE hub_attendance_records ADD COLUMN IF NOT EXISTS source_json JSONB NOT NULL DEFAULT '{}'::jsonb;
 ALTER TABLE hub_attendance_records DROP CONSTRAINT IF EXISTS hub_attendance_records_employee_key_attendance_date_key;
 CREATE INDEX IF NOT EXISTS hub_attendance_records_date_idx ON hub_attendance_records(attendance_date DESC);
 CREATE INDEX IF NOT EXISTS hub_attendance_records_employee_idx ON hub_attendance_records(employee_key,attendance_date DESC);
 CREATE UNIQUE INDEX IF NOT EXISTS hub_attendance_records_source_ref_uidx ON hub_attendance_records(source_ref) WHERE source_ref<>'';
 CREATE INDEX IF NOT EXISTS hub_attendance_audit_employee_idx ON hub_attendance_audit(employee_key,created_at DESC);
 `);
 await db.query(`INSERT INTO hub_attendance_settings(settings_key,statuses_json,thresholds_json,updated_by) VALUES('default',$1::jsonb,$2::jsonb,'System') ON CONFLICT(settings_key) DO NOTHING`,[JSON.stringify(DEFAULT_STATUSES),JSON.stringify(DEFAULT_THRESHOLDS)]);
 schemaReady=true;
}
function statuses(v){const out=[],seen=new Set();for(const r of (Array.isArray(v)?v:[]).slice(0,40)){const label=clean(r?.label,100),id=slug(r?.id||label),p=Number(r?.points);if(!label||!id||seen.has(id))continue;seen.add(id);out.push({id,label,points:Number.isFinite(p)?Math.max(-10,Math.min(20,Math.round(p*100)/100)):0,tone:['good','warn','bad','neutral'].includes(r?.tone)?r.tone:'neutral'})}return out.length?out:DEFAULT_STATUSES}
function thresholds(v){const out=[],seen=new Set();for(const r of (Array.isArray(v)?v:[]).slice(0,10)){const label=clean(r?.label,100),id=slug(r?.id||label),p=Number(r?.points);if(!label||!id||seen.has(id)||!Number.isFinite(p))continue;seen.add(id);out.push({id,label,points:Math.max(0,Math.round(p*100)/100)})}out.sort((a,b)=>a.points-b.points);return out.length?out:DEFAULT_THRESHOLDS}
async function readSettings(db){const r=(await db.query(`SELECT statuses_json,thresholds_json,updated_at,updated_by FROM hub_attendance_settings WHERE settings_key='default' LIMIT 1`)).rows[0]||{};return{statuses:statuses(r.statuses_json),thresholds:thresholds(r.thresholds_json),updatedAt:r.updated_at||null,updatedBy:r.updated_by||''}}
async function readPeople(db){
 const base=new Map(seedData().people.map(p=>[String(p.personKey),{personKey:String(p.personKey),name:clean(p.name,120),currentDepartment:clean(p.currentDepartment,120)||'Unassigned',sizes:clean(p.sizes,300),active:p.active!==false,source:'excel',createdAt:null,updatedAt:null}]));
 const rows=(await db.query(`SELECT person_key,name,current_department,sizes,active,source,created_at,updated_at FROM hub_attendance_people ORDER BY updated_at ASC`)).rows;
 for(const r of rows){
   const prior=base.get(r.person_key);
   base.set(r.person_key,{personKey:r.person_key,name:r.name,currentDepartment:r.current_department||prior?.currentDepartment||'Unassigned',sizes:r.sizes||prior?.sizes||'',active:r.active!==false,source:r.source||prior?.source||'manual',createdAt:r.created_at||null,updatedAt:r.updated_at||null});
 }
 return [...base.values()].sort((a,b)=>Number(b.active)-Number(a.active)||a.name.localeCompare(b.name));
}
async function readDepartments(db){
 const base=new Map((seedData().departments||[]).map((d,i)=>[String(d.name),{name:String(d.name),active:d.active!==false,sortOrder:i*10}]));
 const rows=(await db.query(`SELECT name,active,sort_order FROM hub_attendance_departments ORDER BY updated_at ASC`)).rows;
 for(const r of rows)base.set(r.name,{name:r.name,active:r.active!==false,sortOrder:Number(r.sort_order||100)});
 return [...base.values()].sort((a,b)=>Number(b.active)-Number(a.active)||a.sortOrder-b.sortOrder||a.name.localeCompare(b.name));
}
function seedRecord(r){
 return{id:'seed:'+String(r.sourceRef||''),personKey:String(r.personKey),employeeKey:String(r.personKey),employeeName:clean(r.employeeName,120),department:clean(r.department,120)||'Unassigned',assignment:clean(r.assignment,120),date:validDate(r.date),statusId:clean(r.statusId,100),statusLabel:clean(r.statusLabel,120),points:Number(r.points||0),note:clean(r.note,1000),recordedBy:'Excel Import',source:'excel',sourceRef:clean(r.sourceRef,240),updatedAt:null};
}
function dbRecord(r,mappedKey){
 return{id:r.id,personKey:mappedKey||r.employee_key,employeeKey:mappedKey||r.employee_key,employeeName:r.employee_name,department:r.department,assignment:r.assignment||'',date:r.attendance_date,statusId:r.status_id,statusLabel:r.status_label,points:Number(r.points||0),note:r.note||'',recordedBy:r.recorded_by||'',source:r.source||'manual',sourceRef:r.source_ref||'',updatedAt:r.updated_at||null};
}
async function mergedRecords(db,personFilter=''){
 const roster=await readPeople(db),validKeys=new Set(roster.map(p=>p.personKey)),nameMatches=new Map();
 for(const p of roster){const nk=nameKey(p.name);if(!nameMatches.has(nk))nameMatches.set(nk,[]);nameMatches.get(nk).push(p.personKey)}
 const overrideRows=(await db.query(`SELECT person_key,to_char(attendance_date,'YYYY-MM-DD') attendance_date FROM hub_attendance_day_overrides`)).rows;
 const overridden=new Set(overrideRows.map(r=>r.person_key+'|'+r.attendance_date));
 const dbRows=(await db.query(`SELECT id,employee_key,employee_name,department,assignment,to_char(attendance_date,'YYYY-MM-DD') attendance_date,status_id,status_label,points,note,recorded_by,source,source_ref,updated_at FROM hub_attendance_records WHERE COALESCE(source,'manual')<>'excel' ORDER BY created_at ASC,id ASC`)).rows;
 const manual=[];
 for(const r of dbRows){
   let mapped=r.employee_key;
   if(!validKeys.has(mapped)){
     const matches=nameMatches.get(nameKey(r.employee_name))||[];
     if(matches.length===1)mapped=matches[0];
   }
   if(personFilter&&mapped!==personFilter)continue;
   manual.push(dbRecord(r,mapped));
   overridden.add(mapped+'|'+r.attendance_date);
 }
 const baseline=seedData().records.map(seedRecord).filter(r=>r.date&&(!personFilter||r.personKey===personFilter)&&!overridden.has(r.personKey+'|'+r.date));
 return baseline.concat(manual).sort((a,b)=>String(b.date).localeCompare(String(a.date))||String(a.sourceRef||a.id).localeCompare(String(b.sourceRef||b.id)));
}
async function snapshot(db,date){
 const [settings,people,departments,records]=await Promise.all([readSettings(db),readPeople(db),readDepartments(db),mergedRecords(db)]);
 const totalsMap=new Map();
 for(const r of records){
   const cur=totalsMap.get(r.personKey)||{personKey:r.personKey,employeeKey:r.personKey,employeeName:r.employeeName,totalPoints:0,lastRecordDate:''};
   cur.employeeName=r.employeeName||cur.employeeName;cur.totalPoints+=Number(r.points||0);if(!cur.lastRecordDate||r.date>cur.lastRecordDate)cur.lastRecordDate=r.date;totalsMap.set(r.personKey,cur);
 }
 const dayMap=new Map();
 for(const r of records.filter(x=>x.date===date)){const prev=dayMap.get(r.personKey);if(!prev||r.source==='manual')dayMap.set(r.personKey,r)}
 const totals=[...totalsMap.values()].map(r=>({...r,totalPoints:Math.max(0,Math.round(r.totalPoints*100)/100)}));
 return{date,settings,people,departments,dayRecords:[...dayMap.values()],totals};
}
async function history(db,key){
 const [records,people,settings]=await Promise.all([mergedRecords(db,key),readPeople(db),readSettings(db)]);
 const p=people.find(x=>x.personKey===key)||null,total=records.reduce((sum,r)=>sum+Number(r.points||0),0);
 return{person:p,settings,totalPoints:Math.max(0,Math.round(total*100)/100),history:records};
}
async function saveDay(db,session,body){
 const date=validDate(body.date);if(!date)throw new Error('Choose a valid attendance date.');const set=await readSettings(db),map=new Map(set.statuses.map(s=>[s.id,s])),rows=Array.isArray(body.records)?body.records.slice(0,500):[],c=await db.connect();let saved=0,cleared=0;
 const beforeAll=await mergedRecords(db);
 const priorByPerson=new Map();
 for(const r of beforeAll.filter(x=>x.date===date)){if(!priorByPerson.has(r.personKey))priorByPerson.set(r.personKey,[]);priorByPerson.get(r.personKey).push(r)}
 try{await c.query('BEGIN');for(const raw of rows){const key=clean(raw?.personKey||raw?.employeeKey,160),name=clean(raw?.employeeName,120),dept=clean(raw?.department,120)||'Unassigned',assignment=clean(raw?.assignment,120),sid=clean(raw?.statusId,100),note=clean(raw?.note,1000);if(!key||!name)continue;
   const priorRows=priorByPerson.get(key)||[],prior=priorRows[0]||null,priorPoints=priorRows.reduce((sum,r)=>sum+Number(r.points||0),0);
   await c.query(`INSERT INTO hub_attendance_day_overrides(person_key,attendance_date,updated_at,updated_by) VALUES($1,$2::date,NOW(),$3) ON CONFLICT(person_key,attendance_date) DO UPDATE SET updated_at=NOW(),updated_by=EXCLUDED.updated_by`,[key,date,clean(session.name,120)]);
   await c.query(`DELETE FROM hub_attendance_records WHERE attendance_date=$2::date AND COALESCE(source,'manual')<>'excel' AND (employee_key=$1 OR lower(trim(employee_name))=lower(trim($3)))`,[key,date,name]);
   if(!sid){if(prior){await c.query(`INSERT INTO hub_attendance_audit(employee_key,employee_name,attendance_date,previous_status,new_status,previous_points,new_points,actor) VALUES($1,$2,$3::date,$4,'',$5,0,$6)`,[key,name,date,prior.status_label||'',priorPoints,clean(session.name,120)]);cleared++}continue}
   const st=map.get(sid);if(!st)throw new Error('Unknown attendance status: '+sid);const points=Number(st.points||0);
   await c.query(`INSERT INTO hub_attendance_records(id,employee_key,employee_name,department,assignment,attendance_date,status_id,status_label,points,note,recorded_by,source,source_ref,source_json,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6::date,$7,$8,$9,$10,$11,'manual','',$12::jsonb,NOW(),NOW())`,[crypto.randomUUID(),key,name,dept,assignment,date,st.id,st.label,points,note,clean(session.name,120),JSON.stringify({})]);
   if(!prior||prior.status_label!==st.label||priorPoints!==points)await c.query(`INSERT INTO hub_attendance_audit(employee_key,employee_name,attendance_date,previous_status,new_status,previous_points,new_points,actor) VALUES($1,$2,$3::date,$4,$5,$6,$7,$8)`,[key,name,date,prior?.status_label||'',priorPoints,points,clean(session.name,120)]);
   saved++;
 }await c.query('COMMIT');return{saved,cleared}}catch(e){try{await c.query('ROLLBACK')}catch{}throw e}finally{c.release()}
}
async function saveSettings(db,session,body){const ss=statuses(body.statuses),tt=thresholds(body.thresholds);await db.query(`INSERT INTO hub_attendance_settings(settings_key,statuses_json,thresholds_json,updated_at,updated_by) VALUES('default',$1::jsonb,$2::jsonb,NOW(),$3) ON CONFLICT(settings_key) DO UPDATE SET statuses_json=EXCLUDED.statuses_json,thresholds_json=EXCLUDED.thresholds_json,updated_at=NOW(),updated_by=EXCLUDED.updated_by`,[JSON.stringify(ss),JSON.stringify(tt),clean(session.name,120)]);return readSettings(db)}
async function savePerson(db,body){const name=clean(body.name,120);if(!name)throw new Error('Enter a person name.');let key=clean(body.personKey,160);if(!key)key='manual:'+slug(name)+':'+crypto.randomUUID().slice(0,8);const dept=clean(body.currentDepartment,120)||'Unassigned',active=body.active!==false;const roster=await readPeople(db),existing=roster.find(p=>p.personKey===key);const sizes=body.sizes==null?(existing?.sizes||''):clean(body.sizes,300);await db.query(`INSERT INTO hub_attendance_people(person_key,name,current_department,sizes,active,source,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'manual',NOW(),NOW()) ON CONFLICT(person_key) DO UPDATE SET name=EXCLUDED.name,current_department=EXCLUDED.current_department,sizes=EXCLUDED.sizes,active=EXCLUDED.active,updated_at=NOW()`,[key,name,dept,sizes,active]);await db.query(`INSERT INTO hub_attendance_departments(name,active,sort_order) VALUES($1,TRUE,100) ON CONFLICT(name) DO NOTHING`,[dept]);return{personKey:key,name,currentDepartment:dept,sizes,active}}
async function saveDepartment(db,body){const name=clean(body.name,120);if(!name)throw new Error('Enter a department name.');const active=body.active!==false,sort=Number.isFinite(Number(body.sortOrder))?Math.round(Number(body.sortOrder)):100;await db.query(`INSERT INTO hub_attendance_departments(name,active,sort_order,created_at,updated_at) VALUES($1,$2,$3,NOW(),NOW()) ON CONFLICT(name) DO UPDATE SET active=EXCLUDED.active,sort_order=EXCLUDED.sort_order,updated_at=NOW()`,[name,active,sort]);return{name,active,sortOrder:sort}}

export default async(request)=>{
 try{const session=attendanceSession(request);if(!session)return json(401,{error:'Warehouse Hub Team Lead or Admin sign-in is required.'});await ensureSchema();const db=pool(),url=new URL(request.url);
  if(request.method==='GET'){const key=clean(url.searchParams.get('person'),160);if(key)return json(200,await history(db,key));const date=validDate(url.searchParams.get('date'))||new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York'}).format(new Date());return json(200,await snapshot(db,date))}
  if(request.method!=='POST')return json(405,{error:'Method not allowed.'});const body=await request.json().catch(()=>({})),action=clean(body.action,50);
  if(action==='saveDay'){const r=await saveDay(db,session,body);return json(200,{ok:true,...r,snapshot:await snapshot(db,validDate(body.date))})}
  if(action==='saveSettings'){
    if(!isManager(session))return json(403,{error:'Admin access is required to change attendance rules.'});
    return json(200,{ok:true,settings:await saveSettings(db,session,body)});
  }
  if(action==='upsertPerson'){
    if(!isManager(session))return json(403,{error:'Manager access is required to change the attendance roster.'});
    return json(200,{ok:true,person:await savePerson(db,body)});
  }
  if(action==='upsertDepartment'){
    if(!isManager(session))return json(403,{error:'Admin access is required to change attendance departments.'});
    return json(200,{ok:true,department:await saveDepartment(db,body)});
  }
  return json(400,{error:'Unsupported attendance action.'});
 }catch(e){return json(400,{error:clean(e?.message||'Unexpected attendance error.',300)})}
};
export const config={path:'/api/attendance-control-v2'};
