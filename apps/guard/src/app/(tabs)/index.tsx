// =============================================================================
// WORK tab: today's shift, the assigned route, and each checkpoint's status.
// =============================================================================
import { router } from 'expo-router';
import { CheckCircle2, Circle, CloudUpload, MapPin, XCircle } from 'lucide-react-native';
import { RefreshControl, StyleSheet, View } from 'react-native';

import { ShiftControls } from '@/components/ShiftControls';
import { SosButton } from '@/components/SosButton';
import { SyncBanner } from '@/components/SyncBanner';
import { UpdateNotice } from '@/components/UpdateNotice';
import { AppText, Badge, Button, Card, EmptyState, LoadingView, ProgressBar, Screen, SectionTitle } from '@/components/ui';
import { useAuth } from '@/context/AuthProvider';
import { useShift, type CheckpointView } from '@/context/ShiftProvider';
import { colors, fonts, radius, spacing } from '@/lib/theme';
import { formatDate, formatDateTime, formatTime } from '@/lib/time';
import type { ShiftStatus } from '@/lib/types';

const SHIFT_BADGE: Record<ShiftStatus, { label: string; tone: 'success' | 'info' | 'neutral' | 'danger' | 'warning' }> = {
  scheduled: { label: 'Not started', tone: 'info' },
  active: { label: 'On shift', tone: 'success' },
  completed: { label: 'Closed', tone: 'neutral' },
  missed: { label: 'Missed', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

function checkpointState(cp: CheckpointView) {
  if (cp.completed) {
    return cp.is_on_time === false
      ? { label: `Done late · ${formatTime(cp.scanned_at!)}`, tone: 'warning' as const, Icon: CheckCircle2, color: colors.warningText }
      : { label: `Done · ${formatTime(cp.scanned_at!)}`, tone: 'success' as const, Icon: CheckCircle2, color: colors.successText };
  }
  if (cp.pendingUpload) return { label: 'Pending upload', tone: 'info' as const, Icon: CloudUpload, color: colors.infoText };
  if (cp.validation === 'flagged') return { label: 'Awaiting review', tone: 'warning' as const, Icon: Circle, color: colors.warningText };
  if (cp.validation === 'rejected') return { label: 'Rejected — scan again', tone: 'danger' as const, Icon: XCircle, color: colors.dangerText };
  if (new Date(cp.due_at).getTime() < Date.now()) {
    return { label: 'Not verified by shift end', tone: 'danger' as const, Icon: XCircle, color: colors.dangerText };
  }
  return { label: `Due ${formatTime(cp.due_at)}`, tone: 'neutral' as const, Icon: Circle, color: colors.textMuted };
}

export default function WorkScreen() {
  const { profile } = useAuth();
  const { shift, checkpoints, loading, refreshing, refresh, fromCache, updatedAt, error } = useShift();

  if (loading) return <LoadingView message="Loading your shift…" />;

  const done = checkpoints.filter((c) => c.completed).length;
  const total = checkpoints.length;
  const firstName = profile?.full_name.split(' ')[0] ?? '';

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}>
      <View>
        <AppText variant="caption">{formatDate(new Date())}</AppText>
        <AppText variant="heading">Hello{firstName ? `, ${firstName}` : ''}</AppText>
      </View>

      <Button title="Account and settings" variant="ghost" onPress={() => router.navigate('/personal')} />
      <SyncBanner />
      <UpdateNotice />
      {fromCache && updatedAt ? (
        <AppText variant="caption">Showing saved data from {formatDateTime(updatedAt)}. Pull down to refresh.</AppText>
      ) : null}
      {error && !fromCache ? <AppText variant="label" style={{ color: colors.dangerText }}>{error}</AppText> : null}

      {!shift ? (
        <ShiftControls />
      ) : (
        <>
          <Card>
            <View style={styles.rowBetween}>
              <AppText variant="title" style={{ flex: 1 }}>
                {shift.routes?.name ?? 'Route'}
              </AppText>
              <Badge {...SHIFT_BADGE[shift.status]} />
            </View>
            <AppText variant="body">
              {formatDate(shift.scheduled_start)} · {formatTime(shift.scheduled_start)} – {formatTime(shift.scheduled_end)}
            </AppText>
            {shift.on_duty_name ? (
              <AppText variant="label">
                On duty: <AppText variant="label" style={{ fontFamily: fonts.bold }}>{shift.on_duty_name}</AppText>
              </AppText>
            ) : null}
            <View style={styles.rowBetween}>
              <AppText variant="label">Verified locations</AppText>
              <AppText variant="label" style={{ fontFamily: fonts.bold }}>
                {done} / {total}
              </AppText>
            </View>
            <ProgressBar value={total ? (done / total) * 100 : 0} color={colors.success} />
          </Card>

          <ShiftControls />
          <Button title="Scan location" onPress={() => router.push('/scan')} disabled={shift.status !== 'active'} />
          <SosButton />

          <SectionTitle>Required locations · once this shift</SectionTitle>
          {checkpoints.length === 0 ? (
            <Card>
              <EmptyState icon={MapPin} title="No checkpoints" message="This route has no checkpoints yet." />
            </Card>
          ) : (
            <Card style={{ padding: 0, gap: 0 }}>
              {/* Still to visit first; verified locations drop to the bottom. */}
              {[...checkpoints].sort((a, b) => Number(a.completed) - Number(b.completed)).map((cp, i) => {
                const st = checkpointState(cp);
                return (
                  <View
                    key={cp.checkpoint_id}
                    style={[styles.cpRow, i < checkpoints.length - 1 && styles.divider]}
                    accessibilityLabel={`${cp.sequence}. ${cp.checkpoint_name}. ${st.label}`}
                  >
                    <View style={styles.seq}>
                      <AppText variant="label" style={{ color: colors.primary, fontFamily: fonts.bold }}>
                        {cp.sequence}
                      </AppText>
                    </View>
                    <View style={{ flex: 1, gap: 4 }}>
                      <AppText variant="body" style={{ fontFamily: fonts.semibold }}>
                        {cp.checkpoint_name}
                      </AppText>
                      <Badge label={st.label} tone={st.tone} />
                    </View>
                    <st.Icon size={26} color={st.color} />
                  </View>
                );
              })}
            </Card>
          )}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  cpRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  seq: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.secondaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
