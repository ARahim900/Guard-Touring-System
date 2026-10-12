// =============================================================================
// Muscat Bay brand tokens, adapted for an outdoor mobile app.
// =============================================================================
// Colours come from the Muscat Bay Brand & Design System. Two deliberate
// mobile adaptations, both for use in bright sunlight and with gloves:
//   1. Larger type scale (16 px body instead of 14 px on the web dashboard).
//   2. Status colours use the dark "text-on-tint" tokens for words, because
//      the soft brand status colours (#84B59F etc.) are too faint as text
//      outdoors. Brand teal (#A4C5BB) is used for accents and fills, never
//      for white text (white on teal fails contrast).
// =============================================================================

export const colors = {
  primary: '#4E4456',
  primaryHover: '#3A3341',
  primaryLight: '#6B5F73',
  onPrimary: '#FFFFFF',
  secondary: '#A4C5BB',
  secondaryLight: '#E8F1EF',
  secondaryActive: '#8AAFA5',
  onSecondary: '#1F2937',

  background: '#F7F8F9',
  card: '#FFFFFF',
  component: '#F0F2F4',
  muted: '#F3F4F6',
  border: '#E5E7EB',

  text: '#0A0A0A',
  textMuted: '#6B7280',

  success: '#84B59F',
  successBg: '#E8F1EF',
  successText: '#0D5C38',
  warning: '#E8C064',
  warningBg: '#FEFCE8',
  warningText: '#7A5200',
  danger: '#D67A7A',
  dangerBg: '#FEF2F2',
  dangerText: '#7F1D1D',
  info: '#6B9AC4',
  infoBg: '#EFF6FF',
  infoText: '#1A4FA8',

  // Brand "status-danger": used only for the SOS button (large bold text).
  sos: '#EF4444',
  stale: '#F97316',
} as const;

export const fonts = {
  regular: 'DMSans_400Regular',
  medium: 'DMSans_500Medium',
  semibold: 'DMSans_600SemiBold',
  bold: 'DMSans_700Bold',
} as const;

export const fontSize = {
  caption: 13,
  label: 14,
  body: 16,
  title: 20,
  heading: 24,
  display: 36,
} as const;

export const radius = { sm: 5, md: 7, lg: 10.5, pill: 999 } as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

// Minimum touch target: 52 px tall (Apple asks for 44; gloves need more).
export const touch = { minHeight: 52 } as const;

// Brand "standard card" shadow, translated to React Native.
export const shadow = {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 3 },
  shadowOpacity: 0.1,
  shadowRadius: 6,
  elevation: 3,
} as const;
