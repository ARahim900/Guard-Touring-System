// =============================================================================
// Root layout: the first screen code that runs. It
//   1. (the background location task is registered earlier, in /index.ts),
//   2. starts Sentry crash reporting,
//   3. loads the DM Sans brand font,
//   4. wraps the app in providers (toasts, login, shift),
//   5. shows the login screen or the tabs, depending on who is signed in.
// =============================================================================
// Import each weight separately so only these four font files are bundled.
import { DMSans_400Regular } from '@expo-google-fonts/dm-sans/400Regular';
import { DMSans_500Medium } from '@expo-google-fonts/dm-sans/500Medium';
import { DMSans_600SemiBold } from '@expo-google-fonts/dm-sans/600SemiBold';
import { DMSans_700Bold } from '@expo-google-fonts/dm-sans/700Bold';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { LoadingView } from '@/components/ui';
import { AuthProvider, useAuth } from '@/context/AuthProvider';
import { ShiftProvider } from '@/context/ShiftProvider';
import { ToastProvider } from '@/context/ToastProvider';
import { initSentry, Sentry } from '@/lib/sentry';
import { colors, fonts } from '@/lib/theme';
import { startSyncEngine } from '@/offline/sync';

initSentry();
SplashScreen.preventAutoHideAsync().catch(() => undefined);

function RootNavigator() {
  const { session, profile, loading } = useAuth();
  const signedIn = Boolean(session && profile && profile.role === 'guard' && profile.active);

  useEffect(() => {
    if (!loading) SplashScreen.hideAsync().catch(() => undefined);
  }, [loading]);

  useEffect(() => {
    if (signedIn) startSyncEngine();
  }, [signedIn]);

  if (loading) return <LoadingView message="Starting MB Patrol…" />;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
        headerTitleStyle: { fontFamily: fonts.semibold, color: colors.primary },
        headerTintColor: colors.primary,
      }}
    >
      {/* Stack.Protected hides screens unless "guard" is true: a signed-out
          user can never navigate to the tabs, even by a deep link. */}
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="scan/index" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
        <Stack.Screen
          name="scan/report"
          options={{ presentation: 'fullScreenModal', animation: 'slide_from_right', gestureEnabled: false }}
        />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="login" />
      </Stack.Protected>
      <Stack.Screen name="privacy" options={{ headerShown: true, title: 'Privacy policy', presentation: 'modal' }} />
    </Stack>
  );
}

function RootLayout() {
  const [fontsLoaded] = useFonts({ DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold, DMSans_700Bold });
  if (!fontsLoaded) return null; // splash screen stays visible meanwhile

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <ToastProvider>
        <AuthProvider>
          <ShiftProvider>
            <RootNavigator />
          </ShiftProvider>
        </AuthProvider>
      </ToastProvider>
    </SafeAreaProvider>
  );
}

// Sentry.wrap catches crashes in any screen and reports them.
export default Sentry.wrap(RootLayout);
