const { Pool } = require('pg');
const crypto = require('crypto');
const hubCleaning = require('./_hub_cleaning');
const hubPush = require('./_hub_push');
const schedule = require('./_hub_schedule');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : undefined,
});

let schemaReady = false;

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) };
}
function text(value, max = 500) { return String(value == null ? '' : value).trim().slice(0, max); }
function validDate(value) { const s = text(value, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ''; }
function safeEqual(a, b) { if (!a || !b) return false; const aa = Buffer.from(String(a)), bb = Buffer.from(String(b)); return aa.length === bb.length && crypto.timingSafeEqual(aa, bb); }
const HUB_SESSION_COOKIE = 'hub_associate_session';
const HUB_SESSION_VERSION = 2;
function cookieMap(event) {
  const raw = event.headers?.cookie || event.headers?.Cookie || '';
  return Object.fromEntries(String(raw).split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf('=');
    return index === -1 ? [part, ''] : [part.slice(0, index), part.slice(index + 1)];
  }));
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
    const plain = Buffer.concat([decipher.update(Buffer.from(dataText, 'base64url')), decipher.final()]).toString('utf8');
    const payload = JSON.parse(plain);
    if (payload?.v !== HUB_SESSION_VERSION || !payload?.name || Number(payload.exp || 0) <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
function managerAuthorized(event) {
  if (safeEqual(event.headers?.['x-hub-key'] || event.headers?.['X-Hub-Key'] || '', process.env.HUB_MANAGER_KEY || '')) return true;
  return String(hubSession(event)?.role || '').toLowerCase() === 'manager';
}
function rewardAdminAuthorized(event) {
  if (managerAuthorized(event)) return true;
  const role = String(hubSession(event)?.role || '').toLowerCase();
  return role === 'team lead';
}
function slug(value) { return text(value, 100).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80); }
function hashPin(pin) { return crypto.createHash('sha256').update(`${process.env.HUB_PIN_SALT || ''}:${pin}`).digest('hex'); }

async function ensureSchema() {
  if (schemaReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hub_announcements (
      id TEXT PRIMARY KEY,title TEXT NOT NULL,message TEXT NOT NULL,start_date DATE NOT NULL,end_date DATE,
      department TEXT NOT NULL DEFAULT 'All teams',pinned BOOLEAN NOT NULL DEFAULT FALSE,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS hub_policies (
      id TEXT PRIMARY KEY,title TEXT NOT NULL,summary TEXT NOT NULL,effective_date DATE NOT NULL,
      read_required BOOLEAN NOT NULL DEFAULT FALSE,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    -- Shown as a pop-up the first time someone opens the Hub each day.
    ALTER TABLE hub_announcements ADD COLUMN IF NOT EXISTS show_on_open BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE hub_announcements ADD COLUMN IF NOT EXISTS question_enabled BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE hub_announcements ADD COLUMN IF NOT EXISTS question_text TEXT NOT NULL DEFAULT '';
    ALTER TABLE hub_announcements ADD COLUMN IF NOT EXISTS correct_answer TEXT NOT NULL DEFAULT '';
    ALTER TABLE hub_announcements ADD COLUMN IF NOT EXISTS reward_slots INTEGER NOT NULL DEFAULT 3;
    ALTER TABLE hub_policies ADD COLUMN IF NOT EXISTS show_on_open BOOLEAN NOT NULL DEFAULT FALSE;
    CREATE TABLE IF NOT EXISTS hub_announcement_responses (
      id BIGSERIAL PRIMARY KEY,
      announcement_id TEXT NOT NULL,
      announcement_title TEXT NOT NULL DEFAULT '',
      employee_key TEXT NOT NULL,
      employee_name TEXT NOT NULL,
      answer TEXT NOT NULL,
      submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      winner BOOLEAN NOT NULL DEFAULT FALSE,
      winner_selected_at TIMESTAMPTZ,
      winner_selected_by TEXT NOT NULL DEFAULT '',
      rewarded_at TIMESTAMPTZ,
      rewarded_by TEXT NOT NULL DEFAULT '',
      reward_note TEXT NOT NULL DEFAULT '',
      UNIQUE(announcement_id, employee_key)
    );
    CREATE INDEX IF NOT EXISTS hub_announcement_responses_ann_idx
      ON hub_announcement_responses(announcement_id, submitted_at ASC);
    CREATE INDEX IF NOT EXISTS hub_announcement_responses_rewards_idx
      ON hub_announcement_responses(winner, rewarded_at, winner_selected_at DESC);
    -- Hub-wide settings, e.g. the seasonal theme ('' = standard look).
    CREATE TABLE IF NOT EXISTS hub_settings (
      key TEXT PRIMARY KEY,value TEXT NOT NULL DEFAULT '',updated_by TEXT NOT NULL DEFAULT '',updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS hub_cleaning_assignments (
      id TEXT PRIMARY KEY,work_date DATE NOT NULL,area TEXT NOT NULL,task TEXT,employee_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'scheduled',started_at TIMESTAMPTZ,finished_at TIMESTAMPTZ,completed_by TEXT,
      credit_minutes INTEGER NOT NULL DEFAULT 0,source TEXT NOT NULL DEFAULT 'hub',updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS hub_cleaning_work_date_idx ON hub_cleaning_assignments(work_date);
    CREATE TABLE IF NOT EXISTS hub_cleaning_area_sides (
      department_id BIGINT PRIMARY KEY,department_name TEXT NOT NULL,
      side TEXT NOT NULL CHECK (side IN ('Inbound','Outbound')),
      updated_by TEXT NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS hub_employee_pins (
      employee_key TEXT PRIMARY KEY,employee_name TEXT NOT NULL,department TEXT,pin_hash TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  schemaReady = true;
}

function todayEastern() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}
function dateValue(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.slice(0, 10);
  if (value instanceof Date && !Number.isNaN(value.getTime())) return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
  return String(value).slice(0, 10);
}
function normalizeLocalCleaning(row) {
  let status = row.status || 'scheduled';
  const workDate = dateValue(row.work_date);
  if (!['completed', 'reported_not_done'].includes(status) && workDate && workDate < todayEastern()) status = 'missed';
  return { id: row.id, date: workDate, area: row.area, task: row.task || '', employeeName: row.employee_name, status, startedAt: row.started_at || null, finishedAt: row.finished_at || null, completedBy: row.completed_by || null, creditMinutes: Number(row.credit_minutes || 0), source: row.source || 'hub', updatedAt: row.updated_at || null };
}
function defaultCleaningSide(name) { return /fulfill?ment|outbound|inventory|shipping|dispatch|pack.?out/i.test(text(name,100)) ? 'Outbound' : 'Inbound'; }
function fairShiftStatus(value) {
  if (value === 'completed') return 'completed';
  if (value === 'in_progress') return 'in_progress';
  if (value === 'missed') return 'missed';
  return 'scheduled';
}

async function fetchFairShiftCleaning() {
  try {
    // The schedule lives in the Hub now; the function keeps its name and shape.
    const data = await schedule.dashboard(pool, { date: todayEastern(), days: 14 });
    const employeeMap = new Map((Array.isArray(data.employees) ? data.employees : []).map(e => [Number(e.id), e.name]));
    const cleaning = (Array.isArray(data.assignments) ? data.assignments : [])
      .filter(a => a && a.type === 'cleaning')
      .map(a => {
        const fairshiftId = Number(a.id);
        const scheduledName = a.employeeName || employeeMap.get(Number(a.employeeId)) || 'Unassigned';
        const actualName = a.actualEmployeeId ? employeeMap.get(Number(a.actualEmployeeId)) : null;
        const employeeName = actualName || scheduledName;
        const covered = Boolean(a.actualEmployeeId && Number(a.actualEmployeeId) !== Number(a.employeeId));
        const status = fairShiftStatus(a.dutyStatus);
        return {
          id: `fairshift-${fairshiftId}`,
          fairshiftId,
          date: String(a.assignmentDate || '').slice(0, 10),
          area: a.toDepartment || a.homeDepartment || 'Cleaning',
          task: covered ? `Covering for ${scheduledName}` : (a.note || 'Weekly cleaning duty'),
          employeeName,
          scheduledEmployeeName: scheduledName,
          covered,
          status,
          startedAt: status === 'in_progress' ? (a.startTime || null) : null,
          finishedAt: status === 'completed' ? (a.endTime || null) : null,
          completedBy: status === 'completed' ? employeeName : null,
          creditMinutes: status === 'completed' ? 15 : 0,
          source: 'fairshift',
          checkinUrl: `/warehouse-hub/checkin.html?assignment=${encodeURIComponent(fairshiftId)}`,
          updatedAt: a.createdAt || null,
        };
      });
    return { ok: true, cleaning, departments: Array.isArray(data.departments)?data.departments:[], error: null };
  } catch (error) {
    return { ok: false, cleaning: [], error: text(error?.message || 'Cleaning schedule unavailable', 200) };
  }
}

// Start/finish now live in the Hub; a Hub check-in overrides FairShift's status.
function withHubCheckin(row, checkin) {
  if (!checkin) return row;
  const completed = checkin.status === 'completed';
  return {
    ...row,
    status: checkin.status,
    startedAt: checkin.started_at || row.startedAt,
    finishedAt: completed ? checkin.finished_at : null,
    employeeName: completed && checkin.employee_name ? checkin.employee_name : row.employeeName,
    completedBy: completed ? (checkin.employee_name || row.employeeName) : null,
    creditMinutes: completed ? 15 : 0,
  };
}

async function readFeed(includeAdmin = false, session = null) {
  const [a, p, c, fs, sideRows, themeRow] = await Promise.all([
    pool.query(`SELECT id,title,message,start_date,end_date,department,pinned,show_on_open,question_enabled,question_text,correct_answer,reward_slots,updated_at FROM hub_announcements ORDER BY pinned DESC,start_date DESC,updated_at DESC`),
    pool.query(`SELECT id,title,summary,effective_date,read_required,show_on_open,updated_at FROM hub_policies ORDER BY effective_date DESC,updated_at DESC`),
    pool.query(`SELECT * FROM hub_cleaning_assignments ORDER BY work_date,area,employee_name`),
    fetchFairShiftCleaning(),
    pool.query('SELECT department_id,department_name,side FROM hub_cleaning_area_sides'),
    pool.query(`SELECT key,value FROM hub_settings WHERE key IN ('theme','themeBanner')`),
  ]);
  const savedById=new Map(sideRows.rows.map(x=>[Number(x.department_id),x.side]));
  const savedByName=new Map(sideRows.rows.map(x=>[text(x.department_name,100).toLowerCase(),x.side]));
  const departments=Array.isArray(fs.departments)?fs.departments:[];
  const areaSides=new Map(departments.map(d=>[text(d.name,100).toLowerCase(),
    savedById.get(Number(d.id))||defaultCleaningSide(d.name)]));
  const sideFor=name=>areaSides.get(text(name,100).toLowerCase())
    ||savedByName.get(text(name,100).toLowerCase())||defaultCleaningSide(name);
  const manualCleaning = c.rows.map(x=>({...normalizeLocalCleaning(x),side:sideFor(x.area)}));
  const checkins=fs.ok?await hubCleaning.checkinsByIdSafe(pool,fs.cleaning.map(x=>x.fairshiftId)):new Map();
  const activeCleaning=fs.ok?fs.cleaning.map(x=>({...withHubCheckin(x,checkins.get(x.fairshiftId)),side:sideFor(x.area)})):manualCleaning;
  const knownAreas=departments.filter(d=>d.active!==false&&d.cleaningActive===true)
    .map(d=>({name:text(d.name,100),side:sideFor(d.name)}));
  const cleaningAreas=knownAreas.length?knownAreas:
    [...new Set(activeCleaning.map(x=>x.area))].map(name=>({name,side:sideFor(name)}));
  const result = {
    announcements: a.rows.map(r => ({ id: r.id, title: r.title, message: r.message, startDate: dateValue(r.start_date), endDate: r.end_date ? dateValue(r.end_date) : '', department: r.department, pinned: !!r.pinned, showOnOpen: !!r.show_on_open, questionEnabled: !!r.question_enabled, questionText: r.question_text || '', rewardSlots: Math.max(1, Math.min(20, Number(r.reward_slots || 3))), updatedAt: r.updated_at })),
    policies: p.rows.map(r => ({ id: r.id, title: r.title, summary: r.summary, effectiveDate: dateValue(r.effective_date), readRequired: !!r.read_required, showOnOpen: !!r.show_on_open, updatedAt: r.updated_at })),
    cleaning: activeCleaning,
    // 'auto' = holiday calendar, '' = standard, otherwise a theme key.
    theme: text(themeRow.rows.find((row) => row.key === 'theme')?.value, 40),
    themeBanner: text(themeRow.rows.find((row) => row.key === 'themeBanner')?.value, 160),
    cleaningAreas,
    cleaningSource: fs.ok ? 'fairshift' : 'hub-fallback',
    fairshiftConnected: !!fs.ok,
    generatedAt: new Date().toISOString(),
  };
  const sessionKey = slug(session?.name || '');
  if (sessionKey) {
    const mine = await pool.query(`
      SELECT id,announcement_id,answer,submitted_at,winner,rewarded_at
      FROM hub_announcement_responses
      WHERE employee_key=$1
    `, [sessionKey]).catch(() => ({ rows: [] }));
    const mineByAnnouncement = new Map(mine.rows.map(row => [row.announcement_id, row]));
    result.announcements = result.announcements.map((announcement) => {
      const response = mineByAnnouncement.get(announcement.id);
      return response ? {
        ...announcement,
        myResponse: {
          id: Number(response.id),
          answer: response.answer,
          submittedAt: response.submitted_at || null,
          winner: !!response.winner,
          rewardedAt: response.rewarded_at || null,
        },
      } : announcement;
    });
  }
  const role = String(session?.role || '').toLowerCase();
  if (includeAdmin || role === 'manager' || role === 'team lead') {
    const answerById = new Map(a.rows.map(row => [row.id, row.correct_answer || '']));
    result.announcements = result.announcements.map(announcement => ({
      ...announcement,
      correctAnswer: answerById.get(announcement.id) || '',
    }));
  }
  if (role === 'manager' || role === 'team lead') {
    const rewardRows = await pool.query(`
      SELECT id,announcement_id,announcement_title,employee_key,employee_name,answer,submitted_at,
             winner,winner_selected_at,winner_selected_by,rewarded_at,rewarded_by,reward_note
      FROM hub_announcement_responses
      WHERE winner=TRUE
      ORDER BY CASE WHEN rewarded_at IS NULL THEN 0 ELSE 1 END,
               winner_selected_at DESC NULLS LAST, submitted_at ASC
      LIMIT 500
    `).catch(() => ({ rows: [] }));
    const rewardMap = row => ({
      responseId: Number(row.id),
      announcementId: row.announcement_id,
      announcementTitle: row.announcement_title,
      employeeKey: row.employee_key,
      employeeName: row.employee_name,
      answer: row.answer,
      submittedAt: row.submitted_at || null,
      winnerSelectedAt: row.winner_selected_at || null,
      winnerSelectedBy: row.winner_selected_by || '',
      rewardedAt: row.rewarded_at || null,
      rewardedBy: row.rewarded_by || '',
      rewardNote: row.reward_note || '',
    });
    const pending = rewardRows.rows.filter(row => !row.rewarded_at).map(rewardMap);
    const history = rewardRows.rows.filter(row => !!row.rewarded_at).map(rewardMap);
    result.questionRewards = { pendingCount: pending.length, pending, history };
  }
  if (includeAdmin) {
    const responses = await pool.query(`
      SELECT id,announcement_id,employee_key,employee_name,answer,submitted_at,winner,
             winner_selected_at,winner_selected_by,rewarded_at,rewarded_by,reward_note
      FROM hub_announcement_responses
      ORDER BY announcement_id,submitted_at ASC,id ASC
    `).catch(() => ({ rows: [] }));
    const byAnnouncement = new Map();
    for (const row of responses.rows) {
      if (!byAnnouncement.has(row.announcement_id)) byAnnouncement.set(row.announcement_id, []);
      byAnnouncement.get(row.announcement_id).push({
        id: Number(row.id),
        employeeKey: row.employee_key,
        employeeName: row.employee_name,
        answer: row.answer,
        submittedAt: row.submitted_at || null,
        winner: !!row.winner,
        winnerSelectedAt: row.winner_selected_at || null,
        winnerSelectedBy: row.winner_selected_by || '',
        rewardedAt: row.rewarded_at || null,
        rewardedBy: row.rewarded_by || '',
        rewardNote: row.reward_note || '',
      });
    }
    result.announcements = result.announcements.map(a => ({ ...a, responses: byAnnouncement.get(a.id) || [] }));
    const e = await pool.query(`SELECT employee_name,department,active FROM hub_employee_pins ORDER BY employee_name`);
    result.employees = e.rows.map(r => ({ name: r.employee_name, department: r.department || '', active: !!r.active }));
    result.manualCleaning = manualCleaning;
    result.fairshiftError = fs.ok ? null : fs.error;
  }
  return result;
}

async function upsertAnnouncement(body) {
  const title = text(body.title, 120), message = text(body.message, 1200), startDate = validDate(body.startDate), endDate = validDate(body.endDate);
  const questionEnabled = !!body.questionEnabled;
  const questionText = questionEnabled ? text(body.questionText, 500) : '';
  const correctAnswer = questionEnabled ? text(body.correctAnswer, 700) : '';
  if (!startDate) throw new Error('Start date is required.');
  if (questionEnabled && !questionText) throw new Error('Enter the question associates should answer.');
  if (!questionEnabled && (!title || !message)) throw new Error('Title and message are required for a regular announcement.');
  const rewardSlots = Math.max(1, Math.min(20, Math.round(Number(body.rewardSlots || 3))));
  const id = text(body.id, 80) || crypto.randomUUID();
  const saved = await pool.query(`
    INSERT INTO hub_announcements(
      id,title,message,start_date,end_date,department,pinned,show_on_open,
      question_enabled,question_text,correct_answer,reward_slots,updated_at
    )
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
    ON CONFLICT(id) DO UPDATE SET
      title=EXCLUDED.title,message=EXCLUDED.message,start_date=EXCLUDED.start_date,
      end_date=EXCLUDED.end_date,department=EXCLUDED.department,pinned=EXCLUDED.pinned,
      show_on_open=EXCLUDED.show_on_open,question_enabled=EXCLUDED.question_enabled,
      question_text=EXCLUDED.question_text,correct_answer=EXCLUDED.correct_answer,
      reward_slots=EXCLUDED.reward_slots,updated_at=NOW()
    RETURNING (xmax = 0) AS inserted
  `, [id, title, message, startDate, endDate || null, text(body.department, 80) || 'All teams',
      !!body.pinned, !!body.showOnOpen, questionEnabled, questionText, correctAnswer, rewardSlots]);
  return {
    id,
    created: saved.rows[0]?.inserted === true,
    title: title || (questionEnabled ? 'Prize question' : 'Announcement'),
    detail: message || questionText,
    questionEnabled,
  };
}
async function upsertPolicy(body) {
  const title = text(body.title, 140), summary = text(body.summary, 1600), effectiveDate = validDate(body.effectiveDate);
  if (!title || !summary || !effectiveDate) throw new Error('Title, summary, and effective date are required.');
  const id = text(body.id, 80) || crypto.randomUUID();
  const saved = await pool.query(`INSERT INTO hub_policies(id,title,summary,effective_date,read_required,show_on_open,updated_at) VALUES($1,$2,$3,$4,$5,$6,NOW()) ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,summary=EXCLUDED.summary,effective_date=EXCLUDED.effective_date,read_required=EXCLUDED.read_required,show_on_open=EXCLUDED.show_on_open,updated_at=NOW() RETURNING (xmax = 0) AS inserted`, [id, title, summary, effectiveDate, !!body.readRequired, !!body.showOnOpen]);
  return { id, created: saved.rows[0]?.inserted === true, title, detail: summary };
}
async function deleteRecord(body) {
  const kind = text(body.kind, 30), id = text(body.id, 80);
  if (kind === 'announcement' && id) return pool.query(`DELETE FROM hub_announcements WHERE id=$1`, [id]);
  if (kind === 'policy' && id) return pool.query(`DELETE FROM hub_policies WHERE id=$1`, [id]);
  if (kind === 'cleaning' && id) return pool.query(`DELETE FROM hub_cleaning_assignments WHERE id=$1`, [id]);
  if (kind === 'employee' && body.name) return pool.query(`DELETE FROM hub_employee_pins WHERE employee_key=$1`, [slug(body.name)]);
  throw new Error('Unsupported delete request.');
}
async function cleaningAction(event, body) {
  if (!process.env.HUB_PIN_SALT) throw new Error('HUB_PIN_SALT is not configured.');
  const assignmentId = text(body.assignmentId, 80), employeeName = text(body.employeeName, 100), pin = text(body.pin, 12), action = text(body.cleaningAction, 20);
  if (!assignmentId || !['start', 'finish'].includes(action)) throw new Error('Incomplete cleaning check-in request.');
  const assignment = await pool.query(`SELECT * FROM hub_cleaning_assignments WHERE id=$1 LIMIT 1`, [assignmentId]);
  const row = assignment.rows[0];
  if (!row) throw new Error('Cleaning assignment not found.');
  const workDate = dateValue(row.work_date);
  if (workDate !== todayEastern()) throw new Error('Cleaning can only be checked in for today.');

  if (action === 'start') {
    if (!employeeName || !pin) throw new Error('Enter your name and PIN to start cleaning.');
    const employee = await pool.query(`SELECT employee_name,pin_hash,active FROM hub_employee_pins WHERE employee_key=$1 LIMIT 1`, [slug(employeeName)]);
    const e = employee.rows[0];
    if (!e || !e.active || !safeEqual(e.pin_hash, hashPin(pin))) throw new Error('Name or PIN is incorrect.');
    if (String(row.employee_name).toLowerCase() !== employeeName.toLowerCase()) throw new Error('This assignment is scheduled to another employee.');
    if (row.status !== 'scheduled') throw new Error('This assignment has already been started or closed.');
    await pool.query(`UPDATE hub_cleaning_assignments SET status='in_progress',started_at=NOW(),updated_at=NOW() WHERE id=$1`, [assignmentId]);
  } else {
    const session = hubSession(event);
    const role = String(session?.role || '').toLowerCase();
    if (!session?.name || !['manager', 'team lead'].includes(role)) {
      throw new Error('A Team Lead or Admin must verify the area and finish this cleaning duty.');
    }
    if (row.status !== 'in_progress') throw new Error('Start the cleaning assignment before finishing it.');
    await pool.query(`UPDATE hub_cleaning_assignments SET status='completed',finished_at=NOW(),completed_by=$2,credit_minutes=15,updated_at=NOW() WHERE id=$1`, [assignmentId, row.employee_name]);
  }
  const updated = await pool.query(`SELECT * FROM hub_cleaning_assignments WHERE id=$1`, [assignmentId]);
  return normalizeLocalCleaning(updated.rows[0]);
}


async function submitAnnouncementResponse(event, body) {
  const session = hubSession(event);
  if (!session?.name) return { status: 401, body: { error: 'Sign in to the Warehouse Hub before answering.' } };
  const announcementId = text(body.announcementId, 80);
  const answer = text(body.answer, 700);
  if (!announcementId || !answer) return { status: 400, body: { error: 'Enter your answer before submitting.' } };
  const announcement = await pool.query(`
    SELECT id,title,start_date,end_date,question_enabled
    FROM hub_announcements WHERE id=$1 LIMIT 1
  `, [announcementId]);
  const row = announcement.rows[0];
  if (!row || !row.question_enabled) return { status: 404, body: { error: 'That question is no longer available.' } };
  const today = todayEastern();
  if (dateValue(row.start_date) > today || (row.end_date && dateValue(row.end_date) < today)) {
    return { status: 400, body: { error: 'That question is not accepting responses right now.' } };
  }
  const employeeKey = slug(session.name);
  const inserted = await pool.query(`
    INSERT INTO hub_announcement_responses(
      announcement_id,announcement_title,employee_key,employee_name,answer,submitted_at
    )
    VALUES($1,$2,$3,$4,$5,NOW())
    ON CONFLICT(announcement_id,employee_key) DO NOTHING
    RETURNING id,answer,submitted_at
  `, [announcementId, text(row.title, 120), employeeKey, text(session.name, 100), answer]);
  if (!inserted.rowCount) {
    return { status: 409, body: { error: 'You already submitted an answer to this question. Your first response is the one that counts.' } };
  }
  return {
    status: 200,
    body: {
      ok: true,
      response: {
        id: Number(inserted.rows[0].id),
        answer: inserted.rows[0].answer,
        submittedAt: inserted.rows[0].submitted_at,
      },
    },
  };
}

async function selectAnnouncementWinner(event, body) {
  const responseId = Number(body.responseId);
  if (!Number.isSafeInteger(responseId) || responseId <= 0) return { status: 400, body: { error: 'Choose a response.' } };
  const session = hubSession(event);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const response = await client.query(`
      SELECT r.id,r.announcement_id,r.employee_name,r.winner,r.rewarded_at,
             COALESCE(a.reward_slots,3) AS reward_slots
      FROM hub_announcement_responses r
      LEFT JOIN hub_announcements a ON a.id=r.announcement_id
      WHERE r.id=$1 FOR UPDATE
    `, [responseId]);
    const row = response.rows[0];
    if (!row) { await client.query('ROLLBACK'); return { status: 404, body: { error: 'That response no longer exists.' } }; }
    if (row.winner) { await client.query('ROLLBACK'); return { status: 200, body: { ok: true, message: `${row.employee_name} is already selected as a winner.` } }; }
    const count = await client.query(`
      SELECT COUNT(*)::int AS n FROM hub_announcement_responses
      WHERE announcement_id=$1 AND winner=TRUE
    `, [row.announcement_id]);
    const limit = Math.max(1, Math.min(20, Number(row.reward_slots || 3)));
    if (Number(count.rows[0]?.n || 0) >= limit) {
      await client.query('ROLLBACK');
      return { status: 409, body: { error: `This question already has ${limit} winner${limit === 1 ? '' : 's'}. Remove one before selecting another.` } };
    }
    await client.query(`
      UPDATE hub_announcement_responses
      SET winner=TRUE,winner_selected_at=NOW(),winner_selected_by=$2
      WHERE id=$1
    `, [responseId, text(session?.name || 'Admin', 100)]);
    await client.query('COMMIT');
    return { status: 200, body: { ok: true, message: `${row.employee_name} selected as a winner. Their reward is now pending.` } };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function unselectAnnouncementWinner(event, body) {
  const responseId = Number(body.responseId);
  if (!Number.isSafeInteger(responseId) || responseId <= 0) return { status: 400, body: { error: 'Choose a response.' } };
  const result = await pool.query(`
    UPDATE hub_announcement_responses
    SET winner=FALSE,winner_selected_at=NULL,winner_selected_by='',reward_note=''
    WHERE id=$1 AND winner=TRUE AND rewarded_at IS NULL
    RETURNING employee_name
  `, [responseId]);
  if (!result.rowCount) return { status: 409, body: { error: 'That winner cannot be removed after the reward has been marked given.' } };
  return { status: 200, body: { ok: true, message: `${result.rows[0].employee_name} removed from the winner list.` } };
}

async function markAnnouncementRewardGiven(event, body) {
  const responseId = Number(body.responseId);
  if (!Number.isSafeInteger(responseId) || responseId <= 0) return { status: 400, body: { error: 'Choose a pending reward.' } };
  const session = hubSession(event);
  const result = await pool.query(`
    UPDATE hub_announcement_responses
    SET rewarded_at=NOW(),rewarded_by=$2,reward_note=$3
    WHERE id=$1 AND winner=TRUE AND rewarded_at IS NULL
    RETURNING employee_name
  `, [responseId, text(session?.name || 'Admin / Team Lead', 100), text(body.rewardNote, 500)]);
  if (!result.rowCount) return { status: 409, body: { error: 'That reward is no longer pending.' } };
  return { status: 200, body: { ok: true, message: `Reward marked given to ${result.rows[0].employee_name}.` } };
}

// Signed-out visitors still see cleaning areas and status, but not who is assigned.
function hideCleaningNames(feed) {
  return {
    ...feed,
    namesHidden: true,
    cleaning: feed.cleaning.map((r) => ({
      ...r,
      employeeName: '',
      scheduledEmployeeName: r.scheduledEmployeeName === undefined ? undefined : '',
      completedBy: r.completedBy ? '' : r.completedBy,
      task: r.covered ? 'Covering for a teammate' : r.task,
    })),
  };
}

exports.handler = async function handler(event) {
  if (!process.env.DATABASE_URL) return json(500, { error: 'DATABASE_URL is not configured' });
  try {
    await ensureSchema();
    if (event.httpMethod === 'GET') {
      const admin = String(event.queryStringParameters?.admin || '') === '1';
      if (admin && !managerAuthorized(event)) return json(401, { error: 'Admin access denied.' });
      const session = hubSession(event);
      const feed = await readFeed(admin, session);
      return json(200, admin || session ? feed : hideCleaningNames(feed));
    }
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
    const body = JSON.parse(event.body || '{}');
    if (body.action === 'cleaningAction') return json(200, { ok: true, result: await cleaningAction(event, body) });
    if (body.action === 'submitAnnouncementResponse') {
      const response = await submitAnnouncementResponse(event, body);
      return json(response.status, response.body);
    }
    if (body.action === 'markAnnouncementRewardGiven') {
      if (!rewardAdminAuthorized(event)) return json(401, { error: 'Admin or Team Lead access is required.' });
      const response = await markAnnouncementRewardGiven(event, body);
      return json(response.status, response.body);
    }
    if (!managerAuthorized(event)) return json(401, { error: 'Admin access denied.' });
    let result = null;
    if (body.action === 'upsertAnnouncement') result = await upsertAnnouncement(body);
    else if (body.action === 'upsertPolicy') result = await upsertPolicy(body);
    else if (body.action === 'selectAnnouncementWinner') {
      const response = await selectAnnouncementWinner(event, body);
      if (response.status !== 200) return json(response.status, response.body);
      result = response.body;
    }
    else if (body.action === 'unselectAnnouncementWinner') {
      const response = await unselectAnnouncementWinner(event, body);
      if (response.status !== 200) return json(response.status, response.body);
      result = response.body;
    }
    if (result?.created) {
      const isPolicy = body.action === 'upsertPolicy';
      const isQuestion = !isPolicy && result.questionEnabled;
      await hubPush.sendAdmins(pool, {
        category: isPolicy ? 'policy' : 'announcement',
        eventKey: `${isPolicy ? 'policy' : 'announcement'}-created:${result.id}`,
        title: `${isPolicy ? '📋 New policy' : (isQuestion ? '🏆 New prize question' : '📣 New announcement')}: ${result.title}`,
        body: `${result.detail}${hubSession(event)?.name ? ` · Posted by ${hubSession(event).name}` : ''}`,
        url: '/warehouse-hub/',
        tag: `${isPolicy ? 'policy' : 'announcement'}-${result.id}`,
        excludeName: hubSession(event)?.name || '',
      });
    }
    if (result) {
      if (result.id) result = { id: result.id };
      return json(200, { ok: true, result });
    }
    if (body.action === 'deleteAnnouncement') { body.kind = 'announcement'; await deleteRecord(body); }
    else if (body.action === 'deletePolicy') { body.kind = 'policy'; await deleteRecord(body); }
    else if (body.action === 'setTheme') {
      const theme = text(body.theme, 40).toLowerCase();
      if (theme && !/^[a-z0-9-]+$/.test(theme)) return json(400, { error: 'Unknown theme.' });
      const by = text(hubSession(event)?.name || 'Admin key', 100);
      for (const [key, value] of [['theme', theme], ['themeBanner', text(body.banner, 160)]]) {
        await pool.query(`INSERT INTO hub_settings(key,value,updated_by,updated_at) VALUES($1,$2,$3,NOW())
          ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_by=EXCLUDED.updated_by,updated_at=NOW()`, [key, value, by]);
      }
    }
    else if (body.action === 'setShowOnOpen') {
      const table = { announcement: 'hub_announcements', policy: 'hub_policies' }[text(body.kind, 30)];
      const id = text(body.id, 80);
      if (!table || !id) return json(400, { error: 'Choose an announcement or policy.' });
      const updated = await pool.query(`UPDATE ${table} SET show_on_open=$2 WHERE id=$1`, [id, !!body.on]);
      if (!updated.rowCount) return json(404, { error: 'That item no longer exists.' });
    }
    else return json(400, { error: 'Unsupported action.' });
    return json(200, { ok: true, result: null });
  } catch (error) {
    return json(400, { error: text(error?.message || 'Unexpected error.', 300) });
  }
};
