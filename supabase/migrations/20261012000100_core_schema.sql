-- =============================================================================
-- Muscat Bay Patrol System — 01: Core schema
-- =============================================================================
-- First principles
-- ----------------
-- * Every table lives in the "public" schema so the Supabase Data API can
--   reach it. Nothing is readable until a Row Level Security (RLS) policy
--   allows it (see migration 02).
-- * Primary keys are UUIDs. The phone generates the UUID for a scan BEFORE it
--   is uploaded. If the upload is retried (bad signal), the server sees the
--   same id and does not create a duplicate. This is called "idempotency".
-- * Times are stored as timestamptz (an absolute instant, stored in UTC).
--   The apps display them in Asia/Muscat time.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Enumerated types: a fixed list of allowed values, enforced by the database.
-- ---------------------------------------------------------------------------
create type public.user_role         as enum ('guard', 'supervisor', 'admin');
create type public.shift_status      as enum ('scheduled', 'active', 'completed', 'missed', 'cancelled');
create type public.scan_method       as enum ('qr', 'barcode', 'nfc');
create type public.scan_status       as enum ('normal', 'issue');
-- valid    = counts towards completion
-- flagged  = counts, but something looks odd (e.g. clock drift, poor GPS)
-- rejected = does NOT count (too far, mocked GPS, wrong tag, outside shift)
create type public.scan_validation   as enum ('valid', 'flagged', 'rejected');
create type public.attachment_type   as enum ('photo', 'audio');
create type public.attachment_source as enum ('camera', 'gallery', 'microphone');
create type public.alarm_type        as enum ('missed_checkpoint', 'shift_not_started', 'sos', 'scan_rejected');
create type public.alarm_status      as enum ('open', 'acknowledged', 'resolved');
create type public.incident_status   as enum ('open', 'in_progress', 'resolved');
create type public.incident_severity as enum ('low', 'medium', 'high', 'critical');

-- ---------------------------------------------------------------------------
-- Shared trigger: keep updated_at current on every UPDATE.
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- app_settings: one row of tunable rules. Edit in the Supabase SQL editor.
-- ---------------------------------------------------------------------------
create table public.app_settings (
  id                        smallint primary key default 1 check (id = 1),
  max_clock_drift_sec       integer  not null default 300,  -- 5 min phone-vs-server clock difference
  max_gps_accuracy_m        numeric  not null default 50,   -- poorer accuracy is flagged
  grace_minutes             integer  not null default 15,   -- lateness allowed before "late"/"missed"
  shift_early_start_minutes integer  not null default 30,   -- how early a guard may start a shift
  location_retention_days   integer  not null default 90,   -- privacy: GPS trail is deleted after this
  timezone                  text     not null default 'Asia/Muscat',
  updated_at                timestamptz not null default now()
);
insert into public.app_settings default values;

create trigger app_settings_updated_at before update on public.app_settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- contractors: the security companies whose guards patrol Muscat Bay.
-- ---------------------------------------------------------------------------
create table public.contractors (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  contract_ref  text,
  contact_name  text,
  contact_phone text,
  contact_email text,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger contractors_updated_at before update on public.contractors
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- profiles: one row per login (auth.users). Holds the role and contractor.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  full_name     text not null,
  email         text,
  employee_no   text unique,
  phone         text,
  role          public.user_role not null default 'guard',
  contractor_id uuid references public.contractors (id) on delete set null,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index profiles_contractor_idx on public.profiles (contractor_id);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- checkpoints: physical points a guard must visit. Each has a printed
-- QR/barcode label (code) and optionally an NFC tag (nfc_uid).
-- ---------------------------------------------------------------------------
create table public.checkpoints (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  code        text not null unique check (length(code) between 3 and 128),
  nfc_uid     text unique,  -- tag serial number, upper-case hex, no colons
  description text,
  latitude    double precision not null check (latitude between -90 and 90),
  longitude   double precision not null check (longitude between -180 and 180),
  radius_m    numeric not null default 30 check (radius_m > 0 and radius_m <= 200),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger checkpoints_updated_at before update on public.checkpoints
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- routes + route_checkpoints: an ordered list of checkpoints with a target
-- time for each, expressed as minutes after the shift starts.
-- ---------------------------------------------------------------------------
create table public.routes (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  description   text,
  contractor_id uuid references public.contractors (id) on delete set null,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger routes_updated_at before update on public.routes
  for each row execute function public.set_updated_at();

create table public.route_checkpoints (
  route_id       uuid not null references public.routes (id) on delete cascade,
  checkpoint_id  uuid not null references public.checkpoints (id) on delete restrict,
  sequence       integer not null check (sequence > 0),
  due_offset_min integer not null default 0 check (due_offset_min >= 0),
  primary key (route_id, checkpoint_id)
);
create index route_checkpoints_checkpoint_idx on public.route_checkpoints (checkpoint_id);

-- ---------------------------------------------------------------------------
-- shifts: one guard, one route, one time window.
-- ---------------------------------------------------------------------------
create table public.shifts (
  id              uuid primary key default gen_random_uuid(),
  guard_id        uuid not null references public.profiles (id) on delete restrict,
  route_id        uuid not null references public.routes (id) on delete restrict,
  scheduled_start timestamptz not null,
  scheduled_end   timestamptz not null,
  actual_start    timestamptz,
  actual_end      timestamptz,
  status          public.shift_status not null default 'scheduled',
  notes           text,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (scheduled_end > scheduled_start),
  check (scheduled_end - scheduled_start <= interval '24 hours')
);
create index shifts_guard_start_idx on public.shifts (guard_id, scheduled_start desc);
create index shifts_status_idx      on public.shifts (status, scheduled_start);
create index shifts_route_idx       on public.shifts (route_id);
create trigger shifts_updated_at before update on public.shifts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- shift_checkpoints: a COPY of the route's checkpoints, taken when the shift
-- is created (filled automatically by a trigger in migration 03).
-- Why a copy? If a supervisor edits a route next month, last month's shifts
-- (and their reports) must not change. Shifts that have not started yet are
-- refreshed when their route changes; started/finished shifts never are.
-- ---------------------------------------------------------------------------
create table public.shift_checkpoints (
  shift_id       uuid not null references public.shifts (id) on delete cascade,
  checkpoint_id  uuid not null references public.checkpoints (id) on delete restrict,
  sequence       integer not null,
  due_offset_min integer not null,
  primary key (shift_id, checkpoint_id)
);
create index shift_checkpoints_checkpoint_idx on public.shift_checkpoints (checkpoint_id);

-- ---------------------------------------------------------------------------
-- scans: one row per tag scan. Written ONLY through submit_scan() (migration
-- 03), which validates distance, time and GPS on the server.
-- ---------------------------------------------------------------------------
create table public.scans (
  id                   uuid primary key,  -- generated on the phone (idempotency)
  shift_id             uuid not null references public.shifts (id) on delete restrict,
  guard_id             uuid not null references public.profiles (id) on delete restrict,
  checkpoint_id        uuid not null references public.checkpoints (id) on delete restrict,
  method               public.scan_method not null,
  raw_value            text not null,
  status               public.scan_status not null default 'normal',
  note                 text,
  -- Time evidence
  device_time          timestamptz not null,  -- phone clock when the tag was scanned
  device_sent_at       timestamptz not null,  -- phone clock when the upload was sent
  server_time          timestamptz not null default now(), -- server clock on arrival
  clock_offset_sec     integer not null,      -- server_time - device_sent_at
  effective_time       timestamptz not null,  -- device_time corrected by clock_offset_sec
  -- Location evidence
  latitude             double precision,
  longitude            double precision,
  accuracy_m           numeric,
  is_mocked            boolean not null default false,
  distance_m           numeric,
  -- Outcome
  due_at               timestamptz,
  is_on_time           boolean,
  validation           public.scan_validation not null,
  flags                text[] not null default '{}',
  expected_attachments smallint not null default 0 check (expected_attachments between 0 and 20),
  -- Supervisor review (override of the automatic validation)
  reviewed_by          uuid references public.profiles (id) on delete set null,
  reviewed_at          timestamptz,
  review_note          text,
  created_at           timestamptz not null default now()
);
create index scans_shift_checkpoint_idx on public.scans (shift_id, checkpoint_id);
create index scans_guard_time_idx       on public.scans (guard_id, effective_time desc);
create index scans_checkpoint_idx       on public.scans (checkpoint_id);
create index scans_time_idx             on public.scans (effective_time desc);

-- ---------------------------------------------------------------------------
-- scan_attachments: metadata for photos and voice memos stored in the
-- private Storage bucket "patrol-media" at scans/{scan_id}/{file}.
-- ---------------------------------------------------------------------------
create table public.scan_attachments (
  id                uuid primary key,  -- generated on the phone (idempotency)
  scan_id           uuid not null references public.scans (id) on delete cascade,
  guard_id          uuid not null references public.profiles (id) on delete restrict,
  type              public.attachment_type not null,
  source            public.attachment_source not null,
  storage_path      text not null unique,
  mime_type         text,
  size_bytes        bigint check (size_bytes >= 0),
  duration_sec      numeric check (duration_sec is null or (duration_sec > 0 and duration_sec <= 121)),
  captured_at       timestamptz not null,
  exif_taken_at     timestamptz,
  flagged_pre_shift boolean not null default false,
  created_at        timestamptz not null default now(),
  check (type = 'audio' or duration_sec is null),
  check (storage_path like 'scans/' || scan_id::text || '/%')
);
create index scan_attachments_scan_idx on public.scan_attachments (scan_id);

-- ---------------------------------------------------------------------------
-- incidents: created automatically when a guard reports "Issue found".
-- ---------------------------------------------------------------------------
create table public.incidents (
  id              uuid primary key default gen_random_uuid(),
  scan_id         uuid unique references public.scans (id) on delete set null,
  shift_id        uuid references public.shifts (id) on delete set null,
  guard_id        uuid not null references public.profiles (id) on delete restrict,
  checkpoint_id   uuid references public.checkpoints (id) on delete set null,
  description     text not null,
  severity        public.incident_severity not null default 'medium',
  status          public.incident_status not null default 'open',
  resolution_note text,
  resolved_by     uuid references public.profiles (id) on delete set null,
  resolved_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index incidents_status_idx on public.incidents (status, created_at desc);
create index incidents_guard_idx  on public.incidents (guard_id, created_at desc);
create trigger incidents_updated_at before update on public.incidents
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- alarms: anything a supervisor must react to.
-- ---------------------------------------------------------------------------
create table public.alarms (
  id              uuid primary key default gen_random_uuid(),
  type            public.alarm_type not null,
  guard_id        uuid not null references public.profiles (id) on delete restrict,
  shift_id        uuid references public.shifts (id) on delete set null,
  checkpoint_id   uuid references public.checkpoints (id) on delete set null,
  scan_id         uuid references public.scans (id) on delete set null,
  message         text not null,
  latitude        double precision,
  longitude       double precision,
  accuracy_m      numeric,
  status          public.alarm_status not null default 'open',
  acknowledged_by uuid references public.profiles (id) on delete set null,
  acknowledged_at timestamptz,
  resolved_by     uuid references public.profiles (id) on delete set null,
  resolved_at     timestamptz,
  resolution_note text,
  created_at      timestamptz not null default now()
);
create index alarms_status_idx on public.alarms (status, created_at desc);
create index alarms_guard_idx  on public.alarms (guard_id, created_at desc);
-- Never raise the same "missed" alarm twice for one shift + checkpoint.
create unique index alarms_one_missed_per_checkpoint
  on public.alarms (shift_id, checkpoint_id) where type = 'missed_checkpoint';
create unique index alarms_one_not_started_per_shift
  on public.alarms (shift_id) where type = 'shift_not_started';

-- ---------------------------------------------------------------------------
-- location_pings: the GPS trail recorded ONLY while a shift is active.
-- ---------------------------------------------------------------------------
create table public.location_pings (
  id          bigint generated always as identity primary key,
  guard_id    uuid not null references public.profiles (id) on delete cascade,
  shift_id    uuid not null references public.shifts (id) on delete cascade,
  latitude    double precision not null,
  longitude   double precision not null,
  accuracy_m  numeric,
  speed_mps   numeric,
  is_mocked   boolean not null default false,
  recorded_at timestamptz not null,
  received_at timestamptz not null default now()
);
create index location_pings_guard_time_idx on public.location_pings (guard_id, recorded_at desc);
create index location_pings_shift_time_idx on public.location_pings (shift_id, recorded_at);
