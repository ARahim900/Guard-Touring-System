// =============================================================================
// Portal entry point: fonts, styles, crash reporting, routes.
// =============================================================================
import '@fontsource-variable/dm-sans';
import './index.css';

import * as Sentry from '@sentry/react';
import { StrictMode, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, Outlet, RouterProvider } from 'react-router';
import { Toaster } from 'sonner';

import { Layout } from '@/components/Layout';
import { Spinner } from '@/components/ui';
import { AlarmProvider } from '@/context/AlarmContext';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { env } from '@/lib/env';
import DashboardPage from '@/pages/Dashboard';
import LoginPage from '@/pages/Login';
import PrivacyPage from '@/pages/Privacy';

/**
 * Load a page's code only when it is first opened ("code splitting"), so the
 * first visit downloads less. The PDF and QR libraries load only on their pages.
 */
const page = (load: () => Promise<{ default: ComponentType }>) => async () => ({ Component: (await load()).default });

if (env.sentryDsn) {
  Sentry.init({
    dsn: env.sentryDsn, // Sentry does not collect personal data unless told to
    tracesSampleRate: 0.1,
    environment: import.meta.env.MODE,
  });
}

/** Active accounts share sign-in; staff pages have an additional role check. */
function RequireAccount() {
  const { session, profile, loading, loadError, retry } = useAuth();
  if (loading) return <Spinner label="Checking sign-in…" />;
  if (loadError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-danger-text">{loadError}</p>
        <button className="rounded-sm bg-primary px-4 py-2 text-white" onClick={retry}>Try again</button>
      </div>
    );
  }
  if (!session || !profile) return <Navigate to="/login" replace />;
  return <Outlet />;
}

function RequireStaff() {
  const { profile } = useAuth();
  if (profile?.role === 'guard') return <Navigate to="/guard" replace />;
  return <AlarmProvider><Outlet /></AlarmProvider>;
}

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/privacy', element: <PrivacyPage /> }, // public: linked from the app stores
  {
    element: <RequireAccount />,
    children: [
      { path: 'guard', lazy: page(() => import('@/pages/GuardPatrol')) },
      { element: <RequireStaff />, children: [
      {
        element: <Layout />,
        children: [
          { index: true, element: <DashboardPage /> },
          { path: 'live', lazy: page(() => import('@/pages/LiveMap')) },
          { path: 'alarms', lazy: page(() => import('@/pages/Alarms')) },
          { path: 'incidents', lazy: page(() => import('@/pages/Incidents')) },
          { path: 'scans', lazy: page(() => import('@/pages/Scans')) },
          { path: 'shifts', lazy: page(() => import('@/pages/Shifts')) },
          { path: 'routes', lazy: page(() => import('@/pages/Routes')) },
          { path: 'checkpoints', lazy: page(() => import('@/pages/Checkpoints')) },
          { path: 'guards', lazy: page(() => import('@/pages/Guards')) },
          { path: 'contractors', lazy: page(() => import('@/pages/Contractors')) },
          { path: 'reports', lazy: page(() => import('@/pages/Reports')) },
          { path: '*', element: <Navigate to="/" replace /> },
        ],
      },
      ] },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={<p className="p-8">Something went wrong. Please reload the page.</p>}>
      <AuthProvider>
        <RouterProvider router={router} />
        <Toaster position="top-right" richColors closeButton />
      </AuthProvider>
    </Sentry.ErrorBoundary>
  </StrictMode>,
);
