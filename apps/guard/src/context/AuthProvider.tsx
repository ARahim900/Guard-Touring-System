// =============================================================================
// Who is signed in? Provides the session (login token) and the profile row.
// =============================================================================
// Accounts are created by supervisors (no "Sign up" in this app). This app is
// for guards only: supervisor/admin accounts are sent to the web portal.
// =============================================================================
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isAuthRetryableFetchError, type Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { friendlyError } from '@/lib/errors';
import { Sentry } from '@/lib/sentry';
import { AUTH_STORAGE_KEY, supabase } from '@/lib/supabase';
import type { Profile } from '@/lib/types';
import { clearCache, readCache, writeCache } from '@/offline/cache';
import { clearOutbox } from '@/offline/outbox';
import { stopTracking } from '@/services/location';

interface AuthContextValue {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  /** Returns an error message, or null on success. */
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: (options?: { discardOutbox?: boolean }) => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, employee_no, phone, role, contractor_id, active, contractors(name)')
    .eq('id', userId)
    .single();
  if (error) {
    // Offline: use the last saved copy so the app still opens.
    const cached = await readCache<Profile>('profile');
    return cached?.value.id === userId ? cached.value : null;
  }
  const profile = data as unknown as Profile;
  await writeCache('profile', profile);
  return profile;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (s: Session | null) => {
    if (!s) {
      setProfile(null);
      return;
    }
    const p = await fetchProfile(s.user.id);
    setProfile(p);
    // Tag crash reports with the user id only (no name/email: privacy).
    Sentry.setUser({ id: s.user.id });
  }, []);

  useEffect(() => {
    // 1. Restore the saved session when the app starts.
    supabase.auth.getSession().then(async ({ data, error }) => {
      let s = data.session;
      // Offline with an expired token, Supabase cannot refresh it and reports "no
      // session", although the saved session is still there. Keep the guard signed
      // in so they can scan offline; the token is refreshed once signal returns.
      if (!s && error && isAuthRetryableFetchError(error)) {
        const raw = await AsyncStorage.getItem(AUTH_STORAGE_KEY).catch(() => null);
        s = raw ? (JSON.parse(raw) as Session) : null;
      }
      setSession(s);
      await loadProfile(s); // falls back to the cached profile when offline
      setLoading(false);
    });
    // 2. Follow future changes (sign in, sign out, token refresh).
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (!s) {
        setProfile(null);
        // Signed out by the server (e.g. account disabled): stop recording location.
        if (event === 'SIGNED_OUT') void stopTracking().catch(() => undefined);
      } else if (event === 'TOKEN_REFRESHED') {
        // Back online after an offline start: refresh the profile too.
        // (setTimeout: Supabase advises not to call it inside this callback.)
        setTimeout(() => void loadProfile(s), 0);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [loadProfile]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
      if (error || !data.session) return friendlyError(error, 'Could not sign in.');

      const p = await fetchProfile(data.session.user.id);
      if (!p || !p.active) {
        await supabase.auth.signOut();
        return 'This account is disabled. Contact your supervisor.';
      }
      if (p.role !== 'guard') {
        await supabase.auth.signOut();
        return 'This app is for guards. Supervisors please use the web portal.';
      }
      setProfile(p);
      Sentry.setUser({ id: data.session.user.id });
      return null;
    },
    [],
  );

  const signOut = useCallback(async (options?: { discardOutbox?: boolean }) => {
    await stopTracking().catch(() => undefined);
    if (options?.discardOutbox) await clearOutbox();
    await clearCache();
    await supabase.auth.signOut().catch(() => undefined); // works offline too
    Sentry.setUser(null);
    setProfile(null);
  }, []);

  const refreshProfile = useCallback(async () => {
    await loadProfile(session);
  }, [loadProfile, session]);

  const value = useMemo(
    () => ({ session, profile, loading, signIn, signOut, refreshProfile }),
    [session, profile, loading, signIn, signOut, refreshProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
