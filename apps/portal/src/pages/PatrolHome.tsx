import { ArrowUpRight, MapPin, ScanLine } from 'lucide-react';
import { Link } from 'react-router';
import { Button, ErrorNote, Spinner } from '@/components/ui';
import { InstallPatrol } from '@/components/InstallPatrol';
import { PatrolActivity } from '@/components/PatrolActivity';
import { PatrolSettings, type PatrolSettingsData, type SecurityLogin } from '@/components/PatrolSettings';
import { supabase } from '@/lib/supabase';
import { unwrap, useAsync } from '@/lib/useAsync';

export default function PatrolHomePage() {
  const { data, loading, error, reload } = useAsync(async () => {
    const [settings, guards, locations] = await Promise.all([
      supabase.from('app_settings').select('patrol_guard_id, night_shift_start, night_shift_end, guard_names').eq('id', 1).single<PatrolSettingsData>(),
      supabase.from('profiles').select('id, full_name, email').eq('active', true).eq('role', 'guard').order('full_name').returns<SecurityLogin[]>(),
      supabase.from('checkpoints').select('id', { count: 'exact', head: true }).eq('active', true),
    ]);
    if (locations.error) throw locations.error;
    if (locations.count === null) throw new Error('Could not load the number of patrol locations. Try again.');
    return { settings: unwrap(settings), guards: unwrap(guards), count: locations.count };
  }, []);

  return <div className="mx-auto max-w-5xl space-y-6">
    <header><p className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Muscat Bay security</p><h1 className="text-3xl">Night patrol</h1><p className="mt-2 text-muted-foreground">One visit to every location. A clear record of every round.</p></header>
    <ErrorNote message={error} />
    {error ? <Button variant="outline" onClick={() => void reload()}>Try again</Button> : null}
    {loading ? <Spinner /> : data ? <>
      {!data.count ? <div role="status" className="rounded-xl bg-secondary-light px-5 py-4 text-primary"><p className="font-semibold">Add your first patrol location</p><Link to="/checkpoints" className="inline-block py-2 text-sm underline">Add location and QR label</Link></div> : <div role="status" className="rounded-xl bg-secondary-light px-5 py-4 text-primary"><p className="font-semibold">Ready for the security team</p><p className="mt-1 text-sm">Guards choose their name and shift hours, then start scanning. Manager setup is optional.</p></div>}
      <div className="grid items-start gap-5 lg:grid-cols-[1.15fr_1fr]">
        <div className="space-y-5">
          <PatrolActivity names={data.settings.guard_names} />
          <Link to="/checkpoints" className="flex min-h-24 items-center gap-4 rounded-xl border border-border bg-card p-5 hover:bg-muted"><span className="rounded-lg bg-secondary-light p-3 text-primary"><MapPin className="size-5" aria-hidden="true" /></span><span className="flex-1"><span className="block font-semibold">Locations & QR labels</span><span className="mt-1 block text-sm text-muted-foreground">{data.count ? `${data.count} active locations · each visited once per shift` : 'Add locations and print their labels'}</span></span><ArrowUpRight className="size-5 text-primary" aria-hidden="true" /></Link>
        </div>
        <PatrolSettings key={JSON.stringify(data.settings)} settings={data.settings} guards={data.guards} onSaved={() => void reload()} />
      </div>
      <section className="flex flex-wrap items-start gap-4 rounded-xl border border-border bg-card p-5"><ScanLine className="mt-1 size-6 text-primary" aria-hidden="true" /><div className="min-w-0 flex-1 space-y-2"><h2 className="text-lg">On the guard’s phone</h2><p className="text-sm text-muted-foreground">Sign in with the security account, choose a name and shift hours, then tap Start scanning. Visit each location and scan its QR label.</p><a href="/guard" className="inline-block break-all py-1 text-sm font-medium text-primary underline">{window.location.origin}/guard</a></div></section>
    </> : null}
    <InstallPatrol />
  </div>;
}
