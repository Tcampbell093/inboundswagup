/* =========================================================================
   _rotation-schema.js — shared schema for the Rotation module.

   Creates the three hc_rotation_* / hc_assignment_blocks tables and seeds
   the two v1 task rows. Every rotation-* function calls
   ensureRotationSchema(pool) before touching the tables, mirroring the
   ensureSchema() pattern used by the other sync functions, so the module
   works on a fresh database with no manual migration step.

   docs/rotation-schema.sql is the same DDL as a standalone file for
   applying/verifying against Neon directly — keep the two in sync.

   Deviation from the build spec: employee_id / assigned_by / closed_by are
   TEXT, not INT. Employee ids in this codebase are strings (the employees
   roster in employees_sync_state uses string ids) and function callers are
   identified by hc_users email, so INT columns could never hold real values.
   ========================================================================= */

let schemaReady = false;

async function ensureRotationSchema(pool) {
  if (schemaReady) return;

  // Task types, so v2 can add more without a migration.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hc_rotation_tasks (
      id              SERIAL PRIMARY KEY,
      code            TEXT UNIQUE NOT NULL,   -- 'garbage' | 'labor_share'
      label_en        TEXT NOT NULL,
      label_es        TEXT NOT NULL,
      unit            TEXT NOT NULL,          -- 'count' | 'hours'
      active          BOOLEAN DEFAULT TRUE
    );
  `);

  // Garbage and any future count-based duty.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hc_rotation_turns (
      id              SERIAL PRIMARY KEY,
      task_code       TEXT NOT NULL REFERENCES hc_rotation_tasks(code),
      employee_id     TEXT NOT NULL,
      department      TEXT NOT NULL,          -- snapshot at assignment time
      service_date    DATE NOT NULL,
      status          TEXT NOT NULL,          -- 'assigned' | 'completed' | 'skipped'
      skip_reason     TEXT,
      off_ranking     BOOLEAN DEFAULT FALSE,  -- TRUE if picked outside top 3
      off_ranking_reason TEXT,
      assigned_by     TEXT NOT NULL,          -- hc_users email
      created_at      TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // Labor share + project time: any block of time out of home department.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hc_assignment_blocks (
      id              SERIAL PRIMARY KEY,
      block_type      TEXT NOT NULL,          -- 'loan' | 'project'
      employee_id     TEXT NOT NULL,
      home_department TEXT NOT NULL,          -- snapshot
      to_department   TEXT,                   -- for loans
      project_name    TEXT,                   -- for projects
      service_date    DATE NOT NULL,
      planned_start   TIMESTAMPTZ,            -- set the day before
      actual_start    TIMESTAMPTZ,
      actual_end      TIMESTAMPTZ,
      auto_closed     BOOLEAN DEFAULT FALSE,  -- TRUE if closed by the shift-end job
      outcome         TEXT,                   -- 'returned' | 'project'
      parent_block_id INT REFERENCES hc_assignment_blocks(id),  -- chains project to its loan
      off_ranking     BOOLEAN DEFAULT FALSE,
      off_ranking_reason TEXT,
      assigned_by     TEXT NOT NULL,          -- hc_users email
      closed_by       TEXT,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_blocks_open ON hc_assignment_blocks (service_date)
      WHERE actual_end IS NULL;
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_blocks_emp ON hc_assignment_blocks (employee_id, service_date);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_turns_emp ON hc_rotation_turns (employee_id, service_date);
  `);

  // Seed the two v1 task rows. Idempotent, and deliberately does not
  // overwrite labels so they can be edited in the DB without being reverted.
  await pool.query(`
    INSERT INTO hc_rotation_tasks (code, label_en, label_es, unit) VALUES
      ('garbage',     'Garbage Duty', 'Turno de basura',      'count'),
      ('labor_share', 'Labor Share',  'Préstamo de personal', 'hours')
    ON CONFLICT (code) DO NOTHING;
  `);

  schemaReady = true;
}

module.exports = { ensureRotationSchema };
