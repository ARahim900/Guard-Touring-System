// TypeScript shapes of the database rows this app uses.
// They mirror supabase/migrations/*.sql. If you change a table, change it here.
// (You can also generate them: npx supabase gen types typescript --linked)

export type UserRole = 'guard' | 'supervisor' | 'admin';
export type ShiftStatus = 'scheduled' | 'active' | 'completed' | 'missed' | 'cancelled';
export type ScanMethod = 'qr' | 'barcode' | 'nfc';
export type ScanStatus = 'normal' | 'issue';
export type ScanValidation = 'valid' | 'flagged' | 'rejected';
export type AttachmentType = 'photo' | 'audio';
export type AttachmentSource = 'camera' | 'gallery' | 'microphone';
export type AlarmType = 'missed_checkpoint' | 'shift_not_started' | 'sos' | 'scan_rejected';
export type AlarmStatus = 'open' | 'acknowledged' | 'resolved';

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

export interface Shift {
  id: string;
  guard_id: string;
  route_id: string;
  scheduled_start: string;
  scheduled_end: string;
  actual_start: string | null;
  actual_end: string | null;
  status: ShiftStatus;
  notes: string | null;
  routes?: { name: string } | null;
}

/** One row of the shift_checkpoint_status view. */
export interface ShiftCheckpoint {
  shift_id: string;
  checkpoint_id: string;
  sequence: number;
  due_offset_min: number;
  due_at: string;
  checkpoint_name: string;
  code: string;
  nfc_uid: string | null;
  latitude: number;
  longitude: number;
  radius_m: number;
  scan_id: string | null;
  scanned_at: string | null;
  scan_status: ScanStatus | null;
  validation: ScanValidation | null;
  is_on_time: boolean | null;
  completed: boolean;
}

export interface ScanRow {
  id: string;
  shift_id: string;
  checkpoint_id: string;
  method: ScanMethod;
  status: ScanStatus;
  note: string | null;
  effective_time: string;
  distance_m: number | null;
  accuracy_m: number | null;
  validation: ScanValidation;
  flags: string[];
  is_on_time: boolean | null;
  expected_attachments: number;
  checkpoints?: { name: string } | null;
  scan_attachments?: { count: number }[];
}

export interface AlarmRow {
  id: string;
  type: AlarmType;
  status: AlarmStatus;
  message: string;
  created_at: string;
  resolution_note: string | null;
}

export interface PatrolStats {
  expected: number;
  completed: number;
  on_time: number;
  completion_rate: number | null;
  punctuality_rate: number | null;
  shifts: number;
  shifts_missed: number;
  incidents: number;
  sos: number;
  rejected_scans: number;
  daily: { day: string; expected: number; completed: number; on_time: number }[];
}
