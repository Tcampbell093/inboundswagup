import pg from 'pg';
import crypto from 'node:crypto';

const { Pool } = pg;
const SESSION_COOKIE = 'hub_associate_session';
const SESSION_VERSION = 2;
const MAX_IMAGE_BYTES = 1000000;
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
function clean(value, max = 500) {
  return String(value == null ? '' : value).trim().slice(0, max);
}
function slug(value) {
  return clean(value, 100).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
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
function role(session) {
  return clean(session?.role, 60).toLowerCase();
}
function isManager(session) {
  return role(session) === 'manager';
}
function isLead(session) {
  return ['manager', 'team lead'].includes(role(session));
}
function todayEastern() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}
function dateValue(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.slice(0, 10);
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
  }
  return String(value).slice(0, 10);
}
function decodeImageDataUrl(value) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(value || ''));
  if (!match) throw new Error('Choose a JPG, PNG, or WebP image.');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length) throw new Error('That image could not be read.');
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error('That image is still too large after processing.');
  return { mimeType: match[1], bytes };
}
function normalizeAnswer(value) {
  return String(value == null ? '' : value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9.\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function isCorrectAnswer(answer, correct, type) {
  const accepted = String(correct || '').split('|').map(normalizeAnswer).filter(Boolean);
  if (!accepted.length) return false;
  if (type === 'number') {
    const a = Number(String(answer).trim());
    return Number.isFinite(a) && accepted.some((candidate) => {
      const n = Number(candidate);
      return Number.isFinite(n) && Math.abs(a - n) < 1e-9;
    });
  }
  return accepted.includes(normalizeAnswer(answer));
}

async function ensureSchema() {
  if (schemaReady) return;
  const db = getPool();
  await db.query(`
    CREATE TABLE IF NOT EXISTS hub_memory_challenges (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      instructions TEXT NOT NULL DEFAULT '',
      question TEXT NOT NULL,
      correct_answer TEXT NOT NULL,
      answer_type TEXT NOT NULL DEFAULT 'text',
      options JSONB NOT NULL DEFAULT '[]'::jsonb,
      view_seconds INTEGER NOT NULL DEFAULT 10,
      active_date DATE NOT NULL,
      end_date DATE,
      image_mime_type TEXT NOT NULL,
      image_bytes BYTEA NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS hub_memory_challenges_active_idx
      ON hub_memory_challenges(active,active_date DESC,created_at DESC);

    CREATE TABLE IF NOT EXISTS hub_memory_images (
      id TEXT PRIMARY KEY,
      original_name TEXT NOT NULL DEFAULT '',
      image_mime_type TEXT NOT NULL,
      image_bytes BYTEA NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS hub_memory_images_active_idx
      ON hub_memory_images(active,created_at DESC);

    CREATE TABLE IF NOT EXISTS hub_memory_attempts (
      id BIGSERIAL PRIMARY KEY,
      challenge_id TEXT NOT NULL,
      employee_key TEXT NOT NULL,
      employee_name TEXT NOT NULL,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      answer TEXT,
      submitted_at TIMESTAMPTZ,
      correct BOOLEAN,
      UNIQUE(challenge_id, employee_key)
    );
    CREATE INDEX IF NOT EXISTS hub_memory_attempts_challenge_idx
      ON hub_memory_attempts(challenge_id,started_at ASC);
  `);
  schemaReady = true;
}
async function activeChallenges(db) {
  const today = todayEastern();
  const result = await db.query(`
    SELECT * FROM hub_memory_challenges
    WHERE active=TRUE
      AND active_date <= $1::date
      AND (end_date IS NULL OR end_date >= $1::date)
    ORDER BY active_date DESC,created_at DESC
  `, [today]);
  return result.rows;
}

async function challengeById(db, id) {
  const result = await db.query(`SELECT * FROM hub_memory_challenges WHERE id=$1 LIMIT 1`, [id]);
  return result.rows[0] || null;
}

async function assignedActiveAttempt(db, session) {
  const today = todayEastern();
  const result = await db.query(`
    SELECT a.*
    FROM hub_memory_attempts a
    JOIN hub_memory_challenges c ON c.id=a.challenge_id
    WHERE a.employee_key=$1
      AND c.active=TRUE
      AND c.active_date <= $2::date
      AND (c.end_date IS NULL OR c.end_date >= $2::date)
    ORDER BY a.started_at DESC,a.id DESC
    LIMIT 1
  `, [slug(session.name), today]);
  return result.rows[0] || null;
}

async function chooseChallengeForAssignment(db) {
  const today = todayEastern();
  const result = await db.query(`
    SELECT c.*, COUNT(a.id)::int AS attempt_count
    FROM hub_memory_challenges c
    LEFT JOIN hub_memory_attempts a ON a.challenge_id=c.id
    WHERE c.active=TRUE
      AND c.active_date <= $1::date
      AND (c.end_date IS NULL OR c.end_date >= $1::date)
    GROUP BY c.id
    ORDER BY COUNT(a.id) ASC, RANDOM()
    LIMIT 1
  `, [today]);
  return result.rows[0] || null;
}
function challengePublic(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title || 'Memory Challenge',
    instructions: row.instructions || 'Study the image carefully. It will disappear when the timer ends.',
    question: row.question,
    answerType: ['text','number','multiple_choice'].includes(row.answer_type) ? row.answer_type : 'text',
    options: Array.isArray(row.options) ? row.options : [],
    viewSeconds: Math.max(3, Math.min(60, Number(row.view_seconds || 10))),
    activeDate: dateValue(row.active_date),
    endDate: row.end_date ? dateValue(row.end_date) : '',
  };
}
function attemptPayload(row, challenge) {
  if (!row) return null;
  const started = row.started_at ? new Date(row.started_at).getTime() : 0;
  const viewUntilMs = started + (Math.max(3, Math.min(60, Number(challenge?.view_seconds || 10))) * 1000);
  return {
    startedAt: row.started_at || null,
    viewUntil: new Date(viewUntilMs).toISOString(),
    submittedAt: row.submitted_at || null,
    answer: row.answer || '',
    correct: row.correct === true ? true : row.correct === false ? false : null,
    state: row.submitted_at ? 'submitted' : (Date.now() < viewUntilMs ? 'viewing' : 'answering'),
  };
}
async function getAttempt(db, challengeId, session) {
  const result = await db.query(`
    SELECT * FROM hub_memory_attempts
    WHERE challenge_id=$1 AND employee_key=$2 LIMIT 1
  `, [challengeId, slug(session.name)]);
  return result.rows[0] || null;
}
async function loadState(db, session) {
  const pool = await activeChallenges(db);
  const viewer = { name: clean(session.name, 100), role: clean(session.role, 60), isManager: isManager(session), isLead: isLead(session) };
  if (!pool.length) return { ok: true, viewer, challenge: null, attempt: null, poolCount: 0 };

  const attempt = await assignedActiveAttempt(db, session);
  if (!attempt) {
    return {
      ok: true,
      viewer,
      poolCount: pool.length,
      challenge: {
        id: 'pool',
        title: 'Memory Challenge',
        instructions: pool.length === 1
          ? 'Your challenge will be revealed when you start.'
          : `You will be assigned 1 of ${pool.length} different challenge versions when you start.`,
        question: '',
        answerType: 'text',
        options: [],
        viewSeconds: null,
        pooled: true,
        poolCount: pool.length,
      },
      attempt: null,
    };
  }

  const challenge = await challengeById(db, attempt.challenge_id);
  if (!challenge) return { ok: true, viewer, challenge: null, attempt: null, poolCount: pool.length };
  const body = {
    ok: true,
    viewer,
    poolCount: pool.length,
    challenge: challengePublic(challenge),
    attempt: attemptPayload(attempt, challenge),
  };
  if (isLead(session)) {
    body.lead = {
      correctAnswer: challenge.correct_answer,
      responses: await responsesFor(db, challenge.id),
    };
  }
  return body;
}
async function responsesFor(db, challengeId) {
  const result = await db.query(`
    SELECT id,employee_name,started_at,answer,submitted_at,correct
    FROM hub_memory_attempts
    WHERE challenge_id=$1
    ORDER BY COALESCE(submitted_at,started_at) ASC,id ASC
  `, [challengeId]);
  return result.rows.map((row) => ({
    id: Number(row.id),
    employeeName: row.employee_name,
    startedAt: row.started_at || null,
    answer: row.answer || '',
    submittedAt: row.submitted_at || null,
    correct: row.correct === true ? true : row.correct === false ? false : null,
  }));
}
async function imageResponse(db, session, id) {
  const result = await db.query(`
    SELECT id,image_mime_type,image_bytes,view_seconds
    FROM hub_memory_challenges WHERE id=$1 AND active=TRUE LIMIT 1
  `, [id]);
  const challenge = result.rows[0];
  if (!challenge) return new Response('Image not found.', { status: 404 });

  if (!isLead(session)) {
    const attempt = await getAttempt(db, id, session);
    if (!attempt?.started_at || attempt.submitted_at) return new Response('Image viewing period is not active.', { status: 403 });
    const deadline = new Date(attempt.started_at).getTime() + (Math.max(3, Math.min(60, Number(challenge.view_seconds || 10))) * 1000) + 1500;
    if (Date.now() > deadline) return new Response('Image viewing period has ended.', { status: 410 });
  }

  return new Response(challenge.image_bytes, {
    status: 200,
    headers: {
      'Content-Type': challenge.image_mime_type || 'image/jpeg',
      'Cache-Control': 'no-store, max-age=0',
      'Pragma': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
async function startAttempt(db, session) {
  let attempt = await assignedActiveAttempt(db, session);
  let challenge = attempt ? await challengeById(db, attempt.challenge_id) : null;

  if (!attempt) {
    challenge = await chooseChallengeForAssignment(db);
    if (!challenge) return { status: 404, body: { error: 'There is no active Memory Challenge right now.' } };
    const key = slug(session.name);
    await db.query(`
      INSERT INTO hub_memory_attempts(challenge_id,employee_key,employee_name,started_at)
      VALUES($1,$2,$3,NOW())
      ON CONFLICT(challenge_id,employee_key) DO NOTHING
    `, [challenge.id, key, clean(session.name, 100)]);
    attempt = await getAttempt(db, challenge.id, session);
  }

  if (!challenge || !attempt) return { status: 409, body: { error: 'Your Memory Challenge could not be assigned. Try again.' } };
  const payload = attemptPayload(attempt, challenge);
  return {
    status: 200,
    body: {
      ok: true,
      challenge: challengePublic(challenge),
      attempt: payload,
      imageUrl: payload.state === 'viewing' ? `/api/memory-challenge?image=${encodeURIComponent(challenge.id)}&t=${Date.now()}` : '',
    },
  };
}
async function submitAttempt(db, session, body) {
  const attempt = await assignedActiveAttempt(db, session);
  if (!attempt) return { status: 409, body: { error: 'Start the Memory Challenge before answering.' } };
  const challenge = await challengeById(db, attempt.challenge_id);
  if (!challenge) return { status: 404, body: { error: 'Your assigned Memory Challenge is no longer available.' } };
  const answer = clean(body.answer, 700);
  if (!answer) return { status: 400, body: { error: 'Enter an answer before submitting.' } };
  if (attempt.submitted_at) return { status: 409, body: { error: 'You already submitted this Memory Challenge.' } };
  const deadline = new Date(attempt.started_at).getTime() + (Math.max(3, Math.min(60, Number(challenge.view_seconds || 10))) * 1000);
  if (Date.now() < deadline) return { status: 409, body: { error: 'Finish the viewing timer before answering.' } };
  const correct = isCorrectAnswer(answer, challenge.correct_answer, challenge.answer_type);
  const saved = await db.query(`
    UPDATE hub_memory_attempts
    SET answer=$3,submitted_at=NOW(),correct=$4
    WHERE challenge_id=$1 AND employee_key=$2 AND submitted_at IS NULL
    RETURNING *
  `, [challenge.id, slug(session.name), answer, correct]);
  if (!saved.rowCount) return { status: 409, body: { error: 'This Memory Challenge has already been submitted.' } };
  return {
    status: 200,
    body: { ok: true, attempt: attemptPayload(saved.rows[0], challenge), message: correct ? 'Correct — nice recall.' : 'Answer submitted.' },
  };
}
async function activeReviewPool(db) {
  const pool = await activeChallenges(db);
  const variants = [];
  for (const challenge of pool) {
    variants.push({
      challenge: challengePublic(challenge),
      correctAnswer: challenge.correct_answer,
      responses: await responsesFor(db, challenge.id),
    });
  }
  return variants;
}

async function memoryImageList(db) {
  const result = await db.query(`
    SELECT id,original_name,created_at,created_by
    FROM hub_memory_images
    WHERE active=TRUE
    ORDER BY created_at DESC
    LIMIT 200
  `);
  return result.rows.map((row) => ({
    id: row.id,
    name: row.original_name || 'Memory photo',
    createdAt: row.created_at || null,
    createdBy: row.created_by || '',
    imageUrl: `/api/memory-challenge?libraryImage=${encodeURIComponent(row.id)}&admin=1`,
  }));
}
async function libraryImageResponse(db, session, id) {
  if (!isManager(session)) return new Response('Admin access is required.', { status: 403 });
  const result = await db.query(`
    SELECT image_mime_type,image_bytes
    FROM hub_memory_images
    WHERE id=$1 AND active=TRUE
    LIMIT 1
  `, [id]);
  const image = result.rows[0];
  if (!image) return new Response('Image not found.', { status: 404 });
  return new Response(image.image_bytes, {
    status: 200,
    headers: {
      'Content-Type': image.image_mime_type || 'image/jpeg',
      'Cache-Control': 'no-store, max-age=0',
      'Pragma': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
async function uploadLibraryImage(db, session, body) {
  let image;
  const imageLibraryId = clean(body.imageLibraryId, 80);
  if (imageLibraryId) {
    const selected = await db.query(`
      SELECT image_mime_type,image_bytes
      FROM hub_memory_images
      WHERE id=$1 AND active=TRUE
      LIMIT 1
    `, [imageLibraryId]);
    if (!selected.rows[0]) return { status: 400, body: { error: 'Choose an available photo from the library.' } };
    image = { mimeType: selected.rows[0].image_mime_type, bytes: selected.rows[0].image_bytes };
  } else {
    image = decodeImageDataUrl(body.imageDataUrl);
  }
  const id = crypto.randomUUID();
  const name = clean(body.fileName, 180) || 'Memory photo';
  await db.query(`
    INSERT INTO hub_memory_images(id,original_name,image_mime_type,image_bytes,active,created_at,created_by)
    VALUES($1,$2,$3,$4,TRUE,NOW(),$5)
  `, [id, name, image.mimeType, image.bytes, clean(session.name, 100)]);
  return {
    status: 200,
    body: {
      ok: true,
      message: 'Photo added to the Memory Challenge library.',
      image: {
        id,
        name,
        imageUrl: `/api/memory-challenge?libraryImage=${encodeURIComponent(id)}&admin=1`,
      },
    },
  };
}
async function removeLibraryImage(db, session, body) {
  const id = clean(body.imageId, 80);
  if (!id) return { status: 400, body: { error: 'Photo information is missing.' } };
  const result = await db.query(`
    UPDATE hub_memory_images
    SET active=FALSE
    WHERE id=$1 AND active=TRUE
    RETURNING id
  `, [id]);
  if (!result.rowCount) return { status: 404, body: { error: 'That photo is already unavailable.' } };
  return {
    status: 200,
    body: { ok: true, message: 'Photo removed from the reusable library.', images: await memoryImageList(db) },
  };
}

async function adminList(db) {
  const challenges = await db.query(`
    SELECT id,title,instructions,question,correct_answer,answer_type,options,view_seconds,
           active_date,end_date,active,created_at,created_by
    FROM hub_memory_challenges
    ORDER BY active_date DESC,created_at DESC
    LIMIT 100
  `);
  const result = [];
  for (const row of challenges.rows) {
    const attempts = await responsesFor(db, row.id);
    result.push({
      ...challengePublic(row),
      correctAnswer: row.correct_answer,
      active: row.active !== false,
      createdAt: row.created_at || null,
      createdBy: row.created_by || '',
      imageUrl: `/api/memory-challenge?image=${encodeURIComponent(row.id)}&admin=1`,
      responses: attempts,
    });
  }
  return result;
}
async function saveChallenge(db, session, body) {
  const question = clean(body.question, 500);
  const correctAnswer = clean(body.correctAnswer, 700);
  const activeDate = clean(body.activeDate, 10);
  if (!question || !correctAnswer || !/^\d{4}-\d{2}-\d{2}$/.test(activeDate)) {
    return { status: 400, body: { error: 'Question, correct answer, and active date are required.' } };
  }
  const answerType = ['text','number','multiple_choice'].includes(body.answerType) ? body.answerType : 'text';
  const options = Array.isArray(body.options) ? body.options.map((x) => clean(x, 120)).filter(Boolean).slice(0, 8) : [];
  if (answerType === 'multiple_choice' && options.length < 2) {
    return { status: 400, body: { error: 'Multiple choice challenges need at least two answer choices.' } };
  }
  const image = decodeImageDataUrl(body.imageDataUrl);
  const viewSeconds = Math.max(3, Math.min(60, Math.round(Number(body.viewSeconds || 10))));
  const endDate = clean(body.endDate, 10);
  if (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return { status: 400, body: { error: 'End date is invalid.' } };
  const id = crypto.randomUUID();
  await db.query(`
    INSERT INTO hub_memory_challenges(
      id,title,instructions,question,correct_answer,answer_type,options,view_seconds,
      active_date,end_date,image_mime_type,image_bytes,active,created_at,created_by,updated_at,updated_by
    )
    VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,TRUE,NOW(),$13,NOW(),$13)
  `, [
    id,
    clean(body.title, 140) || 'Memory Challenge',
    clean(body.instructions, 500) || 'Study the image carefully. It will disappear when the timer ends.',
    question,
    correctAnswer,
    answerType,
    JSON.stringify(options),
    viewSeconds,
    activeDate,
    endDate || null,
    image.mimeType,
    image.bytes,
    clean(session.name, 100),
  ]);
  return { status: 200, body: { ok: true, message: 'Memory Challenge created.', challenges: await adminList(db) } };
}
async function removeChallenge(db, session, body) {
  const id = clean(body.challengeId, 80);
  if (!id) return { status: 400, body: { error: 'Challenge information is missing.' } };
  const result = await db.query(`
    UPDATE hub_memory_challenges SET active=FALSE,updated_at=NOW(),updated_by=$2
    WHERE id=$1 AND active=TRUE RETURNING id
  `, [id, clean(session.name, 100)]);
  if (!result.rowCount) return { status: 404, body: { error: 'That Memory Challenge is already inactive.' } };
  return { status: 200, body: { ok: true, message: 'Memory Challenge removed.', challenges: await adminList(db) } };
}

export default async (request) => {
  try {
    const session = currentSession(request);
    if (!session) return json(401, { error: 'Sign in to the Warehouse Hub to use Memory Challenge.' });
    await ensureSchema();
    const db = getPool();
    const url = new URL(request.url);

    if (request.method === 'GET') {
      const libraryImageId = clean(url.searchParams.get('libraryImage'), 80);
      if (libraryImageId) return libraryImageResponse(db, session, libraryImageId);
      const imageId = clean(url.searchParams.get('image'), 80);
      if (imageId) return imageResponse(db, session, imageId);
      if (url.searchParams.get('admin') === '1') {
        if (!isManager(session)) return json(403, { error: 'Admin access is required.' });
        return json(200, {
          ok: true,
          challenges: await adminList(db),
          images: await memoryImageList(db),
        });
      }
      if (url.searchParams.get('review') === '1') {
        if (!isLead(session)) return json(403, { error: 'Team Lead or Admin access is required.' });
        return json(200, {
          ok: true,
          viewer: { name: clean(session.name, 100), role: clean(session.role, 60), isManager: isManager(session), isLead: true },
          pool: await activeReviewPool(db),
        });
      }
      return json(200, await loadState(db, session));
    }

    if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });
    const body = await request.json().catch(() => ({}));
    const action = clean(body.action, 40);

    if (action === 'start') {
      const result = await startAttempt(db, session);
      return json(result.status, result.body);
    }
    if (action === 'submit') {
      const result = await submitAttempt(db, session, body);
      return json(result.status, result.body);
    }
    if (action === 'uploadImage') {
      if (!isManager(session)) return json(403, { error: 'Admin access is required.' });
      const result = await uploadLibraryImage(db, session, body);
      return json(result.status, result.body);
    }
    if (action === 'removeImage') {
      if (!isManager(session)) return json(403, { error: 'Admin access is required.' });
      const result = await removeLibraryImage(db, session, body);
      return json(result.status, result.body);
    }
    if (action === 'saveChallenge') {
      if (!isManager(session)) return json(403, { error: 'Admin access is required.' });
      const result = await saveChallenge(db, session, body);
      return json(result.status, result.body);
    }
    if (action === 'removeChallenge') {
      if (!isManager(session)) return json(403, { error: 'Admin access is required.' });
      const result = await removeChallenge(db, session, body);
      return json(result.status, result.body);
    }
    return json(400, { error: 'Unsupported Memory Challenge action.' });
  } catch (error) {
    return json(400, { error: clean(error?.message || 'Memory Challenge is temporarily unavailable.', 300) });
  }
};

export const config = { path: '/api/memory-challenge' };
