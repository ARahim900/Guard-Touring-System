// F02 (GitHub issue #5): pattern checks that flag suspicious scans for review.
import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

let db;
// Sample positions about 1 degree of latitude = 111 km apart.
const points = {
  A: { id: randomUUID(), lat: 23.5, lng: 58.5 },
  B: { id: randomUUID(), lat: 23.503, lng: 58.5 },   // about 330 m from A
  C: { id: randomUUID(), lat: 23.55, lng: 58.5 },    // about 5.5 km from A
  D: { id: randomUUID(), lat: 23.5004, lng: 58.5 },  // about 45 m from A
  E: { id: randomUUID(), lat: 23.5, lng: 58.5 },     // same spot as A
};
const day = '2027-03-01';
const at = (hhmmss) => `${day}T${hhmmss}+04:00`;

async function asUser(id) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id ?? '']);
  if (id) await db.exec('set role authenticated');
}
async function settings(values) {
  await asUser(null);
  for (const [key, value] of Object.entries(values)) {
    await db.query(`update public.app_settings set ${key} = $1 where id = 1`, [value]);
  }
}
// A fresh active shift whose route visits the named points in order.
// Each shift gets its own guard: a guard may have only one active shift.
async function shiftVisiting(...names) {
  await asUser(null);
  const route = randomUUID(), shift = randomUUID(), guard = randomUUID();
  await db.query("insert into auth.users(id,email) values ($1,$2)", [guard, `${guard}@example.invalid`]);
  await db.query('insert into public.routes(id,name) values ($1,$2)', [route, `Route ${route}`]);
  for (const [i, name] of names.entries()) {
    await db.query('insert into public.route_checkpoints(route_id,checkpoint_id,sequence,due_offset_min) values ($1,$2,$3,0)',
      [route, points[name].id, i + 1]);
  }
  await db.query(`insert into public.shifts(id,guard_id,route_id,scheduled_start,scheduled_end,actual_start,status,on_duty_name)
    values ($1,$2,$3,$4,$5,$4,'active','Sample guard')`, [shift, guard, route, at('21:00:00'), `2027-03-02T05:00:00+04:00`]);
  return { shift, guard };
}
// Scan point `name` at `time`, standing at `position` (defaults to the point itself).
async function scan({ shift, guard }, name, time, position = points[name]) {
  await asUser(guard);
  const { rows } = await db.query(
    `select (public.submit_scan($1,$2,$3,'qr',$4,'normal',null,$5::timestamptz,public.test_now(),$6,$7,5,false,0)).*`,
    [randomUUID(), shift, points[name].id, `PATTERN-${name}`, at(time), position.lat, position.lng]);
  return rows[0];
}

before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}'::jsonb);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function public.test_now() returns timestamptz language sql stable as $$select current_setting('test.now')::timestamptz$$;
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`);
  await db.query("select set_config('test.now', $1, false)", [at('22:00:00')]);
  const folder = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(folder)).filter((n) => n.endsWith('.sql') && !n.includes('00400')).sort()) {
    await db.exec((await readFile(new URL(name, folder), 'utf8')).replaceAll('now()', 'public.test_now()'));
  }
  await db.exec('grant execute on function public.test_now() to authenticated');
  for (const [name, p] of Object.entries(points)) {
    await db.query('insert into public.checkpoints(id,name,code,latitude,longitude) values ($1,$2,$3,$4,$5)',
      [p.id, `Sample ${name}`, `PATTERN-${name}`, p.lat, p.lng]);
  }
});
after(async () => db?.close());

test('a normal two-checkpoint patrol stays valid with the default settings', async () => {
  const { rows } = await db.query('select max_patrol_speed_kmh, min_round_minutes from public.app_settings');
  assert.equal(Number(rows[0].max_patrol_speed_kmh), 80);
  assert.equal(rows[0].min_round_minutes, null, 'minimum round time is off until Muscat Bay sets one');
  const shift = await shiftVisiting('A', 'B');
  const first = await scan(shift, 'A', '21:10:00', { lat: 23.50001, lng: 58.50001 });
  const second = await scan(shift, 'B', '21:20:00', { lat: 23.50302, lng: 58.49999 });
  assert.equal(first.validation, 'valid');
  assert.deepEqual(second.flags, []);
  assert.equal(second.validation, 'valid');
});

test('a jump of several km within a minute is flagged impossible_travel, never rejected', async () => {
  const shift = await shiftVisiting('A', 'C');
  await scan(shift, 'A', '21:10:00');
  const jump = await scan(shift, 'C', '21:10:40');
  assert.ok(jump.flags.includes('impossible_travel'), `flags: ${jump.flags}`);
  assert.equal(jump.validation, 'flagged');
  await asUser(null);
  const { rows } = await db.query("select count(*)::int as n from public.alarms where scan_id=$1 and type='scan_rejected'", [jump.id]);
  assert.equal(rows[0].n, 0, 'a flag for review raises no rejection alarm');
});

test('a jump with the same timestamp counts as impossible; the check can be turned off', async () => {
  const shift = await shiftVisiting('A', 'C');
  await scan(shift, 'A', '21:10:00');
  assert.ok((await scan(shift, 'C', '21:10:00')).flags.includes('impossible_travel'));
  await settings({ max_patrol_speed_kmh: null });
  try {
    const other = await shiftVisiting('A', 'C');
    await scan(other, 'A', '21:10:00');
    assert.equal((await scan(other, 'C', '21:10:40')).validation, 'valid');
  } finally {
    await settings({ max_patrol_speed_kmh: 80 });
  }
});

test('identical coordinates at two checkpoints are flagged repeated_position', async () => {
  const between = { lat: 23.5002, lng: 58.5 }; // inside the allowed area of both A and D
  const shift = await shiftVisiting('A', 'D');
  assert.equal((await scan(shift, 'A', '21:10:00', between)).validation, 'valid');
  const repeat = await scan(shift, 'D', '21:15:00', between);
  assert.deepEqual(repeat.flags, ['repeated_position']);
  assert.equal(repeat.validation, 'flagged');

  // Two tags at the same spot can share one GPS reading without suspicion.
  const sameSpot = await shiftVisiting('A', 'E');
  await scan(sameSpot, 'A', '21:10:00');
  assert.equal((await scan(sameSpot, 'E', '21:10:30')).validation, 'valid');
});

test('fast_round is off by default and flags a round faster than min_round_minutes', async () => {
  const unset = await shiftVisiting('A', 'B');
  await scan(unset, 'A', '21:10:00');
  assert.equal((await scan(unset, 'B', '21:15:00')).validation, 'valid', 'no minimum set: no flag');

  await settings({ min_round_minutes: 20 });
  try {
    const fast = await shiftVisiting('A', 'B');
    assert.equal((await scan(fast, 'A', '21:10:00')).validation, 'valid', 'route not yet complete');
    const last = await scan(fast, 'B', '21:15:00');
    assert.deepEqual(last.flags, ['fast_round']);
    assert.equal(last.validation, 'flagged');

    const steady = await shiftVisiting('A', 'B');
    await scan(steady, 'A', '21:10:00');
    assert.equal((await scan(steady, 'B', '21:35:00')).validation, 'valid', '25 minutes is not too fast');
  } finally {
    await settings({ min_round_minutes: null });
  }
});

test('an out-of-order upload is compared with the nearest scan in time, before and after', async () => {
  // Uploaded A (21:10) then B (21:40). A delayed scan at C then arrives.
  // Compared only with the latest upload (B) it would look believable.
  const early = await shiftVisiting('A', 'B', 'C');
  await scan(early, 'A', '21:10:00');
  await scan(early, 'B', '21:40:00');
  const nearBefore = await scan(early, 'C', '21:11:00'); // 1 minute after A, 5.5 km away
  assert.deepEqual(nearBefore.flags, ['impossible_travel']);
  assert.equal(nearBefore.validation, 'flagged');

  const late = await shiftVisiting('A', 'B', 'C');
  await scan(late, 'A', '21:10:00');
  await scan(late, 'B', '21:40:00');
  const nearAfter = await scan(late, 'C', '21:39:00'); // 1 minute before B, 5.2 km away
  assert.deepEqual(nearAfter.flags, ['impossible_travel']);

  const between = await shiftVisiting('A', 'B', 'C');
  await scan(between, 'A', '21:10:00');
  await scan(between, 'B', '21:40:00');
  assert.equal((await scan(between, 'C', '21:25:00')).validation, 'valid', '15 minutes from both neighbours is believable');
});

test('a rejected or poor reading is never the baseline for impossible_travel', async () => {
  // Poor first fix about 700 m away is rejected too_far; the good retry 20 s later stays valid.
  const retry = await shiftVisiting('A', 'B');
  assert.equal((await scan(retry, 'A', '21:10:00', { lat: 23.5063, lng: 58.5 })).validation, 'rejected');
  const good = await scan(retry, 'A', '21:10:20');
  assert.deepEqual(good.flags, []);
  assert.equal(good.validation, 'valid');

  // A far-away rejected scan at the same time as a valid one never decides the
  // verdict, whichever of the two is stored first.
  for (const rejectedFirst of [true, false]) {
    const tie = await shiftVisiting('A', 'B', 'C');
    const far = () => scan(tie, 'C', '21:10:00', { lat: 24.5, lng: 58.5 }); // too_far, 111 km away
    if (rejectedFirst) await far();
    assert.equal((await scan(tie, 'A', '21:10:00')).validation, 'valid');
    if (!rejectedFirst) await far();
    const next = await scan(tie, 'B', '21:20:00');
    assert.deepEqual(next.flags, []);
    assert.equal(next.validation, 'valid');
  }
});
