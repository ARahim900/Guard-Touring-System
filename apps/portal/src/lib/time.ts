// All times are shown in Muscat time (UTC+4, no daylight saving).
export const TIME_ZONE = 'Asia/Muscat';
const OFFSET = '+04:00';

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, ...opts });
const timeF = fmt({ hour: '2-digit', minute: '2-digit' });
const dateF = fmt({ day: '2-digit', month: 'short', year: 'numeric' });
const dayF = fmt({ weekday: 'short', day: '2-digit', month: 'short' });
const keyF = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

export const formatTime = (iso: string | Date) => timeF.format(new Date(iso));
export const formatDate = (iso: string | Date) => dateF.format(new Date(iso));
export const formatDay = (iso: string | Date) => dayF.format(new Date(iso));
export const formatDateTime = (iso: string | Date) => `${formatDate(iso)} ${formatTime(iso)}`;

/** "2026-10-12" (the Muscat calendar day of an instant). */
export const dayKey = (d: Date | string = new Date()) => keyF.format(new Date(d));

/** Combine a Muscat date ("2026-10-12") and time ("22:00") into an instant. */
export const muscatInstant = (date: string, time: string) => new Date(`${date}T${time}:00${OFFSET}`);

export function dayRange(key: string) {
  const from = new Date(`${key}T00:00:00${OFFSET}`);
  return { from: from.toISOString(), to: new Date(from.getTime() + 86400000).toISOString() };
}

export function addDays(key: string, days: number) {
  const d = new Date(`${key}T12:00:00${OFFSET}`);
  d.setUTCDate(d.getUTCDate() + days);
  return dayKey(d);
}

/** "HH:MM" of an instant in Muscat time (for <input type="time">). */
export const timeKey = (iso: string) => formatTime(iso);

export function relative(iso: string): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return formatDateTime(iso);
}
