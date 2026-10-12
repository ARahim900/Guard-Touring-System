// Login screen. No "Sign up": accounts are created by supervisors.
import { Link } from 'expo-router';
import { ShieldCheck } from 'lucide-react-native';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';

import { AppText, Button, Card, Screen, TextField } from '@/components/ui';
import { useAuth } from '@/context/AuthProvider';
import { useToast } from '@/context/ToastProvider';
import { colors, spacing } from '@/lib/theme';

export default function LoginScreen() {
  const { signIn } = useAuth();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit() {
    if (!email.includes('@') || password.length < 6) {
      setError('Enter your work email and password.');
      return;
    }
    setBusy(true);
    setError(null);
    const message = await signIn(email, password);
    setBusy(false);
    if (message) setError(message);
    else toast.success('Signed in.');
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen edges={['top', 'bottom']} contentStyle={{ flexGrow: 1, justifyContent: 'center' }}>
        <View style={styles.brand}>
          <View style={styles.logo}>
            <ShieldCheck size={40} color={colors.secondary} />
          </View>
          <AppText variant="heading">MB Patrol</AppText>
          <AppText variant="body" style={{ color: colors.textMuted }}>
            Muscat Bay security patrols
          </AppText>
        </View>

        <Card>
          <TextField
            label="Work email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="username"
            placeholder="name@company.com"
            returnKeyType="next"
          />
          <TextField
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="password"
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={onSubmit}
          />
          {error ? (
            <AppText variant="label" style={{ color: colors.dangerText }} accessibilityRole="alert">
              {error}
            </AppText>
          ) : null}
          <Button title="Sign in" onPress={onSubmit} loading={busy} />
          <AppText variant="caption" style={{ textAlign: 'center' }}>
            No account or forgot your password? Ask your supervisor.
          </AppText>
        </Card>

        <Link href="/privacy" style={styles.link}>
          <AppText variant="label" style={{ color: colors.primary, textDecorationLine: 'underline' }}>
            Privacy policy
          </AppText>
        </Link>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  brand: { alignItems: 'center', gap: spacing.xs, marginBottom: spacing.md },
  logo: {
    width: 76,
    height: 76,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  link: { alignSelf: 'center', padding: spacing.md },
});
