// A small toast system: a short message that slides in at the top and
// disappears after a few seconds. Used for "Scan saved", errors, etc.
// Built in-house (≈80 lines) instead of adding another library.
import { CheckCircle2, Info, XCircle } from 'lucide-react-native';
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, Pressable, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, fonts, fontSize, radius, shadow, spacing } from '@/lib/theme';

type ToastType = 'success' | 'error' | 'info';
interface ToastState {
  type: ToastType;
  message: string;
}
interface ToastApi {
  show: (type: ToastType, message: string) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const STYLE: Record<ToastType, { bg: string; fg: string; Icon: typeof Info }> = {
  success: { bg: colors.successBg, fg: colors.successText, Icon: CheckCircle2 },
  error: { bg: colors.dangerBg, fg: colors.dangerText, Icon: XCircle },
  info: { bg: colors.infoBg, fg: colors.infoText, Icon: Info },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<ToastState | null>(null);
  const anim = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = useCallback(() => {
    Animated.timing(anim, { toValue: 0, duration: 180, useNativeDriver: true }).start(() => setToast(null));
  }, [anim]);

  const show = useCallback(
    (type: ToastType, message: string) => {
      if (timer.current) clearTimeout(timer.current);
      setToast({ type, message });
      Animated.timing(anim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
      // Errors stay longer: they usually need reading.
      timer.current = setTimeout(hide, type === 'error' ? 5000 : 3000);
    },
    [anim, hide],
  );

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (m) => show('success', m),
      error: (m) => show('error', m),
      info: (m) => show('info', m),
    }),
    [show],
  );

  const s = toast ? STYLE[toast.type] : null;

  return (
    <ToastContext.Provider value={api}>
      {children}
      {toast && s ? (
        <Animated.View
          pointerEvents="box-none"
          style={[
            styles.wrap,
            {
              top: insets.top + spacing.sm,
              opacity: anim,
              transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-20, 0] }) }],
            },
          ]}
        >
          <Pressable
            onPress={hide}
            accessibilityRole="alert"
            style={[styles.toast, { backgroundColor: s.bg, borderColor: s.fg }]}
          >
            <s.Icon size={22} color={s.fg} />
            <Text style={[styles.text, { color: s.fg }]}>{toast.message}</Text>
          </Pressable>
        </Animated.View>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: spacing.lg, right: spacing.lg, zIndex: 1000 },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    ...shadow,
  },
  text: { flex: 1, fontFamily: fonts.semibold, fontSize: fontSize.body },
});
