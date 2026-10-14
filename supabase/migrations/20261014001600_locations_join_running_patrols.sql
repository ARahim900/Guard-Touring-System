-- =============================================================================
-- New locations join running patrols straight away
-- =============================================================================
-- Until now a patrol kept the list of locations it started with, so a location
-- added or placed during a patrol only appeared on the next one. Supervisors
-- expect it to appear at once. Now, when a location becomes active (added as
-- active, placed on the map or on site, or re-activated), it is added to the
-- patrol route and to every patrol that is running. Retiring a location never
-- removes it from a running patrol, so a visit already made stays counted.
-- =============================================================================

create function public.add_location_to_running_patrols()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_route uuid;
begin
  if not new.active or (tg_op = 'UPDATE' and old.active) then
    return null;
  end if;

  -- Patrols whose time is over but never started are missed: freeze them first so
  -- a location added afterwards does not change what was required on that night
  -- (the same order the nightly scheduler uses).
  update public.shifts set status = 'missed'
   where status = 'scheduled' and scheduled_end <= now();

  select patrol_route_id into v_route from public.app_settings where id = 1;
  if v_route is not null then
    -- Joining the route also refreshes patrols not yet started (existing trigger).
    insert into public.route_checkpoints (route_id, checkpoint_id, sequence, due_offset_min)
    select v_route, new.id, coalesce(max(rc.sequence), 0) + 1, 0
      from public.route_checkpoints rc where rc.route_id = v_route
    on conflict (route_id, checkpoint_id) do nothing;
  end if;

  insert into public.shift_checkpoints (shift_id, checkpoint_id, sequence, due_offset_min)
  select s.id, new.id,
         (select coalesce(max(sc.sequence), 0) + 1 from public.shift_checkpoints sc where sc.shift_id = s.id), 0
    from public.shifts s
   where s.status = 'active'
     and exists (select 1 from public.route_checkpoints rc
                  where rc.route_id = s.route_id and rc.checkpoint_id = new.id)
  on conflict (shift_id, checkpoint_id) do nothing;

  return null;
end;
$$;
revoke all on function public.add_location_to_running_patrols() from public, anon, authenticated;

create trigger checkpoints_join_running_patrols
  after insert or update of active on public.checkpoints
  for each row execute function public.add_location_to_running_patrols();

-- Patrols running now: add the active route locations they are missing.
insert into public.shift_checkpoints (shift_id, checkpoint_id, sequence, due_offset_min)
select s.id, c.id,
       (select coalesce(max(sc.sequence), 0) from public.shift_checkpoints sc where sc.shift_id = s.id)
         + row_number() over (partition by s.id order by c.name, c.id)::integer,
       0
  from public.shifts s
  join public.route_checkpoints rc on rc.route_id = s.route_id
  join public.checkpoints c on c.id = rc.checkpoint_id and c.active
 where s.status = 'active'
   and not exists (select 1 from public.shift_checkpoints sc
                    where sc.shift_id = s.id and sc.checkpoint_id = c.id);
