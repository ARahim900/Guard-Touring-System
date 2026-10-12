// Shapes of database rows used by the portal (mirror supabase/migrations).
export type UserRole = 'guard' | 'supervisor' | 'admin';
export type ShiftStatus = 'scheduled' | 'active' | 'completed' | 'missed' | 'cancelled';
export type ScanValidation = 'valid' | 'flagged' | 'rejected';
export type AlarmType = 'missed_checkpoint' | 'shift_not_started' | 'sos' | 'scan_rejected';
export type AlarmStatus = 'open' | 'acknowledged' | 'resolved';
export type IncidentStatus = 'open' | 'in_progress' | 'resolved';
export type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface Contractor {
  id: string;
  name: string;
  contract_ref: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  active: boolean;
}

export interface Profile {
  id: string;
  full_name: string;
  email: string | null;
  employee_no: string | null;
  phone: string | null;
  role: UserRole;
  contractor_id: string | null;
  active: boolean;
  contractors?: { name: string } | null;
}

export interface Checkpoint {
  id: string;
  name: string;
  code: string;
  nfc_uid: string | null;
  description: string | null;
  latitude: number;
  longitude: number;
  radius_m: number;
  active: boolean;
}

export interface Route {
  id: string;
  name: string;
  description: string | null;
  contractor_id: string | null;
  active: boolean;
  route_checkpoints?: { count: number }[];
}

export interface RouteCheckpoint {
  route_id: string;
  checkpoint_id: string;
  sequence: number;
  due_offset_min: number;
}

export interface Shift {
  id: string;
  guard_id: string;
  route_id: string;
  scheduled_start: string;
  scheduled_end: string;
  actual_start: string | null;
  actual_end: string | null;
  auto_closed_at: string | null;
  status: ShiftStatus;
  notes: string | null;
  /** Name typed by the guard at Start shift (security shares one login). */
  on_duty_name: string | null;
  /** Optional employee / ID number typed at Start shift. */
  on_duty_ref: string | null;
  profiles?: { full_name: string } | null;
  routes?: { name: string } | null;
}

/** Who was on duty, embedded from the shift on scans, alarms and incidents. */
export interface OnDuty {
  on_duty_name: string | null;
  on_duty_ref: string | null;
}

export interface Scan {
  id: string;
  shift_id: string;
  guard_id: string;
  checkpoint_id: string;
  method: 'qr' | 'barcode' | 'nfc';
  raw_value: string;
  status: 'normal' | 'issue';
  note: string | null;
  device_time: string;
  server_time: string;
  clock_offset_sec: number;
  effective_time: string;
  latitude: number | null;
  longitude: number | null;
  accuracy_m: number | null;
  is_mocked: boolean;
  distance_m: number | null;
  due_at: string | null;
  is_on_time: boolean | null;
  validation: ScanValidation;
  flags: string[];
  expected_attachments: number;
  review_note: string | null;
  reviewed_at: string | null;
  review_history: { previous_verdict: ScanValidation; verdict: ScanValidation; reason: string; reviewed_at: string; reviewed_by: string }[];
  profiles?: { full_name: string } | null;
  shifts?: OnDuty | null;
  checkpoints?: { name: string } | null;
  scan_attachments?: Attachment[];
}

export interface Attachment {
  id: string;
  type: 'photo' | 'audio';
  source: 'camera' | 'gallery' | 'microphone';
  storage_path: string;
  size_bytes: number | null;
  duration_sec: number | null;
  captured_at: string;
  exif_taken_at: string | null;
  flagged_pre_shift: boolean;
}

export interface Alarm {
  id: string;
  type: AlarmType;
  guard_id: string;
  shift_id: string | null;
  checkpoint_id: string | null;
  scan_id: string | null;
  message: string;
  latitude: number | null;
  longitude: number | null;
  accuracy_m: number | null;
  status: AlarmStatus;
  acknowledged_at: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  created_at: string;
  profiles?: { full_name: string; phone: string | null } | null;
  shifts?: OnDuty | null;
}

export interface Incident {
  id: string;
  scan_id: string | null;
  shift_id: string | null;
  guard_id: string;
  checkpoint_id: string | null;
  description: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  resolution_note: string | null;
  resolved_at: string | null;
  created_at: string;
  profiles?: { full_name: string } | null;
  shifts?: OnDuty | null;
  checkpoints?: { name: string } | null;
}

export interface LivePosition {
  guard_id: string;
  full_name: string;
  phone: string | null;
  shift_id: string;
  route_name: string;
  latitude: number;
  longitude: number;
  accuracy_m: number | null;
  is_mocked: boolean;
  recorded_at: string;
}
