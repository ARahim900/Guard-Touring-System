import { PlayCircle, StopCircle } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, View } from 'react-native';

import { AppText, Button, Card, TextField } from '@/components/ui';
import { useShift } from '@/context/ShiftProvider';
import { useToast } from '@/context/ToastProvider';
import { friendlyError } from '@/lib/errors';
import { spacing } from '@/lib/theme';

export function ShiftControls() {
  const { shift, checkpoints, startShift, endShift } = useShift();
  const toast = useToast();
  const [name, setName] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const remaining = checkpoints.filter((cp) => !cp.completed).length;

  async function act(action: 'start' | 'end') {
    setBusy(true);
    try {
      const result = action === 'start' ? await startShift(name.trim(), reference.trim()) : await endShift();
      if (result.ok) {
        toast.success(result.message);
        setName('');
        setReference('');
      } else toast.error(result.message);
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  function start() {
    if (name.trim().length < 3) return toast.error('Enter your full name.');
    Alert.alert('Location during your shift', 'MB Patrol collects your location during your shift, including in the background, for patrol monitoring and emergency assistance. Location permissions are requested next.', [
      { text: 'Cancel', style: 'cancel' }, { text: 'Start patrol', onPress: () => void act('start') },
    ]);
  }

  function finish() {
    Alert.alert('Finish patrol?', `${remaining} location(s) are not yet verified. Saved records will upload before the shift finishes. You cannot restart this shift.`, [
      { text: 'Keep patrolling', style: 'cancel' }, { text: 'Finish patrol', onPress: () => void act('end') },
    ]);
  }

  if (!shift) return null;
  return (
    <Card>
      {shift.status === 'scheduled' ? (
        <View style={{ gap: spacing.md }}>
          <AppText variant="title">Who is on duty?</AppText>
          <TextField label="Your full name" value={name} onChangeText={setName} maxLength={100} autoCorrect={false} />
          <TextField label="Employee / ID number (optional)" value={reference} onChangeText={setReference} maxLength={50} autoCorrect={false} />
          <Button title="Start patrol" icon={PlayCircle} loading={busy} onPress={start} />
        </View>
      ) : shift.status === 'active' ? (
        <Button title="Finish patrol" icon={StopCircle} loading={busy} onPress={finish} />
      ) : <AppText variant="body">This shift is closed.</AppText>}
    </Card>
  );
}
