// Alarms: SOS, missed checkpoints, no-show shifts and rejected scans.
// Workflow: Open -> Acknowledged ("I'm on it") -> Resolved (with a note).
import { BellRing, Check, CheckCheck, MapPin } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Badge, Button, Card, EmptyState, ErrorNote, Field, Modal, PageHeader, Select, Spinner, Table, Td, Textarea } from '@/components/ui';
import { Pagination, RECORDS_PER_PAGE } from '@/components/Pagination';
import { useAlarms } from '@/context/AlarmContext';
import { useAuth } from '@/context/AuthContext';
import { friendlyError } from '@/lib/errors';
import { ALARM_STATUS, ALARM_TYPE, guardName } from '@/lib/labels';
import { supabase } from '@/lib/supabase';
import { loadRecordPage } from '@/lib/recordPage';
import { formatDateTime } from '@/lib/time';
import type { Alarm, AlarmStatus, AlarmType } from '@/lib/types';
import { useAsync } from '@/lib/useAsync';

export default function AlarmsPage() {
  const { profile } = useAuth();
  const { version, refreshCounts } = useAlarms();
  const [status, setStatus] = useState<AlarmStatus | 'unresolved' | 'all'>('unresolved');
  const [type, setType] = useState<AlarmType | 'all'>('all');
  const [resolving, setResolving] = useState<Alarm | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  const { data, loading, error, reload } = useAsync(async () => {
    let q = supabase
      .from('alarms')
      .select('*, profiles!alarms_guard_id_fkey(full_name, phone), shifts!alarms_shift_id_fkey(on_duty_name, on_duty_ref)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false });
    if (status === 'unresolved') q = q.neq('status', 'resolved');
    else if (status !== 'all') q = q.eq('status', status);
    if (type !== 'all') q = q.eq('type', type);
    return loadRecordPage<Alarm>((start, end) => q.range(start, end), page * RECORDS_PER_PAGE, RECORDS_PER_PAGE);
  }, [status, type, version, page]);

  async function acknowledge(a: Alarm) {
    setBusy(a.id);
    const { error: e } = await supabase
      .from('alarms')
      .update({ status: 'acknowledged', acknowledged_by: profile!.id, acknowledged_at: new Date().toISOString() })
      .eq('id', a.id);
    setBusy(null);
    if (e) return toast.error(friendlyError(e));
    toast.success('Alarm acknowledged.');
    void reload({ silent: true });
    void refreshCounts();
  }

  async function resolve() {
    if (!resolving) return;
    if (resolving.type === 'sos' && !note.trim()) return toast.error('Add a note describing the outcome of the SOS.');
    setBusy(resolving.id);
    const { error: e } = await supabase
      .from('alarms')
      .update({
        status: 'resolved',
        resolved_by: profile!.id,
        resolved_at: new Date().toISOString(),
        resolution_note: note.trim() || null,
        acknowledged_by: resolving.acknowledged_at ? undefined : profile!.id,
        acknowledged_at: resolving.acknowledged_at ?? new Date().toISOString(),
      })
      .eq('id', resolving.id);
    setBusy(null);
    if (e) return toast.error(friendlyError(e));
    toast.success('Alarm resolved.');
    setResolving(null);
    setNote('');
    void reload({ silent: true });
    void refreshCounts();
  }

  const details = (a: Alarm) => <>
    <p>{a.message}</p>
    {a.latitude !== null && a.longitude !== null ? <a
      className="inline-flex min-h-11 items-center gap-1 text-sm text-primary underline"
      href={`https://www.openstreetmap.org/?mlat=${a.latitude}&mlon=${a.longitude}#map=19/${a.latitude}/${a.longitude}`}
      target="_blank" rel="noreferrer"
    ><MapPin className="size-4" aria-hidden="true" />Position (±{Math.round(a.accuracy_m ?? 0)} m)</a> : null}
    {a.resolution_note ? <p className="mt-1 text-sm text-muted-foreground">Note: {a.resolution_note}</p> : null}
  </>;
  const actions = (a: Alarm) => <div className="flex flex-wrap gap-2">
    {a.status === 'open' ? <Button variant="outline" icon={Check} loading={busy === a.id} disabled={busy !== null} onClick={() => void acknowledge(a)}>Acknowledge</Button> : null}
    {a.status !== 'resolved' ? <Button icon={CheckCheck} disabled={busy !== null} onClick={() => { setResolving(a); setNote(''); }}>Resolve</Button> : null}
  </div>;

  return (
    <>
      <PageHeader title="Alarms" subtitle="Review unresolved alerts and record the action taken. Sound depends on browser permissions and an active connection." />
      <Card>
        <div className="mb-4 flex flex-wrap gap-3">
          <Field label="Status" className="w-48">
            <Select value={status} onChange={(e) => { setStatus(e.target.value as typeof status); setPage(0); }}>
              <option value="unresolved">Unresolved</option>
              <option value="open">Open</option>
              <option value="acknowledged">Acknowledged</option>
              <option value="resolved">Resolved</option>
              <option value="all">All</option>
            </Select>
          </Field>
          <Field label="Type" className="w-56">
            <Select value={type} onChange={(e) => { setType(e.target.value as typeof type); setPage(0); }}>
              <option value="all">All types</option>
              {Object.entries(ALARM_TYPE).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </Select>
          </Field>
        </div>
        <ErrorNote message={error} />
        {loading ? (
          <Spinner />
        ) : error ? <Button variant="outline" onClick={() => void reload()}>Try again</Button> : !data?.rows.length ? (
          <EmptyState icon={BellRing} title="No alarms" message="Nothing matches these filters." />
        ) : (
          <>
          <ul className="divide-y divide-border md:hidden">
            {data.rows.map((a) => <li key={a.id} className={`space-y-3 py-4 ${a.type === 'sos' && a.status !== 'resolved' ? 'rounded-md bg-danger-bg px-3' : ''}`}>
              <div className="flex flex-wrap items-center justify-between gap-2"><Badge {...ALARM_TYPE[a.type]} /><Badge {...ALARM_STATUS[a.status]} /></div>
              <div><p className="font-semibold">{guardName(a)}</p><p className="mt-1 text-sm text-muted-foreground">{formatDateTime(a.created_at)}</p>
                {a.profiles?.phone ? <a className="inline-flex min-h-11 items-center underline" href={`tel:${a.profiles.phone}`}>{a.profiles.phone}</a> : null}
              </div>
              <div className="break-words text-sm">{details(a)}</div>
              {actions(a)}
            </li>)}
          </ul>
          <div className="hidden md:block">
          <Table head={['Raised', 'Type', 'Guard', 'Details', 'Status', 'Actions']}>
            {data.rows.map((a) => (
              <tr key={a.id} className={a.type === 'sos' && a.status !== 'resolved' ? 'bg-danger-bg' : ''}>
                <Td className="whitespace-nowrap">{formatDateTime(a.created_at)}</Td>
                <Td><Badge {...ALARM_TYPE[a.type]} /></Td>
                <Td>
                  <p className="font-medium">{guardName(a)}</p>
                  {a.profiles?.phone ? <a className="text-xs underline" href={`tel:${a.profiles.phone}`}>{a.profiles.phone}</a> : null}
                </Td>
                <Td>
                  {details(a)}
                </Td>
                <Td><Badge {...ALARM_STATUS[a.status]} /></Td>
                <Td className="whitespace-nowrap text-right">
                  {actions(a)}
                </Td>
              </tr>
            ))}
          </Table>
          </div>
          </>
        )}
        <Pagination page={page} total={error ? undefined : data?.total} loading={loading} onPageChange={setPage} />
      </Card>

      <Modal
        open={Boolean(resolving)}
        title="Resolve alarm"
        onClose={() => setResolving(null)}
        footer={
          <>
            <Button variant="outline" onClick={() => setResolving(null)}>Cancel</Button>
            <Button loading={busy === resolving?.id} onClick={() => void resolve()}>Resolve</Button>
          </>
        }
      >
        <p className="mb-3 text-sm">{resolving?.message}</p>
        <Field label={resolving?.type === 'sos' ? 'Outcome (required)' : 'Note (optional)'}>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Called guard; false alarm, phone pressed in pocket." />
        </Field>
      </Modal>
    </>
  );
}
