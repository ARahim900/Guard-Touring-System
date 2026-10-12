// =============================================================================
// Location: one-off fixes for scans/SOS, and background tracking during shifts.
// =============================================================================
// Background tracking, from first principles
// ------------------------------------------
// Phones aggressively stop apps in the background to save battery. To keep
// receiving GPS while the guard's phone is in their pocket:
//   * Android runs a "foreground service": a permanent notification saying the
//     app is tracking. Android requires this, and it is also honest to the guard.
//   * iOS shows the blue location indicator in the status bar.
// The OS wakes our task (tasks/locationTask.ts) with batches of positions.
// We start tracking ONLY when a shift starts and stop it when the shift ends.
// =============================================================================
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';

import { colors } from '@/lib/theme';

export const LOCATION_TASK = 'mbpatrol-background-location';
export const TRACKING_SHIFT_KEY = 'mbpatrol.tracking.shiftId';

export interface Fix {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  mocked: boolean;
  timestamp: number;
}

export function toFix(loc: Location.LocationObject): Fix {
  return {
    latitude: loc.coords.latitude,
    longitude: loc.coords.longitude,
    accuracy: loc.coords.accuracy ?? null,
    mocked: Boolean(loc.mocked), // Android only; iOS cannot detect this
    timestamp: loc.timestamp,
  };
}

export async function ensureForegroundPermission(): Promise<boolean> {
  const current = await Location.getForegroundPermissionsAsync();
  if (current.granted) return true;
  const req = await Location.requestForegroundPermissionsAsync();
  return req.granted;
}

/**
 * Best available position within `timeoutMs`. Falls back to the last known
 * position (if under 2 minutes old) so a scan or SOS is never blocked forever.
 */
export async function getFix(timeoutMs = 10_000): Promise<Fix | null> {
  if (!(await ensureForegroundPermission())) return null;
  const fresh = Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.BestForNavigation })
    .then(toFix)
    .catch(() => null);
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs));
  const result = await Promise.race([fresh, timeout]);
  if (result) return result;
  const last = await Location.getLastKnownPositionAsync({ maxAge: 120_000 }).catch(() => null);
  return last ? toFix(last) : null;
}

export async function isTracking(): Promise<boolean> {
  try {
    return await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
  } catch {
    return false;
  }
}

/** Start background tracking for a shift. Returns false if permission was refused. */
export async function startTracking(shiftId: string): Promise<{ ok: boolean; background: boolean }> {
  if (!(await ensureForegroundPermission())) return { ok: false, background: false };
  // Background permission is a second, separate prompt ("Allow all the time").
  const bg = await Location.requestBackgroundPermissionsAsync().catch(() => ({ granted: false }));

  await AsyncStorage.setItem(TRACKING_SHIFT_KEY, shiftId);
  if (await isTracking()) return { ok: true, background: bg.granted };

  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.High,
    timeInterval: 60_000, // Android: at most one point per minute
    distanceInterval: 25, // ...or every 25 m moved
    deferredUpdatesInterval: 60_000, // iOS: batch updates to save battery
    pausesUpdatesAutomatically: false,
    activityType: Location.ActivityType.OtherNavigation,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'Patrol shift in progress',
      notificationBody: 'MB Patrol is sharing your location with supervisors until you end your shift.',
      notificationColor: colors.primary,
      killServiceOnDestroy: false,
    },
  });
  return { ok: true, background: bg.granted };
}

export async function stopTracking(): Promise<void> {
  await AsyncStorage.removeItem(TRACKING_SHIFT_KEY);
  if (await isTracking()) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  }
}
