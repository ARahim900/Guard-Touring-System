import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

let db;
const guard = randomUUID(), staff = randomUUID(), other = randomUUID(), route = randomUUID();
const cp1 = randomUUID(), cp2 = randomUUID(), shift = randomUUID();

async function asUser(id) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id ?? '']);
  if (id) await db.exec('set role authenticated');
}
const scanAs = (name, id, checkpoint = cp1, code = 'POINT-ONE') => db.query(
  `select (public.submit_scan_as($1,$2::uuid,$3::uuid,$4::uuid,'qr',$5,'normal',null,'2026-09-11T01:00:00+04:00'::timestamptz,now(),23.5,58.5,5,false,0)).*`,
  [name, id, shift, checkpoint, code]);

before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated;
    create schema auth;
    create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`);
  const folder = new URL('../supabase/migrations/', import.meta.url);
  for (const file of (await readdir(folder)).filter((f) => f.endsWith('.sql') && !f.includes('00400')).sort()) {
    await db.exec(await readFile(new URL(file, folder), 'utf8'));
  }
  await db.query("insert into auth.users(id,email) values ($1,'guard@test.invalid'),($2,'staff@test.invalid'),($3,'other@test.invalid')", [guard, staff, other]);
  await db.query("update public.profiles set role='supervisor' where id=$1", [staff]);
  await db.query("update public.app_settings set guard_names = array['Ali','Badr','Salim','Hamed'] where id = 1");
  await db.query("insert into public.routes(id,name) values ($1,'Test route')", [route]);
  await db.query("insert into public.checkpoints(id,name,code,latitude,longitude) values ($1,'One','POINT-ONE',23.5,58.5),($2,'Two','POINT-TWO',23.5,58.5)", [cp1, cp2]);
  await db.query("insert into public.route_checkpoints(route_id,checkpoint_id,sequence,due_offset_min) values ($1,$2,1,0),($1,$3,2,30)", [route, cp1, cp2]);
  await db.query("insert into public.shifts(id,guard_id,route_id,scheduled_start,scheduled_end,actual_start,status,on_duty_name) values ($1,$2,$3,'2026-09-10T22:00:00+04:00','2026-09-11T06:00:00+04:00','2026-09-10T22:00:00+04:00','active','Ali')", [shift, guard, route]);
});
after(async () => db?.close());

test('a scan stores the name of the guard who made it, not the patrol starter', async () => {
  await asUser(guard);
  const id = randomUUID();
  const row = (await scanAs('Badr', id)).rows[0];
  assert.equal(row.id, id);
  const { rows } = await db.query('select guard_name from public.scan_guard_names where scan_id = $1', [id]);
  assert.equal(rows[0].guard_name, 'Badr');
});

test('a retried upload keeps the first stored name', async () => {
  await asUser(guard);
  const id = randomUUID();
  await scanAs('Salim', id, cp2, 'POINT-TWO');
  await scanAs('Salim', id, cp2, 'POINT-TWO');
  const { rows } = await db.query('select guard_name from public.scan_guard_names where scan_id = $1', [id]);
  assert.deepEqual(rows.map((r) => r.guard_name), ['Salim']);
});

test('a name outside the guard list, or blank, is refused and nothing is saved', async () => {
  await asUser(guard);
  const id = randomUUID();
  await assert.rejects(scanAs('Someone Else', id), /Choose your name/);
  await assert.rejects(scanAs('  ', randomUUID()), /Choose your name/);
  const { rows } = await db.query('select count(*)::int as n from public.scans where id = $1', [id]);
  assert.equal(rows[0].n, 0);
});

test('guards cannot write names directly; another account cannot read them', async () => {
  await asUser(guard);
  await assert.rejects(db.query("insert into public.scan_guard_names(scan_id, guard_name) select id, 'Hamed' from public.scans limit 1"), /permission denied/);
  await asUser(other);
  const { rows } = await db.query('select count(*)::int as n from public.scan_guard_names');
  assert.equal(rows[0].n, 0);
});

test('the patrol report shows who scanned each visit', async () => {
  await asUser(staff);
  const { rows } = await db.query("select public.patrol_report('2026-09-10','2026-09-11') as r");
  const scans = rows[0].r.shifts.flatMap((s) => s.checkpoints.flatMap((c) => c.scans));
  assert.ok(scans.length >= 2);
  assert.deepEqual([...new Set(scans.map((s) => s.scanned_by))].sort(), ['Badr', 'Salim']);
});
