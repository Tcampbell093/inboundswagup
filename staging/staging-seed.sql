-- =====================================================================
--  staging-seed.sql — SYNTHETIC test data for the Houston Control STAGING DB
-- ---------------------------------------------------------------------
--  ⚠️  DO NOT RUN AGAINST PRODUCTION. Contains ONLY fabricated data.
--  ⚠️  This file must never receive a copy of real production rows.
--
--  Purpose: seed a fresh, EMPTY Neon staging database with just enough
--  fake data to exercise every role path (see staging/RUNBOOK.md).
--
--  SAFETY GUARD (below) refuses to run unless you first opt in by creating
--  a marker table in the STAGING database:
--
--      CREATE TABLE __staging_confirmed ();
--
--  Do that ONLY on staging, then run this file. Never create that marker
--  on production.
--
--  BEFORE RUNNING: replace the placeholder *@example.com emails with the
--  real Google accounts you will sign in with (emails must match, lowercase),
--  because login is Google OAuth via Netlify Identity.
-- =====================================================================

-- ---- Safety guard: abort unless explicitly confirmed as staging ----
DO $$
BEGIN
  IF to_regclass('public.__staging_confirmed') IS NULL THEN
    RAISE EXCEPTION
      'Refusing to seed: create table __staging_confirmed() first to confirm this is STAGING (see header).';
  END IF;
END $$;

-- ---- Schemas (match the app''s lazy CREATE TABLE definitions) -------
-- hc_users is NOT auto-created by any function, so we define it here.
CREATE TABLE IF NOT EXISTS hc_users (
  id                TEXT PRIMARY KEY,
  email             TEXT NOT NULL,
  name              TEXT,
  role              TEXT NOT NULL DEFAULT 'l1',
  overrides         JSONB NOT NULL DEFAULT '{}'::jsonb,
  temp_admin        BOOLEAN NOT NULL DEFAULT false,
  temp_admin_expiry TIMESTAMPTZ,
  suspended         BOOLEAN NOT NULL DEFAULT false,
  invited           BOOLEAN NOT NULL DEFAULT true,
  last_login        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS employees_sync_state (
  state_key      TEXT PRIMARY KEY,
  employees_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS attendance_sync_state (
  state_key    TEXT PRIMARY KEY,
  records_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  moves_json   JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workflow_sync_state (
  state_key      TEXT PRIMARY KEY,
  data_json      JSONB NOT NULL DEFAULT '{}'::jsonb,
  masters_json   JSONB NOT NULL DEFAULT '{}'::jsonb,
  active_editors JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pallet_events (
  id           TEXT PRIMARY KEY,
  pallet_id    TEXT NOT NULL,
  pallet_label TEXT,
  event_type   TEXT NOT NULL,
  detail       TEXT,
  po_num       TEXT,
  by_user      TEXT,
  event_ts     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---- Test users: one per role + temp-admin (active/expired) + edge cases ----
-- id = email (matches the app''s invite path). Replace *@example.com below.
INSERT INTO hc_users (id, email, name, role, temp_admin, temp_admin_expiry, suspended, invited) VALUES
  ('admin@example.com',        'admin@example.com',        'Test Admin',        'admin',    false, NULL,                       false, true),
  ('manager@example.com',      'manager@example.com',      'Test Manager',      'manager',  false, NULL,                       false, true),
  ('l2@example.com',           'l2@example.com',           'Test Associate L2', 'l2',       false, NULL,                       false, true),
  ('l1@example.com',           'l1@example.com',           'Test Associate L1', 'l1',       false, NULL,                       false, true),
  ('external@example.com',     'external@example.com',     'Test External',     'external', false, NULL,                       false, true),
  ('tempactive@example.com',   'tempactive@example.com',   'Temp Admin Active', 'l1',       true,  now() + interval '30 days', false, true),
  ('tempexpired@example.com',  'tempexpired@example.com',  'Temp Admin Expired','l1',       true,  now() - interval '2 days',  false, true),
  ('suspended@example.com',    'suspended@example.com',    'Suspended User',    'l1',       false, NULL,                       true,  true),
  ('notinvited@example.com',   'notinvited@example.com',   'De-invited User',   'l1',       false, NULL,                       false, false)
ON CONFLICT (id) DO UPDATE SET
  role = EXCLUDED.role, name = EXCLUDED.name, temp_admin = EXCLUDED.temp_admin,
  temp_admin_expiry = EXCLUDED.temp_admin_expiry, suspended = EXCLUDED.suspended,
  invited = EXCLUDED.invited, updated_at = now();

-- ---- Synthetic employees (fake names; DUMMY birthday + hourly rate) ----
INSERT INTO employees_sync_state (state_key, employees_json, updated_at)
VALUES ('default', $json$[
  {"id":"emp-001","name":"Ada Testerson","adpName":"","department":"Receiving","birthday":"2000-01-01","size":"L","active":true,"hourlyRate":1.00},
  {"id":"emp-002","name":"Ben Sampleman","adpName":"","department":"Assembly","birthday":"2000-02-02","size":"M","active":true,"hourlyRate":1.00},
  {"id":"emp-003","name":"Cara Mockford","adpName":"","department":"Fulfillment","birthday":"2000-03-03","size":"S","active":true,"hourlyRate":1.00},
  {"id":"emp-004","name":"Dan Placeholder","adpName":"","department":"Receiving","birthday":"2000-04-04","size":"XL","active":true,"hourlyRate":1.00},
  {"id":"emp-005","name":"Evie Fixture","adpName":"","department":"Cycle Count","birthday":"2000-05-05","size":"M","active":false,"hourlyRate":1.00}
]$json$::jsonb, NOW())
ON CONFLICT (state_key) DO UPDATE SET employees_json = EXCLUDED.employees_json, updated_at = NOW();

-- ---- Minimal synthetic attendance ----
INSERT INTO attendance_sync_state (state_key, records_json, moves_json, updated_at)
VALUES ('default', $json$[
  {"id":"att-001","employeeName":"Ada Testerson","department":"Receiving","date":"2026-07-20","mark":"Present","demerits":0},
  {"id":"att-002","employeeName":"Ben Sampleman","department":"Assembly","date":"2026-07-20","mark":"Late","demerits":1}
]$json$::jsonb, '[]'::jsonb, NOW())
ON CONFLICT (state_key) DO UPDATE SET records_json = EXCLUDED.records_json, updated_at = NOW();

-- ---- Minimal synthetic workflow/PO data (for po-lookup) ----
INSERT INTO workflow_sync_state (state_key, data_json, masters_json, active_editors)
VALUES ('default', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb)
ON CONFLICT (state_key) DO NOTHING;

INSERT INTO pallet_events (id, pallet_id, pallet_label, event_type, detail, po_num, by_user, event_ts) VALUES
  ('evt-001','plt-001','PLT-001','po_added',      'Synthetic PO added',   'PO-TEST-001','Ada Testerson', now() - interval '2 hours'),
  ('evt-002','plt-001','PLT-001','po_recv_done',  'Synthetic receive',    'PO-TEST-001','Ben Sampleman', now() - interval '1 hour')
ON CONFLICT (id) DO NOTHING;

-- ---- Confirm ----
SELECT 'hc_users' AS table, count(*) AS rows FROM hc_users
UNION ALL SELECT 'employees_sync_state', count(*) FROM employees_sync_state
UNION ALL SELECT 'attendance_sync_state', count(*) FROM attendance_sync_state
UNION ALL SELECT 'pallet_events', count(*) FROM pallet_events;
