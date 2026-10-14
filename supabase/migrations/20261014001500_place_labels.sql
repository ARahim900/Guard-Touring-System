-- =============================================================================
-- Placing labels on site
-- =============================================================================
-- A supervisor fixes a printed label at its location and scans it with their
-- phone. The phone's GPS position becomes the location's position and the
-- location goes live (active) in one step, without filling in a form.
--
-- placed_at records when a location's position was confirmed. A location added
-- before anyone has been on site has a placeholder position, placed_at NULL and
-- stays inactive, so guards never see it and no scan is judged against it.
-- =============================================================================

alter table public.checkpoints add column placed_at timestamptz;
comment on column public.checkpoints.placed_at is
  'When the position was confirmed (label scanned on site, or saved by a supervisor). '
  'NULL = label not yet placed: the position is a placeholder and the location stays inactive.';

-- Locations already in use have a confirmed position.
update public.checkpoints set placed_at = created_at where active and placed_at is null;

create function public.place_checkpoint(
  p_code        text,
  p_latitude    double precision,
  p_longitude   double precision,
  p_accuracy_m  double precision,
  p_replace     boolean default false
)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_cp  public.checkpoints;
  v_max numeric;
begin
  if not public.is_staff() then
    raise exception 'Only supervisors can place labels' using errcode = '42501';
  end if;

  select * into v_cp from public.checkpoints where code = btrim(p_code) for update;
  if not found then
    raise exception 'This label is not in the system. Check its code under Locations.' using errcode = 'P0002';
  end if;

  if p_latitude is null or p_longitude is null
     or p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then
    raise exception 'No valid GPS position. Move into the open and scan again.' using errcode = '22023';
  end if;

  select max_gps_accuracy_m into v_max from public.app_settings where id = 1;
  if p_accuracy_m is null or p_accuracy_m < 0 then
    raise exception 'The phone did not report GPS accuracy. Scan again.' using errcode = '22023';
  end if;
  if p_accuracy_m > v_max then
    raise exception 'GPS accuracy is ±% m; ±% m or better is needed. Wait a few seconds in the open and scan again.',
      round(p_accuracy_m::numeric), v_max using errcode = '22023';
  end if;

  -- Moving a label that is already in use needs a deliberate second step.
  if v_cp.placed_at is not null and not coalesce(p_replace, false) then
    return jsonb_build_object(
      'status', 'already_placed', 'name', v_cp.name, 'code', v_cp.code, 'placed_at', v_cp.placed_at,
      'distance_m', round(public.distance_m(p_latitude, p_longitude, v_cp.latitude, v_cp.longitude)::numeric, 1));
  end if;

  update public.checkpoints
     set latitude = p_latitude,
         longitude = p_longitude,
         placed_at = now(),
         active = true,
         description = case when description like 'POSITION NOT SET%' then null else description end
   where id = v_cp.id;

  return jsonb_build_object('status', 'placed', 'name', v_cp.name, 'code', v_cp.code,
                            'accuracy_m', round(p_accuracy_m::numeric, 1));
end;
$$;
revoke all on function public.place_checkpoint(text, double precision, double precision, double precision, boolean) from public, anon;
grant execute on function public.place_checkpoint(text, double precision, double precision, double precision, boolean) to authenticated;
