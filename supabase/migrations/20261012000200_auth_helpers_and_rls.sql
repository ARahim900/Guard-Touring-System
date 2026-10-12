-- =============================================================================
-- Muscat Bay Patrol System — 02: Auth helpers and Row Level Security (RLS)
-- =============================================================================
-- First principles
-- ----------------
-- * The mobile app and web portal talk to the database directly with the
--   public "anon" key plus the user's login token (JWT). Anyone can extract
--   the anon key from an app, so the key itself protects nothing.
-- * Protection comes from RLS: for every row, Postgres asks the policy
--   "may THIS logged-in user see / change THIS row?". auth.uid() is the id of
--   the logged-in user, taken from the signed JWT, so it cannot be faked.
-- * Guards: only their own rows. Supervisors/admins ("staff"): everything.
-- * Some writes (scans, shift start/end, SOS) are not allowed directly at all.
--   They go through SECURITY DEFINER functions (migration 03) that validate
--   the data first. "Security definer" means the function runs with the
--   rights of its owner, so it can write where the caller cannot.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Helper functions used inside policies.
-- They are SECURITY DEFINER so that reading "profiles" inside a policy does not
-- trigger the profiles policy again (which would loop forever).
-- "set search_path = ''" stops anyone hijacking table names; that is why every
-- table below is written with its schema, e.g. public.profiles.
-- ---------------------------------------------------------------------------
create or replace function public.my_role()
returns public.user_role
language sql stable security definer set search_path = ''
as $$
  select role from public.profiles where id = auth.uid() and active;
$$;

create or replace function public.is_staff()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and active and role in ('supervisor', 'admin')
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and active and role = 'admin'
  );
$$;

-- Routes the current guard has (or had) a shift on.
create or replace function public.my_route_ids()
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select distinct route_id from public.shifts where guard_id = auth.uid();
$$;

-- Checkpoints on the current guard's shifts (past, present and future).
create or replace function public.my_checkpoint_ids()
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select distinct sc.checkpoint_id
  from public.shift_checkpoints sc
  join public.shifts s on s.id = sc.shift_id
  where s.guard_id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- New login -> new profile row. Role is ALWAYS 'guard' here, whatever the
-- sign-up metadata says. Only the admin-users Edge Function (service role)
-- or an admin can raise it. This blocks "sign up as admin" attacks.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1)),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Guards may edit their own name and phone, but never their role,
-- contractor, employee number or active flag. Only admins may change roles.
-- Calls with no logged-in user (service role, SQL editor) are trusted.
-- ---------------------------------------------------------------------------
create or replace function public.protect_profile_columns()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new;  -- server-side call (service role / SQL editor)
  end if;

  -- Supervisors manage guards only; supervisor and admin profiles are for admins
  -- (anyone may still edit their own name and phone).
  if not public.is_admin() and old.role <> 'guard' and old.id <> auth.uid() then
    raise exception 'Only admins can change supervisor or admin profiles' using errcode = '42501';
  end if;

  if new.id <> old.id or new.email is distinct from old.email then
    raise exception 'Profile id and email cannot be changed here' using errcode = '42501';
  end if;

  if not public.is_staff() and (
       new.role          is distinct from old.role
    or new.contractor_id is distinct from old.contractor_id
    or new.employee_no   is distinct from old.employee_no
    or new.active        is distinct from old.active
  ) then
    raise exception 'Only supervisors can change these profile fields' using errcode = '42501';
  end if;

  if new.role is distinct from old.role and not public.is_admin() then
    raise exception 'Only admins can change roles' using errcode = '42501';
  end if;

  if new.id = auth.uid() and new.active is distinct from old.active then
    raise exception 'You cannot deactivate your own account' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger profiles_protect_columns
  before update on public.profiles
  for each row execute function public.protect_profile_columns();

-- ---------------------------------------------------------------------------
-- Privileges. RLS decides WHICH rows; GRANT decides WHICH operations at all.
-- anon (not logged in) gets nothing.
-- ---------------------------------------------------------------------------
revoke all on all tables    in schema public from anon;
revoke all on all functions in schema public from anon, public;
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on function public.my_role(), public.is_staff(), public.is_admin(),
  public.my_route_ids(), public.my_checkpoint_ids() to authenticated;

-- Scans are append-only evidence: inserted only by submit_scan(), never deleted.
revoke insert, delete on public.scans from authenticated;
revoke delete on public.scan_attachments from authenticated;
revoke insert, delete on public.alarms, public.incidents from authenticated;
revoke update, delete on public.location_pings from authenticated;
-- shift_checkpoints is maintained only by triggers (migration 03).
revoke insert, update, delete on public.shift_checkpoints from authenticated;

-- ---------------------------------------------------------------------------
-- Turn RLS on for every table. With RLS on and no policy, NOTHING is allowed.
-- ---------------------------------------------------------------------------
alter table public.app_settings      enable row level security;
alter table public.contractors       enable row level security;
alter table public.profiles          enable row level security;
alter table public.checkpoints       enable row level security;
alter table public.routes            enable row level security;
alter table public.route_checkpoints enable row level security;
alter table public.shifts            enable row level security;
alter table public.shift_checkpoints enable row level security;
alter table public.scans             enable row level security;
alter table public.scan_attachments  enable row level security;
alter table public.incidents         enable row level security;
alter table public.alarms            enable row level security;
alter table public.location_pings    enable row level security;

-- Note: "(select auth.uid())" is evaluated once per query instead of once
-- per row, which Supabase recommends for speed.

-- app_settings ---------------------------------------------------------------
create policy "settings: everyone signed in can read" on public.app_settings
  for select to authenticated using (true);
create policy "settings: admins update" on public.app_settings
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- contractors ----------------------------------------------------------------
create policy "contractors: staff all, guards their own" on public.contractors
  for select to authenticated
  using (
    (select public.is_staff())
    or id = (select contractor_id from public.profiles where id = (select auth.uid()))
  );
create policy "contractors: staff insert" on public.contractors
  for insert to authenticated with check ((select public.is_staff()));
create policy "contractors: staff update" on public.contractors
  for update to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));
create policy "contractors: admins delete" on public.contractors
  for delete to authenticated using ((select public.is_admin()));

-- profiles -------------------------------------------------------------------
create policy "profiles: self or staff read" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select public.is_staff()));
create policy "profiles: self or staff update" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()) or (select public.is_staff()))
  with check (id = (select auth.uid()) or (select public.is_staff()));
-- No insert/delete policy: accounts are created by the admin-users Edge Function.

-- checkpoints ----------------------------------------------------------------
create policy "checkpoints: staff all, guards on their routes" on public.checkpoints
  for select to authenticated
  using ((select public.is_staff()) or id in (select public.my_checkpoint_ids()));
create policy "checkpoints: staff insert" on public.checkpoints
  for insert to authenticated with check ((select public.is_staff()));
create policy "checkpoints: staff update" on public.checkpoints
  for update to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));
create policy "checkpoints: staff delete" on public.checkpoints
  for delete to authenticated using ((select public.is_staff()));

-- routes ---------------------------------------------------------------------
create policy "routes: staff all, guards their own" on public.routes
  for select to authenticated
  using ((select public.is_staff()) or id in (select public.my_route_ids()));
create policy "routes: staff insert" on public.routes
  for insert to authenticated with check ((select public.is_staff()));
create policy "routes: staff update" on public.routes
  for update to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));
create policy "routes: staff delete" on public.routes
  for delete to authenticated using ((select public.is_staff()));

-- route_checkpoints ------------------------------------------------------------
create policy "route_checkpoints: staff all, guards their own" on public.route_checkpoints
  for select to authenticated
  using ((select public.is_staff()) or route_id in (select public.my_route_ids()));
create policy "route_checkpoints: staff insert" on public.route_checkpoints
  for insert to authenticated with check ((select public.is_staff()));
create policy "route_checkpoints: staff update" on public.route_checkpoints
  for update to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));
create policy "route_checkpoints: staff delete" on public.route_checkpoints
  for delete to authenticated using ((select public.is_staff()));

-- shifts -----------------------------------------------------------------------
create policy "shifts: own or staff read" on public.shifts
  for select to authenticated
  using (guard_id = (select auth.uid()) or (select public.is_staff()));
create policy "shifts: staff insert" on public.shifts
  for insert to authenticated with check ((select public.is_staff()));
create policy "shifts: staff update" on public.shifts
  for update to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));
create policy "shifts: staff delete" on public.shifts
  for delete to authenticated using ((select public.is_staff()) and status = 'scheduled');
-- Guards start/end shifts through start_shift()/end_shift() (migration 03).

-- shift_checkpoints ------------------------------------------------------------
create policy "shift_checkpoints: own or staff read" on public.shift_checkpoints
  for select to authenticated
  using (
    (select public.is_staff())
    or exists (select 1 from public.shifts s where s.id = shift_id and s.guard_id = (select auth.uid()))
  );

-- scans ------------------------------------------------------------------------
create policy "scans: own or staff read" on public.scans
  for select to authenticated
  using (guard_id = (select auth.uid()) or (select public.is_staff()));
create policy "scans: staff review" on public.scans
  for update to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));

-- scan_attachments -------------------------------------------------------------
create policy "attachments: own or staff read" on public.scan_attachments
  for select to authenticated
  using (guard_id = (select auth.uid()) or (select public.is_staff()));
create policy "attachments: guard adds to own scan" on public.scan_attachments
  for insert to authenticated
  with check (
    guard_id = (select auth.uid())
    and exists (select 1 from public.scans s where s.id = scan_id and s.guard_id = (select auth.uid()))
  );

-- incidents --------------------------------------------------------------------
create policy "incidents: own or staff read" on public.incidents
  for select to authenticated
  using (guard_id = (select auth.uid()) or (select public.is_staff()));
create policy "incidents: staff update" on public.incidents
  for update to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));

-- alarms -----------------------------------------------------------------------
create policy "alarms: own or staff read" on public.alarms
  for select to authenticated
  using (guard_id = (select auth.uid()) or (select public.is_staff()));
create policy "alarms: staff update" on public.alarms
  for update to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));

-- location_pings ---------------------------------------------------------------
create policy "pings: own or staff read" on public.location_pings
  for select to authenticated
  using (guard_id = (select auth.uid()) or (select public.is_staff()));
-- Only for a shift the guard has started (points may upload after it ends,
-- from the offline queue), and only with a believable timestamp: a point dated
-- in the future would otherwise pin the guard's position on the live map.
create policy "pings: guard adds own for own started shift" on public.location_pings
  for insert to authenticated
  with check (
    guard_id = (select auth.uid())
    and recorded_at <= now() + interval '5 minutes'
    and recorded_at > now() - interval '7 days'
    and exists (
      select 1 from public.shifts s
      where s.id = shift_id and s.guard_id = (select auth.uid()) and s.actual_start is not null
    )
  );
