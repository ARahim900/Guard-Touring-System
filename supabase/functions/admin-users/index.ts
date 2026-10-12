// =============================================================================
// Edge Function: admin-users
// =============================================================================
// Why this exists
// ---------------
// Creating a login needs the "service_role" key, which bypasses all security.
// That key must NEVER be in the mobile app or the web portal (anyone can read
// files shipped to a browser or phone). So the portal calls this function,
// which runs on Supabase's servers where the key is held as a secret
// environment variable, and the function checks WHO is asking first.
//
// Keys: this uses the new secret key (sb_secret_...), which Supabase injects
// as SUPABASE_SECRET_KEYS. The legacy service_role key leaked during the
// build, so the legacy keys are switched off. Because the platform's built-in
// "Verify JWT" only understands legacy keys, deploy with --no-verify-jwt; the
// caller's login is checked in step 1 below instead.
//
// Actions (POST JSON body):
//   { action: 'create', email, password, full_name, role?, contractor_id?, employee_no?, phone? }
//   { action: 'set_password', user_id, password }
//   { action: 'set_active', user_id, active }
//
// Rules: supervisors may manage guards; only admins may create or manage
// supervisors and admins.
// =============================================================================
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';

type Role = 'guard' | 'supervisor' | 'admin';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SECRET_KEY: string = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}')['default'];
if (!SECRET_KEY) throw new Error('SUPABASE_SECRET_KEYS has no "default" secret key.');

// Admin client: full access. Only used AFTER the caller has been checked.
const admin = createClient(SUPABASE_URL, SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const ROLES: Role[] = ['guard', 'supervisor', 'admin'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validPassword(pw: unknown): pw is string {
  return typeof pw === 'string' && pw.length >= 10 && /[A-Za-z]/.test(pw) && /\d/.test(pw);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    // 1. Who is calling? Verify their login token with Supabase Auth.
    const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData.user) return json({ error: 'Please sign in again.' }, 401);

    const { data: caller } = await admin
      .from('profiles')
      .select('id, role, active')
      .eq('id', userData.user.id)
      .single();
    if (!caller || !caller.active || caller.role === 'guard') {
      return json({ error: 'Only supervisors and admins can manage accounts.' }, 403);
    }
    const callerIsAdmin = caller.role === 'admin';

    const body = await req.json().catch(() => ({}));
    const action = body.action as string;

    // Helper: may the caller manage this target user?
    async function canManage(userId: string): Promise<string | null> {
      const { data: target } = await admin.from('profiles').select('role').eq('id', userId).single();
      if (!target) return 'User not found.';
      if (target.role !== 'guard' && !callerIsAdmin) return 'Only admins can manage supervisors and admins.';
      return null;
    }

    // ---------------------------------------------------------------- create
    if (action === 'create') {
      const email = String(body.email ?? '').trim().toLowerCase();
      const fullName = String(body.full_name ?? '').trim();
      const role: Role = ROLES.includes(body.role) ? body.role : 'guard';

      if (!EMAIL_RE.test(email)) return json({ error: 'Enter a valid email address.' }, 400);
      if (fullName.length < 2) return json({ error: 'Enter the full name.' }, 400);
      if (!validPassword(body.password)) {
        return json({ error: 'Password must be at least 10 characters with letters and numbers.' }, 400);
      }
      if (role !== 'guard' && !callerIsAdmin) {
        return json({ error: 'Only admins can create supervisor or admin accounts.' }, 403);
      }

      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        password: body.password,
        email_confirm: true, // admin-created: no confirmation email needed
        user_metadata: { full_name: fullName },
      });
      if (createError || !created.user) {
        const msg = createError?.message?.includes('already') ? 'This email already has an account.' : createError?.message;
        return json({ error: msg ?? 'Could not create the user.' }, 400);
      }

      // The database trigger has created the profile (as a guard). Now set the rest.
      const { error: profileError } = await admin
        .from('profiles')
        .update({
          full_name: fullName,
          role,
          contractor_id: body.contractor_id || null,
          employee_no: body.employee_no ? String(body.employee_no).trim() : null,
          phone: body.phone ? String(body.phone).trim() : null,
        })
        .eq('id', created.user.id);
      if (profileError) {
        // Roll back so we never leave a half-created account behind.
        await admin.auth.admin.deleteUser(created.user.id);
        const msg = profileError.message.includes('employee_no') ? 'This employee number is already used.' : profileError.message;
        return json({ error: msg }, 400);
      }

      return json({ user_id: created.user.id });
    }

    // ---------------------------------------------------------- set_password
    if (action === 'set_password') {
      const denied = await canManage(body.user_id);
      if (denied) return json({ error: denied }, 403);
      if (!validPassword(body.password)) {
        return json({ error: 'Password must be at least 10 characters with letters and numbers.' }, 400);
      }
      const { error } = await admin.auth.admin.updateUserById(body.user_id, { password: body.password });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    // ------------------------------------------------------------ set_active
    if (action === 'set_active') {
      if (body.user_id === caller.id) return json({ error: 'You cannot deactivate your own account.' }, 400);
      const denied = await canManage(body.user_id);
      if (denied) return json({ error: denied }, 403);
      const active = Boolean(body.active);

      // A "ban" stops the person signing in and invalidates refresh tokens.
      const { error: banError } = await admin.auth.admin.updateUserById(body.user_id, {
        ban_duration: active ? 'none' : '876000h', // ~100 years
      });
      if (banError) return json({ error: banError.message }, 400);

      const { error } = await admin.from('profiles').update({ active }).eq('id', body.user_id);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    return json({ error: 'Unknown action.' }, 400);
  } catch (err) {
    console.error(err);
    return json({ error: 'Unexpected server error.' }, 500);
  }
});
