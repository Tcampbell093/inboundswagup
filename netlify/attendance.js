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
    CREATE TABLE IF NOT EXISTS attendance_records (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      employee_id uuid,
      employee_name text NOT NULL,
      department text NOT NULL,
      attendance_date date NOT NULL,
      mark text NOT NULL,
      demerits numeric(6,2) NOT NULL DEFAULT 0,
      source text NOT NULL DEFAULT 'manual',
      meta jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (workspace_id, employee_name, department, attendance_date)
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS attendance_moves (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      employee_id uuid,
      employee_name text NOT NULL,
      move_date date NOT NULL,
      from_department text,
      to_department text NOT NULL,
      start_time text,
      end_time text,
      note text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  schemaReady = true;
}

function normalizeRecord(item = {}) {
  return {
    id: String(item.id || '').trim(),
    employeeName: String(item.employeeName || '').trim(),
    department: String(item.department || 'Receiving').trim(),
    date: String(item.date || item.attendanceDate || '').trim(),
    mark: String(item.mark || '').trim(),
    demerits: Number(item.demerits || 0),
  };
}

function normalizeMove(item = {}) {
  return {
    id: String(item.id || '').trim(),
    employeeName: String(item.employeeName || '').trim(),
    date: String(item.date || item.moveDate || '').trim(),
    fromDepartment: String(item.fromDepartment || '').trim(),
    toDepartment: String(item.toDepartment || '').trim(),
    startTime: String(item.startTime || '').trim(),
    endTime: String(item.endTime || '').trim(),
    note: String(item.note || '').trim(),
  };
}

async function readAll() {
  const recordsResult = await pool.query(
    `SELECT id, employee_name, department, attendance_date, mark, demerits
     FROM attendance_records
     WHERE workspace_id = $1
     ORDER BY attendance_date DESC, employee_name ASC, department ASC;`,
    [WORKSPACE_ID]
  );
  const movesResult = await pool.query(
    `SELECT id, employee_name, move_date, from_department, to_department, start_time, end_time, note, created_at
     FROM attendance_moves
     WHERE workspace_id = $1
     ORDER BY move_date DESC, created_at DESC;`,
    [WORKSPACE_ID]
  );
  return {
    records: recordsResult.rows.map((row) => ({
      id: row.id,
      employeeName: row.employee_name,
      department: row.department,
      date: row.attendance_date,
      mark: row.mark,
      demerits: Number(row.demerits || 0),
    })),
    moves: movesResult.rows.map((row) => ({
      id: row.id,
      employeeName: row.employee_name,
      date: row.move_date,
      fromDepartment: row.from_department || '',
      toDepartment: row.to_department,
      startTime: row.start_time || '',
      endTime: row.end_time || '',
      note: row.note || '',
      createdAt: row.created_at,
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

      if (Array.isArray(body.records) || Array.isArray(body.moves)) {
        const records = (Array.isArray(body.records) ? body.records : [])
          .map(normalizeRecord)
          .filter((item) => item.employeeName && item.department && item.date && item.mark);
        const moves = (Array.isArray(body.moves) ? body.moves : [])
          .map(normalizeMove)
          .filter((item) => item.employeeName && item.date && item.toDepartment);

        await pool.query('BEGIN');
        await pool.query(`DELETE FROM attendance_records WHERE workspace_id = $1;`, [WORKSPACE_ID]);
        await pool.query(`DELETE FROM attendance_moves WHERE workspace_id = $1;`, [WORKSPACE_ID]);

        for (const item of records) {
          await pool.query(
            `INSERT INTO attendance_records
             (id, workspace_id, employee_name, department, attendance_date, mark, demerits, source, meta)
             VALUES (COALESCE(NULLIF($1,''), gen_random_uuid()::text)::uuid, $2, $3, $4, $5, $6, $7, 'manual', '{}'::jsonb);`,
            [item.id, WORKSPACE_ID, item.employeeName, item.department, item.date, item.mark, item.demerits]
          );
        }

        for (const item of moves) {
          await pool.query(
            `INSERT INTO attendance_moves
             (id, workspace_id, employee_name, move_date, from_department, to_department, start_time, end_time, note)
             VALUES (COALESCE(NULLIF($1,''), gen_random_uuid()::text)::uuid, $2, $3, $4, NULLIF($5,''), $6, NULLIF($7,''), NULLIF($8,''), NULLIF($9,''));`,
            [item.id, WORKSPACE_ID, item.employeeName, item.date, item.fromDepartment, item.toDepartment, item.startTime, item.endTime, item.note]
          );
        }

        await pool.query('COMMIT');
        return json(200, { ok: true, ...(await readAll()) });
      }

      const record = normalizeRecord(body);
      if (!record.employeeName || !record.department || !record.date || !record.mark) {
        return json(400, { error: 'Missing required attendance fields' });
      }

      await pool.query(
        `INSERT INTO attendance_records
         (workspace_id, employee_name, department, attendance_date, mark, demerits, source, meta)
         VALUES ($1, $2, $3, $4, $5, $6, 'manual', '{}'::jsonb)
         ON CONFLICT (workspace_id, employee_name, department, attendance_date)
         DO UPDATE SET mark = EXCLUDED.mark, demerits = EXCLUDED.demerits, updated_at = now();`,
        [WORKSPACE_ID, record.employeeName, record.department, record.date, record.mark, record.demerits]
      );

      return json(200, { ok: true, ...(await readAll()) });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (error) {
    try { await pool.query('ROLLBACK'); } catch {}
    return json(500, { error: error.message || 'Unknown attendance sync error' });
  }
};
