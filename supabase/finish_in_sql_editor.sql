-- =============================================================================
-- FINISH THE DATABASE: run this ONCE in Supabase -> SQL Editor -> New query.
-- =============================================================================
-- Everything else is already installed on project zdezuylsruzbddqcdhog.
-- This last piece could not be installed through the Claude connector because
-- the function contains a DELETE (it removes GPS points older than 90 days, for
-- privacy), and the connector holds DELETE statements for a confirmation it
-- could not show. Nothing is deleted when you run this: it only DEFINES the
-- function and schedules it to run every 5 minutes.
--
-- What the function does every 5 minutes:
--   a) raises "shift not started" alarms (guard no-show),
--   b) raises "missed checkpoint" alarms once due time + 15 min has passed,
--   c) marks never-started shifts as missed,
--   d) auto-closes shifts a guard forgot to end,
--   e) deletes GPS trail older than 90 days.
-- =============================================================================

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
         actual_end = scheduled_end + v_grace,  -- keeps the normal late-scan window
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

-- Run it every 5 minutes (pg_cron is already enabled).
select cron.schedule('patrol-monitor', '*/5 * * * *', 'select public.run_patrol_monitor();');

-- Check: should return one row "patrol-monitor | */5 * * * *".
select jobname, schedule from cron.job;
