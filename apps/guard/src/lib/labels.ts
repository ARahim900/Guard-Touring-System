// Plain-English labels for codes stored in the database.
import type { AlarmStatus, AlarmType, ScanMethod, ScanValidation } from './types';

export const FLAG_LABELS: Record<string, string> = {
  too_far: 'Too far from checkpoint',
  mock_location: 'Fake GPS detected',
  clock_drift: 'Phone clock is wrong',
  code_mismatch: 'Wrong tag for this checkpoint',
  not_on_route: 'Not on your route',
  outside_shift: 'Outside shift time',
  no_gps: 'No GPS position',
  low_accuracy: 'Weak GPS signal',
  late: 'Late',
  future_time: 'Time in the future',
  shift_not_started: 'Shift not started',
  checkpoint_inactive: 'Checkpoint retired',
  shift_cancelled: 'Shift cancelled',
  impossible_travel: 'Moved too fast between scans',
  repeated_position: 'Same GPS position as another checkpoint',
  fast_round: 'Round finished too fast',
};

export const flagText = (flags: string[]) => flags.map((f) => FLAG_LABELS[f] ?? f).join(' · ');

export const VALIDATION_LABEL: Record<ScanValidation, { label: string; tone: 'success' | 'warning' | 'danger' }> = {
  valid: { label: 'Verified', tone: 'success' },
  flagged: { label: 'Awaiting review', tone: 'warning' },
  rejected: { label: 'Not accepted', tone: 'danger' },
};

export const METHOD_LABEL: Record<ScanMethod, string> = { qr: 'QR', barcode: 'Barcode', nfc: 'NFC' };

export const ALARM_LABEL: Record<AlarmType, string> = {
  missed_checkpoint: 'Missed checkpoint',
  shift_not_started: 'Shift not started',
  sos: 'SOS',
  scan_rejected: 'Scan not accepted',
};

export const ALARM_STATUS: Record<AlarmStatus, { label: string; tone: 'danger' | 'warning' | 'neutral' }> = {
  open: { label: 'Open', tone: 'danger' },
  acknowledged: { label: 'Seen by supervisor', tone: 'warning' },
  resolved: { label: 'Resolved', tone: 'neutral' },
};
