// =============================================================================
// App shell: purple brand sidebar (220 px) + white top bar (64 px).
// On small screens the sidebar becomes a slide-in menu.
// =============================================================================
import {
  BarChart3,
  BellRing,
  Building2,
  CalendarClock,
  ClipboardCheck,
  LayoutDashboard,
  LogOut,
  Map,
  MapPin,
  Menu,
  Route as RouteIcon,
  ShieldAlert,
  Users,
} from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet } from 'react-router';

import { useAlarms } from '@/context/AlarmContext';
import { useAuth } from '@/context/AuthContext';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/live', label: 'Live map', icon: Map },
  { to: '/alarms', label: 'Alarms', icon: BellRing, badge: true },
  { to: '/incidents', label: 'Incidents', icon: ShieldAlert },
  { to: '/scans', label: 'Scan records', icon: ClipboardCheck },
  { to: '/shifts', label: 'Schedules', icon: CalendarClock },
  { to: '/routes', label: 'Routes', icon: RouteIcon },
  { to: '/checkpoints', label: 'Checkpoints', icon: MapPin },
  { to: '/guards', label: 'Guards & users', icon: Users },
  { to: '/contractors', label: 'Contractors', icon: Building2 },
  { to: '/reports', label: 'Monthly reports', icon: BarChart3 },
];

export function Layout() {
  const { profile, signOut } = useAuth();
  const { openCount, sosOpen } = useAlarms();
  const [menuOpen, setMenuOpen] = useState(false);

  const sidebar = (
    <nav className="flex h-full w-[220px] flex-col bg-sidebar text-sidebar-foreground">
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
        {NAV.map((n) => (
          <li key={n.to}>
            <NavLink
              to={n.to}
              end={n.end}
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                  isActive ? 'bg-[rgba(77,191,191,0.15)] font-semibold text-secondary' : 'hover:bg-white/5 hover:text-white'
                }`
              }
            >
              <n.icon className="size-5" />
              <span className="flex-1">{n.label}</span>
              {n.badge && openCount > 0 ? (
                <span className={`rounded-full px-2 text-xs font-bold text-white ${sosOpen ? 'bg-status-danger' : 'bg-danger'}`}>{openCount}</span>
              ) : null}
            </NavLink>
          </li>
        ))}
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
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-white/90 px-4 backdrop-blur-md lg:px-8">
          <button className="rounded-md p-2 hover:bg-muted lg:hidden" onClick={() => setMenuOpen(true)} aria-label="Open menu">
            <Menu className="size-5" />
          </button>
          <p className="font-semibold text-primary">Muscat Bay · Security Patrols</p>
          {sosOpen > 0 ? (
            <NavLink to="/alarms" className="ml-auto flex items-center gap-2 rounded-md bg-status-danger px-3 py-1.5 text-sm font-bold text-white">
              <BellRing className="size-4" /> {sosOpen} open SOS
            </NavLink>
          ) : null}
        </header>
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1536px] px-3 py-6 sm:px-5 lg:px-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
