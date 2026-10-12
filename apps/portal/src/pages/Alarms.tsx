// Alarms: SOS, missed checkpoints, no-show shifts and rejected scans.
// Workflow: Open -> Acknowledged ("I'm on it") -> Resolved (with a note).
import { BellRing, Check, CheckCheck, MapPin } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Badge, Button, Card, EmptyState, ErrorNote, Field, Modal, PageHeader, Select, Spinner, Table, Td, Textarea } from '@/components/ui';
import { useAlarms } from '@/context/AlarmContext';
import { useAuth } from '@/context/AuthContext';
import { friendlyError } from '@/lib/errors';
import { ALARM_STATUS, ALARM_TYPE, guardName } from '@/lib/labels';
import { supabase } from '@/lib/supabase';
import { formatDateTime } from '@/lib/time';
import type { Alarm, AlarmStatus, AlarmType } from '@/lib/types';
import { unwrap, useAsync } from '@/lib/useAsync';

export default function AlarmsPage() {
  const { profile } = useAuth();
  const { version, refreshCounts } = useAlarms();
  const [status, setStatus] = useState<AlarmStatus | 'unresolved' | 'all'>('unresolved');
  const [type, setType] = useState<AlarmType | 'all'>('all');
  const [resolving, setResolving] = useState<Alarm | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const { data, loading, error, reload } = useAsync(async () => {
    let q = supabase
      .from('alarms')
      .select('*, profiles!alarms_guard_id_fkey(full_name, phone), shifts!alarms_shift_id_fkey(on_duty_name, on_duty_ref)')
      .order('created_at', { ascending: false })
      .limit(300);
    if (status === 'unresolved') q = q.neq('status', 'resolved');
    else if (status !== 'all') q = q.eq('status', status);
    if (type !== 'all') q = q.eq('type', type);
    return unwrap(await q) as Alarm[];
  }, [status, type, version]);

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

  return (
    <>
      <PageHeader title="Alarms" subtitle="New alarms appear here instantly, with a sound and a pop-up." />
      <Card>
        <div className="mb-4 flex flex-wrap gap-3">
          <Field label="Status" className="w-48">
            <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
              <option value="unresolved">Unresolved</option>
              <option value="open">Open</option>
              <option value="acknowledged">Acknowledged</option>
              <option value="resolved">Resolved</option>
              <option value="all">All</option>
            </Select>
          </Field>
          <Field label="Type" className="w-56">
            <Select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
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
        ) : !data?.length ? (
          <EmptyState icon={BellRing} title="No alarms" message="Nothing matches these filters." />
        ) : (
          <Table head={['Raised', 'Type', 'Guard', 'Details', 'Status', '']}>
            {data.map((a) => (
              <tr key={a.id} className={a.type === 'sos' && a.status !== 'resolved' ? 'bg-danger-bg' : ''}>
                <Td className="whitespace-nowrap">{formatDateTime(a.created_at)}</Td>
                <Td><Badge {...ALARM_TYPE[a.type]} /></Td>
                <Td>
                  <p className="font-medium">{guardName(a)}</p>
                  {a.profiles?.phone ? <a className="text-xs underline" href={`tel:${a.profiles.phone}`}>{a.profiles.phone}</a> : null}
                </Td>
                <Td>
                  <p>{a.message}</p>
                  {a.latitude !== null && a.longitude !== null ? (
                    <a
                      className="inline-flex items-center gap-1 text-xs text-primary underline"
                      href={`https://www.openstreetmap.org/?mlat=${a.latitude}&mlon=${a.longitude}#map=19/${a.latitude}/${a.longitude}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <MapPin className="size-3" /> Position (±{Math.round(a.accuracy_m ?? 0)} m)
                    </a>
                  ) : null}
                  {a.resolution_note ? <p className="text-xs text-muted-foreground">Note: {a.resolution_note}</p> : null}
                </Td>
                <Td><Badge {...ALARM_STATUS[a.status]} /></Td>
                <Td className="whitespace-nowrap text-right">
                  {a.status === 'open' ? (
                    <Button size="sm" variant="outline" icon={Check} loading={busy === a.id} onClick={() => void acknowledge(a)}>Acknowledge</Button>
                  ) : null}{' '}
                  {a.status !== 'resolved' ? (
                    <Button size="sm" icon={CheckCheck} onClick={() => { setResolving(a); setNote(''); }}>Resolve</Button>
                  ) : null}
                </Td>
              </tr>
            ))}
          </Table>
        )}
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
