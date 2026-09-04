const FAIRSHIFT_BASE = 'https://fairshift-rotations.thandoyordani.chatgpt.site';

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
  const employeeName = cleanText(body.employeeName, 100);
  const pin = cleanText(body.pin, 8);

  if (!['start', 'finish'].includes(action)) return json(400, { error: 'Invalid cleaning action.' });
  if (!assignmentId || !employeeName || !/^\d{4,8}$/.test(pin)) return json(400, { error: 'Employee name and a 4–8 digit cleaning PIN are required.' });

  return forward(`${FAIRSHIFT_BASE}/api/checkin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ action, assignmentId, employeeName, pin }),
  });
};
