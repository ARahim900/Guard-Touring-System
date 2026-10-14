import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

let db;
const guard = randomUUID(), staff = randomUUID(), route = randomUUID(), checkpoint = randomUUID(), shift = randomUUID();
async function asUser(id) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id ?? '']);
  if (id) await db.exec('set role authenticated');
}
async function clock(value) {
  await db.query("select set_config('test.now', $1, false)", [value]);
}
async function missedAlarms() {
  await asUser(null);
  return (await db.query("select count(*)::int as n from public.alarms where type='missed_checkpoint'")).rows[0].n;
}
async function stats(from, to) {
  await asUser(staff);
  return (await db.query('select public.patrol_stats($1,$2::timestamptz,$3::timestamptz) as s', [guard, from, to])).rows[0].s;
}

before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}'::jsonb);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function public.test_now() returns timestamptz language sql stable as $$select current_setting('test.now')::timestamptz$$;
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`);
  await clock('2027-01-31T21:00:00+04:00');
  const folder = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(folder)).filter((n) => n.endsWith('.sql') && !n.includes('00400')).sort()) {
    await db.exec((await readFile(new URL(name, folder), 'utf8')).replaceAll('now()', 'public.test_now()'));
  }
  await db.exec('grant execute on function public.test_now() to authenticated');
  await db.query("insert into auth.users(id,email) values ($1,'guard@example.invalid'),($2,'staff@example.invalid')", [guard, staff]);
  await db.query("update public.profiles set role='supervisor' where id=$1", [staff]);
  await db.query("insert into public.routes(id,name) values ($1,'Sample route')", [route]);
  await db.query("insert into public.checkpoints(id,name,code,latitude,longitude) values ($1,'Sample location','TEST-LOCATION',0,0)", [checkpoint]);
  await db.query('insert into public.route_checkpoints(route_id,checkpoint_id,sequence,due_offset_min) values ($1,$2,1,0)', [route, checkpoint]);
  // An overnight patrol that crosses midnight at month end.
  await db.query(`insert into public.shifts(id,guard_id,route_id,scheduled_start,scheduled_end,actual_start,status,on_duty_name)
    values ($1,$2,$3,'2027-01-31T22:00:00+04:00','2027-02-01T06:00:00+04:00','2027-01-31T22:00:00+04:00','active','Sample guard')`, [shift, guard, route]);
});
after(async () => db?.close());

test('F08: a missed checkpoint alarm waits for the grace period after the shift end', async () => {
  await clock('2027-02-01T06:10:00+04:00');
  await asUser(null);
  await db.query('select public.run_patrol_monitor()');
  assert.equal(await missedAlarms(), 0, 'no alarm inside the 15-minute grace period');
  await clock('2027-02-01T06:20:00+04:00');
  await asUser(null);
  await db.query('select public.run_patrol_monitor()');
  assert.equal(await missedAlarms(), 1, 'alarm once the grace period has passed');
});

test('F07: an overnight patrol is counted in the month its shift started', async () => {
  await clock('2027-02-01T07:00:00+04:00');
  const january = await stats('2027-01-01T00:00:00+04:00', '2027-02-01T00:00:00+04:00');
  const february = await stats('2027-02-01T00:00:00+04:00', '2027-03-01T00:00:00+04:00');
  assert.equal(january.shifts, 1);
  assert.equal(january.expected, 1, 'required visits stay with the shift');
  assert.deepEqual(january.daily.map((d) => d.day), ['2027-01-31']);
  assert.equal(february.shifts, 0);
  assert.equal(february.expected, 0, 'nothing leaks into the next month');
});
