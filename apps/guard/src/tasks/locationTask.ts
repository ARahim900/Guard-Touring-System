// =============================================================================
// Background location task.
// =============================================================================
// This file is imported by the app's entry file (index.ts), BEFORE anything
// else. When Android restarts the app in the background to deliver positions,
// it runs only the entry file (no screens), so the task must be defined there.
//
// The task does as little as possible: save the points to the local outbox,
// then try to upload them. If there is no signal, they wait in the outbox.
// =============================================================================
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { LocationObject } from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { addPings } from '@/offline/outbox';
import { syncNow } from '@/offline/sync';
import { LOCATION_TASK, TRACKING_KEY, type TrackingTarget } from '@/services/location';

TaskManager.defineTask<{ locations: LocationObject[] }>(LOCATION_TASK, async ({ data, error }) => {
  if (error || !data?.locations?.length) return;

  const raw = await AsyncStorage.getItem(TRACKING_KEY);
  if (!raw) return; // no active shift: never store a position
  const { shiftId, guardId } = JSON.parse(raw) as TrackingTarget;

  await addPings(
    data.locations.map((l) => ({
      guard_id: guardId,
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
