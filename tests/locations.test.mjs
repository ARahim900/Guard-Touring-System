import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

let db;
const guard = randomUUID(), staff = randomUUID(), route = randomUUID();
const first = randomUUID(), placedLater = randomUUID(), running = randomUUID(), upcoming = randomUUID(), finished = randomUUID();
async function asUser(id) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id ?? '']);
  if (id) await db.exec('set role authenticated');
}
const inPatrol = async (shift, cp) => { await asUser(null); return (await db.query('select 1 from public.shift_checkpoints where shift_id=$1 and checkpoint_id=$2', [shift, cp])).rows.length === 1; };
const exists = async (cp) => { await asUser(null); return (await db.query('select active from public.checkpoints where id=$1', [cp])).rows[0] ?? null; };

before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}'::jsonb);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`);
  const folder = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(folder)).filter((n) => n.endsWith('.sql') && !n.includes('00400')).sort()) {
    await db.exec(await readFile(new URL(name, folder), 'utf8'));
  }
  await db.query("insert into auth.users(id,email) values ($1,'guard@example.invalid'),($2,'staff@example.invalid')", [guard, staff]);
  await db.query("update public.profiles set role='supervisor' where id=$1", [staff]);
  await db.query("insert into public.routes(id,name) values ($1,'Sample route')", [route]);
  await db.query('update public.app_settings set patrol_route_id=$1 where id=1', [route]);
  await db.query(`insert into public.checkpoints(id,name,code,latitude,longitude,active) values
    ($1,'Sample first','TEST-FIRST',23.5,58.6,true), ($2,'Sample later','TEST-LATER',23.51,58.61,false)`, [first, placedLater]);
  // "first" is active, so it joins the patrol route by itself.
  await db.query(`insert into public.shifts(id,guard_id,route_id,scheduled_start,scheduled_end,actual_start,status,on_duty_name) values
    ($1,$4,$5,now()-interval '1 hour',now()+interval '8 hours',now()-interval '1 hour','active','Sample guard'),
    ($2,$4,$5,now()+interval '1 day',now()+interval '1 day 8 hours',null,'scheduled',null),
    ($3,$4,$5,now()-interval '2 days',now()-interval '1 day',now()-interval '2 days','completed','Sample guard')`,
    [running, upcoming, finished, guard, route]);
});
after(async () => db?.close());

test('a location placed during a patrol joins the running and upcoming patrols', async () => {
  assert.equal(await inPatrol(running, placedLater), false);
  await asUser(staff);
  await db.query('update public.checkpoints set active=true, placed_at=now() where id=$1', [placedLater]);
  assert.equal(await inPatrol(running, placedLater), true, 'running patrol');
  assert.equal(await inPatrol(upcoming, placedLater), true, 'patrol not yet started');
  assert.equal(await inPatrol(finished, placedLater), false, 'a finished patrol is never changed');
});

test('a location added as active joins the running patrol too', async () => {
  await asUser(staff);
  const id = (await db.query("insert into public.checkpoints(name,code,latitude,longitude) values ('Sample new','TEST-NEW',23.52,58.62) returning id")).rows[0].id;
  assert.equal(await inPatrol(running, id), true);
});

test('only supervisors delete; a location with history is retired, one without is deleted', async () => {
  await asUser(guard);
  await assert.rejects(db.query('select public.delete_checkpoint($1)', [placedLater]), /Only supervisors/);
  await asUser(staff);
  // "first" was required on the finished patrol: keep its history.
  assert.equal((await db.query('select public.delete_checkpoint($1) as r', [first])).rows[0].r, 'retired');
  assert.deepEqual(await exists(first), { active: false });
  // "placedLater" was never part of a finished patrol: removed everywhere.
  await asUser(staff);
  assert.equal((await db.query('select public.delete_checkpoint($1) as r', [placedLater])).rows[0].r, 'deleted');
  assert.equal(await exists(placedLater), null);
  assert.equal(await inPatrol(running, placedLater), false);
  assert.equal(await inPatrol(upcoming, placedLater), false);
});
