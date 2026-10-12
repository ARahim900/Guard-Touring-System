import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { saveReceipt, readReceipts, uploadReceipts, cacheShift, cachedShift } from '../apps/portal/src/lib/guardOutbox.ts';

const fixture = (id, userId) => ({ id, userId, shiftId: 'test-shift', checkpointId: 'test-checkpoint', checkpointName: 'Test location', code: 'TEST-ONLY', method: 'qr', deviceTime: '2026-10-12T16:00:00Z', latitude: 0, longitude: 0, accuracy: 5, state: 'pending' });
const verdict = { validation: 'valid', flags: [], server_time: '2026-10-12T16:10:00Z' };

test('web outbox isolates accounts and snapshots', async () => {
  await saveReceipt(fixture('account-a-1', 'account-a'));
  await saveReceipt(fixture('account-b-1', 'account-b'));
  assert.deepEqual((await readReceipts('account-a')).map(row => row.id), ['account-a-1']);
  await cacheShift('account-a', { shift: 'a' });
  assert.equal(await cachedShift('account-b'), undefined);
  assert.equal((await cachedShift('account-a')).shift, 'a');
});

test('failed upload stays durable and retry preserves the original ID, time and GPS', async () => {
  const original = fixture('retry-id', 'retry-user');
  await saveReceipt(original);
  await assert.rejects(uploadReceipts('retry-user', async () => { throw new Error('Test network failure'); }));
  const [pending] = await readReceipts('retry-user');
  assert.equal(pending.state, 'pending');
  assert.equal(pending.error, 'Test network failure');
  await uploadReceipts('retry-user', async row => {
    for (const key of ['id', 'deviceTime', 'latitude', 'longitude', 'accuracy']) assert.equal(row[key], original[key]);
    return verdict;
  });
  const [saved] = await readReceipts('retry-user');
  assert.equal(saved.state, 'synced');
  assert.equal(saved.error, undefined);
  assert.equal(saved.serverTime, verdict.server_time);
});

test('concurrent sync calls submit once and acknowledged records are not submitted again', async () => {
  await saveReceipt(fixture('concurrent-id', 'concurrent-user'));
  let calls = 0;
  const send = async () => { calls++; return verdict; };
  await Promise.all([uploadReceipts('concurrent-user', send), uploadReceipts('concurrent-user', send)]);
  await uploadReceipts('concurrent-user', send);
  assert.equal(calls, 1);
});

test('server rejection is retained as evidence, not retried or counted as verified', async () => {
  await saveReceipt(fixture('reject-id', 'reject-user'));
  await uploadReceipts('reject-user', async () => ({ ...verdict, validation: 'rejected', flags: ['too_far'] }));
  const [saved] = await readReceipts('reject-user');
  assert.equal(saved.state, 'synced');
  assert.equal(saved.validation, 'rejected');
  assert.deepEqual(saved.flags, ['too_far']);
});
