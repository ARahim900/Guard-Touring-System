-- =============================================================================
-- Delete a location
-- =============================================================================
-- A supervisor can delete a location that has no patrol history: it was never
-- part of a finished patrol and has no scans, alarms or incidents. It is removed
-- from the route and from patrols that are running or not yet started.
--
-- A location WITH history is retired (made inactive) instead, so past reports
-- still show it was required and whether it was visited. The function says
-- which of the two happened.
-- =============================================================================

create function public.delete_checkpoint(p_id uuid)
returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_cp public.checkpoints;
begin
  if not public.is_staff() then
    raise exception 'Only supervisors can delete locations' using errcode = '42501';
  end if;

  select * into v_cp from public.checkpoints where id = p_id for update;
  if not found then
    raise exception 'Location not found' using errcode = 'P0002';
  end if;

  if exists (select 1 from public.scans where checkpoint_id = p_id)
     or exists (select 1 from public.alarms where checkpoint_id = p_id)
     or exists (select 1 from public.incidents where checkpoint_id = p_id)
     or exists (select 1 from public.shift_checkpoints sc
                  join public.shifts s on s.id = sc.shift_id
                 where sc.checkpoint_id = p_id and s.status in ('completed', 'missed'))
  then
    update public.checkpoints set active = false where id = p_id;
    return 'retired';
  end if;

  delete from public.shift_checkpoints where checkpoint_id = p_id;
  delete from public.route_checkpoints where checkpoint_id = p_id;
  delete from public.checkpoints where id = p_id;
  return 'deleted';
end;
$$;
revoke all on function public.delete_checkpoint(uuid) from public, anon;
grant execute on function public.delete_checkpoint(uuid) to authenticated;
