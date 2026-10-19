import assert from 'node:assert/strict';
import test from 'node:test';
import { loadRecordPage } from '../apps/portal/src/lib/recordPage.ts';

const unavailable = { status: 416, error: { code: 'PGRST103' }, data: null, count: null };
const ok = (data, count) => ({ status: 200, error: null, data, count });

test('loads the requested inclusive range and exact total', async () => {
  const page = await loadRecordPage(async (from, to) => {
    assert.deepEqual([from, to], [50, 99]);
    return ok([{ id: 'record51' }], 51);
  }, 50, 50);
  assert.deepEqual(page, { rows: [{ id: 'record51' }], total: 51 });
});

test('recovers a count when resolving the only record on the last page returns 416', async () => {
  const ranges = [];
  const page = await loadRecordPage(async (from, to) => {
    ranges.push([from, to]);
    return from === 300 ? unavailable : ok([{ id: 'first' }], 300);
  }, 300, 50);
  assert.deepEqual(ranges, [[300, 349], [0, 49]]);
  assert.deepEqual(page, { rows: [], total: 300 });
});

test('retries the original range if new arrivals make it valid again', async () => {
  const responses = [unavailable, ok([{ id: 'first' }], 301), ok([{ id: 'last' }], 301)];
  assert.deepEqual(await loadRecordPage(async () => responses.shift(), 300, 50), {
    rows: [{ id: 'last' }], total: 301,
  });
});

test('propagates request and count-recovery failures instead of showing an empty list', async () => {
  const failure = new Error('Access denied');
  await assert.rejects(loadRecordPage(async () => ({ ...unavailable, status: 403, error: failure }), 50, 50), /Access denied/);
  await assert.rejects(loadRecordPage(async (from) => from ? unavailable : { ...unavailable, status: 503, error: failure }, 50, 50), /Access denied/);
  await assert.rejects(loadRecordPage(async () => ok([], null), 0, 50), /record count/);
});
