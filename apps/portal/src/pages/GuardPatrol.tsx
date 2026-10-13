import { CheckCircle2, MapPin, RefreshCw, ScanLine } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, Navigate } from 'react-router';
import { InstallPatrol } from '@/components/InstallPatrol';
import { GuardShiftStart } from '@/components/GuardShiftStart';
import { PatrolScanner } from '@/components/PatrolScanner';
import { Button, ErrorNote, Spinner } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { friendlyError } from '@/lib/errors';
import { captureLocation } from '@/lib/guardPatrol';
import { readReceipts, saveReceipt } from '@/lib/guardOutbox';
import { formatDateTime, formatTime } from '@/lib/time';
import { useGuardPatrol } from '@/lib/useGuardPatrol';

function GuardTour({ userId, fullName }: { userId: string; fullName: string }) {
  const { signOut } = useAuth();
  const { snapshot, receipts, loading, syncing, cached, error, refresh } = useGuardPatrol(userId);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const scanInProgress = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const shift = snapshot?.shift;
  const checkpoints = snapshot?.checkpoints ?? [];
  const pending = receipts.filter((receipt) => receipt.state === 'pending');
  const complete = checkpoints.filter((checkpoint) => checkpoint.completed).length;
  const inWindow = shift && Date.now() >= Date.parse(shift.scheduled_start) && Date.now() <= Date.parse(shift.scheduled_end);

  async function record(code: string, method: 'qr' | 'barcode') {
    if (scanInProgress.current) return;
    scanInProgress.current = true;
    setScanning(false);
    setBusy(true);
    setActionError(null);
    setNotice('Label read. Capturing your GPS position…');
    const deviceTime = new Date().toISOString();
    try {
      if (!shift || shift.status !== 'active' || !inWindow) throw new Error('Scanning is only available during your active shift.');
      const checkpoint = checkpoints.find((item) => item.code === code);
      if (!checkpoint) throw new Error('This QR code is not one of this shift’s locations.');
      if (checkpoint.completed) { setNotice(`${checkpoint.checkpoint_name} is already verified for this shift.`); return; }
      if ((await readReceipts(userId)).some((item) => item.shiftId === shift.id && item.checkpointId === checkpoint.checkpoint_id && item.state === 'pending')) {
        setNotice('This location already has a pending scan. Tap Retry upload.'); return;
      }
      const position = await captureLocation();
      await saveReceipt({
        id: crypto.randomUUID(), userId, shiftId: shift.id, checkpointId: checkpoint.checkpoint_id,
        checkpointName: checkpoint.checkpoint_name, code, method, deviceTime,
        latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy, state: 'pending',
      });
      setNotice(`${checkpoint.checkpoint_name}: saved on this phone. Uploading for verification…`);
      await refresh();
      setNotice('Scan saved. Check the result below.');
    } catch (cause) { setNotice(null); setActionError(friendlyError(cause)); }
    finally { setBusy(false); scanInProgress.current = false; }
  }

  async function leave() {
    try {
      if ((await readReceipts(userId)).some((receipt) => receipt.state === 'pending')) throw new Error('Upload your pending scans before signing out.');
      await signOut();
    } catch (cause) { setActionError(friendlyError(cause)); }
  }

  if (loading) return <Spinner label="Loading your patrol…" />;
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium">{fullName}</p>
        <Button variant="ghost" disabled={busy || scanning} onClick={() => void leave()}>Sign out</Button>
      </div>
      <ErrorNote message={actionError ?? error} />
      {cached ? <p role="status" className="text-sm">Using the last saved patrol. Reconnect to check for changes.</p> : null}
      {notice ? <p role="status" className="rounded-md bg-secondary-light p-4 text-primary">{notice}</p> : null}
      {pending.length || error ? <Button variant="outline" icon={RefreshCw} loading={syncing} disabled={busy || scanning} onClick={() => void refresh()}>{pending.length ? 'Retry upload' : 'Try again'}</Button> : null}
      {pending.length ? <p className="text-sm">{pending.length} scan(s) are saved on this phone but not confirmed by Supabase. Keep this app open with internet access to upload. Do not clear this site's data.</p> : null}
      {shift?.status !== 'active' ? <GuardShiftStart key={shift?.id ?? 'new'} names={snapshot?.guardNames ?? []} startTime={snapshot?.startTime ?? null} endTime={snapshot?.endTime ?? null} disabled={!snapshot || cached || syncing || pending.length > 0 || checkpoints.length === 0} onStarted={async () => { await refresh(); setScanning(true); }} /> : (
        <section className="space-y-4 rounded-xl border border-border bg-card p-5">
          <h2 className="text-xl">Night patrol</h2>
          <p className="text-sm">{formatDateTime(shift.scheduled_start)} – {formatDateTime(shift.scheduled_end)} · Muscat time</p>
          <div className="rounded-lg bg-secondary-light p-4"><p className="text-2xl font-semibold text-primary">{complete}<span className="text-base font-normal"> / {checkpoints.length} locations</span></p><p className="mt-1 text-sm text-primary">{complete === checkpoints.length && checkpoints.length > 0 ? 'All locations verified for this shift' : 'Scan each location once to complete your round'}</p></div>
          <p className="text-sm">On duty: {shift.on_duty_name ?? fullName}</p>
          {!scanning ? <Button className="min-h-14 w-full text-base" icon={ScanLine} loading={busy} disabled={syncing || !inWindow || checkpoints.length === 0} onClick={() => { setActionError(null); setNotice(null); setScanning(true); }}>Scan location</Button> : null}
          {!inWindow ? <p className="text-sm">This shift has ended. Refresh to choose your next shift hours.</p> : null}
        </section>
      )}
          {scanning && shift?.status === 'active' ? <PatrolScanner onScan={(code, method) => void record(code, method)} onClose={() => setScanning(false)} /> : null}
          <section>
            <h2 className="mb-3 text-lg">Your locations</h2>
            {!checkpoints.length ? <p>Your manager needs to add the patrol locations.</p> : null}
            <ul className="divide-y divide-border">
              {checkpoints.map((checkpoint) => {
                const waiting = pending.some((receipt) => receipt.shiftId === shift?.id && receipt.checkpointId === checkpoint.checkpoint_id);
                const label = checkpoint.completed ? `Verified · ${formatTime(checkpoint.scanned_at ?? '')}` : waiting ? 'Pending upload'
                  : checkpoint.validation === 'flagged' ? 'Awaiting supervisor review' : checkpoint.validation === 'rejected' ? 'Rejected — scan again at the location' : shift?.status === 'active' ? 'Not yet visited' : 'Ready to scan when you start';
                return <li key={checkpoint.checkpoint_id} className="flex items-center gap-3 py-4">
                  {checkpoint.completed ? <CheckCircle2 className="size-5 shrink-0 text-primary" aria-hidden="true" /> : <MapPin className="size-5 shrink-0 text-primary" aria-hidden="true" />}
                  <div className="min-w-0 flex-1"><p className="font-medium">{checkpoint.sequence}. {checkpoint.checkpoint_name}</p><p className="text-sm text-muted-foreground">{label}</p></div>
                  <a className="shrink-0 py-3 text-sm text-primary underline" aria-label={`Directions to ${checkpoint.checkpoint_name}`} target="_blank" rel="noreferrer" href={`https://www.google.com/maps/dir/?api=1&destination=${checkpoint.latitude},${checkpoint.longitude}`}>Directions</a>
                </li>;
              })}
            </ul>
          </section>
      {receipts.length ? <details className="border-t border-border pt-4"><summary className="cursor-pointer font-semibold">Recent scans on this phone</summary><ul className="mt-3 divide-y divide-border">{receipts.slice(0, 20).map((receipt) => <li key={receipt.id} className="space-y-1 py-3 text-sm"><p className="font-medium">{receipt.checkpointName}</p><p>{formatDateTime(receipt.deviceTime)} · {receipt.state === 'pending' ? 'Pending upload' : receipt.validation === 'valid' ? 'Verified' : receipt.validation === 'flagged' ? 'Awaiting review' : 'Rejected'}</p>{receipt.error ? <p>{receipt.error}</p> : null}{receipt.flags?.length ? <p>Checks: {receipt.flags.map((flag) => flag.replaceAll('_', ' ')).join(', ')}</p> : null}</li>)}</ul></details> : null}
    </div>
  );
}

export default function GuardPatrolPage() {
  const { profile } = useAuth();
  if (!profile) return null;
  if (profile.role !== 'guard') return <Navigate to="/" replace />;
  return (
    <div className="min-h-full bg-background">
      <header className="bg-primary px-5 py-5 text-white"><div className="mx-auto flex max-w-xl items-center gap-3"><img src="/apple-touch-icon.png" alt="Muscat Bay" className="size-11 rounded-md" /><div><p className="font-semibold">MB Patrol</p><h1 className="text-lg text-white">Guard scanning</h1></div></div></header>
      <main className="mx-auto max-w-xl space-y-6 px-4 py-6 pb-12">
        <GuardTour key={profile.id} userId={profile.id} fullName={profile.full_name} />
        <InstallPatrol />
        <p className="text-sm text-muted-foreground">Allow camera and precise location access when scanning. GPS is recorded with each scan; this web section does not track guards in the background. <Link className="underline" to="/privacy">Privacy</Link></p>
      </main>
    </div>
  );
}
