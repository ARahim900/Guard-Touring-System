-- =============================================================================
-- Muscat Bay Patrol System — 06: "Guard on duty" for a shared login
-- =============================================================================
-- Muscat Bay security uses ONE shared login, with one guard patrolling once a
-- day. So the login alone no longer tells us WHO patrolled. At "Start shift"
-- the guard must type their own name (and optionally an employee/ID number).
-- It is stored on the shift and shown on every scan, alarm, SOS, the live map
-- and the reports. Once set it cannot be changed from the app, so a later user
-- of the same phone cannot rewrite who was on duty.
-- =============================================================================

alter table public.shifts
  add column on_duty_name text check (on_duty_name is null or length(on_duty_name) between 3 and 100),
  add column on_duty_ref  text check (on_duty_ref  is null or length(on_duty_ref)  <= 50);

comment on column public.shifts.on_duty_name is 'Name typed by the guard at Start shift (shared login)';
comment on column public.shifts.on_duty_ref  is 'Optional employee / ID number typed at Start shift';

-- ---------------------------------------------------------------------------
-- start_shift_as: start the shift AND record who is on duty, in one step.
-- All the usual checks (owner, timing, one active shift) happen inside
-- start_shift(). The name is only written if not already set.
-- ---------------------------------------------------------------------------
create or replace function public.start_shift_as(
  p_shift_id     uuid,
  p_on_duty_name text,
  p_on_duty_ref  text default null
)
returns public.shifts
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_name  text := nullif(btrim(p_on_duty_name), '');
  v_ref   text := nullif(btrim(p_on_duty_ref), '');
  v_shift public.shifts;
begin
  if v_name is null or length(v_name) < 3 then
    raise exception 'Enter your full name to start the shift' using errcode = '22023';
  end if;

  v_shift := public.start_shift(p_shift_id);

  update public.shifts
     set on_duty_name = coalesce(on_duty_name, left(v_name, 100)),
         on_duty_ref  = coalesce(on_duty_ref, left(v_ref, 50))
   where id = p_shift_id
  returning * into v_shift;

  return v_shift;
end;
$$;
revoke all on function public.start_shift_as(uuid, text, text) from public, anon;
grant execute on function public.start_shift_as(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- SOS: name the guard on duty (falls back to the login name).
-- ---------------------------------------------------------------------------
create or replace function public.trigger_sos(
  p_shift_id   uuid,
  p_latitude   double precision,
  p_longitude  double precision,
  p_accuracy_m double precision,
  p_message    text default null
)
returns public.alarms
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_name text;
  v_row  public.alarms;
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  if p_shift_id is not null and not exists (
    select 1 from public.shifts where id = p_shift_id and guard_id = v_uid
  ) then
    raise exception 'This shift is not assigned to you' using errcode = '42501';
  end if;

  select coalesce(
           (select on_duty_name from public.shifts where id = p_shift_id),
           (select full_name from public.profiles where id = v_uid))
    into v_name;

  insert into public.alarms (type, guard_id, shift_id, message, latitude, longitude, accuracy_m)
  values ('sos', v_uid, p_shift_id,
          'SOS raised by ' || coalesce(v_name, 'guard') || coalesce(': ' || nullif(btrim(p_message), ''), ''),
          p_latitude, p_longitude, p_accuracy_m)
  returning * into v_row;
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Live map: show the guard on duty rather than the shared login name.
-- (Same columns as before, so the portal needs no change to read it.)
-- ---------------------------------------------------------------------------
create or replace view public.live_guard_positions
with (security_invoker = true)
as
select distinct on (lp.guard_id)
  lp.guard_id,
  coalesce(s.on_duty_name, p.full_name) as full_name,
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
