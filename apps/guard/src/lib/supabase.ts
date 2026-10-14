// =============================================================================
// The single Supabase client used by the whole app.
// =============================================================================
// * The anon key is public by design. Security comes from the database's
//   Row Level Security policies, which check the logged-in user's token.
// * The login session is saved on the phone, encrypted (see
//   secureSessionStorage.ts), so the guard stays signed in after closing the
//   app (and so the background location task can upload).
// * Supabase tokens expire after about an hour. autoRefreshToken renews them,
//   but only while the app is in the foreground, so we pause/resume it with
//   the app state (this is Supabase's recommended pattern for React Native).
// =============================================================================
import 'react-native-url-polyfill/auto';
import { createClient, type Session } from '@supabase/supabase-js';
import { AppState } from 'react-native';

import { env } from './env';
import { secureSessionStorage } from './secureSessionStorage';

/** Where the login session is saved on the phone (read directly when offline). */
export const AUTH_STORAGE_KEY = 'mbpatrol-auth';

/** The saved login session, read straight from the phone (no network). */
export async function readSavedSession(): Promise<Session | null> {
  try {
    const raw = await secureSessionStorage.getItem(AUTH_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

/**
 * Android's network layer has no time limit of its own: on one bar of signal a
 * request can hang for minutes and block everything queued behind it. Every
 * request is therefore cancelled after 90 s (long enough for a photo on slow 3G).
 * A caller can pass its own, shorter limit (the SOS button uses 8 s).
 */
const fetchWithTimeout: typeof fetch = (input, init) => {
  if (init?.signal) return fetch(input, init);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
};

export const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
  global: { fetch: fetchWithTimeout },
  auth: {
    storageKey: AUTH_STORAGE_KEY,
    storage: secureSessionStorage,
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
