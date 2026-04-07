const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : undefined,
});

let schemaReady = false;

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

async function ensureSchema() {
  if (schemaReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS employees_sync_state (
      state_key TEXT PRIMARY KEY,
      employees_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    INSERT INTO employees_sync_state (state_key, employees_json)
    VALUES ('default', '[]'::jsonb)
    ON CONFLICT (state_key) DO NOTHING;
  `);
  schemaReady = true;
}

function normalizeEmployee(item = {}) {
  const rawSize = String(item.size || '').trim().toUpperCase();
  return {
    id: String(item.id || '').trim(),
    name: String(item.name || '').trim(),
    adpName: String(item.adpName || '').trim(),
    department: String(item.department || item.defaultDepartment || 'Receiving').trim(),
    birthday: String(item.birthday || '').trim(),
    size: rawSize,
    active: item.active !== false,
    hourlyRate: item.hourlyRate == null || item.hourlyRate === '' ? '' : Number(item.hourlyRate),
  };
}

function normalizeEmployees(list = []) {
  const out = [];
  const seen = new Set();
  for (const item of Array.isArray(list) ? list : []) {
    const normalized = normalizeEmployee(item);
    if (!normalized.name) continue;
    const key = normalized.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

async function readAll() {
  const result = await pool.query(
    `SELECT employees_json, updated_at FROM employees_sync_state WHERE state_key='default' LIMIT 1;`
  );
  const row = result.rows[0] || { employees_json: [], updated_at: null };
  return {
    employees: normalizeEmployees(row.employees_json || []),
    updated_at: row.updated_at,
  };
}

exports.handler = async function handler(event) {
  if (!process.env.DATABASE_URL) {
    return json(500, { error: 'DATABASE_URL is not configured' });
  }

  try {
    await ensureSchema();

    if (event.httpMethod === 'GET') {
      return json(200, await readAll());
    }

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const employees = normalizeEmployees(Array.isArray(body.employees) ? body.employees : []);
      const result = await pool.query(
        `INSERT INTO employees_sync_state (state_key, employees_json, updated_at)
         VALUES ('default', $1::jsonb, NOW())
         ON CONFLICT (state_key)
         DO UPDATE SET employees_json = EXCLUDED.employees_json, updated_at = NOW()
         RETURNING employees_json, updated_at;`,
        [JSON.stringify(employees)]
      );
      return json(200, {
        ok: true,
        employees: normalizeEmployees(result.rows[0]?.employees_json || []),
        updated_at: result.rows[0]?.updated_at || null,
      });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (error) {
    return json(500, { error: error.message || 'Unknown employee sync error' });
  }
};
