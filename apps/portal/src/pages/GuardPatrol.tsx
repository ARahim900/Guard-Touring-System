// =============================================================================
// Guard patrol screen (phone): one job, scan every location once.
// =============================================================================
// Layout, top to bottom: a header with a progress ring, the locations still to
// visit as tiles (tap one at the location to open the camera for it, so the
// guard chooses the order), separate saved, review and verified panels that each location moves
// to once scanned, and a Scan button fixed at the bottom within thumb reach.
// The QR label decides which location is recorded, whichever tile was tapped.
// Every scan ends in a full-screen pop-up that says plainly whether the visit
// counted.
// =============================================================================
import { AlertTriangle, CheckCircle2, ChevronRight, CloudUpload, FileText, LayoutDashboard, LogOut, Navigation, RefreshCw, ScanLine } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate } from 'react-router';
import { GuardNavigation } from '@/components/GuardNavigation';
import { BrandMark } from '@/components/BrandMark';
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
  // false = camera closed; null = opened from the Scan button; a name = opened from that location's tile.
  const [scanning, setScanning] = useState<false | null | string>(false);
  // The location scanned last: its chip glows green in Verified once the pop-up closes.
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  // Every location verified: the guard may open the start card for another round.
  const [newRound, setNewRound] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
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
  const savedRows = visited.filter((row) => row.status === 'uploading');
  const reviewRows = visited.filter((row) => row.status === 'review');
  const verifiedRows = visited.filter((row) => row.status === 'verified');
  const verified = rows.filter((row) => row.status === 'verified').length;
  const uploading = rows.filter((row) => row.status === 'uploading').length;
  const review = rows.filter((row) => row.status === 'review').length;

  // The pop-up follows the saved receipt, so it turns green the moment the upload is confirmed.
  const shown: ConfirmState | null = confirm?.kind === 'receipt'
    ? { kind: 'receipt', receipt: receipts.find((item) => item.id === confirm.receipt.id) ?? confirm.receipt } : confirm;

  // While the camera or a pop-up is open, the page behind it cannot be reached; afterwards focus returns to Scan.
  const overlay = scanning !== false || shown !== null;
  const scanButton = useRef<HTMLButtonElement>(null);
  const wasOverlay = useRef(false);
  useEffect(() => {
    if (wasOverlay.current && !overlay) scanButton.current?.focus();
    wasOverlay.current = overlay;
  }, [overlay]);
  const thisShift = receipts.filter((receipt) => !shift || receipt.shiftId === shift.id);

  function openScanner(target: string | null = null) {
    setActionError(null); setConfirm(null); setScanning(target);
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
      setLastScanned(checkpoint.checkpoint_id);
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

  if (loading) return <><Spinner label="Loading your patrol…" /><GuardNavigation /></>;
  return (
    <>
      <header inert={overlay} className="sticky top-0 z-30 bg-primary px-4 pt-[calc(12px+env(safe-area-inset-top))] pb-4 text-white shadow-card">
        <div className="mx-auto max-w-xl">
          <div className="flex items-center gap-3">
            <BrandMark className="size-9 shrink-0" />
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-lg text-white">{active ? 'Patrol' : 'MB Security'}</h1>

            </div>
            <Link to="/" aria-label="Dashboard" className="flex size-11 items-center justify-center rounded-full text-white/90 hover:bg-white/10"><LayoutDashboard className="size-5" aria-hidden="true" /></Link>
            <Link to="/reports" aria-label="Daily reports" className="flex size-11 items-center justify-center rounded-full text-white/90 hover:bg-white/10"><FileText className="size-5" aria-hidden="true" /></Link>
            <button type="button" onClick={() => void leave()} disabled={overlay || syncing} aria-label="Sign out" className="flex size-11 items-center justify-center rounded-full text-white/90 hover:bg-white/10 disabled:opacity-50"><LogOut className="size-5" aria-hidden="true" /></button>
          </div>
          <p className="mt-2 break-words text-sm text-white">{active ? shift.on_duty_name ?? fullName : fullName}</p>
          {active ? <p className="mt-1 text-sm text-white/90">Ends automatically: {formatDateTime(shift.scheduled_end)} · Muscat</p> : null}
          {active && checkpoints.length ? (
            <div className="mt-4 flex items-center gap-4 rounded-2xl bg-white/10 px-4 py-3">
              <ProgressRing done={verified} total={checkpoints.length} />
              <div className="min-w-0">
                <p className="text-lg font-semibold text-white">{verified} of {checkpoints.length} verified</p>
                <p className="text-sm text-white/80">{[toVisit.length ? `${toVisit.length} to go` : 'All scanned', uploading ? `${uploading} saved on phone` : '', review ? `${review} awaiting review` : ''].filter(Boolean).join(' · ')}</p>
              </div>
            </div>
          ) : null}
        </div>
      </header>

      <main inert={overlay} className={`mx-auto max-w-xl space-y-5 px-4 pt-4 ${active ? 'pb-[calc(13rem+env(safe-area-inset-bottom))] lg:pb-36' : 'pb-28 lg:pb-10'}`}>
        <ErrorNote message={actionError ?? error} />
        {cached ? <p role="status" className="rounded-xl bg-muted px-4 py-3 text-sm">Showing the patrol saved on this phone. It could not be updated just now.</p> : null}
        {pending.length ? (
          <div role="status" className="flex items-center gap-3 rounded-xl border border-warning bg-warning-bg px-4 py-3 text-warning-text">
            <CloudUpload className="size-5 shrink-0" aria-hidden="true" />
            <p className="flex-1 text-sm font-medium">{pending.length} scan{pending.length === 1 ? '' : 's'} saved on this phone, waiting to upload. Keep the app open.</p>
            <button type="button" onClick={() => void refresh(true)} disabled={syncing} className="flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-semibold underline disabled:opacity-50"><RefreshCw className={`size-4 ${syncing ? 'animate-spin' : ''}`} aria-hidden="true" />Retry</button>
          </div>
        ) : null}

        {!active ? <GuardShiftStart key={shift?.id ?? 'new'} names={snapshot?.guardNames ?? []} disabled={!snapshot || cached || syncing || pending.length > 0 || checkpoints.length === 0} onStarted={async () => { await refresh(true); setScanning(null); }} /> : null}
        {active && !inWindow ? <p role="status" className="rounded-xl bg-muted px-4 py-3 text-sm">This patrol has ended. Tap Refresh to load the next one.</p> : null}
        {(error || cached || (active && !inWindow)) && !pending.length ? (
          <button type="button" onClick={() => void refresh(true)} disabled={syncing} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-border bg-card text-base font-medium text-primary disabled:opacity-50"><RefreshCw className={`size-4 ${syncing ? 'animate-spin' : ''}`} aria-hidden="true" />Refresh</button>
        ) : null}
        {active && checkpoints.length > 0 && verified === checkpoints.length ? (
          <>
            <div role="status" className="rounded-2xl bg-success-bg px-5 py-4 text-success-text">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="size-7 shrink-0" aria-hidden="true" />
                <p className="font-semibold">All {checkpoints.length} locations verified. This round is complete.</p>
              </div>
              {!newRound ? <button type="button" onClick={() => setNewRound(true)} className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-success-text text-base font-semibold text-white"><RefreshCw className="size-5" aria-hidden="true" />Start a new round</button> : null}
            </div>
            {newRound ? <GuardShiftStart key="new-round" title="Start a new round" names={snapshot?.guardNames ?? []} disabled={!snapshot || cached || syncing || pending.length > 0} onStarted={async () => { setNewRound(false); await refresh(true); setScanning(null); }} /> : null}
          </>
        ) : active && checkpoints.length > 0 && !toVisit.length ? (
          <div role="status" className="flex items-center gap-3 rounded-2xl bg-warning-bg px-5 py-4 text-warning-text">
            <AlertTriangle className="size-7 shrink-0" aria-hidden="true" />
            <p className="font-semibold">Every location is scanned, but {[uploading ? `${uploading} still waiting to upload` : '', review ? `${review} awaiting supervisor review` : ''].filter(Boolean).join(' and ')}. Keep the app open.</p>
          </div>
        ) : null}

        {!checkpoints.length ? <p className="rounded-xl bg-muted px-4 py-3">Your manager needs to add the patrol locations.</p> : null}
        {active && toVisit.length ? (
          <Section title="To visit" count={toVisit.length} hint="At a location, tap it to scan its QR label. Only verified visits count towards your progress.">
            <ul className="grid grid-cols-2 gap-3">
              {toVisit.map((row) => <li key={row.checkpoint.checkpoint_id}><LocationTile row={row} disabled={!canScan || scanning !== false || shown?.kind === 'checking'} onScan={() => openScanner(row.checkpoint.checkpoint_name)} /></li>)}
            </ul>
          </Section>
        ) : null}
        {!active && rows.length ? (
          <Section title="Tonight’s locations" count={rows.length}>
            <ul className="flex flex-wrap gap-2">{rows.map((row) => <li key={row.checkpoint.checkpoint_id} className="rounded-full border border-border bg-card px-3 py-2 text-sm font-medium">{row.checkpoint.checkpoint_name}</li>)}</ul>
          </Section>
        ) : null}
        {active && savedRows.length ? <VisitGroup title="Saved on this phone" rows={savedRows} tone="info" hint="Waiting for a connection and server confirmation. Keep the app open; these visits are not verified yet." /> : null}
        {active && reviewRows.length ? <VisitGroup title="Awaiting review" rows={reviewRows} tone="warning" hint="Uploaded, but not yet verified. Your supervisor needs to review these visits." /> : null}
        {active && verifiedRows.length ? <VisitGroup title="Verified" rows={verifiedRows} tone="success" hint="These visits count towards your patrol progress." freshId={!overlay ? lastScanned : null} /> : null}

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
        <div inert={overlay} className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 border-t border-border bg-card px-4 py-3 lg:bottom-0 lg:pb-[calc(12px+env(safe-area-inset-bottom))]">
          <div className="mx-auto max-w-xl">
            <button ref={scanButton} type="button" onClick={() => openScanner()} disabled={!canScan || scanning !== false || shown?.kind === 'checking'} className="flex h-14 w-full items-center justify-center gap-3 rounded-2xl bg-primary text-lg font-semibold text-white shadow-card active:bg-primary-hover disabled:opacity-50">
              <ScanLine className="size-6" aria-hidden="true" />Scan location
            </button>
          </div>
        </div>
      ) : null}

      <GuardNavigation inert={overlay} />
      {scanning !== false && active ? <PatrolScanner fullscreen target={scanning ?? undefined} onScan={(code, method) => void record(code, method)} onClose={() => setScanning(false)} /> : null}
      {shown ? <ScanConfirm state={shown} done={verified} total={checkpoints.length} canScan={canScan} busy={syncing}
        onClose={() => setConfirm(null)} onScan={() => openScanner()} onRetryUpload={() => void refresh(true)} /> : null}
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

function LocationTile({ row: { checkpoint, status }, disabled, onScan }: { row: Row; disabled: boolean; onScan: () => void }) {
  const rejected = status === 'rejected';
  return (
    <div className="relative h-full">
      <button type="button" onClick={onScan} disabled={disabled} aria-label={`Scan ${checkpoint.checkpoint_name}${rejected ? ', not counted last time' : ''}`}
        className={`flex h-full min-h-28 w-full flex-col justify-between gap-3 rounded-2xl border p-3.5 pr-12 text-left shadow-sm transition active:scale-[0.98] disabled:opacity-60 ${rejected ? 'border-danger bg-danger-bg' : 'border-border bg-card active:bg-muted'}`}>
        <span className="text-base leading-snug font-semibold break-words">{checkpoint.checkpoint_name}</span>
        <span className={`inline-flex items-center gap-1.5 text-sm font-semibold ${rejected ? 'text-danger-text' : 'text-primary'}`}>
          <ScanLine className="size-4" aria-hidden="true" />{rejected ? 'Scan again' : 'Tap to scan'}
        </span>
      </button>
      <a className="absolute top-1.5 right-1.5 flex size-11 items-center justify-center rounded-full text-primary active:bg-muted" aria-label={`Directions to ${checkpoint.checkpoint_name}`} target="_blank" rel="noreferrer"
        href={`https://www.google.com/maps/dir/?api=1&destination=${checkpoint.latitude},${checkpoint.longitude}`}><Navigation className="size-5" aria-hidden="true" /></a>
    </div>
  );
}

const CHIP: Record<Exclude<Status, 'todo' | 'rejected'>, { style: string; icon: ReactNode; label: (checkpoint: PatrolCheckpoint) => string }> = {
  verified: { style: 'bg-card text-success-text', icon: <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />, label: (c) => formatTime(c.scanned_at ?? '') },
  uploading: { style: 'bg-card text-info-text', icon: <CloudUpload className="size-4 shrink-0" aria-hidden="true" />, label: () => 'waiting to upload' },
  review: { style: 'bg-card text-warning-text', icon: <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />, label: () => 'in review' },
};

function VisitGroup({ title, rows, tone, hint, freshId }: { title: string; rows: Row[]; tone: 'success' | 'warning' | 'info'; hint: string; freshId?: string | null }) {
  const styles = { success: 'border-success bg-success-bg text-success-text', warning: 'border-warning bg-warning-bg text-warning-text', info: 'border-info bg-info-bg text-info-text' };
  const Icon = tone === 'success' ? CheckCircle2 : tone === 'warning' ? AlertTriangle : CloudUpload;
  return <section aria-label={title} className={`rounded-2xl border p-4 ${styles[tone]}`}>
    <h2 className="mb-2 flex items-center gap-2 text-base text-inherit"><Icon className="size-5 shrink-0" aria-hidden="true" />{title}<span className="ml-auto rounded-full bg-card px-3 py-1 text-sm font-semibold tabular-nums">{rows.length}</span></h2>
    <p className="mb-3 text-sm">{hint}</p>
    <ul className="flex flex-wrap gap-2">{rows.map((row) => <li className="min-w-0 max-w-full" key={row.checkpoint.checkpoint_id}><VisitedChip row={row} fresh={tone === 'success' && row.checkpoint.checkpoint_id === freshId} /></li>)}</ul>
  </section>;
}

function VisitedChip({ row: { checkpoint, status }, fresh }: { row: Row; fresh: boolean }) {
  const chip = CHIP[status as keyof typeof CHIP];
  return (
    <span className={`inline-flex min-h-10 max-w-full flex-wrap items-center gap-1.5 break-words rounded-xl px-3 py-1.5 text-sm font-medium ${chip.style} ${fresh ? 'mb-arrive' : ''}`}>
      {chip.icon}{checkpoint.checkpoint_name}<span className="font-normal tabular-nums">· {chip.label(checkpoint)}</span>
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
