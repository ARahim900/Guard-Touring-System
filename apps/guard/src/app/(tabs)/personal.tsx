// =============================================================================
// PERSONAL tab: profile, shift start/end, uploads, password, privacy, sign out.
// =============================================================================
import * as Application from 'expo-application';
import { router } from 'expo-router';
import { FileText, KeyRound, LogOut, PlayCircle, RefreshCw, Save, StopCircle } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { useSyncState } from '@/components/SyncBanner';
import { AppText, Badge, Button, Card, Screen, SectionTitle, TextField } from '@/components/ui';
import { useAuth } from '@/context/AuthProvider';
import { useShift } from '@/context/ShiftProvider';
import { useToast } from '@/context/ToastProvider';
import { friendlyError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { colors, fonts, spacing } from '@/lib/theme';
import { formatDateTime, formatTime } from '@/lib/time';
import { syncNow } from '@/offline/sync';

// Google Play requires this "prominent disclosure" BEFORE asking for
// background location, in the app's own words.
const LOCATION_DISCLOSURE =
  'MB Patrol collects your location while your shift is active, including when the app is closed or not in use, ' +
  'so supervisors can see patrol progress and reach you after an SOS. Location is never collected outside your shift ' +
  'and the trail is deleted after 90 days.';

export default function PersonalScreen() {
  const { profile, signOut, refreshProfile } = useAuth();
  const { shift, startShift, endShift } = useShift();
  const sync = useSyncState();
  const toast = useToast();

  const [fullName, setFullName] = useState(profile?.full_name ?? '');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [savingProfile, setSavingProfile] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [shiftBusy, setShiftBusy] = useState(false);

  useEffect(() => {
    setFullName(profile?.full_name ?? '');
    setPhone(profile?.phone ?? '');
  }, [profile]);

  const waiting = sync.pending.scans + sync.pending.attachments + sync.pending.pings;

  async function saveProfile() {
    if (fullName.trim().length < 2) return toast.error('Enter your full name.');
    setSavingProfile(true);
    const { error } = await supabase
      .from('profiles')
      .update({ full_name: fullName.trim(), phone: phone.trim() || null })
      .eq('id', profile!.id);
    setSavingProfile(false);
    if (error) return toast.error(friendlyError(error));
    await refreshProfile();
    toast.success('Profile saved.');
  }

  async function changePassword() {
    if (newPassword.length < 10 || !/\d/.test(newPassword) || !/[A-Za-z]/.test(newPassword)) {
      return toast.error('Use at least 10 characters with letters and numbers.');
    }
    setSavingPassword(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setSavingPassword(false);
    if (error) return toast.error(friendlyError(error));
    setNewPassword('');
    toast.success('Password changed.');
  }

  function confirmStart() {
    Alert.alert('Location while on shift', LOCATION_DISCLOSURE, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Continue',
        onPress: async () => {
          setShiftBusy(true);
          const res = await startShift();
          setShiftBusy(false);
          if (res.ok) toast.success(res.message);
          else toast.error(res.message);
        },
      },
    ]);
  }

  function confirmEnd() {
    Alert.alert('End shift?', 'Location sharing will stop. You cannot restart this shift.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'End shift',
        style: 'destructive',
        onPress: async () => {
          setShiftBusy(true);
          const res = await endShift();
          setShiftBusy(false);
          if (res.ok) toast.success(res.message);
          else toast.error(res.message);
        },
      },
    ]);
  }

  function confirmSignOut() {
    if (shift?.status === 'active') {
      return Alert.alert('Shift in progress', 'End your shift before signing out.');
    }
    if (waiting > 0) {
      return Alert.alert(
        'Uploads waiting',
        `${waiting} item(s) have not reached the server yet. If you sign out now they will be lost.`,
        [
          { text: 'Stay signed in', style: 'cancel' },
          { text: 'Sign out and discard', style: 'destructive', onPress: () => void signOut({ discardOutbox: true }) },
        ],
      );
    }
    Alert.alert('Sign out?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void signOut({ discardOutbox: true }) },
    ]);
  }

  return (
    <Screen>
      <AppText variant="heading">Personal</AppText>

      {/* ------------------------------------------------------------ Shift */}
      <SectionTitle>Shift</SectionTitle>
      <Card>
        {!shift ? (
          <AppText variant="body">No shift assigned right now.</AppText>
        ) : (
          <>
            <View style={styles.rowBetween}>
              <AppText variant="body" style={{ fontFamily: fonts.semibold, flex: 1 }}>
                {shift.routes?.name}
              </AppText>
              <Badge
                label={shift.status === 'active' ? 'On shift' : shift.status === 'scheduled' ? 'Not started' : shift.status}
                tone={shift.status === 'active' ? 'success' : 'info'}
              />
            </View>
            <AppText variant="body">
              Scheduled {formatDateTime(shift.scheduled_start)} – {formatTime(shift.scheduled_end)}
            </AppText>
            {shift.actual_start ? <AppText variant="caption">Started at {formatTime(shift.actual_start)}</AppText> : null}
            {shift.status === 'scheduled' ? (
              <Button title="Start shift" icon={PlayCircle} onPress={confirmStart} loading={shiftBusy} />
            ) : null}
            {shift.status === 'active' ? (
              <Button title="End shift" icon={StopCircle} variant="danger" onPress={confirmEnd} loading={shiftBusy} />
            ) : null}
          </>
        )}
      </Card>

      {/* ---------------------------------------------------------- Profile */}
      <SectionTitle>Profile</SectionTitle>
      <Card>
        <Info label="Email" value={profile?.email} />
        <Info label="Employee no." value={profile?.employee_no} />
        <Info label="Contractor" value={profile?.contractors?.name} />
        <TextField label="Full name" value={fullName} onChangeText={setFullName} autoComplete="name" />
        <TextField label="Mobile number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" />
        <Button title="Save profile" icon={Save} variant="outline" onPress={saveProfile} loading={savingProfile} />
      </Card>

      {/* ---------------------------------------------------------- Uploads */}
      <SectionTitle>Uploads</SectionTitle>
      <Card>
        <Info label="Connection" value={sync.online ? 'Online' : 'Offline'} />
        <Info label="Waiting to upload" value={`${sync.pending.scans} scans · ${sync.pending.attachments} files · ${sync.pending.pings} GPS points`} />
        {sync.pending.failed > 0 ? <Info label="Failed" value={`${sync.pending.failed} scans (see Histories)`} danger /> : null}
        <Info label="Last upload" value={sync.lastSyncAt ? formatDateTime(sync.lastSyncAt) : 'Not yet'} />
        <Button
          title={sync.syncing ? 'Uploading…' : 'Upload now'}
          icon={RefreshCw}
          variant="outline"
          loading={sync.syncing}
          onPress={async () => {
            await syncNow();
            toast.info(sync.online ? 'Upload finished.' : 'Offline. Will upload when connected.');
          }}
        />
      </Card>

      {/* --------------------------------------------------------- Password */}
      <SectionTitle>Password</SectionTitle>
      <Card>
        <TextField
          label="New password"
          value={newPassword}
          onChangeText={setNewPassword}
          secureTextEntry
          autoComplete="new-password"
          hint="At least 10 characters, with letters and numbers."
        />
        <Button title="Change password" icon={KeyRound} variant="outline" onPress={changePassword} loading={savingPassword} />
      </Card>

      <Button title="Privacy policy" icon={FileText} variant="ghost" onPress={() => router.push('/privacy')} />
      <Button title="Sign out" icon={LogOut} variant="danger" onPress={confirmSignOut} />
      <AppText variant="caption" style={{ textAlign: 'center' }}>
        MB Patrol {Application.nativeApplicationVersion ?? ''} ({Application.nativeBuildVersion ?? 'dev'})
      </AppText>
    </Screen>
  );
}

function Info({ label, value, danger }: { label: string; value?: string | null; danger?: boolean }) {
  return (
    <View style={styles.rowBetween}>
      <AppText variant="label" style={{ color: colors.textMuted }}>
        {label}
      </AppText>
      <AppText variant="label" style={{ flexShrink: 1, textAlign: 'right', color: danger ? colors.dangerText : colors.text }}>
        {value || '–'}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
});
