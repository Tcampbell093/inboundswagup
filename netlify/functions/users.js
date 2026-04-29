const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : undefined,
});

const GOTRUE_URL  = 'https://inboundswagup.netlify.app/.netlify/identity';
const NETLIFY_PAT = process.env.NETLIFY_PAT;
const SITE_ID     = 'e0682cfd-2c71-4105-b217-1dc6863a3747';

function json(code, body) {
  return {
    statusCode: code,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

// ── Ensure schema exists ─────────────────────────────────────
async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hc_users (
      id          TEXT PRIMARY KEY,
      email       TEXT UNIQUE NOT NULL,
      name        TEXT DEFAULT '',
      role        TEXT DEFAULT 'l1',
      overrides   JSONB DEFAULT '{}'::jsonb,
      temp_admin  BOOLEAN DEFAULT false,
      temp_admin_expiry TIMESTAMPTZ,
      suspended   BOOLEAN DEFAULT false,
      last_login  TIMESTAMPTZ,
      created_at  TIMESTAMPTZ DEFAULT now(),
      updated_at  TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS access_audit (
      id         SERIAL PRIMARY KEY,
      actor      TEXT,
      target     TEXT,
      action     TEXT,
      detail     JSONB,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
}

// ── Verify caller is admin or manager ────────────────────────
async function verifyAdmin(event) {
  const auth  = event.headers['authorization'] || event.headers['Authorization'] || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return null;

  // Verify token with Identity
  const res = await fetch(`${GOTRUE_URL}/user`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) return null;
  const user = await res.json();

  // Check role in our DB first, fall back to Identity metadata
  await ensureSchema();
  const dbRes = await pool.query('SELECT * FROM hc_users WHERE email=$1', [user.email]);
  const dbUser = dbRes.rows[0];
  const role = dbUser?.role
            || user.app_metadata?.role
            || user.app_metadata?.roles?.[0]
            || 'l1';

  if (!['admin', 'manager'].includes(role)) return null;
  return { user, role, email: user.email };
}

// ── Write audit entry ────────────────────────────────────────
async function writeAudit(actor, target, action, detail) {
  try {
    await pool.query(
      `INSERT INTO access_audit (actor, target, action, detail) VALUES ($1,$2,$3,$4)`,
      [actor, target, action, JSON.stringify(detail)]
    );
  } catch(e) { console.error('Audit write failed:', e.message); }
}

exports.handler = async function(event) {
  const method = event.httpMethod;
  const action = (event.queryStringParameters || {}).action;

  await ensureSchema();

  // ── LIST users ─────────────────────────────────────────────
  if (method === 'GET' && action === 'list') {
    const caller = await verifyAdmin(event);
    if (!caller) return json(401, { error: 'Unauthorized' });

    const result = await pool.query(
      `SELECT * FROM hc_users ORDER BY created_at DESC`
    );
    return json(200, { users: result.rows.map(u => ({
      id:              u.id,
      email:           u.email,
      name:            u.name,
      role:            u.role,
      overrides:       u.overrides || {},
      tempAdmin:       u.temp_admin,
      tempAdminExpiry: u.temp_admin_expiry,
      suspended:       u.suspended,
      lastLogin:       u.last_login,
      createdAt:       u.created_at,
    }))});
  }

  // ── UPSERT user on login (called from auth flow) ───────────
  if (method === 'POST' && action === 'upsert') {
    const { id, email, name } = JSON.parse(event.body || '{}');
    if (!email) return json(400, { error: 'email required' });

    // Check if user exists
    const existing = await pool.query('SELECT role FROM hc_users WHERE email=$1', [email]);

    if (existing.rows.length === 0) {
      // New user — insert with default role
      await pool.query(
        `INSERT INTO hc_users (id, email, name, role, last_login)
         VALUES ($1,$2,$3,'l1',now())
         ON CONFLICT (email) DO UPDATE SET last_login=now(), name=EXCLUDED.name`,
        [id || email, email, name || '']
      );
      return json(200, { role: 'l1', overrides: {}, tempAdmin: false, suspended: false });
    } else {
      // Existing user — update last login
      await pool.query(
        `UPDATE hc_users SET last_login=now(), name=COALESCE(NULLIF($2,''), name), updated_at=now()
         WHERE email=$1`,
        [email, name || '']
      );
      const u = (await pool.query('SELECT * FROM hc_users WHERE email=$1', [email])).rows[0];
      return json(200, {
        role:            u.role,
        overrides:       u.overrides || {},
        tempAdmin:       u.temp_admin,
        tempAdminExpiry: u.temp_admin_expiry,
        suspended:       u.suspended,
      });
    }
  }

  // ── INVITE user ────────────────────────────────────────────
  if (method === 'POST' && action === 'invite') {
    const caller = await verifyAdmin(event);
    if (!caller) return json(401, { error: 'Unauthorized' });

    const { email, role = 'l1', name = '' } = JSON.parse(event.body || '{}');
    if (!email) return json(400, { error: 'Email required' });

    // Add to our DB first
    await pool.query(
      `INSERT INTO hc_users (id, email, name, role)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (email) DO UPDATE SET role=$4, updated_at=now()`,
      [email, email, name, role]
    );

    // Send invite email via Resend
    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    const roleLabel = { admin:'Admin', manager:'Manager', l2:'Associate L2', l1:'Associate L1' }[role] || 'Associate';
    const loginUrl  = 'https://inboundswagup.netlify.app/login.html';

    if (RESEND_API_KEY) {
      try {
        const emailRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'Houston Control <onboarding@resend.dev>',
            to: email,
            subject: "You've been invited to Houston Control",
            html: `
              <div style="font-family:Inter,system-ui,sans-serif;max-width:520px;margin:0 auto;background:#f0f7ff;border-radius:16px;overflow:hidden;">
                <div style="background:linear-gradient(135deg,#0a1628,#0f2444);padding:40px 32px;text-align:center;">
                  <h1 style="color:#fff;margin:0;font-size:24px;font-weight:800;letter-spacing:-.5px;">Houston Control</h1>
                  <p style="color:rgba(255,255,255,.6);margin:8px 0 0;font-size:14px;">Warehouse Operations Hub</p>
                </div>
                <div style="padding:32px;">
                  <h2 style="margin:0 0 12px;font-size:20px;color:#0f2444;">You've been invited!</h2>
                  <p style="color:#444;line-height:1.6;margin:0 0 8px;">
                    ${caller.email} has invited you to join <strong>Houston Control</strong> as <strong>${roleLabel}</strong>.
                  </p>
                  <p style="color:#444;line-height:1.6;margin:0 0 24px;">
                    Sign in with your Google account to get started. Make sure to use this email address (${email}) when signing in.
                  </p>
                  <div style="text-align:center;margin-bottom:24px;">
                    <a href="${loginUrl}" style="display:inline-block;background:#0f2444;color:#fff;padding:14px 32px;border-radius:10px;font-weight:700;font-size:15px;text-decoration:none;">
                      Sign in to Houston Control →
                    </a>
                  </div>
                  <p style="color:#888;font-size:12px;text-align:center;margin:0;">
                    If you weren't expecting this invitation, you can ignore this email.
                  </p>
                </div>
              </div>
            `,
          }),
        });
        if (!emailRes.ok) {
          const errText = await emailRes.text();
          console.error('Resend error:', emailRes.status, errText);
        } else {
          console.log('HC Users: invite email sent to', email);
        }
      } catch(e) {
        console.error('Resend invite error (non-fatal):', e.message);
      }
    } else {
      console.warn('HC Users: RESEND_API_KEY not set — invite email skipped');
    }

    await writeAudit(caller.email, email, 'invite', { role });
    return json(200, { ok: true });
  }

  // ── UPDATE user ────────────────────────────────────────────
  if (method === 'POST' && action === 'update') {
    const caller = await verifyAdmin(event);
    if (!caller) return json(401, { error: 'Unauthorized' });

    const { email, role, overrides, suspended, tempAdmin, tempAdminExpiry }
      = JSON.parse(event.body || '{}');
    if (!email) return json(400, { error: 'email required' });

    // Get current state for audit
    const before = (await pool.query('SELECT * FROM hc_users WHERE email=$1', [email])).rows[0];

    await pool.query(
      `UPDATE hc_users SET
        role            = COALESCE($2, role),
        overrides       = COALESCE($3::jsonb, overrides),
        suspended       = COALESCE($4, suspended),
        temp_admin      = COALESCE($5, temp_admin),
        temp_admin_expiry = $6,
        updated_at      = now()
       WHERE email = $1`,
      [
        email,
        role       ?? null,
        overrides  ? JSON.stringify(overrides) : null,
        suspended  ?? null,
        tempAdmin  ?? null,
        tempAdminExpiry ? new Date(tempAdminExpiry) : null,
      ]
    );

    await writeAudit(caller.email, email, 'update', { before, after: { role, overrides, suspended, tempAdmin, tempAdminExpiry } });
    return json(200, { ok: true });
  }

  // ── AUDIT log ──────────────────────────────────────────────
  if (method === 'GET' && action === 'audit') {
    const caller = await verifyAdmin(event);
    if (!caller) return json(401, { error: 'Unauthorized' });

    const result = await pool.query(
      `SELECT * FROM access_audit ORDER BY created_at DESC LIMIT 100`
    );
    return json(200, { entries: result.rows });
  }

  return json(405, { error: 'Method not allowed' });
};
