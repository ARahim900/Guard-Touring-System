// =============================================================================
// Live alarms. Subscribes to new rows in the "alarms" table through Supabase
// Realtime (a WebSocket the server pushes changes down), so supervisors see an
// SOS or a missed checkpoint within a second, on whichever page they are.
// =============================================================================
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';

import { ALARM_TYPE } from '@/lib/labels';
import { supabase } from '@/lib/supabase';
import type { Alarm } from '@/lib/types';
import { useAuth } from './AuthContext';

interface AlarmValue {
  openCount: number;
  sosOpen: number;
  /** Increments on every realtime alarm event; pages watch it to reload. */
  version: number;
  refreshCounts: () => Promise<void>;
}

const AlarmContext = createContext<AlarmValue | null>(null);

/** Short two-tone beep using the browser's audio engine (no sound file needed). */
let audio: AudioContext | null = null; // one shared audio engine for the whole tab

function beep(urgent: boolean) {
  try {
    audio ??= new AudioContext();
    void audio.resume();
    const ctx = audio;
    const tones = urgent ? [880, 660, 880, 660] : [660];
    tones.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = f;
      gain.gain.value = 0.15;
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.25);
      osc.stop(ctx.currentTime + i * 0.25 + 0.2);
    });
  } catch {
    // Browsers block sound until the user has clicked the page once.
  }
}

export function AlarmProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  // Depend on the user id, not the session object: the session object changes on
  // every hourly token refresh, which would needlessly reconnect the alarm feed.
  const userId = session?.user.id;
  const [openCount, setOpenCount] = useState(0);
  const [sosOpen, setSosOpen] = useState(0);
  const [version, setVersion] = useState(0);

  const refreshCounts = useCallback(async () => {
    const [all, sos] = await Promise.all([
      supabase.from('alarms').select('id', { count: 'exact', head: true }).eq('status', 'open'),
      supabase.from('alarms').select('id', { count: 'exact', head: true }).eq('status', 'open').eq('type', 'sos'),
    ]);
    setOpenCount(all.count ?? 0);
    setSosOpen(sos.count ?? 0);
  }, []);

  useEffect(() => {
    if (!userId) return;
    void refreshCounts();
    const channel = supabase
      .channel('alarms-feed')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'alarms' }, async (payload) => {
        const alarm = payload.new as Alarm;
        // Shared login: prefer the name typed at Start shift, then the login name.
        const [shiftRes, profileRes] = await Promise.all([
          alarm.shift_id
            ? supabase.from('shifts').select('on_duty_name').eq('id', alarm.shift_id).maybeSingle()
            : Promise.resolve({ data: null }),
          supabase.from('profiles').select('full_name').eq('id', alarm.guard_id).maybeSingle(),
        ]);
        const who = shiftRes.data?.on_duty_name ?? profileRes.data?.full_name ?? 'A guard';
        const label = ALARM_TYPE[alarm.type].label;
        if (alarm.type === 'sos') {
          beep(true);
          toast.error(`SOS from ${who}`, { description: alarm.message, duration: 60000 });
        } else if (alarm.type !== 'scan_rejected') {
          beep(false);
          toast.warning(`${label}: ${who}`, { description: alarm.message, duration: 10000 });
        }
        setVersion((v) => v + 1);
        void refreshCounts();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'alarms' }, () => {
        setVersion((v) => v + 1);
        void refreshCounts();
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, refreshCounts]);

  const value = useMemo(() => ({ openCount, sosOpen, version, refreshCounts }), [openCount, sosOpen, version, refreshCounts]);
  return <AlarmContext.Provider value={value}>{children}</AlarmContext.Provider>;
}

export function useAlarms() {
  const ctx = useContext(AlarmContext);
  if (!ctx) throw new Error('useAlarms must be used inside AlarmProvider');
  return ctx;
}
