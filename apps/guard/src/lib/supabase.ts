// =============================================================================
// The single Supabase client used by the whole app.
// =============================================================================
// * The anon key is public by design. Security comes from the database's
//   Row Level Security policies, which check the logged-in user's token.
// * The login session is saved in AsyncStorage so the guard stays signed in
//   after closing the app (and so the background location task can upload).
// * Supabase tokens expire after about an hour. autoRefreshToken renews them,
//   but only while the app is in the foreground, so we pause/resume it with
//   the app state (this is Supabase's recommended pattern for React Native).
// =============================================================================
import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';

import { env } from './env';

export const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false, // no web redirects in a native app
  },
});

AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    supabase.auth.startAutoRefresh();
  } else {
    supabase.auth.stopAutoRefresh();
  }
});

/** Name of the private Storage bucket for scan photos and voice memos. */
export const MEDIA_BUCKET = 'patrol-media';
