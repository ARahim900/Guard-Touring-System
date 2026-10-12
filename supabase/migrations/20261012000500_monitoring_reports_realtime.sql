-- =============================================================================
-- Muscat Bay Patrol System — 05: Monitoring job, reports, live map, realtime
-- =============================================================================

-- ---------------------------------------------------------------------------
-- run_patrol_monitor: runs every 5 minutes (pg_cron, below). It
--   a) raises "shift not started" alarms (guard no-show),
--   b) raises "missed checkpoint" alarms once due time + grace has passed,
--   c) marks never-started shifts as missed,
--   d) auto-closes shifts a guard forgot to end,
--   e) deletes GPS trail older than the retention period (privacy).
-- Returns counts so you can test it by hand:  select public.run_patrol_monitor();
-- ---------------------------------------------------------------------------
create or replace function public.run_patrol_monitor()
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_set           public.app_settings;
  v_grace         interval;
  v_not_started   integer;
  v_missed        integer;
  v_shifts_missed integer;
  v_auto_closed   integer;
  v_pings_deleted integer;
begin
  select * into v_set from public.app_settings where id = 1;
  v_grace := make_interval(mins => v_set.grace_minutes);

  -- a) Guard has not started the shift.
  insert into public.alarms (type, guard_id, shift_id, message)
  select 'shift_not_started', s.guard_id, s.id,
         format('%s has not started the %s shift', p.full_name,
                to_char(s.scheduled_start at time zone v_set.timezone, 'DD Mon HH24:MI'))
  from public.shifts s
  join public.profiles p on p.id = s.guard_id
  where s.status = 'scheduled'
    and s.scheduled_start + v_grace < now()
    and s.scheduled_end > now() - interval '1 day'
  on conflict (shift_id) where type = 'shift_not_started' do nothing;
  get diagnostics v_not_started = row_count;

  -- b) Checkpoint not visited in time.
  insert into public.alarms (type, guard_id, shift_id, checkpoint_id, message)
  select 'missed_checkpoint', scs.guard_id, scs.shift_id, scs.checkpoint_id,
         format('Missed %s (due %s)', scs.checkpoint_name,
                to_char(scs.due_at at time zone v_set.timezone, 'DD Mon HH24:MI'))
  from public.shift_checkpoint_status scs
  where scs.shift_status <> 'cancelled'
    and not scs.completed
    and scs.due_at + v_grace < now()
    and scs.due_at > now() - interval '2 days'
  on conflict (shift_id, checkpoint_id) where type = 'missed_checkpoint' do nothing;
  get diagnostics v_missed = row_count;

  -- c) Never started and now over.
  update public.shifts
     set status = 'missed'
   where status = 'scheduled' and scheduled_end + v_grace < now();
  get diagnostics v_shifts_missed = row_count;

  -- d) Started but never ended, two hours after the scheduled end.
  update public.shifts
     set status = 'completed',
         actual_end = scheduled_end,
         notes = concat_ws(' ', notes, '[Auto-closed: guard did not end the shift]')
   where status = 'active' and scheduled_end + interval '2 hours' < now();
  get diagnostics v_auto_closed = row_count;

  -- e) Privacy: drop old GPS trail.
  delete from public.location_pings
   where recorded_at < now() - make_interval(days => v_set.location_retention_days);
  get diagnostics v_pings_deleted = row_count;

  return jsonb_build_object(
    'shift_not_started_alarms', v_not_started,
    'missed_checkpoint_alarms', v_missed,
    'shifts_marked_missed',     v_shifts_missed,
    'shifts_auto_closed',       v_auto_closed,
    'location_pings_deleted',   v_pings_deleted
  );
end;
$$;
revoke all on function public.run_patrol_monitor() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Schedule it with pg_cron (built into Supabase). Wrapped in a check so the
-- migration still runs on a Postgres without pg_cron (e.g. a local test).
-- ---------------------------------------------------------------------------
do $do$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule('patrol-monitor', '*/5 * * * *', 'select public.run_patrol_monitor();');
  else
    raise notice 'pg_cron not available: schedule public.run_patrol_monitor() manually';
  end if;
end;
$do$;

-- ---------------------------------------------------------------------------
-- contractor_report: one row per guard of a contractor for one month.
-- Used by the portal to build the monthly PDF. Staff only.
-- p_month is any date inside the month, e.g. '2026-10-01'.
-- ---------------------------------------------------------------------------
create or replace function public.contractor_report(p_contractor_id uuid, p_month date)
returns table (
  guard_id         uuid,
  full_name        text,
  employee_no      text,
  shifts           integer,
  shifts_missed    integer,
  expected         integer,
  completed        integer,
  on_time          integer,
  completion_rate  numeric,
  punctuality_rate numeric,
  incidents        integer,
  sos              integer,
  rejected_scans   integer
)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_tz   text;
  v_from timestamptz;
  v_to   timestamptz;
begin
  if not public.is_staff() then
    raise exception 'Only supervisors can run reports' using errcode = '42501';
  end if;
  select timezone into v_tz from public.app_settings where id = 1;
  -- Month boundaries in Muscat local time, converted to absolute instants.
  v_from := (date_trunc('month', p_month)::timestamp) at time zone v_tz;
  v_to   := ((date_trunc('month', p_month) + interval '1 month')::timestamp) at time zone v_tz;

  return query
  select p.id, p.full_name, p.employee_no,
         (st ->> 'shifts')::integer,
         (st ->> 'shifts_missed')::integer,
         (st ->> 'expected')::integer,
         (st ->> 'completed')::integer,
         (st ->> 'on_time')::integer,
         (st ->> 'completion_rate')::numeric,
         (st ->> 'punctuality_rate')::numeric,
         (st ->> 'incidents')::integer,
         (st ->> 'sos')::integer,
         (st ->> 'rejected_scans')::integer
  from public.profiles p
  cross join lateral public.patrol_stats(p.id, v_from, v_to) as st
  where p.contractor_id = p_contractor_id
    and p.role = 'guard'
    and (p.active or (st ->> 'shifts')::integer > 0)
  order by p.full_name;
end;
$$;
revoke all on function public.contractor_report(uuid, date) from public, anon;
grant execute on function public.contractor_report(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- live_guard_positions: latest GPS point of every guard on an active shift.
-- ---------------------------------------------------------------------------
create or replace view public.live_guard_positions
with (security_invoker = true)
as
select distinct on (lp.guard_id)
  lp.guard_id,
  p.full_name,
  p.phone,
  lp.shift_id,
  r.name        as route_name,
  lp.latitude,
  lp.longitude,
  lp.accuracy_m,
  lp.is_mocked,
  lp.recorded_at
from public.location_pings lp
join public.shifts s   on s.id = lp.shift_id and s.status = 'active'
join public.profiles p on p.id = lp.guard_id
join public.routes r   on r.id = s.route_id
where lp.recorded_at > now() - interval '12 hours'
order by lp.guard_id, lp.recorded_at desc;
grant select on public.live_guard_positions to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime: the portal subscribes to these tables to update the live map and
-- pop up alarms instantly. Realtime respects RLS.
-- ---------------------------------------------------------------------------
do $do$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.alarms, public.location_pings, public.scans, public.incidents;
  else
    raise notice 'supabase_realtime publication not found: enable Realtime in the dashboard';
  end if;
end;
$do$;
