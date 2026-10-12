// =============================================================================
// Sync engine: empties the outbox into Supabase whenever it can.
// =============================================================================
// When does it run?
//   * when the phone regains a connection (NetInfo event),
//   * when the app comes back to the foreground,
//   * every 60 seconds while the app is open,
//   * immediately after a new scan is saved,
//   * from the background location task (for GPS points).
// Order matters: a scan must exist on the server before its photos, because
// the storage security rule checks "is this the guard's scan?".
//
// Two kinds of failure:
//   * Network failure  -> keep the item, try again later (nothing is lost).
//   * Server rejection -> the server said "no" (e.g. shift not assigned).
//     Retrying will never help, so mark it "failed" and show the reason.
// =============================================================================
import NetInfo from '@react-native-community/netinfo';
import { File } from 'expo-file-system';
import { AppState } from 'react-native';

import { friendlyError, isNetworkError, isServerRejection } from '@/lib/errors';
import { reportError } from '@/lib/sentry';
import { MEDIA_BUCKET, supabase } from '@/lib/supabase';
import type { ScanRow } from '@/lib/types';
import {
  bumpAttachmentAttempt,
  bumpScanAttempt,
  deletePings,
  deleteSos,
  markAttachmentUploaded,
  markScanFailed,
  markScanSynced,
  pendingCounts,
  pendingScans,
  pendingSos,
  purgeOldRecords,
  takePings,
  uploadableAttachments,
  type PendingCounts,
} from './outbox';

export interface SyncState {
  online: boolean;
  syncing: boolean;
  pending: PendingCounts;
  lastSyncAt: string | null;
  lastError: string | null;
}

let state: SyncState = {
  online: true,
  syncing: false,
  pending: { scans: 0, attachments: 0, pings: 0, failed: 0 },
  lastSyncAt: null,
  lastError: null,
};
const listeners = new Set<(s: SyncState) => void>();

function setState(patch: Partial<SyncState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l(state));
}

export function getSyncState() {
  return state;
}

export function subscribeSync(listener: (s: SyncState) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function refreshPendingCounts() {
  try {
    setState({ pending: await pendingCounts() });
  } catch (e) {
    reportError(e, { where: 'refreshPendingCounts' });
  }
}

/** Thrown inside a sync step to stop the whole run when the network drops. */
class OfflineError extends Error {}

async function syncSos() {
  for (const item of await pendingSos()) {
    const { error } = await supabase.rpc('trigger_sos', {
      ...item.payload,
      p_message: `${item.payload.p_message ?? 'SOS'} (sent late: raised ${item.created_at})`,
    });
    if (error) {
      if (isNetworkError(error) || !isServerRejection(error)) throw new OfflineError(error.message);
      reportError(error, { where: 'syncSos' });
    }
    await deleteSos(item.id);
  }
}

async function syncScans() {
  for (const scan of await pendingScans()) {
    // device_sent_at is read NOW, at the moment of sending. The server compares
    // it with its own clock to measure how wrong the phone's clock is.
    const { data, error } = await supabase.rpc('submit_scan', {
      ...scan.payload,
      p_device_sent_at: new Date().toISOString(),
    });
    if (error) {
      if (isServerRejection(error)) {
        await markScanFailed(scan.id, friendlyError(error));
        continue;
      }
      await bumpScanAttempt(scan.id, friendlyError(error));
      throw new OfflineError(error.message);
    }
    const row = data as unknown as Pick<ScanRow, 'validation' | 'flags'>;
    await markScanSynced(scan.id, row.validation, row.flags ?? []);
  }
}

async function syncAttachments(guardId: string) {
  for (const att of await uploadableAttachments()) {
    const ext = att.mime_type === 'image/jpeg' ? 'jpg' : 'm4a';
    const path = `scans/${att.scan_id}/${att.id}.${ext}`;
    const file = new File(att.local_uri);

    if (!file.exists) {
      await bumpAttachmentAttempt(att.id, 'File missing on phone', true);
      continue;
    }

    // 1. Upload the file. upsert=true makes a retry after a half-finished
    //    upload overwrite it instead of failing with "already exists".
    const bytes = await file.bytes();
    const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const { error: upError } = await supabase.storage.from(MEDIA_BUCKET).upload(path, body, {
      contentType: att.mime_type,
      upsert: true,
    });
    if (upError) {
      const status = Number((upError as { statusCode?: string | number }).statusCode ?? 0);
      const permanent = status === 400 || status === 403 || status === 413;
      await bumpAttachmentAttempt(att.id, friendlyError(upError), permanent);
      if (!permanent) throw new OfflineError(upError.message);
      continue;
    }

    // 2. Record its metadata. ignoreDuplicates = "do nothing if this id exists".
    const { error: rowError } = await supabase.from('scan_attachments').upsert(
      {
        id: att.id,
        scan_id: att.scan_id,
        guard_id: guardId,
        type: att.type,
        source: att.source,
        storage_path: path,
        mime_type: att.mime_type,
        size_bytes: att.size_bytes,
        duration_sec: att.duration_sec,
        captured_at: att.captured_at,
        exif_taken_at: att.exif_taken_at,
      },
      { onConflict: 'id', ignoreDuplicates: true },
    );
    if (rowError) {
      const permanent = isServerRejection(rowError);
      await bumpAttachmentAttempt(att.id, friendlyError(rowError), permanent);
      if (!permanent) throw new OfflineError(rowError.message);
      continue;
    }
    await markAttachmentUploaded(att.id);
  }
}

async function syncPings(guardId: string) {
  // Send in batches of 200 until the queue is empty.
  for (let i = 0; i < 20; i++) {
    const batch = await takePings(200);
    if (!batch.length) return;
    const { error } = await supabase.from('location_pings').insert(
      batch.map((p) => ({
        guard_id: guardId,
        shift_id: p.shift_id,
        latitude: p.latitude,
        longitude: p.longitude,
        accuracy_m: p.accuracy_m,
        speed_mps: p.speed_mps,
        is_mocked: Boolean(p.is_mocked),
        recorded_at: p.recorded_at,
      })),
    );
    if (error) {
      if (isServerRejection(error)) {
        // e.g. the shift was deleted: these points can never be stored.
        reportError(error, { where: 'syncPings' });
        await deletePings(batch.map((p) => p.id));
        continue;
      }
      throw new OfflineError(error.message);
    }
    await deletePings(batch.map((p) => p.id));
  }
}

let running: Promise<void> | null = null;

/**
 * Upload everything in the outbox. Safe to call many times: if a run is
 * already in progress, callers wait for that run instead of starting another.
 */
export function syncNow(options: { pingsOnly?: boolean } = {}): Promise<void> {
  if (running) return running;
  running = (async () => {
    const { data } = await supabase.auth.getSession();
    const guardId = data.session?.user.id;
    if (!guardId) return;

    setState({ syncing: true });
    try {
      if (!options.pingsOnly) {
        await syncSos();
        await syncScans();
        await syncAttachments(guardId);
      }
      await syncPings(guardId);
      if (!options.pingsOnly) await purgeOldRecords();
      setState({ lastSyncAt: new Date().toISOString(), lastError: null });
    } catch (e) {
      if (!(e instanceof OfflineError)) reportError(e, { where: 'syncNow' });
      setState({ lastError: friendlyError(e) });
    } finally {
      setState({ syncing: false });
      await refreshPendingCounts();
    }
  })().finally(() => {
    running = null;
  });
  return running;
}

let started = false;

/** Wire up the automatic triggers. Called once from the root layout. */
export function startSyncEngine() {
  if (started) return;
  started = true;

  NetInfo.addEventListener((net) => {
    const online = Boolean(net.isConnected) && net.isInternetReachable !== false;
    const cameOnline = online && !state.online;
    setState({ online });
    if (cameOnline) void syncNow();
  });

  AppState.addEventListener('change', (s) => {
    if (s === 'active') void syncNow();
  });

  setInterval(() => {
    if (AppState.currentState === 'active' && state.online) void syncNow();
  }, 60_000);

  void refreshPendingCounts();
  void syncNow();
}
