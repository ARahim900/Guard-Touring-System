// =============================================================================
// Shared sign-in. Route guards separate patrol scanning from staff management.
// =============================================================================
import { toast } from 'sonner';
import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { friendlyError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/lib/types';

interface AuthValue {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  /** Set when the server could not be reached at start-up (no sign-out happens). */
  loadError: string | null;
  retry: () => void;
  isAdmin: boolean;
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

async function loadProfile(userId: string) {
  const { data, error } = await supabase.from('profiles').select('id, full_name, email, employee_no, phone, role, active').eq('id', userId).abortSignal(AbortSignal.timeout(15000)).maybeSingle();
  if (error) throw error; // network/server problem: NOT a reason to sign anyone out
  return (data as Profile | null) ?? null;
}

// scope 'local' signs out this browser only. The default ('global') would also
// sign the same person out of the guard app on their phone, mid-patrol.
const signOutHere = () => supabase.auth.signOut({ scope: 'local' });

const isActive = (p: Profile | null) => Boolean(p?.active && ['guard', 'supervisor', 'admin'].includes(p.role));

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const boot = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      const p = data.session ? await loadProfile(data.session.user.id) : null;
      if (data.session && !isActive(p)) {
        const { error } = await signOutHere();
        if (error) throw error;
      } else {
        setSession(data.session);
        setProfile(p);
      }
    } catch (e) {
      setLoadError(friendlyError(e));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void boot();
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'SIGNED_OUT') {
        setSession(null);
        setProfile(null);
      } else if (event === 'TOKEN_REFRESHED') {
        setSession(s);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [boot]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    if (error || !data.session) return friendlyError(error, 'Could not sign in.');
    let p: Profile | null;
    try {
      p = await loadProfile(data.session.user.id);
    } catch (e) {
      return friendlyError(e);
    }
    if (!isActive(p)) {
      const { error: signOutError } = await signOutHere();
      if (signOutError) return friendlyError(signOutError);
      return 'Your account is not active. Contact your supervisor.';
    }
    setSession(data.session);
    setProfile(p);
    return null;
  }, []);

  const signOut = useCallback(async () => {
    const { error } = await signOutHere();
    if (error) toast.error(friendlyError(error));
  }, []);

  const value = useMemo(
    () => ({ session, profile, loading, loadError, retry: () => void boot(), isAdmin: profile?.role === 'admin', signIn, signOut }),
    [session, profile, loading, loadError, boot, signIn, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
