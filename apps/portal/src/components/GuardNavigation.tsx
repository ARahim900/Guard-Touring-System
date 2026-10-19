import { FileText, LayoutDashboard, ScanLine } from 'lucide-react';
import { NavLink } from 'react-router';

export const guardPages = [
  { to: '/guard', label: 'Scan', short: 'Scan', icon: ScanLine },
  { to: '/', label: 'Dashboard', short: 'Dashboard', icon: LayoutDashboard },
  { to: '/reports', label: 'Reports', short: 'Reports', icon: FileText },
];

/** Shared by the portal frame and the dedicated scanning screen. */
export function GuardNavigation({ inert = false }: { inert?: boolean }) {
  return <nav inert={inert} aria-label="Main navigation" className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] lg:hidden">
    <ul className="grid grid-cols-3">
      {guardPages.map(({ to, label, icon: Icon }) => <li key={to}>
        <NavLink to={to} end className={({ isActive }) => `relative flex min-h-16 flex-col items-center justify-center gap-1 text-sm ${isActive ? 'font-semibold text-primary' : 'text-muted-foreground'}`}>
          {({ isActive }) => <>
            {isActive ? <span aria-hidden="true" className="absolute inset-x-3 top-0 h-[3px] rounded-b-sm bg-secondary" /> : null}
            <Icon aria-hidden="true" className="size-5" />{label}
          </>}
        </NavLink>
      </li>)}
    </ul>
  </nav>;
}
