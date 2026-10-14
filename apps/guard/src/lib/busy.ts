// =============================================================================
// Work in progress that an automatic app restart must not cut short.
// =============================================================================
// An SOS can be sent without a shift, so "no active shift" alone does not mean
// the app is idle. Code that must finish (sending an SOS) wraps itself in
// whileBusy(); AppUpdates only restarts the app when isBusy() is false.
// =============================================================================

let inFlight = 0;

/** True while any work started with whileBusy() is still running. */
export function isBusy(): boolean {
  return inFlight > 0;
}

/** Runs the task and marks the app busy until it has finished (or failed). */
export async function whileBusy<T>(task: () => Promise<T>): Promise<T> {
  inFlight += 1;
  try {
    return await task();
  } finally {
    inFlight -= 1;
  }
}
