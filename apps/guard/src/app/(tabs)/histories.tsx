// =============================================================================
// HISTORIES tab: Records (my scans, by day) and Alarms (missed checkpoints, SOS).
// =============================================================================
// Records merge two sources:
//   * the server (scans that arrived), and
//   * the phone's outbox (scans still "Pending upload" or that "Failed").
// =============================================================================
import { useFocusEffect } from 'expo-router';
import { AlertTriangle, BellRing, ChevronLeft, ChevronRight, ClipboardCheck, Paperclip, Siren } from 'lucide-react-native';
import { useCallback, useState, type ReactNode } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { AppText, Badge, Button, Card, EmptyState, LoadingView, Screen, Segmented } from '@/components/ui';
import { useAuth } from '@/context/AuthProvider';
import { useToast } from '@/context/ToastProvider';
import { friendlyError } from '@/lib/errors';
import { ALARM_LABEL, ALARM_STATUS, flagText, METHOD_LABEL, VALIDATION_LABEL } from '@/lib/labels';
import { supabase } from '@/lib/supabase';
import { colors, fonts, radius, spacing } from '@/lib/theme';
import { addDays, formatDate, formatDateTime, formatTime, muscatDayKey, muscatDayRange } from '@/lib/time';
import type { AlarmRow, ScanRow } from '@/lib/types';
import { readCache, writeCache } from '@/offline/cache';
import { listLocalScans, retryScan, type LocalScan } from '@/offline/outbox';
import { refreshPendingCounts, syncNow } from '@/offline/sync';

type Tab = 'records' | 'alarms';

interface RecordItem {
  id: string;
  checkpointName: string;
  time: string;
  method: ScanRow['method'];
  status: ScanRow['status'];
  note: string | null;
  validation: ScanRow['validation'] | null;
  flags: string[];
  attachments: number;
  local: LocalScan | null;
}

export default function HistoriesScreen() {
  const [tab, setTab] = useState<Tab>('records');
  return (
    <Screen scroll={false} contentStyle={{ paddingBottom: 0 }}>
      <AppText variant="heading">Histories</AppText>
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: 'records', label: 'Records' },
          { value: 'alarms', label: 'Alarms' },
        ]}
      />
      <View style={{ flex: 1 }}>{tab === 'records' ? <Records /> : <Alarms />}</View>
    </Screen>
  );
}

// --------------------------------------------------------------- Records
function Records() {
  const toast = useToast();
  const [day, setDay] = useState(muscatDayKey());
  const [items, setItems] = useState<RecordItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const today = muscatDayKey();

  const load = useCallback(async () => {
    const { from, to } = muscatDayRange(day);
    const local = await listLocalScans(from, to);
    const { data, error } = await supabase
      .from('scans')
      .select('id, shift_id, checkpoint_id, method, status, note, effective_time, distance_m, accuracy_m, validation, flags, is_on_time, expected_attachments, checkpoints(name), scan_attachments(count)')
      .gte('effective_time', from)
      .lt('effective_time', to)
      .order('effective_time', { ascending: false });

    const byId = new Map<string, RecordItem>();
    if (!error) {
      for (const s of (data ?? []) as unknown as ScanRow[]) {
        byId.set(s.id, {
          id: s.id,
          checkpointName: s.checkpoints?.name ?? 'Checkpoint',
          time: s.effective_time,
          method: s.method,
          status: s.status,
          note: s.note,
          validation: s.validation,
          flags: s.flags,
          attachments: s.scan_attachments?.[0]?.count ?? 0,
          local: null,
        });
      }
      setNote(null);
    } else {
      setNote(`Offline. Showing scans saved on this phone only. (${friendlyError(error)})`);
    }
    // Add phone-only scans (not on the server yet, or offline).
    for (const l of local) {
      const existing = byId.get(l.id);
      if (existing) {
        if (l.pending_attachments > 0) existing.local = l; // still uploading photos
        continue;
      }
      byId.set(l.id, {
        id: l.id,
        checkpointName: l.checkpoint_name,
        time: l.device_time,
        method: l.payload.p_method,
        status: l.payload.p_status,
        note: l.payload.p_note,
        validation: l.validation,
        flags: l.flags,
        attachments: l.payload.p_expected_attachments,
        local: l,
      });
    }
    setItems([...byId.values()].sort((a, b) => b.time.localeCompare(a.time)));
    setLoading(false);
  }, [day]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function onRefresh() {
    setRefreshing(true);
    await syncNow().catch(() => undefined);
    await load();
    setRefreshing(false);
  }

  async function onRetry(id: string) {
    await retryScan(id);
    await refreshPendingCounts();
    toast.info('Retrying upload…');
    await syncNow();
    await load();
  }

  return (
    <View style={{ flex: 1, gap: spacing.md, marginTop: spacing.md }}>
      <View style={styles.dayNav}>
        <Pressable onPress={() => setDay(addDays(day, -1))} style={styles.navBtn} accessibilityLabel="Previous day">
          <ChevronLeft size={26} color={colors.primary} />
        </Pressable>
        <AppText variant="title">{day === today ? 'Today' : formatDate(`${day}T12:00:00+04:00`)}</AppText>
        <Pressable
          onPress={() => day < today && setDay(addDays(day, 1))}
          style={[styles.navBtn, day >= today && { opacity: 0.3 }]}
          disabled={day >= today}
          accessibilityLabel="Next day"
        >
          <ChevronRight size={26} color={colors.primary} />
        </Pressable>
      </View>
      {note ? <AppText variant="caption">{note}</AppText> : null}

      {loading ? (
        <LoadingView />
      ) : (
        <ListScroll refreshing={refreshing} onRefresh={onRefresh}>
          {items.length === 0 ? (
            <EmptyState icon={ClipboardCheck} title="No scans" message="Scans you make on this day appear here." />
          ) : (
            items.map((it) => (
              <Card key={it.id} style={{ gap: spacing.sm }}>
                <View style={styles.rowBetween}>
                  <AppText variant="body" style={{ fontFamily: fonts.semibold, flex: 1 }}>
                    {it.checkpointName}
                  </AppText>
                  <AppText variant="label">{formatTime(it.time)}</AppText>
                </View>
                <View style={styles.badges}>
                  <Badge label={METHOD_LABEL[it.method]} tone="brand" />
                  {it.status === 'issue' ? <Badge label="Issue found" tone="danger" /> : <Badge label="Normal" tone="neutral" />}
                  {it.local?.status === 'pending' ? <Badge label="Pending upload" tone="info" /> : null}
                  {it.local?.status === 'failed' ? <Badge label="Upload failed" tone="danger" /> : null}
                  {it.local && it.local.status === 'synced' && it.local.pending_attachments > 0 ? (
                    <Badge label={`${it.local.pending_attachments} file(s) pending upload`} tone="info" />
                  ) : null}
                  {it.validation ? <Badge {...VALIDATION_LABEL[it.validation]} /> : null}
                </View>
                {it.flags.length ? <AppText variant="caption">{flagText(it.flags)}</AppText> : null}
                {it.note ? <AppText variant="body">“{it.note}”</AppText> : null}
                {it.attachments > 0 ? (
                  <View style={styles.inline}>
                    <Paperclip size={16} color={colors.textMuted} />
                    <AppText variant="caption">{it.attachments} attachment(s)</AppText>
                  </View>
                ) : null}
                {it.local?.status === 'failed' ? (
                  <>
                    <AppText variant="label" style={{ color: colors.dangerText }}>
                      {it.local.last_error}
                    </AppText>
                    <Button title="Retry upload" variant="outline" onPress={() => void onRetry(it.id)} />
                  </>
                ) : null}
              </Card>
            ))
          )}
        </ListScroll>
      )}
    </View>
  );
}

// ---------------------------------------------------------------- Alarms
function Alarms() {
  const { session } = useAuth();
  const [alarms, setAlarms] = useState<AlarmRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session) return;
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const { data, error } = await supabase
      .from('alarms')
      .select('id, type, status, message, created_at, resolution_note')
      .eq('guard_id', session.user.id)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) {
      const cached = await readCache<AlarmRow[]>('alarms');
      if (cached) setAlarms(cached.value);
      setNote(`Offline. Showing alarms saved ${cached ? formatDateTime(cached.savedAt) : 'earlier'}.`);
    } else {
      setAlarms((data ?? []) as AlarmRow[]);
      setNote(null);
      await writeCache('alarms', data);
    }
    setLoading(false);
  }, [session]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  if (loading) return <LoadingView />;

  return (
    <View style={{ flex: 1, gap: spacing.md, marginTop: spacing.md }}>
      {note ? <AppText variant="caption">{note}</AppText> : null}
      <ListScroll refreshing={refreshing} onRefresh={onRefresh}>
        {alarms.length === 0 ? (
          <EmptyState icon={BellRing} title="No alarms" message="Missed checkpoints and SOS alerts from the last 30 days appear here." />
        ) : (
          alarms.map((a) => {
            const Icon = a.type === 'sos' ? Siren : AlertTriangle;
            return (
              <Card key={a.id} style={{ gap: spacing.sm }}>
                <View style={styles.inline}>
                  <View style={[styles.alarmIcon, a.type === 'sos' && { backgroundColor: colors.dangerBg }]}>
                    <Icon size={20} color={a.type === 'sos' ? colors.dangerText : colors.warningText} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <AppText variant="body" style={{ fontFamily: fonts.semibold }}>
                      {ALARM_LABEL[a.type]}
                    </AppText>
                    <AppText variant="caption">{formatDateTime(a.created_at)}</AppText>
                  </View>
                  <Badge {...ALARM_STATUS[a.status]} />
                </View>
                <AppText variant="body">{a.message}</AppText>
                {a.resolution_note ? <AppText variant="caption">Note: {a.resolution_note}</AppText> : null}
              </Card>
            );
          })
        )}
      </ListScroll>
    </View>
  );
}

function ListScroll({ children, refreshing, onRefresh }: { children: ReactNode; refreshing: boolean; onRefresh: () => void }) {
  return (
    <ScrollView
      contentContainerStyle={{ gap: spacing.md, paddingBottom: 120 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  dayNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  navBtn: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  inline: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  alarmIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.warningBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
