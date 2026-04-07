const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : undefined,
});

const WORKSPACE_ID = '00000000-0000-0000-0000-000000000001';
let schemaReady = false;

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(body),
  };
}

async function ensureSchema() {
  if (schemaReady) return;
  await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL,
      slug text NOT NULL UNIQUE,
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await pool.query(
    `INSERT INTO workspaces (id, name, slug)
     VALUES ($1, 'Houston Control', 'houston-control')
     ON CONFLICT (id) DO NOTHING;`,
    [WORKSPACE_ID]
  );
  await pool.query(`
    CREATE TABLE IF NOT EXISTS employees (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      external_key text,
      name text NOT NULL,
      default_department text NOT NULL,
      birthday date,
      size text,
      hourly_rate numeric(10,2),
      active boolean NOT NULL DEFAULT true,
      meta jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (workspace_id, name)
    );
  `);
  schemaReady = true;
}

function normalizeEmployee(item = {}) {
  return {
    id: String(item.id || '').trim(),
    name: String(item.name || '').trim(),
    department: String(item.department || item.defaultDepartment || 'Receiving').trim(),
    birthday: String(item.birthday || '').trim(),
    size: String(item.size || '').trim(),
    active: item.active !== false,
    hourlyRate: item.hourlyRate == null || item.hourlyRate === '' ? null : Number(item.hourlyRate),
  };
}

async function readAll() {
  const result = await pool.query(
    `SELECT id, name, default_department, birthday, size, active, hourly_rate
     FROM employees
     WHERE workspace_id = $1
     ORDER BY name ASC;`,
    [WORKSPACE_ID]
  );
  return {
    employees: result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      department: row.default_department,
      birthday: row.birthday || '',
      size: row.size || '',
      active: row.active !== false,
      hourlyRate: row.hourly_rate == null ? '' : Number(row.hourly_rate),
    })),
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

      if (Array.isArray(body.employees)) {
        const employees = body.employees
          .map(normalizeEmployee)
          .filter((item) => item.name);

        await pool.query('BEGIN');
        await pool.query(`DELETE FROM employees WHERE workspace_id = $1;`, [WORKSPACE_ID]);
        for (const item of employees) {
          await pool.query(
            `INSERT INTO employees
             (id, workspace_id, name, default_department, birthday, size, active, hourly_rate, meta)
             VALUES (COALESCE(NULLIF($1,''), gen_random_uuid()::text)::uuid, $2, $3, $4, NULLIF($5,''), NULLIF($6,''), $7, $8, '{}'::jsonb);`,
            [item.id, WORKSPACE_ID, item.name, item.department, item.birthday, item.size, item.active, item.hourlyRate]
          );
        }
        await pool.query('COMMIT');
        return json(200, { ok: true, ...(await readAll()) });
      }

      const employee = normalizeEmployee(body);
      if (!employee.name || !employee.department) {
        return json(400, { error: 'Missing required employee fields' });
      }

      await pool.query(
        `INSERT INTO employees
         (workspace_id, name, default_department, birthday, size, active, hourly_rate, meta)
         VALUES ($1, $2, $3, NULLIF($4,''), NULLIF($5,''), $6, $7, '{}'::jsonb)
         ON CONFLICT (workspace_id, name)
         DO UPDATE SET default_department = EXCLUDED.default_department,
                       birthday = EXCLUDED.birthday,
                       size = EXCLUDED.size,
                       active = EXCLUDED.active,
                       hourly_rate = EXCLUDED.hourly_rate,
                       updated_at = now();`,
        [WORKSPACE_ID, employee.name, employee.department, employee.birthday, employee.size, employee.active, employee.hourlyRate]
      );

      return json(200, { ok: true, ...(await readAll()) });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (error) {
    try { await pool.query('ROLLBACK'); } catch {}
    return json(500, { error: error.message || 'Unknown employee sync error' });
  }
};
