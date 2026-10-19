import { AlertTriangle, ArrowUpRight, ClipboardCheck, Radio, RefreshCw } from 'lucide-react';
import { useEffect } from 'react';
import { Link } from 'react-router';
import { Button, ErrorNote, Spinner } from '@/components/ui';
import { useAlarms } from '@/context/AlarmContext';
import { supabase } from '@/lib/supabase';
import { addDays, dayKey, dayRange, formatTime } from '@/lib/time';
import { useAsync } from '@/lib/useAsync';

/** Counts have explicit scopes; none depend on a truncated list response. */
export function PatrolOverview() {
  const { version } = useAlarms();
  const today = dayKey();
  const { data, loading, error, reload } = useAsync(async () => {
    const now = new Date().toISOString();
    const results = await Promise.all([
      supabase.from('shifts').select('id', { count: 'exact', head: true }).eq('status', 'active').lte('scheduled_start', now).gte('scheduled_end', now),
      supabase.from('alarms').select('id', { count: 'exact', head: true }).neq('status', 'resolved'),
      supabase.from('scans').select('id', { count: 'exact', head: true }).eq('validation', 'flagged').gte('effective_time', dayRange(addDays(today, -1)).from).lt('effective_time', dayRange(today).to),
    ]);
    const counts = results.map((result) => {
      if (result.error) throw result.error;
      if (result.count === null) throw new Error('Could not load the patrol overview. Try again.');
      return result.count;
    });
    return { active: counts[0], alarms: counts[1], review: counts[2], updatedAt: now };
  }, [today, version]);
  useEffect(() => {
    const timer = window.setInterval(() => { if (!document.hidden) void reload({ silent: true }); }, 30000);
    return () => window.clearInterval(timer);
  }, [reload]);

  return <section aria-labelledby="overview-title" className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h2 id="overview-title" className="text-lg">Needs attention</h2><p className="mt-1 text-sm text-muted-foreground">{error ? 'Counts could not be updated.' : data ? `Updated ${formatTime(data.updatedAt)} · Muscat time` : 'Current patrols and follow-up work'}</p></div>
      <Button variant="ghost" icon={RefreshCw} loading={loading} onClick={() => void reload()} aria-label="Refresh patrol overview">Refresh</Button>
    </div>
    <ErrorNote message={error} />
    {loading ? <Spinner label="Loading patrol overview…" /> : !error && data ? <div className="grid gap-3 sm:grid-cols-3">
      <a href="#patrol-activity" className="rounded-xl border border-border bg-card p-4 shadow-sm hover:bg-muted">
        <div className="flex items-center gap-2 text-sm font-medium text-primary"><Radio className="size-5" aria-hidden="true" />Active patrols<ArrowUpRight className="ml-auto size-4" aria-hidden="true" /></div>
        <p className="mt-3 text-3xl font-semibold text-primary">{data.active}</p><p className="mt-1 text-sm text-muted-foreground">Within their scheduled hours</p>
      </a>
      <Link to="/alarms" className="rounded-xl border border-border bg-card p-4 shadow-sm hover:bg-muted">
        <div className="flex items-center gap-2 text-sm font-medium text-primary"><AlertTriangle className="size-5" aria-hidden="true" />Unresolved alarms<ArrowUpRight className="ml-auto size-4" aria-hidden="true" /></div>
        <p className={`mt-3 text-3xl font-semibold ${data.alarms ? 'text-danger-text' : 'text-primary'}`}>{data.alarms}</p><p className="mt-1 text-sm text-muted-foreground">Open and acknowledged · all dates</p>
      </Link>
      <Link to="/scans?validation=flagged" className="rounded-xl border border-border bg-card p-4 shadow-sm hover:bg-muted">
        <div className="flex items-center gap-2 text-sm font-medium text-primary"><ClipboardCheck className="size-5" aria-hidden="true" />Awaiting review<ArrowUpRight className="ml-auto size-4" aria-hidden="true" /></div>
        <p className={`mt-3 text-3xl font-semibold ${data.review ? 'text-warning-text' : 'text-primary'}`}>{data.review}</p><p className="mt-1 text-sm text-muted-foreground">Scans since yesterday · view older dates in Scans</p>
      </Link>
    </div> : null}
  </section>;
}
