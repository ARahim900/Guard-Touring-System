// =============================================================================
// Voice memo recorder: AAC audio in an .m4a file, stopped at 2 minutes.
// =============================================================================
// AAC is the same compressed format used by phone voice notes: about 1 MB
// for 2 minutes, plays on every device, and the portal can play it in a
// browser without conversion.
// =============================================================================
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import * as Crypto from 'expo-crypto';
import { Mic, Pause, Play, Square, Trash2 } from 'lucide-react-native';
import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button } from '@/components/ui';
import { useToast } from '@/context/ToastProvider';
import { colors, radius, spacing } from '@/lib/theme';
import { formatDuration } from '@/lib/time';
import type { DraftAttachment } from '@/offline/outbox';

const MAX_SECONDS = 120;

export function VoiceRecorder({
  memo,
  onChange,
}: {
  memo: DraftAttachment | null;
  onChange: (memo: DraftAttachment | null) => void;
}) {
  const toast = useToast();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const state = useAudioRecorderState(recorder, 250);
  const startedAt = useRef<string | null>(null);
  const stopping = useRef(false);

  const player = useAudioPlayer(memo?.uri ?? null);
  const playback = useAudioPlayerStatus(player);

  async function start() {
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) return toast.error('Microphone access is off. Turn it on in Settings.');
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    startedAt.current = new Date().toISOString();
    stopping.current = false;
    recorder.record();
  }

  async function stop() {
    if (stopping.current) return;
    stopping.current = true;
    const seconds = Math.min(MAX_SECONDS, Math.round(state.durationMillis / 1000));
    await recorder.stop();
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined);
    if (!recorder.uri || seconds < 1) return toast.info('Recording too short. Hold on a little longer.');
    onChange({
      id: Crypto.randomUUID(),
      type: 'audio',
      source: 'microphone',
      uri: recorder.uri,
      mimeType: 'audio/mp4',
      durationSec: seconds,
      capturedAt: startedAt.current ?? new Date().toISOString(),
    });
  }

  // Hard limit: stop automatically at 2 minutes.
  useEffect(() => {
    if (state.isRecording && state.durationMillis >= MAX_SECONDS * 1000) void stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.isRecording, state.durationMillis]);

  if (state.isRecording) {
    const left = MAX_SECONDS - state.durationMillis / 1000;
    return (
      <View style={[styles.box, { borderColor: colors.danger }]}>
        <View style={styles.recDot} />
        <View style={{ flex: 1 }}>
          <AppText variant="body">Recording {formatDuration(state.durationMillis / 1000)}</AppText>
          <AppText variant="caption">{formatDuration(left)} left</AppText>
        </View>
        <Button title="Stop" icon={Square} variant="danger" onPress={stop} />
      </View>
    );
  }

  if (memo) {
    return (
      <View style={styles.box}>
        <Pressable
          onPress={() => {
            if (playback.playing) player.pause();
            else {
              void player.seekTo(0);
              player.play();
            }
          }}
          style={styles.round}
          accessibilityLabel={playback.playing ? 'Pause voice memo' : 'Play voice memo'}
        >
          {playback.playing ? <Pause size={22} color={colors.onPrimary} /> : <Play size={22} color={colors.onPrimary} />}
        </Pressable>
        <AppText variant="body" style={{ flex: 1 }}>
          Voice memo · {formatDuration(memo.durationSec ?? 0)}
        </AppText>
        <Pressable onPress={() => onChange(null)} style={styles.iconBtn} accessibilityLabel="Delete voice memo">
          <Trash2 size={22} color={colors.dangerText} />
        </Pressable>
      </View>
    );
  }

  return <Button title="Record voice memo (max 2 min)" icon={Mic} variant="outline" onPress={start} />;
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  recDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: colors.sos },
  round: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
