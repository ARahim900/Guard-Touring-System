import { CheckCircle2, Clock3, PlayCircle } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, View } from 'react-native';

import { AppText, Button, Card } from '@/components/ui';
import { useShift } from '@/context/ShiftProvider';
import { useToast } from '@/context/ToastProvider';
import { friendlyError } from '@/lib/errors';
import { spacing } from '@/lib/theme';
import { formatTime } from '@/lib/time';

export function ShiftControls() {
  const { shift, guardNames, fromCache, startShift } = useShift();
  const toast = useToast();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  async function act() {
    setBusy(true);
    try {
      const result = await startShift(name);
      if (result.ok) {
        toast.success(result.message);
        setName('');
      } else toast.error(result.message);
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  function start() {
    if (!name) return toast.error('Choose your name to start.');
    Alert.alert('Location during your shift', 'MB Patrol collects your location during your shift, including in the background, for patrol monitoring and emergency assistance. Location permissions are requested next.', [
      { text: 'Cancel', style: 'cancel' }, { text: 'Start patrol', onPress: () => void act() },
    ]);
  }


  if (shift?.status === 'active') {
    // No finish button: the patrol closes by itself at its end time.
    return (
      <Card>
        <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
          <Clock3 size={20} />
          <AppText variant="body" style={{ flex: 1 }}>Patrol in progress. Scan each location. It ends automatically at {formatTime(shift.scheduled_end)}.</AppText>
        </View>
      </Card>
    );
  }
  return (
    <Card>
      <View style={{ gap: spacing.md }}>
        <AppText variant="title">Who is on duty?</AppText>
        {guardNames.length ? (
          <>
            <AppText variant="body">Tap your name. The start time is recorded by the server.</AppText>
            {/* Large buttons, not a dropdown: easier with gloves and in the dark. */}
            {guardNames.map((guard) => (
              <Button key={guard} title={guard} variant={name === guard ? 'primary' : 'outline'} icon={name === guard ? CheckCircle2 : undefined}
                accessibilityLabel={name === guard ? `${guard}, selected` : guard} disabled={busy} onPress={() => setName(guard)} />
            ))}
          </>
        ) : (
          <AppText variant="body">The guard list has not been set up. Ask your supervisor to add the guards under Night patrol.</AppText>
        )}
        {fromCache ? <AppText variant="caption">No connection. Starting a patrol needs mobile data or Wi-Fi.</AppText> : null}
        <Button title="Start patrol" icon={PlayCircle} loading={busy} disabled={!name || fromCache} onPress={start} />
      </View>
    </Card>
  );
}
