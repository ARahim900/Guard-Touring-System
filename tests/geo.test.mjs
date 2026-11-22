import assert from 'node:assert/strict';
import { test } from 'node:test';
import { distanceMetres, formatDistance, isPlaced } from '../apps/portal/src/lib/geo.ts';

test('distance between two points about 1 km apart in Muscat', () => {
  // 0.009 degrees of latitude is about 1,000 m anywhere on Earth.
  const d = distanceMetres(23.588, 58.383, 23.597, 58.383);
  assert.ok(Math.abs(d - 1000) < 5, `got ${d}`);
  assert.equal(distanceMetres(23.588, 58.383, 23.588, 58.383), 0);
});

test('distances read in metres under 1 km and kilometres above', () => {
  assert.equal(formatDistance(3), '1 m');
  assert.equal(formatDistance(234), '230 m');
  assert.equal(formatDistance(1530), '1.5 km');
});

test('a location at 0,0 counts as not placed', () => {
  assert.equal(isPlaced(0, 0), false);
  assert.equal(isPlaced(Number.NaN, 58.3), false);
  assert.equal(isPlaced(23.58, 58.38), true);
});
