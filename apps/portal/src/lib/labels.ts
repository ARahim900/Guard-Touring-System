// Plain-English labels and badge colours for database codes.
import type { AlarmStatus, AlarmType, IncidentSeverity, IncidentStatus, ScanValidation, ShiftStatus } from './types';

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'brand';

export const FLAG_LABELS: Record<string, string> = {
  too_far: 'Too far from checkpoint',
  mock_location: 'Fake GPS detected',
  clock_drift: 'Phone clock wrong',
  code_mismatch: 'Wrong tag',
  not_on_route: 'Not on route',
  outside_shift: 'Outside shift time',
  no_gps: 'No GPS',
  low_accuracy: 'Weak GPS',
  late: 'Late',
  future_time: 'Time in future',
  shift_not_started: 'Shift not started',
  checkpoint_inactive: 'Checkpoint retired',
  shift_cancelled: 'Shift cancelled',
  impossible_travel: 'Moved impossibly fast',
  repeated_position: 'Same GPS as another checkpoint',
  fast_round: 'Round finished too fast',
};

export const VALIDATION: Record<ScanValidation, { label: string; tone: Tone }> = {
  valid: { label: 'Verified', tone: 'success' },
  flagged: { label: 'Awaiting review', tone: 'warning' },
  rejected: { label: 'Rejected', tone: 'danger' },
};

export const SHIFT_STATUS: Record<ShiftStatus, { label: string; tone: Tone }> = {
  scheduled: { label: 'Scheduled', tone: 'info' },
  active: { label: 'On shift', tone: 'success' },
  completed: { label: 'Closed', tone: 'neutral' },
  missed: { label: 'Missed', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

export const ALARM_TYPE: Record<AlarmType, { label: string; tone: Tone }> = {
  sos: { label: 'SOS', tone: 'danger' },
  missed_checkpoint: { label: 'Missed checkpoint', tone: 'warning' },
  shift_not_started: { label: 'Shift not started', tone: 'warning' },
  scan_rejected: { label: 'Scan rejected', tone: 'info' },
};

export const ALARM_STATUS: Record<AlarmStatus, { label: string; tone: Tone }> = {
  open: { label: 'Open', tone: 'danger' },
  acknowledged: { label: 'Acknowledged', tone: 'warning' },
  resolved: { label: 'Resolved', tone: 'neutral' },
};

export const INCIDENT_STATUS: Record<IncidentStatus, { label: string; tone: Tone }> = {
  open: { label: 'Open', tone: 'danger' },
  in_progress: { label: 'In progress', tone: 'warning' },
  resolved: { label: 'Resolved', tone: 'success' },
};

export const SEVERITY: Record<IncidentSeverity, { label: string; tone: Tone }> = {
  low: { label: 'Low', tone: 'neutral' },
  medium: { label: 'Medium', tone: 'info' },
  high: { label: 'High', tone: 'warning' },
  critical: { label: 'Critical', tone: 'danger' },
};

/**
 * The person to show for a shift, scan, alarm or incident.
 * Security shares one login, so the name typed at Start shift ("on duty")
 * wins; older records without it fall back to the login's name.
 */
export function guardName(row: {
  on_duty_name?: string | null;
  shifts?: { on_duty_name: string | null } | null;
  profiles?: { full_name: string } | null;
}): string {
  return row.on_duty_name ?? row.shifts?.on_duty_name ?? row.profiles?.full_name ?? '–';
}
