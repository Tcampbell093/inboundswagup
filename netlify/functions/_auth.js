/* =========================================================
   _auth.js — shared authentication helper for Netlify functions
   ---------------------------------------------------------
   verifyUser(event)  -> { user, email, role, token } for a valid, non-suspended
                         Netlify Identity caller, or null.
   requireRole(event, roles) -> same, but also checks the caller's role.

   This module is a NO-OP dependency: importing it changes nothing. A function
   only enforces auth when it actually calls verifyUser()/requireRole() and
   returns 401/403 on null. Mirrors the existing checks in users.js and
   system-reset.js, including their graceful "DB down -> accept a validly signed
   token" behavior so a database blip can't lock everyone out.
   ========================================================= */

const { Pool } = require('pg');

const IDENTITY_USER_URL =
  process.env.IDENTITY_USER_URL ||
  'https://inboundswagup.netlify.app/.netlify/identity/user';

let _pool = null;
function pool() {
  if (!_pool && process.env.DATABASE_URL) {
    _pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });
  }
  return _pool;
}

// Pull the bearer token out of the Authorization header (case-insensitive).
function bearer(event) {
  const h = (event && event.headers) || {};
  const auth = h.authorization || h.Authorization || '';
  return String(auth).replace(/^Bearer\s+/i, '').trim();
}

// Validate the Identity token and resolve the caller's role + suspended flag.
// Returns { user, email, role, token } or null.
async function verifyUser(event) {
  const token = bearer(event);
  if (!token) return null;

  let user;
  try {
    const res = await fetch(IDENTITY_USER_URL, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    user = await res.json();
  } catch (_) {
    return null;
  }
  if (!user || !user.email) return null;

  let role = (user.app_metadata && (user.app_metadata.role
      || (user.app_metadata.roles && user.app_metadata.roles[0]))) || 'l1';
  let suspended = false;
  let tempAdmin = false;
  let tempAdminExpiry = null;

  const p = pool();
  if (p) {
    try {
      const r = await p.query(
        'SELECT role, suspended, temp_admin, temp_admin_expiry FROM hc_users WHERE LOWER(email)=LOWER($1)',
        [user.email]
      );
      if (r.rows.length) {
        if (r.rows[0].role) role = r.rows[0].role;
        suspended = !!r.rows[0].suspended;
        tempAdmin = !!r.rows[0].temp_admin;
        tempAdminExpiry = r.rows[0].temp_admin_expiry || null;
      }
    } catch (e) {
      // DB unavailable — accept a validly-signed Identity token rather than
      // hard-failing every request. Falls back to Identity-provided role, and
      // deliberately does NOT elevate temp-admin (fail closed on elevation).
      console.warn('_auth: hc_users lookup failed, accepting valid token:', e.message);
    }
  }

  if (suspended) return null;

  // Normalize role casing so role comparisons are stable ('Admin' -> 'admin').
  role = String(role || 'l1').trim().toLowerCase();

  // A valid, unexpired temporary-admin grant acts as administrator. A grant
  // with no expiry counts as active (mirrors temp-admin-check.js, which only
  // auto-revokes grants whose expiry is in the past). Expired grants never
  // elevate — effectiveRole falls back to the base role.
  const tempAdminActive =
    tempAdmin && (!tempAdminExpiry || new Date(tempAdminExpiry).getTime() > Date.now());
  const effectiveRole = tempAdminActive ? 'admin' : role;

  return {
    user, email: user.email, role, effectiveRole,
    tempAdmin, tempAdminExpiry, tempAdminActive, token,
  };
}

// Verify ONLY the Identity bearer token and return the raw Identity user
// ({ id, email, user, token }) or null. Unlike verifyUser it does NOT apply
// hc_users role/suspension gating — callers that must distinguish "not
// invited" from "suspended" (e.g. the login upsert) run those checks
// themselves, but still get an email/id they can trust came from the token.
async function verifyIdentity(event) {
  const token = bearer(event);
  if (!token) return null;
  try {
    const res = await fetch(IDENTITY_USER_URL, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const user = await res.json();
    if (!user || !user.email) return null;
    return { id: user.id, email: user.email, user, token };
  } catch (_) {
    return null;
  }
}

// Require a valid user AND (optionally) one of the allowed roles.
async function requireRole(event, allowedRoles) {
  const caller = await verifyUser(event);
  if (!caller) return null;
  const role = caller.effectiveRole || caller.role;
  if (allowedRoles && allowedRoles.length && !allowedRoles.includes(role)) return null;
  return caller;
}

// Always-on authorization for P0-hardened endpoints. UNLIKE guard(), this
// never consults FUNCTIONS_REQUIRE_AUTH / REQUIRE_AUTH_<NAME> — it ALWAYS
// enforces, so an endpoint that uses it can't be silently left open by a
// missing environment flag. Returns:
//   { ok:true,  caller }               -> proceed (caller always present)
//   { ok:false, code:401, body:{...} } -> no valid signed-in identity
//   { ok:false, code:403, body:{...} } -> valid identity, wrong role
// Role checks use the caller's effective role, so an active temp-admin passes
// wherever 'admin' is allowed and an expired one does not.
async function authorize(event, allowedRoles) {
  const caller = await verifyUser(event);
  if (!caller) return { ok: false, code: 401, body: { error: 'Authentication required' } };
  const role = caller.effectiveRole || caller.role;
  if (allowedRoles && allowedRoles.length && !allowedRoles.includes(role)) {
    return { ok: false, code: 403, body: { error: 'Forbidden — insufficient role' } };
  }
  return { ok: true, caller };
}

// Is auth enforcement turned on for this endpoint? Controlled by env vars so it
// can be rolled out one endpoint at a time and reverted instantly with no code
// change. Precedence: per-endpoint REQUIRE_AUTH_<NAME> wins, else the global
// FUNCTIONS_REQUIRE_AUTH, else OFF (default). Example: REQUIRE_AUTH_ATTENDANCE.
function authEnforced(name) {
  const key = 'REQUIRE_AUTH_' + String(name || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  const per = process.env[key];
  const val = (per != null && per !== '') ? per : process.env.FUNCTIONS_REQUIRE_AUTH;
  return String(val || '').toLowerCase() === 'true';
}

// One-call guard for a function handler. Returns:
//   { allow:true,  caller }            -> proceed (caller is null when not enforced)
//   { allow:false, code, body }        -> return json(code, body)
// When enforcement is OFF for this endpoint it's a near no-op (one env read),
// so wiring this into a handler changes nothing until the flag is flipped.
async function guard(event, name, allowedRoles) {
  if (!authEnforced(name)) return { allow: true, caller: null };
  const caller = await verifyUser(event);
  if (!caller) return { allow: false, code: 401, body: { error: 'Authentication required' } };
  if (allowedRoles && allowedRoles.length && !allowedRoles.includes(caller.role)) {
    return { allow: false, code: 403, body: { error: 'Forbidden — insufficient role' } };
  }
  return { allow: true, caller };
}

module.exports = { verifyUser, verifyIdentity, requireRole, authorize, bearer, authEnforced, guard };
