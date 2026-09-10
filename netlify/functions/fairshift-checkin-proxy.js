const crypto = require('crypto');
const FAIRSHIFT_BASE = 'https://fairshift-rotations.thandoyordani.chatgpt.site';
const SESSION_COOKIE = 'hub_associate_session';

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

function cleanText(value, max = 120) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function sessionKey() {
  const secret = process.env.HUB_ASSOCIATE_SESSION_SECRET || '';
  return secret ? crypto.createHash('sha256').update(secret).digest() : null;
}

function cookieValue(event, name) {
  const raw = event.headers?.cookie || event.headers?.Cookie || '';
  for (const part of String(raw).split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${name}=`)) return trimmed.slice(name.length + 1);
  }
  return '';
}

function sessionFromEvent(event) {
  try {
    const key = sessionKey();
    const token = cookieValue(event, SESSION_COOKIE);
    if (!key || !token) return null;
    const [ivText, tagText, dataText] = token.split('.');
    if (!ivText || !tagText || !dataText) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivText, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
    const plain = Buffer.concat([decipher.update(Buffer.from(dataText, 'base64url')), decipher.final()]).toString('utf8');
    const payload = JSON.parse(plain);
    if (!payload?.name || !payload?.pin || Number(payload.exp || 0) <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

async function forward(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let body;
    try { body = text ? JSON.parse(text) : {}; }
    catch { body = { error: 'FairShift returned an unreadable response.' }; }
    return json(response.status, body);
  } catch (error) {
    return json(502, { error: error?.name === 'AbortError' ? 'FairShift took too long to respond.' : 'FairShift check-in is temporarily unavailable.' });
  } finally {
    clearTimeout(timeout);
  }
}

exports.handler = async function handler(event) {
  if (event.httpMethod === 'GET') {
    const assignmentId = Number(event.queryStringParameters?.assignmentId);
    if (!assignmentId) return json(400, { error: 'A valid assignment ID is required.' });
    return forward(`${FAIRSHIFT_BASE}/api/checkin?assignmentId=${encodeURIComponent(assignmentId)}`, {
      headers: { Accept: 'application/json' },
    });
  }

  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { error: 'Invalid request body.' }); }

  const action = cleanText(body.action, 12);
  const assignmentId = Number(body.assignmentId);
  const session = sessionFromEvent(event);
  const employeeName = cleanText(session?.name || body.employeeName, 100);
  const pin = cleanText(session?.pin || body.pin, 8);

  if (!['start', 'finish'].includes(action)) return json(400, { error: 'Invalid cleaning action.' });
  if (!assignmentId || !employeeName || !/^\d{4,8}$/.test(pin)) return json(400, { error: 'Sign in to the Hub or enter your employee name and 4–8 digit cleaning PIN.' });

  return forward(`${FAIRSHIFT_BASE}/api/checkin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ action, assignmentId, employeeName, pin }),
  });
};
