/* =========================================================================
   _rotation-schema.js — shared schema for the Rotation module.

   Creates the rotation tables and seeds the two v1 task rows. Every
   rotation-* function calls ensureRotationSchema(pool) before touching the
   tables, mirroring the ensureSchema() pattern used by the other sync
   functions, so the module works on a fresh database with no manual
   migration step.

   docs/rotation-schema.sql is the same DDL as a standalone file for
   applying/verifying against Neon directly — keep the two in sync.

   Identity model: rotation history is keyed by hc_rotation_people.id, a
   stable generated id — NOT by the roster's employee id or name. Roster ids
   don't survive a sync (script.js normalizeEmployees() strips `id`, so
   employees_sync_state stores id:"" for everyone) and names change on
   rename, which would silently detach history. Roster names are resolved
   to a person via hc_rotation_person_aliases on write, creating a person
   for unseen names; renames are handled by merging people (see
   _rotation-people.js). History rows also snapshot the name as written at
   assignment time (employee_name), like the department snapshot.
   ========================================================================= */

let schemaReady = false;

// The first cut of this branch keyed history by roster name (employee_id
// TEXT). No write endpoint ever shipped for that shape, so any table still
// carrying it must be empty — recreate it. Refuse if rows exist, so a
// manually seeded database is never silently destroyed.
async function dropLegacyIfEmpty(pool, table) {
  const col = await pool.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1 AND column_name='employee_id';`,
    [table]
  );
  if (!col.rows.length) return;
  const cnt = await pool.query(`SELECT COUNT(*)::int AS n FROM ${table};`);
  if (cnt.rows[0].n > 0) {
    throw new Error(
      `${table} still has the pre-person employee_id shape and contains rows — migrate it manually before deploying this version`
    );
  }
  await pool.query(`DROP TABLE ${table};`);
}

async function ensureRotationSchema(pool) {
  if (schemaReady) return;

  await dropLegacyIfEmpty(pool, 'hc_assignment_blocks');
  await dropLegacyIfEmpty(pool, 'hc_rotation_turns');

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

  // One row per human being. The id is the stable key all history hangs
  // off; the roster only contributes names, which arrive as aliases.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hc_rotation_people (
      id              SERIAL PRIMARY KEY,
      display_name    TEXT NOT NULL,          -- preferred spelling (latest seen)
      active          BOOLEAN DEFAULT TRUE,
      merged_into     INT REFERENCES hc_rotation_people(id),  -- set when folded into another person
      created_at      TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // Every roster spelling ever seen, each owned by exactly one person
  // (PRIMARY KEY on the lowercased name enforces one-person-per-name at
  // the database, so concurrent writers can't split a person in two).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hc_rotation_person_aliases (
      name_key        TEXT PRIMARY KEY,       -- lowercased, trimmed roster name
      display_name    TEXT NOT NULL,          -- as written on the roster
      person_id       INT NOT NULL REFERENCES hc_rotation_people(id),
      created_at      TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_aliases_person ON hc_rotation_person_aliases (person_id);
  `);

  // Garbage and any future count-based duty.
  await pool.query(`
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
  `);

  // Labor share + project time: any block of time out of home department.
  await pool.query(`
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
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_blocks_open ON hc_assignment_blocks (service_date)
      WHERE actual_end IS NULL;
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_blocks_person ON hc_assignment_blocks (person_id, service_date);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_turns_person ON hc_rotation_turns (person_id, service_date);
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
