-- =============================================================================
-- Scan pattern checks (audit finding F02, GitHub issue #5)
-- =============================================================================
-- Three soft checks compare a new scan with the OTHER scans already stored for
-- the same shift. They only ever FLAG a scan for supervisor review; they never
-- reject it, and they are skipped when the scan is already rejected.
--
--   impossible_travel  The phone moved faster than any patrol on site could,
--                      measured against every trusted stored scan at the
--                      nearest time before and after this one (offline uploads
--                      can arrive out of order). Rejected scans and scans
--                      flagged too_far, low_accuracy, mock_location,
--                      invalid_coordinates or future_time are not trusted.
--   repeated_position  Exactly the same latitude and longitude (6 decimals) as
--                      a stored scan at a different checkpoint. Real GPS
--                      readings almost never repeat exactly; this suggests
--                      replayed or fake coordinates.
--   fast_round         This scan completes the shift's route faster than the
--                      minimum round time (off until a minimum is set).
--
-- submit_scan is copied unchanged from 20261012000800_night_patrol.sql apart
-- from a per-shift lock and the block marked "Pattern checks".
-- =============================================================================

alter table public.app_settings
  add column max_patrol_speed_kmh numeric default 80
    check (max_patrol_speed_kmh is null or max_patrol_speed_kmh > 0),
  add column min_round_minutes integer default null
    check (min_round_minutes is null or min_round_minutes > 0);

comment on column public.app_settings.max_patrol_speed_kmh is
  'Fastest believable speed between two scans of one shift, in km/h. Catches GPS jumps that no foot or vehicle patrol inside the site could make. Faster movement flags the scan as impossible_travel for review. Null turns the check off.';
comment on column public.app_settings.min_round_minutes is
  'Shortest believable time, in minutes, from the first scan of a shift to the scan that completes all its checkpoints. A faster round flags that scan as fast_round for review. Null (the default) turns the check off; Muscat Bay has not set a minimum round time.';

create or replace function public.submit_scan(
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
returns public.scans
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_uid          uuid := auth.uid();
  v_now          timestamptz := now();
  v_existing     public.scans;
  v_shift        public.shifts;
  v_cp           public.checkpoints;
  v_set          public.app_settings;
  v_offset_min   integer;
  v_flags        text[] := '{}';
  v_reject       boolean := false;
  v_clock_offset integer;
  v_effective    timestamptz;
  v_distance     double precision;
  v_due          timestamptz;
  v_on_time      boolean;
  v_window_start timestamptz;
  v_window_end   timestamptz;
  v_validation   public.scan_validation;
  v_row          public.scans;
  v_near         record;
  v_gap_m        double precision;
  v_gap_sec      double precision;
  v_required     integer;
  v_visited      integer;
  v_round_start  timestamptz;
  v_round_end    timestamptz;
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;

  if not exists (select 1 from public.profiles where id = v_uid and active and role = 'guard') then
    raise exception 'An active guard account is required' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_scan_id::text, 0));

  -- 0. Idempotency: a retried upload returns the row already stored.
  select * into v_existing from public.scans where id = p_scan_id;
  if found then
    if v_existing.guard_id <> v_uid then
      raise exception 'Scan id already used' using errcode = '42501';
    end if;
    return v_existing;
  end if;

  -- Hard errors: these mean the request itself is invalid, so nothing is stored.
  select * into v_shift from public.shifts where id = p_shift_id;
  if not found or v_shift.guard_id <> v_uid then
    raise exception 'This shift is not assigned to you' using errcode = '42501';
  end if;
  -- One scan of a shift at a time, so the pattern checks see every stored scan.
  perform pg_advisory_xact_lock(hashtextextended('shift:' || p_shift_id::text, 0));

  select * into v_cp from public.checkpoints where id = p_checkpoint_id;
  if not found then
    raise exception 'Checkpoint not found' using errcode = 'P0002';
  end if;

  if p_status = 'issue' and coalesce(btrim(p_note), '') = '' then
    raise exception 'A note is required when reporting an issue' using errcode = '22023';
  end if;

  if p_device_time is null or p_device_sent_at is null then
    raise exception 'Device time is missing' using errcode = '22023';
  end if;

  select * into v_set from public.app_settings where id = 1;

  -- Soft checks: the scan is stored as evidence, but may be flagged or rejected.

  -- 1. Does the scanned value belong to this checkpoint?
  if not (
       (p_method in ('qr', 'barcode') and p_raw_value = v_cp.code)
    or (p_method = 'nfc' and (
          (v_cp.nfc_uid is not null and upper(p_raw_value) = upper(v_cp.nfc_uid))
          or p_raw_value = v_cp.code))
  ) then
    v_flags := v_flags || 'code_mismatch'::text;
    v_reject := true;
  end if;

  if not v_cp.active then
    v_flags := v_flags || 'checkpoint_inactive'::text;
    v_reject := true;
  end if;

  -- 2. Is the checkpoint on this shift's route (as it was when the shift was planned)?
  select sc.due_offset_min into v_offset_min
  from public.shift_checkpoints sc
  where sc.shift_id = v_shift.id and sc.checkpoint_id = v_cp.id;
  if not found then
    v_flags := v_flags || 'not_on_route'::text;
    v_reject := true;
  end if;

  -- Upload-time clock offset is diagnostic evidence, not a replacement scan time.
  v_clock_offset := round(extract(epoch from (v_now - p_device_sent_at)))::integer;
  v_effective    := p_device_time; -- Preserve the captured reading; never manufacture a corrected time.
  if abs(v_clock_offset) > v_set.max_clock_drift_sec then
    v_flags := v_flags || 'clock_drift'::text;
  end if;
  if v_effective > v_now + interval '2 minutes' or p_device_time > p_device_sent_at + interval '2 minutes' then
    v_flags := v_flags || 'future_time'::text;
    v_reject := true;
  end if;

  -- 4. Location: within the checkpoint radius (default 30 m)?
  if p_latitude is null or p_longitude is null then
    v_flags := v_flags || 'no_gps'::text;
    v_reject := true;
  elsif p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then
    v_flags := v_flags || 'invalid_coordinates'::text;
    v_reject := true;
  else
    v_distance := public.distance_m(p_latitude, p_longitude, v_cp.latitude, v_cp.longitude);
    if v_distance > v_cp.radius_m then
      v_flags := v_flags || 'too_far'::text;
      v_reject := true;
    end if;
    if p_accuracy_m is null or p_accuracy_m < 0 or p_accuracy_m > v_set.max_gps_accuracy_m then
      v_flags := v_flags || 'low_accuracy'::text;
    end if;
  end if;

  -- 5. Mocked GPS (reported by Android when a "fake location" app is active).
  if coalesce(p_is_mocked, false) then
    v_flags := v_flags || 'mock_location'::text;
    v_reject := true;
  end if;

  -- 6. Was the scan inside the shift window?
  if v_shift.status = 'cancelled' then
    v_flags := v_flags || 'shift_cancelled'::text;
    v_reject := true;
  end if;
  if v_shift.actual_start is null then
    v_flags := v_flags || 'shift_not_started'::text;  -- e.g. guard had no signal at start
  end if;
  v_window_start := greatest(v_shift.scheduled_start, coalesce(v_shift.actual_start, v_shift.scheduled_start));
  v_window_end := least(v_shift.scheduled_end, coalesce(v_shift.actual_end, v_shift.scheduled_end));
  if v_effective < v_window_start or v_effective > v_window_end then
    v_flags := v_flags || 'outside_shift'::text;
    v_reject := true;
  end if;

  -- Every checkpoint is due by the scheduled end of this shift.
  if v_offset_min is not null then
    v_due     := v_shift.scheduled_end;
    v_on_time := v_effective <= v_due;
    if not v_on_time then
      v_flags := v_flags || 'late'::text;
    end if;
  end if;

  -- 7. Pattern checks against this shift's other stored scans (F02).
  --    Flags only: none of these can reject a scan.
  if not v_reject then

    -- 7a. impossible_travel: compare with the nearest stored scans in time on
    --     each side (every scan at that nearest time, so the result never
    --     depends on which of two equal times is picked). Only trustworthy
    --     readings count: rejected scans (e.g. too_far on a poor first GPS fix
    --     before a good retry) and readings flagged as poor or fake are
    --     skipped. Both readings may be up to one checkpoint radius off, so
    --     that much distance (2 x radius) is allowed for free; two scans at the
    --     same moment are impossible only beyond it.
    if v_set.max_patrol_speed_kmh is not null then
      for v_near in
        with trusted as (
          select x.latitude, x.longitude, x.effective_time
            from public.scans x
           where x.shift_id = v_shift.id
             and x.validation <> 'rejected'
             and x.latitude is not null and x.longitude is not null
             and not (x.flags && array['mock_location', 'invalid_coordinates', 'future_time',
                                       'too_far', 'low_accuracy'])
        )
        select t.latitude, t.longitude, t.effective_time
          from trusted t
         where t.effective_time = (select max(b.effective_time) from trusted b
                                    where b.effective_time <= v_effective)
            or t.effective_time = (select min(a.effective_time) from trusted a
                                    where a.effective_time > v_effective)
      loop
        v_gap_m   := public.distance_m(p_latitude, p_longitude, v_near.latitude, v_near.longitude)
                     - 2 * v_cp.radius_m;
        v_gap_sec := abs(extract(epoch from (v_effective - v_near.effective_time)));
        if v_gap_m > 0 and (
             v_gap_sec = 0
             or (v_gap_m / v_gap_sec) * 3.6 > v_set.max_patrol_speed_kmh
           ) then
          v_flags := v_flags || 'impossible_travel'::text;
          exit;
        end if;
      end loop;
    end if;

    -- 7b. repeated_position: identical coordinates (6 decimals, about 0.1 m)
    --     at a different checkpoint of this shift. Checkpoints that share a
    --     spot (one inside the other's allowed area) are skipped: a guard can
    --     scan both without moving and the phone may return the same reading.
    if exists (
      select 1
        from public.scans x
        join public.checkpoints oc on oc.id = x.checkpoint_id
       where x.shift_id = v_shift.id
         and x.checkpoint_id <> v_cp.id
         and round(x.latitude::numeric, 6)  = round(p_latitude::numeric, 6)
         and round(x.longitude::numeric, 6) = round(p_longitude::numeric, 6)
         and public.distance_m(oc.latitude, oc.longitude, v_cp.latitude, v_cp.longitude)
             > least(oc.radius_m, v_cp.radius_m)
    ) then
      v_flags := v_flags || 'repeated_position'::text;
    end if;

    -- 7c. fast_round: this scan visits the last required checkpoint (valid or
    --     awaiting review) and the round, from the first visit to the last
    --     first-visit, took less than the minimum. Needs at least two
    --     checkpoints: a one-checkpoint round always takes no time.
    if v_set.min_round_minutes is not null and v_offset_min is not null
       and not exists (
         select 1 from public.scans x
          where x.shift_id = v_shift.id and x.checkpoint_id = v_cp.id
            and x.validation in ('valid', 'flagged'))
    then
      select count(*) into v_required
        from public.shift_checkpoints sc where sc.shift_id = v_shift.id;

      select count(*), min(f.first_visit), max(f.first_visit)
        into v_visited, v_round_start, v_round_end
        from (
          select v.checkpoint_id, min(v.effective_time) as first_visit
            from (
              select x.checkpoint_id, x.effective_time
                from public.scans x
               where x.shift_id = v_shift.id and x.validation in ('valid', 'flagged')
              union all
              select v_cp.id, v_effective
            ) v
           where v.checkpoint_id in (select sc.checkpoint_id from public.shift_checkpoints sc
                                      where sc.shift_id = v_shift.id)
           group by v.checkpoint_id
        ) f;

      if v_required >= 2 and v_visited = v_required
         and v_round_end - v_round_start < make_interval(mins => v_set.min_round_minutes) then
        v_flags := v_flags || 'fast_round'::text;
      end if;
    end if;
  end if;

  -- Final verdict. "late" alone does not flag a scan; it lowers punctuality.
  v_validation := case
    when v_reject then 'rejected'
    when cardinality(array_remove(v_flags, 'late')) > 0 then 'flagged'
    else 'valid'
  end::public.scan_validation;

  insert into public.scans (
    id, shift_id, guard_id, checkpoint_id, method, raw_value, status, note,
    device_time, device_sent_at, server_time, clock_offset_sec, effective_time,
    latitude, longitude, accuracy_m, is_mocked, distance_m,
    due_at, is_on_time, validation, flags, expected_attachments
  ) values (
    p_scan_id, p_shift_id, v_uid, p_checkpoint_id, p_method, p_raw_value, p_status, nullif(btrim(p_note), ''),
    p_device_time, p_device_sent_at, v_now, v_clock_offset, v_effective,
    p_latitude, p_longitude, p_accuracy_m, coalesce(p_is_mocked, false), round(v_distance::numeric, 1),
    v_due, v_on_time, v_validation, v_flags, greatest(0, least(coalesce(p_expected_attachments, 0), 20))
  )
  returning * into v_row;

  -- "Issue found" -> open an incident for the supervisors.
  if p_status = 'issue' then
    insert into public.incidents (scan_id, shift_id, guard_id, checkpoint_id, description)
    values (v_row.id, v_row.shift_id, v_uid, v_row.checkpoint_id, btrim(p_note));
  end if;

  if v_validation = 'rejected' then
    -- Tell the supervisors a scan did not count, and why.
    insert into public.alarms (type, guard_id, shift_id, checkpoint_id, scan_id, message, latitude, longitude, accuracy_m)
    values ('scan_rejected', v_uid, v_row.shift_id, v_row.checkpoint_id, v_row.id,
            format('Scan at %s rejected: %s', v_cp.name, array_to_string(v_flags, ', ')),
            p_latitude, p_longitude, p_accuracy_m);
  elsif v_validation = 'valid' then
    -- A verified scan closes any open "missed" alarm for that checkpoint.
    update public.alarms
       set status = 'resolved', resolved_at = v_now,
           resolution_note = 'Verified checkpoint visit at ' ||
             to_char(v_effective at time zone v_set.timezone, 'HH24:MI')
     where type = 'missed_checkpoint' and shift_id = v_row.shift_id
       and checkpoint_id = v_row.checkpoint_id and status <> 'resolved';
  end if;

  return v_row;
end;
$$;

-- Privileges: signed-in users may call submit_scan; anonymous users may not.
revoke all on function public.submit_scan(uuid, uuid, uuid, public.scan_method, text, public.scan_status, text,
  timestamptz, timestamptz, double precision, double precision, double precision, boolean, integer) from public, anon;
grant execute on function public.submit_scan(uuid, uuid, uuid, public.scan_method, text, public.scan_status, text,
  timestamptz, timestamptz, double precision, double precision, double precision, boolean, integer) to authenticated;
