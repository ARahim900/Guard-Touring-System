import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

let db;
const guard = randomUUID(), staff = randomUUID(), placed = randomUUID(), unplaced = randomUUID();
async function asUser(id) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id ?? '']);
  if (id) await db.exec('set role authenticated');
}
const place = (code, lat, lng, accuracy, replace = false) =>
  db.query('select public.place_checkpoint($1,$2,$3,$4,$5) as r', [code, lat, lng, accuracy, replace]).then((x) => x.rows[0].r);
const row = async (id) => { await asUser(null); return (await db.query('select latitude,longitude,active,placed_at,description from public.checkpoints where id=$1', [id])).rows[0]; };

before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}'::jsonb);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`);
  const folder = new URL('../supabase/migrations/', import.meta.url);
  // Rows that exist before the migration: one location in use, one added without a position.
  const files = (await readdir(folder)).filter((n) => n.endsWith('.sql') && !n.includes('00400')).sort();
  for (const name of files.filter((n) => n < '20261014001500')) await db.exec(await readFile(new URL(name, folder), 'utf8'));
  await db.query(`insert into public.checkpoints(id,name,code,latitude,longitude,active,description) values
    ($1,'Sample in use','TEST-PLACED',23.5,58.6,true,null),
    ($2,'Sample new','TEST-UNPLACED',0,0,false,'POSITION NOT SET: placeholder')`, [placed, unplaced]);
  for (const name of files.filter((n) => n >= '20261014001500')) await db.exec(await readFile(new URL(name, folder), 'utf8'));
  await db.query("insert into auth.users(id,email) values ($1,'guard@example.invalid'),($2,'staff@example.invalid')", [guard, staff]);
  await db.query("update public.profiles set role='supervisor' where id=$1", [staff]);
});
after(async () => db?.close());

test('locations already in use count as placed; new ones do not', async () => {
  assert.ok((await row(placed)).placed_at);
  assert.equal((await row(unplaced)).placed_at, null);
});

test('only supervisors can place labels, and bad input is refused', async () => {
  await asUser(guard);
  await assert.rejects(place('TEST-UNPLACED', 23.51, 58.61, 5), /Only supervisors/);
  await asUser(staff);
  await assert.rejects(place('NO-SUCH-LABEL', 23.51, 58.61, 5), /not in the system/);
  await assert.rejects(place('TEST-UNPLACED', null, 58.61, 5), /No valid GPS/);
  await assert.rejects(place('TEST-UNPLACED', 23.51, 58.61, 80), /accuracy is ±80 m/);
  assert.equal((await row(unplaced)).active, false, 'nothing changed');
});

test('scanning an unplaced label sets its position and makes it live', async () => {
  await asUser(staff);
  const result = await place('TEST-UNPLACED', 23.51, 58.61, 6);
  assert.equal(result.status, 'placed');
  const r = await row(unplaced);
  assert.equal(r.latitude, 23.51); assert.equal(r.longitude, 58.61);
  assert.equal(r.active, true); assert.ok(r.placed_at); assert.equal(r.description, null);
});

test('a placed label is only moved after a deliberate second step', async () => {
  await asUser(staff);
  const first = await place('TEST-PLACED', 23.502, 58.6, 5);
  assert.equal(first.status, 'already_placed');
  assert.ok(first.distance_m > 200, 'reports how far the label is from here');
  assert.equal((await row(placed)).latitude, 23.5, 'position unchanged');
  await asUser(staff);
  assert.equal((await place('TEST-PLACED', 23.502, 58.6, 5, true)).status, 'placed');
  assert.equal((await row(placed)).latitude, 23.502);
});
