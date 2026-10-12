// Monthly report per contractor: preview on screen, download as PDF.
import { BarChart3, CheckCircle2, Clock, FileDown, Play, ShieldAlert, Users } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select, StatCard, Table, Td } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { friendlyError } from '@/lib/errors';
import { SHIFT_STATUS } from '@/lib/labels';
import { buildReportPdf, loadLogo, monthLabel, totals } from '@/lib/reportPdf';
import { supabase } from '@/lib/supabase';
import { dayKey, formatDay, formatTime } from '@/lib/time';
import type { Contractor, DailyLogRow, Incident, ReportRow } from '@/lib/types';
import { unwrap, useAsync } from '@/lib/useAsync';

const pct = (v: number | null) => (v === null ? '–' : `${Number(v).toFixed(1)}%`);

export default function ReportsPage() {
  const { profile } = useAuth();
  const contractors = useAsync(async () => unwrap(await supabase.from('contractors').select('*').order('name')) as Contractor[], []);
  const [contractorId, setContractorId] = useState('');
  const [month, setMonth] = useState(dayKey().slice(0, 7));
  const [rows, setRows] = useState<ReportRow[] | null>(null);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [daily, setDaily] = useState<DailyLogRow[]>([]);
  const [busy, setBusy] = useState(false);

  async function run() {
    if (!contractorId) return toast.error('Choose a contractor.');
    setBusy(true);
    try {
      const args = { p_contractor_id: contractorId, p_month: `${month}-01` };
      const [data, log] = await Promise.all([
        supabase.rpc('contractor_report', args).then((r) => unwrap(r) as ReportRow[]),
        supabase.rpc('daily_patrol_log', args).then((r) => unwrap(r) as DailyLogRow[]),
      ]);
      const guardIds = data.map((r) => r.guard_id);
      // Month boundaries in Muscat time (midnight on the 1st, UTC+4).
      const [y, m] = month.split('-').map(Number);
      const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
      const from = new Date(`${month}-01T00:00:00+04:00`);
      const to = new Date(`${next}-01T00:00:00+04:00`);
      const inc = guardIds.length
        ? (unwrap(
            await supabase
              .from('incidents')
              .select('*, profiles!incidents_guard_id_fkey(full_name), shifts!incidents_shift_id_fkey(on_duty_name, on_duty_ref), checkpoints(name)')
              .in('guard_id', guardIds)
              .gte('created_at', from.toISOString())
              .lt('created_at', to.toISOString())
              .order('created_at'),
          ) as Incident[])
        : [];
      setRows(data);
      setDaily(log);
      setIncidents(inc);
      toast.success('Report ready.');
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  async function download() {
    if (!rows) return;
    const contractor = contractors.data?.find((c) => c.id === contractorId);
    const doc = buildReportPdf({
      contractorName: contractor?.name ?? 'Contractor',
      monthLabel: monthLabel(month),
      rows,
      incidents,
      daily,
      generatedBy: profile?.full_name ?? 'supervisor',
      logoDataUrl: await loadLogo(),
    });
    const safe = (contractor?.name ?? 'contractor').replace(/[^a-z0-9]+/gi, '_');
    doc.save(`MB_Patrol_Report_${safe}_${month}.pdf`);
    toast.success('PDF downloaded.');
  }

  const t = rows ? totals(rows) : null;

  return (
    <>
      <PageHeader title="Monthly reports" subtitle="Completion and punctuality per guard, for one contractor and one month." />
      <Card className="mb-[14px]">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Contractor" className="w-72">
            <Select value={contractorId} onChange={(e) => { setContractorId(e.target.value); setRows(null); }}>
              <option value="">Choose…</option>
              {contractors.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Month" className="w-48">
            <Input type="month" value={month} max={dayKey().slice(0, 7)} onChange={(e) => { setMonth(e.target.value); setRows(null); }} />
          </Field>
          <Button icon={Play} loading={busy} onClick={() => void run()}>Run report</Button>
          <Button variant="secondary" icon={FileDown} disabled={!rows} onClick={() => void download()}>Download PDF</Button>
        </div>
      </Card>

      {!rows ? (
        <Card>
          <EmptyState icon={BarChart3} title="Choose a contractor and month" message="Then press Run report to preview the figures before downloading the PDF." />
        </Card>
      ) : (
        <>
          <div className="mb-[14px] grid gap-[14px] sm:grid-cols-2 xl:grid-cols-4">
            <StatCard icon={CheckCircle2} tone="success" label="Checkpoint completion" value={pct(t!.completion)} hint={`${t!.completed} of ${t!.expected} due`} />
            <StatCard icon={Clock} tone="info" label="Punctuality" value={pct(t!.punctuality)} hint={`${t!.onTime} on time`} />
            <StatCard icon={Users} label="Guards / shifts" value={`${t!.guards} / ${t!.shifts}`} hint={`${t!.shiftsMissed} missed shifts`} />
            <StatCard icon={ShieldAlert} tone="warning" label="Incidents / SOS" value={`${t!.incidents} / ${t!.sos}`} hint={`${t!.rejected} rejected scans`} />
          </div>
          <Card title={`${monthLabel(month)} · daily patrol log`} className="mb-[14px]">
            <Table head={['Date', 'Guard on duty', 'ID', 'Route', 'Status', 'Started / ended', 'Visited', 'On time', 'Incidents', 'SOS']}>
              {daily.map((d) => (
                <tr key={d.shift_id}>
                  <Td className="whitespace-nowrap">{formatDay(`${d.patrol_date}T12:00:00+04:00`)}</Td>
                  <Td className="font-medium">{d.on_duty_name}</Td>
                  <Td>{d.on_duty_ref ?? '–'}</Td>
                  <Td>{d.route_name}</Td>
                  <Td><Badge {...SHIFT_STATUS[d.status]} /></Td>
                  <Td className="whitespace-nowrap text-xs text-muted-foreground">
                    {d.actual_start ? formatTime(d.actual_start) : '–'} / {d.actual_end ? formatTime(d.actual_end) : '–'}
                  </Td>
                  <Td className="font-semibold">{d.visited} / {d.checkpoints_total}</Td>
                  <Td>{d.on_time}</Td>
                  <Td>{d.incidents}</Td>
                  <Td>{d.sos}</Td>
                </tr>
              ))}
            </Table>
            {daily.length === 0 ? <p className="py-4 text-sm text-muted-foreground">No patrols were scheduled in this month.</p> : null}
          </Card>
          <Card title={`${monthLabel(month)} · per login`}>
            <Table head={['Guard', 'Emp. no.', 'Shifts', 'Missed', 'Due', 'Visited', 'Completion', 'Punctuality', 'Incidents', 'SOS', 'Rejected']}>
              {rows.map((r) => (
                <tr key={r.guard_id}>
                  <Td className="font-medium">{r.full_name}</Td>
                  <Td>{r.employee_no ?? '–'}</Td>
                  <Td>{r.shifts}</Td>
                  <Td>{r.shifts_missed}</Td>
                  <Td>{r.expected}</Td>
                  <Td>{r.completed}</Td>
                  <Td className="font-semibold">{pct(r.completion_rate)}</Td>
                  <Td className="font-semibold">{pct(r.punctuality_rate)}</Td>
                  <Td>{r.incidents}</Td>
                  <Td>{r.sos}</Td>
                  <Td>{r.rejected_scans}</Td>
                </tr>
              ))}
            </Table>
            {rows.length === 0 ? <p className="py-4 text-sm text-muted-foreground">This contractor has no guards with activity in this month.</p> : null}
          </Card>
        </>
      )}
    </>
  );
}
