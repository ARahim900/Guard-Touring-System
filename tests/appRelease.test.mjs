// Guard app release notice: app_settings.android_latest_version and
// android_download_url (migration 20261014001400_app_release.sql).
import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

let db;
const guard = randomUUID(), admin = randomUUID();
async function asUser(id) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id ?? '']);
  if (id) await db.exec('set role authenticated');
}
async function readAsGuard() {
  await asUser(guard);
  return (await db.query('select guard_names, android_latest_version, android_download_url from public.app_settings where id = 1')).rows[0];
}

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
  await db.query("insert into auth.users(id,email) values ($1,'guard@example.invalid'),($2,'admin@example.invalid')", [guard, admin]);
  await db.query("update public.profiles set role='admin' where id=$1", [admin]);
});
after(async () => db?.close());

test('a guard can read the release settings, which start empty', async () => {
  const row = await readAsGuard();
  assert.equal(row.android_latest_version, null);
  assert.equal(row.android_download_url, null);
});

test('an admin sets the release settings and the guard sees them', async () => {
  await asUser(admin);
  await db.query("update public.app_settings set android_latest_version='1.1.0', android_download_url='https://example.invalid/mb-patrol.apk' where id=1");
  const row = await readAsGuard();
  assert.equal(row.android_latest_version, '1.1.0');
  assert.equal(row.android_download_url, 'https://example.invalid/mb-patrol.apk');
});

test('a guard cannot change the release settings', async () => {
  await asUser(guard);
  await db.query("update public.app_settings set android_latest_version='9.9.9' where id=1");
  assert.equal((await readAsGuard()).android_latest_version, '1.1.0');
});

test('badly typed values are refused', async () => {
  await asUser(null);
  await assert.rejects(db.query("update public.app_settings set android_latest_version='v1.2' where id=1"));
  await assert.rejects(db.query("update public.app_settings set android_download_url='http://example.invalid/app.apk' where id=1"));
});

test('clearing both fields in the Table Editor (empty text) is accepted and hides the notice', async () => {
  await asUser(null);
  await db.query("update public.app_settings set android_latest_version='', android_download_url='' where id=1");
  const row = await readAsGuard();
  assert.equal(row.android_latest_version, '');
  assert.equal(row.android_download_url, '');
});
