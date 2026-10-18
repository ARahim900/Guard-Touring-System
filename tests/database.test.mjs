import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

let db;
const guard = randomUUID(), staff = randomUUID(), other = randomUUID(), route = randomUUID();
const cp1 = randomUUID(), cp2 = randomUUID(), shift = randomUUID();
const scanId = randomUUID();
async function asUser(id) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id ?? '']);
  if (id) await db.exec('set role authenticated');
}
async function scan(id = randomUUID(), checkpoint = cp1, options = {}) {
  const values = [id, shift, checkpoint, checkpoint === cp1 ? 'POINT-ONE' : 'POINT-TWO', options.time ?? '2026-09-11T01:00:00+04:00', options.accuracy ?? 5, options.latitude ?? 23.5];
  const result = await db.query(`select (public.submit_scan($1::uuid,$2::uuid,$3::uuid,'barcode',$4,'normal',null,$5::timestamptz,now(),$7,58.5,$6,false,0)).*`, values);
  return result.rows[0];
}

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
  await db.query("insert into public.routes(id,name) values ($1,'Test night route')", [route]);
  await db.query("insert into public.checkpoints(id,name,code,latitude,longitude) values ($1,'One','POINT-ONE',23.5,58.5),($2,'Two','POINT-TWO',23.5,58.5)", [cp1,cp2]);
  await db.query("insert into public.route_checkpoints(route_id,checkpoint_id,sequence,due_offset_min) values ($1,$2,1,0),($1,$3,2,30)",[route,cp1,cp2]);
  await db.query("insert into public.shifts(id,guard_id,route_id,scheduled_start,scheduled_end,actual_start,status,on_duty_name) values ($1,$2,$3,'2026-09-10T22:00:00+04:00','2026-09-11T06:00:00+04:00','2026-09-10T22:00:00+04:00','active','Test Guard')",[shift,guard,route]);
});
after(async () => db?.close());

test('staff can configure hours; guards cannot; equal hours rejected', async () => {
  await asUser(guard);
  await assert.rejects(db.query("select public.set_night_shift_hours('21:00','05:30')"), /Only supervisors/);
  await asUser(staff);
  await db.query("select public.set_night_shift_hours('21:00','05:30')");
  await assert.rejects(db.query("select public.set_night_shift_hours('21:00','21:00')"), /different/);
  const { rows } = await db.query('select night_shift_start,night_shift_end from public.app_settings');
  assert.equal(rows[0].night_shift_end, '05:30:00');
});

test('offline upload preserves captured time and duplicate retries are idempotent', async () => {
  await asUser(guard);
  const first = await scan(scanId);
  const repeated = await scan(scanId);
  assert.equal(first.id, repeated.id);
  assert.equal(first.validation, 'valid');
  assert.equal(new Date(first.device_time).getTime(), new Date(first.effective_time).getTime());
  assert.equal(first.initial_validation, 'valid');
  const { rows } = await db.query('select count(*)::int as n from public.scans where id=$1', [scanId]);
  assert.equal(rows[0].n, 1);
});

test('repeated visits count once and all checkpoints are due at shift end', async () => {
  await asUser(guard);
  await scan();
  const { rows } = await db.query('select completed,due_at from public.shift_checkpoint_status where shift_id=$1 order by sequence', [shift]);
  assert.deepEqual(rows.map((r) => r.completed), [true,false]);
  for (const row of rows) assert.equal(new Date(row.due_at).getTime(), new Date('2026-09-11T06:00:00+04:00').getTime());
});

test('poor GPS remains awaiting review and cannot count', async () => {
  await asUser(guard);
  const row = await scan(undefined,cp2,{accuracy:100});
  assert.equal(row.validation, 'flagged');
  const { rows } = await db.query('select completed,validation from public.shift_checkpoint_status where shift_id=$1 and checkpoint_id=$2',[shift,cp2]);
  assert.equal(rows[0].completed,false);
  assert.equal(rows[0].validation,'flagged');
});

test('outside-shift scans and distant GPS cannot count', async () => {
  await asUser(guard);
  assert.equal((await scan(undefined,cp2,{time:'2026-09-11T06:01:00+04:00'})).validation,'rejected');
  assert.equal((await scan(undefined,cp2,{latitude:24.5})).validation,'rejected');
});

test('date-range report keeps after-midnight scans with the shift start date', async () => {
  await asUser(staff);
  const { rows } = await db.query("select public.patrol_report('2026-09-10','2026-09-10') as report");
  assert.equal(rows[0].report.shifts.length,1);
  assert.equal(rows[0].report.shifts[0].checkpoints.length,2);
  assert.equal(rows[0].report.shifts[0].checkpoints[0].scans.length,2);
  const next = await db.query("select public.patrol_report('2026-09-11','2026-09-11') as report");
  assert.equal(next.rows[0].report.shifts.length,0);
  await assert.rejects(db.query("select public.patrol_report('2026-09-11','2026-09-10')"),/valid start/);
});

test('a guard report shows only its own patrols; no access to another guard records', async () => {
  await asUser(guard);
  assert.equal((await db.query("select public.patrol_report('2026-09-10','2026-09-10') as report")).rows[0].report.shifts.length,1);
  await asUser(other);
  assert.equal((await db.query("select public.patrol_report('2026-09-10','2026-09-10') as report")).rows[0].report.shifts.length,0);
  const { rows } = await db.query('select id from public.scans');
  assert.equal(rows.length,0);
  await assert.rejects(scan(),/not assigned/);
});

test('review preserves raw evidence, requires a reason and appends history', async () => {
  await asUser(staff);
  await assert.rejects(db.query("update public.scans set latitude=0 where id=$1",[scanId]),/permission denied/);
  await assert.rejects(db.query("update public.scans set validation='flagged',review_note='' where id=$1",[scanId]),/reason/);
  await db.query("update public.scans set validation='flagged',review_note='Check location evidence' where id=$1",[scanId]);
  await db.query("update public.scans set validation='valid',review_note='Visit independently confirmed' where id=$1",[scanId]);
  const { rows } = await db.query('select initial_validation, review_history,reviewed_by from public.scans where id=$1',[scanId]);
  assert.equal(rows[0].initial_validation,'valid');
  assert.equal(rows[0].review_history.length,2);
  assert.equal(rows[0].reviewed_by,staff);
});

test('automatic closure keeps the actual finish unknown', async () => {
  await asUser(null);
  await db.query('select public.run_patrol_monitor()');
  const { rows } = await db.query('select status,actual_end,auto_closed_at from public.shifts where id=$1',[shift]);
  assert.equal(rows[0].status,'completed');
  assert.equal(rows[0].actual_end,null);
  assert.ok(rows[0].auto_closed_at);
  // Genuine offline evidence can still arrive after automatic closure.
  await asUser(guard);
  assert.equal((await scan(undefined,cp2)).validation,'valid');
});

test('monitor does not raise checkpoint alarms before shift end', async () => {
  await asUser(null);
  const id=randomUUID();
  await db.query("insert into public.shifts(id,guard_id,route_id,scheduled_start,scheduled_end,actual_start,status) values ($1,$2,$3,now()-interval '1 hour',now()+interval '7 hours',now()-interval '1 hour','active')",[id,guard,route]);
  await db.query('select public.run_patrol_monitor()');
  const {rows}=await db.query("select count(*)::int as n from public.alarms where shift_id=$1 and type='missed_checkpoint'",[id]);
  assert.equal(rows[0].n,0);
});

test('server report includes over 1000 required locations and never-started shifts', async () => {
  await asUser(null);
  await db.query("insert into public.shifts(guard_id,route_id,scheduled_start,scheduled_end) select $1,$2,'2026-08-01T22:00:00+04:00'::timestamptz,'2026-08-02T06:00:00+04:00'::timestamptz from generate_series(1,601)",[other,route]);
  await asUser(staff);
  const {rows}=await db.query("select public.patrol_report('2026-08-01','2026-08-01') as report");
  assert.equal(rows[0].report.shifts.length,601);
  assert.equal(rows[0].report.shifts.reduce((n,s)=>n+s.checkpoints.length,0),1202);
  assert.equal(rows[0].report.shifts[0].actual_start,null);
  assert.equal(rows[0].report.shifts[0].guard_name,null);
});

test('checkpoint alarms follow supervisor review decisions', async () => {
  await asUser(null);
  const recentShift=randomUUID(), recentScan=randomUUID();
  await db.query("insert into public.shifts(id,guard_id,route_id,scheduled_start,scheduled_end,actual_start,status) values ($1,$2,$3,now()-interval '2 hours',now()-interval '1 hour',now()-interval '2 hours','active')",[recentShift,other,route]);
  await asUser(other);
  await db.query("select public.submit_scan($1,$2,$3,'barcode','POINT-ONE','normal',null,now()-interval '90 minutes',now(),23.5,58.5,5,false,0)",[recentScan,recentShift,cp1]);
  await asUser(staff);
  await db.query("update public.scans set validation='flagged',review_note='Review required' where id=$1",[recentScan]);
  await asUser(null);
  await db.query('select public.run_patrol_monitor()');
  let alarm=await db.query("select status from public.alarms where shift_id=$1 and checkpoint_id=$2 and type='missed_checkpoint'",[recentShift,cp1]);
  assert.equal(alarm.rows[0].status,'open');
  await asUser(staff);
  await db.query("update public.scans set validation='valid',review_note='Confirmed by supervisor' where id=$1",[recentScan]);
  await asUser(null);
  await db.query('select public.run_patrol_monitor()');
  alarm=await db.query("select status from public.alarms where shift_id=$1 and checkpoint_id=$2 and type='missed_checkpoint'",[recentShift,cp1]);
  assert.equal(alarm.rows[0].status,'resolved');
});
