-- =============================================================================
-- Muscat Bay Patrol System — 07: daily patrol log
-- =============================================================================
-- With one shared security login, the monthly "per guard" table has a single
-- row. Supervisors need one row PER DAY instead: who was on duty (the name
-- typed at Start shift), which route, how many checkpoints were visited and
-- how many on time. Done in the database so a long month is never cut short by
-- the API's row limit.
-- =============================================================================

create or replace function public.daily_patrol_log(p_contractor_id uuid, p_month date)
returns table (
  shift_id          uuid,
  patrol_date       date,
  on_duty_name      text,
  on_duty_ref       text,
  login_name        text,
  route_name        text,
  status            public.shift_status,
  scheduled_start   timestamptz,
  actual_start      timestamptz,
  actual_end        timestamptz,
  checkpoints_total integer,
  visited           integer,
  on_time           integer,
  incidents         integer,
  sos               integer
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
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
  select s.id,
         (s.scheduled_start at time zone v_tz)::date,
         coalesce(s.on_duty_name, p.full_name),
         s.on_duty_ref,
         p.full_name,
         r.name,
         s.status,
         s.scheduled_start,
         s.actual_start,
         s.actual_end,
         coalesce(cs.total, 0)::integer,
         coalesce(cs.visited, 0)::integer,
         coalesce(cs.punctual, 0)::integer,
         (select count(*)::integer from public.incidents i where i.shift_id = s.id),
         (select count(*)::integer from public.alarms a where a.shift_id = s.id and a.type = 'sos')
  from public.shifts s
  join public.profiles p on p.id = s.guard_id
  join public.routes r   on r.id = s.route_id
  left join lateral (
    select count(*)                                  as total,
           count(*) filter (where scs.completed)     as visited,
           count(*) filter (where scs.is_on_time)    as punctual
    from public.shift_checkpoint_status scs
    where scs.shift_id = s.id
  ) cs on true
  where p.contractor_id = p_contractor_id
    and p.role = 'guard'
    and s.scheduled_start >= v_from
    and s.scheduled_start <  v_to
  order by s.scheduled_start;
end;
$$;
revoke all on function public.daily_patrol_log(uuid, date) from public, anon;
grant execute on function public.daily_patrol_log(uuid, date) to authenticated;
