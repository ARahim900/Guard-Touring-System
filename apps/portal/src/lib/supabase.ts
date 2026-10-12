// The portal's Supabase client. It uses the PUBLIC anon key; what each
// supervisor can see or change is enforced by Row Level Security in the
// database, not by this code.
import { createClient } from '@supabase/supabase-js';

import { env } from './env';

export const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
  auth: { persistSession: true, autoRefreshToken: true },
});

export const MEDIA_BUCKET = 'patrol-media';
