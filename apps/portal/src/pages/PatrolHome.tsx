import { ArrowUpRight, FileText, MapPin, ScanLine } from 'lucide-react';
import { Link } from 'react-router';
import { Button, ErrorNote, Spinner } from '@/components/ui';
import { InstallPatrol } from '@/components/InstallPatrol';
import { PatrolActivity } from '@/components/PatrolActivity';
import { PatrolSettings, type PatrolSettingsData, type SecurityLogin } from '@/components/PatrolSettings';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { unwrap, useAsync } from '@/lib/useAsync';

export default function PatrolHomePage() {
  const { profile } = useAuth();
  return profile?.role === 'guard' ? <GuardDashboard /> : <StaffHome />;
}

/** Security account: read-only overview of its own patrols, with the way back to scanning. */
function GuardDashboard() {
  const { data, loading, error, reload } = useAsync(async () =>
    unwrap(await supabase.from('app_settings').select('guard_names').eq('id', 1).single<{ guard_names: string[] }>()), []);
  return <div className="mx-auto max-w-5xl space-y-6">
    <header><p className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Muscat Bay security</p><h1 className="text-3xl">Dashboard</h1><p className="mt-2 text-muted-foreground">Your patrols and their progress. The daily report is built automatically from every scan.</p></header>
    <div className="grid gap-4 sm:grid-cols-2">
      <Link to="/guard" className="flex min-h-24 items-center gap-4 rounded-xl bg-primary p-5 text-white shadow-card hover:bg-primary-hover"><span className="rounded-lg bg-white/15 p-3"><ScanLine className="size-6" aria-hidden="true" /></span><span className="flex-1"><span className="block text-lg font-semibold">Scan locations</span><span className="mt-1 block text-sm text-white/80">Start or continue a patrol</span></span><ArrowUpRight className="size-5" aria-hidden="true" /></Link>
      <Link to="/reports" className="flex min-h-24 items-center gap-4 rounded-xl border border-border bg-card p-5 hover:bg-muted"><span className="rounded-lg bg-secondary-light p-3 text-primary"><FileText className="size-6" aria-hidden="true" /></span><span className="flex-1"><span className="block text-lg font-semibold">Daily report</span><span className="mt-1 block text-sm text-muted-foreground">Today's report, ready to view or download</span></span><ArrowUpRight className="size-5 text-primary" aria-hidden="true" /></Link>
    </div>
    <ErrorNote message={error} />
    {error ? <Button variant="outline" onClick={() => void reload()}>Try again</Button> : null}
    {loading ? <Spinner /> : data ? <PatrolActivity names={data.guard_names} /> : null}
  </div>;
}

function StaffHome() {
  const { data, loading, error, reload } = useAsync(async () => {
    const [settings, guards, locations] = await Promise.all([
      supabase.from('app_settings').select('patrol_guard_id, guard_names').eq('id', 1).single<PatrolSettingsData>(),
      supabase.from('profiles').select('id, full_name, email').eq('active', true).eq('role', 'guard').order('full_name').returns<SecurityLogin[]>(),
      supabase.from('checkpoints').select('id', { count: 'exact', head: true }).eq('active', true),
    ]);
    if (locations.error) throw locations.error;
    if (locations.count === null) throw new Error('Could not load the number of patrol locations. Try again.');
    return { settings: unwrap(settings), guards: unwrap(guards), count: locations.count };
  }, []);

  return <div className="mx-auto max-w-5xl space-y-6">
    <header><p className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Muscat Bay security</p><h1 className="text-3xl">Patrol</h1><p className="mt-2 text-muted-foreground">One visit to every location. A clear record of every round.</p></header>
    <ErrorNote message={error} />
    {error ? <Button variant="outline" onClick={() => void reload()}>Try again</Button> : null}
    {loading ? <Spinner /> : data ? <>
      {!data.count ? <div role="status" className="rounded-xl bg-secondary-light px-5 py-4 text-primary"><p className="font-semibold">Add your first patrol location</p><Link to="/checkpoints" className="inline-block py-2 text-sm underline">Add location and QR label</Link></div> : data.settings.guard_names.length === 4 ? <div role="status" className="rounded-xl bg-secondary-light px-5 py-4 text-primary"><p className="font-semibold">Ready for the security team</p><p className="mt-1 text-sm">Patrols start whenever the team is available and last 12 hours. Days with no patrol show as "Absent" in Reports.</p></div> : <div role="status" className="rounded-xl bg-warning-bg px-5 py-4 text-warning-text"><p className="font-semibold">Add the four guard names</p><p className="mt-1 text-sm">Guards choose their name when they start a patrol.</p><a href="#shift-settings" className="inline-block py-2 text-sm underline">Open patrol team</a></div>}
      <div className="grid items-start gap-5 lg:grid-cols-[1.15fr_1fr]">
        <div className="space-y-5">
          <PatrolActivity names={data.settings.guard_names} />
          <Link to="/checkpoints" className="flex min-h-24 items-center gap-4 rounded-xl border border-border bg-card p-5 hover:bg-muted"><span className="rounded-lg bg-secondary-light p-3 text-primary"><MapPin className="size-5" aria-hidden="true" /></span><span className="flex-1"><span className="block font-semibold">Locations & QR labels</span><span className="mt-1 block text-sm text-muted-foreground">{data.count ? `${data.count} active locations · each visited once per shift` : 'Add locations and print their labels'}</span></span><ArrowUpRight className="size-5 text-primary" aria-hidden="true" /></Link>
        </div>
        <PatrolSettings key={JSON.stringify(data.settings)} settings={data.settings} guards={data.guards} onSaved={() => void reload()} />
      </div>
      <section className="flex flex-wrap items-start gap-4 rounded-xl border border-border bg-card p-5"><ScanLine className="mt-1 size-6 text-primary" aria-hidden="true" /><div className="min-w-0 flex-1 space-y-2"><h2 className="text-lg">On the guard’s phone</h2><p className="text-sm text-muted-foreground">Sign in with the security account, choose a name, then tap Start scanning at any time. At each location, tap it and scan its QR label.</p><a href="/guard" className="inline-block break-all py-1 text-sm font-medium text-primary underline">{window.location.origin}/guard</a></div></section>
    </> : null}
    <InstallPatrol />
  </div>;
}
