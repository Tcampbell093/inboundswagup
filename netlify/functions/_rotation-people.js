/* =========================================================================
   _rotation-people.js — person identity for the Rotation module.

   Rotation history keys to hc_rotation_people.id, never to roster names or
   roster ids (roster ids are stripped to "" by the app's sync — see
   _rotation-schema.js header). This module is the only place that touches
   the people/aliases tables:

     resolvePersonId(pool, name)  — roster name -> stable person id,
         creating a person for an unseen name. Every write endpoint
         (phase 3+) must go through this before inserting history.
     mergePeople(pool, fromId, toId) — fold one person's aliases AND
         history into another, for renames ("Ana" re-rostered as
         "Ana Maria" gets a second person until someone merges them).
     listPeople(pool) — people with their known names, for the admin UI.
   ========================================================================= */

function nameKey(name) {
  return String(name || '').trim().toLowerCase();
}

// Roster name -> person id. Creation is race-safe without locks: the alias
// PRIMARY KEY arbitrates. We insert a person + alias in a transaction; if
// the alias insert hits a conflict some concurrent writer won the name, so
// we roll back our person row and adopt theirs.
async function resolvePersonId(pool, name, { create = true } = {}) {
  const display = String(name || '').trim();
  const key = nameKey(display);
  if (!key) return null;

  const sel = await pool.query(
    `SELECT person_id FROM hc_rotation_person_aliases WHERE name_key=$1;`, [key]
  );
  if (sel.rows.length) return sel.rows[0].person_id;
  if (!create) return null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const p = await client.query(
      `INSERT INTO hc_rotation_people (display_name) VALUES ($1) RETURNING id;`, [display]
    );
    const a = await client.query(
      `INSERT INTO hc_rotation_person_aliases (name_key, display_name, person_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (name_key) DO NOTHING
       RETURNING person_id;`,
      [key, display, p.rows[0].id]
    );
    if (a.rows.length) {
      await client.query('COMMIT');
      return p.rows[0].id;
    }
    await client.query('ROLLBACK'); // lost the race — discard our person row
    const again = await pool.query(
      `SELECT person_id FROM hc_rotation_person_aliases WHERE name_key=$1;`, [key]
    );
    return again.rows.length ? again.rows[0].person_id : null;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw e;
  } finally {
    client.release();
  }
}

// Fold `fromId` into `toId`: aliases and all history rows move to the
// target, then the source is deactivated with merged_into set (kept, not
// deleted, so old references stay explainable). Returns moved-row counts.
// Throws with a plain message on bad input — callers surface it as a 400.
async function mergePeople(pool, fromId, toId) {
  const from = parseInt(fromId, 10);
  const to = parseInt(toId, 10);
  if (!Number.isInteger(from) || !Number.isInteger(to)) throw new Error('from_person_id and to_person_id must be integers');
  if (from === to) throw new Error('Cannot merge a person into themselves');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const rows = (await client.query(
      `SELECT id, merged_into FROM hc_rotation_people WHERE id = ANY($1::int[]) FOR UPDATE;`,
      [[from, to]]
    )).rows;
    const fromRow = rows.find((r) => r.id === from);
    const toRow = rows.find((r) => r.id === to);
    if (!fromRow) throw new Error(`Person ${from} not found`);
    if (!toRow) throw new Error(`Person ${to} not found`);
    if (fromRow.merged_into) throw new Error(`Person ${from} was already merged into ${fromRow.merged_into}`);
    if (toRow.merged_into) throw new Error(`Person ${to} was merged into ${toRow.merged_into} — merge into that person instead`);

    const aliases = await client.query(
      `UPDATE hc_rotation_person_aliases SET person_id=$1 WHERE person_id=$2;`, [to, from]
    );
    const turns = await client.query(
      `UPDATE hc_rotation_turns SET person_id=$1 WHERE person_id=$2;`, [to, from]
    );
    const blocks = await client.query(
      `UPDATE hc_assignment_blocks SET person_id=$1 WHERE person_id=$2;`, [to, from]
    );
    await client.query(
      `UPDATE hc_rotation_people SET merged_into=$1, active=FALSE WHERE id=$2;`, [to, from]
    );
    await client.query('COMMIT');
    return { aliases: aliases.rowCount, turns: turns.rowCount, blocks: blocks.rowCount };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw e;
  } finally {
    client.release();
  }
}

// People with their known names, merged people included (flagged) so an
// admin can see where a merge pointed.
async function listPeople(pool) {
  const r = await pool.query(
    `SELECT p.id, p.display_name, p.active, p.merged_into, p.created_at,
            COALESCE(json_agg(a.display_name ORDER BY a.created_at)
              FILTER (WHERE a.name_key IS NOT NULL), '[]'::json) AS names
       FROM hc_rotation_people p
       LEFT JOIN hc_rotation_person_aliases a ON a.person_id = p.id
      GROUP BY p.id
      ORDER BY p.display_name, p.id;`
  );
  return r.rows;
}

module.exports = { resolvePersonId, mergePeople, listPeople, nameKey };
