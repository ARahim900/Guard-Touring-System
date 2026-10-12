// =============================================================================
// The guard's current shift and its checkpoints, shared by all tabs.
// =============================================================================
// "Current shift" = the active one if any; otherwise the next scheduled shift
// that has not yet ended. Data is cached on the phone, and checkpoints scanned
// offline are ticked off locally ("Pending upload") until the server confirms.
// =============================================================================
import * as Location from 'expo-location';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { friendlyError } from '@/lib/errors';
import { reportError } from '@/lib/sentry';
import { supabase } from '@/lib/supabase';
import type { Shift, ShiftCheckpoint } from '@/lib/types';
import { readCache, writeCache } from '@/offline/cache';
import { localScanCheckpoints } from '@/offline/outbox';
import { subscribeSync, syncNow } from '@/offline/sync';
import { isTracking, startTracking, stopTracking } from '@/services/location';
import { useAuth } from './AuthProvider';

export interface CheckpointView extends ShiftCheckpoint {
  /** Scanned on this phone but not yet confirmed by the server. */
  pendingUpload: boolean;
}

interface ShiftContextValue {
  shift: Shift | null;
  checkpoints: CheckpointView[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  /** True when showing cached data because the server could not be reached. */
  fromCache: boolean;
  updatedAt: string | null;
  refresh: () => Promise<void>;
  /** Re-read the local outbox (call after saving a scan). */
  reloadLocal: () => Promise<void>;
  /** Start the shift and record who is on duty (the login is shared). */
  startShift: (onDutyName: string, onDutyRef?: string) => Promise<{ ok: boolean; message: string }>;
  endShift: () => Promise<{ ok: boolean; message: string }>;
}

const ShiftContext = createContext<ShiftContextValue | null>(null);

interface Snapshot {
  shift: Shift | null;
  checkpoints: ShiftCheckpoint[];
}

async function fetchSnapshot(guardId: string): Promise<Snapshot> {
  const { data: shifts, error } = await supabase
    .from('shifts')
    .select('*, routes(name)')
    .eq('guard_id', guardId)
    .in('status', ['active', 'scheduled'])
    .gte('scheduled_end', new Date(Date.now() - 2 * 3600 * 1000).toISOString())
    .order('scheduled_start', { ascending: true })
    .limit(5);
  if (error) throw error;

  const list = (shifts ?? []) as Shift[];
  const shift = list.find((s) => s.status === 'active') ?? list[0] ?? null;
  if (!shift) return { shift: null, checkpoints: [] };

  const { data: cps, error: cpError } = await supabase
    .from('shift_checkpoint_status')
    .select('*')
    .eq('shift_id', shift.id)
    .order('sequence', { ascending: true });
  if (cpError) throw cpError;
  return { shift, checkpoints: (cps ?? []) as ShiftCheckpoint[] };
}

export function ShiftProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const guardId = session?.user.id ?? null;

  const [snapshot, setSnapshot] = useState<Snapshot>({ shift: null, checkpoints: [] });
  const [local, setLocal] = useState<Map<string, unknown>>(new Map());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const loadedOnce = useRef(false);

  /** Mark checkpoints scanned on this phone that the server has not confirmed yet. */
  const refreshLocal = useCallback(async (shiftId: string | undefined) => {
    if (!shiftId) return setLocal(new Map());
    setLocal(await localScanCheckpoints(shiftId));
  }, []);

  const load = useCallback(async () => {
    if (!guardId) return;
    try {
      const snap = await fetchSnapshot(guardId);
      setSnapshot(snap);
      setFromCache(false);
      setError(null);
      const now = new Date().toISOString();
      setUpdatedAt(now);
      await writeCache(`shift.${guardId}`, snap);
      await refreshLocal(snap.shift?.id);
    } catch (e) {
      const cached = await readCache<Snapshot>(`shift.${guardId}`);
      if (cached) {
        setSnapshot(cached.value);
        setUpdatedAt(cached.savedAt);
        setFromCache(true);
        await refreshLocal(cached.value.shift?.id);
      }
      setError(friendlyError(e));
    } finally {
      setLoading(false);
      loadedOnce.current = true;
    }
  }, [guardId, refreshLocal]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await syncNow().catch(() => undefined); // upload first, so the server view is current
    await load();
    setRefreshing(false);
  }, [load]);

  // Initial load + reload whenever the app returns to the foreground.
  useEffect(() => {
    // A different user signed in: never show the previous user's shift.
    setSnapshot({ shift: null, checkpoints: [] });
    setLocal(new Map());
    if (!guardId) return;
    setLoading(true);
    void load();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void load();
    });
    return () => sub.remove();
  }, [guardId, load]);

  // When the sync engine finishes uploading, re-read the server view.
  useEffect(() => {
    let lastSync: string | null = null;
    return subscribeSync((s) => {
      if (s.lastSyncAt && s.lastSyncAt !== lastSync && !s.syncing) {
        lastSync = s.lastSyncAt;
        if (loadedOnce.current) void load();
      }
    });
  }, [load]);

  // Keep background tracking in step with the shift state (e.g. after a phone
  // restart, or a supervisor/auto-close ending the shift on the server).
  useEffect(() => {
    if (loading || fromCache) return;
    (async () => {
      try {
        const tracking = await isTracking();
        const shift = snapshot.shift;
        if (shift?.status === 'active' && !tracking) {
          const perm = await Location.getForegroundPermissionsAsync();
          if (perm.granted && guardId) await startTracking(shift.id, guardId);
        } else if (shift?.status !== 'active' && tracking) {
          await stopTracking();
        }
      } catch (e) {
        reportError(e, { where: 'trackingReconcile' });
      }
    })();
  }, [snapshot.shift, loading, fromCache]);

  const startShift = useCallback(async (onDutyName: string, onDutyRef?: string) => {
    const shift = snapshot.shift;
    if (!shift) return { ok: false, message: 'No shift is assigned to you.' };
    const name = onDutyName.trim();
    if (name.length < 3) return { ok: false, message: 'Enter your full name to start the shift.' };
    const { error: rpcError } = await supabase.rpc('start_shift_as', {
      p_shift_id: shift.id,
      p_on_duty_name: name,
      p_on_duty_ref: onDutyRef?.trim() || null,
    });
    if (rpcError) return { ok: false, message: friendlyError(rpcError) };
    const tracking = await startTracking(shift.id, guardId!).catch((e) => {
      reportError(e, { where: 'startTracking' });
      return { ok: false, background: false };
    });
    await load();
    if (!tracking.ok) {
      return { ok: true, message: 'Shift started, but location is off. Turn on location so scans can be verified.' };
    }
    if (!tracking.background) {
      return { ok: true, message: 'Shift started. Allow location "All the time" so tracking continues in your pocket.' };
    }
    return { ok: true, message: 'Shift started. Have a safe patrol.' };
  }, [snapshot.shift, load, guardId]);

  const endShift = useCallback(async () => {
    const shift = snapshot.shift;
    if (!shift) return { ok: false, message: 'No active shift.' };
    await syncNow().catch(() => undefined); // push the last GPS points first
    const { error: rpcError } = await supabase.rpc('end_shift', { p_shift_id: shift.id });
    if (rpcError) return { ok: false, message: friendlyError(rpcError) };
    await stopTracking().catch(() => undefined);
    await load();
    return { ok: true, message: 'Shift ended. Thank you.' };
  }, [snapshot.shift, load]);

  const reloadLocal = useCallback(() => refreshLocal(snapshot.shift?.id), [refreshLocal, snapshot.shift?.id]);

  const checkpoints = useMemo<CheckpointView[]>(
    () =>
      snapshot.checkpoints.map((cp) => ({
        ...cp,
        pendingUpload: !cp.completed && local.has(cp.checkpoint_id),
      })),
    [snapshot.checkpoints, local],
  );

  const value = useMemo(
    () => ({
      shift: snapshot.shift,
      checkpoints,
      loading,
      refreshing,
      error,
      fromCache,
      updatedAt,
      refresh,
      reloadLocal,
      startShift,
      endShift,
    }),
    [snapshot.shift, checkpoints, loading, refreshing, error, fromCache, updatedAt, refresh, reloadLocal, startShift, endShift],
  );

  return <ShiftContext.Provider value={value}>{children}</ShiftContext.Provider>;
}

export function useShift(): ShiftContextValue {
  const ctx = useContext(ShiftContext);
  if (!ctx) throw new Error('useShift must be used inside ShiftProvider');
  return ctx;
}
