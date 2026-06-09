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

  const p = pool();
  if (p) {
    try {
      const r = await p.query(
        'SELECT role, suspended FROM hc_users WHERE LOWER(email)=LOWER($1)',
        [user.email]
      );
      if (r.rows.length) {
        if (r.rows[0].role) role = r.rows[0].role;
        suspended = !!r.rows[0].suspended;
      }
    } catch (e) {
      // DB unavailable — accept a validly-signed Identity token rather than
      // hard-failing every request. Falls back to Identity-provided role.
      console.warn('_auth: hc_users lookup failed, accepting valid token:', e.message);
    }
  }

  if (suspended) return null;
  return { user, email: user.email, role, token };
}

// Require a valid user AND (optionally) one of the allowed roles.
async function requireRole(event, allowedRoles) {
  const caller = await verifyUser(event);
  if (!caller) return null;
  if (allowedRoles && allowedRoles.length && !allowedRoles.includes(caller.role)) return null;
  return caller;
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

module.exports = { verifyUser, requireRole, bearer, authEnforced, guard };
