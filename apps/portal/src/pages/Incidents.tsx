// Incidents: created automatically when a guard reports "Issue found".
import { ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { ScanDetail } from '@/components/ScanDetail';
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Modal, PageHeader, Select, Spinner, Table, Td, Textarea } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { friendlyError } from '@/lib/errors';
import { INCIDENT_STATUS, SEVERITY } from '@/lib/labels';
import { supabase } from '@/lib/supabase';
import { formatDateTime } from '@/lib/time';
import type { Incident, IncidentSeverity, IncidentStatus } from '@/lib/types';
import { unwrap, useAsync } from '@/lib/useAsync';

export default function IncidentsPage() {
  const { profile } = useAuth();
  const [filter, setFilter] = useState<IncidentStatus | 'unresolved' | 'all'>('unresolved');
  const [editing, setEditing] = useState<Incident | null>(null);
  const [form, setForm] = useState({ status: 'open' as IncidentStatus, severity: 'medium' as IncidentSeverity, note: '' });
  const [saving, setSaving] = useState(false);

  const { data, loading, error, reload } = useAsync(async () => {
    let q = supabase
      .from('incidents')
      .select('*, profiles!incidents_guard_id_fkey(full_name), checkpoints(name)')
      .order('created_at', { ascending: false })
      .limit(300);
    if (filter === 'unresolved') q = q.neq('status', 'resolved');
    else if (filter !== 'all') q = q.eq('status', filter);
    return unwrap(await q) as Incident[];
  }, [filter]);

  function open(i: Incident) {
    setEditing(i);
    setForm({ status: i.status, severity: i.severity, note: i.resolution_note ?? '' });
  }

  async function save() {
    if (!editing) return;
    if (form.status === 'resolved' && !form.note.trim()) return toast.error('Add a resolution note.');
    setSaving(true);
    const resolved = form.status === 'resolved';
    const { error: e } = await supabase
      .from('incidents')
      .update({
        status: form.status,
        severity: form.severity,
        resolution_note: form.note.trim() || null,
        resolved_by: resolved ? profile!.id : null,
        resolved_at: resolved ? new Date().toISOString() : null,
      })
      .eq('id', editing.id);
    setSaving(false);
    if (e) return toast.error(friendlyError(e));
    toast.success('Incident updated.');
    setEditing(null);
    void reload({ silent: true });
  }

  return (
    <>
      <PageHeader title="Incidents" subtitle="Issues reported by guards at checkpoints, with their photos and voice memos." />
      <Card>
        <Field label="Show" className="mb-4 w-48">
          <Select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
            <option value="unresolved">Unresolved</option>
            <option value="open">Open</option>
            <option value="in_progress">In progress</option>
            <option value="resolved">Resolved</option>
            <option value="all">All</option>
          </Select>
        </Field>
        <ErrorNote message={error} />
        {loading ? (
          <Spinner />
        ) : !data?.length ? (
          <EmptyState icon={ShieldAlert} title="No incidents" />
        ) : (
          <Table head={['Reported', 'Checkpoint', 'Guard', 'Description', 'Severity', 'Status', '']}>
            {data.map((i) => (
              <tr key={i.id}>
                <Td className="whitespace-nowrap">{formatDateTime(i.created_at)}</Td>
                <Td>{i.checkpoints?.name}</Td>
                <Td>{i.profiles?.full_name}</Td>
                <Td className="max-w-md">{i.description}</Td>
                <Td><Badge {...SEVERITY[i.severity]} /></Td>
                <Td><Badge {...INCIDENT_STATUS[i.status]} /></Td>
                <Td className="text-right"><Button size="sm" variant="outline" onClick={() => open(i)}>Open</Button></Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Modal
        open={Boolean(editing)}
        wide
        title={`Incident · ${editing?.checkpoints?.name ?? ''}`}
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(null)}>Close</Button>
            <Button loading={saving} onClick={() => void save()}>Save</Button>
          </>
        }
      >
        {editing ? (
          <div className="space-y-4">
            <p className="rounded-md bg-muted p-3">{editing.description}</p>
            {editing.scan_id ? <ScanDetail scanId={editing.scan_id} /> : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Severity">
                <Select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value as IncidentSeverity })}>
                  {Object.entries(SEVERITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </Select>
              </Field>
              <Field label="Status">
                <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as IncidentStatus })}>
                  {Object.entries(INCIDENT_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </Select>
              </Field>
            </div>
            <Field label="Action taken / resolution note">
              <Textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </Field>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
