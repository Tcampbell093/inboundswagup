import crypto from 'node:crypto';
import pg from 'pg';

const FAIRSHIFT_BASE = 'https://fairshift-rotations.thandoyordani.chatgpt.site';
const SESSION_COOKIE = 'hub_associate_session';
const SESSION_VERSION = 2;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
let signingKeyPromise;
let poolInstance=null;
let areaSchemaReady=false;
const {Pool}=pg;
function pool(){if(!poolInstance){const url=env('DATABASE_URL');if(!url)throw new Error('Cleaning area settings database is unavailable.');poolInstance=new Pool({connectionString:url,ssl:{rejectUnauthorized:false}});}return poolInstance;}
function defaultSide(name){return /fulfill?ment|outbound|inventory|shipping|dispatch|pack.?out/i.test(str(name,100))?'Outbound':'Inbound';}
async function ensureAreaSchema(){if(areaSchemaReady)return;await pool().query(`CREATE TABLE IF NOT EXISTS hub_cleaning_area_sides (
 department_id BIGINT PRIMARY KEY, department_name TEXT NOT NULL, side TEXT NOT NULL CHECK (side IN ('Inbound','Outbound')),
 updated_by TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);areaSchemaReady=true;}
async function loadSides(){await ensureAreaSchema();const r=await pool().query('SELECT department_id,department_name,side FROM hub_cleaning_area_sides');return new Map(r.rows.map(x=>[Number(x.department_id),x.side]));}

function env(name) { return globalThis.Netlify?.env?.get(name) || ''; }
function str(value, max=120) { return String(value ?? '').trim().slice(0,max); }
function json(status,body) {
  return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
}
function cookieMap(request) {
  return Object.fromEntries((request.headers.get('cookie')||'').split(';').map(v=>v.trim()).filter(Boolean).map(v=>{
    const i=v.indexOf('=');return i<0?[v,'']:[v.slice(0,i),v.slice(i+1)];
  }));
}
function sessionFrom(request) {
  try {
    const token=cookieMap(request)[SESSION_COOKIE],secret=env('HUB_ASSOCIATE_SESSION_SECRET');
    if (!token||!secret) return null;
    const [iv,tag,content]=token.split('.');
    if(!iv||!tag||!content)return null;
    const decipher=crypto.createDecipheriv('aes-256-gcm',crypto.createHash('sha256').update(secret).digest(),Buffer.from(iv,'base64url'));
    decipher.setAuthTag(Buffer.from(tag,'base64url'));
    const session=JSON.parse(Buffer.concat([decipher.update(Buffer.from(content,'base64url')),decipher.final()]).toString('utf8'));
    if(session.v!==SESSION_VERSION||!session.name||Number(session.exp||0)<=Date.now())return null;
    return session;
  }catch{return null;}
}
function roleOf(session) {
  const role=str(session?.role,40).toLowerCase();
  return role==='manager'?'admin':role==='team lead'?'lead':'associate';
}
async function signingKey(){
  if(signingKeyPromise)return signingKeyPromise;
  const pem=env('FAIRSHIFT_HUB_SIGNING_PRIVATE_KEY');
  if(!pem)throw new Error('Hub signing key is not configured.');
  const der=Buffer.from(pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s+/g,''),'base64');
  signingKeyPromise=crypto.webcrypto.subtle.importKey('pkcs8',der,{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
  return signingKeyPromise;
}
async function signedHeaders(path,method,bodyText){
  const ts=String(Date.now()),canonical=`${ts}\n${method}\n${path}\n${bodyText}`;
  const signature=await crypto.webcrypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},await signingKey(),new TextEncoder().encode(canonical));
  return{'x-hub-ts':ts,'x-hub-signature':Buffer.from(signature).toString('base64url')};
}
async function remote(path,options={}){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10500);
  try{
    const method=options.method||'GET',body=options.body||'';
    const headers=method==='POST'?await signedHeaders(path,method,body):{};
    const response=await fetch(FAIRSHIFT_BASE+path,{method,body:method==='POST'?body:undefined,signal:controller.signal,
      headers:{Accept:'application/json',...headers,...(method==='POST'?{'Content-Type':'application/json'}:{})}});
    const data=await response.json().catch(()=>({}));
    return{ok:response.ok,status:response.status,data};
  }catch(error){
    return{ok:false,status:502,data:{error:error?.name==='AbortError'?'Cleaning scheduler timed out.':'Cleaning scheduler is temporarily unavailable.'}};
  }finally{clearTimeout(timer);}
}
function dateOK(s){
  return DATE.test(s)&&!Number.isNaN(Date.parse(s+'T12:00:00Z'))&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;
}
function easternToday(){
  const p=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const v=Object.fromEntries(p.map(x=>[x.type,x.value]));return `${v.year}-${v.month}-${v.day}`;
}
function sanitize(payload,action){
  const dates=['assignmentDate','availabilityDate','startDate','endDate'];
  const out={action};
  if(action==='acceptCleaningSuggestions'){
    if(!Array.isArray(payload.entries)||payload.entries.length<1||payload.entries.length>50)throw new Error('Choose 1–50 assignments for a single week.');
    out.entries=payload.entries.map(row=>({
      employeeId:Number(row.employeeId),alternateEmployeeId:Number(row.alternateEmployeeId)||null,
      assignmentDate:str(row.assignmentDate,10),department:str(row.department,100)
    }));
    for(const row of out.entries)if(!Number.isSafeInteger(row.employeeId)||row.employeeId<1||!dateOK(row.assignmentDate)||!row.department)throw new Error('Invalid weekly assignment.');
    if(new Set(out.entries.map(r=>r.department+':'+r.assignmentDate)).size!==out.entries.length)throw new Error('Duplicate area and date in schedule.');
    const first=out.entries.map(r=>r.assignmentDate).sort()[0],w=new Date(first+'T12:00:00Z').getUTCDay();
    const start=new Date(first+'T12:00:00Z');start.setUTCDate(start.getUTCDate()-(w===0?6:w-1));
    const end=new Date(start);end.setUTCDate(start.getUTCDate()+4);
    if(out.entries.some(r=>r.assignmentDate<start.toISOString().slice(0,10)||r.assignmentDate>end.toISOString().slice(0,10)))throw new Error('A weekly schedule must stay within one Monday–Friday week.');
  }else if(action==='setCleaningSchedule'){
    Object.assign(out,{employeeId:Number(payload.employeeId)||0,alternateEmployeeId:Number(payload.alternateEmployeeId)||null,
      assignmentDate:str(payload.assignmentDate,10),department:str(payload.department,100)});
    if(!dateOK(out.assignmentDate)||!out.department||out.employeeId<0)throw new Error('Choose a valid cleaner, area and date.');
  }else if(action==='setAvailability'||action==='setAvailabilityRange'){
    out.employeeId=Number(payload.employeeId);
    out.status=str(payload.status,20);
    if(!Number.isSafeInteger(out.employeeId)||out.employeeId<1||!['available','unavailable'].includes(out.status))throw new Error('Invalid availability.');
    if(action==='setAvailability')out.availabilityDate=str(payload.availabilityDate,10);
    else{out.startDate=str(payload.startDate,10);out.endDate=str(payload.endDate,10);}
  }else if(action==='markCleaningAbsent'||action==='useCleaningAlternate'){
    out.assignmentId=Number(payload.assignmentId);
    if(!Number.isSafeInteger(out.assignmentId)||out.assignmentId<1)throw new Error('Invalid assignment.');
  }else if(action==='clearCleaningScheduleDays'){
    if(!Array.isArray(payload.dates)||!payload.dates.length||payload.dates.length>5)throw new Error('Select 1–5 dates.');
    out.dates=[...new Set(payload.dates.map(d=>str(d,10)))];
  }else throw new Error('Unsupported cleaning action.');
  for(const key of dates)if(out[key]!==undefined&&!dateOK(out[key]))throw new Error('Invalid date.');
  if(action==='setAvailabilityRange'&&out.endDate<out.startDate)throw new Error('End date must be on or after start date.');
  if(action==='clearCleaningScheduleDays'&&out.dates.some(d=>!dateOK(d)))throw new Error('Invalid schedule date.');
  const today=easternToday();
  for(const date of [...dates.map(key=>out[key]).filter(Boolean),...(out.dates||[]),...(out.entries||[]).map(x=>x.assignmentDate)])
    if(date<today&&action!=='setAvailabilityRange')throw new Error('Past schedules cannot be changed through Hub.');
  return out;
}
export default async(request)=>{
  const session=sessionFrom(request);
  if(!session)return json(401,{error:'Sign in to Warehouse Hub to use Cleaning & Rotations.'});
  const role=roleOf(session);
  if(request.method==='GET'){
    const url=new URL(request.url),date=str(url.searchParams.get('date')||easternToday(),10);
    if(!dateOK(date))return json(400,{error:'Invalid date.'});
    const result=await remote('/api/dashboard?date='+encodeURIComponent(date));
    if(!result.ok)return json(result.status,{error:str(result.data?.error||'Cleaning data is unavailable.',300)});
    const source=result.data||{};
    let sides;try{sides=await loadSides();}catch(error){return json(503,{error:str(error.message,240)});}
    const departmentSides=new Map((Array.isArray(source.departments)?source.departments:[]).map(d=>[str(d.name,100),sides.get(Number(d.id))||defaultSide(d.name)]));
    return json(200,{
      source:'FairShift (transition)',role,viewer:session.name,date,
      employees:(Array.isArray(source.employees)?source.employees:[]).map(x=>({
        id:Number(x.id),name:str(x.name,100),role:str(x.role,40),active:x.active!==false,
        homeDepartment:str(x.homeDepartment,100)
      })),
      departments:(Array.isArray(source.departments)?source.departments:[]).map(x=>({
        id:Number(x.id),name:str(x.name,100),cleaningActive:x.cleaningActive===true,active:x.active!==false,
        side:sides.get(Number(x.id))||defaultSide(x.name)
      })),
      assignments:(Array.isArray(source.assignments)?source.assignments:[]).filter(x=>x.type==='cleaning').map(x=>({
        id:Number(x.id),date:str(x.assignmentDate,10),area:str(x.toDepartment||x.homeDepartment,100),
        side:departmentSides.get(str(x.toDepartment||x.homeDepartment,100))||defaultSide(x.toDepartment||x.homeDepartment),
        employeeId:Number(x.employeeId),alternateEmployeeId:Number(x.alternateEmployeeId)||null,
        actualEmployeeId:Number(x.actualEmployeeId)||null,status:str(x.dutyStatus,40),
        startTime:x.startTime||null,endTime:x.endTime||null,
        createdBy:str(x.createdBy,120),createdAt:x.createdAt||null
      })),
      availability:(Array.isArray(source.availability)?source.availability:[]).map(x=>({
        employeeId:Number(x.employeeId),date:str(x.availabilityDate,10),status:str(x.status,30)
      }))
    });
  }
  if(request.method!=='POST')return json(405,{error:'Method not allowed.'});
  if(role!=='admin'&&role!=='lead')return json(403,{error:'Admin or Team Lead access required to change the cleaning schedule.'});
  const body=await request.json().catch(()=>({}));
  const action=str(body.action,60);
  if(action==='setCleaningAreaSide'){
    if(role!=='admin')return json(403,{error:'Admin access is required to designate Inbound or Outbound areas.'});
    const departmentId=Number(body.departmentId),side=str(body.side,20);
    if(!Number.isSafeInteger(departmentId)||departmentId<1||!['Inbound','Outbound'].includes(side))return json(400,{error:'Choose a valid department and side.'});
    const live=await remote('/api/dashboard?date='+encodeURIComponent(easternToday()));
    if(!live.ok)return json(503,{error:'Could not verify the current department roster.'});
    const department=(live.data.departments||[]).find(d=>Number(d.id)===departmentId);
    if(!department)return json(404,{error:'Department is no longer in the warehouse roster.'});
    try{
      await ensureAreaSchema();
      await pool().query(`INSERT INTO hub_cleaning_area_sides(department_id,department_name,side,updated_by,updated_at)
        VALUES($1,$2,$3,$4,NOW()) ON CONFLICT(department_id) DO UPDATE SET
        department_name=EXCLUDED.department_name,side=EXCLUDED.side,updated_by=EXCLUDED.updated_by,updated_at=NOW()`,
        [departmentId,str(department.name,100),side,str(session.name,100)]);
      return json(200,{ok:true,departmentId,side});
    }catch(error){return json(503,{error:str(error.message,240)});}
  }
  const adminOnly=new Set(['acceptCleaningSuggestions','clearCleaningScheduleDays','setAvailabilityRange']);
  if(adminOnly.has(action)&&role!=='admin')return json(403,{error:'Admin access required for weekly scheduling and leave ranges.'});
  let payload;
  try{payload=sanitize(body,action);}catch(error){return json(400,{error:error.message});}
  if(role==='lead'){
    const current=easternToday();
    if(action==='setCleaningSchedule'&&payload.assignmentDate!==current)return json(403,{error:'Team Leads can reassign today only.'});
    if(action==='setAvailability'&&payload.availabilityDate!==current)return json(403,{error:'Team Leads can change today’s availability only.'});
  }
  if(action==='markCleaningAbsent'||action==='useCleaningAlternate'
    || action==='setCleaningSchedule'||action==='acceptCleaningSuggestions'||action==='clearCleaningScheduleDays'){
    const state=await remote('/api/dashboard?date='+easternToday());
    if(!state.ok)return json(503,{error:'Could not verify current assignment state.'});
    const all=(state.data.assignments||[]).filter(x=>x.type==='cleaning');
    if(action==='markCleaningAbsent'||action==='useCleaningAlternate'){
      const duty=all.find(x=>Number(x.id)===payload.assignmentId);
      if(!duty||duty.dutyStatus==='completed')return json(409,{error:'This cleaning assignment is complete or no longer exists.'});
      if(duty.dutyStatus==='in_progress')return json(409,{error:'Cleaning has already started. Finish or resolve the duty before reassigning.'});
      if(duty.assignmentDate<easternToday())return json(409,{error:'Past assignments cannot be changed.'});
      if(role==='lead'&&duty.assignmentDate!==easternToday())return json(403,{error:'Team Leads can change today’s assignments only.'});
    }
    if(action==='setCleaningSchedule'||action==='acceptCleaningSuggestions'||action==='clearCleaningScheduleDays'){
      const updates=action==='setCleaningSchedule'?[payload]:action==='acceptCleaningSuggestions'?payload.entries:[];
      const dates=action==='clearCleaningScheduleDays'?payload.dates:updates.map(x=>x.assignmentDate);
      if(all.some(x=>dates.includes(x.assignmentDate)&&['completed','in_progress'].includes(x.dutyStatus)
        &&(action==='clearCleaningScheduleDays'
          ||updates.some(d=>d.assignmentDate===x.assignmentDate&&d.department===x.toDepartment))))
        return json(409,{error:'Completed cleaning records are protected. They cannot be replaced or cleared.'});
      if(action==='acceptCleaningSuggestions'){
        const daily=new Map();
        for(const r of updates){
          if(!daily.has(r.assignmentDate))daily.set(r.assignmentDate,new Set());
          const used=daily.get(r.assignmentDate);
          for(const id of [r.employeeId,r.alternateEmployeeId].filter(Boolean)){
            if(used.has(id))return json(409,{error:'The same person cannot be assigned to two areas on one day.'});
            used.add(id);
          }
        }
      }
    }
  }
  const res=await remote('/api/dashboard',{method:'POST',body:JSON.stringify(payload)});
  return json(res.status,res.ok?{ok:true,...res.data}:{
    error:str(res.data?.error||'Could not update cleaning in FairShift.',300),
    bridgeMissing:res.status===403
  });
};
