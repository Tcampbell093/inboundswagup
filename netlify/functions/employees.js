
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : undefined,
});

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
  await pool.query(`
    CREATE TABLE IF NOT EXISTS employees (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      department TEXT NOT NULL,
      birthday TEXT NOT NULL DEFAULT '',
      size TEXT NOT NULL DEFAULT '',
      active BOOLEAN NOT NULL DEFAULT TRUE
    );
  `);
  schemaReady = true;
}

exports.handler = async function handler(event) {
  if (!process.env.DATABASE_URL) {
    return json(500, { error: 'DATABASE_URL is not configured' });
  }

  try {
    await ensureSchema();

    if (event.httpMethod === 'GET') {
      const result = await pool.query(`
        SELECT id, name, department, birthday, size, active
        FROM employees
        ORDER BY name ASC;
      `);
      return json(200, {
        employees: result.rows.map(row => ({
          id: row.id,
          name: row.name,
          department: row.department,
          birthday: row.birthday || '',
          size: row.size || '',
          active: row.active !== false,
        })),
      });
    }

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');

      // Full replace sync path
      if (Array.isArray(body.employees)) {
        const employees = body.employees
          .map(item => ({
            name: String(item.name || '').trim(),
            department: String(item.department || 'Receiving').trim(),
            birthday: String(item.birthday || '').trim(),
            size: String(item.size || '').trim(),
            active: item.active !== false,
          }))
          .filter(item => item.name);

        await pool.query('BEGIN');
        await pool.query('TRUNCATE TABLE employees RESTART IDENTITY;');
        for (const item of employees) {
          await pool.query(
            `INSERT INTO employees (name, department, birthday, size, active)
             VALUES ($1, $2, $3, $4, $5);`,
            [item.name, item.department, item.birthday, item.size, item.active]
          );
        }
        await pool.query('COMMIT');

        const result = await pool.query(`
          SELECT id, name, department, birthday, size, active
          FROM employees
          ORDER BY name ASC;
        `);
        return json(200, {
          ok: true,
          employees: result.rows.map(row => ({
            id: row.id,
            name: row.name,
            department: row.department,
            birthday: row.birthday || '',
            size: row.size || '',
            active: row.active !== false,
          })),
        });
      }

      // Legacy single-record path
      const name = String(body.name || '').trim();
      const department = String(body.department || '').trim();
      const birthday = String(body.birthday || '').trim();
      const size = String(body.size || '').trim();
      const active = body.active !== false;

      if (!name || !department) {
        return json(400, { error: 'Missing required employee fields' });
      }

      const result = await pool.query(
        `
        INSERT INTO employees (name, department, birthday, size, active)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, name, department, birthday, size, active;
        `,
        [name, department, birthday, size, active]
      );

      const row = result.rows[0];
      return json(200, {
        ok: true,
        employee: {
          id: row.id,
          name: row.name,
          department: row.department,
          birthday: row.birthday || '',
          size: row.size || '',
          active: row.active !== false,
        },
      });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (error) {
    try { await pool.query('ROLLBACK'); } catch {}
    return json(500, { error: error.message || 'Unknown employee sync error' });
  }
};
