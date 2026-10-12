// Dashboard: today at a glance.
import { BellRing, CheckCircle2, ShieldAlert, Users } from 'lucide-react';
import { useEffect } from 'react';
import { Link } from 'react-router';

import { BaseMap, CheckpointLayer, FitBounds, GuardLayer, SosLayer } from '@/components/PatrolMap';
import { Badge, Card, ErrorNote, PageHeader, StatCard, Table, Td } from '@/components/ui';
import { useAlarms } from '@/context/AlarmContext';
import { ALARM_STATUS, ALARM_TYPE, SHIFT_STATUS, guardName } from '@/lib/labels';
import { supabase } from '@/lib/supabase';
import { dayKey, dayRange, formatDay, formatTime, relative } from '@/lib/time';
import type { Alarm, Shift } from '@/lib/types';
import { unwrap, useAsync } from '@/lib/useAsync';
import { useLiveData } from '@/lib/useLiveData';

interface Progress { shift_id: string; completed: boolean; due_at: string }

export default function DashboardPage() {
  const { version, openCount, error: alarmError } = useAlarms();
  const live = useLiveData();
  const today = dayKey();

  const { data, error, reload } = useAsync(async () => {
    const { from, to } = dayRange(today);
    const shifts = unwrap(
      await supabase
        .from('shifts')
        .select('id, guard_id, route_id, scheduled_start, scheduled_end, actual_start, actual_end, auto_closed_at, status, notes, on_duty_name, on_duty_ref, profiles!shifts_guard_id_fkey(full_name), routes(name)')
        .lt('scheduled_start', to)
        .gt('scheduled_end', from)
        .neq('status', 'cancelled')
        .order('scheduled_start').returns<Shift[]>(),
    ) as Shift[];
    const ids = shifts.map((s) => s.id);
    const progress = ids.length
      ? (unwrap(await supabase.from('shift_checkpoint_status').select('shift_id, completed, due_at').in('shift_id', ids)) as Progress[])
      : [];
    const alarms = unwrap(
      await supabase
        .from('alarms')
        .select('id, type, guard_id, shift_id, checkpoint_id, scan_id, message, latitude, longitude, accuracy_m, status, acknowledged_at, resolved_at, resolution_note, created_at, profiles!alarms_guard_id_fkey(full_name, phone), shifts!alarms_shift_id_fkey(on_duty_name, on_duty_ref)')
        .neq('status', 'resolved')
        .order('created_at', { ascending: false })
        .limit(8).returns<Alarm[]>(),
    ) as Alarm[];
    const incidentResult = await supabase.from('incidents').select('id', { count: 'exact', head: true }).neq('status', 'resolved');
    if (incidentResult.error) throw incidentResult.error;
    const incidents = incidentResult.count;
    return { shifts, progress, alarms, incidents };
  }, [today, version]);

  useEffect(() => {
    const timer = setInterval(() => void reload({ silent: true }), 30000);
    return () => clearInterval(timer);
  }, [reload]);

  const shifts = data?.shifts ?? [];
  const progress = data?.progress ?? [];
  const due = progress;
  const done = due.filter((p) => p.completed).length;
  const pct = due.length ? Math.round((done / due.length) * 100) : null;
  const active = shifts.filter((s) => s.status === 'active').length;

  const points: [number, number][] = live.checkpoints.map((c) => [c.latitude, c.longitude]);

  return (
    <>
      <PageHeader title="Overview" subtitle={`Today · ${formatDay(new Date())}`} />
      <ErrorNote message={error ?? alarmError ?? live.error} />
      <div className="mb-6 grid gap-[14px] sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Users} label="Guards on shift" value={data ? `${active} / ${shifts.length}` : '–'} hint="active / scheduled today" />
        <StatCard icon={CheckCircle2} tone="success" label="Verified locations" value={pct === null ? '–' : `${pct}%`} hint={`${done} of ${due.length} required across listed shifts`} />
        <StatCard icon={BellRing} tone={openCount ? 'danger' : 'neutral'} label="Open alarms" value={openCount ?? '–'} />
        <StatCard icon={ShieldAlert} tone={data?.incidents ? 'warning' : 'neutral'} label="Open incidents" value={data?.incidents ?? '–'} />
      </div>

      <div className="grid gap-[14px] xl:grid-cols-[1.4fr_1fr]">
        <Card title="Live map" action={<Link to="/live" className="text-sm text-primary underline">Full screen</Link>}>
          <div className="-m-5">
            <BaseMap className="h-[420px] w-full">
              <FitBounds points={points} />
              <CheckpointLayer checkpoints={live.checkpoints} />
              <GuardLayer positions={live.positions} />
              <SosLayer alarms={live.alarms} />
            </BaseMap>
          </div>
        </Card>
        <Card title="Unresolved alarms" action={<Link to="/alarms" className="text-sm text-primary underline">All alarms</Link>}>
          {data?.alarms.length ? (
            <ul className="divide-y divide-border">
              {data.alarms.map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap gap-1">
                      <Badge {...ALARM_TYPE[a.type]} />
                      <Badge {...ALARM_STATUS[a.status]} />
                    </div>
                    <p className="mt-1 text-sm">{a.message}</p>
                    <p className="text-xs text-muted-foreground">{guardName(a)} · {relative(a.created_at)}</p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{data ? 'No unresolved alarms.' : 'Alarm data unavailable.'}</p>
          )}
        </Card>
      </div>

      <Card title="Today's shifts" className="mt-[14px]">
        <Table head={['Guard', 'Route', 'Time', 'Status', 'Progress']}>
          {shifts.map((s) => {
            const rows = progress.filter((p) => p.shift_id === s.id);
            const c = rows.filter((r) => r.completed).length;
            return (
              <tr key={s.id}>
                <Td className="font-medium">{guardName(s)}</Td>
                <Td>{s.routes?.name}</Td>
                <Td>{formatTime(s.scheduled_start)} – {formatTime(s.scheduled_end)}</Td>
                <Td><Badge {...(s.auto_closed_at ? { label: 'Auto-closed; finish unconfirmed', tone: 'neutral' as const } : SHIFT_STATUS[s.status])} /></Td>
                <Td>{c} / {rows.length}</Td>
              </tr>
            );
          })}
        </Table>
        {data && shifts.length === 0 ? <p className="py-4 text-sm text-muted-foreground">No shifts today. Plan them under Schedules.</p> : null}
      </Card>
    </>
  );
}
