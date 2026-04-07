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
    CREATE TABLE IF NOT EXISTS attendance_sync_state (
      state_key TEXT PRIMARY KEY,
      records_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      moves_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    INSERT INTO attendance_sync_state (state_key, records_json, moves_json)
    VALUES ('default', '[]'::jsonb, '[]'::jsonb)
    ON CONFLICT (state_key) DO NOTHING;
  `);
  schemaReady = true;
}

function normalizeRecord(item = {}) {
  return {
    id: String(item.id || '').trim(),
    employeeName: String(item.employeeName || '').trim(),
    department: String(item.department || item.defaultDepartment || 'Receiving').trim(),
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
    createdAt: String(item.createdAt || '').trim(),
  };
}

function normalizeRecords(list = []) {
  const out = [];
  const seen = new Map();
  for (const item of Array.isArray(list) ? list : []) {
    const normalized = normalizeRecord(item);
    if (!normalized.employeeName || !normalized.department || !normalized.date || !normalized.mark) continue;
    const key = `${normalized.employeeName.toLowerCase()}|${normalized.department.toLowerCase()}|${normalized.date}`;
    seen.set(key, normalized);
  }
  for (const value of seen.values()) out.push(value);
  out.sort((a, b) => String(b.date).localeCompare(String(a.date)) || a.employeeName.localeCompare(b.employeeName) || a.department.localeCompare(b.department));
  return out;
}

function normalizeMoves(list = []) {
  const out = [];
  const seen = new Set();
  for (const item of Array.isArray(list) ? list : []) {
    const normalized = normalizeMove(item);
    if (!normalized.employeeName || !normalized.date || !normalized.toDepartment) continue;
    const key = normalized.id || `${normalized.employeeName.toLowerCase()}|${normalized.date}|${normalized.toDepartment.toLowerCase()}|${normalized.startTime}|${normalized.endTime}|${normalized.note}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!normalized.createdAt) normalized.createdAt = new Date().toISOString();
    out.push(normalized);
  }
  out.sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  return out;
}

async function readAll() {
  const result = await pool.query(`SELECT records_json, moves_json, updated_at FROM attendance_sync_state WHERE state_key='default' LIMIT 1;`);
  const row = result.rows[0] || { records_json: [], moves_json: [], updated_at: null };
  return {
    records: normalizeRecords(row.records_json || []),
    moves: normalizeMoves(row.moves_json || []),
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
      const records = normalizeRecords(Array.isArray(body.records) ? body.records : []);
      const moves = normalizeMoves(Array.isArray(body.moves) ? body.moves : []);
      const result = await pool.query(
        `INSERT INTO attendance_sync_state (state_key, records_json, moves_json, updated_at)
         VALUES ('default', $1::jsonb, $2::jsonb, NOW())
         ON CONFLICT (state_key)
         DO UPDATE SET records_json = EXCLUDED.records_json, moves_json = EXCLUDED.moves_json, updated_at = NOW()
         RETURNING records_json, moves_json, updated_at;`,
        [JSON.stringify(records), JSON.stringify(moves)]
      );
      return json(200, {
        ok: true,
        records: normalizeRecords(result.rows[0]?.records_json || []),
        moves: normalizeMoves(result.rows[0]?.moves_json || []),
        updated_at: result.rows[0]?.updated_at || null,
      });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (error) {
    return json(500, { error: error.message || 'Unknown attendance sync error' });
  }
};
