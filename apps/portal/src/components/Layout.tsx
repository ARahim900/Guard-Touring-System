import { NavLink, Outlet } from 'react-router';
import { useAuth } from '@/context/AuthContext';

const pages = [
  { to: '/', label: 'Night patrol' },
  { to: '/checkpoints', label: 'Locations' },
  { to: '/reports', label: 'Reports' },
];

export function Layout() {
  const { profile, signOut } = useAuth();
  return (
    <div className="flex min-h-full flex-col bg-background">
      <header className="bg-primary px-4 py-4 text-white sm:px-6">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <NavLink to="/" className="flex shrink-0 items-center gap-3 font-semibold">
            <img src="/apple-touch-icon.png" alt="Muscat Bay" className="size-10 rounded-md" />MB Patrol
          </NavLink>
          <details className="min-w-0 max-w-[50%] text-right text-sm">
            <summary title={profile?.full_name} className="cursor-pointer truncate">{profile?.full_name}</summary>
            <button onClick={() => void signOut()} className="mt-2 min-h-11 underline">Sign out</button>
          </details>
        </div>
      </header>
      <nav aria-label="Main navigation" className="border-b border-border bg-white px-3">
        <div className="mx-auto flex max-w-5xl gap-2">
          {pages.map((page) => <NavLink key={page.to} to={page.to} end={page.to === '/'} className={({ isActive }) => `min-h-12 border-b-2 px-3 py-3 text-sm font-semibold ${isActive ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-primary'}`}>{page.label}</NavLink>)}
        </div>
      </nav>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6"><Outlet /></main>
    </div>
  );
}
