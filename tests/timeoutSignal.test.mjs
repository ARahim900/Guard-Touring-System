import assert from 'node:assert/strict';
import { test } from 'node:test';
import { timeoutSignal } from '../apps/portal/src/lib/timeoutSignal.ts';

test('aborts after the delay on browsers without AbortSignal.timeout (Safari before 16)', async () => {
  const original = AbortSignal.timeout;
  AbortSignal.timeout = undefined;
  try {
    const signal = timeoutSignal(20);
    assert.equal(signal.aborted, false);
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(signal.aborted, true);
    assert.equal(signal.reason?.name, 'TimeoutError');
  } finally {
    AbortSignal.timeout = original;
  }
});

test('uses the native AbortSignal.timeout when the browser has it', () => {
  const original = AbortSignal.timeout;
  let calledWith = null;
  AbortSignal.timeout = (ms) => { calledWith = ms; return original.call(AbortSignal, ms); };
  try {
    timeoutSignal(15000);
    assert.equal(calledWith, 15000);
  } finally {
    AbortSignal.timeout = original;
  }
});

test('the portal never calls AbortSignal.timeout directly', async () => {
  const { readdir, readFile } = await import('node:fs/promises');
  const root = new URL('../apps/portal/src/', import.meta.url);
  const files = await readdir(root, { recursive: true });
  const offenders = [];
  for (const file of files) {
    if (!/\.tsx?$/.test(file) || file.endsWith('timeoutSignal.ts')) continue;
    if ((await readFile(new URL(file, root), 'utf8')).includes('AbortSignal.timeout(')) offenders.push(file);
  }
  assert.deepEqual(offenders, []);
});
