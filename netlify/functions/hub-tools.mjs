import pg from 'pg';
import crypto from 'node:crypto';

const { Pool } = pg;
let poolInstance = null;

const PASSWORD_TOOL = {
  id: 'passwords-access',
  title: 'Passwords & Access',
  url: 'https://start.1password.com/signin/team',
  label: 'Password manager',
  description: 'Open 1Password to access saved work logins, autofill credentials, and recover account access.',
  accent: 'green',
  icon: '🔐',
  sortOrder: 15,
};

const SEED_TOOLS = [
  { id: 'fairshift-rotations', title: 'FairShift Rotations', url: 'https://fairshift-rotations.thandoyordani.chatgpt.site/', label: 'Labor planning', description: 'Plan team rotations, cleaning schedules, time off, and fair task assignments.', accent: 'orange', icon: '♙', sortOrder: 10 },
  PASSWORD_TOOL,
  { id: 'houston-control', title: 'Houston Control', url: 'https://inboundswagup.netlify.app/', label: 'Warehouse control', description: 'Run inbound operations, review active work, and keep the production flow moving.', accent: 'green', icon: '▤', sortOrder: 20 },
  { id: 'daily-received', title: 'Daily Received', url: 'https://bdainc4-my.sharepoint.com/:x:/r/personal/tcampbell_bdainc_com/Documents/New%20Daily%20Rec..xlsx?d=wbd4f19ff22fd4f8a8b25e264b42e1b1a&csf=1&web=1&e=qERi2r', label: 'Shared workbook', description: 'Open the shared Excel workbook used for daily receiving updates and recaps.', accent: 'blue', icon: '▧', sortOrder: 30 },
  { id: 'assembly-screen', title: 'Assembly Screen', url: 'https://bdainc4-my.sharepoint.com/:x:/r/personal/jmateo_bdainc_com/_layouts/15/Doc.aspx?action=edit&sourcedoc=%7B2678bff3-263f-4512-bdf5-81a2de97afab%7D&wdExp=TEAMS-TREATMENT&web=1', label: 'Assembly workbook', description: 'Open the shared Assembly screen used by the team for current assembly work.', accent: 'green', icon: '▤', sortOrder: 40 },
  { id: 'daily-returns', title: 'Daily Returns', url: 'https://bdainc4-my.sharepoint.com/:x:/r/personal/cescobar_bdainc_com/_layouts/15/Doc.aspx?sourcedoc=%7B7B48C5B8-6820-490A-814A-5DF46CDD8974%7D&file=Daily%20Returns%202025%20A.M..xlsx&fromShare=true&action=default&mobileredirect=true', label: 'Returns workbook', description: 'Open the shared Returns workbook used for daily return tracking and updates.', accent: 'blue', icon: '▧', sortOrder: 50 },
  { id: 'overstock', title: 'Overstock', url: '/warehouse-hub/overstock.html', label: 'Inbound workflow', description: 'Open Houston directly to the Overstock section of the inbound module.', accent: 'orange', icon: '◫', sortOrder: 60 },
  { id: 'qa-approved', title: 'QA Approved', url: 'https://swagup.lightning.force.com/lightning/r/Report/00OPH000009Ytkr2AC/view?queryScope=userFolders', label: 'Salesforce report', description: 'Open the QA Approved report in Salesforce.', accent: 'green', icon: '▤', sortOrder: 70 },
  { id: 'receiving-report', title: 'Receiving Report', url: 'https://swagup.lightning.force.com/lightning/r/Report/00O6e000008lBIAEA2/view', label: 'Salesforce report', description: 'Open the Receiving report in Salesforce.', accent: 'blue', icon: '▧', sortOrder: 80 },
  { id: 'prepping-report', title: 'Prepping Report', url: 'https://swagup.lightning.force.com/lightning/r/Report/00OPH000001Gu0r2AC/view', label: 'Salesforce report', description: 'Open the Prepping report in Salesforce.', accent: 'orange', icon: '◫', sortOrder: 90 },
  { id: 'ready-packbuilders', title: 'Ready Packbuilders', url: 'https://swagup.lightning.force.com/lightning/o/Pack_Builder__c/list?filterName=Ready_to_Pack', label: 'Salesforce list', description: 'Open the Ready to Pack Pack Builder list in Salesforce.', accent: 'green', icon: '▤', sortOrder: 100 },
  { id: 'pending-packbuilder-pos', title: 'Pending Packbuilder POs', url: 'https://swagup.lightning.force.com/lightning/r/Report/00OQm000003Wuq9MAC/view', label: 'Salesforce report', description: 'Open the Pending Packbuilder POs report in Salesforce.', accent: 'blue', icon: '▧', sortOrder: 110 },
  { id: 'pending-insert-cards', title: 'Pending Insert Cards', url: 'https://swagup.lightning.force.com/lightning/o/Purchase_Order__c/list?filterName=SwagUp_Print', label: 'Salesforce list', description: 'Open the Pending Insert Cards list in Salesforce.', accent: 'orange', icon: '◫', sortOrder: 120 },
  { id: 'completed-insert-cards', title: 'Completed Insert Cards', url: 'https://swagup.lightning.force.com/lightning/r/Report/00ODu000000W9DYMA0/view', label: 'Salesforce report', description: 'Open the Completed Insert Cards report in Salesforce.', accent: 'green', icon: '▤', sortOrder: 130 },
];

function env(name) {
  return globalThis.Netlify?.env?.get(name) || '';
}

function getPool() {
  const connectionString = env('DATABASE_URL');
  if (!connectionString) throw new Error('DATABASE_URL is not configured');
  if (!poolInstance) {
    poolInstance = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  }
  return poolInstance;
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function cleanText(value, max = 500) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function safeEqual(a, b) {
  if (!a || !b) return false;
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function managerAuthorized(request) {
  return safeEqual(request.headers.get('x-hub-key') || '', env('HUB_MANAGER_KEY'));
}

function validateUrl(value) {
  const raw = cleanText(value, 1500);
  if (!raw) return '';
  if (raw.startsWith('/')) return raw;
  try {
    const parsed = new URL(raw);
    return ['http:', 'https:'].includes(parsed.protocol) ? raw : '';
  } catch {
    return '';
  }
}

function hashNumber(value) {
  return [...String(value || '')].reduce((sum, ch) => (sum + ch.charCodeAt(0)) % 997, 0);
}

function inferToolMeta(title, url) {
  const name = cleanText(title, 120) || 'Team Tool';
  const lowerUrl = String(url || '').toLowerCase();
  const accents = ['orange', 'green', 'blue'];
  let meta = {
    label: 'Team tool',
    description: `Open ${name}.`,
    accent: accents[hashNumber(name) % accents.length],
    icon: '◫',
  };

  if (lowerUrl.includes('1password.com')) {
    meta = { ...meta, label: 'Password manager', description: 'Open 1Password to access saved work logins, autofill credentials, and recover account access.', accent: 'green', icon: '🔐' };
  } else if (lowerUrl.includes('lightning.force.com')) {
    if (lowerUrl.includes('/lightning/r/report/')) {
      meta = { ...meta, label: 'Salesforce report', description: `Open the ${name} report in Salesforce.`, icon: '▧' };
    } else {
      meta = { ...meta, label: 'Salesforce list', description: `Open the ${name} list in Salesforce.`, icon: '▤' };
    }
  } else if (lowerUrl.includes('sharepoint.com')) {
    meta = { ...meta, label: 'Shared workbook', description: `Open the shared ${name} workbook.`, accent: 'blue', icon: '▧' };
  } else if (lowerUrl.includes('fairshift-rotations')) {
    meta = { ...meta, label: 'Labor planning', description: 'Plan team rotations, cleaning schedules, time off, and fair task assignments.', accent: 'orange', icon: '♙' };
  } else if (lowerUrl.includes('inboundswagup.netlify.app') || lowerUrl.startsWith('/warehouse-hub/')) {
    if (name.toLowerCase().includes('overstock') || lowerUrl.includes('overstock')) {
      meta = { ...meta, label: 'Inbound workflow', description: `Open Houston directly to the ${name} section of the inbound module.`, accent: 'orange', icon: '◫' };
    } else {
      meta = { ...meta, label: 'Warehouse control', description: `Open ${name} in Houston Control.`, accent: 'green', icon: '▤' };
    }
  }
  return meta;
}

async function insertToolIfMissing(pool, tool) {
  await pool.query(
    `INSERT INTO hub_tool_cards(id,title,url,label,description,accent,icon,sort_order,active,updated_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,TRUE,NOW()) ON CONFLICT(id) DO NOTHING`,
    [tool.id, tool.title, tool.url, tool.label, tool.description, tool.accent, tool.icon, tool.sortOrder],
  );
}

async function ensureSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hub_tool_cards (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      label TEXT NOT NULL,
      description TEXT NOT NULL,
      accent TEXT NOT NULL DEFAULT 'orange',
      icon TEXT NOT NULL DEFAULT '◫',
      sort_order INTEGER NOT NULL DEFAULT 100,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS hub_tool_cards_sort_idx ON hub_tool_cards(sort_order, title);
    CREATE TABLE IF NOT EXISTS hub_tool_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const seeded = await pool.query(`SELECT value FROM hub_tool_meta WHERE key='seeded_v1' LIMIT 1`);
  if (!seeded.rows.length) {
    for (const tool of SEED_TOOLS) await insertToolIfMissing(pool, tool);
    await pool.query(`INSERT INTO hub_tool_meta(key,value,updated_at) VALUES('seeded_v1','1',NOW()) ON CONFLICT(key) DO NOTHING`);
  }

  // One-time additive migration for existing Hubs. The marker remains if a
  // manager later deletes the card, so it will not be recreated automatically.
  const passwordCard = await pool.query(`SELECT value FROM hub_tool_meta WHERE key='passwords_access_v1' LIMIT 1`);
  if (!passwordCard.rows.length) {
    await insertToolIfMissing(pool, PASSWORD_TOOL);
    await pool.query(`INSERT INTO hub_tool_meta(key,value,updated_at) VALUES('passwords_access_v1','1',NOW()) ON CONFLICT(key) DO NOTHING`);
  }
}

function serializeTool(row) {
  return {
    id: row.id,
    title: row.title,
    url: row.url,
    label: row.label,
    description: row.description,
    accent: ['orange', 'green', 'blue'].includes(row.accent) ? row.accent : 'orange',
    icon: row.icon || '◫',
    sortOrder: Number(row.sort_order || 0),
    active: row.active !== false,
    updatedAt: row.updated_at || null,
  };
}

async function readTools(pool, includeInactive = false) {
  const where = includeInactive ? '' : 'WHERE active=TRUE';
  const result = await pool.query(`SELECT * FROM hub_tool_cards ${where} ORDER BY sort_order ASC, title ASC`);
  return result.rows.map(serializeTool);
}

async function upsertTool(pool, body) {
  const id = cleanText(body.id, 100) || crypto.randomUUID();
  const title = cleanText(body.title, 120);
  const url = validateUrl(body.url);
  if (!title || !url) throw new Error('A card title and valid URL are required.');

  const inferred = inferToolMeta(title, url);
  const existing = await pool.query(`SELECT * FROM hub_tool_cards WHERE id=$1 LIMIT 1`, [id]);
  const old = existing.rows[0] || null;
  const label = cleanText(body.label, 80) || inferred.label;
  const description = cleanText(body.description, 500) || inferred.description;
  const accent = ['orange', 'green', 'blue'].includes(body.accent) ? body.accent : inferred.accent;
  const icon = cleanText(body.icon, 8) || (old?.icon || inferred.icon);
  const active = typeof body.active === 'boolean' ? body.active : (old ? old.active !== false : true);

  let sortOrder = Number(body.sortOrder);
  if (!Number.isFinite(sortOrder) || sortOrder < 0) {
    if (old) sortOrder = Number(old.sort_order || 100);
    else {
      const max = await pool.query(`SELECT COALESCE(MAX(sort_order),0) AS max_sort FROM hub_tool_cards`);
      sortOrder = Number(max.rows[0]?.max_sort || 0) + 10;
    }
  }
  sortOrder = Math.round(sortOrder);

  await pool.query(
    `INSERT INTO hub_tool_cards(id,title,url,label,description,accent,icon,sort_order,active,updated_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
     ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,url=EXCLUDED.url,label=EXCLUDED.label,
       description=EXCLUDED.description,accent=EXCLUDED.accent,icon=EXCLUDED.icon,
       sort_order=EXCLUDED.sort_order,active=EXCLUDED.active,updated_at=NOW()`,
    [id, title, url, label, description, accent, icon, sortOrder, active],
  );

  const saved = await pool.query(`SELECT * FROM hub_tool_cards WHERE id=$1 LIMIT 1`, [id]);
  return serializeTool(saved.rows[0]);
}

export default async (request) => {
  try {
    const pool = getPool();
    await ensureSchema(pool);
    const requestUrl = new URL(request.url);

    if (request.method === 'GET') {
      const admin = requestUrl.searchParams.get('admin') === '1';
      if (admin && !managerAuthorized(request)) return json(401, { error: 'Manager access denied.' });
      return json(200, { tools: await readTools(pool, admin) });
    }

    if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });
    if (!managerAuthorized(request)) return json(401, { error: 'Manager access denied.' });

    const body = await request.json().catch(() => ({}));
    if (body.action === 'upsertTool') {
      return json(200, { ok: true, result: await upsertTool(pool, body) });
    }
    if (body.action === 'deleteTool') {
      const id = cleanText(body.id, 100);
      if (!id) throw new Error('Card id is required.');
      await pool.query(`DELETE FROM hub_tool_cards WHERE id=$1`, [id]);
      return json(200, { ok: true });
    }
    return json(400, { error: 'Unsupported action.' });
  } catch (error) {
    return json(400, { error: cleanText(error?.message || 'Unexpected error.', 300) });
  }
};
