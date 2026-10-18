import { CheckCircle2, ClipboardList, FileDown, Play, ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { ScanDetail } from '@/components/ScanDetail';
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Input, Modal, PageHeader, StatCard, Table, Td } from '@/components/ui';
import { friendlyError } from '@/lib/errors';
import { NIGHTS_NEEDING_ATTENTION, buildReportCsv, coordinates, evidenceTime, nightRows, reportTotals, visitRows, type PatrolReport, type VisitRow } from '@/lib/patrolReport';
import { buildReportPdf } from '@/lib/reportPdf';
import { supabase } from '@/lib/supabase';
import { addDays, dayKey } from '@/lib/time';
import { unwrap } from '@/lib/useAsync';

const PAGE_SIZE = 50;

/** One-tap periods. A patrol belongs to the date it started. */
function quickRanges(today = dayKey()) {
  const firstOfMonth = `${today.slice(0, 8)}01`;
  const endOfLastMonth = addDays(firstOfMonth, -1);
  return [
    { label: 'Today', from: today, to: today },
    { label: 'Yesterday', from: addDays(today, -1), to: addDays(today, -1) },
    { label: 'Last 7 days', from: addDays(today, -6), to: today },
    { label: 'This month', from: firstOfMonth, to: today },
    { label: 'Last month', from: `${endOfLastMonth.slice(0, 8)}01`, to: endOfLastMonth },
  ];
}

export default function ReportsPage() {
  const [from, setFrom] = useState(() => dayKey());
  const [to, setTo] = useState(() => dayKey());
  const [report, setReport] = useState<PatrolReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<VisitRow | null>(null);

  async function run(start = from, end = to) {
    if (!start || !end || start > end) return setError('Choose a valid start and end date.');
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      const result = unwrap(await supabase.rpc('patrol_report', { p_from: start, p_to: end, p_contractor_id: null })) as PatrolReport;
      setReport(result);
      setPage(0);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  // Opening Reports shows today's report straight away, built from every scan; nothing needs to be saved.
  useEffect(() => { void run(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function pick(start: string, end: string) {
    setFrom(start); setTo(end);
    void run(start, end);
  }

  async function download(format: 'pdf' | 'csv') {
    if (!report) return;
    setExporting(true);
    try {
      const filename = `MB_Patrol_${report.from_date}_${report.to_date}`;
      if (format === 'pdf') buildReportPdf(report).save(`${filename}.pdf`);
      else {
        const url = URL.createObjectURL(new Blob([buildReportCsv(report)], { type: 'text/csv;charset=utf-8;' }));
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `${filename}.csv`;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (e) {
      toast.error(friendlyError(e, 'Could not export the report.'));
    } finally {
      setExporting(false);
    }
  }

  const rows = report ? visitRows(report) : [];
  const totals = report ? reportTotals(report) : null;
  const nights = report ? nightRows(report) : [];
  const attention = nights.filter((n) => NIGHTS_NEEDING_ATTENTION.includes(n.status)).length;
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));

  return (
    <>
      <PageHeader title="Patrol reports" subtitle="The daily report is built automatically from every scan, and every scan is kept permanently, so any period can be opened at any time. Visits after midnight stay with the date the patrol started." />
      <Card className="mb-[14px]">
        <div className="mb-3 flex flex-wrap gap-2">
          {quickRanges().map((r) => <Button key={r.label} size="sm" variant={from === r.from && to === r.to ? 'primary' : 'outline'} disabled={busy} onClick={() => pick(r.from, r.to)}>{r.label}</Button>)}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="From date"><Input type="date" disabled={busy} value={from} onChange={(e) => { setFrom(e.target.value); setReport(null); }} /></Field>
          <Field label="To date"><Input type="date" disabled={busy} value={to} min={from} onChange={(e) => { setTo(e.target.value); setReport(null); }} /></Field>
          <Button icon={Play} loading={busy} onClick={() => void run()}>Generate report</Button>
          <Button variant="secondary" icon={FileDown} disabled={!report || exporting} onClick={() => void download('pdf')}>PDF</Button>
          <Button variant="outline" icon={FileDown} disabled={!report || exporting} onClick={() => void download('csv')}>Excel / CSV</Button>
        </div>
        <ErrorNote message={error} />
      </Card>
      {report && totals ? (
        <>
          <p className="mb-4 text-sm text-muted-foreground">Generated {evidenceTime(report.generated_at)} · Muscat time. Only received records are shown; phone uploads may still be pending. Cancelled shifts are excluded from totals.</p>
          <div className="mb-[14px] grid gap-[14px] sm:grid-cols-2 xl:grid-cols-4">
            <StatCard icon={CheckCircle2} label="Verified / required" value={`${totals.verified} / ${totals.required}`} hint={totals.completion === null ? 'No required locations' : `${totals.completion.toFixed(1)}% verified`} />
            <StatCard icon={ShieldAlert} label="Awaiting review" value={totals.review} hint={`${totals.rejected} rejected`} />
            <StatCard icon={ClipboardList} label="Unvisited after shift end" value={totals.unvisited} hint={`${totals.remaining} not yet visited in open shifts`} />
            <StatCard icon={FileDown} label="Missing attachments" value={totals.missingAttachments} hint="Evidence still awaiting upload or recovery" />
          </div>
          <Card title="Days" className="mb-[14px]">
            <p className="mb-3 text-sm">{attention ? `${attention} of ${nights.length} days need a supervisor's explanation: no patrol recorded, missed, or not every location verified.` : 'No days need an explanation.'}</p>
            <Table head={['Date', 'Result', 'Verified / required', 'Guard on duty']}>
              {nights.map((n) => (
                <tr key={n.date}>
                  <Td>{n.date}</Td>
                  <Td><Badge label={n.status} tone={n.status === 'Completed' ? 'brand' : NIGHTS_NEEDING_ATTENTION.includes(n.status) ? 'warning' : 'neutral'} /></Td>
                  <Td>{n.required ? `${n.verified} / ${n.required}` : '–'}</Td>
                  <Td>{n.guards.join(', ') || '–'}</Td>
                </tr>
              ))}
            </Table>
          </Card>
          <Card title="Shift log" className="mb-[14px]">
            <Table head={['Shift date', 'Guard on duty', 'Route', 'Shift status', 'Actual start / end']}>
              {report.shifts.map((s) => (
                <tr key={s.id}>
                  <Td>{s.patrol_date}</Td><Td>{s.guard_name ?? 'Unconfirmed'}<p className="text-xs text-muted-foreground">Login: {s.login_name}</p></Td>
                  <Td>{s.route_name}{!s.checkpoints.length ? <p>No checkpoints configured</p> : null}</Td>
                  <Td>{s.auto_closed_at ? 'Automatically closed; finish unconfirmed' : s.status}</Td>
                  <Td>{evidenceTime(s.actual_start)}<br />{evidenceTime(s.actual_end)}</Td>
                </tr>
              ))}
            </Table>
            {!report.shifts.length ? <p className="py-4">No shifts scheduled in this range.</p> : null}
          </Card>
          <Card title="Required locations">
            <Table head={['Shift date', 'Guard', 'Checkpoint', 'Result', 'Captured / received (Muscat)', 'Position / accuracy', 'Evidence']}>
              {rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((r) => (
                <tr key={`${r.shift.id}:${r.checkpoint.id}`}>
                  <Td>{r.shift.patrol_date}</Td><Td>{r.shift.guard_name ?? 'Unconfirmed'}</Td><Td>{r.checkpoint.name}</Td>
                  <Td><Badge label={r.status} tone={r.status === 'Verified' ? 'brand' : 'neutral'} /></Td>
                  <Td>{evidenceTime(r.scan?.device_time ?? null)}<br />{evidenceTime(r.scan?.server_time ?? null)}</Td>
                  <Td>{coordinates(r.scan)}<br />{r.scan?.accuracy_m == null ? 'Accuracy unknown' : `±${r.scan.accuracy_m} m`}</Td>
                  <Td><Button size="sm" variant="outline" disabled={!r.checkpoint.scans.length} onClick={() => setSelected(r)}>{r.checkpoint.scans.length} scan(s)</Button></Td>
                </tr>
              ))}
            </Table>
            <div className="mt-4 flex items-center justify-end gap-3">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
              <span className="text-sm">Page {page + 1} of {pages} · {rows.length} locations</span>
              <Button variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          </Card>
        </>
      ) : !busy ? <Card><EmptyState icon={ClipboardList} title="Choose your dates" message="Generate a report to review all required locations, including locations without a scan." /></Card> : null}
      <Modal open={Boolean(selected)} wide title={`Evidence · ${selected?.checkpoint.name ?? ''}`} onClose={() => setSelected(null)}>
        {selected?.checkpoint.scans.map((s) => <div key={s.id} className="mb-6 border-b border-border pb-6"><ScanDetail scanId={s.id} onChanged={() => { setSelected(null); void run(); }} /></div>)}
      </Modal>
    </>
  );
}
