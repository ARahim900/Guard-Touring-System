// AbortSignal.timeout() is missing on Safari/iOS before 16, where calling it
// throws "AbortSignal.timeout is not a function" and blocked sign-in.
export function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  const controller = new AbortController();
  setTimeout(() => controller.abort(new DOMException('The request timed out.', 'TimeoutError')), ms);
  return controller.signal;
}
