import type { ScanValidation, ShiftStatus } from './types';

export interface ReportScan {
  id: string;
  device_time: string;
  server_time: string;
  effective_time: string;
  validation: ScanValidation;
  latitude: number | null;
  longitude: number | null;
  accuracy_m: number | null;
  distance_m: number | null;
  status: 'normal' | 'issue';
  note: string | null;
  flags: string[];
  review_note: string | null;
  expected_attachments: number;
  attachment_count: number;
}

export interface ReportCheckpoint {
  id: string;
  name: string;
  sequence: number;
  scans: ReportScan[];
}

export interface ReportShift {
  id: string;
  patrol_date: string;
  guard_name: string | null;
  guard_ref: string | null;
  login_name: string;
  route_name: string;
  status: ShiftStatus;
  scheduled_start: string;
  scheduled_end: string;
  actual_start: string | null;
  actual_end: string | null;
  auto_closed_at: string | null;
  checkpoints: ReportCheckpoint[];
}

export interface PatrolReport {
  from_date: string;
  to_date: string;
  generated_at: string;
  shifts: ReportShift[];
}

/**
 * Missed: not scanned before the patrol ended. Pending: not scanned yet, and
 * the patrol is still open.
 */
export type VisitStatus = 'Verified' | 'Awaiting review' | 'Rejected' | 'Missed' | 'Pending' | 'Cancelled';
export interface VisitRow {
  shift: ReportShift;
  checkpoint: ReportCheckpoint;
  scan: ReportScan | null;
  status: VisitStatus;
}

/** A patrol that is still running (or not started) and inside its 12 hours. */
export const patrolOpen = (shift: ReportShift, at: string) =>
  (shift.status === 'active' || shift.status === 'scheduled') && new Date(shift.scheduled_end) > new Date(at);

export function visitRows(report: PatrolReport): VisitRow[] {
  return report.shifts.flatMap((shift) => shift.checkpoints.map((checkpoint) => {
    const ordered = [...checkpoint.scans].sort((a, b) => a.effective_time.localeCompare(b.effective_time));
    const verified = ordered.find((s) => s.validation === 'valid');
    const flagged = ordered.find((s) => s.validation === 'flagged');
    const scan = verified ?? flagged ?? ordered.at(-1) ?? null;
    const status: VisitStatus = shift.status === 'cancelled' ? 'Cancelled'
      : verified ? 'Verified' : flagged ? 'Awaiting review' : scan ? 'Rejected'
      : patrolOpen(shift, report.generated_at) ? 'Pending' : 'Missed';
    return { shift, checkpoint, scan, status };
  }));
}

export function reportTotals(report: PatrolReport) {
  const rows = visitRows(report).filter((r) => r.status !== 'Cancelled');
  const verified = rows.filter((r) => r.status === 'Verified').length;
  return {
    required: rows.length,
    verified,
    review: rows.filter((r) => r.status === 'Awaiting review').length,
    rejected: rows.filter((r) => r.status === 'Rejected').length,
    missed: rows.filter((r) => r.status === 'Missed').length,
    pending: rows.filter((r) => r.status === 'Pending').length,
    completion: rows.length ? verified / rows.length * 100 : null,
    missingAttachments: rows.reduce((sum, r) => sum + r.checkpoint.scans.reduce((n, s) => n + Math.max(0, s.expected_attachments - s.attachment_count), 0), 0),
  };
}

/** Absent: no patrol at all on a past day. Missed: a planned patrol was never started. */
export type NightStatus = 'Completed' | 'Incomplete' | 'In progress' | 'Not started' | 'Missed' | 'Absent' | 'Cancelled' | 'Upcoming';
export interface NightRow {
  date: string;
  status: NightStatus;
  verified: number;
  required: number;
  guards: string[];
}
/** Nights that need a supervisor's explanation. */
export const NIGHTS_NEEDING_ATTENTION: NightStatus[] = ['Absent', 'Missed', 'Incomplete'];

const muscatDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Muscat', year: 'numeric', month: '2-digit', day: '2-digit' });

/**
 * One row for EVERY night in the range, including nights with no shift record
 * at all. A patrol that was never started and never scheduled leaves no record,
 * so it can only be found by listing the nights that were expected.
 */
export function nightRows(report: PatrolReport): NightRow[] {
  const now = new Date(report.generated_at);
  const today = muscatDay.format(now);
  const nights: NightRow[] = [];
  for (let day = new Date(`${report.from_date}T00:00:00Z`); day <= new Date(`${report.to_date}T00:00:00Z`); day.setUTCDate(day.getUTCDate() + 1)) {
    const date = day.toISOString().slice(0, 10);
    const shifts = report.shifts.filter((s) => s.patrol_date === date);
    const live = shifts.filter((s) => s.status !== 'cancelled');
    const required = new Set(live.flatMap((s) => s.checkpoints.map((c) => c.id)));
    const verified = new Set(live.flatMap((s) => s.checkpoints.filter((c) => c.scans.some((x) => x.validation === 'valid')).map((c) => c.id)));
    const started = live.some((s) => s.actual_start !== null || s.status === 'active' || s.status === 'completed');
    const status: NightStatus =
      !live.length ? (shifts.length ? 'Cancelled' : date > today ? 'Upcoming' : date === today ? 'Not started' : 'Absent')
      : live.some((s) => s.status === 'active') ? 'In progress'
      : started ? (required.size > 0 && verified.size === required.size ? 'Completed' : 'Incomplete')
      : live.some((s) => s.status === 'scheduled' && new Date(s.scheduled_end) > now) ? 'Not started'
      : 'Missed';
    nights.push({ date, status, verified: verified.size, required: required.size, guards: [...new Set(live.map(guardOnDuty))] });
  }
  return nights;
}

const timestampFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Muscat', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
/** A Muscat time, or `empty` when there is no reading (a dash on screen, a blank cell in Excel). */
export const evidenceTime = (value: string | null, empty = '–') => value ? timestampFormatter.format(new Date(value)) : empty;
/** GPS position of a scan; a scan saved without a GPS fix says so. */
export const coordinates = (s: ReportScan | null) => !s ? '–' : s.latitude !== null && s.longitude !== null
  ? `${s.latitude.toFixed(6)}, ${s.longitude.toFixed(6)}` : 'No GPS fix';
/** GPS accuracy rounded to whole metres. */
export const accuracy = (s: ReportScan | null) => !s || s.latitude === null ? '–' : s.accuracy_m === null ? 'Not reported' : `±${Math.round(s.accuracy_m)} m`;
export const guardOnDuty = (s: ReportShift) => s.guard_name ?? 'Name not recorded';

/** Plain-English state of a patrol for reports. */
export function patrolResult(s: ReportShift): string {
  if (s.auto_closed_at) return 'Closed automatically';
  return { scheduled: 'Not started', active: 'In progress', completed: 'Completed', missed: 'Missed', cancelled: 'Cancelled' }[s.status];
}
/** When the patrol ended, or why there is no end time. */
export function patrolEnd(s: ReportShift, at: string): string {
  if (s.actual_end) return evidenceTime(s.actual_end);
  if (s.auto_closed_at) return evidenceTime(s.auto_closed_at);
  if (!s.actual_start) return '–';
  return patrolOpen(s, at) ? `Open until ${evidenceTime(s.scheduled_end)}` : evidenceTime(s.scheduled_end);
}

/** Quote a CSV cell and stop Excel treating text such as "=..." as a formula. */
export function csvCell(value: string | number | null): string {
  const raw = value === null ? '' : String(value);
  const safe = typeof value === 'string' && /^[\s]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function buildReportCsv(report: PatrolReport): string {
  const head = ['Shift date', 'Guard on duty', 'Guard ID', 'Login', 'Route', 'Patrol status', 'Scheduled start (Muscat)', 'Scheduled end (Muscat)', 'Actual start (Muscat)', 'Actual end (Muscat)', 'Automatically closed (Muscat)', 'Checkpoint', 'Location result', 'Scan count', 'Captured time (Muscat)', 'Server received (Muscat)', 'Latitude', 'Longitude', 'GPS accuracy (m)', 'Issue notes', 'Missing attachments', 'Generated at (Muscat)'];
  const rows: (string | number | null)[][] = visitRows(report).map(({ shift: s, checkpoint: c, scan, status }) => [
    s.patrol_date, guardOnDuty(s), s.guard_ref, s.login_name, s.route_name, patrolResult(s),
    evidenceTime(s.scheduled_start, ''), evidenceTime(s.scheduled_end, ''), evidenceTime(s.actual_start, ''), evidenceTime(s.actual_end, ''),
    evidenceTime(s.auto_closed_at, ''), c.name, status, c.scans.length,
    evidenceTime(scan?.device_time ?? null, ''), evidenceTime(scan?.server_time ?? null, ''),
    scan?.latitude ?? null, scan?.longitude ?? null, scan?.accuracy_m ?? null,
    c.scans.filter((x) => x.status === 'issue').map((x) => x.note ?? '').join(' | '),
    c.scans.reduce((n, x) => n + Math.max(0, x.expected_attachments - x.attachment_count), 0), evidenceTime(report.generated_at),
  ]);
  // A shift without configured checkpoints must remain visible in the export.
  for (const s of report.shifts.filter((shift) => shift.checkpoints.length === 0)) {
    rows.push([s.patrol_date, guardOnDuty(s), s.guard_ref, s.login_name, s.route_name, patrolResult(s),
      evidenceTime(s.scheduled_start, ''), evidenceTime(s.scheduled_end, ''), evidenceTime(s.actual_start, ''), evidenceTime(s.actual_end, ''),
      evidenceTime(s.auto_closed_at, ''), 'No checkpoints configured', '', 0, '', '', null, null, null, '', 0, evidenceTime(report.generated_at)]);
  }
  return '\uFEFF' + [head, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}
