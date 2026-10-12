// =============================================================================
// Background location task.
// =============================================================================
// This file MUST be imported at the very top of the app (src/app/_layout.tsx)
// because when the OS wakes the app in the background to deliver positions,
// it only runs the startup code; the task has to be defined by then.
//
// The task does as little as possible: save the points to the local outbox,
// then try to upload them. If there is no signal, they wait in the outbox.
// =============================================================================
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { LocationObject } from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { addPings } from '@/offline/outbox';
import { syncNow } from '@/offline/sync';
import { LOCATION_TASK, TRACKING_SHIFT_KEY } from '@/services/location';

TaskManager.defineTask<{ locations: LocationObject[] }>(LOCATION_TASK, async ({ data, error }) => {
  if (error || !data?.locations?.length) return;

  const shiftId = await AsyncStorage.getItem(TRACKING_SHIFT_KEY);
  if (!shiftId) return; // no active shift: never store a position

  await addPings(
    data.locations.map((l) => ({
      shift_id: shiftId,
      latitude: l.coords.latitude,
      longitude: l.coords.longitude,
      accuracy_m: l.coords.accuracy ?? null,
      speed_mps: l.coords.speed ?? null,
      is_mocked: Boolean(l.mocked),
      recorded_at: new Date(l.timestamp).toISOString(),
    })),
  );

  try {
    await syncNow({ pingsOnly: true });
  } catch {
    // Offline: points stay in the outbox until the next sync.
  }
});
