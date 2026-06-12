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
  await pool.query(`CREATE INDEX IF NOT EXISTS inventory_items_active_idx ON inventory_items(archived);`);
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
const matchKey = (name, sku) => norm(name) + '|' + norm(sku);
const numOrNull = (v) => {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
};

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

      const includeArchived = qs.includeArchived === '1' || qs.includeArchived === 'true';
      const r = await pool.query(
        `SELECT * FROM inventory_items ${includeArchived ? '' : 'WHERE archived=false'} ORDER BY item_name ASC;`
      );
      const items = r.rows.map(rowToItem);
      // Which items have a photo (+ a version stamp for cache-busting the <img>).
      const ph = await pool.query(`SELECT item_id, EXTRACT(EPOCH FROM taken_at)*1000 AS ver FROM inventory_photos;`);
      const photoMap = new Map(ph.rows.map(r => [String(r.item_id), Math.round(Number(r.ver))]));
      items.forEach(i => { i.photoVer = photoMap.get(String(i.id)) || null; });
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
      return json(200, { ok: true, item: rowToItem(r.rows[0]) });
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

    // ── import (add new, update matches) ─────────────────────────────────
    if (action === 'import') {
      if (!canManage) return json(403, { error: 'Manager/admin only' });
      const rows = Array.isArray(body.rows) ? body.rows : [];
      const existing = await pool.query(`SELECT id, item_name, location, sku FROM inventory_items WHERE archived=false;`);
      const byKey = new Map(existing.rows.map(r => [matchKey(r.item_name, r.sku), r.id]));
      let added = 0, updated = 0;
      const w = who(caller);
      for (const row of rows) {
        const name = String(row.itemName || '').trim();
        if (!name) continue;
        const key = matchKey(name, row.sku);
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
      return json(200, { ok: true, request: reqToObj(r.rows[0]) });
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
