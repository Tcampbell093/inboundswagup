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

// Shared, always-on authorization (independent of the env-flag guard).
const { authorize, verifyIdentity } = require('./_auth');

// Roles a caller is allowed to assign. Any submitted role must be in this set.
const VALID_ROLES = ['admin', 'manager', 'l2', 'l1', 'external'];

function json(code, body) {
  return {
    statusCode: code,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

// Create the user in Netlify Identity so an invited person can sign in with
// Google immediately — no separate trip to the Netlify dashboard. Netlify
// injects an admin token into authenticated function calls via
// context.clientContext.identity ({ url, token }); we use it to hit GoTrue's
// admin/users endpoint. Non-fatal: if it fails we keep the hc_users row and
// just report a warning so the admin can fall back to the dashboard.
async function ensureNetlifyIdentityUser(context, email) {
  try {
    const idc = context && context.clientContext && context.clientContext.identity;
    if (!idc || !idc.url || !idc.token) return { ok: false, warning: 'no_identity_context' };
    const res = await fetch(`${idc.url}/admin/users`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${idc.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, email_confirm: true }),
    });
    if (res.ok) return { ok: true, created: true };
    if (res.status === 422) return { ok: true, already: true }; // already registered — fine
    const txt = await res.text().catch(() => '');
    console.warn('Netlify Identity create failed:', res.status, txt);
    return { ok: false, warning: `identity_${res.status}` };
  } catch (e) {
    console.warn('Netlify Identity create error:', e.message);
    return { ok: false, warning: 'identity_error' };
  }
}

// Authorization is delegated to the shared always-on helper:
//   reads  (list, audit) → authorize(event, ['admin','manager'])
//   writes (invite, delete, update, and all account mutations) → ['admin']
// This removes the old verifyAdmin(), which allowed managers to mutate
// accounts — the manager→admin escalation path. Active temp-admins are
// treated as admin by the shared helper; expired ones are not.

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

exports.handler = async function(event, context) {
  const method = event.httpMethod;
  const params = event.queryStringParameters || {};
  const action = params.action;

  // ── GET /users?action=list ─────────────────────────────────
  if (method === 'GET' && action === 'list') {
    const _a = await authorize(event, ['admin', 'manager']);
    if (!_a.ok) return json(_a.code, _a.body);
    const caller = _a.caller;

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
    const _a = await authorize(event, ['admin']);
    if (!_a.ok) return json(_a.code, _a.body);
    const caller = _a.caller;

    const body = JSON.parse(event.body || '{}');
    const { email: rawEmail, role = 'l1', name = '' } = body;
    if (!rawEmail) return json(400, { error: 'Email required' });
    if (!VALID_ROLES.includes(role)) return json(400, { error: 'Invalid role' });
    // Normalize to lowercase so it matches the email Google returns at sign-in
    // (Google sends lowercase). Storing/looking up mixed-case caused invited
    // users to read as "not invited" when they logged in.
    const email = String(rawEmail).trim().toLowerCase();

    // Add invited column if missing
    await pool.query(`ALTER TABLE hc_users ADD COLUMN IF NOT EXISTS invited BOOLEAN DEFAULT true`);

    // Upsert into hc_users — create or update role. Match case-insensitively so
    // a previously mis-cased row is updated (and normalized) rather than duplicated.
    const existing = await pool.query('SELECT id FROM hc_users WHERE LOWER(email)=$1', [email]);
    if (existing.rows.length > 0) {
      await pool.query(
        `UPDATE hc_users SET email=$1, role=$2, invited=true, updated_at=now() WHERE id=$3`,
        [email, role, existing.rows[0].id]
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

    // Also create them in Netlify Identity so they can sign in with Google
    // right away — no manual Netlify dashboard step.
    const identity = await ensureNetlifyIdentityUser(context, email);

    await writeAudit(caller.user.email, email, 'invite', { role, identity: identity.ok ? (identity.already ? 'exists' : 'created') : identity.warning });
    return json(200, {
      ok: true,
      identityCreated: identity.ok,
      identityWarning: identity.ok ? null : identity.warning,
    });
  }

  // ── POST /users?action=delete ──────────────────────────────
  // Removes the user's row from hc_users. Without an hc_users row they
  // can't pass the upsert gate on login, so this fully revokes access.
  // We deliberately do NOT delete the underlying Netlify Identity user —
  // re-inviting them is the recovery path if this was a mistake.
  if (method === 'POST' && action === 'delete') {
    const _a = await authorize(event, ['admin']);
    if (!_a.ok) return json(_a.code, _a.body);
    const caller = _a.caller;

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
    const existing = await pool.query('SELECT * FROM hc_users WHERE LOWER(email)=LOWER($1) OR id=$1', [email]);
    if (!existing.rows.length) return json(404, { error: 'User not found' });
    const before = existing.rows[0];

    await pool.query('DELETE FROM hc_users WHERE id=$1', [before.id]);

    await writeAudit(caller.user.email, before.email, 'delete', {
      role: before.role,
      suspended: before.suspended,
    });

    return json(200, { ok: true });
  }

  // ── POST /users?action=update ──────────────────────────────
  if (method === 'POST' && action === 'update') {
    const _a = await authorize(event, ['admin']);
    if (!_a.ok) return json(_a.code, _a.body);
    const caller = _a.caller;

    const body = JSON.parse(event.body || '{}');
    const { userId, role, overrides, suspended, tempAdmin, tempAdminExpiry, targetEmail } = body;

    // Validate any submitted role against the supported allowlist.
    if (role !== undefined && !VALID_ROLES.includes(role)) {
      return json(400, { error: 'Invalid role' });
    }

    // userId can be email or id — find the user
    const email = targetEmail || userId;
    if (!email) return json(400, { error: 'userId or targetEmail required' });

    const existing = await pool.query('SELECT * FROM hc_users WHERE LOWER(email)=LOWER($1) OR id=$1', [email]);
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
    // Identity MUST come from the verified token, never from the request body.
    // A caller can only look up / touch their OWN login record.
    const ident = await verifyIdentity(event);
    if (!ident) return json(401, { error: 'Authentication required' });
    const email = String(ident.email).trim().toLowerCase();

    // The only body field we honor is the display name — and it only ever
    // writes the caller's own row. id/email in the body are ignored.
    let body = {};
    try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }
    const name = body && body.name ? String(body.name) : '';

    // Add invited column if missing
    await pool.query(`ALTER TABLE hc_users ADD COLUMN IF NOT EXISTS invited BOOLEAN DEFAULT true`);

    // Check if user exists in our DB (case-insensitive)
    const existing = await pool.query('SELECT * FROM hc_users WHERE LOWER(email)=$1 LIMIT 1', [email]);

    if (existing.rows.length === 0) {
      // Not in our system — block
      return json(200, { unauthorized: true, reason: 'not_invited' });
    }

    const u = existing.rows[0];

    if (u.suspended) return json(200, { suspended: true });
    if (u.invited === false) return json(200, { unauthorized: true, reason: 'not_invited' });

    // Update last login (keyed on the row we found, normalizing its email)
    await pool.query(
      `UPDATE hc_users SET email=$1, last_login=now(), name=COALESCE(NULLIF($2,''), name), updated_at=now() WHERE id=$3`,
      [email, name || '', u.id]
    );

    // Re-fetch the (possibly updated) name so the client reflects the
    // user's chosen display name, not whatever Identity sent.
    const after = await pool.query('SELECT name FROM hc_users WHERE id=$1', [u.id]);
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
        WHERE LOWER(email)=LOWER($1)
        RETURNING name`,
      [identityUser.email, newName]
    );
    if (!result.rows.length) return json(404, { error: 'User row not found' });

    return json(200, { name: result.rows[0].name });
  }

  // ── GET /users?action=audit ────────────────────────────────
  if (method === 'GET' && action === 'audit') {
    const _a = await authorize(event, ['admin', 'manager']);
    if (!_a.ok) return json(_a.code, _a.body);

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
