// =============================================================================
// Monthly contractor report as a PDF (built in the browser with jsPDF).
// =============================================================================
// Totals are WEIGHTED: overall completion = all checkpoints visited ÷ all
// checkpoints due, not an average of each guard's percentage (an average
// would let a guard with 2 checkpoints count as much as one with 400).
// =============================================================================
import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';

import { formatDateTime } from './time';
import type { Incident, ReportRow } from './types';

const PRIMARY: [number, number, number] = [78, 68, 86]; // #4E4456
const TEAL: [number, number, number] = [161, 209, 213]; // #A1D1D5
const MUTED: [number, number, number] = [107, 114, 128];

export interface ReportInput {
  contractorName: string;
  monthLabel: string; // e.g. "October 2026"
  rows: ReportRow[];
  incidents: Incident[];
  generatedBy: string;
  /** Muscat Bay mark as a PNG data URL (see loadLogo). Optional. */
  logoDataUrl?: string | null;
}

export function totals(rows: ReportRow[]) {
  const sum = (k: keyof ReportRow) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const expected = sum('expected');
  const completed = sum('completed');
  const onTime = sum('on_time');
  return {
    guards: rows.length,
    shifts: sum('shifts'),
    shiftsMissed: sum('shifts_missed'),
    expected,
    completed,
    onTime,
    completion: expected ? (completed / expected) * 100 : null,
    punctuality: completed ? (onTime / completed) * 100 : null,
    incidents: sum('incidents'),
    sos: sum('sos'),
    rejected: sum('rejected_scans'),
  };
}

const pct = (v: number | null) => (v === null ? '–' : `${v.toFixed(1)}%`);

export function buildReportPdf(input: ReportInput): jsPDF {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const t = totals(input.rows);

  // ---- Header band
  doc.setFillColor(...PRIMARY);
  doc.rect(0, 0, W, 26, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('Muscat Bay · Security Patrol Performance Report', 14, 12);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`${input.contractorName}  ·  ${input.monthLabel}`, 14, 20);
  doc.setFillColor(...TEAL);
  doc.rect(0, 26, W, 1.5, 'F');
  if (input.logoDataUrl) {
    // The logo is purple, so it sits on a white tile inside the purple band.
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(W - 34, 3, 20, 20, 2, 2, 'F');
    doc.addImage(input.logoDataUrl, 'PNG', W - 32, 5, 16, 16);
  }

  // ---- KPI boxes
  const kpis: [string, string][] = [
    ['Checkpoint completion', pct(t.completion)],
    ['Punctuality', pct(t.punctuality)],
    ['Checkpoints visited / due', `${t.completed} / ${t.expected}`],
    ['Shifts (missed)', `${t.shifts} (${t.shiftsMissed})`],
    ['Incidents reported', String(t.incidents)],
    ['SOS raised', String(t.sos)],
  ];
  const boxW = (W - 28 - 5 * 4) / 6;
  kpis.forEach(([label, value], i) => {
    const x = 14 + i * (boxW + 4);
    doc.setDrawColor(229, 231, 235);
    doc.setFillColor(247, 248, 249);
    doc.roundedRect(x, 33, boxW, 20, 2, 2, 'FD');
    doc.setTextColor(...MUTED);
    doc.setFontSize(8);
    doc.text(label, x + 3, 39);
    doc.setTextColor(...PRIMARY);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(value, x + 3, 48);
    doc.setFont('helvetica', 'normal');
  });

  // ---- Per-guard table
  autoTable(doc, {
    startY: 60,
    head: [['Guard', 'Emp. no.', 'Shifts', 'Missed shifts', 'Due', 'Visited', 'Completion', 'On time', 'Punctuality', 'Incidents', 'SOS', 'Rejected scans']],
    body: input.rows.map((r) => [
      r.full_name,
      r.employee_no ?? '–',
      r.shifts,
      r.shifts_missed,
      r.expected,
      r.completed,
      pct(r.completion_rate === null ? null : Number(r.completion_rate)),
      r.on_time,
      pct(r.punctuality_rate === null ? null : Number(r.punctuality_rate)),
      r.incidents,
      r.sos,
      r.rejected_scans,
    ]),
    foot: [['Total', '', t.shifts, t.shiftsMissed, t.expected, t.completed, pct(t.completion), t.onTime, pct(t.punctuality), t.incidents, t.sos, t.rejected]],
    showFoot: 'lastPage', // the Total row only once, at the end
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 2 },
    headStyles: { fillColor: PRIMARY, textColor: 255 },
    footStyles: { fillColor: [232, 241, 239], textColor: PRIMARY, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [247, 248, 249] },
    margin: { left: 14, right: 14, bottom: 24 }, // room for the footer and definitions
  });

  // ---- Incidents
  const afterTable = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  // Start the incidents section on a new page if it would collide with the footer.
  let y = afterTable + 10;
  if (y > doc.internal.pageSize.getHeight() - 40) {
    doc.addPage();
    y = 20;
  }
  doc.setTextColor(...PRIMARY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(`Incidents reported (${input.incidents.length})`, 14, y);
  doc.setFont('helvetica', 'normal');
  if (input.incidents.length) {
    autoTable(doc, {
      startY: y + 3,
      head: [['Date', 'Guard', 'Checkpoint', 'Description', 'Severity', 'Status']],
      body: input.incidents.map((i) => [formatDateTime(i.created_at), i.profiles?.full_name ?? '', i.checkpoints?.name ?? '', i.description, i.severity, i.status.replace('_', ' ')]),
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 1.8 },
      headStyles: { fillColor: PRIMARY, textColor: 255 },
      columnStyles: { 3: { cellWidth: 110 } },
      margin: { left: 14, right: 14, bottom: 24 },
    });
  } else {
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    doc.text('None.', 14, y + 6);
  }

  // ---- Definitions + footer on every page
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    const H = doc.internal.pageSize.getHeight();
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    if (p === pages) {
      doc.text(
        'Definitions: Completion = checkpoints visited ÷ checkpoints due. Punctuality = visits within the grace period ÷ checkpoints visited. ' +
          'A visit counts only if the server confirmed the guard was within the checkpoint radius, inside the shift, with genuine GPS. ' +
          'Rejected scans did not count. All times Muscat (UTC+4).',
        14,
        H - 14,
        { maxWidth: W - 28 },
      );
    }
    doc.text(`Generated ${formatDateTime(new Date())} by ${input.generatedBy} · MB Patrol`, 14, H - 6);
    doc.text(`Page ${p} of ${pages}`, W - 14, H - 6, { align: 'right' });
  }

  return doc;
}

export const monthLabel = (month: string) =>
  new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'Asia/Muscat' }).format(new Date(`${month}-15T12:00:00+04:00`));


/** Read the Muscat Bay mark from the portal's public folder as a data URL. */
export async function loadLogo(): Promise<string | null> {
  try {
    const blob = await (await fetch('/muscat-bay-mark.png')).blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null; // the report still works without the logo
  }
}
