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

    // Read users directly from Neon — no Netlify API needed
    const result = await pool.query(
      `SELECT id, email, name, role, overrides, temp_admin, temp_admin_expiry, suspended, last_login, created_at
       FROM hc_users ORDER BY created_at DESC`
    );

    const users = result.rows.map(u => ({
      id:             u.id,
      email:          u.email,
      name:           u.name || '',
      role:           u.role || 'l1',
      overrides:      u.overrides || {},
      tempAdmin:      u.temp_admin || false,
      tempAdminExpiry:u.temp_admin_expiry || null,
      suspended:      u.suspended || false,
      lastLogin:      u.last_login || null,
      createdAt:      u.created_at || null,
    }));

    return json(200, { users });
  }

  // ── POST /users?action=invite ──────────────────────────────
  if (method === 'POST' && action === 'invite') {
    const caller = await verifyAdmin(event);
    if (!caller) return json(401, { error: 'Unauthorized' });

    const body = JSON.parse(event.body || '{}');
    const { email, role = 'l1', name = '' } = body;
    if (!email) return json(400, { error: 'Email required' });

    // Add invited column if missing
    await pool.query(`ALTER TABLE hc_users ADD COLUMN IF NOT EXISTS invited BOOLEAN DEFAULT true`);

    // Upsert into hc_users — create or update role
    const existing = await pool.query('SELECT id FROM hc_users WHERE email=$1', [email]);
    if (existing.rows.length > 0) {
      // User exists — update role and mark as invited
      await pool.query(
        `UPDATE hc_users SET role=$2, invited=true, updated_at=now() WHERE email=$1`,
        [email, role]
      );
    } else {
      // New user — insert with invited=true
      await pool.query(
        `INSERT INTO hc_users (id, email, name, role, invited, created_at, updated_at)
         VALUES ($1,$2,$3,$4,true,now(),now())`,
        [email, email, name, role]
      );
    }

    // Send invite email via Resend if configured
    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    if (RESEND_API_KEY) {
      const roleLabels = { admin:'Admin', manager:'Manager', l2:'Associate L2', l1:'Associate L1', external:'External / Stakeholder' };
      const roleLabel = roleLabels[role] || role;
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Houston Control <onboarding@resend.dev>',
          to: email,
          subject: "You've been invited to Houston Control",
          html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;">
            <h2 style="margin:0 0 12px;font-size:20px;color:#0f2444;">You've been invited!</h2>
            <p style="color:#374151;line-height:1.6;">
              ${caller.user.email} has invited you to join <strong>Houston Control</strong> as <strong>${roleLabel}</strong>.
            </p>
            <p style="margin-top:20px;">
              <a href="https://inboundswagup.netlify.app/login.html"
                style="background:#185FA5;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">
                Sign in with Google →
              </a>
            </p>
            <p style="color:#9ca3af;font-size:12px;margin-top:24px;">Sign in with the Google account associated with ${email}</p>
          </div>`,
        }),
      }).catch(() => {});
    }

    await writeAudit(caller.user.email, email, 'invite', { role });
    return json(200, { ok: true });
  }

  // ── POST /users?action=delete ──────────────────────────────
  // Removes the user's row from hc_users. Without an hc_users row they
  // can't pass the upsert gate on login, so this fully revokes access.
  // We deliberately do NOT delete the underlying Netlify Identity user —
  // re-inviting them is the recovery path if this was a mistake.
  if (method === 'POST' && action === 'delete') {
    const caller = await verifyAdmin(event);
    if (!caller) return json(401, { error: 'Unauthorized' });

    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON' }); }
    const { targetEmail, userId } = body;
    const email = targetEmail || userId;
    if (!email) return json(400, { error: 'targetEmail required' });

    // Don't let an admin delete their own account — they'd lock themselves
    // out instantly. Use suspend if you really want to disable yourself.
    if (String(email).toLowerCase() === String(caller.user.email).toLowerCase()) {
      return json(400, { error: 'You cannot delete your own account. Suspend it instead, or have another admin remove it.' });
    }

    // Look up the user first so we can audit-log what role they had
    const existing = await pool.query('SELECT * FROM hc_users WHERE email=$1 OR id=$1', [email]);
    if (!existing.rows.length) return json(404, { error: 'User not found' });
    const before = existing.rows[0];

    await pool.query('DELETE FROM hc_users WHERE email=$1', [before.email]);

    await writeAudit(caller.user.email, before.email, 'delete', {
      role: before.role,
      suspended: before.suspended,
    });

    return json(200, { ok: true });
  }

  // ── POST /users?action=update ──────────────────────────────
  if (method === 'POST' && action === 'update') {
    const caller = await verifyAdmin(event);
    if (!caller) return json(401, { error: 'Unauthorized' });

    const body = JSON.parse(event.body || '{}');
    const { userId, role, overrides, suspended, tempAdmin, tempAdminExpiry, targetEmail } = body;

    // userId can be email or id — find the user
    const email = targetEmail || userId;
    if (!email) return json(400, { error: 'userId or targetEmail required' });

    const existing = await pool.query('SELECT * FROM hc_users WHERE email=$1 OR id=$1', [email]);
    if (!existing.rows.length) return json(404, { error: 'User not found' });
    const before = existing.rows[0];

    // Build update fields
    const updates = [];
    const vals = [];
    let i = 1;
    if (role      !== undefined) { updates.push(`role=$${i++}`);            vals.push(role); }
    if (overrides !== undefined) { updates.push(`overrides=$${i++}`);       vals.push(JSON.stringify(overrides)); }
    if (suspended !== undefined) { updates.push(`suspended=$${i++}`);       vals.push(suspended); }
    if (tempAdmin !== undefined) { updates.push(`temp_admin=$${i++}`);      vals.push(tempAdmin); }
    if (tempAdminExpiry !== undefined) { updates.push(`temp_admin_expiry=$${i++}`); vals.push(tempAdminExpiry); }
    updates.push(`updated_at=now()`);

    if (vals.length) {
      vals.push(before.email);
      await pool.query(`UPDATE hc_users SET ${updates.join(',')} WHERE email=$${i}`, vals);
    }

    await writeAudit(caller.user.email, before.email, 'update', {
      before: { role: before.role, suspended: before.suspended },
      after:  { role, suspended }
    });

    return json(200, { ok: true });
  }

  // ── POST /users?action=upsert — called on every login ───────
  if (method === 'POST' && action === 'upsert') {
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON' }); }
    const { id, email, name } = body;
    if (!email) return json(400, { error: 'email required' });

    // Add invited column if missing
    await pool.query(`ALTER TABLE hc_users ADD COLUMN IF NOT EXISTS invited BOOLEAN DEFAULT true`);

    // Check if user exists in our DB
    const existing = await pool.query('SELECT * FROM hc_users WHERE email=$1', [email]);

    if (existing.rows.length === 0) {
      // Not in our system — block
      return json(200, { unauthorized: true, reason: 'not_invited' });
    }

    const u = existing.rows[0];

    if (u.suspended) return json(200, { suspended: true });
    if (u.invited === false) return json(200, { unauthorized: true, reason: 'not_invited' });

    // Update last login
    await pool.query(
      `UPDATE hc_users SET last_login=now(), name=COALESCE(NULLIF($2,''), name), updated_at=now() WHERE email=$1`,
      [email, name || '']
    );

    // Re-fetch the (possibly updated) name so the client reflects the
    // user's chosen display name, not whatever Identity sent.
    const after = await pool.query('SELECT name FROM hc_users WHERE email=$1', [email]);
    const dbName = (after.rows[0] && after.rows[0].name) || '';

    return json(200, {
      name:            dbName,
      role:            u.role,
      overrides:       u.overrides || {},
      tempAdmin:       u.temp_admin  || false,
      tempAdminExpiry: u.temp_admin_expiry || null,
      suspended:       u.suspended   || false,
    });
  }

  // ── POST /users?action=update-profile ─────────────────────
  //   Any authenticated user can update THEIR OWN display name.
  //   Verifies the Identity token and writes only to that user's row.
  if (method === 'POST' && action === 'update-profile') {
    const auth = event.headers['authorization'] || event.headers['Authorization'] || '';
    const token = auth.replace('Bearer ', '').trim();
    if (!token) return json(401, { error: 'Unauthorized' });

    // Verify the caller via Identity
    let identityUser;
    try {
      const res = await fetch(
        `https://inboundswagup.netlify.app/.netlify/identity/user`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) return json(401, { error: 'Token verification failed' });
      identityUser = await res.json();
    } catch (err) {
      return json(401, { error: 'Token verification error' });
    }

    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON' }); }
    const newName = String(body.name || '').trim().slice(0, 80);
    if (!newName) return json(400, { error: 'Name is required' });

    // Only update the caller's own row, keyed on Identity-verified email
    const result = await pool.query(
      `UPDATE hc_users SET name=$2, updated_at=now()
        WHERE email=$1
        RETURNING name`,
      [identityUser.email, newName]
    );
    if (!result.rows.length) return json(404, { error: 'User row not found' });

    return json(200, { name: result.rows[0].name });
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
