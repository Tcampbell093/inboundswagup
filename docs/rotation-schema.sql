-- =====================================================================
--  rotation-schema.sql — Rotation module schema (phase 1)
-- ---------------------------------------------------------------------
--  Standalone copy of the DDL in netlify/functions/_rotation-schema.js,
--  for applying to / verifying against Neon directly:
--
--      psql "$DATABASE_URL" -f docs/rotation-schema.sql
--
--  Running it is optional — every rotation-* function auto-creates this
--  schema on first call via ensureRotationSchema(). Idempotent: safe to
--  re-run. Keep this file and _rotation-schema.js in sync.
--
--  Deviation from the build spec: employee_id / assigned_by / closed_by
--  are TEXT, not INT. Employee ids in this codebase are strings (the
--  employees roster in employees_sync_state uses string ids) and callers
--  are identified by hc_users email.
-- =====================================================================

-- Task types, so v2 can add more without a migration
CREATE TABLE IF NOT EXISTS hc_rotation_tasks (
  id              SERIAL PRIMARY KEY,
  code            TEXT UNIQUE NOT NULL,   -- 'garbage' | 'labor_share'
  label_en        TEXT NOT NULL,
  label_es        TEXT NOT NULL,
  unit            TEXT NOT NULL,          -- 'count' | 'hours'
  active          BOOLEAN DEFAULT TRUE
);

-- Garbage and any future count-based duty
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

-- Labor share + project time: any block of time out of home department
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

CREATE INDEX IF NOT EXISTS idx_blocks_open ON hc_assignment_blocks (service_date)
  WHERE actual_end IS NULL;
CREATE INDEX IF NOT EXISTS idx_blocks_emp ON hc_assignment_blocks (employee_id, service_date);
CREATE INDEX IF NOT EXISTS idx_turns_emp ON hc_rotation_turns (employee_id, service_date);

-- Seed the two v1 task rows (idempotent; does not overwrite edited labels)
INSERT INTO hc_rotation_tasks (code, label_en, label_es, unit) VALUES
  ('garbage',     'Garbage Duty', 'Turno de basura',      'count'),
  ('labor_share', 'Labor Share',  'Préstamo de personal', 'hours')
ON CONFLICT (code) DO NOTHING;
