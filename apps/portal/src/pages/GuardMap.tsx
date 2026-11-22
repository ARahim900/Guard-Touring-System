// =============================================================================
// Guard map tab (phone): where every patrol location is and which to visit next.
// =============================================================================
// The map shows each location in its patrol state. Below it, the locations still
// to visit are listed nearest first once the guard shows their position (in
// patrol order before that), each with directions and a shortcut that opens the
// camera for it on the Scan tab.
// =============================================================================
import { FileText, LayoutDashboard, Navigation, RefreshCw, ScanLine } from 'lucide-react';
import { useState } from 'react';
import { Link, Navigate } from 'react-router';

import { BrandMark } from '@/components/BrandMark';
import { GuardNavigation } from '@/components/GuardNavigation';
import { GuardPatrolMap, type MyPosition, type PinState } from '@/components/GuardPatrolMap';
import { ErrorNote, Spinner } from '@/components/ui';
import { UpdateBanner } from '@/components/UpdateBanner';
import { useAuth } from '@/context/AuthContext';
import { distanceMetres, formatDistance, isPlaced } from '@/lib/geo';
import type { PatrolCheckpoint } from '@/lib/guardPatrol';
import { useGuardPatrol } from '@/lib/useGuardPatrol';

function GuardMap({ userId }: { userId: string }) {
  const { snapshot, receipts, loading, syncing, cached, error, refresh } = useGuardPatrol(userId);
  const [position, setPosition] = useState<MyPosition | null>(null);
  const shift = snapshot?.shift;
  const active = shift?.status === 'active';
  const checkpoints = snapshot?.checkpoints ?? [];
  const waitingIds = new Set(receipts.filter((r) => r.state === 'pending' && r.shiftId === shift?.id).map((r) => r.checkpointId));

  const stateOf = (c: PatrolCheckpoint): PinState => {
    if (c.completed) return 'done';
    if (waitingIds.has(c.checkpoint_id) || c.validation === 'flagged') return 'waiting';
    return 'todo';
  };
  const verified = checkpoints.filter((c) => c.completed).length;
  const toVisit = checkpoints
    .filter((c) => stateOf(c) === 'todo')
    .map((c) => ({ checkpoint: c, distance: position && isPlaced(c.latitude, c.longitude) ? distanceMetres(position.lat, position.lng, c.latitude, c.longitude) : null }))
    .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity) || a.checkpoint.sequence - b.checkpoint.sequence);

  if (loading) return <><Spinner label="Loading the map…" /><GuardNavigation /></>;
  return (
    <>
      <header className="sticky top-0 z-30 bg-primary px-4 pt-[calc(12px+env(safe-area-inset-top))] pb-4 text-white shadow-card">
        <div className="mx-auto flex max-w-xl items-center gap-3">
          <BrandMark className="size-9 shrink-0" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg text-white">Map</h1>
            <p className="text-sm text-white/90">{active && checkpoints.length ? `${verified} of ${checkpoints.length} verified · ${toVisit.length} to go` : `${checkpoints.length} patrol locations`}</p>
          </div>
          <Link to="/guard" aria-label="Scan" className="flex size-11 items-center justify-center rounded-full text-white/90 hover:bg-white/10"><ScanLine className="size-5" aria-hidden="true" /></Link>
          <Link to="/" aria-label="Dashboard" className="hidden size-11 items-center justify-center rounded-full text-white/90 hover:bg-white/10 lg:flex"><LayoutDashboard className="size-5" aria-hidden="true" /></Link>
          <Link to="/reports" aria-label="Daily reports" className="hidden size-11 items-center justify-center rounded-full text-white/90 hover:bg-white/10 lg:flex"><FileText className="size-5" aria-hidden="true" /></Link>
          <button type="button" onClick={() => void refresh(true)} disabled={syncing} aria-label="Refresh" className="flex size-11 items-center justify-center rounded-full text-white/90 hover:bg-white/10 disabled:opacity-50">
            <RefreshCw className={`size-5 ${syncing ? 'animate-spin' : ''}`} aria-hidden="true" />
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-xl space-y-5 px-4 pt-4 pb-28 lg:pb-10">
        <UpdateBanner />
        <ErrorNote message={error} />
        {cached ? <p role="status" className="rounded-xl bg-muted px-4 py-3 text-sm">Showing the patrol saved on this phone. It could not be updated just now.</p> : null}
        {!checkpoints.length ? <p className="rounded-xl bg-muted px-4 py-3">Your manager needs to add the patrol locations.</p> : (
          <GuardPatrolMap checkpoints={checkpoints} stateOf={stateOf} position={position} onPosition={setPosition} className="h-[50vh] min-h-[300px] w-full" />
        )}
        {!active && checkpoints.length ? <p className="rounded-xl bg-secondary-light px-4 py-3 text-sm text-primary">Start your patrol on the <Link to="/guard" className="font-semibold underline">Scan</Link> tab to scan these locations.</p> : null}

        {toVisit.length ? (
          <section>
            <div className="mb-3 px-1">
              <h2 className="text-base">{position ? 'Nearest locations to visit' : 'Locations to visit'}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{position ? 'Sorted by straight-line distance from where you are.' : 'Tap “Show where I am” to sort them by distance.'}</p>
            </div>
            <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
              {toVisit.map(({ checkpoint, distance }) => (
                <li key={checkpoint.checkpoint_id} className="flex items-center gap-2 px-4 py-2">
                  <div className="min-w-0 flex-1 py-1">
                    <p className="font-semibold break-words">{checkpoint.checkpoint_name}</p>
                    <p className="text-sm text-muted-foreground tabular-nums">{distance !== null ? `${formatDistance(distance)} away` : isPlaced(checkpoint.latitude, checkpoint.longitude) ? `Stop ${checkpoint.sequence}` : 'Not placed on the map yet'}</p>
                  </div>
                  {isPlaced(checkpoint.latitude, checkpoint.longitude) ? (
                    <a href={`https://www.google.com/maps/dir/?api=1&destination=${checkpoint.latitude},${checkpoint.longitude}`} target="_blank" rel="noreferrer" aria-label={`Directions to ${checkpoint.checkpoint_name}`}
                      className="flex size-11 items-center justify-center rounded-full text-primary active:bg-muted"><Navigation className="size-5" aria-hidden="true" /></a>
                  ) : null}
                  {active ? (
                    <Link to={`/guard?scan=${encodeURIComponent(checkpoint.checkpoint_id)}`} className="flex min-h-11 items-center gap-1.5 rounded-xl bg-primary px-3 text-sm font-semibold text-white">
                      <ScanLine className="size-4" aria-hidden="true" />Scan
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : active && checkpoints.length ? <p role="status" className="rounded-xl bg-success-bg px-4 py-3 text-success-text">Every location is scanned for this round.</p> : null}
      </main>
      <GuardNavigation />
    </>
  );
}

export default function GuardMapPage() {
  const { profile } = useAuth();
  if (!profile) return null;
  if (profile.role !== 'guard') return <Navigate to="/live" replace />;
  return <div className="min-h-full bg-background"><GuardMap key={profile.id} userId={profile.id} /></div>;
}
