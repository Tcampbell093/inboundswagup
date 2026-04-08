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
    CREATE TABLE IF NOT EXISTS productivity_settings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      qa_rate numeric(10,2) NOT NULL DEFAULT 20,
      prep_rate numeric(10,2) NOT NULL DEFAULT 20,
      assembly_rate numeric(10,2) NOT NULL DEFAULT 20,
      putaway_rate numeric(10,2) NOT NULL DEFAULT 20,
      shipping_rate numeric(10,2) NOT NULL DEFAULT 20,
      inventory_rate numeric(10,2) NOT NULL DEFAULT 20,
      ot_multiplier numeric(10,4) NOT NULL DEFAULT 1.5,
      show_sensitive_financials boolean NOT NULL DEFAULT false,
      extra jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (workspace_id)
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS productivity_import_batches (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      batch_type text NOT NULL DEFAULT 'adp_csv',
      file_name text,
      imported_at timestamptz NOT NULL DEFAULT now(),
      uploaded_by text,
      pay_dates jsonb NOT NULL DEFAULT '[]'::jsonb,
      row_count integer NOT NULL DEFAULT 0,
      total_hours numeric(12,2) NOT NULL DEFAULT 0,
      batch_meta jsonb NOT NULL DEFAULT '{}'::jsonb
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS productivity_labor_entries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      import_batch_id uuid REFERENCES productivity_import_batches(id) ON DELETE SET NULL,
      employee_id uuid,
      employee_name text NOT NULL,
      entry_date date NOT NULL,
      week_start date,
      home_department text,
      worked_department text,
      regular_hours numeric(8,2) NOT NULL DEFAULT 0,
      pto_hours numeric(8,2) NOT NULL DEFAULT 0,
      ot_hours numeric(8,2) NOT NULL DEFAULT 0,
      hourly_rate numeric(10,2),
      payout numeric(12,2),
      pto_payout numeric(12,2),
      source text NOT NULL DEFAULT 'manual',
      pay_codes jsonb,
      raw jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS productivity_daily_records (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      record_date date NOT NULL,
      total_touched_units integer,
      total_hours_used numeric(10,2),
      total_pto_hours numeric(10,2),
      total_used_dollars numeric(12,2),
      total_pto_dollars numeric(12,2),
      cpu_touched numeric(12,6),
      raw jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (workspace_id, record_date)
    );
  `);
  schemaReady = true;
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function text(value) {
  return value == null ? '' : String(value);
}
function isoDate(value) {
  // Normalize any date string (including full ISO timestamps) to YYYY-MM-DD
  const s = text(value).slice(0, 10);
  return s.match(/^\d{4}-\d{2}-\d{2}$/) ? s : '';
}

async function readAll() {
  const settingsRes = await pool.query(
    `SELECT qa_rate, prep_rate, assembly_rate, putaway_rate, shipping_rate, inventory_rate, ot_multiplier, show_sensitive_financials, extra
     FROM productivity_settings
     WHERE workspace_id = $1
     LIMIT 1;`,
    [WORKSPACE_ID]
  );
  const batchRes = await pool.query(
    `SELECT id, file_name, to_char(imported_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS imported_at, pay_dates, row_count, total_hours, batch_meta
     FROM productivity_import_batches
     WHERE workspace_id = $1
     ORDER BY imported_at DESC;`,
    [WORKSPACE_ID]
  );
  const laborRes = await pool.query(
    `SELECT id, import_batch_id, employee_name, to_char(entry_date, 'YYYY-MM-DD') AS entry_date, to_char(week_start, 'YYYY-MM-DD') AS week_start, home_department, worked_department,
            regular_hours, pto_hours, ot_hours, hourly_rate, payout, pto_payout, source, pay_codes, raw
     FROM productivity_labor_entries
     WHERE workspace_id = $1
     ORDER BY entry_date ASC, employee_name ASC, created_at ASC;`,
    [WORKSPACE_ID]
  );
  const dailyRes = await pool.query(
    `SELECT id, to_char(record_date, 'YYYY-MM-DD') AS record_date, total_touched_units, total_hours_used, total_pto_hours, total_used_dollars, total_pto_dollars, cpu_touched, raw
     FROM productivity_daily_records
     WHERE workspace_id = $1
     ORDER BY record_date ASC;`,
    [WORKSPACE_ID]
  );

  const settingsRow = settingsRes.rows[0] || {};
  return {
    settings: {
      qaRate: num(settingsRow.qa_rate, 20),
      prepRate: num(settingsRow.prep_rate, 20),
      assemblyRate: num(settingsRow.assembly_rate, 20),
      putawayRate: num(settingsRow.putaway_rate, 20),
      shippingRate: num(settingsRow.shipping_rate, 20),
      inventoryRate: num(settingsRow.inventory_rate, 20),
      otMultiplier: num(settingsRow.ot_multiplier, 1.5),
      showSensitiveFinancials: settingsRow.show_sensitive_financials === true,
      ...(settingsRow.extra || {}),
    },
    importBatches: batchRes.rows.map((row) => ({
      id: row.id,
      fileName: row.file_name || '',
      savedAt: row.imported_at,
      dates: Array.isArray(row.pay_dates) ? row.pay_dates : [],
      entryCount: Number(row.row_count || 0),
      totalHours: num(row.total_hours, 0),
      totalPayout: num(row.batch_meta?.totalPayout, 0),
      weekStart: text(row.batch_meta?.weekStart || ''),
    })),
    laborEntries: laborRes.rows.map((row) => ({
      ...(row.raw || {}),
      id: row.id,
      importBatchId: row.import_batch_id || '',
      employeeName: row.employee_name,
      date: row.entry_date,
      weekStart: row.week_start || '',
      homeDepartment: row.home_department || '',
      workedDepartment: row.worked_department || '',
      regularHours: num(row.regular_hours, 0),
      ptoHours: num(row.pto_hours, 0),
      otHours: num(row.ot_hours, 0),
      hourlyRate: row.hourly_rate == null ? '' : num(row.hourly_rate, 0),
      payout: row.payout == null ? '' : num(row.payout, 0),
      ptoPayout: row.pto_payout == null ? '' : num(row.pto_payout, 0),
      sourceKind: row.source || (row.import_batch_id ? 'adp' : 'manual'),
      codes: Array.isArray(row.pay_codes) ? row.pay_codes : [],
    })),
    dailyRecords: dailyRes.rows.map((row) => ({
      ...(row.raw || {}),
      id: row.id,
      date: row.record_date,
      totalTouchedUnits: num(row.total_touched_units, 0),
      totalHoursUsed: num(row.total_hours_used, 0),
      totalPtoHours: num(row.total_pto_hours, 0),
      totalUsedDollars: num(row.total_used_dollars, 0),
      totalPtoDollars: num(row.total_pto_dollars, 0),
      cpuTouched: num(row.cpu_touched, 0),
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
      const settings = body && typeof body.settings === 'object' && body.settings ? body.settings : {};
      const dailyRecords = Array.isArray(body.dailyRecords) ? body.dailyRecords : [];
      const laborEntries = Array.isArray(body.laborEntries) ? body.laborEntries : [];
      const importBatches = Array.isArray(body.importBatches) ? body.importBatches : [];

      await pool.query('BEGIN');

      await pool.query(
        `INSERT INTO productivity_settings
         (workspace_id, qa_rate, prep_rate, assembly_rate, putaway_rate, shipping_rate, inventory_rate, ot_multiplier, show_sensitive_financials, extra)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
         ON CONFLICT (workspace_id)
         DO UPDATE SET qa_rate = EXCLUDED.qa_rate,
                       prep_rate = EXCLUDED.prep_rate,
                       assembly_rate = EXCLUDED.assembly_rate,
                       putaway_rate = EXCLUDED.putaway_rate,
                       shipping_rate = EXCLUDED.shipping_rate,
                       inventory_rate = EXCLUDED.inventory_rate,
                       ot_multiplier = EXCLUDED.ot_multiplier,
                       show_sensitive_financials = EXCLUDED.show_sensitive_financials,
                       extra = EXCLUDED.extra,
                       updated_at = now();`,
        [
          WORKSPACE_ID,
          num(settings.qaRate, 20),
          num(settings.prepRate, 20),
          num(settings.assemblyRate, 20),
          num(settings.putawayRate, 20),
          num(settings.shippingRate, 20),
          num(settings.inventoryRate, 20),
          num(settings.otMultiplier, 1.5),
          settings.showSensitiveFinancials === true,
          JSON.stringify({})
        ]
      );

      await pool.query(`DELETE FROM productivity_labor_entries WHERE workspace_id = $1;`, [WORKSPACE_ID]);
      await pool.query(`DELETE FROM productivity_import_batches WHERE workspace_id = $1;`, [WORKSPACE_ID]);
      await pool.query(`DELETE FROM productivity_daily_records WHERE workspace_id = $1;`, [WORKSPACE_ID]);

      for (const batch of importBatches) {
        await pool.query(
          `INSERT INTO productivity_import_batches
           (id, workspace_id, batch_type, file_name, imported_at, pay_dates, row_count, total_hours, batch_meta)
           VALUES (CASE WHEN $1 ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN $1::uuid ELSE gen_random_uuid() END, $2, 'adp_csv', $3, COALESCE(NULLIF($4,'')::timestamptz, now()), $5::jsonb, $6, $7, $8::jsonb);`,
          [
            text(batch.id),
            WORKSPACE_ID,
            text(batch.fileName),
            text(batch.savedAt),
            JSON.stringify(Array.isArray(batch.dates) ? batch.dates : []),
            Number(batch.entryCount || 0),
            num(batch.totalHours, 0),
            JSON.stringify({ totalPayout: num(batch.totalPayout, 0), weekStart: text(batch.weekStart) })
          ]
        );
      }

      for (const entry of laborEntries) {
        await pool.query(
          `INSERT INTO productivity_labor_entries
           (id, workspace_id, import_batch_id, employee_name, entry_date, week_start, home_department, worked_department,
            regular_hours, pto_hours, ot_hours, hourly_rate, payout, pto_payout, source, pay_codes, raw)
           VALUES (
            CASE WHEN $1 ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN $1::uuid ELSE gen_random_uuid() END,
            $2,
            NULLIF($3,'')::uuid,
            $4,
            $5,
            NULLIF($6,'')::date,
            NULLIF($7,''),
            NULLIF($8,''),
            $9,
            $10,
            $11,
            $12,
            $13,
            $14,
            $15,
            $16::jsonb,
            $17::jsonb
           );`,
          [
            text(entry.id),
            WORKSPACE_ID,
            text(entry.importBatchId),
            text(entry.employeeName),
            isoDate(entry.date),
            isoDate(entry.weekStart),
            text(entry.homeDepartment),
            text(entry.workedDepartment),
            num(entry.regularHours, 0),
            num(entry.ptoHours, 0),
            num(entry.otHours, 0),
            entry.hourlyRate === '' || entry.hourlyRate == null ? null : num(entry.hourlyRate, 0),
            entry.payout === '' || entry.payout == null ? null : num(entry.payout, 0),
            entry.ptoPayout === '' || entry.ptoPayout == null ? null : num(entry.ptoPayout, 0),
            text(entry.sourceKind || 'manual'),
            JSON.stringify(Array.isArray(entry.codes) ? entry.codes : []),
            JSON.stringify(entry)
          ]
        );
      }

      for (const record of dailyRecords) {
        await pool.query(
          `INSERT INTO productivity_daily_records
           (id, workspace_id, record_date, total_touched_units, total_hours_used, total_pto_hours, total_used_dollars, total_pto_dollars, cpu_touched, raw)
           VALUES (
             CASE WHEN $1 ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN $1::uuid ELSE gen_random_uuid() END,
             $2,
             $3,
             $4,
             $5,
             $6,
             $7,
             $8,
             $9,
             $10::jsonb
           );`,
          [
            text(record.id),
            WORKSPACE_ID,
            isoDate(record.date),
            Math.round(num(record.totalTouchedUnits, 0)),
            num(record.totalHoursUsed, 0),
            num(record.totalPtoHours, 0),
            num(record.totalUsedDollars, 0),
            num(record.totalPtoDollars, 0),
            num(record.cpuTouched, 0),
            JSON.stringify(record)
          ]
        );
      }

      await pool.query('COMMIT');
      return json(200, { ok: true, ...(await readAll()) });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (error) {
    try { await pool.query('ROLLBACK'); } catch {}
    return json(500, { error: error.message || 'Unknown productivity sync error' });
  }
};
