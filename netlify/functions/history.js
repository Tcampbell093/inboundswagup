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
    CREATE TABLE IF NOT EXISTS history_log (
      id            BIGSERIAL    PRIMARY KEY,
      entity_type   VARCHAR(50)  NOT NULL,
      entity_id     VARCHAR(255) NOT NULL,
      salesforce_id VARCHAR(255),
      action        VARCHAR(80)  NOT NULL,
      changed_by    VARCHAR(255),
      changed_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      before_data   JSONB,
      after_data    JSONB,
      related_type  VARCHAR(50),
      related_id    VARCHAR(255),
      note          TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_history_entity   ON history_log (entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_history_changed  ON history_log (changed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_history_related  ON history_log (related_type, related_id);
    CREATE INDEX IF NOT EXISTS idx_history_user     ON history_log (changed_by);
  `);
  schemaReady = true;
}

exports.handler = async function handler(event) {
  if (!process.env.DATABASE_URL) return json(500, { error: 'DATABASE_URL not configured' });

  try {
    await ensureSchema();

    if (event.httpMethod === 'POST') {
      let raw;
      try { raw = JSON.parse(event.body || '[]'); } catch { return json(400, { error: 'Invalid JSON' }); }
      const entries = Array.isArray(raw) ? raw : [raw];
      if (!entries.length) return json(400, { error: 'No entries' });

      const vals = [];
      const rows = entries.map((e, i) => {
        const b = i * 11;
        vals.push(
          String(e.entity_type || '').slice(0, 50),
          String(e.entity_id   || '').slice(0, 255),
          e.salesforce_id ? String(e.salesforce_id).slice(0, 255) : null,
          String(e.action || 'updated').slice(0, 80),
          e.changed_by ? String(e.changed_by).slice(0, 255) : null,
          e.changed_at  ? new Date(e.changed_at).toISOString() : new Date().toISOString(),
          e.before_data !== undefined && e.before_data !== null ? JSON.stringify(e.before_data) : null,
          e.after_data  !== undefined && e.after_data  !== null ? JSON.stringify(e.after_data)  : null,
          e.related_type ? String(e.related_type).slice(0, 50)  : null,
          e.related_id   ? String(e.related_id).slice(0, 255)   : null,
          e.note         ? String(e.note)                        : null,
        );
        return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7}::jsonb,$${b+8}::jsonb,$${b+9},$${b+10},$${b+11})`;
      });

      await pool.query(
        `INSERT INTO history_log
           (entity_type,entity_id,salesforce_id,action,changed_by,changed_at,before_data,after_data,related_type,related_id,note)
         VALUES ${rows.join(',')}`,
        vals
      );
      return json(200, { ok: true, count: entries.length });
    }

    if (event.httpMethod === 'GET') {
      const q = event.queryStringParameters || {};
      const conditions = [];
      const vals = [];
      let idx = 1;

      if (q.entity_type && q.entity_id) {
        if (q.include_related === 'true') {
          conditions.push(`((entity_type=$${idx++} AND entity_id=$${idx++}) OR (related_type=$${idx++} AND related_id=$${idx++}))`);
          vals.push(q.entity_type, q.entity_id, q.entity_type, q.entity_id);
        } else {
          conditions.push(`entity_type=$${idx++} AND entity_id=$${idx++}`);
          vals.push(q.entity_type, q.entity_id);
        }
      } else if (q.related_type && q.related_id) {
        conditions.push(`related_type=$${idx++} AND related_id=$${idx++}`);
        vals.push(q.related_type, q.related_id);
      } else if (q.changed_by) {
        conditions.push(`changed_by=$${idx++}`);
        vals.push(q.changed_by);
      } else if (q.search) {
        conditions.push(`(entity_id ILIKE $${idx++} OR changed_by ILIKE $${idx++} OR note ILIKE $${idx++})`);
        const term = `%${q.search}%`;
        vals.push(term, term, term);
      }

      if (q.entity_type && !q.entity_id) {
        conditions.push(`entity_type=$${idx++}`);
        vals.push(q.entity_type);
      }

      if (q.from) { conditions.push(`changed_at >= $${idx++}`); vals.push(q.from); }
      if (q.to)   { conditions.push(`changed_at <= $${idx++}`); vals.push(q.to); }

      const where  = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const lim    = Math.min(parseInt(q.limit  || '100', 10), 500);
      const offset = Math.max(parseInt(q.offset || '0',   10), 0);

      const [rows, total] = await Promise.all([
        pool.query(`SELECT * FROM history_log ${where} ORDER BY changed_at DESC LIMIT $${idx++} OFFSET $${idx++}`, [...vals, lim, offset]),
        pool.query(`SELECT COUNT(*)::int AS total FROM history_log ${where}`, vals),
      ]);

      return json(200, {
        entries: rows.rows,
        total:   total.rows[0]?.total || 0,
        limit:   lim,
        offset,
      });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (err) {
    return json(500, { error: err.message || 'History error' });
  }
};
