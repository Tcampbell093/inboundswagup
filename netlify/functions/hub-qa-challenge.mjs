import pg from 'pg';
import crypto from 'node:crypto';

const { Pool } = pg;
const SESSION_COOKIE = 'hub_associate_session';
const SESSION_VERSION = 2;
const MAX_IMAGE_BYTES = 900000;
const VALID_ISSUES = new Set([
  'item','color','quantity','placement','size','imprint','imprintColor','quality','damage','other'
]);

let poolInstance = null;
let schemaReady = false;

function env(name) {
  return globalThis.Netlify?.env?.get(name) || '';
}

function getPool() {
  const connectionString = env('DATABASE_URL');
  if (!connectionString) throw new Error('DATABASE_URL is not configured.');
  if (!poolInstance) poolInstance = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  return poolInstance;
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

function cookieMap(request) {
  const raw = request.headers.get('cookie') || '';
  return Object.fromEntries(raw.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const idx = part.indexOf('=');
    return idx === -1 ? [part, ''] : [part.slice(0, idx), part.slice(idx + 1)];
  }));
}

function sessionKey() {
  const secret = env('HUB_ASSOCIATE_SESSION_SECRET');
  if (!secret) throw new Error('HUB_ASSOCIATE_SESSION_SECRET is not configured.');
  return crypto.createHash('sha256').update(secret).digest();
}

function decryptSession(token) {
  try {
    const [ivText, tagText, dataText] = String(token || '').split('.');
    if (!ivText || !tagText || !dataText) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', sessionKey(), Buffer.from(ivText, 'base64url'));
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

function currentSession(request) {
  return decryptSession(cookieMap(request)[SESSION_COOKIE]);
}

function isManager(session) {
  return clean(session?.role, 60).toLowerCase() === 'manager';
}

function decodeImageDataUrl(value) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(value || ''));
  if (!match) throw new Error('Choose a JPG, PNG, or WebP image.');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length) throw new Error('That image could not be read.');
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error('That image is still too large after processing.');
  return { mimeType: match[1], bytes };
}

async function ensureSchema() {
  if (schemaReady) return;
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS hub_qa_challenge_cases (
      id TEXT PRIMARY KEY,
      item_no TEXT NOT NULL DEFAULT '',
      product TEXT NOT NULL DEFAULT '',
      product_color TEXT NOT NULL DEFAULT '',
      quantity TEXT NOT NULL DEFAULT '',
      imprint_type TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '',
      dimensions TEXT NOT NULL DEFAULT '',
      imprint_color TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      answer TEXT NOT NULL DEFAULT 'reject',
      issues JSONB NOT NULL DEFAULT '[]'::jsonb,
      explanation TEXT NOT NULL DEFAULT '',
      approved_mime_type TEXT NOT NULL,
      approved_image BYTEA NOT NULL,
      sample_mime_type TEXT NOT NULL,
      sample_image BYTEA NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS hub_qa_challenge_cases_active_idx
      ON hub_qa_challenge_cases(active, created_at DESC);
  `);
  schemaReady = true;
}

function casePayload(row) {
  return {
    id: row.id,
    item: row.item_no || '',
    product: row.product || '',
    color: row.product_color || '',
    qty: row.quantity || '',
    imprint: row.imprint_type || '',
    location: row.location || '',
    dimensions: row.dimensions || '',
    imprintColor: row.imprint_color || '',
    notes: row.notes || '',
    answer: row.answer === 'approve' ? 'approve' : 'reject',
    issues: Array.isArray(row.issues) ? row.issues : [],
    explanation: row.explanation || '',
    approvedUrl: `/api/qa-challenge?image=${encodeURIComponent(row.id)}&kind=approved`,
    sampleUrl: `/api/qa-challenge?image=${encodeURIComponent(row.id)}&kind=sample`,
    createdAt: row.created_at || null,
    createdBy: row.created_by || '',
  };
}

async function listCases(db) {
  const result = await db.query(`
    SELECT id,item_no,product,product_color,quantity,imprint_type,location,dimensions,
           imprint_color,notes,answer,issues,explanation,created_at,created_by
    FROM hub_qa_challenge_cases
    WHERE active=TRUE
    ORDER BY created_at DESC,id ASC
  `);
  return result.rows.map(casePayload);
}

async function imageResponse(db, id, kind) {
  const columnMime = kind === 'approved' ? 'approved_mime_type' : 'sample_mime_type';
  const columnBytes = kind === 'approved' ? 'approved_image' : 'sample_image';
  const result = await db.query(
    `SELECT ${columnMime} AS mime_type,${columnBytes} AS image_bytes
     FROM hub_qa_challenge_cases WHERE id=$1 AND active=TRUE LIMIT 1`,
    [id],
  );
  const row = result.rows[0];
  if (!row?.image_bytes) return new Response('Image not found.', { status: 404 });
  return new Response(row.image_bytes, {
    status: 200,
    headers: {
      'Content-Type': row.mime_type || 'image/jpeg',
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

async function createCase(db, session, body) {
  const approved = decodeImageDataUrl(body.approvedDataUrl);
  const sample = decodeImageDataUrl(body.sampleDataUrl);
  const answer = body.answer === 'approve' ? 'approve' : 'reject';
  const issues = [...new Set((Array.isArray(body.issues) ? body.issues : [])
    .map((value) => clean(value, 40))
    .filter((value) => VALID_ISSUES.has(value)))];
  if (answer === 'reject' && !issues.length) {
    return { status: 400, body: { error: 'Choose at least one defect for a rejected sample.' } };
  }
  const id = crypto.randomUUID();
  const values = [
    id,
    clean(body.item, 80),
    clean(body.product, 140),
    clean(body.color, 80),
    clean(body.qty, 60),
    clean(body.imprint, 100),
    clean(body.location, 160),
    clean(body.dimensions, 100),
    clean(body.imprintColor, 100),
    clean(body.notes, 500),
    answer,
    JSON.stringify(answer === 'approve' ? [] : issues),
    clean(body.explanation, 700),
    approved.mimeType,
    approved.bytes,
    sample.mimeType,
    sample.bytes,
    clean(session.name, 100),
  ];
  await db.query(`
    INSERT INTO hub_qa_challenge_cases(
      id,item_no,product,product_color,quantity,imprint_type,location,dimensions,
      imprint_color,notes,answer,issues,explanation,
      approved_mime_type,approved_image,sample_mime_type,sample_image,
      active,created_at,created_by,updated_at,updated_by
    )
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16,$17,TRUE,NOW(),$18,NOW(),$18)
  `, values);
  return {
    status: 200,
    body: { ok: true, message: 'QA challenge case added.', cases: await listCases(db) },
  };
}

async function removeCase(db, session, body) {
  const id = clean(body.caseId, 80);
  if (!id) return { status: 400, body: { error: 'Case information is missing.' } };
  const result = await db.query(`
    UPDATE hub_qa_challenge_cases
    SET active=FALSE,updated_at=NOW(),updated_by=$2
    WHERE id=$1 AND active=TRUE
    RETURNING id
  `, [id, clean(session.name, 100)]);
  if (!result.rowCount) return { status: 404, body: { error: 'That QA case is no longer active.' } };
  return {
    status: 200,
    body: { ok: true, message: 'QA challenge case removed.', cases: await listCases(db) },
  };
}

export default async (request) => {
  try {
    const session = currentSession(request);
    if (!session) return json(401, { error: 'Warehouse Hub sign-in is required.' });

    await ensureSchema();
    const db = getPool();
    const url = new URL(request.url);

    if (request.method === 'GET') {
      const imageId = clean(url.searchParams.get('image'), 80);
      if (imageId) {
        const kind = url.searchParams.get('kind') === 'approved' ? 'approved' : 'sample';
        return imageResponse(db, imageId, kind);
      }
      return json(200, {
        ok: true,
        viewer: {
          name: clean(session.name, 100),
          role: clean(session.role, 60),
          isManager: isManager(session),
        },
        cases: await listCases(db),
      });
    }

    if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });
    if (!isManager(session)) return json(403, { error: 'Admin access is required to change QA Challenge cases.' });

    const body = await request.json().catch(() => ({}));
    const action = clean(body.action, 40);
    if (action === 'createCase') {
      const result = await createCase(db, session, body);
      return json(result.status, result.body);
    }
    if (action === 'removeCase') {
      const result = await removeCase(db, session, body);
      return json(result.status, result.body);
    }
    return json(400, { error: 'Unsupported QA Challenge action.' });
  } catch (error) {
    return json(400, { error: clean(error?.message || 'QA Challenge is temporarily unavailable.', 300) });
  }
};

export const config = { path: '/api/qa-challenge' };
