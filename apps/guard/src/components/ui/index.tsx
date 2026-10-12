// =============================================================================
// Basic building blocks, styled once with the brand tokens, reused everywhere.
// Keeping them in one file makes the design easy to change in one place.
// =============================================================================
import type { ComponentType, ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type PressableProps,
  type RefreshControlProps,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { colors, fonts, fontSize, radius, shadow, spacing, touch } from '@/lib/theme';

type IconType = ComponentType<{ size?: number; color?: string }>;

// ---------------------------------------------------------------------- Text
type Variant = 'display' | 'heading' | 'title' | 'body' | 'label' | 'caption';
const VARIANT: Record<Variant, TextStyle> = {
  display: { fontFamily: fonts.bold, fontSize: fontSize.display, color: colors.primary, letterSpacing: -0.5 },
  heading: { fontFamily: fonts.bold, fontSize: fontSize.heading, color: colors.primary, letterSpacing: -0.3 },
  title: { fontFamily: fonts.semibold, fontSize: fontSize.title, color: colors.primary },
  body: { fontFamily: fonts.regular, fontSize: fontSize.body, color: colors.text, lineHeight: 22 },
  label: { fontFamily: fonts.medium, fontSize: fontSize.label, color: colors.text },
  caption: { fontFamily: fonts.regular, fontSize: fontSize.caption, color: colors.textMuted },
};

export function AppText({ variant = 'body', style, ...rest }: TextProps & { variant?: Variant }) {
  return <Text {...rest} style={[VARIANT[variant], style]} />;
}

// -------------------------------------------------------------------- Screen
export function Screen({
  children,
  scroll = true,
  refreshControl,
  edges = ['top'],
  contentStyle,
}: {
  children: ReactNode;
  scroll?: boolean;
  refreshControl?: React.ReactElement<RefreshControlProps>;
  edges?: Edge[];
  contentStyle?: StyleProp<ViewStyle>;
}) {
  return (
    <SafeAreaView style={styles.screen} edges={edges}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={[styles.screenContent, contentStyle]}
          refreshControl={refreshControl}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.screenContent, { flex: 1 }, contentStyle]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------- Card
export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

// -------------------------------------------------------------------- Button
type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost';
const BUTTON: Record<ButtonVariant, { bg: string; fg: string; border: string }> = {
  primary: { bg: colors.primary, fg: colors.onPrimary, border: colors.primary },
  secondary: { bg: colors.secondary, fg: colors.onSecondary, border: colors.secondary },
  outline: { bg: colors.card, fg: colors.primary, border: colors.primary },
  danger: { bg: colors.dangerBg, fg: colors.dangerText, border: colors.danger },
  ghost: { bg: 'transparent', fg: colors.primary, border: 'transparent' },
};

export function Button({
  title,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  icon: Icon,
  style,
  ...rest
}: Omit<PressableProps, 'style' | 'children'> & {
  title: string;
  variant?: ButtonVariant;
  loading?: boolean;
  icon?: IconType;
  style?: StyleProp<ViewStyle>;
}) {
  const v = BUTTON[variant];
  const inactive = disabled || loading;
  return (
    <Pressable
      {...rest}
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: v.bg, borderColor: v.border, opacity: inactive ? 0.55 : pressed ? 0.85 : 1 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={v.fg} />
      ) : (
        <>
          {Icon ? <Icon size={20} color={v.fg} /> : null}
          <Text style={[styles.buttonText, { color: v.fg }]}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

// --------------------------------------------------------------------- Badge
type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'brand';
const TONE: Record<Tone, { bg: string; fg: string }> = {
  success: { bg: colors.successBg, fg: colors.successText },
  warning: { bg: colors.warningBg, fg: colors.warningText },
  danger: { bg: colors.dangerBg, fg: colors.dangerText },
  info: { bg: colors.infoBg, fg: colors.infoText },
  neutral: { bg: colors.muted, fg: colors.text },
  brand: { bg: colors.secondaryLight, fg: colors.primary },
};

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  const t = TONE[tone];
  return (
    <View style={[styles.badge, { backgroundColor: t.bg }]}>
      <Text style={[styles.badgeText, { color: t.fg }]}>{label}</Text>
    </View>
  );
}

// ----------------------------------------------------------------- TextField
export function TextField({
  label,
  error,
  hint,
  style,
  ...rest
}: TextInputProps & { label: string; error?: string | null; hint?: string }) {
  return (
    <View style={{ gap: spacing.xs }}>
      <AppText variant="label">{label}</AppText>
      <TextInput
        placeholderTextColor={colors.textMuted}
        {...rest}
        style={[styles.input, error ? { borderColor: colors.danger } : null, style]}
        accessibilityLabel={label}
      />
      {error ? (
        <AppText variant="caption" style={{ color: colors.dangerText }}>
          {error}
        </AppText>
      ) : hint ? (
        <AppText variant="caption">{hint}</AppText>
      ) : null}
    </View>
  );
}

// ------------------------------------------------------- Loading and empty
export function LoadingView({ message = 'Loading…' }: { message?: string }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={colors.primary} />
      <AppText variant="caption" style={{ marginTop: spacing.md }}>
        {message}
      </AppText>
    </View>
  );
}

export function EmptyState({ icon: Icon, title, message, action }: { icon: IconType; title: string; message?: string; action?: ReactNode }) {
  return (
    <View style={[styles.center, { paddingVertical: spacing.xxl }]}>
      <View style={styles.emptyIcon}>
        <Icon size={32} color={colors.primary} />
      </View>
      <AppText variant="title" style={{ textAlign: 'center', marginTop: spacing.md }}>
        {title}
      </AppText>
      {message ? (
        <AppText variant="body" style={{ textAlign: 'center', color: colors.textMuted, marginTop: spacing.xs }}>
          {message}
        </AppText>
      ) : null}
      {action ? <View style={{ marginTop: spacing.lg, alignSelf: 'stretch' }}>{action}</View> : null}
    </View>
  );
}

// ---------------------------------------------------------------- Segmented
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.segmented} accessibilityRole="tablist">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={[styles.segment, active && styles.segmentActive]}
          >
            <Text style={[styles.segmentText, active && { color: colors.onPrimary }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// -------------------------------------------------------------- ProgressBar
export function ProgressBar({ value, color = colors.primary }: { value: number; color?: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <View style={styles.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: pct }}>
      <View style={[styles.fill, { width: `${pct}%`, backgroundColor: color }]} />
    </View>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <View style={styles.sectionTitle}>
      <AppText variant="title">{children}</AppText>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  screenContent: { padding: spacing.lg, gap: spacing.lg, paddingBottom: 120 },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadow,
  },
  button: {
    minHeight: touch.minHeight,
    borderRadius: radius.md,
    borderWidth: 1.5,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  buttonText: { fontFamily: fonts.semibold, fontSize: fontSize.body },
  badge: { borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 3, alignSelf: 'flex-start' },
  badgeText: { fontFamily: fonts.semibold, fontSize: fontSize.caption },
  input: {
    minHeight: touch.minHeight,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.md,
    fontFamily: fonts.regular,
    fontSize: fontSize.body,
    color: colors.text,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.secondaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.component,
    borderRadius: radius.md,
    padding: 4,
    gap: 4,
  },
  segment: { flex: 1, minHeight: 44, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  segmentActive: { backgroundColor: colors.primary },
  segmentText: { fontFamily: fonts.semibold, fontSize: fontSize.label, color: colors.primary },
  track: { height: 10, borderRadius: 5, backgroundColor: colors.component, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 5 },
  sectionTitle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
