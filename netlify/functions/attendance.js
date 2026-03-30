
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
    CREATE TABLE IF NOT EXISTS attendance_records (
      id BIGSERIAL PRIMARY KEY,
      employee_name TEXT NOT NULL,
      department TEXT NOT NULL,
      date DATE NOT NULL,
      mark TEXT NOT NULL,
      demerits NUMERIC NOT NULL DEFAULT 0
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
        SELECT id, employee_name, department, date, mark, demerits
        FROM attendance_records
        ORDER BY date DESC, id DESC;
      `);
      return json(200, {
        records: result.rows.map(row => ({
          id: row.id,
          employeeName: row.employee_name,
          department: row.department,
          date: row.date,
          mark: row.mark,
          demerits: Number(row.demerits || 0),
        })),
      });
    }

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');

      // Full replace sync path
      if (Array.isArray(body.records)) {
        const records = body.records
          .map(item => ({
            employeeName: String(item.employeeName || '').trim(),
            department: String(item.department || 'Receiving').trim(),
            date: String(item.date || '').trim(),
            mark: String(item.mark || '').trim(),
            demerits: Number(item.demerits || 0),
          }))
          .filter(item => item.employeeName && item.department && item.date && item.mark);

        await pool.query('BEGIN');
        await pool.query('TRUNCATE TABLE attendance_records RESTART IDENTITY;');
        for (const item of records) {
          await pool.query(
            `INSERT INTO attendance_records (employee_name, department, date, mark, demerits)
             VALUES ($1, $2, $3, $4, $5);`,
            [item.employeeName, item.department, item.date, item.mark, item.demerits]
          );
        }
        await pool.query('COMMIT');

        const result = await pool.query(`
          SELECT id, employee_name, department, date, mark, demerits
          FROM attendance_records
          ORDER BY date DESC, id DESC;
        `);
        return json(200, {
          ok: true,
          records: result.rows.map(row => ({
            id: row.id,
            employeeName: row.employee_name,
            department: row.department,
            date: row.date,
            mark: row.mark,
            demerits: Number(row.demerits || 0),
          })),
        });
      }

      // Legacy single-record path
      const employeeName = String(body.employeeName || '').trim();
      const department = String(body.department || '').trim();
      const date = String(body.date || '').trim();
      const mark = String(body.mark || '').trim();
      const demerits = Number(body.demerits || 0);

      if (!employeeName || !department || !date || !mark) {
        return json(400, { error: 'Missing required attendance fields' });
      }

      const result = await pool.query(
        `
        INSERT INTO attendance_records (employee_name, department, date, mark, demerits)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, employee_name, department, date, mark, demerits;
        `,
        [employeeName, department, date, mark, demerits]
      );

      const row = result.rows[0];
      return json(200, {
        ok: true,
        record: {
          id: row.id,
          employeeName: row.employee_name,
          department: row.department,
          date: row.date,
          mark: row.mark,
          demerits: Number(row.demerits || 0),
        },
      });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (error) {
    try { await pool.query('ROLLBACK'); } catch {}
    return json(500, { error: error.message || 'Unknown attendance sync error' });
  }
};
