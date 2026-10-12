-- =============================================================================
-- Muscat Bay Patrol System — 03: Patrol functions (server-side validation)
-- =============================================================================
-- First principles
-- ----------------
-- Never trust the phone. A phone can lie about where it is (mock GPS apps)
-- and what time it is (changed clock). So the phone only sends raw evidence,
-- and THIS code, running on the server, decides whether a scan counts.
--
-- Time check, explained
-- ---------------------
-- A scan may sit in the offline queue for hours before upload, so
-- "server time minus scan time" would wrongly flag every offline scan.
-- Instead the phone sends two readings of its own clock:
--   device_time    = when the tag was scanned
--   device_sent_at = when the upload left the phone
-- clock_offset = server_now - device_sent_at   (the phone clock error)
-- effective_time = device_time + clock_offset (the true scan time)
-- A large clock_offset means the phone clock is wrong -> "clock_drift" flag.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Great-circle distance in metres between two GPS points (haversine formula).
-- Accurate to well under 1 m at patrol distances; no PostGIS needed.
-- ---------------------------------------------------------------------------
create or replace function public.distance_m(
  lat1 double precision, lon1 double precision,
  lat2 double precision, lon2 double precision
)
returns double precision
language sql immutable parallel safe set search_path = ''
as $$
  select 2 * 6371008.8 * asin(sqrt(
      power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lon2 - lon1) / 2), 2)
  ));
$$;

-- ---------------------------------------------------------------------------
-- submit_scan: the ONLY way a scan enters the database.
-- Returns the stored row (including validation result and flags).
-- Calling it twice with the same p_scan_id returns the first row unchanged.
-- ---------------------------------------------------------------------------
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

  -- 3. Clock: correct the scan time using the phone's clock error.
  v_clock_offset := round(extract(epoch from (v_now - p_device_sent_at)))::integer;
  v_effective    := p_device_time + make_interval(secs => v_clock_offset);
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
  else
    v_distance := public.distance_m(p_latitude, p_longitude, v_cp.latitude, v_cp.longitude);
    if v_distance > v_cp.radius_m then
      v_flags := v_flags || 'too_far'::text;
      v_reject := true;
    end if;
    if p_accuracy_m is null or p_accuracy_m > v_set.max_gps_accuracy_m then
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
  v_window_start := least(coalesce(v_shift.actual_start, v_shift.scheduled_start),
                          v_shift.scheduled_start) - make_interval(mins => v_set.shift_early_start_minutes);
  v_window_end   := coalesce(v_shift.actual_end,
                             v_shift.scheduled_end + make_interval(mins => v_set.grace_minutes));
  if v_effective < v_window_start or v_effective > v_window_end then
    v_flags := v_flags || 'outside_shift'::text;
    v_reject := true;
  end if;

  -- 7. Punctuality: scanned before (due time + grace)?
  if v_offset_min is not null then
    v_due     := v_shift.scheduled_start + make_interval(mins => v_offset_min);
    v_on_time := v_effective <= v_due + make_interval(mins => v_set.grace_minutes);
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
  else
    -- A late but genuine scan closes any open "missed" alarm for that checkpoint.
    update public.alarms
       set status = 'resolved', resolved_at = v_now,
           resolution_note = 'Checkpoint scanned late at ' ||
             to_char(v_effective at time zone v_set.timezone, 'HH24:MI')
     where type = 'missed_checkpoint' and shift_id = v_row.shift_id
       and checkpoint_id = v_row.checkpoint_id and status <> 'resolved';
  end if;

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- start_shift / end_shift: guards cannot edit shifts directly, only via these.
-- ---------------------------------------------------------------------------
create or replace function public.start_shift(p_shift_id uuid)
returns public.shifts
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_shift public.shifts;
  v_set   public.app_settings;
begin
  select * into v_set from public.app_settings where id = 1;
  select * into v_shift from public.shifts where id = p_shift_id for update;

  if not found or v_shift.guard_id is distinct from v_uid then
    raise exception 'This shift is not assigned to you' using errcode = '42501';
  end if;
  if v_shift.status = 'active' then
    return v_shift;  -- already started (e.g. retried request)
  end if;
  if v_shift.status <> 'scheduled' then
    raise exception 'This shift is % and cannot be started', v_shift.status using errcode = '22023';
  end if;
  if now() < v_shift.scheduled_start - make_interval(mins => v_set.shift_early_start_minutes) then
    raise exception 'Too early: this shift starts at %',
      to_char(v_shift.scheduled_start at time zone v_set.timezone, 'DD Mon HH24:MI') using errcode = '22023';
  end if;
  if now() > v_shift.scheduled_end then
    raise exception 'This shift has already ended' using errcode = '22023';
  end if;
  if exists (select 1 from public.shifts where guard_id = v_uid and status = 'active' and id <> p_shift_id) then
    raise exception 'End your current shift before starting another' using errcode = '22023';
  end if;

  update public.shifts
     set status = 'active', actual_start = now()
   where id = p_shift_id
  returning * into v_shift;

  -- If a "not started" alarm was raised because the guard was late, close it.
  update public.alarms
     set status = 'resolved', resolved_at = now(), resolution_note = 'Guard started the shift late'
   where shift_id = p_shift_id and type = 'shift_not_started' and status <> 'resolved';

  return v_shift;
end;
$$;

create or replace function public.end_shift(p_shift_id uuid)
returns public.shifts
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_shift public.shifts;
begin
  select * into v_shift from public.shifts where id = p_shift_id for update;
  if not found or v_shift.guard_id is distinct from v_uid then
    raise exception 'This shift is not assigned to you' using errcode = '42501';
  end if;
  if v_shift.status = 'completed' then
    return v_shift;
  end if;
  if v_shift.status <> 'active' then
    raise exception 'Only an active shift can be ended' using errcode = '22023';
  end if;

  update public.shifts
     set status = 'completed', actual_end = now()
   where id = p_shift_id
  returning * into v_shift;
  return v_shift;
end;
$$;

-- ---------------------------------------------------------------------------
-- trigger_sos: raises an SOS alarm with the guard's position.
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

  select full_name into v_name from public.profiles where id = v_uid;

  insert into public.alarms (type, guard_id, shift_id, message, latitude, longitude, accuracy_m)
  values ('sos', v_uid, p_shift_id,
          coalesce(nullif(btrim(p_message), ''), 'SOS raised by ' || coalesce(v_name, 'guard')),
          p_latitude, p_longitude, p_accuracy_m)
  returning * into v_row;
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Attachments: server fills guard_id and decides whether a gallery photo is
-- suspicious (taken before the shift started, or with no date at all).
-- ---------------------------------------------------------------------------
create or replace function public.prepare_scan_attachment()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_shift_start timestamptz;
begin
  select coalesce(sh.actual_start, sh.scheduled_start), s.guard_id
    into v_shift_start, new.guard_id
  from public.scans s
  join public.shifts sh on sh.id = s.shift_id
  where s.id = new.scan_id;

  new.flagged_pre_shift := new.type = 'photo' and new.source = 'gallery'
    and (new.exif_taken_at is null or new.exif_taken_at < v_shift_start);
  return new;
end;
$$;

-- Runs AFTER the RLS check has confirmed the scan belongs to the caller.
create trigger scan_attachments_prepare
  before insert on public.scan_attachments
  for each row execute function public.prepare_scan_attachment();

-- ---------------------------------------------------------------------------
-- Keep shift_checkpoints (the per-shift copy of the route) up to date.
--   * New shift                    -> copy its route's checkpoints.
--   * Shift moved to another route -> re-copy, but only if not started yet.
--   * Route edited                 -> re-copy for that route's NOT-YET-STARTED
--                                     shifts. Started and past shifts keep the
--                                     checkpoints they were patrolled against.
-- ---------------------------------------------------------------------------
create or replace function public.snapshot_shift_checkpoints(p_shift_id uuid)
returns void
language sql volatile security definer set search_path = ''
as $$
  delete from public.shift_checkpoints where shift_id = p_shift_id;
  insert into public.shift_checkpoints (shift_id, checkpoint_id, sequence, due_offset_min)
  select s.id, rc.checkpoint_id, rc.sequence, rc.due_offset_min
  from public.shifts s
  join public.route_checkpoints rc on rc.route_id = s.route_id
  join public.checkpoints c on c.id = rc.checkpoint_id and c.active  -- retired checkpoints are not due
  where s.id = p_shift_id;
$$;
revoke all on function public.snapshot_shift_checkpoints(uuid) from public, anon, authenticated;

create or replace function public.on_shift_written()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or (new.route_id is distinct from old.route_id and new.status = 'scheduled') then
    perform public.snapshot_shift_checkpoints(new.id);
  end if;
  return null;
end;
$$;

create trigger shifts_snapshot_checkpoints
  after insert or update of route_id on public.shifts
  for each row execute function public.on_shift_written();

create or replace function public.on_route_checkpoints_changed()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_routes uuid[];
  v_shift  uuid;
begin
  v_routes := case tg_op
    when 'INSERT' then array[new.route_id]
    when 'DELETE' then array[old.route_id]
    else array[new.route_id, old.route_id]
  end;
  for v_shift in
    select id from public.shifts where status = 'scheduled' and route_id = any (v_routes)
  loop
    perform public.snapshot_shift_checkpoints(v_shift);
  end loop;
  return null;
end;
$$;

create trigger route_checkpoints_refresh_shifts
  after insert or update or delete on public.route_checkpoints
  for each row execute function public.on_route_checkpoints_changed();

-- Retiring (or re-activating) a checkpoint refreshes not-yet-started shifts.
create or replace function public.on_checkpoint_active_changed()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_shift uuid;
begin
  for v_shift in
    select distinct s.id
    from public.shifts s
    join public.route_checkpoints rc on rc.route_id = s.route_id
    where s.status = 'scheduled' and rc.checkpoint_id = new.id
  loop
    perform public.snapshot_shift_checkpoints(v_shift);
  end loop;
  return null;
end;
$$;

create trigger checkpoints_active_refresh_shifts
  after update of active on public.checkpoints
  for each row when (old.active is distinct from new.active)
  execute function public.on_checkpoint_active_changed();

-- A guard can be on only one active shift at a time. The check in
-- start_shift() alone could be beaten by two simultaneous requests.
create unique index shifts_one_active_per_guard on public.shifts (guard_id) where status = 'active';

-- ---------------------------------------------------------------------------
-- shift_checkpoint_status: one row per (shift, route checkpoint) with its
-- completion. security_invoker = true makes the view obey the caller's RLS,
-- so a guard only sees rows for their own shifts.
-- ---------------------------------------------------------------------------
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
  s.scheduled_start + make_interval(mins => rc.due_offset_min) as due_at,
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
  (sc.id is not null)                                        as completed
from public.shifts s
join public.shift_checkpoints rc on rc.shift_id = s.id
join public.checkpoints c        on c.id = rc.checkpoint_id
left join lateral (
  select x.id, x.effective_time, x.status, x.validation, x.is_on_time
  from public.scans x
  where x.shift_id = s.id and x.checkpoint_id = rc.checkpoint_id and x.validation <> 'rejected'
  order by x.effective_time
  limit 1
) sc on true;

-- ---------------------------------------------------------------------------
-- patrol_stats: completion and punctuality for one guard over a period.
--   completion  = checkpoints visited / checkpoints that were due
--   punctuality = visits on time / checkpoints visited
-- Only checkpoints whose due time (+ grace) has passed are counted, so a shift
-- in progress is not penalised for checkpoints that are not yet due.
-- ---------------------------------------------------------------------------
create or replace function public.patrol_stats(
  p_guard_id uuid,
  p_from     timestamptz,
  p_to       timestamptz
)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_set    public.app_settings;
  v_result jsonb;
begin
  if p_guard_id is distinct from auth.uid() and not public.is_staff() then
    raise exception 'You can only view your own statistics' using errcode = '42501';
  end if;
  select * into v_set from public.app_settings where id = 1;

  with due as (
    select scs.*
    from public.shift_checkpoint_status scs
    where scs.guard_id = p_guard_id
      and scs.due_at >= p_from and scs.due_at < p_to
      and scs.shift_status <> 'cancelled'
      and (scs.completed or scs.due_at + make_interval(mins => v_set.grace_minutes) < now())
  ),
  totals as (
    select count(*)                                   as expected,
           count(*) filter (where completed)          as completed,
           count(*) filter (where completed and is_on_time) as on_time
    from due
  ),
  daily as (
    select (due_at at time zone v_set.timezone)::date as day,
           count(*)                          as expected,
           count(*) filter (where completed) as completed,
           count(*) filter (where completed and is_on_time) as on_time
    from due
    group by 1
    order by 1
  )
  select jsonb_build_object(
    'expected',          t.expected,
    'completed',         t.completed,
    'on_time',           t.on_time,
    'completion_rate',   case when t.expected  = 0 then null else round(t.completed::numeric / t.expected  * 100, 1) end,
    'punctuality_rate',  case when t.completed = 0 then null else round(t.on_time::numeric  / t.completed * 100, 1) end,
    'shifts',            (select count(*) from public.shifts
                           where guard_id = p_guard_id and scheduled_start >= p_from and scheduled_start < p_to
                             and status <> 'cancelled'),
    'shifts_missed',     (select count(*) from public.shifts
                           where guard_id = p_guard_id and scheduled_start >= p_from and scheduled_start < p_to
                             and status = 'missed'),
    'incidents',         (select count(*) from public.incidents
                           where guard_id = p_guard_id and created_at >= p_from and created_at < p_to),
    'sos',               (select count(*) from public.alarms
                           where guard_id = p_guard_id and type = 'sos' and created_at >= p_from and created_at < p_to),
    'rejected_scans',    (select count(*) from public.scans
                           where guard_id = p_guard_id and validation = 'rejected'
                             and effective_time >= p_from and effective_time < p_to),
    'daily',             coalesce((select jsonb_agg(jsonb_build_object(
                             'day', d.day, 'expected', d.expected, 'completed', d.completed, 'on_time', d.on_time))
                           from daily d), '[]'::jsonb)
  )
  into v_result
  from totals t;

  return v_result;
end;
$$;

-- Privileges: signed-in users may call these; anonymous users may not.
revoke all on function public.submit_scan(uuid, uuid, uuid, public.scan_method, text, public.scan_status, text,
  timestamptz, timestamptz, double precision, double precision, double precision, boolean, integer) from public, anon;
revoke all on function public.start_shift(uuid), public.end_shift(uuid),
  public.trigger_sos(uuid, double precision, double precision, double precision, text),
  public.patrol_stats(uuid, timestamptz, timestamptz) from public, anon;

grant execute on function public.submit_scan(uuid, uuid, uuid, public.scan_method, text, public.scan_status, text,
  timestamptz, timestamptz, double precision, double precision, double precision, boolean, integer) to authenticated;
grant execute on function public.start_shift(uuid), public.end_shift(uuid),
  public.trigger_sos(uuid, double precision, double precision, double precision, text),
  public.patrol_stats(uuid, timestamptz, timestamptz), public.distance_m(double precision, double precision,
  double precision, double precision) to authenticated;
grant select on public.shift_checkpoint_status to authenticated;
