-- Guards can start their own patrol without supervisor scheduling.
create or replace function public.prepare_my_patrol()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.my_role() is distinct from 'guard'::public.user_role then
    raise exception 'Sign in with the security login to scan' using errcode = '42501';
  end if;
  update public.shifts set status = 'completed', auto_closed_at = now(), actual_end = null
    where guard_id = auth.uid() and status = 'active' and scheduled_end <= now();
  if exists(select 1 from public.app_settings where id = 1 and patrol_guard_id = auth.uid()) then
    perform public.prepare_daily_patrols();
  end if;
end;
$$;

create function public.start_my_patrol(p_start time, p_end time, p_on_duty_name text)
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
    if v_active_name is distinct from v_name then
      raise exception 'This patrol is already in progress under %. Refresh to continue it.', v_active_name using errcode = '22023';
    end if;
    return v_shift;
  end if;
  v_day := v_now::date - case when p_end < p_start and v_now::time < p_end then 1 else 0 end;
  v_from := (v_day + p_start) at time zone 'Asia/Muscat';
  v_to := (v_day + p_end + case when p_end < p_start then interval '1 day' else interval '0 days' end) at time zone 'Asia/Muscat';
  if now() < v_from or now() >= v_to then
    raise exception 'The chosen hours do not include the current Muscat time. Adjust the times to start scanning now.' using errcode = '22023';
  end if;
  if exists(select 1 from public.shifts where guard_id = v_uid and status in ('completed','missed')
    and scheduled_start < v_to and scheduled_end > v_from) then
    raise exception 'These hours overlap a finished patrol. Choose the hours for your new shift.' using errcode = '22023';
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

-- Location preview before a shift exists; existing row policies remain unchanged.
create function public.patrol_locations()
returns table(id uuid, name text, code text, latitude double precision, longitude double precision)
language plpgsql security definer set search_path = '' as $$
begin
  if public.my_role() is distinct from 'guard'::public.user_role then
    raise exception 'Sign in with an active security account' using errcode = '42501';
  end if;
  return query select c.id,c.name,c.code,c.latitude,c.longitude from public.checkpoints c where c.active order by c.name,c.id;
end;
$$;
revoke all on function public.patrol_locations() from public, anon;
grant execute on function public.patrol_locations() to authenticated;
