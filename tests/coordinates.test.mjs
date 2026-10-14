import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCoordinates } from '../apps/portal/src/lib/coordinates.ts';

test('reads pasted coordinates and Google Maps links', () => {
  assert.deepEqual(parseCoordinates('23.5413179, 58.6334875'), [23.5413179, 58.6334875]);
  assert.deepEqual(parseCoordinates(' 23.5413 58.6334 '), [23.5413, 58.6334]);
  assert.deepEqual(parseCoordinates('https://www.google.com/maps/@23.5413,58.6334,18z'), [23.5413, 58.6334]);
  assert.deepEqual(parseCoordinates('https://maps.google.com/?q=23.5413,58.6334'), [23.5413, 58.6334]);
  assert.deepEqual(parseCoordinates('https://www.google.com/maps/place/X/@23.50,58.60,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d23.5413!4d58.6334'), [23.5413, 58.6334]);
});

test('refuses text that is not a position', () => {
  for (const text of ['', 'Main Gate', '123', '95, 58', '23.5, 190', '0, 0', 'https://maps.app.goo.gl/abc']) assert.equal(parseCoordinates(text), null, text);
});
