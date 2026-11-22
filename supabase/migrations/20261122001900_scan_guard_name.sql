-- =============================================================================
-- Who scanned: the guard's name is saved with every scan.
-- =============================================================================
-- One security login is shared by the guards, and a patrol runs up to 12 hours
-- under the name chosen when it started. The phone now asks "Who is scanning?"
-- before the first scan each time the app opens, and sends that name with each
-- scan. Scan rows are locked once saved, so the name goes into its own table,
-- written in the same transaction as the scan. Earlier scans have no row here:
-- their scanner was never recorded and is not guessed.
-- =============================================================================

create table public.scan_guard_names (
  scan_id    uuid primary key references public.scans(id) on delete cascade,
  guard_name text not null check (btrim(guard_name) <> ''),
  created_at timestamptz not null default now()
);
alter table public.scan_guard_names enable row level security;
revoke all on public.scan_guard_names from anon, authenticated;
grant select on public.scan_guard_names to authenticated;
create policy "scan names: own or staff read" on public.scan_guard_names
  for select to authenticated using (
    public.is_staff() or exists (select 1 from public.scans x where x.id = scan_id and x.guard_id = auth.uid())
  );

-- submit_scan plus the name of the guard holding the phone. A retried upload
-- keeps the name first stored for that scan.
create function public.submit_scan_as(
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
  v_row public.scans;
begin
  if v_name is null or not exists(select 1 from public.app_settings where id = 1 and v_name = any(guard_names)) then
    raise exception 'Choose your name from the guard list' using errcode = '22023';
  end if;
  v_row := public.submit_scan(p_scan_id, p_shift_id, p_checkpoint_id, p_method, p_raw_value, p_status, p_note,
    p_device_time, p_device_sent_at, p_latitude, p_longitude, p_accuracy_m, p_is_mocked, p_expected_attachments);
  insert into public.scan_guard_names(scan_id, guard_name) values (v_row.id, v_name)
    on conflict (scan_id) do nothing;
  return v_row;
end;
$$;
revoke all on function public.submit_scan_as(text, uuid, uuid, uuid, public.scan_method, text, public.scan_status, text,
  timestamptz, timestamptz, double precision, double precision, double precision, boolean, integer) from public, anon;
grant execute on function public.submit_scan_as(text, uuid, uuid, uuid, public.scan_method, text, public.scan_status, text,
  timestamptz, timestamptz, double precision, double precision, double precision, boolean, integer) to authenticated;

-- Reports: each visit carries "scanned_by" (null for scans made before this change).
create or replace function public.patrol_report(p_from date, p_to date, p_contractor_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_result jsonb;
  v_staff boolean := public.is_staff();
begin
  if not v_staff and public.my_role() is distinct from 'guard'::public.user_role then
    raise exception 'Sign in to view reports' using errcode = '42501';
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
              'scanned_by', (select g.guard_name from public.scan_guard_names g where g.scan_id = x.id),
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
    and (p_contractor_id is null or p.contractor_id = p_contractor_id)
    and (v_staff or s.guard_id = auth.uid());
  return v_result;
end;
$$;
revoke all on function public.patrol_report(date, date, uuid) from public, anon;
grant execute on function public.patrol_report(date, date, uuid) to authenticated;
