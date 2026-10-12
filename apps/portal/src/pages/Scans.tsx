// Scan records with filters. Click a row to see the full evidence.
import { ClipboardCheck, Download, Paperclip } from 'lucide-react';
import { useState } from 'react';

import { ScanDetail } from '@/components/ScanDetail';
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td } from '@/components/ui';
import { FLAG_LABELS, VALIDATION } from '@/lib/labels';
import { supabase } from '@/lib/supabase';
import { addDays, dayKey, dayRange, formatDateTime } from '@/lib/time';
import type { Profile, Scan } from '@/lib/types';
import { unwrap, useAsync } from '@/lib/useAsync';

export default function ScansPage() {
  const [from, setFrom] = useState(addDays(dayKey(), -1));
  const [to, setTo] = useState(dayKey());
  const [guard, setGuard] = useState('all');
  const [validation, setValidation] = useState('all');
  const [status, setStatus] = useState('all');
  const [openId, setOpenId] = useState<string | null>(null);

  const guards = useAsync(async () => unwrap(await supabase.from('profiles').select('id, full_name').eq('role', 'guard').order('full_name')) as Profile[], []);

  const { data, loading, error, reload } = useAsync(async () => {
    let q = supabase
      .from('scans')
      .select('*, profiles!scans_guard_id_fkey(full_name), checkpoints(name), scan_attachments(id, type)')
      .gte('effective_time', dayRange(from).from)
      .lt('effective_time', dayRange(to).to)
      .order('effective_time', { ascending: false })
      .limit(1000);
    if (guard !== 'all') q = q.eq('guard_id', guard);
    if (validation !== 'all') q = q.eq('validation', validation);
    if (status !== 'all') q = q.eq('status', status);
    return unwrap(await q) as Scan[];
  }, [from, to, guard, validation, status]);

  /** CSV export: opens in Excel. */
  function exportCsv() {
    const rows = [
      ['Time (Muscat)', 'Guard', 'Checkpoint', 'Method', 'Status', 'Verdict', 'On time', 'Distance m', 'GPS accuracy m', 'Flags', 'Note'],
      ...(data ?? []).map((s) => [
        formatDateTime(s.effective_time), s.profiles?.full_name ?? '', s.checkpoints?.name ?? '', s.method, s.status, s.validation,
        s.is_on_time === null ? '' : s.is_on_time ? 'Yes' : 'No', s.distance_m ?? '', s.accuracy_m ?? '', s.flags.join(' '), s.note ?? '',
      ]),
    ];
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `scans_${from}_${to}.csv` });
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <PageHeader title="Scan records" actions={<Button variant="outline" icon={Download} onClick={exportCsv} disabled={!data?.length}>Export CSV</Button>} />
      <Card>
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="From"><Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
          <Field label="Guard">
            <Select value={guard} onChange={(e) => setGuard(e.target.value)}>
              <option value="all">All guards</option>
              {guards.data?.map((g) => <option key={g.id} value={g.id}>{g.full_name}</option>)}
            </Select>
          </Field>
          <Field label="Verdict">
            <Select value={validation} onChange={(e) => setValidation(e.target.value)}>
              <option value="all">All</option>
              <option value="valid">Valid</option>
              <option value="flagged">Flagged</option>
              <option value="rejected">Rejected</option>
            </Select>
          </Field>
          <Field label="Report type">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="all">All</option>
              <option value="normal">Normal</option>
              <option value="issue">Issue found</option>
            </Select>
          </Field>
        </div>
        <ErrorNote message={error} />
        {loading ? (
          <Spinner />
        ) : !data?.length ? (
          <EmptyState icon={ClipboardCheck} title="No scans in this period" />
        ) : (
          <>
            <p className="mb-2 text-xs text-muted-foreground">{data.length} scans{data.length === 1000 ? ' (first 1,000; narrow the dates to see more)' : ''}</p>
            <Table head={['Time', 'Guard', 'Checkpoint', 'Type', 'Verdict', 'Flags', '']}>
              {data.map((s) => (
                <tr key={s.id} className="cursor-pointer hover:bg-muted" onClick={() => setOpenId(s.id)}>
                  <Td className="whitespace-nowrap">{formatDateTime(s.effective_time)}</Td>
                  <Td>{s.profiles?.full_name}</Td>
                  <Td>{s.checkpoints?.name}</Td>
                  <Td>{s.status === 'issue' ? <Badge label="Issue" tone="danger" /> : <Badge label="Normal" />}</Td>
                  <Td><Badge {...VALIDATION[s.validation]} /></Td>
                  <Td className="text-xs text-muted-foreground">{s.flags.map((f) => FLAG_LABELS[f] ?? f).join(', ')}</Td>
                  <Td className="text-muted-foreground">
                    {s.scan_attachments?.length ? <span className="inline-flex items-center gap-1 text-xs"><Paperclip className="size-3" />{s.scan_attachments.length}</span> : null}
                  </Td>
                </tr>
              ))}
            </Table>
          </>
        )}
      </Card>
      <Modal open={Boolean(openId)} wide title="Scan details" onClose={() => setOpenId(null)}>
        {openId ? <ScanDetail scanId={openId} onChanged={() => void reload({ silent: true })} /> : null}
      </Modal>
    </>
  );
}
