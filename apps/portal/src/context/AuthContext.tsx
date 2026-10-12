// =============================================================================
// Login state for the portal. Only active supervisors and admins get in;
// guards are signed straight back out with a clear message.
// =============================================================================
import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { friendlyError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/lib/types';

interface AuthValue {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  isAdmin: boolean;
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

async function loadProfile(userId: string) {
  const { data } = await supabase.from('profiles').select('*').eq('id', userId).single();
  return (data as Profile | null) ?? null;
}

const isStaff = (p: Profile | null) => Boolean(p && p.active && (p.role === 'supervisor' || p.role === 'admin'));

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      const p = data.session ? await loadProfile(data.session.user.id) : null;
      if (data.session && !isStaff(p)) {
        await supabase.auth.signOut();
      } else {
        setSession(data.session);
        setProfile(p);
      }
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'SIGNED_OUT') {
        setSession(null);
        setProfile(null);
      } else if (event === 'TOKEN_REFRESHED') {
        setSession(s);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    if (error || !data.session) return friendlyError(error, 'Could not sign in.');
    const p = await loadProfile(data.session.user.id);
    if (!isStaff(p)) {
      await supabase.auth.signOut();
      return 'This portal is for supervisors and admins only.';
    }
    setSession(data.session);
    setProfile(p);
    return null;
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const value = useMemo(
    () => ({ session, profile, loading, isAdmin: profile?.role === 'admin', signIn, signOut }),
    [session, profile, loading, signIn, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
