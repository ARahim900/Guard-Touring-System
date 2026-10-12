-- =============================================================================
-- Bootstrap: make the FIRST admin.
-- =============================================================================
-- Accounts cannot sign themselves up. So the very first admin is created by
-- hand, once:
--   1. Supabase Dashboard -> Authentication -> Users -> "Add user"
--      -> "Create new user", enter your email + a strong password,
--      tick "Auto Confirm User".
--   2. Paste the statement below into Dashboard -> SQL Editor, change the
--      email, and press Run.
-- After that, create every other account from the Supervisor Portal
-- (Guards page), which calls the admin-users Edge Function.
-- =============================================================================

update public.profiles
   set role = 'admin',
       full_name = 'Abdulrahim Al Balushi'   -- change if needed
 where email = 'aalbalushi@muscatbay.com';  -- <-- your login email

-- Check it worked (should return one row with role = admin):
select id, full_name, email, role from public.profiles where role = 'admin';
