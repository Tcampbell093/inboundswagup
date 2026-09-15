import pg from 'pg';
import crypto from 'node:crypto';

const { Pool } = pg;
let poolInstance = null;
const TOMBSTONE_TTL_MS = 24 * 60 * 60 * 1000;
const EXCEL_WEBHOOK_TIMEOUT_MS = 8000;

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
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
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

function normalizePo(value) {
  return str(value, 120).replace(/^PO[-\s]*/i, '').trim().toUpperCase();
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
    associate: str(raw.associate ?? source.associate, 120),
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
    createdAt: num(source.createdAt || raw.createdAt, now),
    updatedAt: now,
  };
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
  const deadE = new Set(entryTombs.map(t => t.id));
  const deadC = new Set(containerTombs.map(t => t.id));
  return {
    entries: (Array.isArray(data.overstockEntries) ? data.overstockEntries : []).filter(e => e?.id && !deadE.has(String(e.id))),
    containers: (Array.isArray(data.overstockContainers) ? data.overstockContainers : []).filter(c => c?.id && !deadC.has(String(c.id))),
    entryTombs,
    containerTombs,
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
  };
}

async function importExcelLocations(rawRows) {
  const rows = Array.isArray(rawRows) ? rawRows.slice(0, 1000) : [];
  const db = pool();
  const client = await db.connect();
  const result = { received: rows.length, updatedEntries: 0, updatedContainers: 0, unchanged: 0, skipped: [], unresolved: [] };

  try {
    await client.query('BEGIN');
    const state = await client.query(`SELECT data_json FROM workflow_sync_state WHERE state_key='default' LIMIT 1 FOR UPDATE`);
    if (!state.rows.length) throw new Error('Houston workflow state is unavailable.');
    const data = { ...(state.rows[0].data_json || {}) };
    const filtered = filterDeleted(data);
    const entries = filtered.entries.slice();
    const containers = filtered.containers.slice();
    const now = Date.now();
    const changedContainerIds = new Set();
    const changedEntryIds = new Set();

    for (const raw of rows) {
      const po = normalizePo(raw?.po);
      const deliveryId = str(raw?.deliveryId, 120).toUpperCase();
      const location = str(raw?.location, 120).toUpperCase();
      const containerCode = str(raw?.containerCode, 120).toUpperCase();
      const key = deliveryId || po || '(blank row)';

      // Blank locations never clear Houston. This protects operational history
      // when a workbook row is incomplete or its formula has not recalculated.
      if (!location) {
        result.skipped.push(`${key}: no Overstock location.`);
        continue;
      }

      let matches = deliveryId
        ? entries.filter(entry => str(entry?.deliveryId, 120).toUpperCase() === deliveryId)
        : [];
      if (!matches.length && po) {
        matches = entries.filter(entry => normalizePo(entry?.po) === po);
      }
      if (!matches.length) {
        result.unresolved.push(`${key}: no Houston Overstock record found.`);
        continue;
      }

      const explicitContainer = containerCode
        ? containers.find(container => str(container?.code, 120).toUpperCase() === containerCode)
        : null;
      const containerIds = new Set(matches.map(entry => str(entry?.containerId, 160)).filter(Boolean));
      if (explicitContainer?.id) containerIds.add(String(explicitContainer.id));

      if (containerIds.size) {
        for (let i = 0; i < containers.length; i += 1) {
          if (!containerIds.has(String(containers[i]?.id || ''))) continue;
          if (str(containers[i]?.currentLocation, 120).toUpperCase() === location) continue;
          containers[i] = { ...containers[i], currentLocation: location, updatedAt: now };
          changedContainerIds.add(String(containers[i].id));
        }
        for (let i = 0; i < entries.length; i += 1) {
          if (!containerIds.has(String(entries[i]?.containerId || ''))) continue;
          if (str(entries[i]?.location, 120).toUpperCase() === location) continue;
          entries[i] = { ...entries[i], location, sourceType: 'excel-location-sync', updatedAt: now };
          changedEntryIds.add(String(entries[i].id));
        }
      } else {
        for (const match of matches) {
          const index = entries.findIndex(entry => String(entry?.id || '') === String(match?.id || ''));
          if (index < 0 || str(entries[index]?.location, 120).toUpperCase() === location) continue;
          entries[index] = { ...entries[index], location, sourceType: 'excel-location-sync', updatedAt: now };
          changedEntryIds.add(String(entries[index].id));
        }
      }
    }

    result.updatedEntries = changedEntryIds.size;
    result.updatedContainers = changedContainerIds.size;
    result.unchanged = Math.max(0, rows.length - result.skipped.length - result.unresolved.length - result.updatedEntries);
    data.overstockEntries = entries;
    data.overstockContainers = containers;
    await client.query(
      `UPDATE workflow_sync_state SET data_json=$1::jsonb, updated_at=NOW() WHERE state_key='default'`,
      [JSON.stringify(data)],
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

async function readSnapshot(db) {
  const r = await db.query(`SELECT data_json, masters_json, updated_at FROM workflow_sync_state WHERE state_key='default' LIMIT 1`);
  const row = r.rows[0] || { data_json: {}, masters_json: {}, updated_at: null };
  const data = row.data_json || {};
  const masters = row.masters_json || {};
  const filtered = filterDeleted(data);
  const locations = Array.isArray(masters.overstockLocations) && masters.overstockLocations.length
    ? masters.overstockLocations
    : Array.from({ length: 24 }, (_, i) => `E-${i + 1}`);
  const categories = Array.isArray(masters.categories) ? masters.categories : [];
  const associates = Array.isArray(masters.associates) ? masters.associates : [];
  return {
    entries: filtered.entries,
    containers: filtered.containers,
    locations,
    categories,
    associates,
    updatedAt: row.updated_at,
    excelSync: excelConnectionState(),
  };
}

async function mutate(action, body) {
  const db = pool();
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
    let entryTombs = filtered.entryTombs.slice();
    let containerTombs = filtered.containerTombs.slice();
    const now = Date.now();

    if (action === 'upsertEntry') {
      const incoming = body.entry || {};
      const idx = entries.findIndex(e => String(e?.id || '') === String(incoming.id || ''));
      const existing = idx >= 0 ? entries[idx] : null;
      const saved = cleanEntry(incoming, existing);
      if (!saved.po) throw new Error('PO number is required.');
      if (!saved.containerId) throw new Error('A container is required.');
      const container = containers.find(c => String(c.id) === saved.containerId);
      if (!container) throw new Error('Selected container was not found.');
      saved.containerCode = container.code || saved.containerCode;
      saved.location = container.currentLocation || saved.location;
      if (idx >= 0) entries[idx] = saved; else entries.push(saved);
      entryTombs = entryTombs.filter(t => t.id !== saved.id);
      excelEvent = {
        event: 'entry.upserted',
        source: 'overstock-control',
        occurredAt: new Date().toISOString(),
        rows: [excelRow(saved)],
      };
    } else if (action === 'deleteEntry') {
      const id = str(body.id, 160);
      if (!id) throw new Error('Entry id is required.');
      const existing = entries.find(e => String(e.id) === id) || null;
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
      const saved = cleanContainer(incoming, existing);
      if (!saved.code) throw new Error('Container code is required.');
      const duplicate = containers.find(c => c.id !== saved.id && String(c.code || '').toUpperCase() === saved.code.toUpperCase());
      if (duplicate) throw new Error(`Container ${saved.code} already exists.`);
      if (idx >= 0) containers[idx] = saved; else containers.push(saved);
      containerTombs = containerTombs.filter(t => t.id !== saved.id);
      entries = entries.map(e => String(e.containerId) === saved.id ? { ...e, containerCode: saved.code, location: saved.currentLocation, updatedAt: now } : e);
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
    data.__deletedOverstockEntryIds = entryTombs;
    data.__deletedOverstockContainerIds = containerTombs;

    await client.query(
      `UPDATE workflow_sync_state SET data_json=$1::jsonb, updated_at=NOW() WHERE state_key='default'`,
      [JSON.stringify(data)],
    );
    await client.query('COMMIT');
    return { snapshot: await readSnapshot(db), excelEvent };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export default async (request) => {
  try {
    if (request.method === 'GET') return json(200, await readSnapshot(pool()));
    if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });
    const body = await request.json().catch(() => ({}));
    const action = str(body.action, 50);

    if (action === 'syncFromExcel') {
      const expected = env('OVERSTOCK_EXCEL_IMPORT_SECRET');
      const supplied = request.headers.get('x-overstock-import-key') || '';
      if (!expected || !safeEqual(supplied, expected)) return json(401, { error: 'Excel sync authorization failed.' });
      const importResult = await importExcelLocations(body.rows);
      return json(200, { ok: true, import: importResult, snapshot: await readSnapshot(pool()) });
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

    const result = await mutate(action, body);
    const excelWrite = result.excelEvent ? await sendExcelEvent(result.excelEvent) : { configured: false, ok: false, status: 'no-event' };
    return json(200, { ok: true, ...result.snapshot, excelWrite });
  } catch (error) {
    return json(400, { error: str(error?.message || 'Unexpected error.', 300) });
  }
};

export const config = { path: '/api/overstock-control' };
