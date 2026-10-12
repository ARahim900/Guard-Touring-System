import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';

import { coordinates, evidenceTime, reportTotals, visitRows, type PatrolReport } from './patrolReport';

const PRIMARY: [number, number, number] = [78, 68, 86];
const TEAL: [number, number, number] = [164, 197, 187];

export function buildReportPdf(report: PatrolReport): jsPDF {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const totals = reportTotals(report);
  const width = doc.internal.pageSize.getWidth();
  doc.setFillColor(...PRIMARY);
  doc.rect(0, 0, width, 25, 'F');
  doc.setTextColor(255);
  doc.setFontSize(16);
  doc.text('Muscat Bay | Night patrol report', 14, 12);
  doc.setFontSize(10);
  doc.text(`${report.from_date} to ${report.to_date} | ${report.contractor_name ?? 'All contractors'} | Muscat time (UTC+4)`, 14, 20);
  doc.setTextColor(...PRIMARY);
  doc.setFontSize(10);
  doc.text(`Required: ${totals.required}   Verified: ${totals.verified}   Awaiting review: ${totals.review}   Rejected: ${totals.rejected}   Unvisited: ${totals.unvisited}`, 14, 34);
  doc.text('One verified visit per checkpoint per shift. Pending phone uploads are not visible until received.', 14, 41);
  doc.text(`Not yet visited (shift still open): ${totals.remaining} | Missing attachments: ${totals.missingAttachments}`, 14, 48);
  autoTable(doc, {
    startY: 55,
    head: [['Shift date', 'Guard on duty / login', 'Route', 'Status', 'Scheduled start / end', 'Actual start / end']],
    body: report.shifts.map((s) => [s.patrol_date, `${s.guard_name ?? 'Unconfirmed'} / ${s.login_name}`, s.route_name,
      s.auto_closed_at ? 'Auto-closed; finish unconfirmed' : s.status,
      `${evidenceTime(s.scheduled_start)}\n${evidenceTime(s.scheduled_end)}`,
      `${evidenceTime(s.actual_start)}\n${evidenceTime(s.actual_end)}`]),
    styles: { fontSize: 8, cellPadding: 2 }, headStyles: { fillColor: PRIMARY },
    margin: { bottom: 20 },
  });
  doc.addPage();
  doc.setFontSize(13);
  doc.text('Required locations and visit evidence', 14, 14);
  autoTable(doc, {
    startY: 20,
    head: [['Shift date', 'Guard', 'Checkpoint', 'Result / scans', 'Captured / received', 'GPS coordinates / accuracy', 'Issue notes']],
    body: visitRows(report).map(({ shift: s, checkpoint: c, scan, status }) => [
      s.patrol_date, s.guard_name ?? 'Unconfirmed', c.name, `${status} / ${c.scans.length}`,
      `${evidenceTime(scan?.device_time ?? null)}\n${evidenceTime(scan?.server_time ?? null)}`,
      `${coordinates(scan)}\n${scan?.accuracy_m === null || scan?.accuracy_m === undefined ? 'Unknown' : `+/- ${scan.accuracy_m} m`}`,
      c.scans.filter((x) => x.status === 'issue').map((x) => x.note ?? '').join('\n'),
    ]),
    styles: { fontSize: 8, cellPadding: 2 }, headStyles: { fillColor: PRIMARY },
    alternateRowStyles: { fillColor: [247, 248, 249] }, margin: { bottom: 20 },
  });
  for (let p = 1; p <= doc.getNumberOfPages(); p++) {
    doc.setPage(p);
    const height = doc.internal.pageSize.getHeight();
    doc.setDrawColor(...TEAL);
    doc.line(14, height - 14, width - 14, height - 14);
    doc.setFontSize(8);
    doc.text(`Generated ${evidenceTime(report.generated_at)} | Original times retained; unknown readings remain unknown.`, 14, height - 8);
    doc.text(`${p} / ${doc.getNumberOfPages()}`, width - 14, height - 8, { align: 'right' });
  }
  return doc;
}
