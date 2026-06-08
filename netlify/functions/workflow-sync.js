
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

// ── Authentication gate (staged rollout) ─────────────────────────────────
// When WORKFLOW_SYNC_REQUIRE_AUTH is "true", every request must carry a valid
// Netlify Identity token belonging to an invited, non-suspended hc_users
// account. When the flag is unset/false (the default), the function behaves
// exactly as before — no auth required. This lets the client-side token
// plumbing ship and be verified on a real tablet BEFORE enforcement is
// switched on, so a misconfiguration can't lock the whole warehouse out.
const REQUIRE_AUTH = String(process.env.WORKFLOW_SYNC_REQUIRE_AUTH || '').toLowerCase() === 'true';
const IDENTITY_USER_URL = 'https://inboundswagup.netlify.app/.netlify/identity/user';

// Verify the caller's Identity token and confirm they're a known, allowed
// user. Returns the Identity user object on success, or null on any failure.
// Mirrors the verifyAdmin pattern used in users.js / system-reset.js.
async function verifyUser(event) {
  const auth = event.headers['authorization'] || event.headers['Authorization'] || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return null;
  try {
    const res = await fetch(IDENTITY_USER_URL, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const user = await res.json();
    if (!user || !user.email) return null;
    // Confirm the account is invited and not suspended. hc_users is the source
    // of truth used everywhere else. If the DB is briefly unreachable we accept
    // a validly-signed Identity token rather than hard-failing all sync.
    try {
      const db = await pool.query('SELECT suspended, invited FROM hc_users WHERE LOWER(email)=LOWER($1)', [user.email]);
      if (db.rows.length) {
        const u = db.rows[0];
        if (u.suspended) return null;
        if (u.invited === false) return null;
      } else {
        return null; // valid Google login, but not invited into this system
      }
    } catch (dbErr) {
      console.warn('workflow-sync: hc_users check failed, accepting valid token:', dbErr.message);
    }
    return user;
  } catch (err) {
    console.warn('workflow-sync: token verification error:', err.message);
    return null;
  }
}

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

    // Enforce authentication when the rollout switch is on. Off by default so
    // the client token plumbing can be validated before flipping it.
    if (REQUIRE_AUTH) {
      const caller = await verifyUser(event);
      if (!caller) return json(401, { error: 'Authentication required' });
    }

    if (event.httpMethod === 'GET') {
      // Lightweight "meta" mode (?meta=1): return ONLY updated_at + editors, not
      // the full data/masters blobs. The client polls this cheaply and downloads
      // the full state only when updated_at has changed — drastically cutting
      // repeated transfer of the same large blob.
      const meta = event.queryStringParameters &&
        (event.queryStringParameters.meta === '1' || event.queryStringParameters.meta === 'true');
      if (meta) {
        const r = await pool.query(
          `SELECT active_editors, updated_at FROM workflow_sync_state WHERE state_key='default' LIMIT 1;`
        );
        const row = r.rows[0] || { active_editors: {}, updated_at: null };
        return json(200, {
          meta: true,
          activeEditors: pruneEditors(row.active_editors),
          updated_at: row.updated_at,
        });
      }

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
      //   - Deletes are PERSISTED on the server as timestamped tombstones
      //     (not stripped after one apply), so that ANY client POSTing a
      //     stale copy of a deleted item will have that item filtered out.
      //     Tombstones expire after 24 hours so the list doesn't grow.
      //
      // Tombstone shape stored on server: { id, ts } where ts is epoch ms.
      // Incoming tombstones from clients are normalized to this shape on
      // the way in, then merged with existing server-side tombstones.
      try {
        const currentResult = await pool.query(
          `SELECT data_json FROM workflow_sync_state WHERE state_key='default' LIMIT 1;`
        );
        const serverData = currentResult.rows[0]?.data_json || {};

        const TOMBSTONE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
        const now = Date.now();

        // Normalize tombstone arrays to { id, ts } shape. Accepts both legacy
        // bare-id arrays (from older clients) and the new objects.
        function normalizeTombstones(arr) {
          if (!Array.isArray(arr)) return [];
          return arr.map(t => {
            if (t && typeof t === 'object' && t.id) return { id: String(t.id), ts: Number(t.ts || now) };
            if (t) return { id: String(t), ts: now }; // bare id from legacy client
            return null;
          }).filter(Boolean);
        }
        // Merge two tombstone arrays, keeping the newest ts per id and
        // dropping anything past TTL.
        function mergeTombstones(a, b) {
          const map = new Map();
          for (const t of [...a, ...b]) {
            if (!t || !t.id) continue;
            if (now - t.ts > TOMBSTONE_TTL_MS) continue; // expired
            const prev = map.get(t.id);
            if (!prev || t.ts > prev.ts) map.set(t.id, t);
          }
          return [...map.values()];
        }

        // Compute merged tombstones for entries + containers
        const incomingEntryTombs    = normalizeTombstones(data.__deletedOverstockEntryIds);
        const serverEntryTombs      = normalizeTombstones(serverData.__deletedOverstockEntryIds);
        const mergedEntryTombs      = mergeTombstones(incomingEntryTombs, serverEntryTombs);
        const deletedEntryIds       = new Set(mergedEntryTombs.map(t => t.id));

        const incomingContainerTombs = normalizeTombstones(data.__deletedOverstockContainerIds);
        const serverContainerTombs   = normalizeTombstones(serverData.__deletedOverstockContainerIds);
        const mergedContainerTombs   = mergeTombstones(incomingContainerTombs, serverContainerTombs);
        const deletedContainerIds    = new Set(mergedContainerTombs.map(t => t.id));

        // Merge overstockEntries
        const incomingEntries = Array.isArray(data.overstockEntries) ? data.overstockEntries : [];
        const serverEntries   = Array.isArray(serverData.overstockEntries) ? serverData.overstockEntries : [];
        const entryMap = new Map();
        for (const e of serverEntries) {
          if (e && e.id && !deletedEntryIds.has(String(e.id))) entryMap.set(String(e.id), e);
        }
        for (const e of incomingEntries) {
          if (!e || !e.id) continue;
          const id = String(e.id);
          if (deletedEntryIds.has(id)) continue; // tombstoned — block resurrection
          const existing = entryMap.get(id);
          if (!existing) {
            entryMap.set(id, e);
          } else {
            const incomingTs = Number(e.updatedAt || e.createdAt || 0);
            const existingTs = Number(existing.updatedAt || existing.createdAt || 0);
            entryMap.set(id, incomingTs >= existingTs ? e : existing);
          }
        }
        data.overstockEntries = [...entryMap.values()];

        // Merge overstockContainers
        const incomingContainers = Array.isArray(data.overstockContainers) ? data.overstockContainers : [];
        const serverContainers   = Array.isArray(serverData.overstockContainers) ? serverData.overstockContainers : [];
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

        // Persist merged tombstones on the server (24h rolling window). This is
        // the key change from the previous version — we no longer strip them
        // after applying. They stay around to block resurrection by stale
        // clients that haven't seen the delete yet.
        data.__deletedOverstockEntryIds     = mergedEntryTombs;
        data.__deletedOverstockContainerIds = mergedContainerTombs;
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
