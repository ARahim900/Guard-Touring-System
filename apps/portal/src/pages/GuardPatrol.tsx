// =============================================================================
// Guard patrol screen (phone): one job, scan every location once.
// =============================================================================
// Layout, top to bottom: a header with a progress ring, a "Next stop" card,
// the locations still to visit as tiles (tap one to make it the next stop, so
// the guard chooses the order), the visited ones as green chips, and a Scan
// button fixed at the bottom within thumb reach. Any location can be scanned at
// any time. Every scan ends in a full-screen pop-up that says plainly whether
// the visit counted.
// =============================================================================
import { AlertTriangle, CheckCircle2, ChevronRight, CloudUpload, LogOut, Navigation, RefreshCw, ScanLine, XCircle } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate } from 'react-router';
import { GuardShiftStart } from '@/components/GuardShiftStart';
import { InstallPatrol } from '@/components/InstallPatrol';
import { PatrolScanner } from '@/components/PatrolScanner';
import { ScanConfirm, type ConfirmState } from '@/components/ScanConfirm';
import { ErrorNote, Spinner } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { friendlyError } from '@/lib/errors';
import { captureLocation, type PatrolCheckpoint } from '@/lib/guardPatrol';
import { readReceipts, saveReceipt, type PatrolReceipt } from '@/lib/guardOutbox';
import { scanFeedback } from '@/lib/scanFeedback';
import { formatDateTime, formatTime } from '@/lib/time';
import { useGuardPatrol } from '@/lib/useGuardPatrol';

type Status = 'verified' | 'uploading' | 'review' | 'rejected' | 'todo';

function statusOf(checkpoint: PatrolCheckpoint, uploading: boolean): Status {
  if (checkpoint.completed) return 'verified';
  if (uploading) return 'uploading';
  if (checkpoint.validation === 'flagged') return 'review';
  if (checkpoint.validation === 'rejected') return 'rejected';
  return 'todo';
}

function GuardTour({ userId, fullName, footer }: { userId: string; fullName: string; footer: ReactNode }) {
  const { signOut } = useAuth();
  const { snapshot, receipts, loading, syncing, cached, error, refresh } = useGuardPatrol(userId);
  const [scanning, setScanning] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [nextId, setNextId] = useState<string | null>(null);
  const scanInProgress = useRef(false);
  const shift = snapshot?.shift;
  const active = shift?.status === 'active';
  const checkpoints = snapshot?.checkpoints ?? [];
  const pending = receipts.filter((receipt) => receipt.state === 'pending');
  const inWindow = Boolean(shift && Date.now() >= Date.parse(shift.scheduled_start) && Date.now() <= Date.parse(shift.scheduled_end));
  const canScan = active && inWindow && checkpoints.length > 0;

  const rows = checkpoints.map((checkpoint) => ({
    checkpoint,
    status: statusOf(checkpoint, pending.some((receipt) => receipt.shiftId === shift?.id && receipt.checkpointId === checkpoint.checkpoint_id)),
  }));
  const toVisit = rows.filter((row) => row.status === 'todo' || row.status === 'rejected');
  const visited = rows.filter((row) => row.status !== 'todo' && row.status !== 'rejected')
    .sort((a, b) => (b.checkpoint.scanned_at ?? '').localeCompare(a.checkpoint.scanned_at ?? ''));
  const verified = rows.filter((row) => row.status === 'verified').length;
  const uploading = rows.filter((row) => row.status === 'uploading').length;
  const review = rows.filter((row) => row.status === 'review').length;
  // The guard's chosen next stop; once it is visited, the first remaining location takes its place.
  const next = active ? toVisit.find((row) => row.checkpoint.checkpoint_id === nextId) ?? toVisit[0] : undefined;

  function chooseNext(checkpointId: string) {
    setNextId(checkpointId);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // The pop-up follows the saved receipt, so it turns green the moment the upload is confirmed.
  const shown: ConfirmState | null = confirm?.kind === 'receipt'
    ? { kind: 'receipt', receipt: receipts.find((item) => item.id === confirm.receipt.id) ?? confirm.receipt } : confirm;

  // While the camera or a pop-up is open, the page behind it cannot be reached; afterwards focus returns to Scan.
  const overlay = scanning || shown !== null;
  const scanButton = useRef<HTMLButtonElement>(null);
  const wasOverlay = useRef(false);
  useEffect(() => {
    if (wasOverlay.current && !overlay) scanButton.current?.focus();
    wasOverlay.current = overlay;
  }, [overlay]);
  const thisShift = receipts.filter((receipt) => !shift || receipt.shiftId === shift.id);

  function openScanner() {
    setActionError(null); setConfirm(null); setScanning(true);
  }

  async function record(code: string, method: 'qr' | 'barcode') {
    if (scanInProgress.current) return;
    scanInProgress.current = true;
    setScanning(false);
    const deviceTime = new Date().toISOString();
    const checkpoint = checkpoints.find((item) => item.code === code.trim());
    try {
      if (!shift || !active || !inWindow) throw new Error('Scanning is only available during your patrol.');
      if (!checkpoint) {
        setConfirm({ kind: 'notice', tone: 'danger', title: 'Not one of tonight’s locations', message: 'This QR code is not on your patrol. Scan the QR label fixed at the location.' });
        return;
      }
      if (checkpoint.completed) {
        setConfirm({ kind: 'notice', tone: 'info', name: checkpoint.checkpoint_name, title: 'Already verified', message: `Verified at ${formatTime(checkpoint.scanned_at ?? '')}. No need to scan it again tonight.` });
        return;
      }
      if ((await readReceipts(userId)).some((item) => item.shiftId === shift.id && item.checkpointId === checkpoint.checkpoint_id && item.state === 'pending')) {
        setConfirm({ kind: 'notice', tone: 'info', name: checkpoint.checkpoint_name, title: 'Already saved on this phone', message: 'This visit is waiting to upload. It uploads by itself when there is a connection.' });
        return;
      }
      setConfirm({ kind: 'checking', name: checkpoint.checkpoint_name, message: 'Getting your GPS position…' });
      const position = await captureLocation();
      const receipt: PatrolReceipt = {
        id: crypto.randomUUID(), userId, shiftId: shift.id, checkpointId: checkpoint.checkpoint_id,
        checkpointName: checkpoint.checkpoint_name, code: code.trim(), method, deviceTime,
        latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy, state: 'pending',
      };
      await saveReceipt(receipt);
      setConfirm({ kind: 'checking', name: checkpoint.checkpoint_name, message: 'Verifying the visit…' });
      await refresh(true);
      setConfirm({ kind: 'receipt', receipt });
    } catch (cause) {
      setConfirm({ kind: 'notice', tone: 'danger', name: checkpoint?.checkpoint_name, title: 'Scan not recorded', message: friendlyError(cause) });
    } finally { scanInProgress.current = false; }
  }

  async function leave() {
    try {
      if ((await readReceipts(userId)).some((receipt) => receipt.state === 'pending')) throw new Error('Upload your saved scans before signing out.');
      await signOut();
    } catch (cause) { setActionError(friendlyError(cause)); }
  }

  if (loading) return <Spinner label="Loading your patrol…" />;
  return (
    <>
      <header inert={overlay} className="sticky top-0 z-30 bg-primary px-4 pt-[calc(12px+env(safe-area-inset-top))] pb-4 text-white shadow-card">
        <div className="mx-auto max-w-xl">
          <div className="flex items-center gap-3">
            <img src="/apple-touch-icon.png" alt="" className="size-10 rounded-xl" />
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-lg text-white">{active ? 'Night patrol' : 'MB Security'}</h1>
              <p className="truncate text-sm text-white/80">{active ? `${shift.on_duty_name ?? fullName} · ends by itself ${formatTime(shift.scheduled_end)}` : fullName}</p>
            </div>
            <button type="button" onClick={() => void leave()} disabled={overlay || syncing} aria-label="Sign out" className="flex size-11 items-center justify-center rounded-full text-white/90 hover:bg-white/10 disabled:opacity-50"><LogOut className="size-5" aria-hidden="true" /></button>
          </div>
          {active && checkpoints.length ? (
            <div className="mt-4 flex items-center gap-4 rounded-2xl bg-white/10 px-4 py-3">
              <ProgressRing done={verified} total={checkpoints.length} />
              <div className="min-w-0">
                <p className="text-lg font-semibold text-white">{verified} of {checkpoints.length} verified</p>
                <p className="text-sm text-white/80">{[toVisit.length ? `${toVisit.length} to go` : 'All scanned', uploading ? `${uploading} uploading` : '', review ? `${review} in review` : ''].filter(Boolean).join(' · ')}</p>
              </div>
            </div>
          ) : null}
        </div>
      </header>

      <main inert={overlay} className={`mx-auto max-w-xl space-y-5 px-4 pt-4 ${active ? 'pb-36' : 'pb-10'}`}>
        <ErrorNote message={actionError ?? error} />
        {cached ? <p role="status" className="rounded-xl bg-muted px-4 py-3 text-sm">Showing the patrol saved on this phone. It could not be updated just now.</p> : null}
        {pending.length ? (
          <div role="status" className="flex items-center gap-3 rounded-xl border border-warning bg-warning-bg px-4 py-3 text-warning-text">
            <CloudUpload className="size-5 shrink-0" aria-hidden="true" />
            <p className="flex-1 text-sm font-medium">{pending.length} scan{pending.length === 1 ? '' : 's'} saved on this phone, waiting to upload. Keep the app open.</p>
            <button type="button" onClick={() => void refresh(true)} disabled={syncing} className="flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-semibold underline disabled:opacity-50"><RefreshCw className={`size-4 ${syncing ? 'animate-spin' : ''}`} aria-hidden="true" />Retry</button>
          </div>
        ) : null}

        {!active ? <GuardShiftStart key={shift?.id ?? 'new'} names={snapshot?.guardNames ?? []} endTime={snapshot?.endTime ?? null} disabled={!snapshot || cached || syncing || pending.length > 0 || checkpoints.length === 0} onStarted={async () => { await refresh(true); setScanning(true); }} /> : null}
        {active && !inWindow ? <p role="status" className="rounded-xl bg-muted px-4 py-3 text-sm">This patrol has ended. Tap Refresh to load the next one.</p> : null}
        {(error || cached || (active && !inWindow)) && !pending.length ? (
          <button type="button" onClick={() => void refresh(true)} disabled={syncing} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-border bg-card text-base font-medium text-primary disabled:opacity-50"><RefreshCw className={`size-4 ${syncing ? 'animate-spin' : ''}`} aria-hidden="true" />Refresh</button>
        ) : null}
        {active && checkpoints.length > 0 && verified === checkpoints.length ? (
          <div role="status" className="flex items-center gap-3 rounded-2xl bg-success-bg px-5 py-4 text-success-text">
            <CheckCircle2 className="size-7 shrink-0" aria-hidden="true" />
            <p className="font-semibold">All {checkpoints.length} locations verified. Nothing else to do; the patrol ends by itself.</p>
          </div>
        ) : active && checkpoints.length > 0 && !toVisit.length ? (
          <div role="status" className="flex items-center gap-3 rounded-2xl bg-warning-bg px-5 py-4 text-warning-text">
            <AlertTriangle className="size-7 shrink-0" aria-hidden="true" />
            <p className="font-semibold">Every location is scanned, but {[uploading ? `${uploading} still waiting to upload` : '', review ? `${review} awaiting supervisor review` : ''].filter(Boolean).join(' and ')}. Keep the app open.</p>
          </div>
        ) : null}

        {!checkpoints.length ? <p className="rounded-xl bg-muted px-4 py-3">Your manager needs to add the patrol locations.</p> : null}
        {next ? <NextStop row={next} /> : null}
        {active && toVisit.length ? (
          <Section title="To visit" count={toVisit.length} hint={toVisit.length > 1 ? 'Tap a location to make it your next stop.' : undefined}>
            <ul className="grid grid-cols-2 gap-3">
              {toVisit.map((row) => <li key={row.checkpoint.checkpoint_id}><LocationTile row={row} selected={row === next} onChoose={() => chooseNext(row.checkpoint.checkpoint_id)} /></li>)}
            </ul>
          </Section>
        ) : null}
        {!active && rows.length ? (
          <Section title="Tonight’s locations" count={rows.length}>
            <ul className="flex flex-wrap gap-2">{rows.map((row) => <li key={row.checkpoint.checkpoint_id} className="rounded-full border border-border bg-card px-3 py-2 text-sm font-medium">{row.checkpoint.checkpoint_name}</li>)}</ul>
          </Section>
        ) : null}
        {active && visited.length ? (
          <Section title="Visited" count={visited.length}>
            <ul className="flex flex-wrap gap-2">{visited.map((row) => <li key={row.checkpoint.checkpoint_id}><VisitedChip row={row} /></li>)}</ul>
          </Section>
        ) : null}

        {thisShift.length ? (
          <details className="rounded-xl border border-border bg-card px-4 py-3">
            <summary className="flex min-h-11 cursor-pointer items-center justify-between text-sm font-semibold text-primary">Scan history on this phone ({thisShift.length})<ChevronRight className="size-4" aria-hidden="true" /></summary>
            <ul className="divide-y divide-border">{thisShift.map((receipt) => {
              const feedback = scanFeedback(receipt);
              return <li key={receipt.id} className="py-3 text-sm"><div className="flex justify-between gap-3"><p className="font-medium">{receipt.checkpointName}</p><p className="tabular-nums">{formatTime(receipt.deviceTime)}</p></div><p className={feedback.tone === 'danger' ? 'font-semibold text-danger-text' : feedback.tone === 'success' ? 'text-success-text' : 'text-warning-text'}>{feedback.title}</p>{feedback.tone !== 'success' ? <p>{feedback.message}</p> : null}<p className="text-muted-foreground">{formatDateTime(receipt.deviceTime)}</p></li>;
            })}</ul>
          </details>
        ) : null}
        {footer}
      </main>

      {active ? (
        <div inert={overlay} className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
          <div className="mx-auto max-w-xl">
            <button ref={scanButton} type="button" onClick={openScanner} disabled={!canScan || scanning || shown?.kind === 'checking'} className="flex h-14 w-full items-center justify-center gap-3 rounded-2xl bg-primary text-lg font-semibold text-white shadow-card active:bg-primary-hover disabled:opacity-50">
              <ScanLine className="size-6" aria-hidden="true" />Scan location
            </button>
          </div>
        </div>
      ) : null}

      {scanning && active ? <PatrolScanner fullscreen onScan={(code, method) => void record(code, method)} onClose={() => setScanning(false)} /> : null}
      {shown ? <ScanConfirm state={shown} done={verified} total={checkpoints.length} canScan={canScan} busy={syncing}
        onClose={() => setConfirm(null)} onScan={openScanner} onRetryUpload={() => void refresh(true)} /> : null}
    </>
  );
}

type Row = { checkpoint: PatrolCheckpoint; status: Status };

function ProgressRing({ done, total }: { done: number; total: number }) {
  const r = 26;
  const length = 2 * Math.PI * r;
  return (
    <div className="relative size-16 shrink-0" role="progressbar" aria-label="Locations verified" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
      <svg viewBox="0 0 64 64" className="size-full -rotate-90" aria-hidden="true">
        <circle cx="32" cy="32" r={r} fill="none" strokeWidth="7" className="stroke-white/20" />
        <circle cx="32" cy="32" r={r} fill="none" strokeWidth="7" strokeLinecap="round" className="stroke-secondary transition-[stroke-dashoffset] duration-500"
          strokeDasharray={length} strokeDashoffset={length * (1 - (total ? done / total : 0))} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-base font-semibold text-white tabular-nums">{total ? Math.round((done / total) * 100) : 0}%</span>
    </div>
  );
}

function Section({ title, count, hint, children }: { title: string; count: number; hint?: string; children: ReactNode }) {
  return (
    <section>
      <div className="mb-3 px-1">
        <h2 className="flex items-center justify-between text-base">{title}<span className="rounded-full bg-muted px-3 py-1 text-sm font-semibold text-muted-foreground tabular-nums">{count}</span></h2>
        {hint ? <p className="mt-1 text-sm text-muted-foreground">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

function NextStop({ row: { checkpoint, status } }: { row: Row }) {
  return (
    <section aria-label="Next stop" className="rounded-3xl border border-border bg-card p-5 shadow-card">
      <p className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">Next stop</p>
      <h2 className="mt-1 text-2xl break-words">{checkpoint.checkpoint_name}</h2>
      {status === 'rejected'
        ? <p className="mt-1 text-sm font-semibold text-danger-text">Not counted last time · scan again at the location</p>
        : <p className="mt-1 text-sm text-muted-foreground">Go to this location and scan its QR label.</p>}
      <a className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-secondary-light text-base font-semibold text-primary active:bg-secondary" target="_blank" rel="noreferrer"
        href={`https://www.google.com/maps/dir/?api=1&destination=${checkpoint.latitude},${checkpoint.longitude}`}><Navigation className="size-5" aria-hidden="true" />Directions</a>
    </section>
  );
}

function LocationTile({ row: { checkpoint, status }, selected, onChoose }: { row: Row; selected: boolean; onChoose: () => void }) {
  const rejected = status === 'rejected';
  return (
    <button type="button" onClick={onChoose} aria-pressed={selected} aria-label={`${checkpoint.checkpoint_name}${rejected ? ', not counted, scan again' : ''}. ${selected ? 'Your next stop.' : 'Make this your next stop.'}`}
      className={`flex h-full min-h-24 w-full flex-col justify-between gap-2 rounded-2xl border p-3.5 text-left transition-colors ${selected ? 'border-primary bg-primary text-white shadow-card' : rejected ? 'border-danger bg-danger-bg' : 'border-border bg-card active:bg-muted'}`}>
      <span className="flex items-start justify-between gap-2">
        <span className="text-base leading-snug font-semibold break-words">{checkpoint.checkpoint_name}</span>
        {rejected && !selected ? <XCircle className="size-5 shrink-0 text-danger-text" aria-hidden="true" /> : <span aria-hidden="true" className={`mt-0.5 size-5 shrink-0 rounded-full border-2 ${selected ? 'border-white bg-white/20' : 'border-border'}`} />}
      </span>
      <span className={`text-sm ${selected ? 'font-semibold text-white' : rejected ? 'font-semibold text-danger-text' : 'text-muted-foreground'}`}>{selected ? 'Next stop' : rejected ? 'Scan again' : 'To visit'}</span>
    </button>
  );
}

const CHIP: Record<Exclude<Status, 'todo' | 'rejected'>, { style: string; icon: ReactNode; label: (checkpoint: PatrolCheckpoint) => string }> = {
  verified: { style: 'bg-success-bg text-success-text', icon: <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />, label: (c) => formatTime(c.scanned_at ?? '') },
  uploading: { style: 'bg-warning-bg text-warning-text', icon: <CloudUpload className="size-4 shrink-0" aria-hidden="true" />, label: () => 'uploading' },
  review: { style: 'bg-warning-bg text-warning-text', icon: <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />, label: () => 'in review' },
};

function VisitedChip({ row: { checkpoint, status } }: { row: Row }) {
  const chip = CHIP[status as keyof typeof CHIP];
  return (
    <span className={`inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium ${chip.style}`}>
      {chip.icon}{checkpoint.checkpoint_name}<span className="font-normal tabular-nums opacity-80">· {chip.label(checkpoint)}</span>
    </span>
  );
}

export default function GuardPatrolPage() {
  const { profile } = useAuth();
  if (!profile) return null;
  if (profile.role !== 'guard') return <Navigate to="/" replace />;
  return (
    <div className="min-h-full bg-background">
      <GuardTour key={profile.id} userId={profile.id} fullName={profile.full_name} footer={
        <footer className="space-y-4 pt-4">
          <InstallPatrol />
          <p className="text-sm text-muted-foreground">Allow camera and precise location when scanning. GPS is recorded only with each scan, never in the background. <Link className="underline" to="/privacy">Privacy</Link></p>
        </footer>
      } />
    </div>
  );
}
