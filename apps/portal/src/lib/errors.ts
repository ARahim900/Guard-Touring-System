// Short, human error messages for toasts.
export function friendlyError(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (!error) return fallback;
  const e = error as { message?: string; code?: string; details?: string };
  const msg = e.message ?? String(error);
  if (/failed to fetch|network/i.test(msg)) return 'No connection to the server. Check your internet.';
  if (msg.includes('Invalid login credentials')) return 'Email or password is incorrect.';
  if (e.code === '23505') return 'That value is already used. It must be unique.';
  if (e.code === '23503') return 'This item is still in use elsewhere, so it cannot be removed. Deactivate it instead.';
  if (e.code === '42501') return msg.includes('row-level security') ? 'You do not have permission to do that.' : msg;
  return msg.length < 160 ? msg : fallback;
}
