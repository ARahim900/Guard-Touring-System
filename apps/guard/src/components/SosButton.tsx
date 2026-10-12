// =============================================================================
// SOS button: press and HOLD for 2 seconds.
// =============================================================================
// Why hold instead of tap? A tap happens by accident in a pocket; a false SOS
// wastes a supervisor's response and erodes trust in real alarms. Two seconds
// is quick in a real emergency but rare by accident.
// If there is no signal, the SOS is saved and sent automatically later, and the
// guard is offered a one-tap phone call to the control room.
// =============================================================================
import * as Crypto from 'expo-crypto';
import * as Haptics from 'expo-haptics';
import { Siren } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { useShift } from '@/context/ShiftProvider';
import { useToast } from '@/context/ToastProvider';
import { env } from '@/lib/env';
import { reportError } from '@/lib/sentry';
import { supabase } from '@/lib/supabase';
import { colors, fonts, radius, spacing } from '@/lib/theme';
import { enqueueSos } from '@/offline/outbox';
import { getFix } from '@/services/location';

const HOLD_MS = 2000;

function offerCall(title: string, message: string) {
  const buttons: { text: string; onPress?: () => void; style?: 'cancel' }[] = [{ text: 'OK', style: 'cancel' }];
  if (env.controlRoomPhone) {
    buttons.unshift({ text: 'Call control room', onPress: () => void Linking.openURL(`tel:${env.controlRoomPhone}`) });
  }
  Alert.alert(title, message, buttons);
}

export function SosButton() {
  const { shift } = useShift();
  const toast = useToast();
  const [sending, setSending] = useState(false);
  const progress = useRef(new Animated.Value(0)).current;
  const holdAnim = useRef<Animated.CompositeAnimation | null>(null);

  async function sendSos() {
    setSending(true);
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
    const fix = await getFix(5000);
    const payload = {
      p_shift_id: shift?.status === 'active' ? shift.id : null,
      p_latitude: fix?.latitude ?? null,
      p_longitude: fix?.longitude ?? null,
      p_accuracy_m: fix?.accuracy ?? null,
      p_message: null,
    };
    try {
      const { error } = await supabase.rpc('trigger_sos', payload);
      if (error) throw error;
      toast.success('SOS sent. Supervisors have been alerted.');
      offerCall('SOS sent', 'Supervisors can see your position. Stay safe and call if you can.');
    } catch (e) {
      reportError(e, { where: 'sos' });
      await enqueueSos(Crypto.randomUUID(), payload);
      offerCall('No connection', 'Your SOS is saved and will be sent the moment you have signal. Call the control room now.');
    } finally {
      setSending(false);
    }
  }

  function onPressIn() {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    holdAnim.current = Animated.timing(progress, { toValue: 1, duration: HOLD_MS, useNativeDriver: false });
    holdAnim.current.start(({ finished }) => {
      if (finished) {
        progress.setValue(0);
        void sendSos();
      }
    });
  }

  function onPressOut() {
    holdAnim.current?.stop();
    Animated.timing(progress, { toValue: 0, duration: 150, useNativeDriver: false }).start();
  }

  return (
    <Pressable
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      disabled={sending}
      accessibilityRole="button"
      accessibilityLabel="SOS. Press and hold for two seconds to alert supervisors."
      style={styles.button}
    >
      <Animated.View
        style={[
          styles.fill,
          { width: progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) },
        ]}
      />
      <View style={styles.content}>
        {sending ? <ActivityIndicator color="#fff" /> : <Siren size={26} color="#fff" />}
        <View>
          <Text style={styles.title}>{sending ? 'Sending SOS…' : 'SOS'}</Text>
          {!sending ? <Text style={styles.hint}>Press and hold 2 seconds</Text> : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 64,
    borderRadius: radius.lg,
    backgroundColor: colors.sos,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: '#B91C1C' },
  content: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.md },
  title: { color: '#fff', fontFamily: fonts.bold, fontSize: 22, letterSpacing: 1 },
  hint: { color: '#fff', fontFamily: fonts.medium, fontSize: 13 },
});
