// =============================================================================
// Bottom tab bar: Work · Statistic · [ + Scan ] · Histories · Personal
// =============================================================================
// The middle "+" is not a real tab: pressing it opens the scanner as a
// full-screen modal on top of whatever tab is showing.
// =============================================================================
import { router } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { ClipboardList, History, Plus } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';

import { colors, fonts, shadow } from '@/lib/theme';

function ScanTabButton() {
  return (
    <View style={styles.scanWrap} pointerEvents="box-none">
      <Pressable
        onPress={() => router.push('/scan')}
        accessibilityRole="button"
        accessibilityLabel="Scan a checkpoint"
        style={({ pressed }) => [styles.scanButton, pressed && { transform: [{ scale: 0.96 }] }]}
      >
        <Plus size={34} color={colors.onPrimary} strokeWidth={2.6} />
      </Pressable>
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { fontFamily: fonts.semibold, fontSize: 12 },
        tabBarStyle: { height: 72, paddingTop: 6, paddingBottom: 10, backgroundColor: colors.card, borderTopColor: colors.border },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Tonight', tabBarIcon: ({ color }) => <ClipboardList size={24} color={color} /> }}
      />
      <Tabs.Screen
        name="statistic"
        options={{ href: null }}
      />
      <Tabs.Screen
        name="new-scan"
        options={{ title: 'Scan', tabBarButton: () => <ScanTabButton /> }}
        listeners={{ tabPress: (e) => e.preventDefault() }}
      />
      <Tabs.Screen
        name="histories"
        options={{ title: 'History', tabBarIcon: ({ color }) => <History size={24} color={color} /> }}
      />
      <Tabs.Screen
        name="personal"
        options={{ href: null }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  scanWrap: { flex: 1, alignItems: 'center' },
  scanButton: {
    marginTop: -26,
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: colors.primary,
    borderWidth: 4,
    borderColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow,
  },
});
