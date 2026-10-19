import assert from 'node:assert/strict';
import test from 'node:test';
import { exportRecords } from '../apps/portal/src/lib/exportRecords.ts';

test('exports beyond 1,000 records even when the server caps responses below the requested size', async () => {
  const rows = Array.from({ length: 1201 }, (_, id) => ({ id: String(id) }));
  const offsets = [];
  const result = await exportRecords(async (offset, size) => {
    offsets.push(offset);
    return { rows: rows.slice(offset, offset + Math.min(size, 200)), total: rows.length };
  });
  assert.deepEqual(result, rows);
  assert.deepEqual(offsets, [0, 200, 400, 600, 800, 1000, 1200]);
});

test('an empty result produces an empty export', async () => {
  assert.deepEqual(await exportRecords(async () => ({ rows: [], total: 0 })), []);
});

test('a later network failure rejects the whole export', async () => {
  await assert.rejects(exportRecords(async (offset) => {
    if (offset) throw new Error('Connection lost');
    return { rows: [{ id: 'one' }], total: 2 };
  }), /Connection lost/);
});

test('rejects a changed count, repeated record, or premature end instead of silently truncating', async (t) => {
  for (const [name, second] of Object.entries({
    'changed count': { rows: [{ id: 'two' }], total: 3 },
    'repeated record': { rows: [{ id: 'one' }], total: 2 },
    'premature end': { rows: [], total: 2 },
  })) {
    await t.test(name, async () => {
      await assert.rejects(exportRecords(async (offset) => offset ? second : { rows: [{ id: 'one' }], total: 2 }), /Records changed/);
    });
  }
});

test('rejects missing or invalid counts', async () => {
  for (const total of [null, undefined, NaN, -1, 1.5]) {
    await assert.rejects(exportRecords(async () => ({ rows: [], total })), /export size/);
  }
});
