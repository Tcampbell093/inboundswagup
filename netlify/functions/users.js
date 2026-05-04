const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : undefined,
});

const NETLIFY_API = 'https://api.netlify.com/api/v1';
const SITE_ID     = process.env.SITE_ID || 'e0682cfd-2c71-4105-b217-1dc6863a3747';
const NETLIFY_PAT = process.env.NETLIFY_PAT;

// Identity API uses a different base URL
const IDENTITY_API = `https://inboundswagup.netlify.app/.netlify/identity`;

function json(code, body) {
  return {
    statusCode: code,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

// ── Verify caller is admin or manager ────────────────────────
async function verifyAdmin(event) {
  const auth = event.headers['authorization'] || event.headers['Authorization'] || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) {
    console.error('HC Users: no authorization token in request');
    return null;
  }

  const res = await fetch(
    `https://inboundswagup.netlify.app/.netlify/identity/user`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) {
    console.error('HC Users: token verification failed', res.status);
    return null;
  }
  const user = await res.json();

  // ── Check role from hc_users (Neon) first — source of truth ──
  let role = 'l1';
  try {
    const dbRes = await pool.query('SELECT role FROM hc_users WHERE email=$1', [user.email]);
    if (dbRes.rows.length > 0 && dbRes.rows[0].role) {
      role = dbRes.rows[0].role;
    } else {
      // Fall back to Netlify Identity app_metadata
      role = user?.app_metadata?.role
          || (user?.app_metadata?.roles && user.app_metadata.roles[0])
          || 'l1';
    }
  } catch(e) {
    // DB unavailable — fall back to Identity metadata
    role = user?.app_metadata?.role
        || (user?.app_metadata?.roles && user.app_metadata.roles[0])
        || 'l1';
  }

  if (!['admin', 'manager'].includes(role)) {
    console.error('HC Users: insufficient role', role, 'for', user.email);
    return null;
  }
  return { user, role, token };
}

// ── Write audit log entry ─────────────────────────────────────
async function writeAudit(actor, target, action, detail) {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS access_audit (
        id SERIAL PRIMARY KEY,
        actor TEXT,
        target TEXT,
        action TEXT,
        detail JSONB,
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `);
    await pool.query(
      `INSERT INTO access_audit (actor, target, action, detail) VALUES ($1,$2,$3,$4)`,
      [actor, target, action, JSON.stringify(detail)]
    );
  } catch(e) {
    console.error('Audit log write failed:', e.message);
  }
}

exports.handler = async function(event) {
  const method = event.httpMethod;
  const params = event.queryStringParameters || {};
  const action = params.action;

  // ── GET /users?action=list ─────────────────────────────────
  if (method === 'GET' && action === 'list') {
    const caller = await verifyAdmin(event);
    if (!caller) return json(401, { error: 'Unauthorized' });

    if (!NETLIFY_PAT) {
      console.error('HC Users: NETLIFY_PAT environment variable is not set');
      return json(500, { error: 'NETLIFY_PAT not configured. Add it to your Netlify environment variables.' });
    }

    console.log('HC Users: fetching users from Netlify API, site:', SITE_ID);
    const listUrl = `${NETLIFY_API}/sites/${SITE_ID}/identity/users?per_page=100`;
    console.log('HC Users: URL:', listUrl);
    console.log('HC Users: PAT set:', !!NETLIFY_PAT, 'PAT length:', NETLIFY_PAT?.length);

    const res = await fetch(listUrl,
      { headers: { Authorization: `Bearer ${NETLIFY_PAT}` } }
    );

    if (!res.ok) {
      const errText = await res.text();
      console.error('HC Users: Netlify API error', res.status, errText);
      return json(502, { error: `Netlify API error ${res.status}: ${errText}` });
    }
    const data = await res.json();

    const users = (data.users || []).map(u => ({
      id:        u.id,
      email:     u.email,
      name:      u.user_metadata?.full_name || u.user_metadata?.name || '',
      role:      u.app_metadata?.role || (u.app_metadata?.roles && u.app_metadata.roles[0]) || 'l1',
      overrides: u.app_metadata?.overrides || {},
      tempAdmin: u.app_metadata?.tempAdmin || false,
      tempAdminExpiry: u.app_metadata?.tempAdminExpiry || null,
      suspended: u.app_metadata?.suspended || false,
      lastLogin: u.last_sign_in_at || null,
      createdAt: u.created_at || null,
    }));

    return json(200, { users });
  }

  // ── POST /users?action=invite ──────────────────────────────
  if (method === 'POST' && action === 'invite') {
    const caller = await verifyAdmin(event);
    if (!caller) return json(401, { error: 'Unauthorized' });

    const body = JSON.parse(event.body || '{}');
    const { email, role = 'l1' } = body;
    if (!email) return json(400, { error: 'Email required' });

    const res = await fetch(
      `${NETLIFY_API}/sites/${SITE_ID}/identity/users/invite`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${NETLIFY_PAT}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          data: { role },
        }),
      }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return json(502, { error: err.msg || 'Invite failed' });
    }

    await writeAudit(caller.user.email, email, 'invite', { role });
    return json(200, { ok: true });
  }

  // ── POST /users?action=update ──────────────────────────────
  if (method === 'POST' && action === 'update') {
    const caller = await verifyAdmin(event);
    if (!caller) return json(401, { error: 'Unauthorized' });

    const body = JSON.parse(event.body || '{}');
    const { userId, role, overrides, suspended, tempAdmin, tempAdminExpiry, targetEmail } = body;
    if (!userId) return json(400, { error: 'userId required' });

    // Fetch current app_metadata first
    const getRes = await fetch(
      `${NETLIFY_API}/sites/${SITE_ID}/identity/users/${userId}`,
      { headers: { Authorization: `Bearer ${NETLIFY_PAT}` } }
    );
    if (!getRes.ok) return json(502, { error: 'Failed to fetch user' });
    const currentUser = await getRes.json();
    const currentMeta = currentUser.app_metadata || {};

    const newMeta = {
      ...currentMeta,
      ...(role      !== undefined && { role }),
      ...(overrides !== undefined && { overrides }),
      ...(suspended !== undefined && { suspended }),
      ...(tempAdmin !== undefined && { tempAdmin }),
      ...(tempAdminExpiry !== undefined && { tempAdminExpiry }),
    };

    const updateRes = await fetch(
      `${NETLIFY_API}/sites/${SITE_ID}/identity/users/${userId}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${NETLIFY_PAT}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ app_metadata: newMeta }),
      }
    );
    if (!updateRes.ok) return json(502, { error: 'Update failed' });

    await writeAudit(caller.user.email, targetEmail || userId, 'update', {
      before: currentMeta, after: newMeta
    });

    return json(200, { ok: true });
  }

  // ── GET /users?action=audit ────────────────────────────────
  if (method === 'GET' && action === 'audit') {
    const caller = await verifyAdmin(event);
    if (!caller) return json(401, { error: 'Unauthorized' });

    await pool.query(`
      CREATE TABLE IF NOT EXISTS access_audit (
        id SERIAL PRIMARY KEY,
        actor TEXT, target TEXT, action TEXT,
        detail JSONB, created_at TIMESTAMPTZ DEFAULT now()
      )
    `);
    const result = await pool.query(
      `SELECT * FROM access_audit ORDER BY created_at DESC LIMIT 100`
    );
    return json(200, { entries: result.rows });
  }

  return json(405, { error: 'Method not allowed' });
};
