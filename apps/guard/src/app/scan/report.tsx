// =============================================================================
// REPORT: after a successful read, the guard chooses Normal or Issue found.
// =============================================================================
//   Normal       -> note, voice memo and photos are all optional.
//   Issue found  -> at least one photo AND a note are required.
// "Save" writes everything to the phone's outbox first (works offline), then
// the sync engine uploads it. The guard sees "Pending upload" until it lands.
// =============================================================================
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { AlertTriangle, Camera, CheckCircle2, Images, MapPin, X } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from 'react-native';

import { VoiceRecorder } from '@/components/VoiceRecorder';
import { AppText, Badge, Button, Card, Screen, Segmented, TextField } from '@/components/ui';
import { useAuth } from '@/context/AuthProvider';
import { useShift } from '@/context/ShiftProvider';
import { useToast } from '@/context/ToastProvider';
import { friendlyError } from '@/lib/errors';
import { distanceMeters } from '@/lib/geo';
import { METHOD_LABEL } from '@/lib/labels';
import { reportError } from '@/lib/sentry';
import { colors, fonts, radius, spacing } from '@/lib/theme';
import { formatTime } from '@/lib/time';
import type { ScanStatus } from '@/lib/types';
import { enqueueScan, type DraftAttachment } from '@/offline/outbox';
import { getSyncState, refreshPendingCounts, syncNow } from '@/offline/sync';
import { pickPhoto, takePhoto } from '@/services/media';
import { clearScanDraft, getScanDraft } from '@/services/scanDraft';

const MAX_PHOTOS = 6;

export default function ReportScreen() {
  // Read the draft once: save() clears it, and re-reading it on the next render
  // would make this screen navigate back a second time.
  const [draft] = useState(getScanDraft);
  const toast = useToast();
  const { reloadLocal } = useShift();
  const { session } = useAuth();
  const [status, setStatus] = useState<ScanStatus>('normal');
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<DraftAttachment[]>([]);
  const [memo, setMemo] = useState<DraftAttachment | null>(null);
  const [busy, setBusy] = useState<'photo' | 'save' | null>(null);
  const [errors, setErrors] = useState<{ note?: string; photos?: string }>({});

  useEffect(() => {
    if (!draft) router.back();
  }, [draft]);

  const distance = useMemo(() => {
    if (!draft?.fix) return null;
    return distanceMeters(draft.fix.latitude, draft.fix.longitude, draft.checkpoint.latitude, draft.checkpoint.longitude);
  }, [draft]);

  if (!draft) return null;
  const tooFar = distance !== null && distance > draft.checkpoint.radius_m;

  async function addPhoto(from: 'camera' | 'gallery') {
    if (photos.length >= MAX_PHOTOS) return toast.info(`Up to ${MAX_PHOTOS} photos per scan.`);
    setBusy('photo');
    try {
      const p = from === 'camera' ? await takePhoto() : await pickPhoto(draft!.shiftStart);
      if (p) {
        setPhotos((list) => [...list, p]);
        setErrors((e) => ({ ...e, photos: undefined }));
        if (p.preShift) toast.info('This photo was taken before your shift. It will be marked for review.');
      }
    } catch (e) {
      toast.error(friendlyError(e, 'Could not add the photo.'));
    } finally {
      setBusy(null);
    }
  }

  function validate(): boolean {
    const next: typeof errors = {};
    if (status === 'issue') {
      if (!note.trim()) next.note = 'Describe the issue.';
      if (photos.length === 0) next.photos = 'Add at least one photo of the issue.';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function save() {
    if (!validate()) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
      return;
    }
    setBusy('save');
    const attachments = memo ? [...photos, memo] : photos;
    try {
      await enqueueScan(
        session!.user.id,
        {
          p_scan_id: draft!.scanId,
          p_shift_id: draft!.shiftId,
          p_checkpoint_id: draft!.checkpoint.id,
          p_method: draft!.method,
          p_raw_value: draft!.rawValue,
          p_status: status,
          p_note: note.trim() || null,
          p_device_time: draft!.deviceTime,
          p_latitude: draft!.fix?.latitude ?? null,
          p_longitude: draft!.fix?.longitude ?? null,
          p_accuracy_m: draft!.fix?.accuracy ?? null,
          p_is_mocked: draft!.fix?.mocked ?? false,
          p_expected_attachments: attachments.length,
        },
        draft!.checkpoint.name,
        attachments,
      );
    } catch (e) {
      reportError(e, { where: 'enqueueScan' });
      setBusy(null);
      return toast.error('Could not save the scan on this phone. Check free storage and try again.');
    }

    await reloadLocal();
    await refreshPendingCounts();
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    clearScanDraft();
    void syncNow(); // upload in the background; no need to wait

    toast.success(
      getSyncState().online
        ? `${draft!.checkpoint.name} saved. Uploading…`
        : `${draft!.checkpoint.name} saved offline. It will upload when you have signal.`,
    );
    setBusy(null);
    router.back();
  }

  function cancel() {
    const hasWork = note.trim() || photos.length || memo;
    if (!hasWork) {
      clearScanDraft();
      return router.back();
    }
    Alert.alert('Discard this scan?', 'The checkpoint will not be recorded.', [
      { text: 'Keep editing', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: () => {
          clearScanDraft();
          router.back();
        },
      },
    ]);
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen edges={['top', 'bottom']}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <AppText variant="caption">Checkpoint scanned</AppText>
            <AppText variant="heading">{draft.checkpoint.name}</AppText>
          </View>
          <Pressable onPress={cancel} style={styles.close} accessibilityLabel="Cancel scan">
            <X size={28} color={colors.primary} />
          </Pressable>
        </View>

        <Card style={{ gap: spacing.sm }}>
          <View style={styles.inline}>
            <CheckCircle2 size={20} color={colors.successText} />
            <AppText variant="body">
              {METHOD_LABEL[draft.method]} read at {formatTime(draft.deviceTime)}
            </AppText>
          </View>
          <View style={styles.inline}>
            <MapPin size={20} color={tooFar || !draft.fix ? colors.dangerText : colors.successText} />
            <AppText variant="body" style={{ flex: 1 }}>
              {!draft.fix
                ? 'No GPS position. The scan may not be accepted.'
                : `About ${Math.round(distance!)} m from the checkpoint (GPS ±${draft.fix.accuracy === null ? 'unknown' : Math.round(draft.fix.accuracy)} m)`}
            </AppText>
          </View>
          {tooFar ? (
            <Badge label={`More than ${draft.checkpoint.radius_m} m away: may not be accepted`} tone="danger" />
          ) : null}
        </Card>

        <Segmented
          value={status}
          onChange={(s) => {
            setStatus(s);
            setErrors({});
          }}
          options={[
            { value: 'normal', label: 'Normal' },
            { value: 'issue', label: 'Issue found' },
          ]}
        />

        {status === 'issue' ? (
          <View style={[styles.inline, styles.issueHint]}>
            <AlertTriangle size={20} color={colors.dangerText} />
            <AppText variant="label" style={{ color: colors.dangerText, flex: 1 }}>
              A note and at least one photo are required. Supervisors are notified.
            </AppText>
          </View>
        ) : null}

        <TextField
          label={status === 'issue' ? 'What is the issue? *' : 'Note (optional)'}
          value={note}
          onChangeText={(t) => {
            setNote(t);
            if (errors.note) setErrors((e) => ({ ...e, note: undefined }));
          }}
          multiline
          maxLength={1000}
          placeholder={status === 'issue' ? 'e.g. Pump room door found unlocked' : 'Anything worth noting'}
          style={{ minHeight: 96, textAlignVertical: 'top', paddingTop: spacing.md }}
          error={errors.note}
        />

        <View style={{ gap: spacing.sm }}>
          <AppText variant="label">
            Photos {status === 'issue' ? '*' : '(optional)'} · {photos.length}/{MAX_PHOTOS}
          </AppText>
          {photos.length ? (
            <View style={styles.thumbs}>
              {photos.map((p) => (
                <View key={p.id} style={styles.thumbWrap}>
                  <Image source={{ uri: p.uri }} style={styles.thumb} contentFit="cover" />
                  {p.preShift ? (
                    <View style={styles.thumbFlag}>
                      <AppText variant="caption" style={{ color: colors.warningText, fontFamily: fonts.semibold }}>
                        Before shift
                      </AppText>
                    </View>
                  ) : null}
                  <Pressable
                    onPress={() => setPhotos((list) => list.filter((x) => x.id !== p.id))}
                    style={styles.thumbRemove}
                    accessibilityLabel="Remove photo"
                  >
                    <X size={16} color={colors.onPrimary} />
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}
          <View style={styles.row2}>
            <Button title="Camera" icon={Camera} variant="outline" style={{ flex: 1 }} onPress={() => addPhoto('camera')} loading={busy === 'photo'} />
            <Button title="Gallery" icon={Images} variant="outline" style={{ flex: 1 }} onPress={() => addPhoto('gallery')} disabled={busy === 'photo'} />
          </View>
          {errors.photos ? (
            <AppText variant="caption" style={{ color: colors.dangerText }}>
              {errors.photos}
            </AppText>
          ) : null}
        </View>

        <View style={{ gap: spacing.sm }}>
          <AppText variant="label">Voice memo (optional)</AppText>
          <VoiceRecorder memo={memo} onChange={setMemo} />
        </View>

        <Button
          title={status === 'issue' ? 'Save and report issue' : 'Save scan'}
          onPress={save}
          loading={busy === 'save'}
          disabled={busy === 'photo'}
        />
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  close: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center' },
  inline: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  issueHint: { backgroundColor: colors.dangerBg, padding: spacing.md, borderRadius: radius.md },
  row2: { flexDirection: 'row', gap: spacing.sm },
  thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  thumbWrap: { width: 96, height: 96, borderRadius: radius.md, overflow: 'hidden' },
  thumb: { width: '100%', height: '100%' },
  thumbRemove: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbFlag: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.warningBg, paddingVertical: 2, alignItems: 'center' },
});
