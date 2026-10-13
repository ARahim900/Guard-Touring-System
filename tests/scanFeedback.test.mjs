import test from 'node:test';
import assert from 'node:assert/strict';
import { scanFeedback } from '../apps/portal/src/lib/scanFeedback.ts';

test('only an acknowledged valid scan is shown as verified',()=>{
  assert.equal(scanFeedback({state:'synced',validation:'valid'}).tone,'success');
  assert.equal(scanFeedback({state:'pending',validation:'valid'}).tone,'pending');
  assert.equal(scanFeedback({state:'synced',validation:'flagged'}).tone,'warning');
  assert.equal(scanFeedback({state:'synced'}).tone,'warning');
});
test('distance rejection explains the failure and how to retry',()=>{
  const result=scanFeedback({state:'synced',validation:'rejected',flags:['too_far']});
  assert.equal(result.tone,'danger');
  assert.match(result.title,/visit not counted/);
  assert.match(result.message,/outside.*allowed area/);
  assert.match(result.message,/scan again/);
});
test('all returned checks are explained and unknown checks remain visible',()=>{
  const result=scanFeedback({state:'synced',validation:'flagged',flags:['low_accuracy','clock_drift','new_check']});
  assert.match(result.message,/GPS signal/);
  assert.match(result.message,/automatic date and time/);
  assert.match(result.message,/new check/);
});
