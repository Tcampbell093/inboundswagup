import pg from 'pg';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import seedCipher from '../netlify/functions/attendance-seed-data.mjs';

const { Pool } = pg;
const connectionString=process.env.DATABASE_URL;
const keyText=process.env.ATTENDANCE_IMPORT_KEY;
if(!connectionString) throw new Error('DATABASE_URL missing during attendance import');
if(!keyText) throw new Error('ATTENDANCE_IMPORT_KEY missing during attendance import');

function decryptSeed(){
  const key=Buffer.from(keyText,'base64');
  if(key.length!==32)throw new Error('Invalid attendance import key');
  const raw=Buffer.from(seedCipher,'base64'),nonce=raw.subarray(0,12),body=raw.subarray(12),tag=body.subarray(body.length-16),cipher=body.subarray(0,body.length-16);
  const d=crypto.createDecipheriv('aes-256-gcm',key,nonce);
  d.setAAD(Buffer.from('attendance-import-v1'));
  d.setAuthTag(tag);
  return JSON.parse(zlib.inflateSync(Buffer.concat([d.update(cipher),d.final()])).toString('utf8'));
}

const db=new Pool({connectionString,ssl:{rejectUnauthorized:false}});
try{
  const data=decryptSeed();
  if(data?.version!==1||data.people?.length!==36||data.records?.length!==3694)throw new Error('Attendance seed payload validation failed');

  await db.query(`
    CREATE TABLE IF NOT EXISTS hub_attendance_settings(settings_key TEXT PRIMARY KEY,statuses_json JSONB NOT NULL DEFAULT '[]'::jsonb,thresholds_json JSONB NOT NULL DEFAULT '[]'::jsonb,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_by TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS hub_attendance_people(person_key TEXT PRIMARY KEY,name TEXT NOT NULL,current_department TEXT NOT NULL DEFAULT 'Unassigned',sizes TEXT NOT NULL DEFAULT '',active BOOLEAN NOT NULL DEFAULT TRUE,source TEXT NOT NULL DEFAULT 'manual',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS hub_attendance_departments(name TEXT PRIMARY KEY,active BOOLEAN NOT NULL DEFAULT TRUE,sort_order INTEGER NOT NULL DEFAULT 100,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS hub_attendance_records(id UUID PRIMARY KEY,employee_key TEXT NOT NULL,employee_name TEXT NOT NULL,department TEXT NOT NULL,attendance_date DATE NOT NULL,status_id TEXT NOT NULL,status_label TEXT NOT NULL,points NUMERIC(8,2) NOT NULL DEFAULT 0,note TEXT NOT NULL DEFAULT '',recorded_by TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  `);
  await db.query(`
    ALTER TABLE hub_attendance_records ADD COLUMN IF NOT EXISTS assignment TEXT NOT NULL DEFAULT '';
    ALTER TABLE hub_attendance_records ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';
    ALTER TABLE hub_attendance_records ADD COLUMN IF NOT EXISTS source_ref TEXT NOT NULL DEFAULT '';
    ALTER TABLE hub_attendance_records ADD COLUMN IF NOT EXISTS source_json JSONB NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE hub_attendance_records DROP CONSTRAINT IF EXISTS hub_attendance_records_employee_key_attendance_date_key;
    CREATE UNIQUE INDEX IF NOT EXISTS hub_attendance_records_source_ref_uidx ON hub_attendance_records(source_ref) WHERE source_ref<>'';
  `);

  const client=await db.connect();
  try{
    await client.query('BEGIN');

    await client.query(`
      INSERT INTO hub_attendance_departments(name,active,sort_order,created_at,updated_at)
      SELECT x.name,COALESCE(x.active,TRUE),100,NOW(),NOW()
      FROM jsonb_to_recordset($1::jsonb) AS x(name text,active boolean)
      ON CONFLICT(name) DO UPDATE SET active=EXCLUDED.active,updated_at=NOW()
    `,[JSON.stringify(data.departments||[])]);

    await client.query(`
      INSERT INTO hub_attendance_people(person_key,name,current_department,sizes,active,source,created_at,updated_at)
      SELECT x."personKey",x.name,COALESCE(NULLIF(x."currentDepartment",''),'Unassigned'),COALESCE(x.sizes,''),COALESCE(x.active,TRUE),'excel',NOW(),NOW()
      FROM jsonb_to_recordset($1::jsonb) AS x("personKey" text,name text,"currentDepartment" text,sizes text,active boolean)
      ON CONFLICT(person_key) DO UPDATE SET name=EXCLUDED.name,current_department=EXCLUDED.current_department,sizes=EXCLUDED.sizes,active=EXCLUDED.active,source='excel',updated_at=NOW()
    `,[JSON.stringify(data.people)]);

    const rows=data.records.map(r=>({...r,uuid:crypto.randomUUID()}));
    await client.query(`
      INSERT INTO hub_attendance_records(id,employee_key,employee_name,department,assignment,attendance_date,status_id,status_label,points,note,recorded_by,source,source_ref,source_json,created_at,updated_at)
      SELECT x.uuid::uuid,x."personKey",x."employeeName",x.department,COALESCE(x.assignment,''),x.date::date,x."statusId",x."statusLabel",COALESCE(x.points,0),COALESCE(x.note,''),'Excel Import','excel',x."sourceRef",COALESCE(x."sourceJson",'{}'::jsonb),NOW(),NOW()
      FROM jsonb_to_recordset($1::jsonb) AS x(uuid text,"personKey" text,"employeeName" text,department text,assignment text,date text,"statusId" text,"statusLabel" text,points numeric,note text,"sourceRef" text,"sourceJson" jsonb)
      ON CONFLICT(source_ref) WHERE source_ref<>'' DO NOTHING
    `,[JSON.stringify(rows)]);

    await client.query('COMMIT');
  }catch(error){
    try{await client.query('ROLLBACK')}catch{}
    throw error;
  }finally{
    client.release();
  }

  const result=await db.query(`
    SELECT
      (SELECT COUNT(*)::int FROM hub_attendance_people WHERE source='excel') excel_people,
      (SELECT COUNT(*)::int FROM hub_attendance_records WHERE source='excel') excel_records,
      (SELECT COALESCE(ROUND(SUM(points)::numeric,2),0)::float8 FROM hub_attendance_records WHERE source='excel') excel_points,
      (SELECT to_char(MIN(attendance_date),'YYYY-MM-DD') FROM hub_attendance_records WHERE source='excel') min_date,
      (SELECT to_char(MAX(attendance_date),'YYYY-MM-DD') FROM hub_attendance_records WHERE source='excel') max_date
  `);
  const v=result.rows[0];
  if(Number(v.excel_people)!==36)throw new Error('Attendance import verification failed: people');
  if(Number(v.excel_records)!==3694)throw new Error('Attendance import verification failed: records');
  if(Number(v.excel_points)!==41)throw new Error('Attendance import verification failed: points');
  if(v.min_date!=='2026-03-10'||v.max_date!=='2026-09-29')throw new Error('Attendance import verification failed: date range');
  console.log('Attendance history import verified:',JSON.stringify(v));
}finally{
  await db.end();
}
