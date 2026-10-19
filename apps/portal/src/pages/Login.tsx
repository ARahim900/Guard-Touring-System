// Supervisor sign-in. Accounts are created by an admin (Guards & users page).
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { toast } from 'sonner';

import { InstallPatrol } from '@/components/InstallPatrol';
import { Button, ErrorNote, Field, Input } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';

export default function LoginPage() {
  const { session, profile, signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (session && profile) return <Navigate to={profile.role === 'guard' ? '/guard' : '/'} replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const msg = await signIn(email, password);
    setBusy(false);
    if (msg) return setError(msg);
    toast.success('Signed in.');
    navigate('/', { replace: true });
  }

  return (
    <main className="flex min-h-full items-center justify-center bg-primary p-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4 rounded-lg bg-card p-6 shadow-card">
        <div className="flex flex-col items-center gap-2 text-center">
          <img src="/muscat-bay-logo.png" alt="Muscat Bay" className="h-24 w-auto" />
          <h1 className="text-xl">MB Security</h1>
          <p className="text-sm text-muted-foreground">Guard scanning & supervisor portal</p>
        </div>
        <Field label="Email">
          <Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password">
          <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <ErrorNote message={error} />
        <Button type="submit" loading={busy} className="w-full">
          Sign in
        </Button>
        <InstallPatrol />
        <p className="text-center text-xs text-muted-foreground">
          Forgotten password? Ask an admin to reset it. · <Link to="/privacy" className="underline">Privacy</Link>
        </p>
      </form>
    </main>
  );
}
