// Sentry = crash reporting. When the app crashes or an unexpected error is
// caught, a report (stack trace, device model, app version) goes to Sentry so
// you can fix it without the guard having to describe it.
// Privacy: we do NOT send personal data (sendDefaultPii: false), and we strip
// GPS coordinates from breadcrumbs.
import * as Sentry from '@sentry/react-native';

import { env } from './env';

export function initSentry() {
  if (!env.sentryDsn) return; // Sentry is optional in development
  Sentry.init({
    dsn: env.sentryDsn,
    sendDefaultPii: false,
    tracesSampleRate: 0.1, // 10% of sessions get performance traces
    enableAutoSessionTracking: true,
    environment: __DEV__ ? 'development' : 'production',
    beforeBreadcrumb(breadcrumb) {
      if (breadcrumb.data && ('latitude' in breadcrumb.data || 'longitude' in breadcrumb.data)) {
        return { ...breadcrumb, data: { redacted: true } };
      }
      return breadcrumb;
    },
  });
}

export function reportError(error: unknown, context?: Record<string, unknown>) {
  if (__DEV__) console.warn(error, context);
  if (env.sentryDsn) Sentry.captureException(error, context ? { extra: context } : undefined);
}

export { Sentry };
