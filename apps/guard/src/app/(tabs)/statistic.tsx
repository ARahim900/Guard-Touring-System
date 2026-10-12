// =============================================================================
// STATISTIC tab: the guard's own completion and punctuality.
//   Completion  = checkpoints visited ÷ checkpoints that were due
//   Punctuality = visits made on time ÷ checkpoints visited
// Calculated on the server (patrol_stats) so the guard, the portal and the
// monthly PDF all show exactly the same numbers.
// =============================================================================
import { useFocusEffect } from 'expo-router';
import { BarChart3 } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';

import { AppText, Card, EmptyState, LoadingView, ProgressBar, Screen, SectionTitle, Segmented } from '@/components/ui';
import { useAuth } from '@/context/AuthProvider';
import { friendlyError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { colors, fonts, spacing } from '@/lib/theme';
import { formatDateTime, muscatDayKey, muscatDayRange } from '@/lib/time';
import type { PatrolStats } from '@/lib/types';
import { readCache, writeCache } from '@/offline/cache';

type Period = '7d' | '30d' | 'month';

function rangeFor(period: Period): { from: string; to: string } {
  const now = new Date();
  if (period === 'month') {
    const key = muscatDayKey(now).slice(0, 8) + '01';
    return { from: muscatDayRange(key).from, to: now.toISOString() };
  }
  const days = period === '7d' ? 7 : 30;
  return { from: new Date(now.getTime() - days * 86400000).toISOString(), to: now.toISOString() };
}

function pct(v: number | null) {
  return v === null ? '–' : `${Math.round(v)}%`;
}

function rateColor(v: number | null) {
  if (v === null) return colors.textMuted;
  if (v >= 95) return colors.successText;
  if (v >= 80) return colors.warningText;
  return colors.dangerText;
}

export default function StatisticScreen() {
  const { session } = useAuth();
  const [period, setPeriod] = useState<Period>('7d');
  const [stats, setStats] = useState<PatrolStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session) return;
    const { from, to } = rangeFor(period);
    const { data, error } = await supabase.rpc('patrol_stats', { p_guard_id: session.user.id, p_from: from, p_to: to });
    if (error) {
      const cached = await readCache<PatrolStats>(`stats.${period}`);
      if (cached) {
        setStats(cached.value);
        setNote(`Offline. Showing figures saved ${formatDateTime(cached.savedAt)}.`);
      } else {
        setNote(friendlyError(error));
      }
    } else {
      setStats(data as PatrolStats);
      setNote(null);
      await writeCache(`stats.${period}`, data);
    }
    setLoading(false);
  }, [session, period]);

  // Reload every time the tab is opened (figures change after each scan).
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

  const daily = stats?.daily.slice(-14) ?? [];

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}>
      <AppText variant="heading">My performance</AppText>
      <Segmented
        value={period}
        onChange={(p) => {
          setLoading(true);
          setPeriod(p);
        }}
        options={[
          { value: '7d', label: '7 days' },
          { value: '30d', label: '30 days' },
          { value: 'month', label: 'This month' },
        ]}
      />
      {note ? <AppText variant="caption">{note}</AppText> : null}

      {loading ? (
        <LoadingView message="Calculating…" />
      ) : !stats || stats.expected === 0 ? (
        <Card>
          <EmptyState icon={BarChart3} title="No data yet" message="Your figures appear once checkpoints fall due on your shifts." />
        </Card>
      ) : (
        <>
          <View style={styles.tiles}>
            <Card style={styles.tile}>
              <AppText variant="label">Completion</AppText>
              <AppText variant="display" style={{ color: rateColor(stats.completion_rate) }}>
                {pct(stats.completion_rate)}
              </AppText>
              <ProgressBar value={stats.completion_rate ?? 0} color={colors.success} />
              <AppText variant="caption">
                {stats.completed} of {stats.expected} checkpoints
              </AppText>
            </Card>
            <Card style={styles.tile}>
              <AppText variant="label">Punctuality</AppText>
              <AppText variant="display" style={{ color: rateColor(stats.punctuality_rate) }}>
                {pct(stats.punctuality_rate)}
              </AppText>
              <ProgressBar value={stats.punctuality_rate ?? 0} color={colors.info} />
              <AppText variant="caption">
                {stats.on_time} of {stats.completed} on time
              </AppText>
            </Card>
          </View>

          <Card>
            <Row label="Shifts" value={stats.shifts} />
            <Row label="Missed shifts" value={stats.shifts_missed} alert={stats.shifts_missed > 0} />
            <Row label="Issues reported" value={stats.incidents} />
            <Row label="Scans not accepted" value={stats.rejected_scans} alert={stats.rejected_scans > 0} />
            <Row label="SOS raised" value={stats.sos} />
          </Card>

          {daily.length > 1 ? (
            <>
              <SectionTitle>Daily completion</SectionTitle>
              <Card>
                <View style={styles.chart} accessibilityLabel="Daily completion chart">
                  {daily.map((d) => {
                    const rate = d.expected ? (d.completed / d.expected) * 100 : 0;
                    return (
                      <View key={d.day} style={styles.barCol}>
                        <AppText variant="caption" style={{ fontFamily: fonts.semibold }}>
                          {Math.round(rate)}
                        </AppText>
                        <View style={styles.barTrack}>
                          <View style={[styles.bar, { height: `${Math.max(rate, 2)}%` }]} />
                        </View>
                        <AppText variant="caption">{d.day.slice(8, 10)}</AppText>
                      </View>
                    );
                  })}
                </View>
                <AppText variant="caption">% of due checkpoints visited, by day of month</AppText>
              </Card>
            </>
          ) : null}
        </>
      )}
    </Screen>
  );
}

function Row({ label, value, alert }: { label: string; value: number; alert?: boolean }) {
  return (
    <View style={styles.row}>
      <AppText variant="body">{label}</AppText>
      <AppText variant="body" style={{ fontFamily: fonts.bold, color: alert ? colors.dangerText : colors.text }}>
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', gap: spacing.md },
  tile: { flex: 1, gap: spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 160 },
  barCol: { flex: 1, alignItems: 'center', gap: 4, height: '100%' },
  barTrack: { flex: 1, width: '100%', justifyContent: 'flex-end' },
  bar: { width: '100%', backgroundColor: colors.primary, borderTopLeftRadius: 3, borderTopRightRadius: 3 },
});
