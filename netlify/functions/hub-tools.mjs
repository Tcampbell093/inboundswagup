import pg from 'pg';
import crypto from 'node:crypto';

const { Pool } = pg;
let poolInstance = null;

const PASSWORD_TOOL = {
  id: 'passwords-access',
  title: 'Google Passwords',
  url: 'https://passwords.google.com/',
  label: 'Password manager',
  description: 'View, save, and manage your work logins in Google Password Manager.',
  accent: 'green',
  icon: '🔐',
  sortOrder: 15,
};

const SALESFORCE_HOME_TOOL = {
  id: 'salesforce-home',
  title: 'Salesforce Home',
  url: 'https://swagup.lightning.force.com/lightning/page/home',
  label: 'Salesforce home',
  description: 'Open Salesforce home for apps, records, reports, and everyday work.',
  accent: 'blue',
  icon: '▤',
  sortOrder: 65,
};

const PO_HISTORY_TOOL = {
  id: 'po-history',
  title: 'PO History',
  url: '/po-history/',
  label: 'Receiving records',
  description: 'Search current and archived POs, locations, quantities, dates, and receiving details.',
  accent: 'green',
  icon: '⌕',
  sortOrder: 61,
};

const INVENTORY_CONTROL_TOOL = {
  id: 'warehouse-inventory',
  title: 'Warehouse Inventory',
  url: '/inventory-control/',
  label: 'Supply inventory',
  description: 'Manage the standalone warehouse supply inventory. Changes here stay separate from Houston Control.',
  accent: 'blue',
  icon: '▦',
  sortOrder: 62,
};

const SEED_TOOLS = [
  { id: 'fairshift-rotations', title: 'FairShift Rotations', url: 'https://fairshift-rotations.thandoyordani.chatgpt.site/', label: 'Labor planning', description: 'Plan team rotations, cleaning schedules, time off, and fair task assignments.', accent: 'orange', icon: '♙', sortOrder: 10 },
  PASSWORD_TOOL,
  { id: 'houston-control', title: 'Houston Control', url: 'https://inboundswagup.netlify.app/', label: 'Warehouse control', description: 'Run inbound operations, review active work, and keep the production flow moving.', accent: 'green', icon: '▤', sortOrder: 20 },
  { id: 'daily-received', title: 'Daily Received', url: 'https://bdainc4-my.sharepoint.com/:x:/r/personal/tcampbell_bdainc_com/Documents/New%20Daily%20Rec..xlsx?d=wbd4f19ff22fd4f8a8b25e264b42e1b1a&csf=1&web=1&e=qERi2r', label: 'Shared workbook', description: 'Open the shared Excel workbook used for daily receiving updates and recaps.', accent: 'blue', icon: '▧', sortOrder: 30 },
  { id: 'assembly-screen', title: 'Assembly Screen', url: 'https://bdainc4-my.sharepoint.com/:x:/r/personal/jmateo_bdainc_com/_layouts/15/Doc.aspx?action=edit&sourcedoc=%7B2678bff3-263f-4512-bdf5-81a2de97afab%7D&wdExp=TEAMS-TREATMENT&web=1', label: 'Assembly workbook', description: 'Open the shared Assembly screen used by the team for current assembly work.', accent: 'green', icon: '▤', sortOrder: 40 },
  { id: 'daily-returns', title: 'Daily Returns', url: 'https://bdainc4-my.sharepoint.com/:x:/r/personal/cescobar_bdainc_com/_layouts/15/Doc.aspx?sourcedoc=%7B7B48C5B8-6820-490A-814A-5DF46CDD8974%7D&file=Daily%20Returns%202025%20A.M..xlsx&fromShare=true&action=default&mobileredirect=true', label: 'Returns workbook', description: 'Open the shared Returns workbook used for daily return tracking and updates.', accent: 'blue', icon: '▧', sortOrder: 50 },
  { id: 'overstock', title: 'Overstock', url: '/warehouse-hub/overstock.html', label: 'Inbound workflow', description: 'Open Houston directly to the Overstock section of the inbound module.', accent: 'orange', icon: '◫', sortOrder: 60 },
  PO_HISTORY_TOOL,
  INVENTORY_CONTROL_TOOL,
  SALESFORCE_HOME_TOOL,
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

function slug(value) {
  return cleanText(value, 120).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100);
}

function safeEqual(a, b) {
  if (!a || !b) return false;
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

const HUB_SESSION_COOKIE = 'hub_associate_session';
const HUB_SESSION_VERSION = 2;

function cookieMap(request) {
  const raw = request.headers.get('cookie') || '';
  return Object.fromEntries(raw.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf('=');
    return index === -1 ? [part, ''] : [part.slice(0, index), part.slice(index + 1)];
  }));
}

function hubSession(request) {
  try {
    const secret = env('HUB_ASSOCIATE_SESSION_SECRET');
    const token = cookieMap(request)[HUB_SESSION_COOKIE];
    if (!secret || !token) return null;
    const key = crypto.createHash('sha256').update(secret).digest();
    const [ivText, tagText, dataText] = String(token).split('.');
    if (!ivText || !tagText || !dataText) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivText, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(dataText, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
    const payload = JSON.parse(plain);
    if (payload?.v !== HUB_SESSION_VERSION || !payload?.name || Number(payload.exp || 0) <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function managerAuthorized(request) {
  if (safeEqual(request.headers.get('x-hub-key') || '', env('HUB_MANAGER_KEY'))) return true;
  return String(hubSession(request)?.role || '').toLowerCase() === 'manager';
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

  if (lowerUrl.includes('passwords.google.com')) {
    meta = { ...meta, label: 'Password manager', description: 'View, save, and manage your work logins in Google Password Manager.', accent: 'green', icon: '🔐' };
  } else if (lowerUrl.includes('1password.com')) {
    meta = { ...meta, label: 'Password manager', description: 'Open 1Password to access saved work logins and autofill credentials.', accent: 'green', icon: '🔐' };
  } else if (lowerUrl.includes('/lightning/page/home')) {
    meta = { ...meta, label: 'Salesforce home', description: 'Open Salesforce home for apps, records, reports, and everyday work.', accent: 'blue', icon: '▤' };
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
    CREATE TABLE IF NOT EXISTS hub_tool_usage (
      tool_id TEXT PRIMARY KEY REFERENCES hub_tool_cards(id) ON DELETE CASCADE,
      click_count BIGINT NOT NULL DEFAULT 0,
      last_opened_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS hub_tool_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS hub_tool_access (
      employee_key TEXT PRIMARY KEY,
      employee_name TEXT NOT NULL,
      preset TEXT NOT NULL DEFAULT 'full',
      allowed_tool_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const seeded = await pool.query(`SELECT value FROM hub_tool_meta WHERE key='seeded_v1' LIMIT 1`);
  if (!seeded.rows.length) {
    for (const tool of SEED_TOOLS) await insertToolIfMissing(pool, tool);
    await pool.query(`INSERT INTO hub_tool_meta(key,value,updated_at) VALUES('seeded_v1','1',NOW()) ON CONFLICT(key) DO NOTHING`);
  }

  const passwordCard = await pool.query(`SELECT value FROM hub_tool_meta WHERE key='passwords_access_v1' LIMIT 1`);
  if (!passwordCard.rows.length) {
    await insertToolIfMissing(pool, PASSWORD_TOOL);
    await pool.query(`INSERT INTO hub_tool_meta(key,value,updated_at) VALUES('passwords_access_v1','1',NOW()) ON CONFLICT(key) DO NOTHING`);
  }

  const googlePasswordCard = await pool.query(`SELECT value FROM hub_tool_meta WHERE key='passwords_access_google_v1' LIMIT 1`);
  if (!googlePasswordCard.rows.length) {
    await insertToolIfMissing(pool, PASSWORD_TOOL);
    await pool.query(
      `UPDATE hub_tool_cards
       SET title=$2,url=$3,label=$4,description=$5,accent=$6,icon=$7,sort_order=$8,active=TRUE,updated_at=NOW()
       WHERE id=$1`,
      [PASSWORD_TOOL.id, PASSWORD_TOOL.title, PASSWORD_TOOL.url, PASSWORD_TOOL.label, PASSWORD_TOOL.description, PASSWORD_TOOL.accent, PASSWORD_TOOL.icon, PASSWORD_TOOL.sortOrder],
    );
    await pool.query(`INSERT INTO hub_tool_meta(key,value,updated_at) VALUES('passwords_access_google_v1','1',NOW()) ON CONFLICT(key) DO NOTHING`);
  }

  const salesforceHomeCard = await pool.query(`SELECT value FROM hub_tool_meta WHERE key='salesforce_home_v1' LIMIT 1`);
  if (!salesforceHomeCard.rows.length) {
    await insertToolIfMissing(pool, SALESFORCE_HOME_TOOL);
    await pool.query(`INSERT INTO hub_tool_meta(key,value,updated_at) VALUES('salesforce_home_v1','1',NOW()) ON CONFLICT(key) DO NOTHING`);
  }

  const poHistoryCard = await pool.query(`SELECT value FROM hub_tool_meta WHERE key='po_history_v1' LIMIT 1`);
  if (!poHistoryCard.rows.length) {
    await insertToolIfMissing(pool, PO_HISTORY_TOOL);
    await pool.query(`INSERT INTO hub_tool_meta(key,value,updated_at) VALUES('po_history_v1','1',NOW()) ON CONFLICT(key) DO NOTHING`);
  }

  const inventoryControlCard = await pool.query(`SELECT value FROM hub_tool_meta WHERE key='warehouse_inventory_v1' LIMIT 1`);
  if (!inventoryControlCard.rows.length) {
    await insertToolIfMissing(pool, INVENTORY_CONTROL_TOOL);
    await pool.query(`INSERT INTO hub_tool_meta(key,value,updated_at) VALUES('warehouse_inventory_v1','1',NOW()) ON CONFLICT(key) DO NOTHING`);
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
  const where = includeInactive ? '' : 'WHERE t.active=TRUE';
  const order = includeInactive ? 't.sort_order ASC, t.title ASC' : 'COALESCE(u.click_count, 0) DESC, t.sort_order ASC, t.title ASC';
  const result = await pool.query(`SELECT t.* FROM hub_tool_cards t LEFT JOIN hub_tool_usage u ON u.tool_id=t.id ${where} ORDER BY ${order}`);
  return result.rows.map(serializeTool);
}


function presetDefinitions(tools) {
  const activeIds = new Set((tools || []).filter((tool) => tool.active !== false).map((tool) => tool.id));
  const keep = (ids) => ids.filter((id) => activeIds.has(id));
  return [
    { id: 'full', name: 'Full Access', toolIds: [...activeIds] },
    { id: 'receiving', name: 'Receiving', toolIds: keep(['fairshift-rotations','houston-control','daily-received','overstock','po-history','warehouse-inventory','salesforce-home','qa-approved','receiving-report','pending-insert-cards','completed-insert-cards']) },
    { id: 'prep', name: 'Prep', toolIds: keep(['fairshift-rotations','houston-control','warehouse-inventory','salesforce-home','prepping-report','ready-packbuilders','pending-packbuilder-pos']) },
    { id: 'assembly', name: 'Assembly', toolIds: keep(['fairshift-rotations','houston-control','assembly-screen','warehouse-inventory','salesforce-home','ready-packbuilders','pending-packbuilder-pos']) },
    { id: 'inventory', name: 'Inventory Only', toolIds: keep(['warehouse-inventory']) },
    { id: 'custom', name: 'Custom', toolIds: [] },
  ];
}

async function readAccessRows(pool) {
  const result = await pool.query(`SELECT employee_key,employee_name,preset,allowed_tool_ids,updated_at FROM hub_tool_access ORDER BY employee_name ASC`);
  return result.rows.map((row) => ({
    employeeKey: row.employee_key,
    employeeName: row.employee_name,
    preset: row.preset || 'full',
    allowedToolIds: Array.isArray(row.allowed_tool_ids) ? row.allowed_tool_ids.map(String) : [],
    updatedAt: row.updated_at || null,
  }));
}

async function accessFor(pool, employeeName) {
  const key = slug(employeeName);
  if (!key) return { employeeKey: '', employeeName: '', preset: 'full', allowedToolIds: [], defaulted: true };
  const result = await pool.query(`SELECT employee_key,employee_name,preset,allowed_tool_ids,updated_at FROM hub_tool_access WHERE employee_key=$1 LIMIT 1`, [key]);
  const row = result.rows[0];
  if (!row) return { employeeKey: key, employeeName, preset: 'full', allowedToolIds: [], defaulted: true };
  return {
    employeeKey: row.employee_key,
    employeeName: row.employee_name,
    preset: row.preset || 'full',
    allowedToolIds: Array.isArray(row.allowed_tool_ids) ? row.allowed_tool_ids.map(String) : [],
    updatedAt: row.updated_at || null,
    defaulted: false,
  };
}

async function saveAccess(pool, body) {
  const employeeName = cleanText(body.employeeName, 120);
  const employeeKey = slug(employeeName);
  if (!employeeKey || !employeeName) throw new Error('Choose a team member.');
  const validPresetIds = new Set(['full','receiving','prep','assembly','inventory','custom']);
  const preset = validPresetIds.has(body.preset) ? body.preset : 'custom';
  const allTools = await readTools(pool, true);
  const knownIds = new Set(allTools.map((tool) => String(tool.id)));
  let allowed = [];
  if (preset === 'custom') {
    allowed = [...new Set((Array.isArray(body.allowedToolIds) ? body.allowedToolIds : []).map(String).filter((id) => knownIds.has(id)))];
  } else if (preset !== 'full') {
    allowed = presetDefinitions(allTools).find((item) => item.id === preset)?.toolIds || [];
  }

  await pool.query(`
    INSERT INTO hub_tool_access(employee_key,employee_name,preset,allowed_tool_ids,updated_at)
    VALUES($1,$2,$3,$4::jsonb,NOW())
    ON CONFLICT(employee_key) DO UPDATE SET
      employee_name=EXCLUDED.employee_name,
      preset=EXCLUDED.preset,
      allowed_tool_ids=EXCLUDED.allowed_tool_ids,
      updated_at=NOW()
  `, [employeeKey, employeeName, preset, JSON.stringify(allowed)]);

  return accessFor(pool, employeeName);
}

function filterToolsForAccess(tools, access) {
  if (!access || access.preset === 'full') return tools;
  const allowed = new Set(access.allowedToolIds || []);
  return tools.filter((tool) => allowed.has(tool.id));
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
      if (admin) {
        if (!managerAuthorized(request)) return json(401, { error: 'Manager access denied.' });
        const allTools = await readTools(pool, true);
        return json(200, {
          tools: allTools,
          access: await readAccessRows(pool),
          presets: presetDefinitions(allTools),
        });
      }

      const session = hubSession(request);
      if (!session) return json(200, { signedIn: false, tools: [], access: null });
      const allTools = await readTools(pool, false);
      const access = await accessFor(pool, session.name);
      return json(200, {
        signedIn: true,
        employeeName: session.name,
        access,
        tools: filterToolsForAccess(allTools, access),
      });
    }

    if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });
    const body = await request.json().catch(() => ({}));
    if (body.action === 'recordClick') {
      const id = cleanText(body.id, 100);
      if (!id) return json(400, { error: 'Card id is required.' });
      const recorded = await pool.query(`INSERT INTO hub_tool_usage(tool_id,click_count,last_opened_at)
        SELECT id, 1, NOW() FROM hub_tool_cards WHERE id=$1 AND active=TRUE
        ON CONFLICT(tool_id) DO UPDATE SET click_count=hub_tool_usage.click_count+1,last_opened_at=NOW()
        RETURNING tool_id`, [id]);
      return recorded.rows.length ? json(200, { ok: true }) : json(404, { error: 'Card unavailable.' });
    }
    if (!managerAuthorized(request)) return json(401, { error: 'Manager access denied.' });
    if (body.action === 'upsertTool') {
      return json(200, { ok: true, result: await upsertTool(pool, body) });
    }
    if (body.action === 'deleteTool') {
      const id = cleanText(body.id, 100);
      if (!id) throw new Error('Card id is required.');
      await pool.query(`DELETE FROM hub_tool_cards WHERE id=$1`, [id]);
      return json(200, { ok: true });
    }
    if (body.action === 'setAccess') {
      return json(200, { ok: true, access: await saveAccess(pool, body) });
    }
    return json(400, { error: 'Unsupported action.' });
  } catch (error) {
    return json(400, { error: cleanText(error?.message || 'Unexpected error.', 300) });
  }
};
