// Live positions, open SOS alarms and checkpoints for the maps.
// Updates come from two directions:
//   * Realtime: every new GPS point triggers a refresh (at most every 5 s).
//   * Polling every 30 s, as a safety net if the WebSocket drops.
import { useCallback, useEffect, useRef, useState } from 'react';

import { useAlarms } from '@/context/AlarmContext';
import { friendlyError } from './errors';
import { supabase } from './supabase';
import type { Alarm, Checkpoint, LivePosition } from './types';

export function useLiveData() {
  const { version } = useAlarms();
  const [positions, setPositions] = useState<LivePosition[]>([]);
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const lastLoad = useRef(0);

  const load = useCallback(async () => {
    lastLoad.current = Date.now();
    const [pos, al, cps] = await Promise.all([
      supabase.from('live_guard_positions').select('guard_id, full_name, phone, shift_id, route_name, latitude, longitude, accuracy_m, is_mocked, recorded_at'),
      supabase
        .from('alarms')
        .select('id, type, guard_id, shift_id, checkpoint_id, scan_id, message, latitude, longitude, accuracy_m, status, acknowledged_at, resolved_at, resolution_note, created_at, profiles!alarms_guard_id_fkey(full_name, phone), shifts!alarms_shift_id_fkey(on_duty_name, on_duty_ref)')
        .eq('type', 'sos')
        .neq('status', 'resolved')
        .order('created_at', { ascending: false }).returns<Alarm[]>(),
      supabase.from('checkpoints').select('id, name, code, nfc_uid, description, latitude, longitude, radius_m, active').eq('active', true),
    ]);
    if (pos.error || al.error || cps.error) {
      setError(friendlyError(pos.error ?? al.error ?? cps.error));
      setLoading(false);
      return;
    }
    setError(null);
    if (pos.data) setPositions(pos.data as LivePosition[]);
    if (al.data) setAlarms(al.data as Alarm[]);
    if (cps.data) setCheckpoints(cps.data as Checkpoint[]);
    setUpdatedAt(new Date());
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load, version]);

  useEffect(() => {
    const channel = supabase
      .channel('pings-feed')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'location_pings' }, () => {
        if (Date.now() - lastLoad.current > 5000) void load();
      })
      .subscribe();
    const timer = setInterval(() => void load(), 30000);
    return () => {
      clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, [load]);

  return { positions, alarms, checkpoints, loading, error, updatedAt, reload: load };
}
