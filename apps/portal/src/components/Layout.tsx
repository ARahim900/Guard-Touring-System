// =============================================================================
// Staff page frame: purple top bar with the brand mark and account menu, tabs
// on desktop, and a bottom bar on phones and tablets (no sideways scrolling).
// The bars sit at z-40, below dialogs (z-50); Leaflet is isolated in index.css.
// =============================================================================
import { Bell, ChevronDown, FileText, LogOut, Map as MapIcon, MapPin, Menu, Moon, ScanLine, TriangleAlert, X, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';

import { BrandMark } from '@/components/BrandMark';
import { useAlarms } from '@/context/AlarmContext';
import { useAuth } from '@/context/AuthContext';
import type { UserRole } from '@/lib/types';

interface NavPage {
  to: string;
  label: string;
  /** Shorter label for the phone bottom bar; pages without one sit under "More". */
  short?: string;
  icon: LucideIcon;
}

const pages: NavPage[] = [
  { to: '/', label: 'Night patrol', short: 'Patrol', icon: Moon },
  { to: '/alarms', label: 'Alarms', short: 'Alarms', icon: Bell },
  { to: '/live', label: 'Live map', short: 'Map', icon: MapIcon },
  { to: '/incidents', label: 'Incidents', icon: TriangleAlert },
  { to: '/scans', label: 'Scans', short: 'Scans', icon: ScanLine },
  { to: '/checkpoints', label: 'Locations', icon: MapPin },
  { to: '/reports', label: 'Reports', icon: FileText },
];
const barPages = pages.filter((page) => page.short);
const morePages = pages.filter((page) => !page.short);

const ROLE_LABEL: Record<UserRole, string> = { admin: 'Admin', supervisor: 'Supervisor', guard: 'Guard' };

function initials(name: string | undefined) {
  const letters = (name ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]?.toUpperCase());
  return letters.join('') || '?';
}

/** Open-alarm count. The number is also spoken, so it does not rely on colour. */
function AlarmCount({ count, className = '' }: { count: number | null; className?: string }) {
  if (!count) return null;
  return (
    <span className={`inline-flex min-w-6 items-center justify-center rounded-full bg-danger-bg px-1.5 text-xs leading-5 font-semibold text-danger-text ring-1 ring-danger ${className}`}>
      {count}
      <span className="sr-only"> open</span>
    </span>
  );
}

function AccountMenu() {
  const { profile, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const role = profile ? ROLE_LABEL[profile.role] : '';
  return (
    <div ref={wrapRef} className="relative min-w-0">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex min-h-11 items-center gap-3 rounded-sm px-1 text-left transition-colors duration-150 hover:bg-white/10"
      >
        <span className="hidden min-w-0 text-right sm:block">
          <span className="block max-w-48 truncate text-sm font-semibold">{profile?.full_name}</span>
          <span className="block text-sm text-secondary">{role}</span>
        </span>
        <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-semibold text-primary">
          {initials(profile?.full_name)}
        </span>
        <span className="sr-only">Account menu for {profile?.full_name}</span>
        <ChevronDown aria-hidden="true" className={`size-4 shrink-0 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? (
        <div id={panelId} className="absolute right-0 z-10 mt-2 w-64 rounded-lg border border-border bg-card p-2 text-foreground shadow-card">
          <div className="border-b border-border px-3 pt-1 pb-3">
            <p className="truncate font-semibold text-primary">{profile?.full_name}</p>
            {profile?.email ? <p className="truncate text-sm text-muted-foreground">{profile.email}</p> : null}
            <p className="text-sm text-muted-foreground">{role}</p>
          </div>
          <button type="button" onClick={() => void signOut()} className="mt-2 flex min-h-11 w-full items-center gap-2 rounded-sm px-3 text-sm font-semibold text-primary transition-colors duration-150 hover:bg-muted">
            <LogOut aria-hidden="true" className="size-4" />Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

function MoreSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const titleId = useId();
  const firstLinkRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (!open) return;
    firstLinkRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40 lg:hidden" onPointerDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full rounded-t-lg bg-card p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-card"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between">
          <h2 id={titleId} className="text-base">More pages</h2>
          <button type="button" onClick={onClose} className="flex size-11 items-center justify-center rounded-sm text-primary hover:bg-muted" aria-label="Close">
            <X aria-hidden="true" className="size-5" />
          </button>
        </div>
        <ul className="space-y-1">
          {morePages.map(({ to, label, icon: Icon }, index) => (
            <li key={to}>
              <NavLink
                ref={index === 0 ? firstLinkRef : undefined}
                to={to}
                onClick={onClose}
                className={({ isActive }) => `flex min-h-12 items-center gap-3 rounded-md px-3 font-semibold transition-colors duration-150 ${isActive ? 'bg-secondary-light text-primary' : 'text-foreground hover:bg-muted'}`}
              >
                <Icon aria-hidden="true" className="size-5 text-primary" />{label}
              </NavLink>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function Layout() {
  const { openCount } = useAlarms();
  const { pathname } = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const closeMore = useCallback(() => setMoreOpen(false), []);
  const moreActive = morePages.some((page) => pathname.startsWith(page.to));

  return (
    <div className="flex min-h-full flex-col bg-background">
      <div className="sticky top-0 z-40">
        <header className="bg-primary px-4 py-2.5 text-white sm:px-6">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
            <NavLink to="/" className="flex min-h-11 shrink-0 items-center gap-3 rounded-sm" aria-label="MB Patrol home">
              <BrandMark className="size-9" />
              <span className="leading-tight">
                <span className="hidden text-sm tracking-[0.14em] text-secondary uppercase sm:block">Muscat Bay Security</span>
                <span className="block font-serif text-lg font-semibold">MB Patrol</span>
              </span>
            </NavLink>
            <AccountMenu />
          </div>
        </header>
        <nav aria-label="Main navigation" className="hidden border-b border-border bg-card px-3 lg:block">
          <ul className="mx-auto flex max-w-5xl gap-1">
            {pages.map(({ to, label, icon: Icon }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end={to === '/'}
                  className={({ isActive }) => `flex min-h-12 items-center gap-2 border-b-[3px] px-3 text-sm font-semibold whitespace-nowrap transition-colors duration-150 ${isActive ? 'border-secondary text-primary' : 'border-transparent text-muted-foreground hover:text-primary'}`}
                >
                  <Icon aria-hidden="true" className="size-4" />
                  {label}
                  {to === '/alarms' ? <AlarmCount count={openCount} /> : null}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-6 pb-28 sm:px-6 lg:pb-6"><Outlet /></main>

      <nav aria-label="Main navigation" className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] lg:hidden">
        <ul className="grid grid-cols-5">
          {barPages.map(({ to, short, icon: Icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={to === '/'}
                className={({ isActive }) => `relative flex min-h-16 flex-col items-center justify-center gap-0.5 text-sm transition-colors duration-150 ${isActive ? 'font-semibold text-primary' : 'text-muted-foreground'}`}
              >
                {({ isActive }) => (
                  <>
                    {isActive ? <span aria-hidden="true" className="absolute inset-x-3 top-0 h-[3px] rounded-b-sm bg-secondary" /> : null}
                    <span className="relative">
                      <Icon aria-hidden="true" className="size-5" />
                      {to === '/alarms' ? <AlarmCount count={openCount} className="absolute -top-2 left-3" /> : null}
                    </span>
                    {short}
                  </>
                )}
              </NavLink>
            </li>
          ))}
          <li>
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              aria-haspopup="dialog"
              aria-current={moreActive ? 'page' : undefined}
              className={`relative flex min-h-16 w-full flex-col items-center justify-center gap-0.5 text-sm transition-colors duration-150 ${moreActive ? 'font-semibold text-primary' : 'text-muted-foreground'}`}
            >
              {moreActive ? <span aria-hidden="true" className="absolute inset-x-3 top-0 h-[3px] rounded-b-sm bg-secondary" /> : null}
              <Menu aria-hidden="true" className="size-5" />More
            </button>
          </li>
        </ul>
      </nav>
      <MoreSheet open={moreOpen} onClose={closeMore} />
    </div>
  );
}
