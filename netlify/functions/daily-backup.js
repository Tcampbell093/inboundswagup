/* =========================================================================
   daily-backup.js — Nightly full-database export, emailed as a zip.

   PURPOSE
   -------
   An independent, off-system copy of everything stored in Neon, mailed to the
   owner each day so the data survives even if the site/database is ever lost.
   Each email is a complete, self-contained snapshot (not a delta).

   WHAT IT PRODUCES (one zip attachment)
   -------------------------------------
     full-database.json ...... every table as rows — exact, restorable copy
     <table>.csv ............. one CSV per non-empty table (opens in Excel)
     inbound_workflow.json ... the workflow_sync_state blob, pretty-printed
     attendance.json ......... the attendance_sync_state blob, pretty-printed
     masters.json ............ shared master lists (categories/locations/etc.)
     README.txt .............. explains every file

   SAFETY
   ------
   Read-only against the database. Sends to a fixed BACKUP_EMAIL (env), never
   to the caller. Scheduled nightly via netlify.toml; a manual GET runs it on
   demand (useful to verify the email arrives) and returns a summary only.

   CONFIG (Netlify env vars)
   -------------------------
     RESEND_API_KEY  — already set (used by the app's other emails)
     BACKUP_EMAIL    — where to send (defaults to the address below)
   ========================================================================= */

const { Pool } = require('pg');
const JSZip = require('jszip');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : undefined,
});

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL     = 'Houston Control <onboarding@resend.dev>';
const BACKUP_EMAIL   = process.env.BACKUP_EMAIL || 'thandoyordani@gmail.com';
const ROW_CAP        = 100000; // safety cap per table; data is far smaller

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

function businessDateString(d = new Date()) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: process.env.OPS_METRICS_TZ || 'America/New_York' }).format(d);
  } catch (_) {
    return d.toISOString().slice(0, 10);
  }
}

// Serialize an array of row objects to CSV. Objects/arrays become JSON text in
// the cell; values with commas/quotes/newlines are quoted and escaped.
function toCsv(rows) {
  if (!rows || !rows.length) return '';
  const cols = [];
  const seen = new Set();
  for (const r of rows) for (const k of Object.keys(r)) if (!seen.has(k)) { seen.add(k); cols.push(k); }
  const cell = (v) => {
    if (v == null) return '';
    let s = (typeof v === 'object') ? JSON.stringify(v) : String(v);
    if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  const lines = [cols.join(',')];
  for (const r of rows) lines.push(cols.map(c => cell(r[c])).join(','));
  return lines.join('\r\n');
}

async function listTables() {
  const r = await pool.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name`
  );
  return r.rows.map(x => x.table_name);
}

async function dumpTable(name) {
  // Identifier is sourced from information_schema (not user input); quote it anyway.
  const r = await pool.query(`SELECT * FROM "${name}" LIMIT ${ROW_CAP}`);
  return r.rows;
}

async function buildBackup() {
  const date = businessDateString();
  const tables = await listTables();

  const all = {};         // table -> rows
  const counts = {};      // table -> row count
  for (const t of tables) {
    try {
      const rows = await dumpTable(t);
      all[t] = rows;
      counts[t] = rows.length;
    } catch (e) {
      all[t] = { error: e.message };
      counts[t] = -1;
    }
  }

  const zip = new JSZip();

  // Exact, restorable master copy of everything.
  zip.file('full-database.json', JSON.stringify({ snapshot_date: date, generated_at: new Date().toISOString(), tables: all }, null, 2));

  // Human-readable CSVs for every non-empty table.
  for (const t of tables) {
    const rows = all[t];
    if (Array.isArray(rows) && rows.length) zip.file(`${t}.csv`, toCsv(rows));
  }

  // Pull the big JSON blobs out into readable, standalone files.
  const wf = (all.workflow_sync_state && all.workflow_sync_state[0]) || null;
  if (wf) {
    if (wf.data_json)    zip.file('inbound_workflow.json', JSON.stringify(wf.data_json, null, 2));
    if (wf.masters_json) zip.file('masters.json', JSON.stringify(wf.masters_json, null, 2));
  }
  const att = (all.attendance_sync_state && all.attendance_sync_state[0]) || null;
  if (att) {
    zip.file('attendance.json', JSON.stringify({
      records: att.records_json || [], moves: att.moves_json || [],
    }, null, 2));
  }

  // README
  const populated = tables.filter(t => counts[t] > 0);
  const empty = tables.filter(t => counts[t] === 0);
  zip.file('README.txt',
    `HOUSTON CONTROL — DAILY DATA BACKUP\n` +
    `Snapshot date: ${date}\n` +
    `Generated: ${new Date().toISOString()}\n\n` +
    `This archive is a COMPLETE copy of everything stored on the server as of\n` +
    `this date. It is self-contained — you do not need the site to read it.\n\n` +
    `KEY FILES\n` +
    `  full-database.json ...... every table, exact data (use this to restore)\n` +
    `  <table>.csv ............. one per table with data (open in Excel)\n` +
    `  inbound_workflow.json ... the entire inbound module's live state\n` +
    `  attendance.json ......... attendance marks + department moves\n` +
    `  masters.json ............ shared lists (categories, locations, etc.)\n\n` +
    `TABLES WITH DATA (${populated.length}):\n` +
    populated.map(t => `  ${t} — ${counts[t]} row${counts[t] === 1 ? '' : 's'}`).join('\n') + '\n\n' +
    `EMPTY TABLES (${empty.length}) — areas set up but not yet in use:\n  ` +
    (empty.join(', ') || '(none)') + '\n\n' +
    `If a day ever passes with NO backup email, that is your signal to check on it.\n`
  );

  const b64 = await zip.generateAsync({ type: 'base64' });
  return { date, counts, populated, empty, tables, zipBase64: b64 };
}

function summaryHtml(date, counts) {
  const order = [
    ['workflow_sync_state', 'Inbound workflow (state)'],
    ['pallet_events', 'Pallet activity events'],
    ['sord_snapshots', 'Sales-order pipeline snapshots'],
    ['productivity_daily_records', 'Productivity daily records'],
    ['daily_metrics', 'Captured trend metrics'],
    ['attendance_sync_state', 'Attendance (state)'],
    ['hc_users', 'User accounts'],
    ['access_audit', 'Access audit'],
    ['history_log', 'Edit history'],
  ];
  const rows = order
    .filter(([k]) => counts[k] != null)
    .map(([k, label]) => `<tr><td style="padding:3px 12px 3px 0;">${label}</td><td style="padding:3px 0;text-align:right;"><strong>${counts[k]}</strong></td></tr>`)
    .join('');
  const totalTables = Object.keys(counts).length;
  return `
    <div style="font-family:system-ui,Arial,sans-serif;font-size:14px;color:#1f2d3d;">
      <p>Your complete daily snapshot is attached — a full, self-contained copy of
         everything saved on the server today. Open it any time, even if the site is down.</p>
      <table style="border-collapse:collapse;margin:10px 0;">${rows}</table>
      <p style="color:#64748b;font-size:12px;">Covers all ${totalTables} tables in the database.
         If a day ever passes with no backup email, that's your signal to check on it.</p>
    </div>`;
}

async function sendBackupEmail(date, counts, zipBase64) {
  if (!RESEND_API_KEY) return { sent: false, reason: 'RESEND_API_KEY not set' };
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: BACKUP_EMAIL,
      subject: `📦 Houston Control — Daily Data Backup — ${date}`,
      html: summaryHtml(date, counts),
      attachments: [{ filename: `houston-control-backup-${date}.zip`, content: zipBase64 }],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    return { sent: false, reason: `Resend ${res.status}: ${err}` };
  }
  return { sent: true };
}

exports.handler = async function handler() {
  if (!process.env.DATABASE_URL) return json(500, { error: 'DATABASE_URL is not configured' });
  try {
    const backup = await buildBackup();
    const mail = await sendBackupEmail(backup.date, backup.counts, backup.zipBase64);
    return json(200, {
      ok: true,
      snapshot_date: backup.date,
      tables_total: backup.tables.length,
      tables_with_data: backup.populated.length,
      emailed_to: BACKUP_EMAIL,
      email: mail,
    });
  } catch (error) {
    return json(500, { error: error.message || 'Backup failed' });
  }
};
