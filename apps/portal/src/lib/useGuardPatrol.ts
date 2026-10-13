import { useCallback, useEffect, useRef, useState } from 'react';
import { cacheShift, cachedShift, readReceipts, uploadReceipts, type PatrolReceipt } from '@/lib/guardOutbox';
import { fetchPatrol, submitReceipt, type PatrolSnapshot } from '@/lib/guardPatrol';
import { friendlyError } from '@/lib/errors';

export function useGuardPatrol(userId: string) {
  const [snapshot, setSnapshot] = useState<PatrolSnapshot | null>(null);
  const [receipts, setReceipts] = useState<PatrolReceipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [cached, setCached] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef<Promise<void> | null>(null);

  const load = useCallback(async () => {
    try {
      const fresh = await fetchPatrol(userId);
      setSnapshot(fresh);
      setCached(false);
      setError(null);
      await cacheShift(userId, fresh);
    } catch (cause) {
      setError(friendlyError(cause));
      try {
        const saved = await cachedShift<PatrolSnapshot>(userId);
        if (saved) { setSnapshot(saved); setCached(true); }
      } catch { setError('Phone storage is unavailable. Keep internet access and allow site storage.'); }
    } finally { setLoading(false); }
  }, [userId]);

  const refresh = useCallback((afterCurrent = false): Promise<void> => {
    // A scan saved during a background upload needs its own pass after that upload.
    if (running.current) return afterCurrent ? running.current.then(() => refresh()) : running.current;
    const task = (async () => {
      setSyncing(true);
      let uploadError: string | null = null;
      try { await uploadReceipts(userId, submitReceipt); }
      catch (cause) { uploadError = friendlyError(cause); }
      try { setReceipts(await readReceipts(userId)); }
      catch { uploadError = 'Phone storage is unavailable. Scans cannot be saved safely.'; }
      await load();
      if (uploadError) setError(uploadError);
      setSyncing(false);
    })().finally(() => { running.current = null; });
    running.current = task;
    return task;
  }, [load, userId]);

  useEffect(() => {
    void refresh();
    const online = () => { void refresh(); };
    const visible = () => { if (!document.hidden) void refresh(); };
    const timer = window.setInterval(() => { if (!document.hidden && navigator.onLine) void refresh(); }, 30000);
    window.addEventListener('online', online);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('online', online);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [refresh]);

  return { snapshot, receipts, loading, syncing, cached, error, refresh };
}
