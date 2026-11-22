-- =============================================================================
-- Every new scan must carry the guard's name.
-- =============================================================================
-- The old upload route (submit_scan) is closed to the apps, so a phone still on
-- an old app version cannot upload a scan without a name. Its scans stay on the
-- phone and upload once it picks up the new version.
-- Scans taken on the phone before this update could not have a name. Those
-- still upload through submit_scan_as, with no name stored (never guessed).
-- "Before this update" is judged by the phone's scan time against the moment
-- this migration was applied.
-- =============================================================================

alter table public.app_settings add column named_scans_from timestamptz;
update public.app_settings set named_scans_from = now();

create or replace function public.submit_scan_as(
  p_guard_name           text,
  p_scan_id              uuid,
  p_shift_id             uuid,
  p_checkpoint_id        uuid,
  p_method               public.scan_method,
  p_raw_value            text,
  p_status               public.scan_status,
  p_note                 text,
  p_device_time          timestamptz,
  p_device_sent_at       timestamptz,
  p_latitude             double precision,
  p_longitude            double precision,
  p_accuracy_m           double precision,
  p_is_mocked            boolean,
  p_expected_attachments integer default 0
)
returns public.scans language plpgsql security definer set search_path = '' as $$
declare
  v_name text := nullif(btrim(p_guard_name), '');
  v_from timestamptz := (select s.named_scans_from from public.app_settings s where s.id = 1);
  v_row public.scans;
begin
  if length(v_name) > 80
     or (v_name is null and (v_from is null or p_device_time is null or p_device_time >= v_from)) then
    raise exception 'Choose your name from the guard list' using errcode = '22023';
  end if;
  v_row := public.submit_scan(p_scan_id, p_shift_id, p_checkpoint_id, p_method, p_raw_value, p_status, p_note,
    p_device_time, p_device_sent_at, p_latitude, p_longitude, p_accuracy_m, p_is_mocked, p_expected_attachments);
  if v_name is not null then
    insert into public.scan_guard_names(scan_id, guard_name) values (v_row.id, v_name)
      on conflict (scan_id) do nothing;
  end if;
  return v_row;
end;
$$;

revoke execute on function public.submit_scan(uuid, uuid, uuid, public.scan_method, text, public.scan_status, text,
  timestamptz, timestamptz, double precision, double precision, double precision, boolean, integer) from authenticated;
