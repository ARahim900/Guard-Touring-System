import type { PatrolReceipt } from './guardOutbox';

const reasons: Record<string, string> = {
  too_far: 'You are outside this location’s allowed area. Go to the QR label at the location and scan again.',
  low_accuracy: 'The GPS signal is not accurate enough. Move into the open, allow precise location and scan again.',
  no_gps: 'No GPS position was received. Allow precise location and scan again.',
  code_mismatch: 'This QR label does not match the location. Scan the correct label.',
  checkpoint_inactive: 'This location is no longer active. Contact your supervisor.',
  not_on_route: 'This location is not included in this patrol. Contact your supervisor.',
  clock_drift: 'Your phone’s clock differs from the server. Enable automatic date and time on your phone.',
  future_time: 'Your phone reported a future time. Enable automatic date and time, then scan again.',
  mock_location: 'The location check could not be trusted. Turn off mock location and scan again.',
  shift_cancelled: 'This patrol was cancelled. Refresh to check your current patrol.',
  shift_not_started: 'The patrol had not started. Start your patrol before scanning.',
  outside_shift: 'The scan was outside your shift hours. Refresh to check your current patrol.',
  late: 'This scan was later than the planned visit time. Your supervisor can review it.',
};

export function scanFeedback(receipt: PatrolReceipt) {
  if (receipt.state === 'pending') return {
    tone: 'pending' as const, title: 'Waiting for upload',
    message: 'Saved on this phone, but the visit is not verified yet. Reconnect and retry the upload.',
  };
  if (receipt.validation === 'valid') return {
    tone: 'success' as const, title: 'Visit verified', message: 'This location is complete for your shift.',
  };
  const messages = [...new Set(receipt.flags ?? [])].map((flag) => reasons[flag] ?? `Check requiring review: ${flag.replaceAll('_', ' ')}.`);
  return {
    tone: receipt.validation === 'rejected' ? 'danger' as const : 'warning' as const,
    title: receipt.validation === 'rejected' ? 'Scan rejected — visit not counted' : 'Needs review — not yet verified',
    message: messages.join(' ') || 'The visit could not be verified. Contact your supervisor before continuing.',
  };
}
