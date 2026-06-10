/* =========================================================
   overstock-holds.js — Overstock Lookup backend
   ---------------------------------------------------------
   Powers the office/external "Overstock Lookup" viewer page and shares hold
   status back to the warehouse app. Deliberately SEPARATE from the warehouse
   workflow blob (workflow_sync_state) so it can never clobber the warehouse's
   upload/audit/verify data:

     - It READS the warehouse overstock entries server-side (read-only) and
       returns ONLY overstock fields (no pallets / attendance / other data
       leaks to office users).
     - Holds + comments live in their own tables (overstock_holds,
       overstock_comments), keyed by the overstock entry id.

   Endpoints (all require a valid signed-in user):
     GET                    -> { items:[...], updatedAt }   (viewer table)
     GET ?item=<id>         -> { hold, comments:[...] }      (detail modal)
     GET ?holdsOnly=1       -> { holds:{ [id]:{...} } }       (warehouse badges)
     POST {action:'setHold', itemId, status, reason}
     POST {action:'comment', itemId, text}
   ========================================================= */

const { Pool } = require('pg');
const { verifyUser } = require('./_auth');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : undefined,
});

const HOLD_STATUSES = ['Available', 'On Hold', 'Do Not Donate', 'Released'];

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

let schemaReady = false;
async function ensureSchema() {
  if (schemaReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS overstock_holds (
      item_id     TEXT PRIMARY KEY,
      hold_status TEXT NOT NULL DEFAULT 'Available',
      hold_reason TEXT,
      hold_by     TEXT,
      hold_at     TIMESTAMPTZ,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS overstock_comments (
      id           BIGSERIAL PRIMARY KEY,
      item_id      TEXT NOT NULL,
      comment_text TEXT NOT NULL,
      commented_by TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS overstock_comments_item_idx ON overstock_comments(item_id);`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS overstock_cost_ref (
      po_key          TEXT PRIMARY KEY,
      po_name         TEXT,
      cost            NUMERIC,
      account_owner   TEXT,
      psa             TEXT,
      client_name     TEXT,
      account_product TEXT,
      po_sf_id        TEXT,
      so_sf_id        TEXT,
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  schemaReady = true;
}

// Normalize a PO so the warehouse's bare-digit POs (e.g. "257798") match the
// cost report's "PO-257798" naming.
function normPoKey(s) {
  return String(s == null ? '' : s).trim().toUpperCase().replace(/^PO[-\s]*/, '').replace(/\s+/g, '');
}

// Pull the warehouse's current overstock entries straight from the workflow
// blob — READ ONLY. We never write back to it.
async function readOverstockEntries() {
  const r = await pool.query(`SELECT data_json FROM workflow_sync_state WHERE state_key='default' LIMIT 1;`);
  const data = (r.rows[0] && r.rows[0].data_json) || {};
  const entries = Array.isArray(data.overstockEntries) ? data.overstockEntries : [];
  // Respect delete tombstones so removed POs don't show in the viewer.
  const tombs = Array.isArray(data.__deletedOverstockEntryIds) ? data.__deletedOverstockEntryIds : [];
  const dead = new Set(tombs.map(t => String(t && typeof t === 'object' ? t.id : t)));
  return entries.filter(e => e && e.id && !dead.has(String(e.id)));
}

// Project an entry down to the fields the viewer is allowed to see. Note:
// physical warehouse location/container and the associate who logged it are
// intentionally NOT exposed to office/external users.
function projectEntry(e) {
  return {
    id: String(e.id),
    po: e.po != null ? String(e.po) : '',
    category: e.category || '',
    quantity: Number(e.quantity || 0),
    status: e.status || '',
    action: e.action || '',
    date: e.date || '',
    updatedAt: Number(e.updatedAt || e.createdAt || 0),
  };
}

function callerName(caller) {
  const u = caller && caller.user;
  const meta = (u && (u.user_metadata || u.app_metadata)) || {};
  return (meta.full_name || meta.name || (caller && caller.email) || 'unknown');
}

exports.handler = async function handler(event) {
  if (!process.env.DATABASE_URL) return json(500, { error: 'DATABASE_URL is not configured' });

  // Require a valid signed-in user for everything (read included — overstock
  // data is internal business info). Any logged-in user qualifies; the page
  // itself is gated by role in the portal.
  const caller = await verifyUser(event);
  if (!caller) return json(401, { error: 'Authentication required' });

  try {
    await ensureSchema();
    const qs = event.queryStringParameters || {};

    if (event.httpMethod === 'GET') {
      // Lightweight: just the holds map (for warehouse badges).
      if (qs.holdsOnly === '1' || qs.holdsOnly === 'true') {
        const hr = await pool.query(`SELECT item_id, hold_status, hold_reason, hold_by, hold_at FROM overstock_holds WHERE hold_status <> 'Available';`);
        const holds = {};
        for (const row of hr.rows) {
          holds[row.item_id] = { status: row.hold_status, reason: row.hold_reason || '', by: row.hold_by || '', at: row.hold_at };
        }
        return json(200, { holds });
      }

      // Detail for one item: hold + full comment history.
      if (qs.item) {
        const id = String(qs.item);
        const [hr, cr] = await Promise.all([
          pool.query(`SELECT hold_status, hold_reason, hold_by, hold_at FROM overstock_holds WHERE item_id=$1;`, [id]),
          pool.query(`SELECT comment_text, commented_by, created_at FROM overstock_comments WHERE item_id=$1 ORDER BY created_at DESC LIMIT 200;`, [id]),
        ]);
        const h = hr.rows[0];
        return json(200, {
          hold: h ? { status: h.hold_status, reason: h.hold_reason || '', by: h.hold_by || '', at: h.hold_at } : { status: 'Available', reason: '', by: '', at: null },
          comments: cr.rows.map(c => ({ text: c.comment_text, by: c.commented_by || '', at: c.created_at })),
        });
      }

      // Full list for the viewer table: projected entries joined with holds +
      // comment counts + the imported cost/Salesforce reference.
      const entries = await readOverstockEntries();
      const [hr, cc, ref] = await Promise.all([
        pool.query(`SELECT item_id, hold_status, hold_reason, hold_by, hold_at FROM overstock_holds;`),
        pool.query(`SELECT item_id, COUNT(*)::int AS n FROM overstock_comments GROUP BY item_id;`),
        pool.query(`SELECT po_key, cost, account_owner, psa, client_name, account_product, po_sf_id, so_sf_id FROM overstock_cost_ref;`),
      ]);
      const holdMap = new Map(hr.rows.map(r => [r.item_id, r]));
      const countMap = new Map(cc.rows.map(r => [r.item_id, r.n]));
      const refMap = new Map(ref.rows.map(r => [r.po_key, r]));
      const items = entries.map(e => {
        const p = projectEntry(e);
        const h = holdMap.get(p.id);
        p.holdStatus = h ? h.hold_status : 'Available';
        p.holdReason = h ? (h.hold_reason || '') : '';
        p.holdBy = h ? (h.hold_by || '') : '';
        p.holdAt = h ? h.hold_at : null;
        p.commentCount = countMap.get(p.id) || 0;
        const rf = refMap.get(normPoKey(p.po));
        if (rf) {
          p.cost = rf.cost != null ? Number(rf.cost) : null;
          p.accountOwner = rf.account_owner || '';
          p.psa = rf.psa || '';
          p.clientName = rf.client_name || '';
          p.accountProduct = rf.account_product || '';
          p.poSfId = rf.po_sf_id || '';
          p.soSfId = rf.so_sf_id || '';
        }
        return p;
      });
      return json(200, { items, updatedAt: Date.now(), refCount: refMap.size });
    }

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const action = body.action;

      // Import the Salesforce cost reference (manager/admin only). Client sends
      // the parsed report in chunks; the first chunk passes replace:true to
      // clear the old reference before loading the new one.
      if (action === 'importCostRef') {
        if (!['admin', 'manager'].includes(caller.role)) return json(403, { error: 'Manager/admin only' });
        const rows = Array.isArray(body.rows) ? body.rows : [];
        if (body.replace) await pool.query('DELETE FROM overstock_cost_ref;');
        const keys = [], names = [], costs = [], owners = [], psas = [], clients = [], products = [], poids = [], soids = [];
        for (const r of rows) {
          const key = normPoKey(r.po);
          if (!key) continue;
          keys.push(key);
          names.push(String(r.po || '').trim());
          const c = (r.cost === '' || r.cost == null) ? null : Number(r.cost);
          costs.push(Number.isFinite(c) ? c : null);
          owners.push(String(r.accountOwner || ''));
          psas.push(String(r.psa || ''));
          clients.push(String(r.clientName || ''));
          products.push(String(r.accountProduct || ''));
          poids.push(String(r.poSfId || ''));
          soids.push(String(r.soSfId || ''));
        }
        if (keys.length) {
          await pool.query(
            `INSERT INTO overstock_cost_ref (po_key, po_name, cost, account_owner, psa, client_name, account_product, po_sf_id, so_sf_id)
             SELECT * FROM unnest($1::text[],$2::text[],$3::numeric[],$4::text[],$5::text[],$6::text[],$7::text[],$8::text[],$9::text[])
             ON CONFLICT (po_key) DO UPDATE SET
               po_name=EXCLUDED.po_name, cost=EXCLUDED.cost, account_owner=EXCLUDED.account_owner,
               psa=EXCLUDED.psa, client_name=EXCLUDED.client_name, account_product=EXCLUDED.account_product,
               po_sf_id=EXCLUDED.po_sf_id, so_sf_id=EXCLUDED.so_sf_id, updated_at=NOW();`,
            [keys, names, costs, owners, psas, clients, products, poids, soids]
          );
        }
        return json(200, { ok: true, inserted: keys.length });
      }

      const itemId = body.itemId != null ? String(body.itemId).trim() : '';
      if (!itemId) return json(400, { error: 'itemId required' });

      if (action === 'setHold') {
        let status = String(body.status || '').trim();
        if (!HOLD_STATUSES.includes(status)) return json(400, { error: 'invalid status' });
        const reason = String(body.reason || '').slice(0, 1000);
        const who = callerName(caller);
        // "Available" / "Released" clear the active hold attribution timestamp
        // only for Available; Released keeps who/when for the record.
        const active = (status === 'On Hold' || status === 'Do Not Donate');
        await pool.query(
          `INSERT INTO overstock_holds (item_id, hold_status, hold_reason, hold_by, hold_at, updated_at)
           VALUES ($1,$2,$3,$4, ${active ? 'NOW()' : 'NULL'}, NOW())
           ON CONFLICT (item_id) DO UPDATE
             SET hold_status=EXCLUDED.hold_status,
                 hold_reason=EXCLUDED.hold_reason,
                 hold_by=EXCLUDED.hold_by,
                 hold_at=${active ? 'NOW()' : 'overstock_holds.hold_at'},
                 updated_at=NOW();`,
          [itemId, status, reason, who]
        );
        return json(200, { ok: true, hold: { status, reason, by: who, at: active ? new Date().toISOString() : null } });
      }

      if (action === 'comment') {
        const text = String(body.text || '').trim().slice(0, 2000);
        if (!text) return json(400, { error: 'comment text required' });
        const who = callerName(caller);
        const r = await pool.query(
          `INSERT INTO overstock_comments (item_id, comment_text, commented_by) VALUES ($1,$2,$3) RETURNING created_at;`,
          [itemId, text, who]
        );
        return json(200, { ok: true, comment: { text, by: who, at: r.rows[0].created_at } });
      }

      return json(400, { error: 'unknown action' });
    }

    return json(405, { error: 'method not allowed' });
  } catch (e) {
    console.error('overstock-holds error:', e.message);
    return json(500, { error: e.message });
  }
};
