-- =============================================================================
-- Audit fixes (13 Oct 2026)
-- =============================================================================
-- F07: statistics count each required visit in the Muscat date the shift
--      STARTED, the same rule as patrol_report and daily_patrol_log. An
--      overnight patrol that crosses midnight at month end stays in one month.
-- F08: a "missed checkpoint" alarm is raised only after the shift end plus the
--      configured grace period, so a scan saved offline before the end has
--      time to upload before an alarm is raised.
-- This migration replaces supabase/finish_in_sql_editor.sql, which held an
-- older monitor and has been removed (F05). Migrations are the only source.
-- =============================================================================

create or replace function public.patrol_stats(
  p_guard_id uuid,
  p_from     timestamptz,
  p_to       timestamptz
)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_set    public.app_settings;
  v_result jsonb;
begin
  if p_guard_id is distinct from auth.uid() and not public.is_staff() then
    raise exception 'You can only view your own statistics' using errcode = '42501';
  end if;
  select * into v_set from public.app_settings where id = 1;

  with due as (
    select scs.*, s.scheduled_start
    from public.shift_checkpoint_status scs
    join public.shifts s on s.id = scs.shift_id
    where scs.guard_id = p_guard_id
      and s.scheduled_start >= p_from and s.scheduled_start < p_to
      and scs.shift_status <> 'cancelled'
      and (scs.completed or scs.due_at + make_interval(mins => v_set.grace_minutes) < now())
  ),
  totals as (
    select count(*)                                   as expected,
           count(*) filter (where completed)          as completed,
           count(*) filter (where completed and is_on_time) as on_time
    from due
  ),
  daily as (
    select (scheduled_start at time zone v_set.timezone)::date as day,
           count(*)                          as expected,
           count(*) filter (where completed) as completed,
           count(*) filter (where completed and is_on_time) as on_time
    from due
    group by 1
    order by 1
  )
  select jsonb_build_object(
    'expected',          t.expected,
    'completed',         t.completed,
    'on_time',           t.on_time,
    'completion_rate',   case when t.expected  = 0 then null else round(t.completed::numeric / t.expected  * 100, 1) end,
    'punctuality_rate',  case when t.completed = 0 then null else round(t.on_time::numeric  / t.completed * 100, 1) end,
    'shifts',            (select count(*) from public.shifts
                           where guard_id = p_guard_id and scheduled_start >= p_from and scheduled_start < p_to
                             and status <> 'cancelled'),
    'shifts_missed',     (select count(*) from public.shifts
                           where guard_id = p_guard_id and scheduled_start >= p_from and scheduled_start < p_to
                             and status = 'missed'),
    -- Incidents and SOS are events, so they stay with the time they happened.
    'incidents',         (select count(*) from public.incidents
                           where guard_id = p_guard_id and created_at >= p_from and created_at < p_to),
    'sos',               (select count(*) from public.alarms
                           where guard_id = p_guard_id and type = 'sos' and created_at >= p_from and created_at < p_to),
    'rejected_scans',    (select count(*) from public.scans x
                           join public.shifts s on s.id = x.shift_id
                           where x.guard_id = p_guard_id and x.validation = 'rejected'
                             and s.scheduled_start >= p_from and s.scheduled_start < p_to),
    'daily',             coalesce((select jsonb_agg(jsonb_build_object(
                             'day', d.day, 'expected', d.expected, 'completed', d.completed, 'on_time', d.on_time))
                           from daily d), '[]'::jsonb)
  )
  into v_result
  from totals t;

  return v_result;
end;
$$;

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

  -- b) Checkpoint not visited by the shift end plus the grace period.
  insert into public.alarms (type, guard_id, shift_id, checkpoint_id, message)
  select 'missed_checkpoint', scs.guard_id, scs.shift_id, scs.checkpoint_id,
         format('Missed %s (due %s)', scs.checkpoint_name,
                to_char(scs.due_at at time zone v_set.timezone, 'DD Mon HH24:MI'))
  from public.shift_checkpoint_status scs
  where scs.shift_status <> 'cancelled'
    and not scs.completed
    and scs.due_at + v_grace < now()
    and scs.due_at > now() - interval '2 days'
  on conflict (shift_id, checkpoint_id) where type = 'missed_checkpoint' do update
    set status = 'open', resolved_at = null, resolution_note = null
    where alarms.status = 'resolved';
  get diagnostics v_missed = row_count;

  update public.alarms a set status = 'resolved', resolved_at = now(),
    resolution_note = 'Checkpoint visit verified'
  where a.type = 'missed_checkpoint' and a.status <> 'resolved'
    and exists (select 1 from public.shift_checkpoint_status c where c.shift_id = a.shift_id
      and c.checkpoint_id = a.checkpoint_id and c.completed);

  -- c) Never started and now over.
  update public.shifts
     set status = 'missed'
   where status = 'scheduled' and scheduled_end + v_grace < now();
  get diagnostics v_shifts_missed = row_count;

  -- d) Close expired shifts without inventing an observed end time.
  update public.shifts
     set status = 'completed',
         auto_closed_at = now(),
         actual_end = null,
         notes = concat_ws(' ', notes, '[Auto-closed: guard did not end the shift]')
   where status = 'active' and scheduled_end < now();
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
