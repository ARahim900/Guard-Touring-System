// Android only: "A new version of MB Patrol is available".
// Most changes reach the phone by themselves (EAS Update, see AppUpdates.tsx).
// Changes to the app's native code need a new APK, and Android phones that
// installed the APK directly are never told about it. An administrator
// therefore sets app_settings.android_latest_version and android_download_url
// after each APK build; this card appears when that version is newer than the
// one installed. It never blocks the guard: the patrol carries on as normal.
import { Download } from 'lucide-react-native';
import { Linking, Platform, StyleSheet, View } from 'react-native';

import { AppText, Button } from '@/components/ui';
import { useShift } from '@/context/ShiftProvider';
import { useToast } from '@/context/ToastProvider';
import { colors, radius, spacing } from '@/lib/theme';
import { installedAppVersion, isNewerVersion } from '@/lib/version';

export function UpdateNotice() {
  const { appRelease } = useShift();
  const toast = useToast();

  if (Platform.OS !== 'android') return null;
  const installed = installedAppVersion();
  if (!isNewerVersion(appRelease.androidLatestVersion, installed)) return null;

  const url = appRelease.androidDownloadUrl?.trim() ?? '';
  const canOpen = /^https:\/\//i.test(url);

  async function openDownload() {
    try {
      await Linking.openURL(url);
    } catch {
      toast.error('Could not open the download link. Ask your supervisor for the new app.');
    }
  }

  return (
    <View style={styles.card} accessibilityRole="summary">
      <AppText variant="title" style={{ color: colors.infoText }}>
        A new version of MB Patrol is available
      </AppText>
      <AppText variant="label" style={{ color: colors.infoText }}>
        This phone has version {installed}. The new version is {appRelease.androidLatestVersion}.
      </AppText>
      <AppText variant="label" style={{ color: colors.infoText }}>
        Install it over this app. Do not uninstall first.
      </AppText>
      {canOpen ? (
        <Button title="Download the new version" icon={Download} variant="outline" onPress={() => void openDownload()} />
      ) : (
        <AppText variant="caption">Ask your supervisor for the download link.</AppText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.infoText,
    backgroundColor: colors.infoBg,
  },
});
