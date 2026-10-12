// Date helpers. The database stores absolute instants (UTC); we always
// DISPLAY them in Muscat time, whatever time zone the phone is set to.
export const TIME_ZONE = 'Asia/Muscat';

const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit' });
const dateFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, weekday: 'short', day: '2-digit', month: 'short' });
const dayKeyFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

export const formatTime = (iso: string | Date) => timeFmt.format(new Date(iso));
export const formatDate = (iso: string | Date) => dateFmt.format(new Date(iso));
export const formatDateTime = (iso: string | Date) => `${formatDate(iso)}, ${formatTime(iso)}`;

/** "2026-10-12" for the Muscat calendar day containing this instant. */
export const muscatDayKey = (d: Date | string = new Date()) => dayKeyFmt.format(new Date(d));

/**
 * Start and end (exclusive) of a Muscat calendar day as UTC ISO strings.
 * Oman has no daylight saving, so the offset is always +04:00.
 */
export function muscatDayRange(dayKey: string): { from: string; to: string } {
  const from = new Date(`${dayKey}T00:00:00+04:00`);
  const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

export function addDays(dayKey: string, days: number): string {
  const d = new Date(`${dayKey}T12:00:00+04:00`);
  d.setUTCDate(d.getUTCDate() + days);
  return muscatDayKey(d);
}

/** "2 h 05 min" style duration. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}
