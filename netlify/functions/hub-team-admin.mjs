import crypto from 'node:crypto';
import pg from 'pg';
import schedule from './_hub_schedule.js';

const SESSION_COOKIE = 'hub_associate_session';
const SESSION_VERSION = 2;
const ALLOWED_ACTIONS = new Set([
  'addEmployee',
  'updateEmployee',
  'addDepartment',
  'updateDepartment',
  'removeDepartment',
  'setCleaningDepartment',
]);

function env(name) {
  return globalThis.Netlify?.env?.get(name) || '';
}

function clean(value, max = 300) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function safeEqual(a, b) {
  if (!a || !b) return false;
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function cookieMap(request) {
  const raw = request.headers.get('cookie') || '';
  return Object.fromEntries(raw.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf('=');
    return index === -1 ? [part, ''] : [part.slice(0, index), part.slice(index + 1)];
  }));
}

function sessionKey() {
  const secret = env('HUB_ASSOCIATE_SESSION_SECRET');
  return secret ? crypto.createHash('sha256').update(secret).digest() : null;
}

function hubSession(request) {
  try {
    const key = sessionKey();
    const token = cookieMap(request)[SESSION_COOKIE];
    if (!key || !token) return null;
    const [ivText, tagText, dataText] = String(token).split('.');
    if (!ivText || !tagText || !dataText) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivText, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(dataText, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
    const payload = JSON.parse(plain);
    if (payload?.v !== SESSION_VERSION || !payload?.name || Number(payload.exp || 0) <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function managerAuthorized(request) {
  const keyOk = safeEqual(request.headers.get('x-hub-key') || '', env('HUB_MANAGER_KEY'));
  if (keyOk) return true;
  return String(hubSession(request)?.role || '').toLowerCase() === 'manager';
}

function todayEastern() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

let poolInstance = null;
function getPool() {
  const connectionString = env('DATABASE_URL') || process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not configured.');
  if (!poolInstance) poolInstance = new pg.Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  return poolInstance;
}

function cleanEmployee(employee) {
  return {
    id: Number(employee?.id) || 0,
    name: clean(employee?.name, 100),
    homeDepartment: clean(employee?.homeDepartment, 100) || 'Unassigned',
    role: ['Associate', 'Team Lead', 'Manager'].includes(employee?.role) ? employee.role : clean(employee?.role, 60) || 'Associate',
    active: employee?.active !== false,
  };
}

function cleanDepartment(department) {
  return {
    id: Number(department?.id) || 0,
    name: clean(department?.name, 100),
    active: department?.active !== false,
    cleaningActive: department?.cleaningActive === true,
  };
}

export default async (request) => {
  if (!managerAuthorized(request)) return json(401, { error: 'Admin access denied.' });

  if (request.method === 'GET') {
    try {
      const db = getPool();
      await schedule.ensureImported(db);
      return json(200, {
        employees: (await schedule.employees(db)).map(cleanEmployee),
        departments: (await schedule.departments(db)).map(cleanDepartment),
      });
    } catch (error) {
      return json(error?.status || 503, { error: clean(error?.status ? error.message : 'Could not load the team list.', 300) });
    }
  }

  if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });

  const body = await request.json().catch(() => ({}));
  const action = clean(body.action, 40);
  if (!ALLOWED_ACTIONS.has(action)) return json(400, { error: 'Unsupported team-management action.' });

  const payload = { ...body, action };
  if (['addEmployee', 'updateEmployee'].includes(action)) {
    const role = clean(payload.role || 'Associate', 40);
    if (!['Associate', 'Team Lead', 'Manager'].includes(role)) return json(400, { error: 'Choose Associate, Team Lead, or Admin.' });
    payload.role = role;
  }

  let result;
  try {
    result = await schedule.applyTeamAction(getPool(), payload);
  } catch (error) {
    if (error instanceof schedule.ScheduleError) return json(error.status, { error: clean(error.message, 300) });
    console.warn('hub-team-admin update failed:', error?.message);
    return json(503, { error: 'Could not save the change. Please try again.' });
  }

  // An employee who is no longer an Admin must not keep receiving background
  // inventory notifications on previously enrolled desktops.
  if(action==='updateEmployee'&&(payload.role!=='Manager'||payload.active===false)){
    const employeeId=Number(payload.id);
    if(Number.isSafeInteger(employeeId)&&employeeId>0){
      try{
        await getPool().query('UPDATE hub_admin_push_subscriptions SET enabled=FALSE,updated_at=NOW() WHERE employee_id=$1',[employeeId]);
      }catch(error){
        // The push table may not exist yet if nobody has enabled notifications.
        if(error.code!=='42P01')console.warn('Could not revoke former Admin push subscriptions:',error.message);
      }
    }
  }
  return json(200, result);
};
