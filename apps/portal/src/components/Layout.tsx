// =============================================================================
// App shell: purple brand sidebar (220 px) + white top bar (64 px).
// On small screens the sidebar becomes a slide-in menu.
// =============================================================================
import { BarChart3, BellRing, CalendarClock, LayoutDashboard, LogOut, Menu, Settings } from 'lucide-react';
import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';

import { useAlarms } from '@/context/AlarmContext';
import { useAuth } from '@/context/AuthContext';

const SECTIONS = [
  {
    label: 'Overview', icon: LayoutDashboard,
    pages: [
      { to: '/', label: 'Summary' },
      { to: '/live', label: 'Live map' },
      { to: '/alarms', label: 'Alarms' },
      { to: '/incidents', label: 'Incidents' },
    ],
  },
  {
    label: 'Patrols', icon: CalendarClock,
    pages: [
      { to: '/shifts', label: 'Schedules & shift hours' },
      { to: '/guard', label: 'Guard scanning' },
      { to: '/scans', label: 'Scan records' },
    ],
  },
  { label: 'Reports', icon: BarChart3, pages: [{ to: '/reports', label: 'Patrol reports' }] },
  {
    label: 'Settings', icon: Settings,
    pages: [
      { to: '/checkpoints', label: 'Locations & barcodes' },
      { to: '/routes', label: 'Patrol routes' },
      { to: '/guards', label: 'Guards & users' },
      { to: '/contractors', label: 'Contractors' },
    ],
  },
];

export function Layout() {
  const { profile, signOut } = useAuth();
  const { openCount, sosOpen } = useAlarms();
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const currentSection = SECTIONS.find((section) => section.pages.some((page) => page.to === pathname));

  const sidebar = (
    <nav aria-label="Main navigation" className="flex h-full w-[220px] flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-16 items-center gap-2 border-b border-white/10 px-4">
        {/* The logo is purple, so it sits on a white tile to stay visible on the purple sidebar. */}
        <span className="flex size-9 items-center justify-center rounded-md bg-white p-1">
          <img src="/muscat-bay-mark.png" alt="Muscat Bay" className="size-full" />
        </span>
        <div className="leading-tight">
          <p className="font-bold text-white">MB Patrol</p>
          <p className="text-xs text-sidebar-foreground/80">Supervisor portal</p>
        </div>
      </div>
      <ul className="flex-1 space-y-0.5 overflow-y-auto p-2">
        {SECTIONS.map((section) => {
          const active = section === currentSection;
          return (
            <li key={section.label}>
              <Link
                to={section.pages[0].to}
                aria-current={active ? 'page' : undefined}
                onClick={() => setMenuOpen(false)}
                className={`flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-secondary ${
                  active ? 'bg-secondary/15 font-semibold text-secondary' : 'hover:bg-white/5 hover:text-white'
                }`}
              >
                <section.icon aria-hidden="true" className="size-5" />
                <span className="flex-1">{section.label}</span>
                {section.label === 'Overview' && (openCount ?? 0) > 0 ? (
                  <span aria-label={`${openCount} open alarms`} className="rounded-full bg-secondary px-2 text-xs font-bold text-primary">{openCount}</span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="border-t border-white/10 p-3 text-xs">
        <p className="truncate font-semibold text-white">{profile?.full_name}</p>
        <p className="capitalize">{profile?.role}</p>
        <button onClick={() => void signOut()} className="mt-2 flex items-center gap-2 rounded-md px-2 py-1 hover:bg-white/10">
          <LogOut className="size-4" /> Sign out
        </button>
      </div>
    </nav>
  );

  return (
    <div className="flex h-full">
      <aside className="hidden lg:block">{sidebar}</aside>
      {menuOpen ? (
        <div className="fixed inset-0 z-40 flex lg:hidden" onClick={() => setMenuOpen(false)}>
          <div onClick={(e) => e.stopPropagation()}>{sidebar}</div>
          <div className="flex-1 bg-black/40" />
        </div>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-white px-4 lg:px-8">
          <button className="rounded-md p-2 hover:bg-muted lg:hidden" onClick={() => setMenuOpen(true)} aria-label="Open menu">
            <Menu className="size-5" />
          </button>
          <p className="font-semibold text-primary">Muscat Bay · Security Patrols</p>
          {(sosOpen ?? 0) > 0 ? (
            <NavLink to="/alarms" className="ml-auto flex items-center gap-2 rounded-md bg-status-danger px-3 py-1.5 text-sm font-bold text-white">
              <BellRing className="size-4" /> {sosOpen} open SOS
            </NavLink>
          ) : null}
        </header>
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1536px] px-3 py-6 sm:px-5 lg:px-8">
            {currentSection && currentSection.pages.length > 1 ? (
              <div className="mb-6 flex flex-wrap items-center gap-3 border-b border-border pb-4">
                <label htmlFor="section-view" className="text-sm font-semibold text-primary">{currentSection.label}</label>
                <select
                  id="section-view"
                  value={pathname}
                  onChange={(event) => navigate(event.target.value)}
                  className="min-h-11 max-w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                >
                  {currentSection.pages.map((page) => <option key={page.to} value={page.to}>{page.label}</option>)}
                </select>
              </div>
            ) : null}
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
