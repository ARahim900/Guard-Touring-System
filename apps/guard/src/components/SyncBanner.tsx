// Shows "Offline" or "3 items waiting to upload" so the guard always knows
// whether their scans have reached the supervisors.
import { CloudOff, RefreshCw, UploadCloud } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui';
import { colors, radius, spacing } from '@/lib/theme';
import { getSyncState, subscribeSync, syncNow, type SyncState } from '@/offline/sync';

export function useSyncState(): SyncState {
  const [s, setS] = useState(getSyncState());
  useEffect(() => subscribeSync(setS), []);
  return s;
}

export function SyncBanner() {
  const s = useSyncState();
  const waiting = s.pending.scans + s.pending.attachments;

  if (s.online && waiting === 0 && s.pending.failed === 0) return null;

  let Icon = UploadCloud;
  let text = `${waiting} item${waiting === 1 ? '' : 's'} waiting to upload`;
  let bg: string = colors.infoBg;
  let fg: string = colors.infoText;

  if (!s.online) {
    Icon = CloudOff;
    text = waiting > 0 ? `Offline. ${waiting} saved on this phone, will upload automatically.` : 'Offline. Scans will be saved on this phone.';
    bg = colors.warningBg;
    fg = colors.warningText;
  } else if (s.pending.failed > 0 && waiting === 0) {
    Icon = RefreshCw;
    text = `${s.pending.failed} record(s) or file(s) could not be uploaded. See History.`;
    bg = colors.dangerBg;
    fg = colors.dangerText;
  }

  return (
    <Pressable
      onPress={() => void syncNow()}
      accessibilityRole="button"
      accessibilityLabel={`${text}. Tap to sync now.`}
      style={[styles.banner, { backgroundColor: bg, borderColor: fg }]}
    >
      <Icon size={20} color={fg} />
      <AppText variant="label" style={{ color: fg, flex: 1 }}>
        {text}
      </AppText>
      <View style={{ width: 22 }}>{s.syncing ? <ActivityIndicator size="small" color={fg} /> : null}</View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
});
