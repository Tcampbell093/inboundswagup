/* =========================================================
   temp-admin-check.js — Houston Control
   Scheduled function: runs daily at 8am UTC
   Checks for expired temp admin grants, revokes them,
   sends email via Resend, and logs to audit table.
   ========================================================= */

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : undefined,
});

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const ADMIN_EMAIL    = process.env.ADMIN_EMAIL || 'tcampbell@bdainc.com';
const FROM_EMAIL     = 'Houston Control <onboarding@resend.dev>';

// ── Send email via Resend ─────────────────────────────────────
async function sendEmail(to, subject, html) {
  if (!RESEND_API_KEY) {
    console.warn('RESEND_API_KEY not set — skipping email');
    return;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('Resend error:', res.status, err);
  } else {
    console.log('Email sent to', to);
  }
}

// ── Write audit entry ─────────────────────────────────────────
async function writeAudit(actor, target, action, detail) {
  try {
    await pool.query(
      `INSERT INTO access_audit (actor, target, action, detail) VALUES ($1,$2,$3,$4)`,
      [actor, target, action, JSON.stringify(detail)]
    );
  } catch(e) { console.error('Audit write failed:', e.message); }
}

// ── Main handler ──────────────────────────────────────────────
exports.handler = async function(event) {
  console.log('HC TempAdmin Check: running at', new Date().toISOString());

  try {
    // Find all users with expired temp admin
    const expired = await pool.query(`
      SELECT id, email, name, temp_admin_expiry
      FROM hc_users
      WHERE temp_admin = true
        AND temp_admin_expiry IS NOT NULL
        AND temp_admin_expiry < NOW()
    `);

    if (expired.rows.length === 0) {
      console.log('HC TempAdmin Check: no expired grants found');
      return { statusCode: 200, body: 'No expired temp admins' };
    }

    console.log(`HC TempAdmin Check: found ${expired.rows.length} expired grant(s)`);

    const expiredNames = [];

    for (const user of expired.rows) {
      // Revoke temp admin
      await pool.query(
        `UPDATE hc_users
         SET temp_admin=false, temp_admin_expiry=null, updated_at=now()
         WHERE email=$1`,
        [user.email]
      );

      // Write audit entry
      await writeAudit(
        'system',
        user.email,
        'temp_admin_expire',
        { expiredAt: user.temp_admin_expiry, revokedAt: new Date().toISOString() }
      );

      // Set in-app notification flag
      await pool.query(
        `INSERT INTO hc_notifications (type, target_email, message, read, created_at)
         VALUES ('temp_admin_expired', $1, $2, false, now())
         ON CONFLICT DO NOTHING`,
        [
          ADMIN_EMAIL,
          `Temp admin access for ${user.name || user.email} has expired and been revoked.`
        ]
      ).catch(() => {}); // Table may not exist yet, will be created below

      expiredNames.push(user.name || user.email);
      console.log('HC TempAdmin Check: revoked temp admin for', user.email);
    }

    // Ensure notifications table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hc_notifications (
        id         SERIAL PRIMARY KEY,
        type       TEXT,
        target_email TEXT,
        message    TEXT,
        read       BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `);

    // Re-insert notifications now that table exists
    for (const user of expired.rows) {
      await pool.query(
        `INSERT INTO hc_notifications (type, target_email, message, read, created_at)
         VALUES ('temp_admin_expired', $1, $2, false, now())`,
        [
          ADMIN_EMAIL,
          `Temp admin access for ${user.name || user.email} has expired and been revoked.`
        ]
      );
    }

    // Send email summary
    const listHtml = expiredNames.map(n => `<li>${n}</li>`).join('');
    await sendEmail(
      ADMIN_EMAIL,
      `Houston Control — Temp Admin Access Expired`,
      `
        <div style="font-family:Inter,sans-serif;max-width:500px;margin:0 auto;">
          <h2 style="color:#0f2444;">Houston Control</h2>
          <p>The following temp admin grant(s) have expired and been automatically revoked:</p>
          <ul style="padding-left:20px;line-height:1.8;">${listHtml}</ul>
          <p>You can review access changes in the <strong>Settings → Audit Log</strong> section of Houston Control.</p>
          <p style="color:#888;font-size:12px;margin-top:24px;">This is an automated message from Houston Control.</p>
        </div>
      `
    );

    return {
      statusCode: 200,
      body: `Revoked ${expired.rows.length} expired temp admin grant(s)`,
    };

  } catch(e) {
    console.error('HC TempAdmin Check error:', e.message);
    return { statusCode: 500, body: e.message };
  }
};
