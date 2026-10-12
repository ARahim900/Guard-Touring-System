-- Each required location counts once per night shift. All timestamps remain evidence.
alter table public.app_settings
  add column night_shift_start time,
  add column night_shift_end time,
  add constraint night_shift_hours_complete check (
    (night_shift_start is null and night_shift_end is null) or
    (night_shift_start is not null and night_shift_end is not null and night_shift_start <> night_shift_end)
  );
alter table public.shifts add column auto_closed_at timestamptz;

create or replace function public.set_night_shift_hours(p_start time, p_end time)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_staff() then
    raise exception 'Only supervisors can change shift hours' using errcode = '42501';
  end if;
  if p_start is null or p_end is null or p_start = p_end then
    raise exception 'Choose different start and end times' using errcode = '22023';
  end if;
  update public.app_settings set night_shift_start = p_start, night_shift_end = p_end where id = 1;
end;
$$;
revoke all on function public.set_night_shift_hours(time, time) from public, anon;
grant execute on function public.set_night_shift_hours(time, time) to authenticated;

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

create or replace view public.shift_checkpoint_status
with (security_invoker = true)
as
select
  s.id                                                       as shift_id,
  s.guard_id,
  s.route_id,
  s.status                                                   as shift_status,
  rc.checkpoint_id,
  rc.sequence,
  rc.due_offset_min,
  s.scheduled_end                                            as due_at,
  c.name                                                     as checkpoint_name,
  c.code,
  c.nfc_uid,
  c.latitude,
  c.longitude,
  c.radius_m,
  sc.id                                                      as scan_id,
  sc.effective_time                                          as scanned_at,
  sc.status                                                  as scan_status,
  sc.validation,
  sc.is_on_time,
  (sc.validation = 'valid') is true                          as completed
from public.shifts s
join public.shift_checkpoints rc on rc.shift_id = s.id
join public.checkpoints c        on c.id = rc.checkpoint_id
left join lateral (
  select x.id, x.effective_time, x.status, x.validation, x.is_on_time
  from public.scans x
  where x.shift_id = s.id and x.checkpoint_id = rc.checkpoint_id and true
  order by case when x.validation = 'valid' then 0 when x.validation = 'flagged' then 1 else 2 end, x.effective_time, x.id
  limit 1
) sc on true;

create or replace function public.run_patrol_monitor()
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_set           public.app_settings;
  v_grace         interval;
  v_not_started   integer;
  v_missed        integer;
  v_shifts_missed integer;
  v_auto_closed   integer;
  v_pings_deleted integer;
begin
  select * into v_set from public.app_settings where id = 1;
  v_grace := make_interval(mins => v_set.grace_minutes);

  -- a) Guard has not started the shift.
  insert into public.alarms (type, guard_id, shift_id, message)
  select 'shift_not_started', s.guard_id, s.id,
         format('%s has not started the %s shift', p.full_name,
                to_char(s.scheduled_start at time zone v_set.timezone, 'DD Mon HH24:MI'))
  from public.shifts s
  join public.profiles p on p.id = s.guard_id
  where s.status = 'scheduled'
    and s.scheduled_start + v_grace < now()
    and s.scheduled_end > now() - interval '1 day'
  on conflict (shift_id) where type = 'shift_not_started' do nothing;
  get diagnostics v_not_started = row_count;

  -- b) Checkpoint not visited in time.
  insert into public.alarms (type, guard_id, shift_id, checkpoint_id, message)
  select 'missed_checkpoint', scs.guard_id, scs.shift_id, scs.checkpoint_id,
         format('Missed %s (due %s)', scs.checkpoint_name,
                to_char(scs.due_at at time zone v_set.timezone, 'DD Mon HH24:MI'))
  from public.shift_checkpoint_status scs
  where scs.shift_status <> 'cancelled'
    and not scs.completed
    and scs.due_at < now()
    and scs.due_at > now() - interval '2 days'
  on conflict (shift_id, checkpoint_id) where type = 'missed_checkpoint' do update
    set status = 'open', resolved_at = null, resolution_note = null
    where alarms.status = 'resolved';
  get diagnostics v_missed = row_count;

  update public.alarms a set status = 'resolved', resolved_at = now(),
    resolution_note = 'Checkpoint visit verified'
  where a.type = 'missed_checkpoint' and a.status <> 'resolved'
    and exists (select 1 from public.shift_checkpoint_status c where c.shift_id = a.shift_id
      and c.checkpoint_id = a.checkpoint_id and c.completed);

  -- c) Never started and now over.
  update public.shifts
     set status = 'missed'
   where status = 'scheduled' and scheduled_end + v_grace < now();
  get diagnostics v_shifts_missed = row_count;

  -- d) Close expired shifts without inventing an observed end time.
  update public.shifts
     set status = 'completed',
         auto_closed_at = now(),
         actual_end = null,
         notes = concat_ws(' ', notes, '[Auto-closed: guard did not end the shift]')
   where status = 'active' and scheduled_end < now();
  get diagnostics v_auto_closed = row_count;

  -- e) Privacy: drop old GPS trail.
  delete from public.location_pings
   where recorded_at < now() - make_interval(days => v_set.location_retention_days);
  get diagnostics v_pings_deleted = row_count;

  return jsonb_build_object(
    'shift_not_started_alarms', v_not_started,
    'missed_checkpoint_alarms', v_missed,
    'shifts_marked_missed',     v_shifts_missed,
    'shifts_auto_closed',       v_auto_closed,
    'location_pings_deleted',   v_pings_deleted
  );
end;
$$;
revoke all on function public.run_patrol_monitor() from public, anon, authenticated;


-- Retain the original verdict and every review without permitting raw evidence edits.
alter table public.scans
  add column initial_validation public.scan_validation,
  add column review_history jsonb not null default '[]'::jsonb;

create or replace function public.record_scan_review()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.initial_validation := new.validation;
    return new;
  end if;
  if not public.is_staff() then
    raise exception 'Only supervisors can review scans' using errcode = '42501';
  end if;
  if nullif(btrim(new.review_note), '') is null then
    raise exception 'A review reason is required' using errcode = '22023';
  end if;
  if (to_jsonb(new) - array['validation','review_note']) is distinct from
     (to_jsonb(old) - array['validation','review_note']) then
    raise exception 'Original scan evidence cannot be edited' using errcode = '42501';
  end if;
  if new.validation = 'valid' and not exists (
    select 1 from public.shifts s where s.id = new.shift_id and s.status <> 'cancelled'
      and new.effective_time >= s.scheduled_start and new.effective_time <= s.scheduled_end
  ) then
    raise exception 'A visit outside its scheduled shift cannot count' using errcode = '22023';
  end if;
  new.reviewed_by := auth.uid();
  new.reviewed_at := now();
  new.review_note := btrim(new.review_note);
  new.review_history := old.review_history || jsonb_build_array(jsonb_build_object(
    'previous_verdict', old.validation, 'verdict', new.validation, 'reason', new.review_note,
    'reviewed_by', new.reviewed_by, 'reviewed_at', new.reviewed_at
  ));
  return new;
end;
$$;
create trigger scans_record_review before insert or update on public.scans
for each row execute function public.record_scan_review();
revoke all on function public.record_scan_review() from public, anon, authenticated;
revoke update on public.scans from authenticated;
grant update (validation, review_note) on public.scans to authenticated;

-- One scalar JSON result avoids the API row limit truncating a long date range.
-- Selection uses the shift's start date in Muscat; after-midnight visits stay with that shift.
create or replace function public.patrol_report(p_from date, p_to date, p_contractor_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_result jsonb;
begin
  if not public.is_staff() then
    raise exception 'Only supervisors can generate reports' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to or not isfinite(p_from) or not isfinite(p_to) then
    raise exception 'Choose a valid start and end date' using errcode = '22023';
  end if;
  select jsonb_build_object(
    'from_date', p_from, 'to_date', p_to, 'generated_at', now(),
    'contractor_name', (select name from public.contractors where id = p_contractor_id),
    'shifts', coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'patrol_date', (s.scheduled_start at time zone 'Asia/Muscat')::date,
      'guard_name', s.on_duty_name, 'guard_ref', s.on_duty_ref, 'login_name', p.full_name,
      'route_name', r.name, 'status', s.status, 'scheduled_start', s.scheduled_start,
      'scheduled_end', s.scheduled_end, 'actual_start', s.actual_start,
      'actual_end', s.actual_end, 'auto_closed_at', s.auto_closed_at,
      'checkpoints', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', cp.id, 'name', cp.name, 'sequence', sc.sequence,
          'scans', (
            select coalesce(jsonb_agg(jsonb_build_object(
              'id', x.id, 'device_time', x.device_time, 'server_time', x.server_time,
              'effective_time', x.effective_time, 'validation', x.validation,
              'latitude', x.latitude, 'longitude', x.longitude, 'accuracy_m', x.accuracy_m,
              'distance_m', x.distance_m, 'status', x.status, 'note', x.note,
              'flags', x.flags, 'review_note', x.review_note, 'expected_attachments', x.expected_attachments,
              'attachment_count', (select count(*) from public.scan_attachments a where a.scan_id = x.id)
            ) order by x.effective_time, x.id), '[]'::jsonb)
            from public.scans x where x.shift_id = s.id and x.checkpoint_id = cp.id
          )
        ) order by sc.sequence, cp.id), '[]'::jsonb)
        from public.shift_checkpoints sc join public.checkpoints cp on cp.id = sc.checkpoint_id
        where sc.shift_id = s.id
      )
    ) order by s.scheduled_start, s.id), '[]'::jsonb)
  ) into v_result
  from public.shifts s
  join public.profiles p on p.id = s.guard_id
  join public.routes r on r.id = s.route_id
  where s.scheduled_start >= p_from::timestamp at time zone 'Asia/Muscat'
    and s.scheduled_start < (p_to + 1)::timestamp at time zone 'Asia/Muscat'
    and (p_contractor_id is null or p.contractor_id = p_contractor_id);
  return v_result;
end;
$$;
revoke all on function public.patrol_report(date, date, uuid) from public, anon;
grant execute on function public.patrol_report(date, date, uuid) to authenticated;

comment on column public.scans.effective_time is 'Captured phone time for new scans; legacy records may contain the earlier clock-adjusted time. device_time always retains the original reading.';
