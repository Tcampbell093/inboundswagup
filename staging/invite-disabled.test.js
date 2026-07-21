/* =========================================================================
   invite-disabled.test.js — proves the APP_INVITES_ENABLED=false kill-switch.

   When APP_INVITES_ENABLED=false, POST users?action=invite (as a valid admin)
   must return a clear 403 and perform:
     - NO database mutation (no INSERT/UPDATE/ALTER/DELETE),
     - NO Resend email (no call to api.resend.com),
     - NO Netlify Identity user creation (no call to .../admin/users).

   Self-contained: stubs 'pg' and global.fetch via Module._load — no deps, no
   network, no database. Run: node staging/invite-disabled.test.js
   ========================================================================= */

const Module = require('module');
const path = require('path');

// ---- record every SQL statement; never actually mutate anything ----
const queries = [];
const fakePg = {
  Pool: class {
    async query(sql) {
      queries.push(String(sql));
      // authorize()/verifyUser reads an hc_users row — return a valid admin so
      // the caller passes the ['admin'] check and reaches the invite guard.
      if (/SELECT/i.test(sql) && /FROM\s+hc_users/i.test(sql)) {
        return { rows: [{ role: 'admin', suspended: false, invited: true, temp_admin: false, temp_admin_expiry: null }] };
      }
      return { rows: [] };
    }
  },
};

const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'pg') return fakePg;
  return origLoad.apply(this, arguments);
};

// ---- record every outbound fetch ----
const fetchCalls = [];
global.fetch = async (url) => {
  const u = String(url);
  fetchCalls.push(u);
  if (/\/\.netlify\/identity\/user$/.test(u)) {
    // Identity token verification for authorize() -> valid admin identity
    return { ok: true, json: async () => ({ email: 'admin@example.com', id: 'admin@example.com' }) };
  }
  return { ok: true, status: 200, text: async () => '', json: async () => ({}) };
};

process.env.DATABASE_URL = 'postgres://stub';
process.env.APP_INVITES_ENABLED = 'false';

const { handler } = require(path.resolve(__dirname, '../netlify/functions/users.js'));

(async () => {
  const event = {
    httpMethod: 'POST',
    queryStringParameters: { action: 'invite' },
    headers: { authorization: 'Bearer testtoken' },
    body: JSON.stringify({ email: 'newhire@example.com', role: 'l1' }),
  };
  const context = { clientContext: { identity: { url: 'https://x/.netlify/identity', token: 't' } } };

  const res = await handler(event, context);

  const mutating       = queries.filter((q) => /\b(INSERT|UPDATE|ALTER|DELETE|TRUNCATE)\b/i.test(q));
  const resendCalls    = fetchCalls.filter((u) => /api\.resend\.com/.test(u));
  const identityCreate = fetchCalls.filter((u) => /\/admin\/users/.test(u));

  let fail = 0;
  const chk = (name, cond) => { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name); if (!cond) fail++; };

  chk('invite route returns 403 (disabled)', res && res.statusCode === 403 && /disabled/i.test(res.body || ''));
  chk('NO database mutation performed', mutating.length === 0);
  chk('NO Resend email sent', resendCalls.length === 0);
  chk('NO Netlify Identity user created', identityCreate.length === 0);

  console.log('\nSQL seen:    ' + JSON.stringify(queries));
  console.log('fetch calls: ' + JSON.stringify(fetchCalls));
  console.log('\n' + (fail === 0 ? 'ALL PASS' : fail + ' FAILED'));
  if (fail) process.exit(1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
