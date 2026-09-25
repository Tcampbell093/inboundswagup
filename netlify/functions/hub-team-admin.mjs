import crypto from 'node:crypto';

const FAIRSHIFT_BASE = 'https://fairshift-rotations.thandoyordani.chatgpt.site';
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

let signingKeyPromise = null;
async function signingKey() {
  if (signingKeyPromise) return signingKeyPromise;
  const pem = env('FAIRSHIFT_HUB_SIGNING_PRIVATE_KEY');
  if (!pem) throw new Error('FairShift Hub signing key is not configured.');
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----/g, '').replace(/-----END PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  const der = Buffer.from(body, 'base64');
  signingKeyPromise = crypto.webcrypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  return signingKeyPromise;
}

async function signedHeaders(path, method, bodyText) {
  const timestamp = String(Date.now());
  const canonical = `${timestamp}\n${method.toUpperCase()}\n${path}\n${bodyText}`;
  const key = await signingKey();
  const signature = await crypto.webcrypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(canonical),
  );
  return {
    'x-hub-ts': timestamp,
    'x-hub-signature': Buffer.from(signature).toString('base64url'),
  };
}

async function fairShift(path, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const bodyText = typeof options.body === 'string' ? options.body : '';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const auth = await signedHeaders(path, method, bodyText);
    const response = await fetch(`${FAIRSHIFT_BASE}${path}`, {
      ...options,
      signal: controller.signal,
      headers: { Accept: 'application/json', ...auth, ...(options.headers || {}) },
    });
    const body = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    return {
      ok: false,
      status: 502,
      body: { error: error?.name === 'AbortError' ? 'FairShift took too long to respond.' : 'FairShift is temporarily unavailable.' },
    };
  } finally {
    clearTimeout(timeout);
  }
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
  if (!managerAuthorized(request)) return json(401, { error: 'Manager access denied.' });

  if (request.method === 'GET') {
    const path = `/api/dashboard?date=${encodeURIComponent(todayEastern())}`;
    const result = await fairShift(path);
    if (!result.ok) return json(result.status, { error: clean(result.body?.error || 'Could not load FairShift team data.', 300) });
    return json(200, {
      employees: (Array.isArray(result.body?.employees) ? result.body.employees : []).map(cleanEmployee),
      departments: (Array.isArray(result.body?.departments) ? result.body.departments : []).map(cleanDepartment),
    });
  }

  if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });

  const body = await request.json().catch(() => ({}));
  const action = clean(body.action, 40);
  if (!ALLOWED_ACTIONS.has(action)) return json(400, { error: 'Unsupported team-management action.' });

  const payload = { ...body, action };
  if (['addEmployee', 'updateEmployee'].includes(action)) {
    const role = clean(payload.role || 'Associate', 40);
    if (!['Associate', 'Team Lead', 'Manager'].includes(role)) return json(400, { error: 'Choose Associate, Team Lead, or Manager.' });
    payload.role = role;
  }

  const bodyText = JSON.stringify(payload);
  const result = await fairShift('/api/dashboard', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: bodyText,
  });

  if (!result.ok) {
    const raw = clean(result.body?.error || 'FairShift rejected the change.', 300);
    const bridgeMissing = result.status === 403 && /read-only|editor/i.test(raw);
    return json(result.status, {
      error: bridgeMissing
        ? 'FairShift still needs the Warehouse Hub manager bridge update before roster changes can be saved here.'
        : raw,
      bridgeMissing,
    });
  }

  return json(result.status || 200, result.body || { ok: true });
};
