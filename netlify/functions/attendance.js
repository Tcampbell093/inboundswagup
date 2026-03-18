
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost')
    ? { rejectUnauthorized: false }
    : false,
});

let schemaReady = false;

async function ensureSchema() {
  if (schemaReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS uph_logs (
      id BIGSERIAL PRIMARY KEY,
      work_date DATE NOT NULL,
      employee_name TEXT NOT NULL,
      department TEXT NOT NULL,
      units INTEGER NOT NULL DEFAULT 0,
      hours_worked NUMERIC(6,2) NOT NULL DEFAULT 0,
      notes TEXT,
      mark TEXT DEFAULT 'Present',
      demerits NUMERIC(6,2) NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uph_logs_unique_attendance
    ON uph_logs (work_date, employee_name, department);
  `);
  schemaReady = true;
}

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

exports.handler = async function handler(event) {
  if (!process.env.DATABASE_URL) {
    return json(500, { error: 'DATABASE_URL is missing in Netlify environment variables.' });
  }

  try {
    await ensureSchema();

    if (event.httpMethod === 'GET') {
      const result = await pool.query(`
        SELECT
          id,
          work_date,
          employee_name,
          department,
          COALESCE(mark, 'Present') AS mark,
          COALESCE(demerits, 0) AS demerits
        FROM uph_logs
        ORDER BY work_date DESC, employee_name ASC, department ASC;
      `);

      const records = result.rows.map((row) => ({
        id: Number(row.id),
        date: String(row.work_date).slice(0, 10),
        employeeName: row.employee_name,
        department: row.department,
        mark: row.mark || 'Present',
        demerits: Number(row.demerits || 0),
      }));

      return json(200, { records });
    }

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const employeeName = String(body.employeeName || '').trim();
      const department = String(body.department || '').trim();
      const date = String(body.date || '').trim();
      const mark = String(body.mark || 'Present').trim();
      const demerits = Number(body.demerits || 0);

      if (!employeeName || !department || !date) {
        return json(400, { error: 'employeeName, department, and date are required.' });
      }

      const result = await pool.query(
        `
          INSERT INTO uph_logs (
            work_date,
            employee_name,
            department,
            units,
            hours_worked,
            notes,
            mark,
            demerits
          )
          VALUES ($1, $2, $3, 0, 0, '', $4, $5)
          ON CONFLICT (work_date, employee_name, department)
          DO UPDATE SET
            mark = EXCLUDED.mark,
            demerits = EXCLUDED.demerits
          RETURNING id;
        `,
        [date, employeeName, department, mark, demerits]
      );

      return json(200, { ok: true, id: Number(result.rows[0].id) });
    }

    if (event.httpMethod === 'DELETE') {
      const body = JSON.parse(event.body || '{}');

      if (body.clearAll === true) {
        await pool.query(`DELETE FROM uph_logs;`);
        return json(200, { ok: true, cleared: true });
      }

      const id = Number(body.id);
      if (!Number.isFinite(id)) {
        return json(400, { error: 'A numeric id is required for delete.' });
      }

      await pool.query(`DELETE FROM uph_logs WHERE id = $1;`, [id]);
      return json(200, { ok: true, deleted: id });
    }

    return json(405, { error: 'Method not allowed.' });
  } catch (error) {
    return json(500, { error: error.message || 'Unexpected attendance function error.' });
  }
};
