-- Patrols at any time, and read-only reports for the security account.
--
-- 1. There are no fixed patrol hours any more. A patrol starts whenever the
--    guard taps Start scanning and lasts 12 hours from that moment. Nothing is
--    prepared in advance, so no "not started" alarm is raised for a window.
-- 2. Once every location of a patrol is verified, the guard can start a new
--    round straight away: the finished round is closed first.
-- 3. The security account can open the reports for its own patrols (the
--    daily report on its dashboard). Staff still see every patrol.
-- 4. The supervisor's setup card saves the security login and the four guard
--    names only (save_patrol_team), without hours.

-- 1. No fixed hours: prepare_daily_patrols() returns early while they are empty.
update public.app_settings set night_shift_start = null, night_shift_end = null where id = 1;

-- Upcoming automatic patrols that were never started are no longer expected.
update public.shifts set status = 'cancelled'
where automatic_patrol_date is not null and status = 'scheduled';

do $$
begin
  -- Nested so cron.job is only read where pg_cron exists (not in the test database).
  if exists(select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'prepare-daily-patrol';
  end if;
end;
$$;

-- Every patrol now runs for 12 hours from the moment it starts.
create or replace function public.start_patrol_now(p_on_duty_name text, p_end time default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_start time := (now() at time zone 'Asia/Muscat')::time;
begin
  if public.my_role() is distinct from 'guard'::public.user_role then
    raise exception 'Sign in with an active security account' using errcode = '42501';
  end if;
  return public.start_my_patrol(v_start, coalesce(p_end, (v_start + interval '12 hours')::time), p_on_duty_name);
end;
$$;
revoke all on function public.start_patrol_now(text,time) from public, anon;
grant execute on function public.start_patrol_now(text,time) to authenticated;

-- 2. As before, plus: a fully verified round is closed so a new round can start,
-- and a new round may overlap the hours of an earlier, finished one.
create or replace function public.start_my_patrol(p_start time, p_end time, p_on_duty_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(p_on_duty_name);
  v_now timestamp := now() at time zone 'Asia/Muscat';
  v_day date;
  v_from timestamptz;
  v_to timestamptz;
  v_route uuid;
  v_shift uuid;
  v_active_name text;
begin
  if public.my_role() is distinct from 'guard'::public.user_role then
    raise exception 'Sign in with an active security account' using errcode = '42501';
  end if;
  if p_start is null or p_end is null or p_start = p_end then
    raise exception 'Choose different start and end times' using errcode = '22023';
  end if;
  if v_name is null or not exists(select 1 from public.app_settings where id = 1 and v_name = any(guard_names)) then
    raise exception 'Choose your name from the guard list' using errcode = '22023';
  end if;
  -- The same lock as automatic preparation prevents simultaneous route/shift creation.
  perform pg_advisory_xact_lock(hashtextextended('muscat-bay-daily-patrol', 0));
  perform public.prepare_my_patrol();
  select id, on_duty_name into v_shift, v_active_name from public.shifts
    where guard_id = v_uid and status = 'active' for update;
  if v_shift is not null then
    if not exists(select 1 from public.shift_checkpoint_status where shift_id = v_shift and not completed) then
      -- Every location is verified: this round is finished.
      update public.shifts set status = 'completed', actual_end = now() where id = v_shift;
    elsif v_active_name is distinct from v_name then
      raise exception 'This patrol is already in progress under %. Refresh to continue it.', v_active_name using errcode = '22023';
    else
      return v_shift;
    end if;
  end if;
  v_day := v_now::date - case when p_end < p_start and v_now::time < p_end then 1 else 0 end;
  v_from := (v_day + p_start) at time zone 'Asia/Muscat';
  v_to := (v_day + p_end + case when p_end < p_start then interval '1 day' else interval '0 days' end) at time zone 'Asia/Muscat';
  if now() < v_from or now() >= v_to then
    raise exception 'The chosen hours do not include the current Muscat time. Adjust the times to start scanning now.' using errcode = '22023';
  end if;
  if not exists(select 1 from public.checkpoints where active) then
    raise exception 'No patrol locations have been added yet' using errcode = '22023';
  end if;
  select patrol_route_id into v_route from public.app_settings where id = 1;
  if v_route is null then
    insert into public.routes(name, description) values ('Muscat Bay night patrol', 'All active patrol locations') returning id into v_route;
    update public.app_settings set patrol_route_id = v_route where id = 1;
  end if;
  insert into public.route_checkpoints(route_id, checkpoint_id, sequence, due_offset_min)
    select v_route, c.id, (select coalesce(max(sequence),0) from public.route_checkpoints where route_id = v_route)
      + row_number() over(order by c.name,c.id)::integer, 0
    from public.checkpoints c where c.active and not exists(
      select 1 from public.route_checkpoints rc where rc.route_id = v_route and rc.checkpoint_id = c.id);
  -- Reuse an unstarted overlapping schedule; never reset a started patrol.
  select id into v_shift from public.shifts where guard_id = v_uid and status = 'scheduled'
    and scheduled_start < v_to and scheduled_end > v_from order by scheduled_start limit 1 for update;
  if v_shift is null then
    insert into public.shifts(guard_id,route_id,scheduled_start,scheduled_end)
      values(v_uid,v_route,v_from,v_to) returning id into v_shift;
  else
    update public.shifts set route_id = v_route, scheduled_start = v_from, scheduled_end = v_to where id = v_shift;
  end if;
  perform public.start_shift_as(v_shift,v_name,null);
  return v_shift;
end;
$$;
revoke all on function public.start_my_patrol(time,time,text) from public, anon;
grant execute on function public.start_my_patrol(time,time,text) to authenticated;

-- 3. Staff see every patrol; a security account sees only its own.
create or replace function public.patrol_report(p_from date, p_to date, p_contractor_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_result jsonb;
  v_staff boolean := public.is_staff();
begin
  if not v_staff and public.my_role() is distinct from 'guard'::public.user_role then
    raise exception 'Sign in to view reports' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to or not isfinite(p_from) or not isfinite(p_to) then
    raise exception 'Choose a valid start and end date' using errcode = '22023';
  end if;
  select jsonb_build_object(
    'from_date', p_from, 'to_date', p_to, 'generated_at', now(),
    'contractor_name', (select name from public.contractors where id = p_contractor_id),
    'shifts', coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'patrol_date', (s.scheduled_start at time zone 'Asia/Muscat')::date,
      'guard_name', s.on_duty_name, 'guard_ref', s.on_duty_ref, 'login_name', p.full_name,
      'route_name', r.name, 'status', s.status, 'scheduled_start', s.scheduled_start,
      'scheduled_end', s.scheduled_end, 'actual_start', s.actual_start,
      'actual_end', s.actual_end, 'auto_closed_at', s.auto_closed_at,
      'checkpoints', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', cp.id, 'name', cp.name, 'sequence', sc.sequence,
          'scans', (
            select coalesce(jsonb_agg(jsonb_build_object(
              'id', x.id, 'device_time', x.device_time, 'server_time', x.server_time,
              'effective_time', x.effective_time, 'validation', x.validation,
              'latitude', x.latitude, 'longitude', x.longitude, 'accuracy_m', x.accuracy_m,
              'distance_m', x.distance_m, 'status', x.status, 'note', x.note,
              'flags', x.flags, 'review_note', x.review_note, 'expected_attachments', x.expected_attachments,
              'attachment_count', (select count(*) from public.scan_attachments a where a.scan_id = x.id)
            ) order by x.effective_time, x.id), '[]'::jsonb)
            from public.scans x where x.shift_id = s.id and x.checkpoint_id = cp.id
          )
        ) order by sc.sequence, cp.id), '[]'::jsonb)
        from public.shift_checkpoints sc join public.checkpoints cp on cp.id = sc.checkpoint_id
        where sc.shift_id = s.id
      )
    ) order by s.scheduled_start, s.id), '[]'::jsonb)
  ) into v_result
  from public.shifts s
  join public.profiles p on p.id = s.guard_id
  join public.routes r on r.id = s.route_id
  where s.scheduled_start >= p_from::timestamp at time zone 'Asia/Muscat'
    and s.scheduled_start < (p_to + 1)::timestamp at time zone 'Asia/Muscat'
    and (p_contractor_id is null or p.contractor_id = p_contractor_id)
    and (v_staff or s.guard_id = auth.uid());
  return v_result;
end;
$$;
revoke all on function public.patrol_report(date, date, uuid) from public, anon;
grant execute on function public.patrol_report(date, date, uuid) to authenticated;

-- 4. Patrol setup without hours: the security login and the four guard names.
create function public.save_patrol_team(p_guard_id uuid, p_guard_names text[])
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_names text[];
begin
  if not public.is_staff() then raise exception 'Only supervisors can set up the patrol' using errcode = '42501'; end if;
  if not exists(select 1 from public.profiles where id = p_guard_id and active and role = 'guard') then
    raise exception 'Choose an active security login' using errcode = '22023';
  end if;
  select array_agg(btrim(name) order by ordinal) into v_names from unnest(p_guard_names) with ordinality as names(name, ordinal);
  if cardinality(v_names) is distinct from 4 or exists(select 1 from unnest(v_names) as n where n is null or length(n) not between 3 and 100)
     or (select count(distinct lower(n)) from unnest(v_names) as n) <> 4 then
    raise exception 'Enter four different guard names, each between 3 and 100 characters' using errcode = '22023';
  end if;
  update public.app_settings set patrol_guard_id = p_guard_id, guard_names = v_names where id = 1;
end;
$$;
revoke all on function public.save_patrol_team(uuid, text[]) from public, anon;
grant execute on function public.save_patrol_team(uuid, text[]) to authenticated;
