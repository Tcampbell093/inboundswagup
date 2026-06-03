
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : undefined,
});

let schemaReady = false;
function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}
const EDITOR_TTL_MS = 3 * 60 * 1000; // 3 minutes — stale editor entries auto-expire

async function ensureSchema() {
  if (schemaReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS workflow_sync_state (
      state_key TEXT PRIMARY KEY,
      data_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      masters_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      active_editors JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    ALTER TABLE workflow_sync_state ADD COLUMN IF NOT EXISTS
    active_editors JSONB NOT NULL DEFAULT '{}'::jsonb;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pallet_events (
      id TEXT PRIMARY KEY,
      pallet_id TEXT NOT NULL,
      pallet_label TEXT,
      event_type TEXT NOT NULL,
      detail TEXT,
      po_num TEXT,
      by_user TEXT,
      event_ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pallet_events_pallet ON pallet_events (pallet_id, event_ts DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pallet_events_ts ON pallet_events (event_ts DESC);`);
  await pool.query(`
    INSERT INTO workflow_sync_state (state_key, data_json, masters_json, active_editors)
    VALUES ('default', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb)
    ON CONFLICT (state_key) DO NOTHING;
  `);
  schemaReady = true;
}

async function persistPalletEvents(pallets) {
  if (!Array.isArray(pallets) || !pallets.length) return;
  // Upsert every event from every pallet — id is the natural dedup key
  for (const pallet of pallets) {
    const events = Array.isArray(pallet.events) ? pallet.events : [];
    for (const ev of events) {
      if (!ev || !ev.id) continue;
      await pool.query(
        `INSERT INTO pallet_events (id, pallet_id, pallet_label, event_type, detail, po_num, by_user, event_ts)
         VALUES ($1, $2, $3, $4, $5, $6, $7, to_timestamp($8::bigint / 1000.0))
         ON CONFLICT (id) DO NOTHING;`,
        [
          String(ev.id),
          String(pallet.id || ''),
          String(pallet.label || ''),
          String(ev.type || ''),
          String(ev.detail || ''),
          String(ev.poNum || ''),
          String(ev.by || ''),
          Number(ev.ts || Date.now()),
        ]
      );
    }
  }
}

function pruneEditors(editors) {
  // Remove entries older than TTL so stale sessions never block anyone
  const now = Date.now();
  const pruned = {};
  for (const [palletId, entry] of Object.entries(editors || {})) {
    if (entry && (now - (entry.ts || 0)) < EDITOR_TTL_MS) {
      pruned[palletId] = entry;
    }
  }
  return pruned;
}

exports.handler = async function handler(event) {
  if (!process.env.DATABASE_URL) return json(500, { error: 'DATABASE_URL is not configured' });
  try {
    await ensureSchema();

    if (event.httpMethod === 'GET') {
      const result = await pool.query(
        `SELECT data_json, masters_json, active_editors, updated_at FROM workflow_sync_state WHERE state_key='default' LIMIT 1;`
      );
      const row = result.rows[0] || { data_json: {}, masters_json: {}, active_editors: {}, updated_at: null };
      return json(200, {
        data: row.data_json || {},
        masters: row.masters_json || {},
        activeEditors: pruneEditors(row.active_editors),
        updated_at: row.updated_at,
      });
    }

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const data = body && typeof body.data === 'object' && body.data ? body.data : {};
      const masters = body && typeof body.masters === 'object' && body.masters ? body.masters : {};

      // ── OVERSTOCK MERGE (concurrent multi-tablet write protection) ──
      // The default sync behavior is full-state overwrite — whoever POSTs last
      // wins, which causes data loss when multiple tablets write concurrently.
      // For overstock specifically, we merge by entry/container ID instead:
      //
      //   - Adds (IDs present in incoming, not in server): added to server
      //   - Edits (same ID in both): newer updatedAt wins
      //   - Deletes (server-side ID not in incoming): KEPT, unless the client
      //     explicitly tombstoned it via __deletedOverstockEntryIds /
      //     __deletedOverstockContainerIds. Missing-from-POST is NOT enough
      //     to delete, because another tablet might have added it after this
      //     client's last GET.
      //
      // After applying tombstones, we clear them from the merged result so
      // they don't grow unbounded over time. Clients clear their own local
      // tombstones based on the response.
      try {
        const currentResult = await pool.query(
          `SELECT data_json FROM workflow_sync_state WHERE state_key='default' LIMIT 1;`
        );
        const serverData = currentResult.rows[0]?.data_json || {};

        // Merge overstockEntries
        const incomingEntries = Array.isArray(data.overstockEntries) ? data.overstockEntries : [];
        const serverEntries   = Array.isArray(serverData.overstockEntries) ? serverData.overstockEntries : [];
        const deletedEntryIds = new Set(
          (Array.isArray(data.__deletedOverstockEntryIds) ? data.__deletedOverstockEntryIds : [])
            .concat(Array.isArray(serverData.__deletedOverstockEntryIds) ? serverData.__deletedOverstockEntryIds : [])
            .map(String)
        );
        const entryMap = new Map();
        // Start with server entries
        for (const e of serverEntries) {
          if (e && e.id && !deletedEntryIds.has(String(e.id))) entryMap.set(String(e.id), e);
        }
        // Merge incoming
        for (const e of incomingEntries) {
          if (!e || !e.id) continue;
          const id = String(e.id);
          if (deletedEntryIds.has(id)) continue; // explicit delete wins
          const existing = entryMap.get(id);
          if (!existing) {
            entryMap.set(id, e);
          } else {
            // Newer updatedAt wins; fallback to createdAt; fallback to incoming.
            const incomingTs = Number(e.updatedAt || e.createdAt || 0);
            const existingTs = Number(existing.updatedAt || existing.createdAt || 0);
            entryMap.set(id, incomingTs >= existingTs ? e : existing);
          }
        }
        data.overstockEntries = [...entryMap.values()];

        // Merge overstockContainers (same pattern)
        const incomingContainers = Array.isArray(data.overstockContainers) ? data.overstockContainers : [];
        const serverContainers   = Array.isArray(serverData.overstockContainers) ? serverData.overstockContainers : [];
        const deletedContainerIds = new Set(
          (Array.isArray(data.__deletedOverstockContainerIds) ? data.__deletedOverstockContainerIds : [])
            .concat(Array.isArray(serverData.__deletedOverstockContainerIds) ? serverData.__deletedOverstockContainerIds : [])
            .map(String)
        );
        const containerMap = new Map();
        for (const c of serverContainers) {
          if (c && c.id && !deletedContainerIds.has(String(c.id))) containerMap.set(String(c.id), c);
        }
        for (const c of incomingContainers) {
          if (!c || !c.id) continue;
          const id = String(c.id);
          if (deletedContainerIds.has(id)) continue;
          const existing = containerMap.get(id);
          if (!existing) {
            containerMap.set(id, c);
          } else {
            const incomingTs = Number(c.updatedAt || c.createdAt || 0);
            const existingTs = Number(existing.updatedAt || existing.createdAt || 0);
            containerMap.set(id, incomingTs >= existingTs ? c : existing);
          }
        }
        data.overstockContainers = [...containerMap.values()];

        // Clear tombstones from the merged result. The client clears its own
        // local tombstones based on the response.
        delete data.__deletedOverstockEntryIds;
        delete data.__deletedOverstockContainerIds;
      } catch (mergeErr) {
        // If merge fails for any reason, fall back to the original full-state
        // overwrite behavior — don't break sync entirely. Log for debugging.
        console.warn('Overstock merge failed, falling back to overwrite:', mergeErr.message);
      }

      const result = await pool.query(
        `INSERT INTO workflow_sync_state (state_key, data_json, masters_json, active_editors, updated_at)
         VALUES ('default', $1::jsonb, $2::jsonb, '{}'::jsonb, NOW())
         ON CONFLICT (state_key)
         DO UPDATE SET data_json=EXCLUDED.data_json, masters_json=EXCLUDED.masters_json, updated_at=NOW()
         RETURNING data_json, masters_json, active_editors, updated_at;`,
        [JSON.stringify(data), JSON.stringify(masters)]
      );
      // Persist pallet events to audit table (non-blocking — failure doesn't break sync)
      try { await persistPalletEvents(Array.isArray(data.pallets) ? data.pallets : []); } catch(_) {}
      const row = result.rows[0];
      return json(200, {
        ok: true,
        data: row.data_json,
        masters: row.masters_json,
        activeEditors: pruneEditors(row.active_editors),
        updated_at: row.updated_at,
      });
    }

    // PATCH — atomically update just the active_editors field.
    // Used by each browser to register/deregister themselves as editing a pallet.
    // action: 'open'  { palletId, user } — register editor
    // action: 'close' { palletId, user } — deregister editor
    if (event.httpMethod === 'PATCH') {
      const body = JSON.parse(event.body || '{}');
      const { action, palletId, user } = body;
      if (!action || !palletId) return json(400, { error: 'action and palletId required' });

      // Read current editors, prune stale, apply change, write back atomically
      const current = await pool.query(
        `SELECT active_editors FROM workflow_sync_state WHERE state_key='default' LIMIT 1;`
      );
      const editors = pruneEditors(current.rows[0]?.active_editors || {});

      if (action === 'open' && user) {
        editors[palletId] = { user, ts: Date.now() };
      } else if (action === 'close') {
        // Remove any entry for this pallet by this user
        if (editors[palletId]?.user === user) {
          delete editors[palletId];
        }
      }

      await pool.query(
        `UPDATE workflow_sync_state SET active_editors=$1::jsonb WHERE state_key='default';`,
        [JSON.stringify(editors)]
      );
      return json(200, { ok: true, activeEditors: editors });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (error) {
    return json(500, { error: error.message || 'Unknown workflow sync error' });
  }
};
