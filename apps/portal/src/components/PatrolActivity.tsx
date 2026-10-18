import { ClipboardList, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Button, ErrorNote, Field, Select, Spinner } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { addDays, dayKey, dayRange, formatDay, formatTime } from '@/lib/time';
import { unwrap, useAsync } from '@/lib/useAsync';

interface Patrol {
  id: string;
  on_duty_name: string | null;
  scheduled_start: string;
  scheduled_end: string;
  status: string;
}
interface Visit { shift_id: string; completed: boolean; validation: string | null }

export function PatrolActivity({ names }: { names: string[] }) {
  const [guard, setGuard] = useState('');
  const today = dayKey();
  const { data, loading, error, reload } = useAsync(async () => {
    const { from } = dayRange(addDays(today, -6));
    let query = supabase.from('shifts')
      .select('id, on_duty_name, scheduled_start, scheduled_end, status')
      .gte('scheduled_start', from).lte('scheduled_start', new Date().toISOString())
      .neq('status', 'cancelled').order('scheduled_start', { ascending: false });
    if (guard) query = query.eq('on_duty_name', guard);
    const shifts = unwrap(await query.returns<Patrol[]>());
    const visits = shifts.length ? unwrap(await supabase.from('shift_checkpoint_status')
      .select('shift_id, completed, validation').in('shift_id', shifts.map((shift) => shift.id)).returns<Visit[]>()) : [];
    return { shifts, visits };
  }, [guard, today]);

  useEffect(() => {
    const timer = window.setInterval(() => { if (!document.hidden) void reload({ silent: true }); }, 30000);
    return () => window.clearInterval(timer);
  }, [reload]);

  return <section className="overflow-hidden rounded-xl border border-border bg-card">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-5">
      <div><h2 className="text-lg">Patrol activity</h2><p className="mt-1 text-sm text-muted-foreground">Last 7 days · Muscat time</p></div>
      <Button type="button" variant="ghost" icon={RefreshCw} aria-label="Refresh patrol activity" loading={loading} onClick={() => void reload({ silent: true })}>Refresh</Button>
    </div>
    <div className="space-y-4 p-5">
      <Field label="View guard"><Select className="min-h-12 text-base" value={guard} onChange={(event) => setGuard(event.target.value)}>
        <option value="">All guards</option>
        {names.map((name) => <option key={name} value={name}>{name}</option>)}
      </Select></Field>
      <ErrorNote message={error} />
      {loading ? <Spinner label="Loading patrol activity…" /> : !error && data ? (
        data.shifts.length ? <ul className="divide-y divide-border">{data.shifts.map((shift) => {
          const visits = data.visits.filter((visit) => visit.shift_id === shift.id);
          const done = visits.filter((visit) => visit.completed).length;
          const review = visits.filter((visit) => !visit.completed && visit.validation === 'flagged').length;
          const ended = Date.parse(shift.scheduled_end) < Date.now();
          const label = shift.status === 'completed' && !ended ? 'Completed' : shift.status === 'active' && !ended ? 'In progress' : !ended ? 'Not started' : 'Shift ended';
          return <li key={shift.id} className="space-y-3 py-4 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold">{shift.on_duty_name ?? 'Guard not confirmed'}</p><span className="rounded-full bg-secondary-light px-3 py-1 text-xs font-medium text-primary">{label}</span></div>
            <p className="text-sm text-muted-foreground">{formatDay(shift.scheduled_start)} · {formatTime(shift.scheduled_start)}–{formatTime(shift.scheduled_end)}</p>
            <div className="flex justify-between gap-3 text-sm"><span>{done} of {visits.length} locations verified</span>{review ? <span>{review} to review</span> : null}</div>
            {visits.length ? <progress aria-label={`Verified locations for ${shift.on_duty_name ?? 'unconfirmed guard'} on ${formatDay(shift.scheduled_start)}`} value={done} max={visits.length} className="h-2 w-full overflow-hidden rounded-full appearance-none [&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-primary [&::-moz-progress-bar]:bg-primary" /> : <p className="text-sm text-muted-foreground">No locations were included in this patrol.</p>}
            {ended && visits.length > done ? <p className="text-sm text-primary">{visits.length - done} location{visits.length - done === 1 ? '' : 's'} not verified before shift end.</p> : null}
          </li>;
        })}</ul> : <div className="rounded-lg bg-muted px-4 py-6 text-center">
          <ClipboardList className="mx-auto mb-3 size-7 text-primary" aria-hidden="true" />
          <p className="font-medium">{guard ? `No patrols recorded for ${guard}` : 'No patrol activity yet'}</p>
          <p className="mt-1 text-sm text-muted-foreground">{guard ? 'Choose another guard or use Reports for older dates.' : 'Scans and visit progress will appear here once the team starts patrolling.'}</p>
        </div>
      ) : null}
      <Link to="/reports" className="inline-flex min-h-11 items-center text-sm font-semibold text-primary underline underline-offset-4">View reports for any date range</Link>
    </div>
  </section>;
}
