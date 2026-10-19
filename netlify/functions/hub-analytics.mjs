import pg from 'pg';
import crypto from 'node:crypto';

const { Pool } = pg;
let poolInstance = null;

const SESSION_COOKIE = 'hub_associate_session';
const SESSION_VERSION = 2;
const ALLOWED_EVENTS = new Set(['hub_visit', 'tool_open', 'feature_open']);

function env(name) {
  return globalThis.Netlify?.env?.get(name) || process.env[name] || '';
}

function clean(value, max = 300) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function slug(value) {
  return clean(value, 160)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120);
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
  return Object.fromEntries(
    raw.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
      const index = part.indexOf('=');
      return index === -1 ? [part, ''] : [part.slice(0, index), part.slice(index + 1)];
    }),
  );
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
  if (safeEqual(request.headers.get('x-hub-key') || '', env('HUB_MANAGER_KEY'))) return true;
  return String(hubSession(request)?.role || '').toLowerCase() === 'manager';
}

function getPool() {
  const connectionString = env('DATABASE_URL');
  if (!connectionString) throw new Error('DATABASE_URL is not configured.');
  if (!poolInstance) poolInstance = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  return poolInstance;
}

async function ensureSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hub_usage_events (
      id BIGSERIAL PRIMARY KEY,
      event_type TEXT NOT NULL,
      event_key TEXT NOT NULL DEFAULT '',
      event_label TEXT NOT NULL DEFAULT '',
      employee_key TEXT NOT NULL,
      employee_name TEXT NOT NULL,
      department TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT '',
      session_id TEXT,
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS hub_usage_events_time_idx ON hub_usage_events(occurred_at DESC);
    CREATE INDEX IF NOT EXISTS hub_usage_events_type_idx ON hub_usage_events(event_type, occurred_at DESC);
    CREATE INDEX IF NOT EXISTS hub_usage_events_employee_idx ON hub_usage_events(employee_key, occurred_at DESC);
    CREATE INDEX IF NOT EXISTS hub_usage_events_key_idx ON hub_usage_events(event_key, occurred_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS hub_usage_visit_session_idx
      ON hub_usage_events(session_id)
      WHERE event_type='hub_visit' AND session_id IS NOT NULL;
  `);
}

function periodDays(value) {
  const n = Number(value);
  return [7, 30, 90].includes(n) ? n : 30;
}

async function teamSize(pool) {
  try {
    const result = await pool.query(`SELECT COUNT(*)::int AS n FROM hub_sched_employees WHERE active=TRUE`);
    return Number(result.rows[0]?.n || 0);
  } catch {
    return 0;
  }
}

async function analytics(pool, days) {
  const whereDate = `(occurred_at AT TIME ZONE 'America/New_York')::date >= ((NOW() AT TIME ZONE 'America/New_York')::date - ($1::int - 1))`;

  const [
    summaryResult,
    dailyResult,
    toolResult,
    featureResult,
    userResult,
    departmentResult,
    hourResult,
    trackingResult,
    lifetimeResult,
    activeTeam,
  ] = await Promise.all([
    pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE event_type='hub_visit')::int AS visits,
        COUNT(DISTINCT employee_key) FILTER (WHERE event_type='hub_visit')::int AS active_users,
        COUNT(*)::int AS interactions,
        COUNT(*) FILTER (
          WHERE event_type='hub_visit'
          AND (occurred_at AT TIME ZONE 'America/New_York')::date=(NOW() AT TIME ZONE 'America/New_York')::date
        )::int AS today_visits
      FROM hub_usage_events
      WHERE ${whereDate}
    `, [days]),
    pool.query(`
      WITH dates AS (
        SELECT generate_series(
          (NOW() AT TIME ZONE 'America/New_York')::date - ($1::int - 1),
          (NOW() AT TIME ZONE 'America/New_York')::date,
          interval '1 day'
        )::date AS day
      ),
      activity AS (
        SELECT
          (occurred_at AT TIME ZONE 'America/New_York')::date AS day,
          COUNT(*) FILTER (WHERE event_type='hub_visit')::int AS visits,
          COUNT(DISTINCT employee_key) FILTER (WHERE event_type='hub_visit')::int AS users,
          COUNT(*)::int AS interactions
        FROM hub_usage_events
        WHERE ${whereDate}
        GROUP BY 1
      )
      SELECT to_char(d.day,'YYYY-MM-DD') AS date,
             COALESCE(a.visits,0)::int AS visits,
             COALESCE(a.users,0)::int AS users,
             COALESCE(a.interactions,0)::int AS interactions
      FROM dates d
      LEFT JOIN activity a ON a.day=d.day
      ORDER BY d.day
    `, [days]),
    pool.query(`
      SELECT
        event_key AS key,
        MAX(NULLIF(event_label,'')) AS label,
        COUNT(*)::int AS opens,
        COUNT(DISTINCT employee_key)::int AS users,
        MAX(occurred_at) AS last_used
      FROM hub_usage_events
      WHERE ${whereDate} AND event_type='tool_open' AND event_key<>''
      GROUP BY event_key
      ORDER BY opens DESC, event_key ASC
      LIMIT 30
    `, [days]),
    pool.query(`
      SELECT
        event_key AS key,
        MAX(NULLIF(event_label,'')) AS label,
        COUNT(*)::int AS opens,
        COUNT(DISTINCT employee_key)::int AS users,
        MAX(occurred_at) AS last_used
      FROM hub_usage_events
      WHERE ${whereDate} AND event_type='feature_open' AND event_key<>''
      GROUP BY event_key
      ORDER BY opens DESC, event_key ASC
      LIMIT 30
    `, [days]),
    pool.query(`
      SELECT
        employee_key,
        MAX(employee_name) AS name,
        (ARRAY_AGG(NULLIF(department,'') ORDER BY occurred_at DESC)
          FILTER (WHERE NULLIF(department,'') IS NOT NULL))[1] AS department,
        (ARRAY_AGG(NULLIF(role,'') ORDER BY occurred_at DESC)
          FILTER (WHERE NULLIF(role,'') IS NOT NULL))[1] AS role,
        COUNT(*) FILTER (WHERE event_type='hub_visit')::int AS visits,
        COUNT(*)::int AS interactions,
        MAX(occurred_at) AS last_active
      FROM hub_usage_events
      WHERE ${whereDate}
      GROUP BY employee_key
      ORDER BY visits DESC, interactions DESC, name ASC
    `, [days]),
    pool.query(`
      SELECT
        COALESCE(NULLIF(department,''),'Unassigned') AS department,
        COUNT(*) FILTER (WHERE event_type='hub_visit')::int AS visits,
        COUNT(DISTINCT employee_key)::int AS users,
        COUNT(*)::int AS interactions
      FROM hub_usage_events
      WHERE ${whereDate}
      GROUP BY COALESCE(NULLIF(department,''),'Unassigned')
      ORDER BY visits DESC, interactions DESC, department ASC
    `, [days]),
    pool.query(`
      SELECT
        EXTRACT(HOUR FROM occurred_at AT TIME ZONE 'America/New_York')::int AS hour,
        COUNT(*) FILTER (WHERE event_type='hub_visit')::int AS visits,
        COUNT(*)::int AS interactions
      FROM hub_usage_events
      WHERE ${whereDate}
      GROUP BY 1
      ORDER BY 1
    `, [days]),
    pool.query(`SELECT MIN(occurred_at) AS started_at FROM hub_usage_events`),
    pool.query(`
      SELECT
        t.id AS key,
        t.title,
        COALESCE(u.click_count,0)::bigint AS lifetime_opens,
        u.last_opened_at AS lifetime_last_used
      FROM hub_tool_cards t
      LEFT JOIN hub_tool_usage u ON u.tool_id=t.id
      WHERE t.active=TRUE
      ORDER BY COALESCE(u.click_count,0) DESC, t.title ASC
    `),
    teamSize(pool),
  ]);

  const summaryRow = summaryResult.rows[0] || {};
  const visits = Number(summaryRow.visits || 0);
  const activeUsers = Number(summaryRow.active_users || 0);
  const totalTeam = Number(activeTeam || 0);
  const lifetimeMap = new Map(lifetimeResult.rows.map((row) => [String(row.key), row]));

  const tools = toolResult.rows.map((row) => {
    const lifetime = lifetimeMap.get(String(row.key)) || {};
    return {
      key: row.key,
      title: row.label || lifetime.title || row.key,
      opens: Number(row.opens || 0),
      users: Number(row.users || 0),
      lastUsed: row.last_used || null,
      lifetimeOpens: Number(lifetime.lifetime_opens || 0),
      lifetimeLastUsed: lifetime.lifetime_last_used || null,
    };
  });

  for (const row of lifetimeResult.rows) {
    if (tools.some((tool) => tool.key === row.key)) continue;
    tools.push({
      key: row.key,
      title: row.title || row.key,
      opens: 0,
      users: 0,
      lastUsed: null,
      lifetimeOpens: Number(row.lifetime_opens || 0),
      lifetimeLastUsed: row.lifetime_last_used || null,
    });
  }

  return {
    days,
    trackingStarted: trackingResult.rows[0]?.started_at || null,
    summary: {
      visits,
      activeUsers,
      interactions: Number(summaryRow.interactions || 0),
      todayVisits: Number(summaryRow.today_visits || 0),
      teamSize: totalTeam,
      adoptionPct: totalTeam ? Math.round((activeUsers / totalTeam) * 1000) / 10 : null,
      avgVisitsPerDay: Math.round((visits / days) * 10) / 10,
    },
    daily: dailyResult.rows.map((row) => ({
      date: row.date,
      visits: Number(row.visits || 0),
      users: Number(row.users || 0),
      interactions: Number(row.interactions || 0),
    })),
    tools,
    features: featureResult.rows.map((row) => ({
      key: row.key,
      label: row.label || row.key,
      opens: Number(row.opens || 0),
      users: Number(row.users || 0),
      lastUsed: row.last_used || null,
    })),
    users: userResult.rows.map((row) => ({
      key: row.employee_key,
      name: row.name || row.employee_key,
      department: row.department || 'Unassigned',
      role: row.role || '',
      visits: Number(row.visits || 0),
      interactions: Number(row.interactions || 0),
      lastActive: row.last_active || null,
    })),
    departments: departmentResult.rows.map((row) => ({
      department: row.department,
      visits: Number(row.visits || 0),
      users: Number(row.users || 0),
      interactions: Number(row.interactions || 0),
    })),
    hours: hourResult.rows.map((row) => ({
      hour: Number(row.hour || 0),
      visits: Number(row.visits || 0),
      interactions: Number(row.interactions || 0),
    })),
  };
}

export default async (request) => {
  try {
    const pool = getPool();
    await ensureSchema(pool);
    const url = new URL(request.url);

    if (request.method === 'GET') {
      if (!managerAuthorized(request)) return json(401, { error: 'Admin access denied.' });
      const days = periodDays(url.searchParams.get('days'));
      return json(200, await analytics(pool, days));
    }

    if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });

    const session = hubSession(request);
    if (!session) return json(401, { error: 'Sign in to Warehouse Hub first.' });

    const body = await request.json().catch(() => ({}));
    if (body.action !== 'recordEvent') return json(400, { error: 'Unsupported analytics action.' });

    const eventType = clean(body.eventType, 40);
    if (!ALLOWED_EVENTS.has(eventType)) return json(400, { error: 'Unsupported analytics event.' });

    const employeeName = clean(session.name, 120);
    const employeeKey = slug(employeeName);
    if (!employeeKey) return json(400, { error: 'Signed-in user is unavailable.' });

    const eventKey = slug(body.eventKey || '');
    const eventLabel = clean(body.eventLabel || '', 160);
    const department = clean(session.department || '', 120);
    const role = clean(session.role || '', 80);
    const sessionId = clean(body.sessionId || '', 160) || null;

    if (eventType === 'hub_visit' && !sessionId) return json(400, { error: 'Visit session id is required.' });

    const result = await pool.query(`
      INSERT INTO hub_usage_events(
        event_type,event_key,event_label,employee_key,employee_name,department,role,session_id,occurred_at
      )
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,NOW())
      ON CONFLICT DO NOTHING
      RETURNING id
    `, [eventType, eventKey, eventLabel, employeeKey, employeeName, department, role, sessionId]);

    return json(200, { ok: true, recorded: result.rows.length > 0 });
  } catch (error) {
    console.warn('hub analytics failed:', error?.message);
    return json(400, { error: clean(error?.message || 'Analytics request failed.', 300) });
  }
};
