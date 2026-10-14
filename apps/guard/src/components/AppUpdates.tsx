// =============================================================================
// Automatic app updates (EAS Update).
// =============================================================================
// Android phones install the app from an APK and iPhones use TestFlight, so new
// versions do not arrive by themselves. EAS Update fills the gap for every
// change that does not touch native code:
// 1. When the app starts, expo-updates checks for an update by itself
//    (checkAutomatically "ON_LOAD" in app.config.ts). It never makes the app
//    wait: the download runs in the background.
// 2. When the app returns to the foreground, this component checks again (at
//    most every CHECK_EVERY_MS) and downloads any update in the background.
// 3. A downloaded update is used the next time the app starts. If the app comes
//    back to the foreground while NO patrol is running, it restarts straight
//    away to use it. It never restarts during a patrol, while GPS tracking is
//    on, while an SOS is being sent (an SOS needs no shift) or while the outbox
//    is uploading, so none of these is interrupted.
// Updates are switched off in development and when no EAS project is set up.
// =============================================================================
import * as Updates from 'expo-updates';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { useAuth } from '@/context/AuthProvider';
import { useShift } from '@/context/ShiftProvider';
import { isBusy } from '@/lib/busy';
import { reportError } from '@/lib/sentry';
import { getSyncState, subscribeSync } from '@/offline/sync';
import { isTracking } from '@/services/location';

/**
 * Minimum time between two update checks when the app returns to the
 * foreground. 15 minutes keeps data use negligible on a shift where the phone
 * is unlocked many times, while an update still arrives within the hour.
 */
const CHECK_EVERY_MS = 15 * 60 * 1000;

/** Resolves once the outbox upload that runs on every return to the app has finished. */
function syncFinished(): Promise<void> {
  return new Promise((resolve) => {
    if (!getSyncState().syncing) return resolve();
    const unsubscribe = subscribeSync((s) => {
      if (!s.syncing) {
        unsubscribe();
        resolve();
      }
    });
  });
}

async function checkAndDownload() {
  try {
    const result = await Updates.checkForUpdateAsync();
    if (result.isAvailable) await Updates.fetchUpdateAsync();
  } catch {
    // Offline or the update server is unreachable: try again next time.
  }
}

export function AppUpdates() {
  const { isUpdatePending } = Updates.useUpdates();
  const { session } = useAuth();
  const { shift, loading, fromCache, error } = useShift();

  // Restarting is safe only when we KNOW no patrol is running: signed in, and
  // the server (not a saved copy) says there is no active shift.
  const safeToRestart = Boolean(session) && !loading && !fromCache && !error && !shift;
  const state = useRef({ isUpdatePending, safeToRestart });
  state.current = { isUpdatePending, safeToRestart };

  useEffect(() => {
    if (!Updates.isEnabled || __DEV__) return;
    let lastCheck = Date.now(); // the launch check has just run
    let previous = AppState.currentState;

    const sub = AppState.addEventListener('change', (next) => {
      const cameBack = previous !== 'active' && next === 'active';
      previous = next;
      if (!cameBack) return;

      if (state.current.isUpdatePending && state.current.safeToRestart) {
        void (async () => {
          if (await isTracking()) return; // GPS tracking still on: wait
          await syncFinished(); // let the upload started on return finish first
          // Check again: the guard may have pressed SOS or started a patrol meanwhile.
          if (AppState.currentState !== 'active' || (await isTracking())) return;
          if (isBusy() || getSyncState().syncing || !state.current.safeToRestart) return;
          await Updates.reloadAsync().catch((e) => reportError(e, { where: 'updatesReload' }));
        })();
        return;
      }
      if (Date.now() - lastCheck < CHECK_EVERY_MS) return;
      lastCheck = Date.now();
      void checkAndDownload();
    });
    return () => sub.remove();
  }, []);

  return null;
}
