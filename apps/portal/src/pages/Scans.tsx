// Paginated scan records and complete filtered CSV exports.
import { ClipboardCheck, Download, Paperclip } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';

import { Pagination, RECORDS_PER_PAGE } from '@/components/Pagination';
import { exportRecords } from '@/lib/exportRecords';
import { friendlyError } from '@/lib/errors';

import { ScanDetail } from '@/components/ScanDetail';
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td } from '@/components/ui';
import { FLAG_LABELS, VALIDATION, guardName } from '@/lib/labels';
import { csvCell } from '@/lib/patrolReport';
import { supabase } from '@/lib/supabase';
import { loadRecordPage } from '@/lib/recordPage';
import { addDays, dayKey, dayRange, formatDateTime } from '@/lib/time';
import type { Profile, Scan } from '@/lib/types';
import { unwrap, useAsync } from '@/lib/useAsync';

export default function ScansPage() {
  const [searchParams] = useSearchParams();
  const [from, setFrom] = useState(addDays(dayKey(), -1));
  const [to, setTo] = useState(dayKey());
  const [guard, setGuard] = useState('all');
  const [validation, setValidation] = useState(() => {
    const initial = searchParams.get('validation');
    return initial && ['valid', 'flagged', 'rejected'].includes(initial) ? initial : 'all';
  });
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const guards = useAsync(async () => unwrap(await supabase.from('profiles').select('id, full_name').eq('role', 'guard').order('full_name')) as Profile[], []);

  function scanQuery() {
    let q = supabase
      .from('scans')
      .select('*, profiles!scans_guard_id_fkey(full_name), shifts!scans_shift_id_fkey(on_duty_name, on_duty_ref), checkpoints(name), scan_attachments(id, type)', { count: 'exact' })
      .gte('effective_time', dayRange(from).from)
      .lt('effective_time', dayRange(to).to)
      .order('effective_time', { ascending: false })
      .order('id', { ascending: false });
    if (guard !== 'all') q = q.eq('guard_id', guard);
    if (validation !== 'all') q = q.eq('validation', validation);
    if (status !== 'all') q = q.eq('status', status);
    return q;
  }

  async function fetchPage(offset: number, size: number) {
    return loadRecordPage<Scan>((start, end) => scanQuery().range(start, end), offset, size);
  }

  const { data, loading, error, reload } = useAsync(
    () => fetchPage(page * RECORDS_PER_PAGE, RECORDS_PER_PAGE),
    [from, to, guard, validation, status, page],
  );

  /** CSV export: opens in Excel. */
  async function exportCsv() {
    setExporting(true);
    try {
      const scans = await exportRecords(fetchPage);
      const rows = [
        ['Time (Muscat)', 'Guard', 'Checkpoint', 'Method', 'Status', 'Verdict', 'On time', 'Distance m', 'GPS accuracy m', 'Flags', 'Note'],
        ...scans.map((s) => [
          formatDateTime(s.effective_time), guardName(s), s.checkpoints?.name ?? '', s.method, s.status, s.validation,
          s.is_on_time === null ? '' : s.is_on_time ? 'Yes' : 'No', s.distance_m ?? '', s.accuracy_m ?? '', s.flags.join(' '), s.note ?? '',
        ]),
      ];
      const csv = rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
      const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: `scans_${from}_${to}.csv` });
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`${scans.length} scans exported.`);
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <PageHeader title="Scan records" subtitle="Browse all matching scans. CSV exports include every record matching your filters." actions={<Button variant="outline" icon={Download} onClick={() => void exportCsv()} loading={exporting} disabled={loading || Boolean(error) || !data?.total}>Export CSV</Button>} />
      <Card>
        <fieldset disabled={exporting} className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <legend className="sr-only">Filter scan records</legend>
          <Field label="From"><Input type="date" value={from} max={to} onChange={(e) => { setFrom(e.target.value); setPage(0); }} /></Field>
          <Field label="To"><Input type="date" value={to} min={from} onChange={(e) => { setTo(e.target.value); setPage(0); }} /></Field>
          <Field label="Guard">
            <Select value={guard} onChange={(e) => { setGuard(e.target.value); setPage(0); }}>
              <option value="all">All guards</option>
              {guards.data?.map((g) => <option key={g.id} value={g.id}>{g.full_name}</option>)}
            </Select>
          </Field>
          <Field label="Verdict">
            <Select value={validation} onChange={(e) => { setValidation(e.target.value); setPage(0); }}>
              <option value="all">All</option>
              <option value="valid">Valid</option>
              <option value="flagged">Flagged</option>
              <option value="rejected">Rejected</option>
            </Select>
          </Field>
          <Field label="Report type">
            <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }}>
              <option value="all">All</option>
              <option value="normal">Normal</option>
              <option value="issue">Issue found</option>
            </Select>
          </Field>
        </fieldset>
        <ErrorNote message={error} />
        {loading ? (
          <Spinner />
        ) : error ? <Button variant="outline" onClick={() => void reload()}>Try again</Button> : !data?.rows.length ? (
          <EmptyState icon={ClipboardCheck} title="No scans in this period" />
        ) : (
          <>
            <Table head={['Time', 'Guard', 'Checkpoint', 'Type', 'Verdict', 'Flags', 'Attachments', 'Actions']}>
              {data.rows.map((s) => (
                <tr key={s.id} className="hover:bg-muted">
                  <Td className="whitespace-nowrap">{formatDateTime(s.effective_time)}</Td>
                  <Td>{guardName(s)}</Td>
                  <Td>{s.checkpoints?.name}</Td>
                  <Td>{s.status === 'issue' ? <Badge label="Issue" tone="danger" /> : <Badge label="Normal" />}</Td>
                  <Td><Badge {...VALIDATION[s.validation]} /></Td>
                  <Td className="text-xs text-muted-foreground">{s.flags.map((f) => FLAG_LABELS[f] ?? f).join(', ')}</Td>
                  <Td className="text-muted-foreground">
                    {s.scan_attachments?.length ? <span className="inline-flex items-center gap-1 text-xs"><Paperclip className="size-3" />{s.scan_attachments.length}</span> : null}
                  </Td>
                  <Td><Button size="sm" variant="outline" aria-label={`View scan details for ${s.checkpoints?.name ?? 'checkpoint'} at ${formatDateTime(s.effective_time)}`} onClick={() => setOpenId(s.id)}>View details</Button></Td>
                </tr>
              ))}
            </Table>
          </>
        )}
        <Pagination page={page} total={error ? undefined : data?.total} loading={loading} onPageChange={setPage} />
      </Card>
      <Modal open={Boolean(openId)} wide title="Scan details" onClose={() => setOpenId(null)}>
        {openId ? <ScanDetail scanId={openId} onChanged={() => void reload({ silent: true })} /> : null}
      </Modal>
    </>
  );
}
