-- =====================================================================
--  rotation-schema.sql — Rotation module schema
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
--  Identity model: history keys to hc_rotation_people.id (a stable
--  generated id), never to roster names or roster ids. The app's roster
--  sync strips employee ids to "" (script.js normalizeEmployees omits
--  `id`), and names change on rename — either would silently detach
--  history. Roster names map to people via hc_rotation_person_aliases;
--  see docs/ROTATION_SPEC.md §4 for the full reasoning.
--
--  If a database still carries the earlier name-keyed shape from this
--  branch (an employee_id column on the history tables), ensureSchema
--  recreates those tables when empty and refuses when they hold rows.
--  Manual equivalent: DROP TABLE hc_assignment_blocks, hc_rotation_turns;
--  then re-run this file.
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

-- One row per human being; the stable key all rotation history hangs off
CREATE TABLE IF NOT EXISTS hc_rotation_people (
  id              SERIAL PRIMARY KEY,
  display_name    TEXT NOT NULL,          -- preferred spelling (latest seen)
  active          BOOLEAN DEFAULT TRUE,
  merged_into     INT REFERENCES hc_rotation_people(id),  -- set when folded into another person
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Every roster spelling ever seen, each owned by exactly one person.
-- The PRIMARY KEY on the lowercased name enforces one-person-per-name.
CREATE TABLE IF NOT EXISTS hc_rotation_person_aliases (
  name_key        TEXT PRIMARY KEY,       -- lowercased, trimmed roster name
  display_name    TEXT NOT NULL,          -- as written on the roster
  person_id       INT NOT NULL REFERENCES hc_rotation_people(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_aliases_person ON hc_rotation_person_aliases (person_id);

-- Garbage and any future count-based duty
CREATE TABLE IF NOT EXISTS hc_rotation_turns (
  id              SERIAL PRIMARY KEY,
  task_code       TEXT NOT NULL REFERENCES hc_rotation_tasks(code),
  person_id       INT NOT NULL REFERENCES hc_rotation_people(id),
  employee_name   TEXT NOT NULL,          -- snapshot as written at assignment time
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
  person_id       INT NOT NULL REFERENCES hc_rotation_people(id),
  employee_name   TEXT NOT NULL,          -- snapshot as written at assignment time
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
CREATE INDEX IF NOT EXISTS idx_blocks_person ON hc_assignment_blocks (person_id, service_date);
CREATE INDEX IF NOT EXISTS idx_turns_person ON hc_rotation_turns (person_id, service_date);

-- Seed the two v1 task rows (idempotent; does not overwrite edited labels)
INSERT INTO hc_rotation_tasks (code, label_en, label_es, unit) VALUES
  ('garbage',     'Garbage Duty', 'Turno de basura',      'count'),
  ('labor_share', 'Labor Share',  'Préstamo de personal', 'hours')
ON CONFLICT (code) DO NOTHING;
