/* =========================================================
   inventory.js — Warehouse Supply Inventory API
   ---------------------------------------------------------
   A clean, dedicated table + REST-ish API for the Inventory module (not a
   JSON blob). Built modular so count-history, barcodes, reorder approvals,
   and photos can be added later without reworking this.

   Auth (via _auth.js): every call needs a valid signed-in user.
     - manage  (admin/manager): add, edit, archive, import, delete, export
     - count   (admin/manager/l1/l2 "leads"): update counts, notes, location, review
     - view    (any signed-in user with page access)

   GET   ?includeArchived=1            -> { items:[...], summary:{...} }
   POST  { action:'add', item, force }
   POST  { action:'update', id, fields }
   POST  { action:'count', id, mode:'set'|'add'|'remove', amount, note }
   POST  { action:'review', id }
   POST  { action:'archive'|'unarchive', id }
   POST  { action:'import', rows:[...] }
   POST  { action:'delete', id }       (admin only)
   ========================================================= */

const { Pool } = require('pg');
const { verifyUser } = require('./_auth');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : undefined,
});

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) };
}

let schemaReady = false;
async function ensureSchema() {
  if (schemaReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS inventory_items (
      id              BIGSERIAL PRIMARY KEY,
      item_name       TEXT NOT NULL,
      category        TEXT,
      department      TEXT,
      location        TEXT,
      spot            TEXT,
      quantity        NUMERIC,
      unit_type       TEXT,
      min_stock       NUMERIC DEFAULT 0,
      vendor          TEXT,
      sku             TEXT,
      order_link      TEXT,
      notes           TEXT,
      needs_review    BOOLEAN NOT NULL DEFAULT false,
      archived        BOOLEAN NOT NULL DEFAULT false,
      last_counted    TIMESTAMPTZ,
      last_updated_by TEXT,
      created_by      TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS order_link TEXT;`);
  await pool.query(`ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS spot TEXT;`);
  // product_key links rows that are the SAME physical product stocked in
  // different departments, so we can show a warehouse-wide total while each
  // department keeps its own exclusive count. NULL = a standalone item.
  await pool.query(`ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS product_key TEXT;`);
  await pool.query(`CREATE INDEX IF NOT EXISTS inventory_items_active_idx ON inventory_items(archived);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS inventory_items_product_key_idx ON inventory_items(product_key);`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS inventory_requests (
      id            BIGSERIAL PRIMARY KEY,
      item_id       BIGINT,
      item_name     TEXT NOT NULL,
      category      TEXT,
      department    TEXT,
      quantity      NUMERIC,
      urgency       TEXT NOT NULL DEFAULT 'Normal',
      reason        TEXT,
      status        TEXT NOT NULL DEFAULT 'Requested',
      requested_by  TEXT,
      assigned_to   TEXT,
      expected_date DATE,
      tracking      TEXT,
      order_link    TEXT,
      notes         TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS inventory_requests_status_idx ON inventory_requests(status);`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS inventory_photos (
      item_id    BIGINT PRIMARY KEY,
      photo_data TEXT NOT NULL,
      taken_by   TEXT,
      taken_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  // Who gets emailed when a new request comes in (the office manager, etc.).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS inventory_subscriptions (
      id                BIGSERIAL PRIMARY KEY,
      email             TEXT NOT NULL,
      label             TEXT,
      enabled           BOOLEAN NOT NULL DEFAULT true,
      unsubscribe_token TEXT,
      created_by        TEXT,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS inventory_subs_email_idx ON inventory_subscriptions(LOWER(email));`);
  // Per-request send log (so we never email the same person twice for one request).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS inventory_request_emails (
      id         BIGSERIAL PRIMARY KEY,
      request_id BIGINT NOT NULL,
      email      TEXT NOT NULL,
      status     TEXT,
      error      TEXT,
      sent_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (request_id, email)
    );
  `);
  // Seed the office manager the first time, so notifications work out of the box.
  const subCount = await pool.query(`SELECT COUNT(*)::int AS n FROM inventory_subscriptions;`);
  if (subCount.rows[0].n === 0) {
    await pool.query(
      `INSERT INTO inventory_subscriptions (email, label, unsubscribe_token, created_by)
       VALUES ($1, $2, MD5(RANDOM()::text || CLOCK_TIMESTAMP()::text), 'system')
       ON CONFLICT DO NOTHING;`,
      ['smadison@bdainc.com', 'Office Manager']
    );
  }
  schemaReady = true;
}

const REQ_OPEN = ['Requested', 'Reviewing', 'Approved', 'Ordered', 'Shipped'];
const REQ_TRANSIT = ['Ordered', 'Shipped'];
const REQ_STATUSES = ['Requested', 'Reviewing', 'Approved', 'Ordered', 'Shipped', 'Delivered', 'Denied', 'Canceled'];
const URGENCIES = ['Low', 'Normal', 'High', 'Urgent'];

function who(caller) {
  const u = caller && caller.user;
  const meta = (u && (u.user_metadata || u.app_metadata)) || {};
  return (meta.full_name || meta.name || (caller && caller.email) || 'unknown');
}

function computeStatus(q, min, needsReview) {
  if (needsReview) return 'Needs Review';
  if (q == null || q === '') return 'Needs Review';
  const n = Number(q);
  if (!Number.isFinite(n)) return 'Needs Review';
  if (n <= 0) return 'Out of Stock';
  if (n <= Number(min || 0)) return 'Low Stock';
  return 'In Stock';
}

function rowToItem(r) {
  const quantity = r.quantity == null ? null : Number(r.quantity);
  return {
    id: r.id,
    itemName: r.item_name || '',
    category: r.category || '',
    department: r.department || '',
    location: r.location || '',
    spot: r.spot || '',
    quantity: quantity,
    unitType: r.unit_type || '',
    minStock: r.min_stock == null ? 0 : Number(r.min_stock),
    vendor: r.vendor || '',
    sku: r.sku || '',
    orderLink: r.order_link || '',
    notes: r.notes || '',
    productKey: r.product_key || '',
    needsReview: !!r.needs_review,
    archived: !!r.archived,
    status: computeStatus(quantity, r.min_stock, r.needs_review),
    lastCounted: r.last_counted,
    lastUpdatedBy: r.last_updated_by || '',
    createdBy: r.created_by || '',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function reqToObj(r) {
  return {
    id: r.id, itemId: r.item_id, itemName: r.item_name || '', category: r.category || '',
    department: r.department || '', quantity: r.quantity == null ? null : Number(r.quantity),
    urgency: r.urgency || 'Normal', reason: r.reason || '', status: r.status || 'Requested',
    requestedBy: r.requested_by || '', assignedTo: r.assigned_to || '',
    expectedDate: r.expected_date, tracking: r.tracking || '', orderLink: r.order_link || '',
    notes: r.notes || '', createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

const norm = (s) => String(s == null ? '' : s).trim().toLowerCase();
// Include department so the same item name in two departments imports as two
// separate, exclusive rows (link them later for a warehouse total).
const matchKey = (name, sku, dept) => norm(name) + '|' + norm(sku) + '|' + norm(dept);
const numOrNull = (v) => {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
};

// ── Email notifications ────────────────────────────────────────────────────
// Two possible channels, picked automatically:
//   1. Gmail (preferred) — set GMAIL_USER + GMAIL_APP_PASSWORD (a 16-char Google
//      App Password). Sends through Gmail's SMTP; delivers to anyone, no domain
//      verification needed. From shows as "Houston Control <that gmail>".
//   2. Resend (fallback) — RESEND_API_KEY. With the default onboarding@resend.dev
//      sender it only reaches the Resend account owner unless a domain is verified
//      and INVENTORY_NOTIFY_FROM is set.
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const NOTIFY_FROM = process.env.INVENTORY_NOTIFY_FROM || process.env.FROM_EMAIL || 'Houston Control <onboarding@resend.dev>';
const GMAIL_USER = (process.env.GMAIL_USER || '').trim();
// App passwords are often shown with spaces ("abcd efgh ijkl mnop") — strip them.
const GMAIL_APP_PASSWORD = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
const GMAIL_FROM = process.env.GMAIL_FROM || (GMAIL_USER ? `Houston Control <${GMAIL_USER}>` : '');
const SITE_URL = (process.env.SITE_URL || 'https://inboundswagup.netlify.app').replace(/\/+$/, '');

function gmailConfigured() { return !!(GMAIL_USER && GMAIL_APP_PASSWORD); }
function emailChannel() { return gmailConfigured() ? 'gmail' : (RESEND_API_KEY ? 'resend' : 'none'); }
function effectiveFrom() { return gmailConfigured() ? GMAIL_FROM : NOTIFY_FROM; }

let _mailer = null;
function getMailer() {
  if (_mailer) return _mailer;
  const nodemailer = require('nodemailer');
  _mailer = nodemailer.createTransport({ service: 'gmail', auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD } });
  return _mailer;
}

function htmlEscape(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function sendEmail(to, subject, html) {
  // 1) Gmail SMTP when configured.
  if (gmailConfigured()) {
    try {
      await getMailer().sendMail({ from: GMAIL_FROM, to, subject, html });
      return { ok: true, channel: 'gmail' };
    } catch (e) {
      console.error('inventory Gmail send error:', e.message);
      return { ok: false, channel: 'gmail', error: e.message };
    }
  }
  // 2) Resend fallback.
  if (!RESEND_API_KEY) { console.warn('inventory: no email channel configured — skipping email to', to); return { ok: false, channel: 'none', error: 'no api key' }; }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: NOTIFY_FROM, to, subject, html }),
    });
    if (!res.ok) { const err = await res.text(); console.error('inventory Resend error:', res.status, err); return { ok: false, channel: 'resend', error: `${res.status} ${err}`.slice(0, 480) }; }
    return { ok: true, channel: 'resend' };
  } catch (e) { console.error('inventory email exception:', e.message); return { ok: false, channel: 'resend', error: e.message }; }
}

// Translate a send failure into a plain-English cause + fix, per channel.
function interpretSendError(result) {
  const ch = result && result.channel;
  const e = String((result && result.error) || '').toLowerCase();
  if (ch === 'gmail') {
    if (e.includes('invalid login') || e.includes('username and password not accepted') || e.includes('eauth') || e.includes('badcredentials') || e.includes('535')) {
      return 'Gmail rejected the login. Make sure GMAIL_USER is the full address and GMAIL_APP_PASSWORD is a 16-character Google App Password (not the normal password), with 2-Step Verification turned on for that account.';
    }
    if (e.includes('etimedout') || e.includes('econn') || e.includes('timeout')) return 'Could not reach Gmail’s mail server — try again in a moment.';
    if (e.includes('limit') || e.includes('rate')) return 'Gmail send limit reached for now — try again later.';
    return 'Gmail error: ' + ((result && result.error) || 'unknown');
  }
  // Resend / none
  const err = (result && result.error) || '';
  const re = String(err).toLowerCase();
  if (!err || re.includes('no api key')) return 'No email channel is configured. Add GMAIL_USER + GMAIL_APP_PASSWORD in Netlify (recommended), then redeploy.';
  if (re.includes('401') || re.includes('unauthorized') || re.includes('invalid api key') || re.includes('restricted')) return 'The Resend API key is missing or invalid. Check the RESEND_API_KEY value in Netlify.';
  if (re.includes('403') || re.includes('testing emails') || re.includes('your own email') || re.includes('only send')) return 'Resend is in test mode: onboarding@resend.dev only delivers to the Resend account owner. Use Gmail (GMAIL_USER/GMAIL_APP_PASSWORD) instead, or verify a domain in Resend.';
  if (re.includes('422') || re.includes('not verified') || re.includes('domain')) return 'Resend rejected the "from" address because its domain is not verified.';
  if (re.includes('429') || re.includes('rate')) return 'Resend rate limit reached — wait a moment and try again.';
  return 'Email error: ' + err;
}

// Build the email body for a new request.
function buildRequestEmail(req, token) {
  const urgent = req.urgency === 'High' || req.urgency === 'Urgent';
  const qty = (req.quantity == null || req.quantity === '') ? '—' : req.quantity;
  const rows = [
    ['Item', req.itemName],
    ['Quantity', qty],
    ['Urgency', req.urgency || 'Normal'],
    ['Department', req.department || '—'],
    ['Category', req.category || '—'],
    ['Reason', req.reason || '—'],
    ['Requested by', req.requestedBy || 'unknown'],
  ].map(([k, v]) =>
    `<tr><td style="padding:6px 12px;color:#5a6b7d;font-size:13px;white-space:nowrap;vertical-align:top">${htmlEscape(k)}</td>` +
    `<td style="padding:6px 12px;color:#16263a;font-size:14px;font-weight:600">${htmlEscape(v)}</td></tr>`
  ).join('');
  const orderBtn = req.orderLink
    ? `<a href="${htmlEscape(req.orderLink)}" style="display:inline-block;margin:4px 8px 4px 0;padding:9px 16px;background:#0b5cab;color:#fff;border-radius:6px;text-decoration:none;font-size:14px;font-weight:600">Open order link</a>`
    : '';
  const appBtn = `<a href="${htmlEscape(SITE_URL)}/#inventoryPage" style="display:inline-block;margin:4px 8px 4px 0;padding:9px 16px;background:#11324f;color:#fff;border-radius:6px;text-decoration:none;font-size:14px;font-weight:600">View in Command Tool</a>`;
  const unsub = token
    ? `<p style="margin:18px 0 0;font-size:11px;color:#9aa7b4">You're receiving this because you subscribed to inventory request alerts. <a href="${htmlEscape(SITE_URL)}/.netlify/functions/inventory?unsub=${encodeURIComponent(token)}" style="color:#9aa7b4">Unsubscribe</a>.</p>`
    : '';
  const subject = `${urgent ? '🔴 ' : ''}New supply request: ${req.itemName}${qty !== '—' ? ` (×${qty})` : ''}`;
  const html =
    `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:540px;margin:0 auto;padding:8px">` +
      `<div style="background:#11324f;border-radius:10px 10px 0 0;padding:16px 20px"><div style="color:#fff;font-size:17px;font-weight:700">New inventory request</div>` +
      `<div style="color:#9fc3e8;font-size:13px;margin-top:2px">Houston Control · ${urgent ? `<span style="color:#ffb3b3;font-weight:700">${htmlEscape(req.urgency)} priority</span>` : 'a new supply request was submitted'}</div></div>` +
      `<div style="border:1px solid #e3e8ee;border-top:none;border-radius:0 0 10px 10px;padding:16px 8px"><table style="width:100%;border-collapse:collapse">${rows}</table>` +
      `<div style="padding:12px 12px 4px">${orderBtn}${appBtn}</div>${unsub}</div></div>`;
  return { subject, html };
}

// Email every enabled subscriber about a newly created request. Best-effort:
// never throws (request creation must succeed regardless). Each subscriber also
// gets an in-app notification as a fallback for when email delivery isn't set up.
// Every step is isolated so one subscriber's (or the log table's) failure can
// never stop the others from being emailed.
async function notifyNewRequest(req) {
  let subs;
  try {
    // Email EVERY enabled subscriber about the new request — including the
    // person who submitted it, if they are subscribed. (Previously the
    // requester was excluded from their own request's email.)
    subs = (await pool.query(`SELECT email, unsubscribe_token FROM inventory_subscriptions WHERE enabled=true;`)).rows;
    for (const s of subs) {
      const email = String(s.email || '').trim();
      if (!email) continue;
      try {
        // In-app notification fallback (always, even if email fails / isn't set up).
        try {
          await pool.query(
            `INSERT INTO hc_notifications (type, target_email, message) VALUES ('inventory_request', $1, $2);`,
            [email, `New supply request: ${req.itemName}${req.quantity ? ` (×${req.quantity})` : ''} — ${req.urgency || 'Normal'} priority, by ${req.requestedBy || 'unknown'}`]
          );
        } catch (e) { /* hc_notifications may not exist in some envs — ignore */ }

        // Send first — delivery must not depend on the tracking/log table.
        const { subject, html } = buildRequestEmail(req, s.unsubscribe_token);
        const result = await sendEmail(email, subject, html);

        // Log the outcome (best-effort — a logging failure must not hide a send).
        try {
          await pool.query(
            `INSERT INTO inventory_request_emails (request_id, email, status, error) VALUES ($1,$2,$3,$4);`,
            [req.id, email, result.ok ? 'sent' : 'failed', result.ok ? null : (result.error || 'unknown').slice(0, 480)]
          );
        } catch (e) { console.warn('inventory: request-email log write failed:', e.message); }
      } catch (e) {
        console.error('inventory notify subscriber error', email, e.message);
      }
    }
  } catch (e) { console.error('inventory notifyNewRequest error:', e.message); }
}

exports.handler = async function handler(event) {
  if (!process.env.DATABASE_URL) return json(500, { error: 'DATABASE_URL is not configured' });
  const qs = event.queryStringParameters || {};

  // Public thumbnail image endpoint (no auth) so a plain <img src> can lazy-load
  // it. Supply photos aren't sensitive; writes (below) still require a login.
  if (event.httpMethod === 'GET' && qs.photo && (qs.img === '1' || qs.img === 'true')) {
    try {
      await ensureSchema();
      const r = await pool.query('SELECT photo_data FROM inventory_photos WHERE item_id=$1;', [qs.photo]);
      if (!r.rows.length) return { statusCode: 404, body: 'not found' };
      const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/.exec(r.rows[0].photo_data || '');
      if (!m) return { statusCode: 415, body: 'bad image' };
      return { statusCode: 200, headers: { 'Content-Type': m[1], 'Cache-Control': 'public, max-age=300' }, body: m[2], isBase64Encoded: true };
    } catch (e) { return { statusCode: 500, body: e.message }; }
  }

  // Public one-click unsubscribe (from the email footer link, no login needed).
  if (event.httpMethod === 'GET' && qs.unsub) {
    const page = (msg) => ({ statusCode: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
      body: `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:460px;margin:60px auto;padding:24px;text-align:center;color:#16263a"><h2 style="margin:0 0 8px">Houston Control</h2><p style="font-size:15px;color:#445">${msg}</p></div>` });
    try {
      await ensureSchema();
      const r = await pool.query(`UPDATE inventory_subscriptions SET enabled=false WHERE unsubscribe_token=$1 RETURNING email;`, [String(qs.unsub)]);
      if (!r.rows.length) return page('That unsubscribe link is no longer valid. You may already be unsubscribed.');
      return page(`You've been unsubscribed. <b>${r.rows[0].email.replace(/[<>&]/g, '')}</b> will no longer receive inventory request emails.`);
    } catch (e) { return page('Sorry — something went wrong. Please contact your administrator.'); }
  }

  const caller = await verifyUser(event);
  if (!caller) return json(401, { error: 'Authentication required' });
  const role = caller.role;
  const canManage = role === 'admin' || role === 'manager';
  const canCount = canManage || role === 'l1' || role === 'l2';

  try {
    await ensureSchema();

    if (event.httpMethod === 'GET') {

      // Requests list (for the Inventory Requests view).
      if (qs.requests === '1' || qs.requests === 'true') {
        const rr = await pool.query(`SELECT * FROM inventory_requests ORDER BY created_at DESC LIMIT 1000;`);
        return json(200, { requests: rr.rows.map(reqToObj), role });
      }

      // Notification subscribers list (manager/admin only).
      if (qs.subscriptions === '1' || qs.subscriptions === 'true') {
        if (!canManage) return json(403, { error: 'Manager/admin only' });
        const sr = await pool.query(`SELECT id, email, label, enabled, created_by, created_at FROM inventory_subscriptions ORDER BY LOWER(email) ASC;`);
        const subs = sr.rows.map(s => ({ id: s.id, email: s.email, label: s.label || '', enabled: !!s.enabled, createdBy: s.created_by || '', createdAt: s.created_at }));
        return json(200, { subscriptions: subs, emailConfigured: emailChannel() !== 'none', channel: emailChannel(), role });
      }

      // Recent request-email send attempts — the audit trail behind the
      // notification emails, so an admin can see exactly who was emailed and
      // whether each send succeeded or failed (and why).
      if (qs.emailLog === '1' || qs.emailLog === 'true') {
        if (!canManage) return json(403, { error: 'Manager/admin only' });
        const lr = await pool.query(
          `SELECT e.email, e.status, e.error, e.sent_at, r.item_name
             FROM inventory_request_emails e
             LEFT JOIN inventory_requests r ON r.id = e.request_id
            ORDER BY e.sent_at DESC LIMIT 25;`
        );
        const entries = lr.rows.map(x => ({
          email: x.email, status: x.status || '', error: x.error || '',
          item: x.item_name || '', sentAt: x.sent_at,
        }));
        return json(200, { entries, channel: emailChannel(), role });
      }

      const includeArchived = qs.includeArchived === '1' || qs.includeArchived === 'true';
      const r = await pool.query(
        `SELECT * FROM inventory_items ${includeArchived ? '' : 'WHERE archived=false'} ORDER BY item_name ASC;`
      );
      const items = r.rows.map(rowToItem);
      // Which items have a photo (+ a version stamp for cache-busting the <img>).
      const ph = await pool.query(`SELECT item_id, EXTRACT(EPOCH FROM taken_at)*1000 AS ver FROM inventory_photos;`);
      const photoMap = new Map(ph.rows.map(r => [String(r.item_id), Math.round(Number(r.ver))]));
      items.forEach(i => { i.photoVer = photoMap.get(String(i.id)) || null; });

      // Warehouse roll-up: items sharing a product_key are the same product in
      // different departments. Total across the (non-archived) group, while each
      // row keeps its own department count. Standalone items get groupCount=1.
      const groups = new Map();
      items.forEach(i => {
        if (i.archived || !i.productKey) return;
        let g = groups.get(i.productKey);
        if (!g) { g = { total: 0, count: 0, breakdown: [] }; groups.set(i.productKey, g); }
        g.total += (i.quantity == null ? 0 : Number(i.quantity));
        g.count += 1;
        g.breakdown.push({ id: i.id, department: i.department || '', quantity: i.quantity, location: i.location || '' });
      });
      items.forEach(i => {
        const g = i.productKey ? groups.get(i.productKey) : null;
        if (g && g.count > 1) {
          i.groupTotal = g.total;
          i.groupCount = g.count;
          i.groupBreakdown = g.breakdown.slice().sort((a, b) => String(a.department).localeCompare(String(b.department)));
        } else {
          i.groupTotal = i.quantity == null ? null : Number(i.quantity);
          i.groupCount = 1;
          i.groupBreakdown = null;
        }
      });

      const active = items.filter(i => !i.archived);
      // Request rollups for the dashboard cards.
      const rq = await pool.query(`SELECT status, urgency FROM inventory_requests;`);
      const openReqs = rq.rows.filter(x => REQ_OPEN.includes(x.status));
      const summary = {
        total: active.length,
        low: active.filter(i => i.status === 'Low Stock').length,
        out: active.filter(i => i.status === 'Out of Stock').length,
        review: active.filter(i => i.status === 'Needs Review').length,
        lastCount: active.reduce((m, i) => (i.lastCounted && (!m || i.lastCounted > m)) ? i.lastCounted : m, null),
        openRequests: openReqs.length,
        urgentRequests: openReqs.filter(x => x.urgency === 'High' || x.urgency === 'Urgent').length,
        inTransit: rq.rows.filter(x => REQ_TRANSIT.includes(x.status)).length,
      };
      // Popularity: how many times each item was requested in the last 30 days.
      const rpm = await pool.query(`SELECT item_id, COUNT(*)::int AS n FROM inventory_requests WHERE item_id IS NOT NULL AND created_at >= NOW() - INTERVAL '30 days' GROUP BY item_id;`);
      const rpmMap = new Map(rpm.rows.map(r => [String(r.item_id), r.n]));
      items.forEach(i => { i.requestsMonth = rpmMap.get(String(i.id)) || 0; });
      return json(200, { items, summary, role });
    }

    if (event.httpMethod !== 'POST') return json(405, { error: 'method not allowed' });

    const body = JSON.parse(event.body || '{}');
    const action = body.action;

    // ── add ──────────────────────────────────────────────────────────────
    if (action === 'add') {
      if (!canManage) return json(403, { error: 'Manager/admin only' });
      const it = body.item || {};
      const name = String(it.itemName || '').trim();
      if (!name) return json(400, { error: 'Item name is required' });

      // Duplicate guard (same name + department + sku — locations can differ).
      if (!body.force) {
        const dupQ = await pool.query(
          `SELECT * FROM inventory_items WHERE archived=false
             AND LOWER(TRIM(item_name))=LOWER(TRIM($1))
             AND LOWER(TRIM(COALESCE(department,'')))=LOWER(TRIM($2))
             AND LOWER(TRIM(COALESCE(sku,'')))=LOWER(TRIM($3)) LIMIT 1;`,
          [name, it.department || '', it.sku || '']
        );
        if (dupQ.rows.length) return json(200, { duplicate: rowToItem(dupQ.rows[0]) });
      }

      const q = numOrNull(it.quantity);
      const r = await pool.query(
        `INSERT INTO inventory_items
           (item_name, category, department, location, spot, quantity, unit_type, min_stock, vendor, sku, order_link, notes,
            needs_review, last_counted, last_updated_by, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, ${q != null ? 'NOW()' : 'NULL'}, $14, $14)
         RETURNING *;`,
        [name, it.category || '', it.department || '', it.location || '', it.spot || '', q, it.unitType || '',
         numOrNull(it.minStock) || 0, it.vendor || '', it.sku || '', it.orderLink || '', it.notes || '', q == null, who(caller)]
      );
      const newItem = r.rows[0];

      // Optional: link this new department's row to an existing product (chosen
      // from the add-time suggestions), so they roll up to a warehouse total.
      if (body.linkTo) {
        const lk = await pool.query(`SELECT product_key FROM inventory_items WHERE id=$1 LIMIT 1;`, [body.linkTo]);
        if (lk.rows.length) {
          const key = lk.rows[0].product_key || ('pk_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
          await pool.query(`UPDATE inventory_items SET product_key=$1, updated_at=NOW() WHERE id = ANY($2::bigint[]);`, [key, [newItem.id, body.linkTo]]);
          newItem.product_key = key;
        }
      }
      return json(200, { ok: true, item: rowToItem(newItem) });
    }

    // ── update editable fields ───────────────────────────────────────────
    if (action === 'update') {
      if (!canManage) return json(403, { error: 'Manager/admin only' });
      const id = body.id; const f = body.fields || {};
      if (!id) return json(400, { error: 'id required' });
      const sets = [], vals = []; let i = 1;
      const map = { itemName: 'item_name', category: 'category', department: 'department', location: 'location', spot: 'spot',
        unitType: 'unit_type', minStock: 'min_stock', vendor: 'vendor', sku: 'sku', orderLink: 'order_link', notes: 'notes' };
      for (const k in map) {
        if (Object.prototype.hasOwnProperty.call(f, k)) {
          sets.push(`${map[k]}=$${i++}`);
          vals.push(k === 'minStock' ? (numOrNull(f[k]) || 0) : f[k]);
        }
      }
      // Link / unlink this row to a product group (empty string clears it).
      if (Object.prototype.hasOwnProperty.call(f, 'productKey')) {
        sets.push(`product_key=$${i++}`);
        vals.push(f.productKey ? String(f.productKey) : null);
      }
      // Quantity edited here counts as a count: set it, clear "needs review",
      // and stamp last-counted (so editing quantity behaves like Update count).
      if (Object.prototype.hasOwnProperty.call(f, 'quantity')) {
        const qv = numOrNull(f.quantity);
        sets.push(`quantity=$${i++}`); vals.push(qv);
        sets.push(`needs_review=$${i++}`); vals.push(qv == null);
        if (qv != null) sets.push(`last_counted=NOW()`);
      }
      if (!sets.length) return json(400, { error: 'no fields to update' });
      sets.push(`last_updated_by=$${i++}`); vals.push(who(caller));
      sets.push(`updated_at=NOW()`);
      vals.push(id);
      const r = await pool.query(`UPDATE inventory_items SET ${sets.join(', ')} WHERE id=$${i} RETURNING *;`, vals);
      if (!r.rows.length) return json(404, { error: 'not found' });
      return json(200, { ok: true, item: rowToItem(r.rows[0]) });
    }

    // ── count (set / add / remove) ───────────────────────────────────────
    if (action === 'count') {
      if (!canCount) return json(403, { error: 'Not permitted' });
      const id = body.id; if (!id) return json(400, { error: 'id required' });
      const cur = await pool.query(`SELECT * FROM inventory_items WHERE id=$1;`, [id]);
      if (!cur.rows.length) return json(404, { error: 'not found' });
      const existing = cur.rows[0].quantity == null ? 0 : Number(cur.rows[0].quantity);
      const amt = Number(body.amount);
      if (!Number.isFinite(amt)) return json(400, { error: 'amount must be a number' });
      let next;
      if (body.mode === 'add') next = existing + amt;
      else if (body.mode === 'remove') next = Math.max(0, existing - amt);
      else next = Math.max(0, amt); // set
      // Optional count note → prepend a dated line to notes (light history).
      let notes = cur.rows[0].notes || '';
      if (body.note && String(body.note).trim()) {
        const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
        notes = `[${stamp} ${who(caller)}] ${String(body.note).trim()}\n` + notes;
      }
      const r = await pool.query(
        `UPDATE inventory_items SET quantity=$1, needs_review=false, notes=$2, last_counted=NOW(),
           last_updated_by=$3, updated_at=NOW() WHERE id=$4 RETURNING *;`,
        [next, notes, who(caller), id]
      );
      return json(200, { ok: true, item: rowToItem(r.rows[0]) });
    }

    // ── mark reviewed ────────────────────────────────────────────────────
    if (action === 'review') {
      if (!canCount) return json(403, { error: 'Not permitted' });
      const r = await pool.query(
        `UPDATE inventory_items SET needs_review=false, last_updated_by=$1, updated_at=NOW() WHERE id=$2 RETURNING *;`,
        [who(caller), body.id]
      );
      if (!r.rows.length) return json(404, { error: 'not found' });
      return json(200, { ok: true, item: rowToItem(r.rows[0]) });
    }

    // ── archive / unarchive ──────────────────────────────────────────────
    if (action === 'archive' || action === 'unarchive') {
      if (!canManage) return json(403, { error: 'Manager/admin only' });
      const r = await pool.query(
        `UPDATE inventory_items SET archived=$1, last_updated_by=$2, updated_at=NOW() WHERE id=$3 RETURNING *;`,
        [action === 'archive', who(caller), body.id]
      );
      if (!r.rows.length) return json(404, { error: 'not found' });
      return json(200, { ok: true, item: rowToItem(r.rows[0]) });
    }

    // ── delete (admin only) ──────────────────────────────────────────────
    if (action === 'delete') {
      if (role !== 'admin') return json(403, { error: 'Admin only' });
      await pool.query(`DELETE FROM inventory_items WHERE id=$1;`, [body.id]);
      return json(200, { ok: true });
    }

    // ── link products across departments ─────────────────────────────────
    // Ties two or more item rows together as the same physical product so the
    // app can show a warehouse-wide total. Each row keeps its own count.
    if (action === 'link') {
      if (!canManage) return json(403, { error: 'Manager/admin only' });
      const ids = (Array.isArray(body.ids) ? body.ids : []).map(x => String(x)).filter(Boolean);
      if (ids.length < 2) return json(400, { error: 'Select at least two items to link' });
      // Reuse a product_key already on one of the rows, else mint a new one, so
      // linking into an existing group keeps everyone on the same key.
      const cur = await pool.query(
        `SELECT product_key FROM inventory_items WHERE id = ANY($1::bigint[]) AND product_key IS NOT NULL LIMIT 1;`, [ids]
      );
      const key = (cur.rows[0] && cur.rows[0].product_key) ||
        ('pk_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
      await pool.query(
        `UPDATE inventory_items SET product_key=$1, last_updated_by=$2, updated_at=NOW() WHERE id = ANY($3::bigint[]);`,
        [key, who(caller), ids]
      );
      return json(200, { ok: true, productKey: key });
    }

    // ── unlink a row from its product group ───────────────────────────────
    if (action === 'unlink') {
      if (!canManage) return json(403, { error: 'Manager/admin only' });
      if (!body.id) return json(400, { error: 'id required' });
      const r = await pool.query(`SELECT product_key FROM inventory_items WHERE id=$1;`, [body.id]);
      if (!r.rows.length) return json(404, { error: 'not found' });
      const key = r.rows[0].product_key;
      await pool.query(`UPDATE inventory_items SET product_key=NULL, last_updated_by=$1, updated_at=NOW() WHERE id=$2;`, [who(caller), body.id]);
      // A group of one is meaningless — if a lone row is left on that key, clear it too.
      if (key) {
        await pool.query(
          `UPDATE inventory_items SET product_key=NULL
             WHERE product_key=$1 AND (SELECT COUNT(*) FROM inventory_items WHERE product_key=$1) = 1;`,
          [key]
        );
      }
      return json(200, { ok: true });
    }

    // ── import (add new, update matches) ─────────────────────────────────
    if (action === 'import') {
      if (!canManage) return json(403, { error: 'Manager/admin only' });
      const rows = Array.isArray(body.rows) ? body.rows : [];
      const existing = await pool.query(`SELECT id, item_name, location, sku, department FROM inventory_items WHERE archived=false;`);
      const byKey = new Map(existing.rows.map(r => [matchKey(r.item_name, r.sku, r.department), r.id]));
      let added = 0, updated = 0;
      const w = who(caller);
      for (const row of rows) {
        const name = String(row.itemName || '').trim();
        if (!name) continue;
        const key = matchKey(name, row.sku, row.department);
        const q = numOrNull(row.quantity);
        const id = byKey.get(key);
        if (id) {
          await pool.query(
            `UPDATE inventory_items SET
               category=COALESCE(NULLIF($1,''),category), department=COALESCE(NULLIF($2,''),department),
               location=COALESCE(NULLIF($3,''),location), spot=COALESCE(NULLIF($4,''),spot), quantity=COALESCE($5,quantity),
               unit_type=COALESCE(NULLIF($6,''),unit_type), min_stock=COALESCE($7,min_stock),
               vendor=COALESCE(NULLIF($8,''),vendor), sku=COALESCE(NULLIF($9,''),sku),
               order_link=COALESCE(NULLIF($10,''),order_link), notes=COALESCE(NULLIF($11,''),notes),
               needs_review=CASE WHEN $5 IS NULL THEN needs_review ELSE false END,
               last_counted=CASE WHEN $5 IS NULL THEN last_counted ELSE NOW() END,
               last_updated_by=$12, updated_at=NOW()
             WHERE id=$13;`,
            [row.category || '', row.department || '', row.location || '', row.spot || '', q, row.unitType || '',
             numOrNull(row.minStock), row.vendor || '', row.sku || '', row.orderLink || '', row.notes || '', w, id]
          );
          updated++;
        } else {
          const ins = await pool.query(
            `INSERT INTO inventory_items
               (item_name, category, department, location, spot, quantity, unit_type, min_stock, vendor, sku, order_link, notes,
                needs_review, last_counted, last_updated_by, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, ${q != null ? 'NOW()' : 'NULL'}, $13,$13) RETURNING id;`,
            [name, row.category || '', row.department || '', row.location || '', row.spot || '', q, row.unitType || '',
             numOrNull(row.minStock) || 0, row.vendor || '', row.sku || '', row.orderLink || '', row.notes || '', q == null, w]
          );
          byKey.set(key, ins.rows[0].id);
          added++;
        }
      }
      return json(200, { ok: true, added, updated });
    }

    // ── request: create (any signed-in user) ─────────────────────────────
    if (action === 'requestCreate') {
      const rq = body.request || {};
      const name = String(rq.itemName || '').trim();
      if (!name) return json(400, { error: 'Item name is required' });
      let urgency = String(rq.urgency || 'Normal'); if (!URGENCIES.includes(urgency)) urgency = 'Normal';
      const r = await pool.query(
        `INSERT INTO inventory_requests
           (item_id, item_name, category, department, quantity, urgency, reason, order_link, requested_by, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'Requested') RETURNING *;`,
        [rq.itemId || null, name, rq.category || '', rq.department || '', numOrNull(rq.quantity), urgency,
         rq.reason || '', rq.orderLink || '', who(caller)]
      );
      const created = reqToObj(r.rows[0]);
      // Notify subscribers (email + in-app). Best-effort — never blocks the request.
      await notifyNewRequest(created);
      return json(200, { ok: true, request: created });
    }

    // ── request: update (manager/admin = office manager) ─────────────────
    if (action === 'requestUpdate') {
      if (!canManage) return json(403, { error: 'Manager/admin only' });
      const id = body.id; const f = body.fields || {};
      if (!id) return json(400, { error: 'id required' });
      const sets = [], vals = []; let i = 1;
      const map = { status: 'status', assignedTo: 'assigned_to', expectedDate: 'expected_date', tracking: 'tracking', notes: 'notes', urgency: 'urgency' };
      for (const k in map) {
        if (Object.prototype.hasOwnProperty.call(f, k)) {
          if (k === 'status' && !REQ_STATUSES.includes(f[k])) return json(400, { error: 'invalid status' });
          sets.push(`${map[k]}=$${i++}`);
          vals.push(k === 'expectedDate' ? (f[k] || null) : f[k]);
        }
      }
      if (!sets.length) return json(400, { error: 'no fields to update' });
      sets.push(`updated_at=NOW()`);
      vals.push(id);
      const r = await pool.query(`UPDATE inventory_requests SET ${sets.join(', ')} WHERE id=$${i} RETURNING *;`, vals);
      if (!r.rows.length) return json(404, { error: 'not found' });
      return json(200, { ok: true, request: reqToObj(r.rows[0]) });
    }

    // ── notification subscribers (manager/admin) ─────────────────────────
    if (action === 'subAdd') {
      if (!canManage) return json(403, { error: 'Manager/admin only' });
      const email = String(body.email || '').trim();
      const label = String(body.label || '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(400, { error: 'Please enter a valid email address' });
      const r = await pool.query(
        `INSERT INTO inventory_subscriptions (email, label, unsubscribe_token, created_by)
         VALUES ($1, $2, MD5(RANDOM()::text || CLOCK_TIMESTAMP()::text), $3)
         ON CONFLICT (LOWER(email)) DO UPDATE SET enabled=true, label=COALESCE(NULLIF(EXCLUDED.label,''), inventory_subscriptions.label)
         RETURNING id, email, label, enabled;`,
        [email, label, who(caller)]
      );
      const s = r.rows[0];
      return json(200, { ok: true, subscription: { id: s.id, email: s.email, label: s.label || '', enabled: !!s.enabled } });
    }
    if (action === 'subToggle') {
      if (!canManage) return json(403, { error: 'Manager/admin only' });
      if (!body.id) return json(400, { error: 'id required' });
      const r = await pool.query(`UPDATE inventory_subscriptions SET enabled=$1 WHERE id=$2 RETURNING id, enabled;`, [body.enabled !== false, body.id]);
      if (!r.rows.length) return json(404, { error: 'not found' });
      return json(200, { ok: true, id: r.rows[0].id, enabled: !!r.rows[0].enabled });
    }
    if (action === 'subRemove') {
      if (!canManage) return json(403, { error: 'Manager/admin only' });
      if (!body.id) return json(400, { error: 'id required' });
      await pool.query(`DELETE FROM inventory_subscriptions WHERE id=$1;`, [body.id]);
      return json(200, { ok: true });
    }

    // ── email diagnostic: send a one-off test + report exactly what happened ──
    if (action === 'emailTest') {
      if (!canManage) return json(403, { error: 'Manager/admin only' });
      const to = String((body.to || '').trim() || caller.email || '').toLowerCase();
      if (!to) return json(400, { error: 'No recipient address' });
      const channel = emailChannel();
      const from = effectiveFrom();
      const diag = {
        channel,
        gmailConfigured: gmailConfigured(),
        apiKeySet: !!RESEND_API_KEY,
        from: from || '—',
        usingTestSender: channel === 'resend' && /onboarding@resend\.dev/i.test(NOTIFY_FROM),
        to,
      };
      if (channel === 'none') {
        return json(200, { ok: false, diag, error: 'no channel', reason: 'No email channel is configured yet. Add GMAIL_USER and GMAIL_APP_PASSWORD in Netlify (recommended), then redeploy and try again.' });
      }
      const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:480px;margin:0 auto;padding:16px">`
        + `<h2 style="color:#11324f;margin:0 0 8px">✅ Houston Control test email</h2>`
        + `<p style="color:#374151;font-size:14px;line-height:1.6">If you can read this, email delivery is working. Sent to <b>${htmlEscape(to)}</b> from <b>${htmlEscape(from)}</b>.</p>`
        + `<p style="color:#9aa7b4;font-size:12px">One-off diagnostic from Inventory → notification settings.</p></div>`;
      const result = await sendEmail(to, 'Houston Control — test email ✅', html);
      return json(200, {
        ok: result.ok, diag, error: result.error || null,
        reason: result.ok
          ? (channel === 'gmail'
              ? 'Sent via Gmail. Check the inbox (and spam) in the next minute.'
              : diag.usingTestSender
                ? 'Resend accepted it — but the onboarding@resend.dev test sender only delivers to your Resend account owner. Switch to Gmail (GMAIL_USER/GMAIL_APP_PASSWORD) to reach everyone.'
                : 'Sent successfully. Check the inbox (and spam) in the next minute.')
          : interpretSendError(result),
      });
    }

    // ── photo: set / replace (leads + managers) ──────────────────────────
    if (action === 'setPhoto') {
      if (!canCount) return json(403, { error: 'Not permitted' });
      const id = body.itemId; const data = String(body.photoData || '');
      if (!id) return json(400, { error: 'itemId required' });
      if (!/^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(data)) return json(400, { error: 'photoData must be a base64 image data URL' });
      if (data.length > 700000) return json(413, { error: 'Image too large — please use the in-app capture (it resizes for you).' });
      await pool.query(
        `INSERT INTO inventory_photos (item_id, photo_data, taken_by, taken_at)
         VALUES ($1,$2,$3,NOW())
         ON CONFLICT (item_id) DO UPDATE SET photo_data=EXCLUDED.photo_data, taken_by=EXCLUDED.taken_by, taken_at=NOW();`,
        [id, data, who(caller)]
      );
      return json(200, { ok: true, photoVer: Date.now() });
    }

    // ── photo: remove ────────────────────────────────────────────────────
    if (action === 'removePhoto') {
      if (!canCount) return json(403, { error: 'Not permitted' });
      if (!body.itemId) return json(400, { error: 'itemId required' });
      await pool.query(`DELETE FROM inventory_photos WHERE item_id=$1;`, [body.itemId]);
      return json(200, { ok: true });
    }

    return json(400, { error: 'unknown action' });
  } catch (e) {
    console.error('inventory error:', e.message);
    return json(500, { error: e.message });
  }
};
