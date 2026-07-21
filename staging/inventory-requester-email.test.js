/* =========================================================================
   inventory-requester-email.test.js — regression test proving that a NEW
   inventory request emails EVERY enabled subscriber, INCLUDING the requester
   if they are subscribed (the old code skipped the requester's own email).

   Behavioral: drives the real netlify/functions/inventory.js handler with
   action=requestCreate, stubbing 'pg' (Module._load) and global.fetch. The
   Resend send path is the observation point — every recipient the handler
   tries to email shows up as a POST to api.resend.com. No real email, no
   database, no network, no Netlify, no production call occurs. Plus static
   source assertions that the requester-exclusion was removed.

   Run: node staging/inventory-requester-email.test.js
   ========================================================================= */

const Module = require('module');
const path = require('path');
const fs = require('fs');

// ── Subscriber fixture (what the DB "contains"). The real query filters
//    enabled=true, so the stub for that query returns only the enabled rows.
const REQUESTER = 'requester@x.com';
const ENABLED_SUBS = [
  { email: REQUESTER,      unsubscribe_token: 't-req' },   // the person submitting — subscribed
  { email: 'another@x.com', unsubscribe_token: 't-oth' },  // a different subscriber
  { email: '',              unsubscribe_token: 't-blank' },// enabled but blank email -> skipped
];
const DISABLED_SUB = 'disabled@x.com'; // enabled=false -> excluded by the query, must never be emailed

// ── Stub 'pg' ──
const queries = [];
const fakePg = {
  Pool: class {
    async query(sql) {
      queries.push(String(sql));
      const s = String(sql);
      if (/FROM\s+hc_users/i.test(s) && /SELECT/i.test(s)) {
        return { rows: [{ role: 'admin', suspended: false, invited: true, temp_admin: false, temp_admin_expiry: null }] };
      }
      if (/COUNT\(\*\)/i.test(s) && /inventory_subscriptions/i.test(s)) {
        return { rows: [{ n: 5 }] }; // non-zero -> ensureSchema won't seed
      }
      if (/FROM\s+inventory_subscriptions\s+WHERE\s+enabled=true/i.test(s)) {
        return { rows: ENABLED_SUBS.map((r) => ({ ...r })) };
      }
      if (/INSERT\s+INTO\s+inventory_requests/i.test(s)) {
        return { rows: [{ id: 'req-1', item_id: null, item_name: 'Gloves', category: '', department: '',
          quantity: 2, urgency: 'Normal', reason: '', status: 'Requested', requested_by: 'Requester',
          assigned_to: '', expected_date: null, tracking: '', order_link: '', notes: '',
          created_at: null, updated_at: null }] };
      }
      return { rows: [] }; // CREATE TABLE / INSERT notifications / INSERT email-log / etc.
    }
  },
};
const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'pg') return fakePg;
  return origLoad.apply(this, arguments);
};

// ── Stub global.fetch ──
const emailedTo = []; // recipients the handler tried to email (via Resend)
const otherFetches = [];
global.fetch = async (url, opts) => {
  const u = String(url);
  if (/\/\.netlify\/identity\/user$/.test(u)) {
    // Identity token verification -> the caller IS the requester (and subscribed).
    return { ok: true, json: async () => ({ email: REQUESTER, id: REQUESTER }) };
  }
  if (/api\.resend\.com/.test(u)) {
    let to = null;
    try { to = JSON.parse(opts.body).to; } catch (_) {}
    emailedTo.push(to);
    return { ok: true, status: 200, text: async () => '', json: async () => ({ id: 'e1' }) };
  }
  otherFetches.push(u); // anything else is unexpected
  return { ok: true, status: 200, text: async () => '', json: async () => ({}) };
};

// Email channel = Resend (so sends go through the stubbed fetch); NO Gmail
// (so nodemailer is never required — keeps this dependency-free for CI).
process.env.DATABASE_URL = 'postgres://stub';
process.env.RESEND_API_KEY = 'test-key';
delete process.env.GMAIL_USER;
delete process.env.GMAIL_APP_PASSWORD;

const { handler } = require(path.resolve(__dirname, '..', 'netlify', 'functions', 'inventory.js'));

let fail = 0;
const chk = (name, cond) => { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name); if (!cond) fail++; };

(async () => {
  const event = {
    httpMethod: 'POST',
    queryStringParameters: {},
    headers: { authorization: 'Bearer t' },
    body: JSON.stringify({ action: 'requestCreate', request: { itemName: 'Gloves', quantity: 2, urgency: 'Normal' } }),
  };
  const res = await handler(event);

  const uniq = [...new Set(emailedTo)];
  const count = (e) => emailedTo.filter((x) => x === e).length;

  chk('request creation succeeds (200)', res && res.statusCode === 200);
  chk('subscribed REQUESTER is emailed (fix)', emailedTo.includes(REQUESTER));
  chk('another subscriber is also emailed', emailedTo.includes('another@x.com'));
  chk('requester emailed exactly once', count(REQUESTER) === 1);
  chk('another emailed exactly once', count('another@x.com') === 1);
  chk('disabled subscriber is NOT emailed', !emailedTo.includes(DISABLED_SUB));
  chk('blank-email subscriber is NOT emailed', !emailedTo.includes('') && !emailedTo.includes(null));
  chk('exactly the two enabled, non-blank subscribers emailed', uniq.length === 2 && emailedTo.length === 2);
  chk('no unexpected external calls (only identity + resend)', otherFetches.length === 0);

  // ── Static source guards: the requester-exclusion is gone ──
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'netlify', 'functions', 'inventory.js'), 'utf8');
  chk('static: notifyNewRequest no longer takes a caller param', /function\s+notifyNewRequest\s*\(\s*req\s*\)/.test(src));
  chk('static: callerEmail removed', !/callerEmail/.test(src));
  chk('static: requester-exclusion comment/logic removed', !/Don't email the person who just made the request/.test(src));
  chk('static: call site passes no caller', /notifyNewRequest\(created\)/.test(src) && !/notifyNewRequest\(created,\s*caller\)/.test(src));

  console.log('\nEmailed recipients: ' + JSON.stringify(emailedTo));
  console.log(fail === 0 ? 'ALL PASS' : fail + ' FAILED');
  if (fail) process.exit(1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
