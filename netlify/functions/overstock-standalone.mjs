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

function hubActor(request) {
  const token = cookieMap(request)[HUB_SESSION_COOKIE];
  const secret = env('HUB_ASSOCIATE_SESSION_SECRET');
  if (!token || !secret) return '';
  try {
    const [ivText, tagText, dataText] = String(token).split('.');
    if (!ivText || !tagText || !dataText) return '';
    const key = crypto.createHash('sha256').update(secret).digest();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivText, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(dataText, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
    const session = JSON.parse(plain);
    if (!session?.name || Number(session.exp || 0) <= Date.now()) return '';
    return str(session.name, 120);
  } catch {
    return '';
  }
}

function normalizePo(value) {
  return str(value, 120).replace(/^PO[-\s]*/i, '').trim().toUpperCase();
}

function normalizeOperationalDate(value) {
  const raw = str(value, 40);
  let match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) return `${match[1]}-${String(Number(match[2])).padStart(2, '0')}-${String(Number(match[3])).padStart(2, '0')}`;
  match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) return `${match[3]}-${String(Number(match[1])).padStart(2, '0')}-${String(Number(match[2])).padStart(2, '0')}`;
  return '';
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
  const client = await db.connect();
  const result = { received: rows.length, importedAssociates: workbookAssociates.length, createdEntries: 0, createdContainers: 0, updatedEntries: 0, updatedContainers: 0, unchanged: 0, skipped: [], unresolved: [] };

  try {
    await client.query('BEGIN');
    const state = await client.query(`SELECT data_json, masters_json FROM workflow_sync_state WHERE state_key='default' LIMIT 1 FOR UPDATE`);
    if (!state.rows.length) throw new Error('Houston workflow state is unavailable.');
    const data = { ...(state.rows[0].data_json || {}) };
    const masters = { ...(state.rows[0].masters_json || {}) };
    const filtered = filterDeleted(data);
    const entries = filtered.entries.slice();
    const containers = filtered.containers.slice();
    const now = Date.now();
    const changedContainerIds = new Set();
    const changedEntryIds = new Set();

    for (const raw of rows) {
      const po = normalizePo(raw?.po);
      const deliveryId = str(raw?.deliveryId, 120).toUpperCase();
      const associate = str(raw?.associate, 120);
      const category = str(raw?.category, 120);
      const operationalDate = normalizeOperationalDate(raw?.operationalDate);
      const location = str(raw?.location, 120).toUpperCase();
      const containerCode = str(raw?.containerCode, 120).toUpperCase();
      const key = deliveryId || po || '(blank row)';

      // Blank locations never clear Houston. This protects operational history
      // when a workbook row is incomplete or its formula has not recalculated.
      if (!location) {
        result.skipped.push(`${key}: no Overstock location.`);
        continue;
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

        let targetContainer = containerCode
          ? containers.find(container => str(container?.code, 120).toUpperCase() === containerCode)
          : null;
        if (!targetContainer) {
          targetContainer = cleanContainer({
            code: containerCode || nextContainerCode(containers),
            currentLocation: location,
            status: 'Open',
            notes: 'Created from New Daily Rec Excel sync.',
          });
          containers.push(targetContainer);
          result.createdContainers += 1;
        } else if (str(targetContainer.currentLocation, 120).toUpperCase() !== location) {
          const index = containers.findIndex(container => String(container?.id || '') === String(targetContainer.id));
          targetContainer = { ...targetContainer, currentLocation: location, updatedAt: now };
          containers[index] = targetContainer;
          changedContainerIds.add(String(targetContainer.id));
        }

        const created = cleanEntry({
          po,
          deliveryId,
          associate,
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
      if (containerCode && (matchingBoxIds.size > 1 || (!deliveryId && matches.length > 1 && str(currentBox?.code, 120).toUpperCase() !== containerCode))) {
        result.unresolved.push(`${key}: multiple boxes match; select the item to move in Overstock Control.`);
        continue;
      }

      if (category) {
        for (const match of matches) {
          const index = entries.findIndex(entry => String(entry?.id || '') === String(match?.id || ''));
          if (index < 0 || str(entries[index]?.category, 120) === category) continue;
          entries[index] = { ...entries[index], category, sourceType: 'excel-location-sync', updatedAt: now };
          changedEntryIds.add(String(entries[index].id));
        }
      }

      if (operationalDate) {
        for (const match of matches) {
          const index = entries.findIndex(entry => String(entry?.id || '') === String(match?.id || ''));
          if (index < 0 || str(entries[index]?.date, 40) === operationalDate) continue;
          entries[index] = { ...entries[index], date: operationalDate, sourceType: 'excel-location-sync', updatedAt: now };
          changedEntryIds.add(String(entries[index].id));
        }
      }

      if (associate || (deliveryId && matches.some(entry => !str(entry?.deliveryId, 120)))) {
        for (const match of matches) {
          const index = entries.findIndex(entry => String(entry?.id || '') === String(match?.id || ''));
          if (index < 0) continue;
          const current = entries[index];
          const nextAssociate = associate || str(current.associate, 120);
          const nextDeliveryId = deliveryId || str(current.deliveryId, 120);
          if (str(current.associate, 120) === nextAssociate && str(current.deliveryId, 120) === nextDeliveryId) continue;
          entries[index] = { ...current, associate: nextAssociate, deliveryId: nextDeliveryId, sourceType: 'excel-location-sync', updatedAt: now };
          changedEntryIds.add(String(current.id));
        }
      }

      if (containerCode) {
        let target = containers.find(container => str(container?.code, 120).toUpperCase() === containerCode);
        if (!target) {
          target = cleanContainer({ code: containerCode, currentLocation: location, status: 'Open', notes: 'Created from New Daily Rec Excel sync.' });
          containers.push(target);
          result.createdContainers += 1;
        }
        const targetId = String(target.id);
        const matchIds = new Set(matches.map(entry => String(entry.id)));
        for (let i = 0; i < containers.length; i += 1) {
          if (String(containers[i]?.id) !== targetId) continue;
          if (str(containers[i]?.currentLocation, 120).toUpperCase() !== location) {
            containers[i] = { ...containers[i], currentLocation: location, updatedAt: now };
            changedContainerIds.add(targetId);
          }
          break;
        }
        for (let i = 0; i < entries.length; i += 1) {
          const entry = entries[i];
          const isMatch = matchIds.has(String(entry.id));
          if (!isMatch && String(entry.containerId) !== targetId) continue;
          const corrected = isMatch && (String(entry.containerId) !== targetId || str(entry.containerCode, 120).toUpperCase() !== containerCode);
          if (!corrected && str(entry.location, 120).toUpperCase() === location) continue;
          entries[i] = {
            ...entry,
            ...(isMatch ? { containerId: targetId, containerCode } : {}),
            location,
            sourceType: 'excel-location-sync',
            updatedAt: now,
          };
          changedEntryIds.add(String(entry.id));
        }
        // The previous box may hold other POs; leave it and its location alone.
        // Any now-empty box can be reviewed and removed from the Containers view.
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
    result.unchanged = Math.max(0, rows.length - result.skipped.length - result.unresolved.length - result.createdEntries - result.updatedEntries);
    data.overstockEntries = entries;
    data.overstockContainers = containers;
    if (workbookAssociates.length) masters.associates = workbookAssociates;
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
    donations: filtered.donations,
    activities: filtered.activities,
    locations,
    categories,
    associates,
    updatedAt: row.updated_at,
    excelSync: excelConnectionState(),
  };
}

async function mutate(action, body, actor = '') {
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
    let donations = filtered.donations.slice();
    let activities = filtered.activities.slice();
    let entryTombs = filtered.entryTombs.slice();
    let containerTombs = filtered.containerTombs.slice();
    let donationTombs = filtered.donationTombs.slice();
    const now = Date.now();

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

    if (action === 'upsertEntry') {
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
      const container = containers.find(c => String(c.id) === saved.containerId);
      if (!container) throw new Error('Selected container was not found.');
      saved.containerCode = container.code || saved.containerCode;
      saved.location = container.currentLocation || saved.location;
      if (idx >= 0) entries[idx] = saved; else entries.push(saved);
      entryTombs = entryTombs.filter(t => t.id !== saved.id);
      let finalSaved = saved;
      if (body.donateNow === true) {
        donateRecordFor(saved, actor);
        finalSaved = detachAsDonated(saved, actor);
        const savedIndex = entries.findIndex(e => String(e.id) === String(saved.id));
        if (savedIndex >= 0) entries[savedIndex] = finalSaved;
        addActivity({ type:'donation', entry:saved, summary:`sent PO ${saved.po} → Donation Pool` });
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
      donateRecordFor(existing, actor);
      const donated = detachAsDonated(existing, actor);
      entries[idx] = donated;
      addActivity({ type:'donation', entry:existing, summary:`sent PO ${existing.po} → Donation Pool` });
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
      if (existing) addActivity({ type:'deleted', entry:existing, summary:`deleted PO ${existing.po}` });
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
      if (!existing) addActivity({ type:'box', container:saved, summary:`created box ${saved.code}${saved.currentLocation ? ` → ${saved.currentLocation}` : ''}` });
      else if (str(existing.currentLocation,120) !== str(saved.currentLocation,120)) addActivity({ type:'box', container:saved, summary:`moved box ${saved.code} → ${saved.currentLocation || 'On cart'}` });
      else if (str(existing.status,80) !== str(saved.status,80)) addActivity({ type:'box', container:saved, summary:`changed box ${saved.code} → ${saved.status || 'Updated'}` });
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
      if (existing) addActivity({ type:'deleted', container:existing, summary:`deleted box ${existing.code}` });
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
      const snapshot = await readSnapshot(pool());
      const requestUrl = new URL(request.url);
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
    const result = await mutate(action, body, actor);
    const excelWrite = result.excelEvent ? await sendExcelEvent(result.excelEvent) : { configured: false, ok: false, status: 'no-event' };
    return json(200, { ok: true, ...result.snapshot, excelWrite });
  } catch (error) {
    return json(400, { error: str(error?.message || 'Unexpected error.', 300) });
  }
};

export const config = { path: '/api/overstock-control' };
