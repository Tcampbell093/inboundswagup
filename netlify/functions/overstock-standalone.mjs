import pg from 'pg';
import crypto from 'node:crypto';

const { Pool } = pg;
let poolInstance = null;
const TOMBSTONE_TTL_MS = 24 * 60 * 60 * 1000;
const EXCEL_WEBHOOK_TIMEOUT_MS = 8000;
const HUB_SESSION_COOKIE = 'hub_associate_session';

function env(name) {
  return globalThis.Netlify?.env?.get(name) || '';
}

function pool() {
  if (poolInstance) return poolInstance;
  const connectionString = env('DATABASE_URL');
  if (!connectionString) throw new Error('DATABASE_URL is not configured');
  poolInstance = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  return poolInstance;
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-overstock-import-key',
    },
  });
}

function str(value, max = 500) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function safeEqual(a, b) {
  if (!a || !b) return false;
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function cookieMap(request) {
  const raw = request.headers.get('cookie') || '';
  return Object.fromEntries(raw.split(';').map(part => part.trim()).filter(Boolean).map(part => {
    const idx = part.indexOf('=');
    return idx === -1 ? [part, ''] : [part.slice(0, idx), part.slice(idx + 1)];
  }));
}

function hubSession(request) {
  const token = cookieMap(request)[HUB_SESSION_COOKIE];
  const secret = env('HUB_ASSOCIATE_SESSION_SECRET');
  if (!token || !secret) return null;
  try {
    const [ivText, tagText, dataText] = String(token).split('.');
    if (!ivText || !tagText || !dataText) return null;
    const key = crypto.createHash('sha256').update(secret).digest();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivText, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(dataText, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
    const session = JSON.parse(plain);
    if (!session?.name || Number(session.exp || 0) <= Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

function hubActor(request) {
  return str(hubSession(request)?.name, 120);
}

function hubIsAdminOrLead(request) {
  const role = str(hubSession(request)?.role, 60).toLowerCase();
  return role === 'manager' || role === 'team lead';
}

function normalizePo(value) {
  return str(value, 120).replace(/^PO[-\s]*/i, '').trim().toUpperCase();
}

// Donation readiness. Bulk and Bulk+Assembly POs may be donated 30 days
// after they were first added to Overstock; Pack Builder (Assembly) POs 30
// days after their assembly date, which a lead or admin enters. The route
// comes from the workbook rows PO History keeps (Daily Log and Archive);
// POs not in the workbook have no route and keep the manual checklist.
const DONATION_WAIT_DAYS = 30;
const ROUTE_CACHE_MS = 2 * 60000;
let routeCache = { at: 0, routes: new Map() };
let assemblySchemaReady = false;

function prepRoute(value) {
  const text = str(value, 60).toLowerCase();
  const bulk = text.includes('bulk'), assembly = /assem|pack/.test(text);
  if (bulk && assembly) return 'Bulk+Assembly';
  if (bulk) return 'Bulk';
  if (assembly) return 'Assembly';
  return '';
}

function isoDay(value) {
  const text = str(value, 40);
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : '';
}

function addDays(day, days) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function warehouseToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}

async function ensureAssemblySchema(db) {
  if (assemblySchemaReady) return;
  await db.query(`CREATE TABLE IF NOT EXISTS overstock_po_assembly (
    po TEXT PRIMARY KEY,
    assembly_date DATE NOT NULL,
    set_by TEXT,
    set_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  assemblySchemaReady = true;
}

async function workbookRoutes(db) {
  if (Date.now() - routeCache.at < ROUTE_CACHE_MS) return routeCache.routes;
  const routes = new Map();
  try {
    // Current Daily Log rows win over archived and older rows.
    const result = await db.query(`
      SELECT po, COALESCE(NULLIF(row_json->>'Prep Route / Ruta Prep',''), row_json->>'Prep Route') AS route
      FROM po_history_records
      WHERE source_sheet IN ('Daily Log','Archive') AND COALESCE(po,'') <> ''
      ORDER BY (removed_at IS NULL) ASC, (source_sheet = 'Daily Log') ASC, last_seen_at ASC`);
    for (const row of result.rows) {
      const route = prepRoute(row.route);
      if (route) routes.set(normalizePo(row.po), route);
    }
  } catch {
    return routeCache.routes; // PO History not set up yet
  }
  routeCache = { at: Date.now(), routes };
  return routes;
}

// Route, assembly date and first-added date for each PO in Overstock.
async function readDonationInfo(db, entries) {
  await ensureAssemblySchema(db);
  const routes = await workbookRoutes(db);
  const assembly = await db.query(`SELECT po, assembly_date::text AS date, set_by, set_at FROM overstock_po_assembly`);
  const assemblyByPo = new Map(assembly.rows.map(row => [row.po, { date: row.date, by: row.set_by || '', at: row.set_at }]));
  const pos = {};
  for (const entry of Array.isArray(entries) ? entries : []) {
    const po = normalizePo(entry?.po);
    if (!po) continue;
    const info = pos[po] ||= { route: routes.get(po) || '', ...(assemblyByPo.has(po) ? { assembly: assemblyByPo.get(po) } : {}) };
    for (const added of [isoDay(entry?.date), isoDay(entry?.originalDate)]) {
      if (added && (!info.added || added < info.added)) info.added = added;
    }
  }
  return { waitDays: DONATION_WAIT_DAYS, today: warehouseToday(), pos };
}

// status: ready | waiting | needs-assembly-date | no-route
function donationReadiness(info, po, today = warehouseToday()) {
  const row = info?.pos?.[normalizePo(po)];
  if (!row?.route) return { status: 'no-route' };
  const start = row.route === 'Assembly' ? row.assembly?.date : row.added;
  if (!start) return { status: row.route === 'Assembly' ? 'needs-assembly-date' : 'no-route', route: row.route };
  const readyOn = addDays(start, DONATION_WAIT_DAYS);
  return { status: today >= readyOn ? 'ready' : 'waiting', route: row.route, start, readyOn };
}

// Workbook box-code typos: "0SC-157" (zero), "OSC--208", "osc 205", "OSC205"
// all mean the same box as "OSC-157" etc.
function normalizeBoxCode(value) {
  let code = str(value, 120).toUpperCase().replace(/\s+/g, '-');
  code = code.replace(/^0SC(?=[-\d])/, 'OSC').replace(/-{2,}/g, '-').replace(/-+$/, '');
  return code.replace(/^OSC(?=\d)/, 'OSC-');
}

// Workbook location typos: "car", "CAR-", "E6", "e - 6" -> "CAR", "E-6".
function normalizeLocation(value) {
  const loc = str(value, 120).toUpperCase().replace(/\s+/g, '').replace(/-+$/, '');
  const shelf = /^E-?(\d{1,2})$/.exec(loc);
  return shelf ? `E-${Number(shelf[1])}` : loc;
}

// New boxes are only created from codes shaped like a real box ("OSC-205",
// "STICKERS-005"), so a stray "f" in the box column isn't turned into a box.
const BOX_CODE_SHAPE = /^[A-Z]{2,}-\d{1,4}$/;

function normalizeOperationalDate(value) {
  const raw = str(value, 40);
  let match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) return `${match[1]}-${String(Number(match[2])).padStart(2, '0')}-${String(Number(match[3])).padStart(2, '0')}`;
  match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) return `${match[3]}-${String(Number(match[1])).padStart(2, '0')}-${String(Number(match[2])).padStart(2, '0')}`;
  return '';
}

function isUnknownAssociate(value) {
  const name = str(value, 120).toLowerCase();
  return !name || name === 'unknown' || name === 'unknown associate';
}

function excelEntryUpdate(entry, prepAssociate, patch = {}, now = Date.now()) {
  const existingOriginal = str(entry?.originalAssociate || entry?.associate, 120);
  const originalAssociate = isUnknownAssociate(existingOriginal) ? str(prepAssociate, 120) : existingOriginal;
  return {
    ...entry,
    ...patch,
    associate: originalAssociate || str(prepAssociate, 120),
    originalAssociate: originalAssociate || str(prepAssociate, 120),
    lastChangedBy: 'Excel Sync',
    lastChangedAt: now,
    sourceType: 'excel-location-sync',
    updatedAt: now,
  };
}

function prepAssociateFromHistoryRow(rowJson) {
  const row = rowJson && typeof rowJson === 'object' ? rowJson : {};
  const exact = str(row['Prep By (Por)'] || row['Prep By'] || row['Prep Associate'], 120);
  if (exact) return exact;
  for (const [key, value] of Object.entries(row)) {
    if (/^prep\s*(by|associate)|prep.*\(por\)|prep.*por/i.test(key)) {
      const candidate = str(value, 120);
      if (candidate) return candidate;
    }
  }
  return '';
}

async function enrichExcelOwnershipFromHistory(db, rawEntries) {
  const entries = Array.isArray(rawEntries) ? rawEntries : [];
  const targets = entries.filter(entry =>
    str(entry?.sourceType, 80) === 'excel-location-sync' &&
    isUnknownAssociate(entry?.originalAssociate || entry?.associate)
  );
  if (!targets.length) return entries;

  const deliveryIds = [...new Set(targets.map(entry => str(entry?.deliveryId, 120).toUpperCase()).filter(Boolean))];
  const pos = [...new Set(targets.map(entry => normalizePo(entry?.po)).filter(Boolean))];
  if (!deliveryIds.length && !pos.length) return entries.filter(entry => !targets.includes(entry));

  let historyRows;
  try {
    historyRows = await db.query(`
      SELECT delivery_id, po, row_json
      FROM po_history_records
      WHERE UPPER(COALESCE(delivery_id,'')) = ANY($1::text[])
         OR UPPER(COALESCE(po,'')) = ANY($2::text[])
      ORDER BY CASE WHEN lifecycle_state='current' THEN 0 ELSE 1 END,
               activity_date DESC NULLS LAST,
               first_seen_at DESC
    `, [deliveryIds, pos]);
  } catch {
    // PO History may not be initialized yet. In that case do not hide data.
    return entries;
  }

  const byDelivery = new Map();
  const poCandidates = new Map();
  for (const row of historyRows.rows) {
    const prep = prepAssociateFromHistoryRow(row.row_json);
    if (!prep) continue;
    const deliveryId = str(row.delivery_id, 120).toUpperCase();
    const po = normalizePo(row.po);
    if (deliveryId && !byDelivery.has(deliveryId)) byDelivery.set(deliveryId, prep);
    if (po) {
      if (!poCandidates.has(po)) poCandidates.set(po, new Set());
      poCandidates.get(po).add(prep);
    }
  }

  const out = [];
  for (const entry of entries) {
    const needsRepair =
      str(entry?.sourceType, 80) === 'excel-location-sync' &&
      isUnknownAssociate(entry?.originalAssociate || entry?.associate);
    if (!needsRepair) {
      out.push(entry);
      continue;
    }
    const deliveryId = str(entry?.deliveryId, 120).toUpperCase();
    const po = normalizePo(entry?.po);
    let prep = deliveryId ? byDelivery.get(deliveryId) : '';
    if (!prep && po) {
      const candidates = poCandidates.get(po);
      if (candidates?.size === 1) prep = [...candidates][0];
    }
    // An Excel-created Overstock row with no Prep By should not be visible.
    if (!prep) continue;
    out.push({
      ...entry,
      associate: prep,
      originalAssociate: prep,
      lastChangedBy: 'Excel Sync',
    });
  }
  return out;
}

function tombId(t) {
  if (t == null) return '';
  return typeof t === 'object' ? str(t.id, 160) : str(t, 160);
}

function normalizeTombs(arr) {
  const now = Date.now();
  const map = new Map();
  for (const raw of Array.isArray(arr) ? arr : []) {
    const id = tombId(raw);
    if (!id) continue;
    const ts = raw && typeof raw === 'object' ? num(raw.ts, now) : now;
    if (now - ts > TOMBSTONE_TTL_MS) continue;
    const prev = map.get(id);
    if (!prev || ts > prev.ts) map.set(id, { id, ts });
  }
  return [...map.values()];
}

function cleanEntry(raw, existing = null) {
  const now = Date.now();
  const source = existing || {};
  const id = str(raw.id || source.id || crypto.randomUUID(), 160);
  const originalAssociate = str(source.originalAssociate || source.associate || raw.originalAssociate || raw.associate, 120);
  const lastChangedBy = str(raw.lastChangedBy || source.lastChangedBy || originalAssociate, 120);
  return {
    ...source,
    id,
    po: str(raw.po ?? source.po, 120),
    deliveryId: str(raw.deliveryId ?? source.deliveryId, 120),
    category: str(raw.category ?? source.category, 120),
    quantity: Math.max(0, Math.round(num(raw.quantity ?? source.quantity, 0))),
    status: str(raw.status ?? source.status, 120) || 'Not Donation',
    action: str(raw.action ?? source.action, 120) || 'Required',
    note: str(raw.note ?? source.note, 1000),
    date: str(raw.date ?? source.date, 40) || new Date().toISOString().slice(0, 10),
    location: str(raw.location ?? source.location, 120),
    associate: originalAssociate,
    originalAssociate,
    lastChangedBy,
    lastChangedAt: now,
    sourceType: str(raw.sourceType ?? source.sourceType, 80) || 'overstock-standalone',
    containerId: str(raw.containerId ?? source.containerId, 160),
    containerCode: str(raw.containerCode ?? source.containerCode, 120),
    sizeBreakdown: raw.sizeBreakdown ?? source.sizeBreakdown ?? null,
    createdAt: num(source.createdAt || raw.createdAt, now),
    updatedAt: now,
  };
}

function cleanContainer(raw, existing = null) {
  const now = Date.now();
  const source = existing || {};
  const id = str(raw.id || source.id || crypto.randomUUID(), 160);
  return {
    ...source,
    id,
    code: str(raw.code ?? source.code, 120).toUpperCase(),
    barcode: str(raw.barcode ?? source.barcode, 160),
    currentLocation: str(raw.currentLocation ?? source.currentLocation, 120).toUpperCase(),
    status: str(raw.status ?? source.status, 80) || 'Open',
    notes: str(raw.notes ?? source.notes, 1000),
    createdSource: str(source.createdSource || raw.createdSource, 60) || 'Legacy / unknown',
    createdBy: str(source.createdBy || raw.createdBy, 120),
    retainEmpty: raw.retainEmpty === true || source.retainEmpty === true,
    createdAt: num(source.createdAt || raw.createdAt, now),
    updatedAt: now,
  };
}

let boxAuditSchemaReady = false;

async function ensureBoxAuditSchema(db) {
  if (boxAuditSchemaReady) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS overstock_box_events (
      id TEXT PRIMARY KEY,
      container_id TEXT NOT NULL,
      container_code TEXT NOT NULL,
      event_type TEXT NOT NULL,
      source TEXT NOT NULL,
      actor TEXT NOT NULL DEFAULT '',
      po TEXT NOT NULL DEFAULT '',
      detail JSONB NOT NULL DEFAULT '{}'::jsonb,
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS overstock_box_events_container_idx
      ON overstock_box_events(container_id, occurred_at DESC);
    CREATE INDEX IF NOT EXISTS overstock_box_events_code_idx
      ON overstock_box_events(UPPER(container_code), occurred_at DESC);
  `);
  boxAuditSchemaReady = true;
}

function boxEvent(events, box, type, source, actor, detail = {}) {
  if (!box?.id) return;
  events.push({
    id: crypto.randomUUID(),
    container_id: str(box.id, 160),
    container_code: str(box.code, 120),
    event_type: str(type, 80),
    source: str(source, 80),
    actor: str(actor, 120),
    po: str(detail.po, 120),
    detail,
    occurred_at: new Date().toISOString(),
  });
}

// History for a PO-level change, kept even when the item isn't in a box
// (boxEvent skips those, so deleting a loose item used to leave no record).
function poEvent(events, box, type, source, actor, detail = {}) {
  if (box?.id) return boxEvent(events, box, type, source, actor, detail);
  events.push({
    id: crypto.randomUUID(),
    container_id: '',
    container_code: '',
    event_type: str(type, 80),
    source: str(source, 80),
    actor: str(actor, 120),
    po: str(detail.po, 120),
    detail,
    occurred_at: new Date().toISOString(),
  });
}

async function persistBoxEvents(client, events) {
  if (!events.length) return;
  await client.query(`
    INSERT INTO overstock_box_events
      (id,container_id,container_code,event_type,source,actor,po,detail,occurred_at)
    SELECT x.id,x.container_id,x.container_code,x.event_type,x.source,
           x.actor,x.po,x.detail,x.occurred_at::timestamptz
    FROM jsonb_to_recordset($1::jsonb) AS x(
      id text,container_id text,container_code text,event_type text,
      source text,actor text,po text,detail jsonb,occurred_at text
    )
    ON CONFLICT(id) DO NOTHING
  `, [JSON.stringify(events)]);
}

function isExcelCreatedBox(box) {
  return str(box?.createdSource, 80).toLowerCase() === 'excel sync'
    || str(box?.notes, 1000).startsWith('Created from New Daily Rec Excel sync.');
}

function nextContainerCode(containers) {
  let max = 0;
  for (const c of Array.isArray(containers) ? containers : []) {
    const m = String(c?.code || '').toUpperCase().match(/^OSC-(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]) || 0);
  }
  return `OSC-${String(max + 1).padStart(3, '0')}`;
}

function filterDeleted(data) {
  const entryTombs = normalizeTombs(data.__deletedOverstockEntryIds);
  const containerTombs = normalizeTombs(data.__deletedOverstockContainerIds);
  const donationTombs = normalizeTombs(data.__deletedOverstockDonationIds);
  const deadE = new Set(entryTombs.map(t => t.id));
  const deadC = new Set(containerTombs.map(t => t.id));
  const deadD = new Set(donationTombs.map(t => t.id));
  return {
    entries: (Array.isArray(data.overstockEntries) ? data.overstockEntries : []).filter(e => e?.id && !deadE.has(String(e.id))),
    containers: (Array.isArray(data.overstockContainers) ? data.overstockContainers : []).filter(c => c?.id && !deadC.has(String(c.id))),
    donations: (Array.isArray(data.overstockDonations) ? data.overstockDonations : []).filter(d => d?.id && !deadD.has(String(d.id))),
    activities: (Array.isArray(data.overstockActivity) ? data.overstockActivity : []).filter(a => a?.id).slice(0, 50),
    entryTombs,
    containerTombs,
    donationTombs,
  };
}

function excelConnectionState() {
  return {
    configured: Boolean(env('OVERSTOCK_EXCEL_WEBHOOK_URL')),
    importConfigured: Boolean(env('OVERSTOCK_EXCEL_IMPORT_SECRET')),
    provider: 'Power Automate',
    workbook: 'New Daily Rec..xlsx',
    table: 'DailyLog',
    direction: 'Overstock → Excel',
    createsMissingEntries: true,
    importsCategoryFromColumnH: true,
    importsOperationalDateFromColumnT: true,
  };
}

async function ensureExcelRowMemorySchema(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS overstock_excel_row_memory (
    row_key TEXT PRIMARY KEY,
    location TEXT NOT NULL DEFAULT '',
    container_code TEXT NOT NULL DEFAULT '',
    seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
}

// What each workbook row said at this sync, for spotting edits next time.
async function rememberExcelRows(db, rows, rowKey) {
  const byKey = new Map();
  for (const raw of rows) {
    const key = rowKey(raw);
    if (key === 'P:') continue;
    byKey.set(key, { row_key: key, location: normalizeLocation(raw?.location), container_code: normalizeBoxCode(raw?.containerCode) });
  }
  if (!byKey.size) return;
  await db.query(`INSERT INTO overstock_excel_row_memory(row_key,location,container_code,seen_at)
    SELECT row_key,location,container_code,NOW() FROM json_to_recordset($1::json) AS x(row_key TEXT,location TEXT,container_code TEXT)
    ON CONFLICT(row_key) DO UPDATE SET location=EXCLUDED.location,container_code=EXCLUDED.container_code,seen_at=NOW()`,
  [JSON.stringify([...byKey.values()])]);
}

async function importExcelLocations(rawRows, rawAssociates) {
  // The workbook can exceed 1,000 rows. Reject oversized requests explicitly
  // rather than silently ignoring later corrections.
  if (Array.isArray(rawRows) && rawRows.length > 10000) throw new Error('Excel sync exceeds 10,000 rows. Split the workbook sync into batches.');
  const rows = Array.isArray(rawRows) ? rawRows : [];
  const workbookAssociates = [];
  for (const raw of Array.isArray(rawAssociates) ? rawAssociates.slice(0, 250) : []) {
    const name = str(raw, 120);
    if (name && !workbookAssociates.some(existing => existing.toLowerCase() === name.toLowerCase())) workbookAssociates.push(name);
  }
  workbookAssociates.sort((a, b) => a.localeCompare(b));
  const db = pool();
  await ensureBoxAuditSchema(db);
  const client = await db.connect();
  const result = { received: rows.length, importedAssociates: workbookAssociates.length, createdEntries: 0, createdContainers: 0, updatedEntries: 0, updatedContainers: 0, retiredEmptyExcelBoxes: 0, removedUnassignedEntries: 0, unchanged: 0, skipped: [], unresolved: [] };

  try {
    await client.query('BEGIN');
    const state = await client.query(`SELECT data_json, masters_json FROM workflow_sync_state WHERE state_key='default' LIMIT 1 FOR UPDATE`);
    if (!state.rows.length) throw new Error('Houston workflow state is unavailable.');
    const data = { ...(state.rows[0].data_json || {}) };
    const masters = { ...(state.rows[0].masters_json || {}) };
    const filtered = filterDeleted(data);
    let entries = filtered.entries.slice();
    const containers = filtered.containers.slice();
    const now = Date.now();
    const changedContainerIds = new Set();
    const changedEntryIds = new Set();
    const boxEvents = [];
    const excelActivities = [];

    const incomingByDelivery = new Map();
    const incomingByPo = new Map();
    for (const raw of rows) {
      const incoming = {
        deliveryId: str(raw?.deliveryId, 120).toUpperCase(),
        po: normalizePo(raw?.po),
        associate: str(raw?.associate, 120),
      };
      if (incoming.deliveryId) incomingByDelivery.set(incoming.deliveryId, incoming);
      if (incoming.po) {
        if (!incomingByPo.has(incoming.po)) incomingByPo.set(incoming.po, []);
        incomingByPo.get(incoming.po).push(incoming);
      }
    }

    // Only real Overstock locations (plus CAR, the cart/staging area) are
    // accepted, so a typo like "caro" or "F" is reported instead of saved.
    const knownLocations = new Set([
      ...(Array.isArray(masters.overstockLocations) && masters.overstockLocations.length
        ? masters.overstockLocations : Array.from({ length: 24 }, (_, i) => `E-${i + 1}`)),
      'CAR',
    ].map(normalizeLocation));

    // A box's location is shared, but the workbook stores one per row, and
    // Excel doesn't record when a cell was edited. So the server remembers what
    // each row said at the last sync: a row whose location changed since then
    // is the newest information. When a box's rows disagree:
    //  - exactly one new location among changed rows -> it wins, box moves;
    //  - no row changed (old leftovers) -> the box stays where Overstock has it;
    //  - changed rows disagree with each other -> reported, box not moved.
    // (The workbook script then copies the box's location onto all its rows.)
    await ensureExcelRowMemorySchema(client);
    const memoryRows = await client.query('SELECT row_key, location FROM overstock_excel_row_memory');
    const memory = new Map(memoryRows.rows.map(row => [row.row_key, row.location]));
    const firstRemembered = memory.size === 0; // nothing to compare against yet
    const rowKey = (raw) => {
      const deliveryId = str(raw?.deliveryId, 120).toUpperCase();
      return deliveryId ? `D:${deliveryId}` : `P:${normalizePo(raw?.po)}`;
    };
    const changedSinceLastSync = (raw) => {
      const before = memory.get(rowKey(raw));
      if (before === undefined) return !firstRemembered; // a brand-new row counts as new information
      return before !== normalizeLocation(raw?.location);
    };
    // Exact code first, so the real "OSC-157" wins over a typo box "0SC-157".
    const findBox = (code) => containers.find(c => str(c?.code, 120).toUpperCase() === code)
      || containers.find(c => normalizeBoxCode(c?.code) === code);
    const boxCodesForRow = (raw) => {
      const code = normalizeBoxCode(raw?.containerCode);
      if (code) return [code];
      const deliveryId = str(raw?.deliveryId, 120).toUpperCase();
      const po = normalizePo(raw?.po);
      const matched = deliveryId ? entries.filter(entry => str(entry?.deliveryId, 120).toUpperCase() === deliveryId) : [];
      const items = matched.length ? matched : (po ? entries.filter(entry => normalizePo(entry?.po) === po) : []);
      return [...new Set(items.map(entry => {
        const box = containers.find(c => String(c.id) === String(entry?.containerId || ''));
        return box ? normalizeBoxCode(box.code) : '';
      }).filter(Boolean))];
    };
    const boxVotes = new Map();
    for (const raw of rows) {
      const loc = normalizeLocation(raw?.location);
      if (isUnknownAssociate(str(raw?.associate, 120)) || !loc || !knownLocations.has(loc)) continue;
      const fresh = changedSinceLastSync(raw);
      for (const code of boxCodesForRow(raw)) {
        if (!boxVotes.has(code)) boxVotes.set(code, { all: new Map(), fresh: new Map() });
        const votes = boxVotes.get(code);
        votes.all.set(loc, (votes.all.get(loc) || 0) + 1);
        if (fresh) votes.fresh.set(loc, (votes.fresh.get(loc) || 0) + 1);
      }
    }
    // code -> location every row of that box should use; null = real conflict.
    const boxDecision = new Map();
    result.boxNewestWins = 0;
    result.boxLocationConflicts = 0;
    for (const [code, votes] of boxVotes) {
      if (votes.all.size < 2) continue;
      const listed = [...votes.all].map(([loc, n]) => `${loc} x${n}`).join(', ');
      const freshLocations = [...votes.fresh.keys()];
      if (freshLocations.length === 1) {
        boxDecision.set(code, freshLocations[0]);
        result.boxNewestWins += 1;
      } else if (freshLocations.length === 0) {
        const current = normalizeLocation(findBox(code)?.currentLocation);
        boxDecision.set(code, current || null);
        if (!current) {
          result.boxLocationConflicts += 1;
          result.unresolved.push(`${code}: workbook rows disagree on its location (${listed}); box not created.`);
        }
      } else {
        boxDecision.set(code, null);
        result.boxLocationConflicts += 1;
        result.unresolved.push(`${code}: rows were changed to different locations since the last sync (${[...votes.fresh].map(([loc, n]) => `${loc} x${n}`).join(', ')}); box not moved. Make those rows match.`);
      }
    }

    for (const raw of rows) {
      const po = normalizePo(raw?.po);
      const deliveryId = str(raw?.deliveryId, 120).toUpperCase();
      const associate = str(raw?.associate, 120);
      const category = str(raw?.category, 120);
      const operationalDate = normalizeOperationalDate(raw?.operationalDate);
      let location = normalizeLocation(raw?.location);
      const containerCode = normalizeBoxCode(raw?.containerCode);
      const key = deliveryId || po || '(blank row)';

      // Overstock should only receive workbook rows that have actually been
      // assigned to a Prep associate. Unassigned rows remain in Excel until
      // Prep ownership is known.
      if (isUnknownAssociate(associate)) {
        result.skipped.push(`${key}: no Prep By assigned.`);
        continue;
      }

      // Blank locations never clear Houston. This protects operational history
      // when a workbook row is incomplete or its formula has not recalculated.
      if (!location) {
        result.skipped.push(`${key}: no Overstock location.`);
        continue;
      }
      if (!knownLocations.has(location)) {
        result.unresolved.push(`${key}: "${str(raw?.location, 60)}" isn't an Overstock location; nothing moved.`);
        continue;
      }
      // Rows of a box whose rows disagree all use the decided location (the
      // newest change, or where Overstock already has it). A real conflict
      // keeps the box where it is; items still get category, date and prep.
      const decided = boxCodesForRow(raw).filter(code => boxDecision.has(code));
      if (decided.length) {
        const decision = boxDecision.get(decided[0]);
        const box = findBox(decided[0]);
        if (decision) location = decision;
        else if (box) location = normalizeLocation(box.currentLocation) || location;
        else continue;
      }

      let matches = deliveryId ? entries.filter(entry => str(entry?.deliveryId, 120).toUpperCase() === deliveryId) : [];
      if (!matches.length && po) {
        const samePo = entries.filter(entry => normalizePo(entry?.po) === po);
        if (deliveryId) {
          // A different delivery ID is a different part of a split PO.
          // Match one legacy item without an ID only when the PO is unique.
          if (samePo.length === 1 && !str(samePo[0]?.deliveryId, 120)) matches = samePo;
          else if (samePo.some(entry => !str(entry?.deliveryId, 120))) {
            result.unresolved.push(`${key}: split PO has an ambiguous item without a delivery ID.`);
            continue;
          }
        } else matches = samePo;
      }
      if (!matches.length) {
        if (!po) {
          result.unresolved.push(`${key}: a PO number is required to create a Houston record.`);
          continue;
        }
        if (!containerCode) {
          result.unresolved.push(`${key}: new PO requires an Overstock container code in Excel; no box was generated.`);
          continue;
        }
        if (num(raw?.quantity, 0) <= 0) {
          result.unresolved.push(`${key}: new PO has zero Overstock quantity; no empty box was generated.`);
          continue;
        }

        let targetContainer = containerCode
          ? findBox(containerCode)
          : null;
        if (!targetContainer && !BOX_CODE_SHAPE.test(containerCode)) {
          result.unresolved.push(`${key}: "${str(raw?.containerCode, 60)}" doesn't look like a box code; no box was created.`);
          continue;
        }
        if (!targetContainer) {
          targetContainer = cleanContainer({
            code: containerCode,
            currentLocation: location,
            status: 'Open',
            notes: 'Created from New Daily Rec Excel sync.',
            createdSource: 'Excel Sync',
            createdBy: 'Excel Sync',
          });
          containers.push(targetContainer);
          result.createdContainers += 1;
          boxEvent(boxEvents, targetContainer, 'created', 'Excel Sync', 'Excel Sync', { po, deliveryId, prepBy: associate, location });
          excelActivities.unshift({
            id: crypto.randomUUID(), type: 'box', actor: 'Excel Sync',
            summary: `created box ${targetContainer.code} for PO ${po} (Prep: ${associate})`,
            po, containerId: targetContainer.id, containerCode: targetContainer.code,
            location, createdAt: now,
          });
        } else if (str(targetContainer.currentLocation, 120).toUpperCase() !== location
          || str(targetContainer.status, 80).toLowerCase() === 'closed') {
          const index = containers.findIndex(container => String(container?.id || '') === String(targetContainer.id));
          const previousLocation = targetContainer.currentLocation;
          const wasClosed = str(targetContainer.status, 80).toLowerCase() === 'closed';
          targetContainer = { ...targetContainer, currentLocation: location, status: str(targetContainer.status, 40).toLowerCase() === 'closed' ? 'Stored' : targetContainer.status, updatedAt: now };
          containers[index] = targetContainer;
          changedContainerIds.add(String(targetContainer.id));
          boxEvent(boxEvents, targetContainer, wasClosed ? 'reopened' : 'location-changed',
            'Excel Sync', 'Excel Sync',
            { po, deliveryId, prepBy: associate, from: previousLocation, to: location });
        }

        const created = cleanEntry({
          po,
          deliveryId,
          associate,
          originalAssociate: associate,
          lastChangedBy: 'Excel Sync',
          category,
          quantity: raw?.quantity,
          status: 'Not Donation',
          action: raw?.disposition || 'Required',
          note: raw?.note,
          date: operationalDate || new Date().toISOString().slice(0, 10),
          location,
          sourceType: 'excel-location-sync',
          containerId: targetContainer.id,
          containerCode: targetContainer.code,
        });
        entries.push(created);
        boxEvent(boxEvents, targetContainer, 'po-added', 'Excel Sync', 'Excel Sync', { po, deliveryId, prepBy: associate, quantity: created.quantity });
        result.createdEntries += 1;
        continue;
      }

      // A PO may contain several items in different boxes. Without a unique
      // delivery match, a corrected box code cannot safely identify which item
      // to move, so report it instead of changing unrelated inventory.
      if (!deliveryId && associate && matches.length > 1) {
        result.unresolved.push(`${key}: multiple parts match; a delivery ID is needed to assign the prep associate.`);
        continue;
      }
      const matchingBoxIds = new Set(matches.map(entry => str(entry?.containerId, 160)));
      const currentBox = containers.find(container => String(container?.id) === [...matchingBoxIds][0]);
      if (containerCode && (matchingBoxIds.size > 1 || (!deliveryId && matches.length > 1 && normalizeBoxCode(currentBox?.code) !== containerCode))) {
        result.unresolved.push(`${key}: multiple boxes match; select the item to move in Overstock Control.`);
        continue;
      }

      if (category) {
        for (const match of matches) {
          const index = entries.findIndex(entry => String(entry?.id || '') === String(match?.id || ''));
          if (index < 0 || str(entries[index]?.category, 120) === category) continue;
          entries[index] = excelEntryUpdate(entries[index], associate, { category }, now);
          changedEntryIds.add(String(entries[index].id));
        }
      }

      if (operationalDate) {
        for (const match of matches) {
          const index = entries.findIndex(entry => String(entry?.id || '') === String(match?.id || ''));
          if (index < 0 || str(entries[index]?.date, 40) === operationalDate) continue;
          entries[index] = excelEntryUpdate(entries[index], associate, { date: operationalDate }, now);
          changedEntryIds.add(String(entries[index].id));
        }
      }

      if (associate || (deliveryId && matches.some(entry => !str(entry?.deliveryId, 120)))) {
        for (const match of matches) {
          const index = entries.findIndex(entry => String(entry?.id || '') === String(match?.id || ''));
          if (index < 0) continue;
          const current = entries[index];
          const nextDeliveryId = deliveryId || str(current.deliveryId, 120);
          const needsPrepBackfill = isUnknownAssociate(current.originalAssociate || current.associate);
          const needsExcelMarker = str(current.lastChangedBy, 120) !== 'Excel Sync';
          if (!needsPrepBackfill && !needsExcelMarker && str(current.deliveryId, 120) === nextDeliveryId) continue;
          entries[index] = excelEntryUpdate(current, associate, { deliveryId: nextDeliveryId }, now);
          changedEntryIds.add(String(current.id));
        }
      }

      if (containerCode) {
        let target = findBox(containerCode);
        if (!target && !BOX_CODE_SHAPE.test(containerCode)) {
          result.unresolved.push(`${key}: "${str(raw?.containerCode, 60)}" doesn't look like a box code; item not moved.`);
          continue;
        }
        if (!target) {
          if (num(raw?.quantity, 0) <= 0) {
            result.unresolved.push(`${key}: cannot create a new box for a zero-quantity PO.`);
            continue;
          }
          target = cleanContainer({
            code: containerCode, currentLocation: location, status: 'Open',
            notes: 'Created from New Daily Rec Excel sync.',
            createdSource: 'Excel Sync', createdBy: 'Excel Sync',
          });
          containers.push(target);
          result.createdContainers += 1;
          boxEvent(boxEvents, target, 'created', 'Excel Sync', 'Excel Sync', { po, deliveryId, prepBy: associate, location });
          excelActivities.unshift({
            id: crypto.randomUUID(), type: 'box', actor: 'Excel Sync',
            summary: `created box ${target.code} for PO ${po} (Prep: ${associate})`,
            po, containerId: target.id, containerCode: target.code,
            location, createdAt: now,
          });
        }
        const targetId = String(target.id);
        const matchIds = new Set(matches.map(entry => String(entry.id)));
        for (let i = 0; i < containers.length; i += 1) {
          if (String(containers[i]?.id) !== targetId) continue;
          if (str(containers[i]?.currentLocation, 120).toUpperCase() !== location || str(containers[i]?.status, 80).toLowerCase() === 'closed') {
            const oldLocation = containers[i].currentLocation;
            const wasClosed = str(containers[i].status, 80).toLowerCase() === 'closed';
            containers[i] = {
              ...containers[i], currentLocation: location,
              status: wasClosed ? 'Stored' : containers[i].status, updatedAt: now,
            };
            changedContainerIds.add(targetId);
            boxEvent(boxEvents, containers[i], wasClosed ? 'reopened' : 'location-changed', 'Excel Sync', 'Excel Sync',
              { po, deliveryId, prepBy: associate, from: oldLocation, to: location });
          }
          break;
        }
        for (let i = 0; i < entries.length; i += 1) {
          const entry = entries[i];
          const isMatch = matchIds.has(String(entry.id));
          if (!isMatch && String(entry.containerId) !== targetId) continue;
          const corrected = isMatch && (String(entry.containerId) !== targetId || normalizeBoxCode(entry.containerCode) !== containerCode);
          if (!corrected && str(entry.location, 120).toUpperCase() === location) continue;
          entries[i] = excelEntryUpdate(entry, associate, {
            ...(isMatch ? { containerId: targetId, containerCode } : {}),
            location,
          }, now);
          if (isMatch && String(entry.containerId) !== targetId) {
            const oldBox = containers.find(box => String(box.id) === String(entry.containerId));
            boxEvent(boxEvents, oldBox, 'po-moved-out', 'Excel Sync', 'Excel Sync', { po: entry.po, deliveryId, to: containerCode });
            boxEvent(boxEvents, target, 'po-moved-in', 'Excel Sync', 'Excel Sync', { po: entry.po, deliveryId, from: oldBox?.code || entry.containerCode });
          }
          changedEntryIds.add(String(entry.id));
        }
        // The previous box may hold other POs; leave it and its location alone.
        // Any now-empty box can be reviewed and removed from the Containers view.
        continue;
      }

      const explicitContainer = containerCode
        ? findBox(containerCode)
        : null;
      const containerIds = new Set(matches.map(entry => str(entry?.containerId, 160)).filter(Boolean));
      if (explicitContainer?.id) containerIds.add(String(explicitContainer.id));

      if (containerIds.size) {
        for (let i = 0; i < containers.length; i += 1) {
          if (!containerIds.has(String(containers[i]?.id || ''))) continue;
          const wasClosed = str(containers[i]?.status, 80).toLowerCase() === 'closed';
          if (str(containers[i]?.currentLocation, 120).toUpperCase() === location && !wasClosed) continue;
          const previous = containers[i].currentLocation;
          containers[i] = {
            ...containers[i], currentLocation: location,
            status: wasClosed ? 'Stored' : containers[i].status,
            updatedAt: now,
          };
          changedContainerIds.add(String(containers[i].id));
          boxEvent(boxEvents, containers[i], wasClosed ? 'reopened' : 'location-changed',
            'Excel Sync', 'Excel Sync',
            { po, deliveryId, prepBy: associate, from: previous, to: location });
        }
        for (let i = 0; i < entries.length; i += 1) {
          if (!containerIds.has(String(entries[i]?.containerId || ''))) continue;
          if (str(entries[i]?.location, 120).toUpperCase() === location) continue;
          entries[i] = excelEntryUpdate(entries[i], associate, { location }, now);
          changedEntryIds.add(String(entries[i].id));
        }
      } else {
        for (const match of matches) {
          const index = entries.findIndex(entry => String(entry?.id || '') === String(match?.id || ''));
          if (index < 0 || str(entries[index]?.location, 120).toUpperCase() === location) continue;
          entries[index] = excelEntryUpdate(entries[index], associate, { location }, now);
          changedEntryIds.add(String(entries[index].id));
        }
      }
    }

    // Reconcile legacy Excel-created rows from before Prep ownership was
    // required. If the current workbook row has a Prep By, backfill it.
    // If it still has no Prep By, remove the legacy Excel-created entry.
    const reconciledEntries = [];
    for (const entry of entries) {
      const legacyUnknown =
        str(entry?.sourceType, 80) === 'excel-location-sync' &&
        isUnknownAssociate(entry?.originalAssociate || entry?.associate);
      if (!legacyUnknown) {
        reconciledEntries.push(entry);
        continue;
      }

      const deliveryId = str(entry?.deliveryId, 120).toUpperCase();
      const po = normalizePo(entry?.po);
      let incoming = deliveryId ? incomingByDelivery.get(deliveryId) : null;
      if (!incoming && po) {
        const candidates = incomingByPo.get(po) || [];
        if (candidates.length === 1) incoming = candidates[0];
      }

      if (!incoming) {
        reconciledEntries.push(entry);
        continue;
      }
      if (isUnknownAssociate(incoming.associate)) {
        const oldBox = containers.find(box => String(box.id) === String(entry.containerId));
        boxEvent(boxEvents, oldBox, 'po-removed', 'Excel Sync', 'Excel Sync',
          { po: entry.po, deliveryId: entry.deliveryId, reason: 'No Prep By assigned in workbook' });
        result.removedUnassignedEntries += 1;
        continue;
      }

      const repaired = excelEntryUpdate(entry, incoming.associate, {}, now);
      reconciledEntries.push(repaired);
      changedEntryIds.add(String(repaired.id));
    }
    entries = reconciledEntries;

    // Never delete a potentially physical box automatically. Only the
    // unmistakably Excel-generated boxes with no attached PO are retired.
    // Manual/Stock Intake boxes stay untouched, and closed boxes remain
    // searchable and reopenable if a valid workbook entry references them.
    const referencedCodes = new Set(
      rows.filter(raw => str(raw?.associate, 120) && str(raw?.location, 120))
        .map(raw => normalizeBoxCode(raw?.containerCode)).filter(Boolean)
    );
    for (let i = 0; i < containers.length; i += 1) {
      const box = containers[i];
      if (!isExcelCreatedBox(box) || box.retainEmpty === true
        || str(box.status, 80).toLowerCase() === 'closed') continue;
      if (referencedCodes.has(normalizeBoxCode(box.code))) continue;
      if (entries.some(entry => String(entry.containerId || '') === String(box.id))) continue;
      containers[i] = {
        ...box,
        status: 'Closed',
        updatedAt: now,
      };
      changedContainerIds.add(String(box.id));
      result.retiredEmptyExcelBoxes += 1;
      boxEvent(boxEvents, containers[i], 'auto-retired-empty', 'Excel Sync', 'Excel Sync',
        { reason: 'No attached PO after Excel reconciliation; box retained for physical review' });
      excelActivities.unshift({
        id: crypto.randomUUID(), type: 'box', actor: 'Excel Sync',
        summary: `retired empty Excel-created box ${box.code}`,
        containerId: box.id, containerCode: box.code,
        location: box.currentLocation, createdAt: now,
      });
    }

    result.updatedEntries = changedEntryIds.size;
    result.updatedContainers = changedContainerIds.size;
    result.unchanged = Math.max(0, rows.length - result.skipped.length - result.unresolved.length - result.createdEntries - result.updatedEntries);
    data.overstockEntries = entries;
    data.overstockContainers = containers;
    if (excelActivities.length) data.overstockActivity =
      [...excelActivities, ...(Array.isArray(data.overstockActivity) ? data.overstockActivity : [])].slice(0, 50);
    if (workbookAssociates.length) masters.associates = workbookAssociates;
    await persistBoxEvents(client, boxEvents);
    await rememberExcelRows(client, rows, rowKey);
    await client.query(
      `UPDATE workflow_sync_state SET data_json=$1::jsonb, masters_json=$2::jsonb, updated_at=NOW() WHERE state_key='default'`,
      [JSON.stringify(data), JSON.stringify(masters)],
    );
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

// One-time cleanup for boxes created from workbook typos ("0SC-157",
// "OSC--208"). Each typo box is merged into its real box (items move, typo box
// is closed) or, if there's no real box, renamed. dryRun only returns the plan.
async function mergeTypoBoxes(dryRun = true) {
  const db = pool();
  await ensureBoxAuditSchema(db);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const state = await client.query(`SELECT data_json, masters_json FROM workflow_sync_state WHERE state_key='default' LIMIT 1 FOR UPDATE`);
    if (!state.rows.length) throw new Error('Houston workflow state is unavailable.');
    const data = { ...(state.rows[0].data_json || {}) };
    const filtered = filterDeleted(data);
    const entries = filtered.entries.slice();
    const containers = filtered.containers.slice();
    const now = Date.now();
    const boxEvents = [];
    const plan = [];

    for (let i = 0; i < containers.length; i += 1) {
      const typo = containers[i];
      const code = str(typo?.code, 120).toUpperCase();
      const fixed = normalizeBoxCode(code);
      // Only box-code typos ("0SC-157", "OSC--208"), not other names.
      if (!fixed || fixed === code || !BOX_CODE_SHAPE.test(fixed)) continue;
      const items = entries.filter(entry => String(entry?.containerId || '') === String(typo.id));
      const real = containers.find(c => String(c.id) !== String(typo.id) && str(c?.code, 120).toUpperCase() === fixed);
      // If both boxes hold a place and the typo box has items, merging would
      // move those items to the real box's location: someone has to decide.
      const conflict = Boolean(real) && items.length > 0
        && normalizeLocation(typo.currentLocation) !== normalizeLocation(real.currentLocation);
      plan.push({
        from: code, to: fixed, action: conflict ? 'needs-decision' : real ? 'merge' : 'rename', items: items.length,
        pos: items.map(entry => str(entry?.po, 40)).slice(0, 30),
        fromLocation: str(typo.currentLocation, 60), toLocation: str(real?.currentLocation, 60),
        locationsDiffer: Boolean(real) && normalizeLocation(typo.currentLocation) !== normalizeLocation(real.currentLocation),
        fromStatus: str(typo.status, 30), toStatus: str(real?.status, 30),
      });
      if (dryRun || conflict) continue;
      if (!real) {
        containers[i] = { ...typo, code: fixed, updatedAt: now };
        for (let j = 0; j < entries.length; j += 1) {
          if (String(entries[j]?.containerId || '') === String(typo.id)) entries[j] = { ...entries[j], containerCode: fixed, updatedAt: now };
        }
        boxEvent(boxEvents, containers[i], 'renamed', 'Typo cleanup', 'Typo cleanup', { from: code, to: fixed });
        continue;
      }
      // Items join the real box and take its location.
      for (let j = 0; j < entries.length; j += 1) {
        if (String(entries[j]?.containerId || '') !== String(typo.id)) continue;
        entries[j] = { ...entries[j], containerId: real.id, containerCode: real.code, location: real.currentLocation, updatedAt: now };
        boxEvent(boxEvents, typo, 'po-moved-out', 'Typo cleanup', 'Typo cleanup', { po: entries[j].po, to: real.code });
        boxEvent(boxEvents, real, 'po-moved-in', 'Typo cleanup', 'Typo cleanup', { po: entries[j].po, from: code });
      }
      containers[i] = { ...typo, status: 'Closed', notes: `Merged into ${real.code} (typo cleanup).`, updatedAt: now };
      boxEvent(boxEvents, containers[i], 'merged', 'Typo cleanup', 'Typo cleanup', { to: real.code, quantity: items.length });
    }

    if (!dryRun && plan.length) {
      data.overstockEntries = entries;
      data.overstockContainers = containers;
      await persistBoxEvents(client, boxEvents);
      await client.query(`UPDATE workflow_sync_state SET data_json=$1::jsonb, updated_at=NOW() WHERE state_key='default'`, [JSON.stringify(data)]);
    }
    await client.query(dryRun ? 'ROLLBACK' : 'COMMIT');
    return { dryRun, plan };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

function excelRow(entry) {
  return {
    po: str(entry?.po, 120),
    deliveryId: str(entry?.deliveryId, 120),
    quantity: Math.max(0, Math.round(num(entry?.quantity, 0))),
    location: str(entry?.location, 120),
    containerCode: str(entry?.containerCode, 120),
    disposition: str(entry?.action, 120),
    note: str(entry?.note, 1000),
  };
}

async function sendExcelEvent(event) {
  const webhookUrl = env('OVERSTOCK_EXCEL_WEBHOOK_URL');
  if (!webhookUrl) return { configured: false, ok: false, status: 'not-connected' };

  let parsed;
  try { parsed = new URL(webhookUrl); } catch { return { configured: true, ok: false, status: 'invalid-webhook-url' }; }
  if (parsed.protocol !== 'https:') return { configured: true, ok: false, status: 'invalid-webhook-url' };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EXCEL_WEBHOOK_TIMEOUT_MS);
  try {
    const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json, text/plain, */*' };
    const syncKey = env('OVERSTOCK_EXCEL_WEBHOOK_SECRET');
    if (syncKey) headers['x-overstock-sync-key'] = syncKey;
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(event),
      signal: controller.signal,
    });
    const text = str(await response.text().catch(() => ''), 500);
    return { configured: true, ok: response.ok, status: response.status, response: text };
  } catch (error) {
    return { configured: true, ok: false, status: error?.name === 'AbortError' ? 'timeout' : 'request-failed', error: str(error?.message, 300) };
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Overstock -> workbook (pulled by the workbook's sync button)
//
// The workbook script asks for Overstock items changed since its last
// successful pull and writes their location, box and disposition into the
// Daily Log. Quantity and notes are never sent: the workbook's Overstock Qty
// is a formula. The cursor lives here so the workbook needs no extra sheet.
// ---------------------------------------------------------------------------
// First pull: Overstock changes since the workbook last added items (Sep 23).
// (Cursor table renamed from overstock_excel_pull_state on 2026-10-06 to
// restart from Sep 23: the first script version confirmed a pull before its
// Daily Log writes had been applied, and those writes failed.)
const EXCEL_PULL_FIRST_SINCE = Date.parse('2026-09-23T00:00:00-04:00');

async function ensureExcelPullSchema(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS overstock_excel_pull_cursor (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    cursor_ms BIGINT NOT NULL,
    acked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
}

// Newest of the item's own timestamps. Moving a box only bumps its items'
// updatedAt (not lastChangedAt), so taking the first one present missed moves.
const changedAt = (row) => Math.max(...['lastChangedAt', 'lastEditedAt', 'updatedAt', 'createdAt', 'donatedAt']
  .map((key) => Number(row?.[key]) || 0));
const pullKey = (row) => {
  const deliveryId = str(row?.deliveryId, 120).toUpperCase();
  return deliveryId ? `D:${deliveryId}` : `P:${normalizePo(row?.po)}`;
};

async function excelPullChanges(db) {
  await ensureExcelPullSchema(db);
  const saved = await db.query('SELECT cursor_ms FROM overstock_excel_pull_cursor WHERE id=1');
  const since = saved.rows[0] ? Number(saved.rows[0].cursor_ms) : EXCEL_PULL_FIRST_SINCE;
  const cursor = Date.now();
  const state = await db.query(`SELECT data_json FROM workflow_sync_state WHERE state_key='default' LIMIT 1`);
  const filtered = filterDeleted(state.rows[0]?.data_json || {});
  const boxes = new Map(filtered.containers.map((box) => [String(box.id), box]));
  const isDonated = (entry) => str(entry?.action, 60).toLowerCase() === 'donated' || str(entry?.status, 60) === 'Donation';

  // An item counts as changed if it, or the box it sits in, changed.
  const boxChangedAt = (entry) => changedAt(boxes.get(String(entry?.containerId || '')));
  const changedKeys = new Set();
  for (const entry of filtered.entries) {
    if (Math.max(changedAt(entry), boxChangedAt(entry)) > since) changedKeys.add(pullKey(entry));
  }
  for (const donation of filtered.donations) if (changedAt(donation) > since) changedKeys.add(pullKey(donation));
  changedKeys.delete('P:');

  const changes = [];
  for (const key of changedKeys) {
    const all = filtered.entries.filter((entry) => pullKey(entry) === key);
    const active = all.filter((entry) => !isDonated(entry));
    const donated = all.filter(isDonated);
    const donations = filtered.donations.filter((donation) => pullKey(donation) === key);
    const places = active.map((entry) => {
      const box = boxes.get(String(entry.containerId || '')) || {};
      return { containerCode: str(box.code || entry.containerCode, 120), location: str(box.currentLocation || entry.location, 120) };
    });
    const codes = [...new Set(places.map((p) => p.containerCode).filter(Boolean))];
    const locations = [...new Set(places.map((p) => p.location).filter(Boolean))];
    const latest = [...all].sort((a, b) => changedAt(b) - changedAt(a))[0] || donations[0] || {};
    changes.push({
      deliveryId: key.startsWith('D:') ? key.slice(2) : '',
      po: normalizePo(latest.po || (key.startsWith('P:') ? key.slice(2) : '')),
      disposition: active.length ? 'Required' : (donated.length || donations.length) ? 'Donated' : '',
      // Only one place can be written into the row's single box/location cells.
      containerCode: codes.length === 1 ? codes[0] : '',
      location: locations.length === 1 ? locations[0] : '',
      splitAcrossBoxes: codes.length > 1 || locations.length > 1,
      activeQuantity: active.reduce((sum, entry) => sum + (Number(entry.quantity) || 0), 0),
      changedBy: str(latest.lastChangedBy || latest.lastEditedBy || latest.originalAssociate || latest.associate || latest.donatedBy, 120),
      changedAt: changedAt(latest) || null,
    });
  }
  changes.sort((a, b) => (a.changedAt || 0) - (b.changedAt || 0));
  // What each Daily Log row said at the last push, so the script can tell a
  // row someone just edited (and leave it alone) from a stale one.
  await ensureExcelRowMemorySchema(db);
  const memory = await db.query('SELECT row_key, location FROM overstock_excel_row_memory');
  const rowMemory = Object.fromEntries(memory.rows.map((row) => [row.row_key, row.location]));
  return { since, cursor, firstPull: !saved.rows[0], changes, rowMemory };
}

async function ackExcelPull(db, cursor) {
  const value = Math.floor(Number(cursor));
  if (!Number.isFinite(value) || value <= 0 || value > Date.now() + 60000) throw new Error('Invalid pull cursor.');
  await ensureExcelPullSchema(db);
  await db.query(`INSERT INTO overstock_excel_pull_cursor(id,cursor_ms,acked_at) VALUES(1,$1,NOW())
    ON CONFLICT(id) DO UPDATE SET cursor_ms=GREATEST(overstock_excel_pull_cursor.cursor_ms,EXCLUDED.cursor_ms),acked_at=NOW()`, [value]);
}

function excelKeyOk(request) {
  const expected = env('OVERSTOCK_EXCEL_IMPORT_SECRET');
  const supplied = request.headers.get('x-overstock-import-key') || '';
  return Boolean(expected) && safeEqual(supplied, expected);
}

async function readBoxHistory(db, search) {
  await ensureBoxAuditSchema(db);
  const term = str(search, 160);
  if (!term) throw new Error('Enter a box code to view its history.');
  const state = await db.query(
    `SELECT data_json FROM workflow_sync_state WHERE state_key='default' LIMIT 1`
  );
  const data = state.rows[0]?.data_json || {};
  const filtered = filterDeleted(data);
  const box = filtered.containers.find(item =>
    String(item.id) === term || str(item.code, 120).toUpperCase() === term.toUpperCase()
  ) || null;
  const code = box ? str(box.code, 120) : term.toUpperCase();
  const events = await db.query(box
    ? `SELECT * FROM overstock_box_events WHERE container_id=$1 ORDER BY occurred_at DESC,id DESC`
    : `SELECT * FROM overstock_box_events WHERE UPPER(container_code)=$1 ORDER BY occurred_at DESC,id DESC`,
    [box ? String(box.id) : code]);
  const history = events.rows.map(row => ({
    id: row.id,
    type: row.event_type,
    source: row.source,
    actor: row.actor,
    po: row.po,
    detail: row.detail || {},
    at: row.occurred_at,
  }));

  // The previous activity feed kept only 50 entries. Include any older
  // activity that still survives it, without duplicating new durable events.
  const firstPermanentAt = history.length
    ? Math.min(...history.map(item => new Date(item.at).getTime()))
    : Infinity;
  const activities = Array.isArray(filtered.activities) ? filtered.activities : [];
  for (const activity of activities) {
    const sameBox = box
      ? String(activity.containerId) === String(box.id)
      : str(activity.containerCode, 120).toUpperCase() === code;
    if (!sameBox || Number(activity.createdAt || 0) >= firstPermanentAt - 1000) continue;
    history.push({
      id: String(activity.id || crypto.randomUUID()),
      type: str(activity.type, 80),
      source: 'Legacy activity',
      actor: str(activity.actor, 120),
      po: str(activity.po, 120),
      detail: { summary: str(activity.summary, 300), location: str(activity.location, 120) },
      at: new Date(Number(activity.createdAt || Date.now())).toISOString(),
    });
  }

  if (box && !history.some(event => event.type === 'created'
      || (event.source === 'Legacy activity' && /created box/i.test(str(event.detail?.summary, 300))))) {
    const relatedCreation = activities.find(a =>
      String(a.containerId) === String(box.id)
      && /created box/i.test(str(a.summary, 300))
    );
    const source = box.createdSource || (isExcelCreatedBox(box) ? 'Excel Sync' : 'Legacy / unknown');
    history.push({
      id: `legacy-created:${box.id}`,
      type: 'created',
      source,
      actor: box.createdBy || relatedCreation?.actor || (isExcelCreatedBox(box) ? 'Excel Sync' : 'Not recorded'),
      po: '',
      detail: {
        summary: 'Original creation record (detailed tracking began later)',
        location: box.currentLocation || '',
        notes: box.notes || '',
      },
      at: new Date(Number(box.createdAt || Date.now())).toISOString(),
    });
  }
  history.sort((a,b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return {
    box: box
      ? {
          id: box.id, code: box.code, status: box.status,
          location: box.currentLocation, notes: box.notes,
          createdAt: box.createdAt || null,
          createdSource: box.createdSource || (isExcelCreatedBox(box) ? 'Excel Sync' : 'Legacy / unknown'),
          createdBy: box.createdBy || '',
          poCount: filtered.entries.filter(entry => String(entry.containerId) === String(box.id)).length,
        }
      : { id: '', code, status: 'Deleted or not in current inventory', createdSource: 'Unknown' },
    events: history,
  };
}

async function readSnapshot(db) {
  const r = await db.query(`SELECT data_json, masters_json, updated_at FROM workflow_sync_state WHERE state_key='default' LIMIT 1`);
  const row = r.rows[0] || { data_json: {}, masters_json: {}, updated_at: null };
  const data = row.data_json || {};
  const masters = row.masters_json || {};
  const filtered = filterDeleted(data);
  const visibleEntries = await enrichExcelOwnershipFromHistory(db, filtered.entries);
  const visibleIds = new Set(visibleEntries.map(entry => String(entry.id)));
  const visibleDonations = filtered.donations.filter(donation => {
    const sourceEntryId = str(donation?.entryId, 160);
    return !sourceEntryId || visibleIds.has(sourceEntryId) || !isUnknownAssociate(donation?.originalAssociate || donation?.associate);
  });
  const locations = Array.isArray(masters.overstockLocations) && masters.overstockLocations.length
    ? masters.overstockLocations
    : Array.from({ length: 24 }, (_, i) => `E-${i + 1}`);
  const categories = Array.isArray(masters.categories) ? masters.categories : [];
  const associates = Array.isArray(masters.associates) ? masters.associates : [];
  const donationInfo = await readDonationInfo(db, visibleEntries).catch(() => null);
  return {
    entries: visibleEntries,
    donationInfo,
    containers: filtered.containers,
    donations: visibleDonations,
    activities: filtered.activities,
    locations,
    categories,
    associates,
    updatedAt: row.updated_at,
    excelSync: excelConnectionState(),
  };
}

async function mutate(action, body, actor = '', adminOrLead = false) {
  const db = pool();
  await ensureBoxAuditSchema(db);
  const client = await db.connect();
  let excelEvent = null;
  try {
    await client.query('BEGIN');
    const r = await client.query(`SELECT data_json FROM workflow_sync_state WHERE state_key='default' LIMIT 1 FOR UPDATE`);
    if (!r.rows.length) throw new Error('Houston workflow state is unavailable.');
    const data = { ...(r.rows[0].data_json || {}) };
    const filtered = filterDeleted(data);
    let entries = filtered.entries.slice();
    let containers = filtered.containers.slice();
    let donations = filtered.donations.slice();
    let activities = filtered.activities.slice();
    let entryTombs = filtered.entryTombs.slice();
    let containerTombs = filtered.containerTombs.slice();
    let donationTombs = filtered.donationTombs.slice();
    const now = Date.now();
    const boxEvents = [];
    let savedEntryId = '';
    let savedContainerId = '';
    let retiredEmptyExcelBoxes = 0;
    let transientIntakeContainer = null;

    const addActivity = ({ type='update', entry=null, container=null, summary='', po='', entryId='', containerId='', containerCode='', location='' } = {}) => {
      const activity = {
        id: crypto.randomUUID(),
        type: str(type, 50) || 'update',
        actor: str(actor || 'Unknown', 120),
        summary: str(summary, 300),
        po: str(po || entry?.po, 120),
        entryId: str(entryId || entry?.id, 160),
        containerId: str(containerId || entry?.containerId || container?.id, 160),
        containerCode: str(containerCode || entry?.containerCode || container?.code, 120),
        location: str(location || entry?.location || container?.currentLocation, 120),
        createdAt: now,
      };
      activities.unshift(activity);
      activities = activities.slice(0, 50);
    };

    const donateRecordFor = (entry, donatedBy = '') => {
      const originalAssociate = str(entry?.originalAssociate || entry?.associate || 'unknown', 120);
      const actor = str(donatedBy || entry?.lastChangedBy || originalAssociate || 'unknown', 120);
      let record = donations.find(d => String(d?.entryId || '') === String(entry?.id || ''));
      if (!record) {
        record = {
          id: crypto.randomUUID(),
          entryId: str(entry?.id, 160),
          po: str(entry?.po, 120),
          deliveryId: str(entry?.deliveryId, 120),
          quantity: Math.max(0, Math.round(num(entry?.quantity, 0))),
          category: str(entry?.category, 120),
          containerId: str(entry?.containerId, 160),
          containerCode: str(entry?.containerCode, 120),
          location: str(entry?.location, 120),
          associate: originalAssociate,
          originalAssociate,
          lastChangedBy: actor,
          note: str(entry?.note, 1000),
          sizeBreakdown: entry?.sizeBreakdown ?? null,
          donatedBy: actor,
          donatedAt: now,
          createdAt: now,
          updatedAt: now,
        };
        donations.unshift(record);
      } else {
        record.originalAssociate = str(record.originalAssociate || record.associate || originalAssociate, 120);
        record.associate = record.originalAssociate;
        record.lastChangedBy = actor;
        record.donatedBy = actor;
        record.updatedAt = now;
      }
      donationTombs = donationTombs.filter(t => t.id !== String(record.id));
      return record;
    };

    const detachAsDonated = (entry, changedBy = '') => {
      const actor = str(changedBy || entry?.lastChangedBy || entry?.originalAssociate || entry?.associate || 'unknown', 120);
      return {
        ...entry,
        associate: str(entry?.originalAssociate || entry?.associate, 120),
        originalAssociate: str(entry?.originalAssociate || entry?.associate, 120),
        lastChangedBy: actor,
        lastChangedAt: now,
        status: 'Donation',
        action: 'Donated',
        location: '',
        containerId: '',
        containerCode: '',
        updatedAt: now,
      };
    };

    if (action === 'reconcileEmptyExcelBoxes') {
      if (!adminOrLead) throw new Error('Admin or Team Lead access is required to reconcile boxes.');
      // Existing unknown-prepper rows may be hidden from the Overstock screen.
      // Use the same visible-record rule as the UI, never touching manual boxes.
      const visible = await enrichExcelOwnershipFromHistory(client, entries);
      const occupiedIds = new Set(visible.filter(entry => str(entry.action, 120).toLowerCase() !== 'donated')
        .map(entry => String(entry.containerId || '')).filter(Boolean));
      for (let i = 0; i < containers.length; i += 1) {
        const box = containers[i];
        if (!isExcelCreatedBox(box) || box.retainEmpty === true
          || str(box.status, 80).toLowerCase() === 'closed'
          || occupiedIds.has(String(box.id))) continue;
        containers[i] = { ...box, status: 'Closed', updatedAt: now };
        retiredEmptyExcelBoxes += 1;
        boxEvent(boxEvents, containers[i], 'auto-retired-empty', 'Reconciliation', actor,
          { reason: 'Excel-generated box has no visible POs; retained for physical review' });
        addActivity({ type:'box', container:containers[i],
          summary:`retired empty Excel-generated box ${box.code}` });
      }
    } else if (action === 'intakeAddEntry') {
      const draft = { ...(body.container || {}) };
      const candidate = { ...(body.entry || {}) };
      const code = str(draft.code, 120).toUpperCase();
      const quantity = Number(candidate.quantity);
      if (!actor) throw new Error('Sign in to the Hub before starting Stock Intake.');
      if (!code) throw new Error('A box code is required.');
      if (!normalizePo(candidate.po)) throw new Error('A PO number is required.');
      if (!Number.isSafeInteger(quantity) || quantity < 1) throw new Error('Enter a quantity of at least one.');
      let target = containers.find(box => str(box.code, 120).toUpperCase() === code);
      if (target && str(target.status, 80).toLowerCase() === 'closed') {
        const index = containers.findIndex(box => String(box.id) === String(target.id));
        const oldStatus = target.status;
        target = { ...target, status: target.currentLocation ? 'Stored' : 'Open', updatedAt: now };
        containers[index] = target;
        boxEvent(boxEvents, target, 'reopened', 'Stock Intake', actor, { from: oldStatus });
      }
      if (!target) {
        const location = str(draft.currentLocation, 120).toUpperCase();
        if (!location) throw new Error('Choose a location for the new box.');
        target = cleanContainer({
          code, currentLocation: location, status: 'Stored',
          notes: 'Created through Stock Intake',
          createdSource: 'Stock Intake',
          createdBy: actor,
        });
        if (body.donateNow === true) {
          // A donation-only intake must not leave a box with zero POs.
          transientIntakeContainer = target;
        } else {
          containers.push(target);
          boxEvent(boxEvents, target, 'created', 'Stock Intake', actor,
            { location, po: normalizePo(candidate.po) });
          addActivity({ type: 'box', container: target,
            summary: `created box ${target.code} through Stock Intake` });
        }
      }
      body.entry = {
        ...candidate, containerId: target.id, containerCode: target.code,
        location: target.currentLocation, sourceType: 'stock-intake',
      };
    }

    if (action === 'reconcileEmptyExcelBoxes') {
      // Already handled above. Proceed to the shared transaction commit.
    } else if (action === 'upsertEntry' || action === 'intakeAddEntry') {
      const incoming = { ...(body.entry || {}) };
      const idx = entries.findIndex(e => String(e?.id || '') === String(incoming.id || ''));
      const existing = idx >= 0 ? entries[idx] : null;
      const originalAssociate = str(existing?.originalAssociate || existing?.associate || actor, 120);
      if (!actor) throw new Error('A signed-in Hub user is required.');
      incoming.associate = originalAssociate;
      incoming.originalAssociate = originalAssociate;
      incoming.lastChangedBy = actor;
      const saved = cleanEntry(incoming, existing);
      if (!saved.po) throw new Error('PO number is required.');
      if (!saved.containerId) throw new Error('A container is required.');
      const container = containers.find(c => String(c.id) === saved.containerId)
        || (transientIntakeContainer?.id === saved.containerId ? transientIntakeContainer : null);
      if (!container) throw new Error('Selected container was not found.');
      saved.containerCode = container.code || saved.containerCode;
      saved.location = container.currentLocation || saved.location;
      if (idx >= 0) entries[idx] = saved; else entries.push(saved);
      entryTombs = entryTombs.filter(t => t.id !== saved.id);
      savedEntryId = saved.id;
      savedContainerId = transientIntakeContainer?.id === saved.containerId ? '' : saved.containerId;
      const source = action === 'intakeAddEntry' ? 'Stock Intake' : 'Overstock';
      if (!transientIntakeContainer) {
        if (existing && String(existing.containerId) !== String(saved.containerId)) {
          const previous = containers.find(box => String(box.id) === String(existing.containerId));
          boxEvent(boxEvents, previous, 'po-moved-out', source, actor,
            { po: saved.po, to: saved.containerCode, quantity: existing.quantity });
          poEvent(boxEvents, container, 'po-moved-in', source, actor,
            { po: saved.po, from: previous?.code || existing.containerCode, quantity: saved.quantity });
        } else {
          poEvent(boxEvents, container, existing ? 'po-updated' : 'po-added', source, actor,
            { po: saved.po, quantity: saved.quantity, previousQuantity: existing?.quantity ?? null });
        }
      }
      let finalSaved = saved;
      if (body.donateNow === true) {
        donateRecordFor(saved, actor);
        finalSaved = detachAsDonated(saved, actor);
        const savedIndex = entries.findIndex(e => String(e.id) === String(saved.id));
        if (savedIndex >= 0) entries[savedIndex] = finalSaved;
        addActivity({ type:'donation', entry:saved, summary:`sent PO ${saved.po} → Donation Pool` });
        if (!transientIntakeContainer) poEvent(boxEvents, container, 'po-donated', source, actor,
          { po: saved.po, quantity: saved.quantity });
      } else if (!existing) {
        addActivity({ type:'added', entry:saved, summary:`added PO ${saved.po} → ${saved.containerCode || 'Overstock'}` });
      } else {
        let summary = `updated PO ${saved.po}`;
        if (str(existing.action,120) !== str(saved.action,120)) summary = `changed PO ${saved.po} → ${saved.action || 'Updated'}`;
        else if (String(existing.containerId || '') !== String(saved.containerId || '')) summary = `moved PO ${saved.po} → ${saved.containerCode || 'another box'}`;
        else if (Number(existing.quantity || 0) !== Number(saved.quantity || 0)) summary = `changed PO ${saved.po} quantity → ${Number(saved.quantity || 0).toLocaleString()}`;
        else if (str(existing.category,120) !== str(saved.category,120)) summary = `updated PO ${saved.po} → ${saved.category || 'Uncategorized'}`;
        addActivity({ type:'updated', entry:saved, summary });
      }
      excelEvent = {
        event: 'entry.upserted',
        source: 'overstock-control',
        occurredAt: new Date().toISOString(),
        rows: [excelRow(finalSaved)],
      };
    } else if (action === 'donateEntry') {
      const id = str(body.id, 160);
      if (!id) throw new Error('Entry id is required.');
      const idx = entries.findIndex(e => String(e?.id || '') === id);
      if (idx < 0) throw new Error('Overstock entry was not found.');
      const existing = entries[idx];
      if (!actor) throw new Error('A signed-in Hub user is required.');
      if (!adminOrLead) {
        const readiness = donationReadiness(await readDonationInfo(db, entries), existing.po);
        if (readiness.status === 'waiting') throw new Error(`PO ${existing.po} is not ready to donate until ${readiness.readyOn}. A lead or admin can donate it early.`);
        if (readiness.status === 'needs-assembly-date') throw new Error(`PO ${existing.po} is Pack Builder and has no assembly date yet. Ask a lead or admin.`);
      }
      donateRecordFor(existing, actor);
      const donated = detachAsDonated(existing, actor);
      entries[idx] = donated;
      addActivity({ type:'donation', entry:existing, summary:`sent PO ${existing.po} → Donation Pool` });
      boxEvent(boxEvents, containers.find(box => String(box.id) === String(existing.containerId)),
        'po-donated', 'Overstock', actor, { po: existing.po, quantity: existing.quantity });
      excelEvent = {
        event: 'entry.upserted',
        source: 'overstock-control',
        occurredAt: new Date().toISOString(),
        rows: [excelRow(donated)],
      };
    } else if (action === 'migrateDonations') {
      const migrated = [];
      for (let i = 0; i < entries.length; i += 1) {
        const entry = entries[i];
        const isDonated = str(entry?.action, 120).toLowerCase() === 'donated';
        const stillAttached = Boolean(entry?.containerId || entry?.containerCode || entry?.location);
        if (!isDonated || !stillAttached) continue;
        const actor = str(entry?.lastChangedBy || entry?.originalAssociate || entry?.associate || 'unknown', 120);
        donateRecordFor(entry, actor);
        entries[i] = detachAsDonated(entry, actor);
        migrated.push(entries[i]);
        boxEvent(boxEvents, containers.find(box => String(box.id) === String(entry.containerId)),
          'po-donated', 'Migration', 'System', { po: entry.po, quantity: entry.quantity,
            reason: 'Migrated an existing donation' });
      }
      excelEvent = migrated.length ? {
        event: 'entry.upserted',
        source: 'overstock-control',
        occurredAt: new Date().toISOString(),
        rows: migrated.map(excelRow),
      } : null;
    } else if (action === 'deleteEntry') {
      const id = str(body.id, 160);
      if (!id) throw new Error('Entry id is required.');
      const existing = entries.find(e => String(e.id) === id) || null;
      if (existing) {
        addActivity({ type:'deleted', entry:existing, summary:`deleted PO ${existing.po}` });
        const box = containers.find(c => String(c.id) === String(existing.containerId));
        poEvent(boxEvents, box, 'po-deleted', 'Overstock', actor, {
          po: existing.po,
          deliveryId: existing.deliveryId,
          quantity: existing.quantity,
          category: existing.category,
          action: existing.action,
          location: box?.currentLocation || existing.location,
          notes: existing.note,
          addedBy: existing.originalAssociate || existing.associate,
        });
      }
      entries = entries.filter(e => String(e.id) !== id);
      entryTombs = normalizeTombs([...entryTombs, { id, ts: now }]);
      excelEvent = {
        event: 'entry.deleted',
        source: 'overstock-control',
        occurredAt: new Date().toISOString(),
        rows: existing ? [excelRow(existing)] : [],
      };
    } else if (action === 'upsertContainer') {
      const incoming = { ...(body.container || {}) };
      const idx = containers.findIndex(c => String(c?.id || '') === String(incoming.id || ''));
      const existing = idx >= 0 ? containers[idx] : null;
      if (!str(incoming.code || existing?.code, 120)) incoming.code = nextContainerCode(containers);
      const saved = cleanContainer({
        ...incoming,
        ...(!existing ? { createdSource: 'Manual', createdBy: actor } : {}),
        ...(existing && str(existing.status, 80).toLowerCase() === 'closed'
          && str(incoming.status, 80).toLowerCase() !== 'closed'
          ? { retainEmpty: true } : {}),
      }, existing);
      if (!saved.code) throw new Error('Container code is required.');
      const duplicate = containers.find(c => c.id !== saved.id && String(c.code || '').toUpperCase() === saved.code.toUpperCase());
      if (duplicate) throw new Error(`Container ${saved.code} already exists.`);
      if (idx >= 0) containers[idx] = saved; else containers.push(saved);
      containerTombs = containerTombs.filter(t => t.id !== saved.id);
      entries = entries.map(e => String(e.containerId) === saved.id ? { ...e, containerCode: saved.code, location: saved.currentLocation, updatedAt: now } : e);
      if (!existing) {
        addActivity({ type:'box', container:saved, summary:`created box ${saved.code}${saved.currentLocation ? ` → ${saved.currentLocation}` : ''}` });
        boxEvent(boxEvents, saved, 'created', 'Manual', actor,
          { location: saved.currentLocation, notes: saved.notes });
      } else {
        const eventType = str(existing.code, 120) !== str(saved.code, 120)
          ? 'renamed' : str(existing.currentLocation, 120) !== str(saved.currentLocation, 120)
            ? 'location-changed' : str(existing.status, 80) !== str(saved.status, 80)
              ? 'status-changed' : 'updated';
        if (eventType === 'renamed') boxEvent(boxEvents, saved, eventType, 'Overstock', actor,
          { from: existing.code, to: saved.code });
        else if (eventType === 'location-changed') {
          addActivity({ type:'box', container:saved, summary:`moved box ${saved.code} → ${saved.currentLocation || 'On cart'}` });
          boxEvent(boxEvents, saved, eventType, 'Overstock', actor,
            { from: existing.currentLocation, to: saved.currentLocation });
        } else if (eventType === 'status-changed') {
          addActivity({ type:'box', container:saved, summary:`changed box ${saved.code} → ${saved.status || 'Updated'}` });
          boxEvent(boxEvents, saved, eventType, 'Overstock', actor,
            { from: existing.status, to: saved.status });
        } else boxEvent(boxEvents, saved, 'updated', 'Overstock', actor,
          { notesChanged: str(existing.notes, 1000) !== str(saved.notes, 1000) });
      }
      excelEvent = {
        event: 'container.updated',
        source: 'overstock-control',
        occurredAt: new Date().toISOString(),
        containerCode: saved.code,
        location: saved.currentLocation,
        previousLocation: str(existing?.currentLocation, 120),
        rows: entries.filter(e => String(e.containerId) === saved.id).map(excelRow),
      };
    } else if (action === 'deleteContainer') {
      const id = str(body.id, 160);
      if (!id) throw new Error('Container id is required.');
      if (entries.some(e => String(e.containerId) === id)) throw new Error('Move or remove the items in this container before deleting it.');
      const existing = containers.find(c => String(c.id) === id) || null;
      if (existing) {
        addActivity({ type:'deleted', container:existing, summary:`deleted box ${existing.code}` });
        boxEvent(boxEvents, existing, 'deleted', 'Overstock', actor,
          { location: existing.currentLocation, notes: existing.notes });
      }
      containers = containers.filter(c => String(c.id) !== id);
      containerTombs = normalizeTombs([...containerTombs, { id, ts: now }]);
      excelEvent = {
        event: 'container.deleted',
        source: 'overstock-control',
        occurredAt: new Date().toISOString(),
        containerCode: str(existing?.code, 120),
        location: str(existing?.currentLocation, 120),
        rows: [],
      };
    } else {
      throw new Error('Unsupported action.');
    }

    data.overstockEntries = entries;
    data.overstockContainers = containers;
    data.overstockDonations = donations;
    data.overstockActivity = activities;
    data.__deletedOverstockEntryIds = entryTombs;
    data.__deletedOverstockContainerIds = containerTombs;
    data.__deletedOverstockDonationIds = donationTombs;

    await persistBoxEvents(client, boxEvents);
    await client.query(
      `UPDATE workflow_sync_state SET data_json=$1::jsonb, updated_at=NOW() WHERE state_key='default'`,
      [JSON.stringify(data)],
    );
    await client.query('COMMIT');
    return { snapshot: await readSnapshot(db), excelEvent, savedEntryId, savedContainerId, retiredEmptyExcelBoxes };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export default async (request) => {
  try {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, x-overstock-import-key',
          'Access-Control-Max-Age': '86400',
        },
      });
    }
    if (request.method === 'GET') {
      const requestUrl = new URL(request.url);
      if (requestUrl.searchParams.get('excelPull') === '1') {
        if (!excelKeyOk(request)) return json(401, { error: 'Excel sync authorization failed.' });
        return json(200, await excelPullChanges(pool()));
      }
      if (requestUrl.searchParams.has('boxHistory')) {
        if (!hubActor(request)) return json(401, { error: 'Sign in to the Work Hub to view box history.' });
        return json(200, await readBoxHistory(pool(), requestUrl.searchParams.get('boxHistory')));
      }
      const snapshot = await readSnapshot(pool());
      if (requestUrl.searchParams.get('activity') === '1') return json(200, { activities: (snapshot.activities || []).slice(0, 5), updatedAt: snapshot.updatedAt });
      return json(200, snapshot);
    }
    if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });
    const body = await request.json().catch(() => ({}));
    const action = str(body.action, 50);

    if (action === 'syncFromExcel') {
      const expected = env('OVERSTOCK_EXCEL_IMPORT_SECRET');
      const supplied = request.headers.get('x-overstock-import-key') || '';
      if (!expected || !safeEqual(supplied, expected)) return json(401, { error: 'Excel sync authorization failed.' });
      const importResult = await importExcelLocations(body.rows, body.associates);
      return json(200, { ok: true, import: importResult, snapshot: await readSnapshot(pool()) });
    }

    if (action === 'mergeTypoBoxes') {
      if (!excelKeyOk(request)) return json(401, { error: 'Excel sync authorization failed.' });
      return json(200, await mergeTypoBoxes(body.dryRun !== false));
    }

    if (action === 'ackExcelPull') {
      if (!excelKeyOk(request)) return json(401, { error: 'Excel sync authorization failed.' });
      await ackExcelPull(pool(), body.cursor);
      return json(200, { ok: true });
    }

    if (action === 'testExcelSync') {
      const excelWrite = await sendExcelEvent({
        event: 'sync.test',
        source: 'overstock-control',
        occurredAt: new Date().toISOString(),
        rows: [],
      });
      return json(200, { ok: true, excelWrite, excelSync: excelConnectionState() });
    }

    const actor = hubActor(request);
    if (!actor) return json(401, { error: 'Sign in to the Work Hub before making Overstock changes.' });
    if (action === 'setAssemblyDate') {
      if (!hubIsAdminOrLead(request)) return json(403, { error: 'Only a lead or admin can set assembly dates.' });
      const po = normalizePo(body.po);
      const date = isoDay(body.date);
      if (!po) return json(400, { error: 'PO is required.' });
      if (body.date && !date) return json(400, { error: 'Assembly date must be a date.' });
      if (date && date > warehouseToday()) return json(400, { error: 'Assembly date cannot be in the future.' });
      const db = pool();
      await ensureAssemblySchema(db);
      if (date) {
        await db.query(`INSERT INTO overstock_po_assembly (po, assembly_date, set_by, set_at) VALUES ($1,$2,$3,NOW())
          ON CONFLICT (po) DO UPDATE SET assembly_date=EXCLUDED.assembly_date, set_by=EXCLUDED.set_by, set_at=NOW()`, [po, date, actor]);
      } else {
        await db.query(`DELETE FROM overstock_po_assembly WHERE po=$1`, [po]);
      }
      return json(200, { ok: true, ...(await readSnapshot(db)) });
    }
    const result = await mutate(action, body, actor, hubIsAdminOrLead(request));
    const excelWrite = result.excelEvent ? await sendExcelEvent(result.excelEvent) : { configured: false, ok: false, status: 'no-event' };
    return json(200, { ok: true, ...result.snapshot, excelWrite });
  } catch (error) {
    return json(400, { error: str(error?.message || 'Unexpected error.', 300) });
  }
};

export const config = { path: '/api/overstock-control' };
