import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';

globalThis.Netlify = { env: { get: name => name === 'OVERSTOCK_EXCEL_IMPORT_SECRET' ? 'test-key' : name === 'DATABASE_URL' ? 'postgres://unused' : '' } };
const pg = { Pool: class Pool { async query(...args) { return (await this.connect()).query(...args); } } };
globalThis.__testPg = pg;
const source = (await readFile(new URL('../netlify/functions/overstock-standalone.mjs', import.meta.url), 'utf8'))
  .replace("import pg from 'pg';", 'const pg = globalThis.__testPg;');
const { default: handler } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

async function sync(initial, rows) {
  let data = structuredClone(initial);
  const originalConnect = pg.Pool.prototype.connect;
  pg.Pool.prototype.connect = async () => ({
    query: async (sql, params) => {
      if (sql.includes('SELECT data_json')) return { rows: [{ data_json: data, masters_json: {} }] };
      if (sql.includes('UPDATE workflow_sync_state')) data = JSON.parse(params[0]);
      return { rows: [] };
    },
    release() {},
  });
  try {
    const response = await handler(new Request('https://example.test/api/overstock-control', {
      method: 'POST', headers: { 'x-overstock-import-key': 'test-key' },
      body: JSON.stringify({ action: 'syncFromExcel', rows }),
    }));
    assert.equal(response.status, 200, await response.clone().text());
    return { data, result: (await response.json()).import };
  } finally {
    pg.Pool.prototype.connect = originalConnect;
  }
}

test('corrected Excel box reassigns only the matching PO and keeps its original date', async () => {
  const initial = {
    overstockContainers: [{ id: 'old', code: 'WRONG', currentLocation: 'E-1' }],
    overstockEntries: [
      { id: 'target', po: '123', deliveryId: '123-P1', containerId: 'old', containerCode: 'WRONG', location: 'E-1', date: '2026-08-01' },
      { id: 'other', po: '456', deliveryId: '456-P1', containerId: 'old', containerCode: 'WRONG', location: 'E-1' },
    ],
  };
  const { data, result } = await sync(initial, [{ po: '123', deliveryId: '123-P1', containerCode: 'RIGHT', location: 'E-5' }]);
  assert.equal(result.createdContainers, 1);
  assert.equal(result.updatedEntries, 1);
  assert.deepEqual(data.overstockEntries.find(e => e.id === 'target'), {
    ...initial.overstockEntries[0], containerId: data.overstockContainers.find(c => c.code === 'RIGHT').id,
    containerCode: 'RIGHT', location: 'E-5', sourceType: 'excel-location-sync', updatedAt: data.overstockEntries[0].updatedAt,
  });
  assert.deepEqual(data.overstockEntries.find(e => e.id === 'other'), initial.overstockEntries[1]);
  assert.deepEqual(data.overstockContainers.find(c => c.id === 'old'), initial.overstockContainers[0]);
  const again = await sync(data, [{ po: '123', deliveryId: '123-P1', containerCode: 'RIGHT', location: 'E-5' }]);
  assert.equal(again.result.createdContainers, 0);
  assert.equal(again.result.updatedEntries, 0);
});

test('ambiguous PO without delivery ID leaves distinct items alone', async () => {
  const initial = {
    overstockContainers: [{ id: 'a', code: 'A', currentLocation: 'E-1' }, { id: 'b', code: 'B', currentLocation: 'E-2' }],
    overstockEntries: [{ id: 'a1', po: '789', containerId: 'a' }, { id: 'b1', po: '789', containerId: 'b' }],
  };
  const { data, result } = await sync(initial, [{ po: '789', containerCode: 'C', location: 'E-3' }]);
  assert.equal(result.unresolved.length, 1);
  assert.deepEqual(data.overstockEntries, initial.overstockEntries);
});

test('rows beyond the former 1,000-row limit are imported', async () => {
  const rows = Array.from({ length: 1000 }, () => ({ po: '', location: '' }));
  rows.push({ po: '999', deliveryId: '999-P1', containerCode: 'OSC-999', location: 'E-9' });
  const { data, result } = await sync({ overstockEntries: [], overstockContainers: [] }, rows);
  assert.equal(result.received, 1001);
  assert.equal(result.createdEntries, 1);
  assert.equal(data.overstockEntries[0].po, '999');
});

test('prep associate stays with the matching delivery part and blank names preserve prior data', async () => {
  const initial = {
    overstockContainers: [{ id: 'box1', code: 'OSC-1', currentLocation: 'E-1' }, { id: 'box2', code: 'OSC-2', currentLocation: 'E-2' }],
    overstockEntries: [
      { id: 'part1', po: '777', deliveryId: '777-P1', containerId: 'box1', containerCode: 'OSC-1', location: 'E-1', associate: 'Ana' },
      { id: 'part2', po: '777', deliveryId: '777-P2', containerId: 'box2', containerCode: 'OSC-2', location: 'E-2', associate: '' },
    ],
  };
  const { data } = await sync(initial, [{ po: '777', deliveryId: '777-P2', containerCode: 'OSC-2', location: 'E-2', associate: 'Maria' }]);
  assert.equal(data.overstockEntries.find(e => e.id === 'part1').associate, 'Ana');
  assert.equal(data.overstockEntries.find(e => e.id === 'part2').associate, 'Maria');
  const blank = await sync(data, [{ po: '777', deliveryId: '777-P2', containerCode: 'OSC-2', location: 'E-2', associate: '' }]);
  assert.equal(blank.data.overstockEntries.find(e => e.id === 'part2').associate, 'Maria');
});

test('a new split delivery creates its own PO item instead of changing another part', async () => {
  const initial = {
    overstockContainers: [{ id: 'box1', code: 'OSC-1', currentLocation: 'E-1' }],
    overstockEntries: [{ id: 'part1', po: '777', deliveryId: '777-P1', containerId: 'box1', containerCode: 'OSC-1', location: 'E-1', associate: 'Ana' }],
  };
  const { data, result } = await sync(initial, [{ po: '777', deliveryId: '777-P2', containerCode: 'OSC-2', location: 'E-2', associate: 'Maria' }]);
  assert.equal(result.createdEntries, 1);
  assert.deepEqual(data.overstockEntries.find(e => e.id === 'part1'), initial.overstockEntries[0]);
  assert.equal(data.overstockEntries.find(e => e.deliveryId === '777-P2').associate, 'Maria');
});
