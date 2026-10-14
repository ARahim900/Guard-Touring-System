// =============================================================================
// Guard patrol screen (phone): one job, scan every location once.
// =============================================================================
// Layout, top to bottom: a slim header with the patrol's progress, the list of
// locations split into "To visit" and "Visited", and a Scan button fixed at the
// bottom of the screen within thumb reach. Every scan ends in a full-screen
// pop-up that says plainly whether the visit counted.
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
        setConfirm({ kind: 'notice', tone: 'danger', title: 'Not one of tonight’s locations', message: 'This QR code is not on your patrol. Scan the MB Patrol label fixed at the location.' });
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
            <img src="/apple-touch-icon.png" alt="" className="size-10 rounded-lg" />
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-lg text-white">{active ? 'Night patrol' : 'MB Patrol'}</h1>
              <p className="truncate text-sm text-white/80">{active ? `${shift.on_duty_name ?? fullName} · ends by itself ${formatTime(shift.scheduled_end)}` : fullName}</p>
            </div>
            <button type="button" onClick={() => void leave()} disabled={overlay || syncing} aria-label="Sign out" className="flex size-11 items-center justify-center rounded-full text-white/90 hover:bg-white/10 disabled:opacity-50"><LogOut className="size-5" aria-hidden="true" /></button>
          </div>
          {active && checkpoints.length ? (
            <div className="mt-4">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-base font-semibold text-white"><span className="text-2xl tabular-nums">{verified}</span> of {checkpoints.length} verified</p>
                {uploading || review ? <p className="text-sm text-white/80">{[uploading ? `${uploading} uploading` : '', review ? `${review} in review` : ''].filter(Boolean).join(' · ')}</p> : null}
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/20" role="progressbar" aria-label="Locations verified" aria-valuemin={0} aria-valuemax={checkpoints.length} aria-valuenow={verified}>
                <div className="h-full rounded-full bg-secondary transition-[width] duration-500" style={{ width: `${(verified / checkpoints.length) * 100}%` }} />
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
        {toVisit.length ? <LocationGroup title={active ? 'To visit' : 'Tonight’s locations'} rows={toVisit} active={active} /> : null}
        {visited.length ? <LocationGroup title="Visited" rows={visited} active={active} /> : null}

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

const ROW: Record<Status, { label: (checkpoint: PatrolCheckpoint, active: boolean) => string; text: string }> = {
  verified: { label: (c) => `Verified · ${formatTime(c.scanned_at ?? '')}`, text: 'text-success-text' },
  uploading: { label: () => 'Saved on phone · waiting to upload', text: 'font-medium text-warning-text' },
  review: { label: () => 'Recorded · awaiting supervisor review', text: 'font-medium text-warning-text' },
  rejected: { label: () => 'Not counted · scan again at the location', text: 'font-semibold text-danger-text' },
  todo: { label: (_c, active) => active ? 'Not yet visited' : 'Ready when you start', text: 'text-muted-foreground' },
};

function StatusIcon({ status }: { status: Status }) {
  if (status === 'verified') return <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-success-text text-white"><CheckCircle2 className="size-6" aria-hidden="true" /></span>;
  if (status === 'uploading') return <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-warning-bg text-warning-text"><CloudUpload className="size-5" aria-hidden="true" /></span>;
  if (status === 'review') return <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-warning-bg text-warning-text"><AlertTriangle className="size-5" aria-hidden="true" /></span>;
  if (status === 'rejected') return <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-danger-bg text-danger-text"><XCircle className="size-6" aria-hidden="true" /></span>;
  return <span aria-hidden="true" className="size-10 shrink-0 rounded-full border-2 border-border bg-card" />;
}

function LocationGroup({ title, rows, active }: { title: string; rows: { checkpoint: PatrolCheckpoint; status: Status }[]; active: boolean }) {
  return (
    <section>
      <h2 className="mb-2 flex items-center justify-between px-1 text-base">{title}<span className="rounded-full bg-muted px-3 py-1 text-sm font-semibold text-muted-foreground tabular-nums">{rows.length}</span></h2>
      <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
        {rows.map(({ checkpoint, status }) => (
          <li key={checkpoint.checkpoint_id} className={`flex items-center gap-3 px-4 py-3 ${status === 'verified' ? 'bg-success-bg/40' : ''}`}>
            <StatusIcon status={status} />
            <div className="min-w-0 flex-1">
              <p className="text-base font-medium break-words">{checkpoint.checkpoint_name}</p>
              <p className={`text-sm ${ROW[status].text}`}>{ROW[status].label(checkpoint, active)}</p>
            </div>
            {status === 'todo' || status === 'rejected' ? (
              <a className="flex size-11 shrink-0 items-center justify-center rounded-full text-primary hover:bg-muted" aria-label={`Directions to ${checkpoint.checkpoint_name}`} target="_blank" rel="noreferrer"
                href={`https://www.google.com/maps/dir/?api=1&destination=${checkpoint.latitude},${checkpoint.longitude}`}><Navigation className="size-5" aria-hidden="true" /></a>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
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
