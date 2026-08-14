/* =========================================================================
   rotation-people.js — the person registry behind rotation history.

   GET  -> every person with their known roster names (aliases), active
           flag, and merge pointer. Any invited user may read (same
           visibility stance as rotation-ranking).
   POST {action:'merge', from_person_id, to_person_id}
        -> folds one person's aliases and history into another. This is the
           rename repair: when a roster rename makes an existing associate
           show up as a brand-new person, merging reunites their history.
           Admin/manager only — it rewrites history rows.
   ========================================================================= */

const { Pool } = require('pg');
const { ensureRotationSchema } = require('./_rotation-schema');
const { mergePeople, listPeople } = require('./_rotation-people');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : undefined,
});

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

exports.handler = async function handler(event) {
  const roles = event.httpMethod === 'POST' ? ['admin', 'manager'] : null;
  const _a = await require('./_auth').authorize(event, roles);
  if (!_a.ok) return json(_a.code, _a.body);
  if (!process.env.DATABASE_URL) return json(500, { error: 'DATABASE_URL is not configured' });

  try {
    await ensureRotationSchema(pool);

    if (event.httpMethod === 'GET') {
      return json(200, { ok: true, people: await listPeople(pool) });
    }

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      if (body.action !== 'merge') return json(400, { error: "Unknown action — expected 'merge'" });
      let moved;
      try {
        moved = await mergePeople(pool, body.from_person_id, body.to_person_id);
      } catch (e) {
        return json(400, { error: e.message });
      }
      return json(200, { ok: true, moved });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (error) {
    return json(500, { error: error.message || 'Unknown rotation people error' });
  }
};
