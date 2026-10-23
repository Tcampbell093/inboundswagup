const crypto = require('crypto');

const HUB_SESSION_COOKIE = 'hub_associate_session';
const HUB_SESSION_VERSION = 2;

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

function clean(value, max = 2000) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function safeEqual(a, b) {
  if (!a || !b) return false;
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function cookieMap(event) {
  const raw = event.headers?.cookie || event.headers?.Cookie || '';
  return Object.fromEntries(
    String(raw).split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
      const index = part.indexOf('=');
      return index === -1 ? [part, ''] : [part.slice(0, index), part.slice(index + 1)];
    }),
  );
}

function hubSession(event) {
  try {
    const secret = process.env.HUB_ASSOCIATE_SESSION_SECRET || '';
    const token = cookieMap(event)[HUB_SESSION_COOKIE];
    if (!secret || !token) return null;
    const key = crypto.createHash('sha256').update(secret).digest();
    const [ivText, tagText, dataText] = String(token).split('.');
    if (!ivText || !tagText || !dataText) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivText, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(dataText, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
    const payload = JSON.parse(plain);
    if (payload?.v !== HUB_SESSION_VERSION || !payload?.name || Number(payload.exp || 0) <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function managerAuthorized(event) {
  if (safeEqual(event.headers?.['x-hub-key'] || event.headers?.['X-Hub-Key'] || '', process.env.HUB_MANAGER_KEY || '')) {
    return true;
  }
  return String(hubSession(event)?.role || '').toLowerCase() === 'manager';
}

function extractJson(text) {
  const raw = String(text || '').trim();
  try {
    return JSON.parse(raw);
  } catch {}
  const fenced = raw.replace(/^\`\`\`(?:json)?\s*/i, '').replace(/\s*\`\`\`$/i, '');
  try {
    return JSON.parse(fenced);
  } catch {}
  const first = fenced.indexOf('{');
  const last = fenced.lastIndexOf('}');
  if (first >= 0 && last > first) return JSON.parse(fenced.slice(first, last + 1));
  throw new Error('Translation response could not be read.');
}

function promptFor(mode, fields) {
  const languageInstruction = mode === 'spanish'
    ? 'Translate the content into natural, clear Latin American Spanish suitable for warehouse associates.'
    : mode === 'english'
      ? 'Translate the content into clear, natural American English suitable for warehouse associates.'
      : 'Create a concise bilingual English + Latin American Spanish version suitable for warehouse associates.';

  const formatInstruction = mode === 'bilingual'
    ? `Return user-ready bilingual fields.
- title: use "English title / Título en español". Shorten naturally if needed so the entire title is at most 120 characters.
- message: use exactly this structure when message exists:
ENGLISH
<English message>

ESPAÑOL
<Spanish message>
Keep the entire message at most 1200 characters.
- questionText: if a question exists, use exactly this structure:
ENGLISH
<English question>

ESPAÑOL
<Spanish question>
Keep the entire questionText at most 500 characters.`
    : `Return only the translated version of each non-empty field.
Keep title at most 120 characters, message at most 1200 characters, and questionText at most 500 characters.`;

  return `You translate short workplace announcements for a bilingual warehouse team.

${languageInstruction}

Rules:
- Preserve the exact meaning, tone, urgency, names, dates, quantities, acronyms, product names, department names, PO numbers, QA terminology, and safety language.
- Do not add facts, advice, explanations, greetings, or commentary that were not in the source.
- Keep formatting simple and readable.
- Preserve emojis when they are meaningful.
- "QA Receiving", "QA Prep", "Assembly", "PO", "UPH", "Pack Builder", and similar workplace terms should stay recognizable; translate naturally only when doing so will not create confusion.
- Do not translate URLs, codes, IDs, or people's names.
- If a field is empty, return it as an empty string.
- ${formatInstruction}

Return ONLY valid JSON in this exact shape:
{"title":"...","message":"...","questionText":"...","detectedLanguage":"English|Spanish|Mixed|Other"}

SOURCE:
${JSON.stringify(fields)}`;
}

async function callGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY || '';
  if (!apiKey) throw new Error('Translation is not configured yet.');

  // Keep translation on the low-latency stable models. Do not fall through
  // to 3.8 Flash: it is excellent for complex reasoning, but unnecessary for
  // a short translation and can exceed this function's request window.
  const models = ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-3.6-flash'];
  let lastError = null;
  const failures = [];

  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const controller = new AbortController();
      const timeoutMs = model === 'gemini-3.6-flash' ? 8000 : 6000;
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      let response;
      try {
        response = await fetch(url, {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              maxOutputTokens: 800,
              responseMimeType: 'application/json',
            },
          }),
        });
      } finally {
        clearTimeout(timeout);
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = data?.error?.message || `Translation service returned ${response.status}.`;
        failures.push(`${model}: ${response.status} ${message}`);
        lastError = new Error(message);
        continue;
      }
      const text = data?.candidates?.[0]?.content?.parts?.map((part) => part?.text || '').join('') || '';
      if (!text) throw new Error('Translation service returned an empty response.');
      return extractJson(text);
    } catch (error) {
      lastError = error?.name === 'AbortError'
        ? new Error(`${model} took too long to respond.`)
        : error;
      failures.push(`${model}: ${lastError.message}`);
    }
  }

  console.warn('All translation models failed:', failures.join(' | '));
  throw new Error('Translation service is temporarily unavailable. Please try again.');
}

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' });
  if (!managerAuthorized(event)) return json(403, { error: 'Admin access is required.' });

  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid request.' });
  }

  const mode = ['spanish', 'english', 'bilingual'].includes(body.mode) ? body.mode : '';
  if (!mode) return json(400, { error: 'Choose Spanish, English, or Bilingual.' });

  const fields = {
    title: clean(body.title, 120),
    message: clean(body.message, 1200),
    questionText: clean(body.questionText, 500),
  };
  if (!fields.title && !fields.message && !fields.questionText) {
    return json(400, { error: 'Type an announcement or question before translating.' });
  }

  try {
    const translated = await callGemini(promptFor(mode, fields));
    const title = clean(translated?.title, 120);
    const message = clean(translated?.message, 1200);
    const questionText = clean(translated?.questionText, 500);
    return json(200, {
      ok: true,
      mode,
      detectedLanguage: clean(translated?.detectedLanguage, 40),
      title,
      message,
      questionText,
    });
  } catch (error) {
    console.warn('hub translation failed:', error?.message);
    return json(502, { error: clean(error?.message || 'Translation is temporarily unavailable.', 300) });
  }
};
