'use strict';
// Hub-owned cleaning check-ins. During the FairShift transition FairShift still
// supplies the schedule (assignment IDs, areas, who is assigned), but start and
// finish are recorded here and override whatever status FairShift reports.
let schemaReady = false;

async function ensureSchema(db) {
  if (schemaReady) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS hub_cleaning_checkins (
      assignment_id BIGINT PRIMARY KEY,
      assignment_date DATE NOT NULL,
      area TEXT NOT NULL DEFAULT '',
      employee_key TEXT NOT NULL,
      employee_name TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('in_progress','completed')),
      started_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS hub_cleaning_checkins_date_idx ON hub_cleaning_checkins(assignment_date);
    CREATE INDEX IF NOT EXISTS hub_cleaning_checkins_employee_idx ON hub_cleaning_checkins(employee_key, assignment_date);
  `);
  schemaReady = true;
}

// Map of assignment ID -> check-in row for the given FairShift assignment IDs.
async function checkinsById(db, ids) {
  const list = [...new Set((ids || []).map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))];
  if (!list.length) return new Map();
  await ensureSchema(db);
  const result = await db.query(
    `SELECT assignment_id,status,started_at,finished_at,employee_name
     FROM hub_cleaning_checkins WHERE assignment_id = ANY($1::bigint[])`,
    [list],
  );
  return new Map(result.rows.map((row) => [Number(row.assignment_id), row]));
}

// Same as checkinsById, but never throws: a database hiccup should fall back to
// FairShift's status rather than break the page.
async function checkinsByIdSafe(db, ids) {
  try {
    return await checkinsById(db, ids);
  } catch {
    return new Map();
  }
}

module.exports = { ensureSchema, checkinsById, checkinsByIdSafe };
