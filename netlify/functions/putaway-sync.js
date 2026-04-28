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

async function ensureSchema() {
  if (schemaReady) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS putaway_containers (
      id            TEXT PRIMARY KEY,
      pallet_id     TEXT NOT NULL,
      pallet_label  TEXT NOT NULL DEFAULT '',
      pallet_date   TEXT NOT NULL DEFAULT '',
      status        TEXT NOT NULL DEFAULT 'staging',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at  TIMESTAMPTZ,
      notes         TEXT NOT NULL DEFAULT ''
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS putaway_po_lines (
      id              TEXT PRIMARY KEY,
      container_id    TEXT NOT NULL REFERENCES putaway_containers(id) ON DELETE CASCADE,
      pallet_id       TEXT NOT NULL,
      po_number       TEXT NOT NULL,
      category        TEXT NOT NULL DEFAULT '',
      destination_type TEXT NOT NULL DEFAULT 'lts',
      total_units     INTEGER NOT NULL DEFAULT 0,
      total_boxes     INTEGER,
      units_placed    INTEGER NOT NULL DEFAULT 0,
      status          TEXT NOT NULL DEFAULT 'unassigned',
      size_breakdown  JSONB,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_putaway_po_lines_container ON putaway_po_lines (container_id);
    CREATE INDEX IF NOT EXISTS idx_putaway_po_lines_po ON putaway_po_lines (po_number);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS putaway_placements (
      id              TEXT PRIMARY KEY,
      container_id    TEXT NOT NULL,
      pallet_id       TEXT NOT NULL,
      po_line_id      TEXT NOT NULL REFERENCES putaway_po_lines(id) ON DELETE CASCADE,
      po_number       TEXT NOT NULL,
      location_code   TEXT NOT NULL,
      units_placed    INTEGER NOT NULL DEFAULT 0,
      boxes_placed    INTEGER,
      placed_by       TEXT NOT NULL DEFAULT '',
      placed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      notes           TEXT NOT NULL DEFAULT ''
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_putaway_placements_container ON putaway_placements (container_id);
    CREATE INDEX IF NOT EXISTS idx_putaway_placements_po ON putaway_placements (po_number);
    CREATE INDEX IF NOT EXISTS idx_putaway_placements_loc ON putaway_placements (location_code);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS putaway_locations (
      location_code   TEXT PRIMARY KEY,
      row_code        TEXT NOT NULL DEFAULT '',
      bay             INTEGER NOT NULL DEFAULT 1,
      level_code      TEXT NOT NULL DEFAULT 'A',
      side            INTEGER NOT NULL DEFAULT 1,
      status          TEXT NOT NULL DEFAULT 'empty',
      last_updated    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  schemaReady = true;
}

exports.handler = async function handler(event) {
  if (!process.env.DATABASE_URL) {
    return json(500, { error: 'DATABASE_URL not configured' });
  }

  try {
    await ensureSchema();
    const method = event.httpMethod;
    const params = event.queryStringParameters || {};

    // ── GET /putaway-sync ─────────────────────────────────────────────────
    if (method === 'GET') {

      // ?action=container&id=xxx
      if (params.action === 'container' && params.id) {
        const c = await pool.query(
          `SELECT * FROM putaway_containers WHERE id = $1`, [params.id]
        );
        if (!c.rows[0]) return json(404, { error: 'Container not found' });
        const lines = await pool.query(
          `SELECT * FROM putaway_po_lines WHERE container_id = $1 ORDER BY created_at`, [params.id]
        );
        const placements = await pool.query(
          `SELECT * FROM putaway_placements WHERE container_id = $1 ORDER BY placed_at DESC`, [params.id]
        );
        return json(200, {
          container: c.rows[0],
          lines: lines.rows,
          placements: placements.rows,
        });
      }

      // ?action=list — all containers summary
      if (params.action === 'list') {
        const res = await pool.query(`
          SELECT c.*,
            COUNT(l.id) AS line_count,
            COALESCE(SUM(l.total_units),0) AS total_units,
            COALESCE(SUM(l.units_placed),0) AS units_placed
          FROM putaway_containers c
          LEFT JOIN putaway_po_lines l ON l.container_id = c.id
          GROUP BY c.id
          ORDER BY c.created_at DESC
          LIMIT 100
        `);
        return json(200, { containers: res.rows });
      }

      // ?action=search_po&po=xxx
      if (params.action === 'search_po' && params.po) {
        const res = await pool.query(`
          SELECT l.*, c.pallet_label, c.pallet_date, c.status AS container_status
          FROM putaway_po_lines l
          JOIN putaway_containers c ON c.id = l.container_id
          WHERE l.po_number ILIKE $1
          ORDER BY c.created_at DESC
        `, [`%${params.po}%`]);
        // Also get placements for each line
        const lineIds = res.rows.map(r => r.id);
        let placements = [];
        if (lineIds.length) {
          const pRes = await pool.query(
            `SELECT * FROM putaway_placements WHERE po_line_id = ANY($1) ORDER BY placed_at DESC`,
            [lineIds]
          );
          placements = pRes.rows;
        }
        return json(200, { lines: res.rows, placements });
      }

      // ?action=location&code=xxx
      if (params.action === 'location' && params.code) {
        const placements = await pool.query(`
          SELECT p.*, pl.pallet_label, pl.po_number
          FROM putaway_placements p
          JOIN putaway_containers pl ON pl.id = p.container_id
          WHERE p.location_code = $1
          ORDER BY p.placed_at DESC
        `, [params.code]);
        return json(200, { location_code: params.code, placements: placements.rows });
      }

      return json(400, { error: 'Unknown action' });
    }

    // ── POST /putaway-sync ────────────────────────────────────────────────
    if (method === 'POST') {
      let body;
      try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }

      // action: create_container — called when pallet advances to done
      if (body.action === 'create_container') {
        const { container, lines } = body;
        if (!container?.id) return json(400, { error: 'container.id required' });

        // Upsert container
        await pool.query(`
          INSERT INTO putaway_containers (id, pallet_id, pallet_label, pallet_date, status, notes)
          VALUES ($1,$2,$3,$4,'staging',$5)
          ON CONFLICT (id) DO UPDATE
            SET pallet_label=EXCLUDED.pallet_label,
                pallet_date=EXCLUDED.pallet_date,
                notes=EXCLUDED.notes
        `, [container.id, container.pallet_id, container.pallet_label, container.pallet_date, container.notes||'']);

        // Insert PO lines (skip duplicates)
        for (const line of (lines || [])) {
          await pool.query(`
            INSERT INTO putaway_po_lines
              (id, container_id, pallet_id, po_number, category, destination_type,
               total_units, total_boxes, size_breakdown)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
            ON CONFLICT (id) DO NOTHING
          `, [line.id, container.id, container.pallet_id, line.po_number,
              line.category||'', line.destination_type||'lts',
              line.total_units||0, line.total_boxes||null,
              line.size_breakdown ? JSON.stringify(line.size_breakdown) : null]);
        }
        return json(201, { ok: true, container_id: container.id });
      }

      // action: add_placement
      if (body.action === 'add_placement') {
        const { placement } = body;
        if (!placement?.id || !placement?.po_line_id || !placement?.location_code) {
          return json(400, { error: 'placement.id, po_line_id, location_code required' });
        }

        await pool.query(`
          INSERT INTO putaway_placements
            (id, container_id, pallet_id, po_line_id, po_number, location_code,
             units_placed, boxes_placed, placed_by, placed_at, notes)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
          ON CONFLICT (id) DO NOTHING
        `, [placement.id, placement.container_id, placement.pallet_id,
            placement.po_line_id, placement.po_number, placement.location_code,
            placement.units_placed||0, placement.boxes_placed||null,
            placement.placed_by||'', placement.placed_at||new Date().toISOString(),
            placement.notes||'']);

        // Recalculate units_placed and status on the PO line
        const totals = await pool.query(`
          SELECT COALESCE(SUM(units_placed),0) AS placed
          FROM putaway_placements WHERE po_line_id = $1
        `, [placement.po_line_id]);
        const placed = Number(totals.rows[0].placed);

        const lineRes = await pool.query(
          `SELECT total_units FROM putaway_po_lines WHERE id = $1`, [placement.po_line_id]
        );
        const total = Number(lineRes.rows[0]?.total_units || 0);
        const status = placed >= total && total > 0 ? 'complete' : placed > 0 ? 'partial' : 'unassigned';

        await pool.query(`
          UPDATE putaway_po_lines
          SET units_placed = $1, status = $2
          WHERE id = $3
        `, [placed, status, placement.po_line_id]);

        // Update location status
        await pool.query(`
          INSERT INTO putaway_locations (location_code, row_code, bay, level_code, side, status, last_updated)
          VALUES ($1, $2, $3, $4, $5, 'partial', NOW())
          ON CONFLICT (location_code) DO UPDATE
            SET status = 'partial', last_updated = NOW()
        `, [placement.location_code,
            placement.location_code.slice(0,2),
            parseInt(placement.location_code.slice(2)) || 1,
            placement.location_code.slice(-2,-1) || 'A',
            parseInt(placement.location_code.slice(-1)) || 1]);

        // Check if whole container is done
        const remaining = await pool.query(`
          SELECT COUNT(*) AS cnt FROM putaway_po_lines
          WHERE container_id = $1 AND status != 'complete'
        `, [placement.container_id]);
        if (Number(remaining.rows[0].cnt) === 0) {
          await pool.query(`
            UPDATE putaway_containers
            SET status='complete', completed_at=NOW()
            WHERE id=$1
          `, [placement.container_id]);
        } else {
          await pool.query(`
            UPDATE putaway_containers SET status='in_progress' WHERE id=$1 AND status='staging'
          `, [placement.container_id]);
        }

        return json(200, { ok: true, units_placed: placed, line_status: status });
      }

      // action: update_container_status
      if (body.action === 'update_container_status') {
        const { container_id, status } = body;
        if (!container_id) return json(400, { error: 'container_id required' });
        await pool.query(
          `UPDATE putaway_containers SET status=$1 WHERE id=$2`,
          [status, container_id]
        );
        return json(200, { ok: true });
      }

      return json(400, { error: 'Unknown action' });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('putaway-sync error:', err);
    return json(500, { error: err.message || 'Internal error' });
  }
};
