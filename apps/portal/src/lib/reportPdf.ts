import { jsPDF } from 'jspdf';
import { autoTable, type CellHookData } from 'jspdf-autotable';

import { FLAG_LABELS } from './labels';
import {
  NIGHTS_NEEDING_ATTENTION, accuracy, coordinates, guardOnDuty, nightRows, patrolOpen, patrolResult,
  reportTotals, visitRows, type NightRow, type PatrolReport, type VisitRow, type VisitStatus,
} from './patrolReport';

type RGB = [number, number, number];
const PRIMARY: RGB = [78, 68, 86];
const TEAL: RGB = [164, 197, 187];
const GREY: RGB = [107, 114, 128];
const LINE: RGB = [229, 231, 235];
// Text and background for each result, from the portal's badge colours.
const GOOD = { text: [13, 92, 56] as RGB, fill: [232, 241, 239] as RGB };
const BAD = { text: [127, 29, 29] as RGB, fill: [254, 242, 242] as RGB };
const WAIT = { text: [122, 82, 0] as RGB, fill: [254, 252, 232] as RGB };
const PLAIN = { text: [55, 65, 81] as RGB, fill: [243, 244, 246] as RGB };
const MARGIN = 14;

const RESULT_TONE: Record<string, typeof GOOD> = {
  Verified: GOOD, Completed: GOOD,
  Missed: BAD, Rejected: BAD, Absent: BAD, Incomplete: BAD,
  Pending: WAIT, 'Awaiting review': WAIT, 'In progress': WAIT, 'Not started': WAIT,
};
const tone = (result: string) => RESULT_TONE[result] ?? PLAIN;

const dayFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
const longDayFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const stampFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Muscat', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const timeFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Muscat', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
/** 2026-10-19 → 19 Oct 2026 */
const day = (date: string) => dayFormat.format(new Date(`${date}T00:00:00Z`));
/** A scan or patrol time → 19 Oct, 12:59 (Muscat) */
const at = (value: string | null) => value ? timeFormat.format(new Date(value)) : '–';

function duration(from: string | null, to: string | null): string {
  if (!from || !to) return '–';
  const minutes = Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60000));
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
}

/** One plain sentence explaining a day's result. */
function dayRemark(n: NightRow): string {
  const missed = n.required - n.verified;
  switch (n.status) {
    case 'Completed': return `All ${n.required} locations verified.`;
    case 'Incomplete': return `${missed} of ${n.required} locations missed.`;
    case 'In progress': return `Patrol in progress: ${missed} of ${n.required} locations still to be scanned.`;
    case 'Absent': return 'No patrol was carried out on this day.';
    case 'Missed': return 'The planned patrol was not started.';
    case 'Not started': return 'No patrol has started yet today.';
    case 'Cancelled': return 'The patrol was cancelled.';
    case 'Upcoming': return 'This day has not started yet.';
  }
}

/** Notes worth a supervisor's attention for one location. */
function visitNotes(row: VisitRow): string {
  const notes = row.checkpoint.scans.filter((s) => s.status === 'issue' && s.note).map((s) => `Issue: ${s.note}`);
  if (row.scan && row.scan.validation !== 'valid') notes.push(...row.scan.flags.map((f) => FLAG_LABELS[f] ?? f));
  if (row.scan?.review_note) notes.push(`Supervisor: ${row.scan.review_note}`);
  const missing = row.checkpoint.scans.reduce((n, s) => n + Math.max(0, s.expected_attachments - s.attachment_count), 0);
  if (missing) notes.push(`${missing} photo${missing === 1 ? '' : 's'} not uploaded`);
  return notes.join('\n');
}

const VISIT_ORDER: Record<VisitStatus, number> = { Verified: 0, 'Awaiting review': 1, Rejected: 2, Missed: 3, Pending: 4, Cancelled: 5 };

let logo: Promise<string | null> | null = null;
/** The Muscat Bay logo as a data URL for the report header (null when it cannot be loaded). */
export function loadReportLogo(): Promise<string | null> {
  logo ??= fetch('/muscat-bay-logo.png')
    .then((res) => (res.ok ? res.blob() : null))
    .then((blob) => blob && new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    }))
    .catch(() => null)
    .then((url) => { if (!url) logo = null; return url; });
  return logo;
}

export function buildReportPdf(report: PatrolReport, logoUrl: string | null = null): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const right = width - MARGIN;
  const totals = reportTotals(report);
  const nights = nightRows(report);
  const rows = visitRows(report);
  const attention = nights.filter((n) => NIGHTS_NEEDING_ATTENTION.includes(n.status)).length;
  const singleDay = report.from_date === report.to_date;
  const lastY = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  const table = { theme: 'grid' as const, rowPageBreak: 'avoid' as const, margin: { top: 18, bottom: 24, left: MARGIN, right: MARGIN },
    styles: { fontSize: 8, cellPadding: 2, lineColor: LINE, lineWidth: 0.2, textColor: [31, 41, 55] as RGB, valign: 'middle' as const },
    headStyles: { fillColor: PRIMARY, textColor: 255, fontStyle: 'bold' as const } };
  /** Colours the result column of a table. */
  const colourResult = (column: number) => (data: CellHookData) => {
    if (data.section !== 'body' || data.column.index !== column) return;
    const t = tone(String(data.cell.raw));
    data.cell.styles.textColor = t.text;
    data.cell.styles.fillColor = t.fill;
    data.cell.styles.fontStyle = 'bold';
  };
  /** A section title, starting a new page when there is no room for its first rows. */
  function heading(title: string, y: number, room = 40): number {
    if (y > height - 24 - room) { doc.addPage(); y = 20; }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11.5);
    doc.setTextColor(...PRIMARY);
    doc.text(title, MARGIN, y);
    doc.setFont('helvetica', 'normal');
    return y + 3;
  }

  // Header: the Muscat Bay logo on the left, the report title on the right.
  if (logoUrl) doc.addImage(logoUrl, 'PNG', MARGIN, 9, 30, 18);
  else { doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(...PRIMARY); doc.text('MUSCAT BAY', MARGIN, 20); }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(...PRIMARY);
  doc.text('Security Patrol Report', right, 15, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(singleDay ? longDayFormat.format(new Date(`${report.from_date}T00:00:00Z`)) : `${day(report.from_date)} to ${day(report.to_date)}`, right, 21.5, { align: 'right' });
  doc.setFontSize(8);
  doc.setTextColor(...GREY);
  doc.text('All times are Muscat time (UTC+4)', right, 26.5, { align: 'right' });
  doc.setDrawColor(...TEAL);
  doc.setLineWidth(0.8);
  doc.line(MARGIN, 31, right, 31);

  // Overall result.
  const completed = nights.filter((n) => n.status === 'Completed').length;
  const headline = singleDay && nights[0] ? nights[0].status
    : attention ? `${attention} day${attention === 1 ? '' : 's'} need attention` : 'No exceptions';
  const summary = singleDay && nights[0] ? dayRemark(nights[0])
    : `${completed} of ${nights.length} days completed in full. ${attention ? 'Days that were absent, missed or incomplete are listed below.' : ''}`;
  const overall = singleDay && nights[0] ? tone(nights[0].status) : attention ? BAD : GOOD;
  doc.setFillColor(...overall.fill);
  doc.roundedRect(MARGIN, 36, right - MARGIN, 18, 2, 2, 'F');
  doc.setFontSize(7.5);
  doc.setTextColor(...GREY);
  doc.text('OVERALL RESULT', MARGIN + 5, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...overall.text);
  doc.text(headline, MARGIN + 5, 49.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(31, 41, 55);
  doc.text(doc.splitTextToSize(summary, 78), MARGIN + 72, 44.5);
  doc.setFontSize(7.5);
  doc.setTextColor(...GREY);
  doc.text('COMPLETION', right - 5, 42, { align: 'right' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(...PRIMARY);
  doc.text(totals.completion === null ? '–' : `${Math.round(totals.completion)}%`, right - 5, 50, { align: 'right' });

  // Key figures.
  const tiles: [string, number, typeof GOOD][] = [
    ['Locations required', totals.required, PLAIN], ['Verified', totals.verified, GOOD], ['Missed', totals.missed, BAD],
    ['Pending', totals.pending, WAIT], ['Awaiting review', totals.review, WAIT], ['Rejected', totals.rejected, BAD],
  ];
  const gap = 3;
  const tileWidth = (right - MARGIN - gap * (tiles.length - 1)) / tiles.length;
  tiles.forEach(([label, value, t], i) => {
    const x = MARGIN + i * (tileWidth + gap);
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.3);
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(x, 59, tileWidth, 18, 1.5, 1.5, 'FD');
    doc.setFillColor(...(value ? t.text : LINE));
    doc.rect(x, 59.6, 1.2, 16.8, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.setTextColor(...(value && t !== PLAIN ? t.text : PRIMARY));
    doc.text(String(value), x + tileWidth / 2, 68, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...GREY);
    doc.text(label, x + tileWidth / 2, 73.5, { align: 'center' });
  });

  // 1. Daily summary.
  autoTable(doc, {
    ...table,
    startY: heading('Daily summary', 87),
    head: [['Date', 'Result', 'Verified', 'Guard on duty', 'Remarks']],
    body: nights.map((n) => [day(n.date), n.status, n.required ? `${n.verified} of ${n.required}` : '–', n.guards.join(', ') || '–', dayRemark(n)]),
    columnStyles: { 0: { cellWidth: 24 }, 1: { cellWidth: 25 }, 2: { cellWidth: 18, halign: 'center' }, 3: { cellWidth: 34 } },
    didParseCell: colourResult(1),
  });

  // 2. Patrol log.
  let y = heading('Patrol log', lastY() + 10);
  if (report.shifts.length) {
    autoTable(doc, {
      ...table,
      startY: y,
      head: [['Date', 'Guard on duty', 'Account', 'Started', 'Ended', 'Duration', 'Status']],
      body: report.shifts.map((s) => {
        const open = patrolOpen(s, report.generated_at);
        const end = s.actual_end ?? s.auto_closed_at ?? (s.actual_start && !open ? s.scheduled_end : null);
        const ended = !s.actual_start ? '–' : s.actual_end ? at(s.actual_end) : s.auto_closed_at ? `${at(s.auto_closed_at)} (automatic)`
          : open ? `Open until ${at(s.scheduled_end)}` : at(s.scheduled_end);
        return [day(s.patrol_date), guardOnDuty(s), s.login_name, at(s.actual_start), ended,
          s.actual_start && open && !end ? `${duration(s.actual_start, report.generated_at)} so far` : duration(s.actual_start, end), patrolResult(s)];
      }),
      columnStyles: { 0: { cellWidth: 22 }, 5: { cellWidth: 22 }, 6: { cellWidth: 27 } },
      didParseCell: colourResult(6),
    });
    y = lastY() + 10;
  } else {
    doc.setFontSize(9);
    doc.setTextColor(...GREY);
    doc.text('No patrol was started in this period.', MARGIN, y + 4);
    y += 14;
  }

  // 3. Every location of every patrol: what was scanned, when and where.
  for (const shift of report.shifts) {
    const visits = rows.filter((r) => r.shift.id === shift.id)
      .sort((a, b) => VISIT_ORDER[a.status] - VISIT_ORDER[b.status]
        || (a.scan && b.scan ? a.scan.effective_time.localeCompare(b.scan.effective_time) : a.checkpoint.sequence - b.checkpoint.sequence));
    const title = `Location checks · ${day(shift.patrol_date)} · ${guardOnDuty(shift)}`;
    y = heading(title, y, 50);
    doc.setFontSize(8);
    doc.setTextColor(...GREY);
    const counts = (['Verified', 'Missed', 'Pending', 'Awaiting review', 'Rejected'] as VisitStatus[])
      .map((s) => [s, visits.filter((v) => v.status === s).length] as const).filter(([, n]) => n).map(([s, n]) => `${n} ${s.toLowerCase()}`);
    doc.text(`Started ${at(shift.actual_start)} · ${counts.join(' · ') || 'no locations'}`, MARGIN, y + 2);
    if (!visits.length) {
      doc.text('No locations were set for this patrol.', MARGIN, y + 7);
      y += 16;
      continue;
    }
    autoTable(doc, {
      ...table,
      startY: y + 5,
      head: [['No.', 'Location', 'Result', 'Scanned at', 'Scans', 'GPS position', 'Accuracy', 'Notes']],
      body: visits.map((r, i) => [String(i + 1), r.checkpoint.name, r.status, at(r.scan?.device_time ?? null), String(r.checkpoint.scans.length),
        coordinates(r.scan), accuracy(r.scan), visitNotes(r)]),
      columnStyles: { 0: { cellWidth: 9, halign: 'center' }, 1: { cellWidth: 44 }, 2: { cellWidth: 22 }, 3: { cellWidth: 22 }, 4: { cellWidth: 13, halign: 'center' }, 5: { cellWidth: 28 }, 6: { cellWidth: 19 } },
      didParseCell: colourResult(2),
    });
    y = lastY() + 10;
  }

  // Key to the results, so the report reads on its own.
  const key: [string, string][] = [
    ['Verified', 'QR code scanned at the location and confirmed by GPS.'],
    ['Missed', 'The location was not scanned before the patrol ended.'],
    ['Pending', 'Not scanned yet; the patrol is still open.'],
    ['Awaiting review', 'Scanned, but flagged (for example weak GPS) for a supervisor to check.'],
    ['Rejected', 'The scan failed the checks and does not count.'],
    ['Absent', 'No patrol was carried out on that day.'],
    ['Incomplete', 'A patrol took place, but at least one location was missed.'],
  ];
  y = heading('Key to results', y, 45);
  autoTable(doc, {
    ...table,
    startY: y + 1,
    theme: 'plain',
    body: key,
    styles: { ...table.styles, fontSize: 7.5, cellPadding: 1.2, lineWidth: 0 },
    columnStyles: { 0: { cellWidth: 30 } },
    didParseCell: colourResult(0),
  });

  // Footer on every page.
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setDrawColor(...TEAL);
    doc.setLineWidth(0.4);
    doc.line(MARGIN, height - 15, right, height - 15);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...GREY);
    doc.text('Muscat Bay  ·  Security Patrol Report  ·  Confidential', MARGIN, height - 10);
    doc.text(`Generated ${stampFormat.format(new Date(report.generated_at))} from the scans received by the server.`, MARGIN, height - 6);
    doc.text(`Page ${p} of ${pages}`, right, height - 10, { align: 'right' });
  }
  return doc;
}
