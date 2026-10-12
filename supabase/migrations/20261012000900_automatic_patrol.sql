alter table public.app_settings
  add column patrol_guard_id uuid references public.profiles(id),
  add column patrol_route_id uuid references public.routes(id),
  add column patrol_first_date date,
  add column guard_names text[] not null default '{}';

alter table public.shifts add column automatic_patrol_date date unique;

-- Only the scheduler and checked entry points below can prepare patrols.
create function public.prepare_daily_patrols()
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_guard uuid;
  v_route uuid;
  v_first date;
  v_start time;
  v_end time;
  v_day date;
  v_now timestamp := now() at time zone 'Asia/Muscat';
  v_from timestamptz;
  v_to timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended('muscat-bay-daily-patrol', 0));
  select patrol_guard_id, patrol_route_id, patrol_first_date, night_shift_start, night_shift_end
    into v_guard, v_route, v_first, v_start, v_end
    from public.app_settings where id = 1;
  if v_guard is null or v_route is null or v_start is null or v_end is null then return; end if;
  if not exists (select 1 from public.profiles where id = v_guard and active and role = 'guard') then return; end if;

  -- Freeze unstarted nights before route changes can refresh their snapshots.
  update public.shifts set status = 'missed'
  where automatic_patrol_date is not null and status = 'scheduled' and scheduled_end <= now();

  insert into public.route_checkpoints(route_id, checkpoint_id, sequence, due_offset_min)
  select v_route, c.id,
    (select coalesce(max(sequence), 0) from public.route_checkpoints where route_id = v_route)
      + row_number() over (order by c.name, c.id)::integer, 0
  from public.checkpoints c
  where c.active and not exists (
    select 1 from public.route_checkpoints rc where rc.route_id = v_route and rc.checkpoint_id = c.id
  );
  if not exists (select 1 from public.checkpoints where active) then return; end if;

  -- Tomorrow is prepared in advance so an unstarted night remains reportable.
  for v_day in select generate_series(v_now::date - 1, v_now::date + 1, interval '1 day')::date loop
    v_from := (v_day + v_start) at time zone 'Asia/Muscat';
    v_to := (v_day + v_end + case when v_end < v_start then interval '1 day' else interval '0 days' end) at time zone 'Asia/Muscat';
    if v_day < v_first or v_to <= now() then continue; end if;
    insert into public.shifts(guard_id, route_id, scheduled_start, scheduled_end, automatic_patrol_date)
    values(v_guard, v_route, v_from, v_to, v_day)
    on conflict(automatic_patrol_date) do update
      set guard_id = excluded.guard_id, scheduled_start = excluded.scheduled_start,
          scheduled_end = excluded.scheduled_end
      where shifts.status = 'scheduled' and shifts.scheduled_start > now()
        and (shifts.guard_id, shifts.scheduled_start, shifts.scheduled_end)
          is distinct from (excluded.guard_id, excluded.scheduled_start, excluded.scheduled_end);
  end loop;

  update public.shifts set status = 'completed', auto_closed_at = now(), actual_end = null
  where automatic_patrol_date is not null and status = 'active' and scheduled_end <= now();
end;
$$;
revoke all on function public.prepare_daily_patrols() from public, anon, authenticated;

create function public.save_daily_patrol(p_guard_id uuid, p_start time, p_end time, p_guard_names text[])
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_route uuid;
  v_first date;
  v_names text[];
  v_now timestamp := now() at time zone 'Asia/Muscat';
begin
  if not public.is_staff() then raise exception 'Only supervisors can set up the patrol' using errcode = '42501'; end if;
  if p_start is null or p_end is null or p_start = p_end then
    raise exception 'Choose different start and end times' using errcode = '22023';
  end if;
  if not exists(select 1 from public.profiles where id = p_guard_id and active and role = 'guard') then
    raise exception 'Choose an active security login' using errcode = '22023';
  end if;
  select array_agg(btrim(name) order by ordinal) into v_names from unnest(p_guard_names) with ordinality as names(name, ordinal);
  if cardinality(v_names) is distinct from 4 or exists(select 1 from unnest(v_names) as n where n is null or length(n) not between 3 and 100)
     or (select count(distinct lower(n)) from unnest(v_names) as n) <> 4 then
    raise exception 'Enter four different guard names, each between 3 and 100 characters' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('muscat-bay-daily-patrol', 0));
  select patrol_route_id, patrol_first_date into v_route, v_first from public.app_settings where id = 1;
  if v_route is null then
    v_route := gen_random_uuid();
    insert into public.routes(id, name, description)
    values(v_route, 'Muscat Bay night patrol', 'All active locations; managed automatically');
  end if;
  if v_first is null then
    v_first := v_now::date - case when p_end < p_start and v_now::time < p_end then 1 else 0 end;
  end if;
  update public.app_settings set patrol_guard_id = p_guard_id, patrol_route_id = v_route,
    patrol_first_date = v_first, night_shift_start = p_start, night_shift_end = p_end, guard_names = v_names where id = 1;
  perform public.prepare_daily_patrols();
end;
$$;
revoke all on function public.save_daily_patrol(uuid, time, time, text[]) from public, anon;
grant execute on function public.save_daily_patrol(uuid, time, time, text[]) to authenticated;

create function public.prepare_my_patrol()
returns void language plpgsql security definer set search_path = '' as $$
declare v_guard uuid;
begin
  if public.my_role() is distinct from 'guard'::public.user_role then
    raise exception 'Sign in with the security login to scan' using errcode = '42501';
  end if;
  select patrol_guard_id into v_guard from public.app_settings where id = 1;
  if v_guard is null then raise exception 'Night patrol setup has not been saved yet. Ask your manager to open Night patrol.'; end if;
  if v_guard is distinct from auth.uid() then raise exception 'This is not the security login selected for the night patrol. Ask your manager to check Night patrol setup.' using errcode = '42501'; end if;
  perform public.prepare_daily_patrols();
end;
$$;
revoke all on function public.prepare_my_patrol() from public, anon;
grant execute on function public.prepare_my_patrol() to authenticated;

do $$
begin
  if exists(select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('prepare-daily-patrol', '* * * * *', 'select public.prepare_daily_patrols();');
  else
    raise notice 'pg_cron not available: schedule public.prepare_daily_patrols() every minute';
  end if;
end;
$$;

-- The selected name is checked on the server and retained on the shift.
create or replace function public.start_shift_as(p_shift_id uuid, p_on_duty_name text, p_on_duty_ref text default null)
returns public.shifts language plpgsql security definer set search_path = '' as $$
declare
  v_name text := nullif(btrim(p_on_duty_name), '');
  v_shift public.shifts;
  v_day date;
begin
  if v_name is null or length(v_name) not between 3 and 100 then
    raise exception 'Choose the guard on duty' using errcode = '22023';
  end if;
  select automatic_patrol_date into v_day from public.shifts where id = p_shift_id and guard_id = auth.uid();
  if v_day is not null and not exists(
    select 1 from public.app_settings where id = 1 and v_name = any(guard_names)
  ) then raise exception 'Choose a name from the current guard list' using errcode = '22023'; end if;
  v_shift := public.start_shift(p_shift_id);
  if v_shift.on_duty_name is not null and v_shift.on_duty_name <> v_name then
    raise exception 'This patrol was already started by %. Refresh to continue it.', v_shift.on_duty_name using errcode = '22023';
  end if;
  update public.shifts set on_duty_name = coalesce(on_duty_name, v_name),
    on_duty_ref = coalesce(on_duty_ref, left(nullif(btrim(p_on_duty_ref), ''), 50))
    where id = p_shift_id returning shifts.* into v_shift;
  return v_shift;
end;
$$;
