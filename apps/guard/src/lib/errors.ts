// Turns technical errors into short messages a guard can act on.
// Rule of thumb: say what happened and what to do next, in one line.

/** True when the error is "no connection" rather than "the server said no". */
export function isNetworkError(error: unknown): boolean {
  const msg = String((error as { message?: string })?.message ?? error).toLowerCase();
  return (
    msg.includes('network request failed') ||
    msg.includes('failed to fetch') ||
    msg.includes('network error') ||
    msg.includes('timeout') ||
    msg.includes('aborted')
  );
}

/**
 * Postgres errors carry a 5-character "code". Errors raised in our SQL
 * functions use codes 42501 (not allowed), 22023 (bad input), P0002 (not found),
 * and they already contain a readable message, so we pass those through.
 */
export function isServerRejection(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code);
}

export function friendlyError(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (!error) return fallback;
  if (isNetworkError(error)) return 'No connection. Check your signal and try again.';
  const msg = (error as { message?: string })?.message;
  if (msg?.includes('Invalid login credentials')) return 'Email or password is incorrect.';
  if (msg?.includes('JWT expired')) return 'Your session has expired. Please sign in again.';
  if (isServerRejection(error) && msg) return msg;
  return msg && msg.length < 140 ? msg : fallback;
}
