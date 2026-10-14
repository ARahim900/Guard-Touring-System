import assert from 'node:assert/strict';
import { beforeEach, afterEach, test } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

let db;
let guard, staff, other, checkpoint;
async function asUser(id) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id ?? '']);
  if (id) await db.exec('set role authenticated');
}
async function clock(value) {
  await db.query("select set_config('test.now', $1, false)", [value]);
}
async function setup(start = '20:00', end = '06:00') {
  await asUser(staff);
  await db.query("select public.save_daily_patrol($1,$2::time,$3::time,array['Sample guard','Sample two','Sample three','Sample four'])", [guard,start,end]);
}
async function nights() {
  return (await db.query('select id,guard_id,automatic_patrol_date::text as day,scheduled_start,scheduled_end,status,actual_start,actual_end from public.shifts where automatic_patrol_date is not null order by scheduled_start')).rows;
}

beforeEach(async () => {
  guard=randomUUID(); staff=randomUUID(); other=randomUUID(); checkpoint=randomUUID();
  db=new PGlite();
  await db.exec(`create role anon; create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}'::jsonb);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function public.test_now() returns timestamptz language sql stable as $$select current_setting('test.now')::timestamptz$$;
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`);
  await clock('2026-12-31T22:00:00+04:00');
  const folder=new URL('../supabase/migrations/',import.meta.url);
  for(const name of (await readdir(folder)).filter(n=>n.endsWith('.sql')&&!n.includes('00400')).sort()) {
    const sql=(await readFile(new URL(name,folder),'utf8')).replaceAll('now()', 'public.test_now()');
    await db.exec(sql);
  }
  await db.exec('grant execute on function public.test_now() to authenticated');
  await db.query("insert into auth.users(id,email) values ($1,'security@example.invalid'),($2,'manager@example.invalid'),($3,'other@example.invalid')",[guard,staff,other]);
  await db.query("update public.profiles set role='admin' where id=$1",[staff]);
  await db.query("insert into public.checkpoints(id,name,code,latitude,longitude) values ($1,'Sample location','TEST-LOCATION',0,0)",[checkpoint]);
});
afterEach(async()=>db?.close());

test('one setup creates tonight and tomorrow, with required locations and no invented attendance',async()=>{
  await setup();
  const rows=await nights();
  assert.deepEqual(rows.map(r=>r.day),['2026-12-31','2027-01-01']);
  assert.equal(new Date(rows[0].scheduled_end).toISOString(),'2027-01-01T02:00:00.000Z');
  assert.equal(rows[0].actual_start,null);
  assert.equal(rows[0].actual_end,null);
  assert.equal((await db.query('select count(*)::int as n from public.shift_checkpoints where shift_id=$1',[rows[0].id])).rows[0].n,1);
  await asUser(guard);
  await db.query('select public.prepare_my_patrol()');
  await db.query('select public.prepare_my_patrol()');
  assert.equal((await nights()).length,2);
  await db.query("select public.start_shift_as($1,'Sample guard',null)",[rows[0].id]);
  assert.equal((await nights())[0].status,'active');
});

test('only staff configure automatic patrols; other security logins can prepare their own',async()=>{
  await asUser(guard);
  await assert.rejects(db.query("select public.save_daily_patrol($1,'20:00','06:00',array['Sample guard','Sample two','Sample three','Sample four'])",[guard]),/Only supervisors/);
  await assert.rejects(db.query('select public.prepare_daily_patrols()'),/permission denied/);
  await setup();
  await asUser(other);
  await db.query('select public.prepare_my_patrol()');
  assert.equal((await nights()).length,0);
  await asUser(null);
  await db.query('update public.profiles set active=false where id=$1',[guard]);
  await asUser(guard);
  await assert.rejects(db.query('select public.prepare_my_patrol()'),/Sign in with the security login/);
});

test('first setup after midnight uses the previous night without backfilling past nights',async()=>{
  await clock('2027-01-01T01:00:00+04:00');
  await setup();
  const rows=await nights();
  assert.equal(rows[0].day,'2026-12-31');
  assert.equal(new Date(rows[0].scheduled_start).toISOString(),'2026-12-31T16:00:00.000Z');
  assert.equal(rows.length,3);
});

test('scheduler records an unstarted night as missed and preserves its required locations',async()=>{
  await setup();
  const previous=(await nights())[0];
  await asUser(null);
  await clock('2027-01-01T07:00:00+04:00');
  await db.query("insert into public.checkpoints(name,code,latitude,longitude) values ('New sample','TEST-NEW',0,0)");
  await db.query('select public.prepare_daily_patrols()');
  const rows=await nights();
  assert.equal(rows[0].status,'missed');
  assert.equal((await db.query('select count(*)::int as n from public.shift_checkpoints where shift_id=$1',[previous.id])).rows[0].n,1);
  await asUser(staff);
  const report=(await db.query("select public.patrol_report('2026-12-31','2026-12-31') as data")).rows[0].data;
  assert.equal(report.shifts[0].status,'missed');
  assert.equal(report.shifts[0].checkpoints[0].scans.length,0);
  assert.equal(report.shifts[0].actual_start,null);
});

test('a new location joins the running patrol; changed hours affect only upcoming patrols',async()=>{
  await setup();
  const first=(await nights())[0];
  await asUser(guard);
  await db.query("select public.start_shift_as($1,'Sample guard',null)",[first.id]);
  await asUser(staff);
  await db.query("insert into public.checkpoints(name,code,latitude,longitude) values ('New sample','TEST-NEW',0,0)");
  await setup('21:00','05:00');
  const rows=await nights();
  assert.equal(new Date(rows[0].scheduled_start).toISOString(),'2026-12-31T16:00:00.000Z');
  assert.equal(new Date(rows[1].scheduled_start).toISOString(),'2027-01-01T17:00:00.000Z');
  const counts=(await db.query('select shift_id,count(*)::int as n from public.shift_checkpoints group by shift_id')).rows;
  assert.equal(counts.find(r=>r.shift_id===rows[0].id).n,2,'the running patrol gains the new location');
  assert.equal(counts.find(r=>r.shift_id===rows[1].id).n,2);
});

test('automatic closure never invents a guard finish time, and equal hours are refused',async()=>{
  await setup();
  const first=(await nights())[0];
  await asUser(guard);
  await db.query("select public.start_shift_as($1,'Sample guard',null)",[first.id]);
  await asUser(null);
  await clock('2027-01-01T06:00:00+04:00');
  await db.query('select public.prepare_daily_patrols()');
  const ended=(await nights())[0];
  assert.equal(ended.status,'completed');
  assert.equal(ended.actual_end,null);
  await assert.rejects(setup('20:00','20:00'),/different start/);
});

test('roster refuses duplicate names and unlisted on-duty selections',async()=>{
  await asUser(staff);
  await assert.rejects(db.query("select public.save_daily_patrol($1,'20:00','06:00',array['Same guard','same guard','Third guard','Fourth guard'])",[guard]),/four different/);
  await setup();
  const first=(await nights())[0];
  await asUser(guard);
  await assert.rejects(db.query("select public.start_shift_as($1,'Unlisted name',null)",[first.id]),/current guard list/);
  await db.query("select public.start_shift_as($1,'Sample guard',null)",[first.id]);
  await assert.rejects(db.query("select public.start_shift_as($1,'Sample two',null)",[first.id]),/already started/);
  const saved=await db.query('select on_duty_name from public.shifts where id=$1',[first.id]);
  assert.equal(saved.rows[0].on_duty_name,'Sample guard');
});

async function rosterOnly() {
  await asUser(null);
  await db.query("update public.app_settings set guard_names=array['Sample guard','Sample two','Sample three','Sample four'] where id=1");
  await asUser(guard);
}

test('guard starts without manager setup, sees locations, and retry preserves the same shift',async()=>{
  await rosterOnly();
  await db.query('select public.prepare_my_patrol()');
  const locations=(await db.query('select id,code from public.patrol_locations()')).rows;
  assert.equal(locations[0].id,checkpoint);
  const first=(await db.query("select public.start_my_patrol('20:00','06:00','Sample guard') as id")).rows[0].id;
  const again=(await db.query("select public.start_my_patrol('21:00','07:00','Sample guard') as id")).rows[0].id;
  assert.equal(first,again);
  const shift=(await db.query('select status,actual_start,scheduled_start,scheduled_end,on_duty_name from public.shifts where id=$1',[first])).rows[0];
  assert.equal(shift.status,'active');
  assert.equal(shift.on_duty_name,'Sample guard');
  assert.equal(new Date(shift.actual_start).toISOString(),'2026-12-31T18:00:00.000Z');
  assert.equal(new Date(shift.scheduled_start).toISOString(),'2026-12-31T16:00:00.000Z');
  assert.equal((await db.query('select count(*)::int as n from public.shift_checkpoints where shift_id=$1',[first])).rows[0].n,1);
  await assert.rejects(db.query("select public.start_my_patrol('20:00','06:00','Sample two')"),/already in progress/);
});

test('guard self-service handles midnight and closes expired shifts without inventing attendance',async()=>{
  await rosterOnly();
  await clock('2027-01-01T01:00:00+04:00');
  const id=(await db.query("select public.start_my_patrol('20:00','06:00','Sample guard') as id")).rows[0].id;
  const shift=(await db.query('select scheduled_start,scheduled_end from public.shifts where id=$1',[id])).rows[0];
  assert.equal(new Date(shift.scheduled_start).toISOString(),'2026-12-31T16:00:00.000Z');
  assert.equal(new Date(shift.scheduled_end).toISOString(),'2027-01-01T02:00:00.000Z');
  await clock('2027-01-01T06:00:00+04:00');
  await db.query('select public.prepare_my_patrol()');
  const closed=(await db.query('select status,actual_end,auto_closed_at from public.shifts where id=$1',[id])).rows[0];
  assert.equal(closed.status,'completed');assert.equal(closed.actual_end,null);assert.ok(closed.auto_closed_at);
});

test('self-service rejects invalid times, unlisted names, staff, inactive guards and anonymous callers',async()=>{
  await rosterOnly();
  await assert.rejects(db.query("select public.start_my_patrol('20:00','20:00','Sample guard')"),/different/);
  await assert.rejects(db.query("select public.start_my_patrol('23:00','06:00','Sample guard')"),/current Muscat time/);
  await assert.rejects(db.query("select public.start_my_patrol('20:00','06:00','Unknown')"),/guard list/);
  await asUser(staff);
  await assert.rejects(db.query("select public.start_my_patrol('20:00','06:00','Sample guard')"),/active security/);
  await assert.rejects(db.query('select public.patrol_locations()'),/active security/);
  await asUser(null);await db.query('update public.profiles set active=false where id=$1',[guard]);
  await asUser(guard);
  await assert.rejects(db.query("select public.start_my_patrol('20:00','06:00','Sample guard')"),/active security/);
  await asUser(null);await db.exec('set role anon');
  await assert.rejects(db.query("select public.start_my_patrol('20:00','06:00','Sample guard')"),/permission denied/);
});

test('finished patrols cannot be reset through a second overlapping shift',async()=>{
  await rosterOnly();
  const id=(await db.query("select public.start_my_patrol('20:00','06:00','Sample guard') as id")).rows[0].id;
  await db.query('select public.end_shift($1)',[id]);
  await assert.rejects(db.query("select public.start_my_patrol('21:00','07:00','Sample guard')"),/overlap a finished/);
  assert.equal((await db.query('select count(*)::int as n from public.shifts')).rows[0].n,1);
});

test('self-service reuses an unstarted automatic shift and remains isolated from another login',async()=>{
  await setup();await asUser(guard);
  const id=(await db.query("select public.start_my_patrol('21:00','05:00','Sample guard') as id")).rows[0].id;
  const rows=await nights();assert.equal(rows[0].id,id);assert.equal(rows.length,2);
  assert.equal(new Date(rows[0].scheduled_start).toISOString(),'2026-12-31T17:00:00.000Z');
  await asUser(other);
  const otherId=(await db.query("select public.start_my_patrol('21:00','05:00','Sample two') as id")).rows[0].id;
  assert.notEqual(id,otherId);
  assert.equal((await db.query('select id from public.shifts where id=$1',[id])).rows.length,0);
});

test('start now uses the server time, defaults to twelve hours and safely resumes',async()=>{
  await rosterOnly();
  await clock('2027-01-01T00:15:37+04:00');
  const id=(await db.query("select public.start_patrol_now('Sample guard') as id")).rows[0].id;
  const row=(await db.query('select scheduled_start,scheduled_end,actual_start from public.shifts where id=$1',[id])).rows[0];
  assert.equal(new Date(row.scheduled_start).toISOString(),'2026-12-31T20:15:37.000Z');
  assert.equal(new Date(row.actual_start).toISOString(),'2026-12-31T20:15:37.000Z');
  assert.equal(new Date(row.scheduled_end).toISOString(),'2027-01-01T08:15:37.000Z');
  await clock('2027-01-01T00:20:00+04:00');
  assert.equal((await db.query("select public.start_patrol_now('Sample guard') as id")).rows[0].id,id);
  assert.equal((await db.query('select count(*)::int as n from public.shifts')).rows[0].n,1);
});

test('start now honours a configured end and a guard-selected end across midnight',async()=>{
  await setup();await asUser(guard);
  const id=(await db.query("select public.start_patrol_now('Sample guard') as id")).rows[0].id;
  const row=(await db.query('select scheduled_start,scheduled_end from public.shifts where id=$1',[id])).rows[0];
  assert.equal(new Date(row.scheduled_start).toISOString(),'2026-12-31T18:00:00.000Z');
  assert.equal(new Date(row.scheduled_end).toISOString(),'2027-01-01T02:00:00.000Z');
  await asUser(other);
  const otherId=(await db.query("select public.start_patrol_now('Sample two','05:30') as id")).rows[0].id;
  const otherRow=(await db.query('select scheduled_end from public.shifts where id=$1',[otherId])).rows[0];
  assert.equal(new Date(otherRow.scheduled_end).toISOString(),'2027-01-01T01:30:00.000Z');
});

test('start now retains guard-name, account-role and inactive-account checks',async()=>{
  await rosterOnly();
  await assert.rejects(db.query("select public.start_patrol_now('Unknown')"),/guard list/);
  await asUser(staff);
  await assert.rejects(db.query("select public.start_patrol_now('Sample guard')"),/active security/);
  await asUser(null);await db.query('update public.profiles set active=false where id=$1',[guard]);await asUser(guard);
  await assert.rejects(db.query("select public.start_patrol_now('Sample guard')"),/active security/);
  await asUser(null);await db.exec('set role anon');
  await assert.rejects(db.query("select public.start_patrol_now('Sample guard')"),/permission denied/);
});

test('start now reuses tonight\'s prepared shift and records the server time, not the phone time',async()=>{
  await setup();
  const prepared=(await nights())[0];
  await asUser(guard);
  const id=(await db.query("select public.start_patrol_now('Sample guard') as id")).rows[0].id;
  assert.equal(id,prepared.id,'no second shift is created');
  const shift=(await db.query('select status,actual_start,on_duty_name from public.shifts where id=$1',[id])).rows[0];
  assert.equal(shift.status,'active');
  assert.equal(shift.on_duty_name,'Sample guard');
  assert.equal(new Date(shift.actual_start).toISOString(),'2026-12-31T18:00:00.000Z');
  await assert.rejects(db.query("select public.start_patrol_now('Typed name')"),/guard list/);
});
