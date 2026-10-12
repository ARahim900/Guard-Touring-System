import { supabase } from '@/lib/supabase';
import type { Shift } from '@/lib/types';
import type { PatrolReceipt, ScanVerdict } from '@/lib/guardOutbox';

export interface PatrolCheckpoint {
  checkpoint_id: string;
  checkpoint_name: string;
  code: string;
  sequence: number;
  completed: boolean;
  validation: 'valid' | 'flagged' | 'rejected' | null;
  scanned_at: string | null;
  latitude: number;
  longitude: number;
}
export interface PatrolSnapshot { shift: Shift | null; checkpoints: PatrolCheckpoint[]; updatedAt: string }

export async function fetchPatrol(userId: string): Promise<PatrolSnapshot> {
  const { data, error } = await supabase.from('shifts')
    .select('id, guard_id, route_id, scheduled_start, scheduled_end, actual_start, actual_end, auto_closed_at, status, notes, on_duty_name, on_duty_ref, routes(name)')
    .eq('guard_id', userId).in('status', ['active', 'scheduled'])
    .gt('scheduled_end', new Date().toISOString()).order('scheduled_start')
    .limit(100).returns<Shift[]>().abortSignal(AbortSignal.timeout(15000));
  if (error) throw error;
  const shift = data?.find((item) => item.status === 'active') ?? data?.[0] ?? null;
  if (!shift) return { shift: null, checkpoints: [], updatedAt: new Date().toISOString() };
  const checkpoints = await supabase.from('shift_checkpoint_status')
    .select('checkpoint_id, checkpoint_name, code, sequence, completed, validation, scanned_at, latitude, longitude')
    .eq('shift_id', shift.id).order('sequence').returns<PatrolCheckpoint[]>().abortSignal(AbortSignal.timeout(15000));
  if (checkpoints.error) throw checkpoints.error;
  return { shift, checkpoints: checkpoints.data ?? [], updatedAt: new Date().toISOString() };
}

export async function submitReceipt(receipt: PatrolReceipt): Promise<ScanVerdict> {
  const { data: session, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  if (session.session?.user.id !== receipt.userId) throw new Error('Sign in with the guard account that recorded these scans.');
  const { data, error } = await supabase.rpc('submit_scan', {
    p_scan_id: receipt.id, p_shift_id: receipt.shiftId, p_checkpoint_id: receipt.checkpointId,
    p_method: receipt.method, p_raw_value: receipt.code, p_status: 'normal', p_note: null,
    p_device_time: receipt.deviceTime, p_device_sent_at: new Date().toISOString(),
    p_latitude: receipt.latitude, p_longitude: receipt.longitude, p_accuracy_m: receipt.accuracy,
    // Browsers do not expose Android's mock-location detector.
    p_is_mocked: null, p_expected_attachments: 0,
  }).abortSignal(AbortSignal.timeout(15000));
  if (error) throw error;
  const result = data as Partial<ScanVerdict> | null;
  if (!result || !['valid', 'flagged', 'rejected'].includes(result.validation ?? '') || !result.server_time || !Array.isArray(result.flags)) {
    throw new Error('The server did not confirm this scan. It remains pending; retry upload.');
  }
  return result as ScanVerdict;
}

export function captureLocation(): Promise<GeolocationPosition> {
  if (!navigator.geolocation) return Promise.reject(new Error('Location is unavailable in this browser. Open in Safari or Chrome.'));
  return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition((position) => {
    const { latitude, longitude, accuracy } = position.coords;
    if (![latitude, longitude, accuracy].every(Number.isFinite) || accuracy < 0 || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || Math.abs(Date.now() - position.timestamp) > 30000) {
      reject(new Error('A fresh GPS position was not available. Move into the open and scan again.'));
    } else resolve(position);
  }, (error) => reject(new Error(error.code === 1
    ? 'Allow location access for this site in your browser settings, then scan again.'
    : 'Could not get a GPS position. Move into the open and scan again.')),
  { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }));
}
