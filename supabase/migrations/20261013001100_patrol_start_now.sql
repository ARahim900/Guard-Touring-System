-- Attendance starts on the server clock; guards only adjust the planned end if needed.
create function public.start_patrol_now(p_on_duty_name text, p_end time default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_start time := (now() at time zone 'Asia/Muscat')::time;
  v_end time;
begin
  if public.my_role() is distinct from 'guard'::public.user_role then
    raise exception 'Sign in with an active security account' using errcode = '42501';
  end if;
  select coalesce(p_end, night_shift_end, v_start + interval '12 hours') into v_end
    from public.app_settings where id = 1;
  return public.start_my_patrol(v_start, v_end, p_on_duty_name);
end;
$$;
revoke all on function public.start_patrol_now(text,time) from public, anon;
grant execute on function public.start_patrol_now(text,time) to authenticated;
