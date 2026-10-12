// =============================================================================
// SCANNER: reads a checkpoint by camera (QR or standard barcode) or by NFC.
// =============================================================================
// What happens on a successful read:
//   1. The value is matched against the checkpoints of the guard's route
//      (cached on the phone, so it works offline). Unknown codes are refused
//      straight away, so random product barcodes never become "scans".
//   2. The phone's time and the best GPS fix are captured AT THAT MOMENT.
//   3. The report screen opens (Normal / Issue found + attachments).
// The server re-checks everything later; this screen only gathers evidence.
// =============================================================================
import { CameraView, useCameraPermissions, type BarcodeScanningResult, type BarcodeType } from 'expo-camera';
import * as Crypto from 'expo-crypto';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { Flashlight, FlashlightOff, Nfc, QrCode, X } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText, Button, Card, EmptyState, Segmented } from '@/components/ui';
import { useShift, type CheckpointView } from '@/context/ShiftProvider';
import { useToast } from '@/context/ToastProvider';
import { colors, fonts, radius, spacing } from '@/lib/theme';
import type { ScanMethod } from '@/lib/types';
import { getFix, toFix, type Fix } from '@/services/location';
import { cancelNfc, nfcAvailability, readNfcTag } from '@/services/nfc';
import { setScanDraft } from '@/services/scanDraft';

// QR plus the common 1D/2D barcode formats printed on labels.
const BARCODE_TYPES: BarcodeType[] = ['qr', 'code128', 'code39', 'code93', 'ean13', 'ean8', 'upc_a', 'upc_e', 'itf14', 'codabar', 'datamatrix', 'pdf417', 'aztec'];
const FIX_MAX_AGE_MS = 30_000;

type Mode = 'camera' | 'nfc';

export default function ScanScreen() {
  const { shift, checkpoints } = useShift();
  const toast = useToast();
  const [mode, setMode] = useState<Mode>('camera');
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [nfcState, setNfcState] = useState<'ready' | 'disabled' | 'unsupported' | 'checking'>('checking');
  const [fix, setFix] = useState<Fix | null>(null);
  const locked = useRef(false);
  const latestFix = useRef<Fix | null>(null);

  // Start GPS as soon as the scanner opens, so a good fix is ready at scan time.
  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;
    (async () => {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) return;
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 2000, distanceInterval: 0 },
        (loc) => {
          latestFix.current = toFix(loc);
          setFix(latestFix.current);
        },
      );
    })().catch(() => undefined);
    return () => sub?.remove();
  }, []);

  useEffect(() => {
    nfcAvailability().then(setNfcState);
    return () => void cancelNfc();
  }, []);

  const usable = shift && (shift.status === 'active' || shift.status === 'scheduled');

  if (!usable) {
    return (
      <SafeAreaView style={styles.safe}>
        <Card style={{ margin: spacing.lg }}>
          <EmptyState
            icon={QrCode}
            title="No active shift"
            message="You can scan checkpoints only during your shift."
            action={<Button title="Close" onPress={() => router.back()} />}
          />
        </Card>
      </SafeAreaView>
    );
  }

  function match(method: ScanMethod, value: string, uid?: string | null): { cp: CheckpointView; raw: string } | null {
    const v = value.trim();
    const byCode = checkpoints.find((c) => c.code === v);
    if (byCode) return { cp: byCode, raw: v };
    if (method === 'nfc' && uid) {
      const byUid = checkpoints.find((c) => c.nfc_uid && c.nfc_uid.toUpperCase() === uid);
      if (byUid) return { cp: byUid, raw: uid };
    }
    return null;
  }

  async function accept(method: ScanMethod, value: string, uid?: string | null) {
    const deviceTime = new Date().toISOString(); // captured at the moment of the scan
    const found = match(method, value, uid);
    if (!found) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
      toast.error('This tag is not on your route.');
      setTimeout(() => (locked.current = false), 2500);
      return;
    }
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    setBusy(true);

    let gps = latestFix.current;
    if (!gps || Date.now() - gps.timestamp > FIX_MAX_AGE_MS) gps = await getFix(8000);

    setScanDraft({
      scanId: Crypto.randomUUID(),
      shiftId: shift!.id,
      shiftStart: shift!.actual_start ?? shift!.scheduled_start,
      checkpoint: {
        id: found.cp.checkpoint_id,
        name: found.cp.checkpoint_name,
        latitude: found.cp.latitude,
        longitude: found.cp.longitude,
        radius_m: found.cp.radius_m,
      },
      method,
      rawValue: found.raw,
      deviceTime,
      fix: gps,
    });
    router.replace('/scan/report');
  }

  function onBarcode(result: BarcodeScanningResult) {
    if (locked.current || busy) return;
    locked.current = true; // the camera fires many times per second; take the first
    void accept(result.type === 'qr' ? 'qr' : 'barcode', result.data);
  }

  async function onNfc() {
    setBusy(true);
    const tag = await readNfcTag();
    setBusy(false);
    if (!tag) return toast.info('No tag read. Try again and hold the phone still.');
    await accept('nfc', tag.text ?? '', tag.uid);
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <AppText variant="title" style={{ color: colors.onPrimary }}>
          Scan checkpoint
        </AppText>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} accessibilityLabel="Close scanner">
          <X size={28} color={colors.onPrimary} />
        </Pressable>
      </View>

      <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}>
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: 'camera', label: 'QR / Barcode' },
            { value: 'nfc', label: 'NFC tag' },
          ]}
        />
        <View style={styles.gps}>
          <View style={[styles.dot, { backgroundColor: fix ? (fix.accuracy && fix.accuracy <= 30 ? colors.success : colors.warning) : colors.textMuted }]} />
          <AppText variant="label" style={{ color: colors.onPrimary }}>
            {fix ? `GPS ready (±${Math.round(fix.accuracy ?? 0)} m)` : 'Finding GPS position…'}
          </AppText>
        </View>
        {shift!.status === 'scheduled' ? (
          <AppText variant="label" style={{ color: colors.warning }}>
            Your shift has not been started. Scans will be marked for review.
          </AppText>
        ) : null}
      </View>

      {mode === 'camera' ? (
        !permission ? null : !permission.granted ? (
          <Card style={{ margin: spacing.lg }}>
            <EmptyState
              icon={QrCode}
              title="Camera access needed"
              message="Allow the camera to scan checkpoint QR codes and barcodes."
              action={<Button title="Allow camera" onPress={requestPermission} />}
            />
          </Card>
        ) : (
          <View style={styles.cameraWrap}>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              enableTorch={torch}
              barcodeScannerSettings={{ barcodeTypes: BARCODE_TYPES }}
              onBarcodeScanned={busy ? undefined : onBarcode}
            />
            <View style={styles.frame} pointerEvents="none" />
            <Pressable onPress={() => setTorch((t) => !t)} style={styles.torch} accessibilityLabel="Toggle torch">
              {torch ? <FlashlightOff size={26} color={colors.onPrimary} /> : <Flashlight size={26} color={colors.onPrimary} />}
            </Pressable>
            <AppText variant="label" style={styles.cameraHint}>
              {busy ? 'Reading position…' : 'Point the camera at the checkpoint label'}
            </AppText>
          </View>
        )
      ) : (
        <View style={styles.nfcWrap}>
          <View style={styles.nfcCircle}>
            <Nfc size={72} color={colors.secondary} />
          </View>
          {nfcState === 'unsupported' ? (
            <AppText variant="body" style={styles.nfcText}>This phone does not support NFC. Use QR / Barcode instead.</AppText>
          ) : nfcState === 'disabled' ? (
            <AppText variant="body" style={styles.nfcText}>NFC is turned off. Turn it on in your phone settings.</AppText>
          ) : (
            <>
              <AppText variant="body" style={styles.nfcText}>
                Tap the button, then hold the back of your phone against the checkpoint tag.
              </AppText>
              <Button title={busy ? 'Waiting for tag…' : 'Scan NFC tag'} onPress={onNfc} loading={busy} variant="secondary" style={{ alignSelf: 'stretch' }} />
            </>
          )}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.primary, gap: spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  iconBtn: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center' },
  gps: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot: { width: 12, height: 12, borderRadius: 6 },
  cameraWrap: { flex: 1, margin: spacing.lg, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: '#000' },
  frame: {
    position: 'absolute',
    top: '22%',
    left: '12%',
    right: '12%',
    aspectRatio: 1,
    borderWidth: 4,
    borderColor: colors.secondary,
    borderRadius: radius.lg,
  },
  torch: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraHint: {
    position: 'absolute',
    bottom: spacing.lg,
    alignSelf: 'center',
    color: colors.onPrimary,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    fontFamily: fonts.semibold,
  },
  nfcWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.xl },
  nfcCircle: {
    width: 160,
    height: 160,
    borderRadius: 80,
    borderWidth: 4,
    borderColor: colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nfcText: { color: colors.onPrimary, textAlign: 'center' },
});
