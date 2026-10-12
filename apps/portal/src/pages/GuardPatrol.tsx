import { CheckCircle2, MapPin, RefreshCw, ScanLine } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { InstallPatrol } from '@/components/InstallPatrol';
import { PatrolScanner } from '@/components/PatrolScanner';
import { Button, ErrorNote, Field, Input, Spinner } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { friendlyError } from '@/lib/errors';
import { captureLocation } from '@/lib/guardPatrol';
import { readReceipts, saveReceipt } from '@/lib/guardOutbox';
import { supabase } from '@/lib/supabase';
import { formatDateTime, formatTime } from '@/lib/time';
import { useGuardPatrol } from '@/lib/useGuardPatrol';

function GuardTour({ userId, fullName }: { userId: string; fullName: string }) {
  const { signOut } = useAuth();
  const { snapshot, receipts, loading, syncing, cached, error, refresh } = useGuardPatrol(userId);
  const [name, setName] = useState(fullName);
  const [reference, setReference] = useState('');
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

  async function changeShift(action: 'start' | 'end') {
    if (!shift) return;
    setActionError(null);
    if (action === 'start' && name.trim().length < 3) return setActionError('Enter your full name.');
    if (action === 'end' && !window.confirm(`Finish this patrol? ${checkpoints.length - complete} location(s) are not verified. You cannot restart this shift.`)) return;
    setBusy(true);
    try {
      if (action === 'end') {
        await refresh();
        if ((await readReceipts(userId)).some((receipt) => receipt.state === 'pending')) {
          throw new Error('Upload all pending scans before finishing. Reconnect and tap Upload / refresh.');
        }
      }
      const { error: rpcError } = action === 'start'
        ? await supabase.rpc('start_shift_as', { p_shift_id: shift.id, p_on_duty_name: name.trim(), p_on_duty_ref: reference.trim() || null })
        : await supabase.rpc('end_shift', { p_shift_id: shift.id });
      if (rpcError) throw rpcError;
      setNotice(action === 'start' ? 'Patrol started. Visit each location and scan its label.' : 'Patrol finished. Your records remain available in Reports.');
      await refresh();
    } catch (cause) { setActionError(friendlyError(cause)); }
    finally { setBusy(false); }
  }

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
      if (!checkpoint) throw new Error('This label is not on your assigned patrol. Check the location with your supervisor.');
      if (checkpoint.completed) { setNotice(`${checkpoint.checkpoint_name} is already verified for this shift.`); return; }
      if ((await readReceipts(userId)).some((item) => item.shiftId === shift.id && item.checkpointId === checkpoint.checkpoint_id && item.state === 'pending')) {
        setNotice('This location already has a pending scan. Tap Upload / refresh.'); return;
      }
      const position = await captureLocation();
      await saveReceipt({
        id: crypto.randomUUID(), userId, shiftId: shift.id, checkpointId: checkpoint.checkpoint_id,
        checkpointName: checkpoint.checkpoint_name, code, method, deviceTime,
        latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy, state: 'pending',
      });
      setNotice(`${checkpoint.checkpoint_name}: saved on this phone. Uploading for verification…`);
      await refresh();
      setNotice('Scan saved. Check its verification or pending status below.');
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
      {cached ? <p role="status" className="text-sm">Using the last saved patrol. Reconnect to check for assignment changes.</p> : null}
      {notice ? <p role="status" className="rounded-md bg-secondary-light p-4 text-primary">{notice}</p> : null}
      <Button variant="outline" icon={RefreshCw} loading={syncing} disabled={busy || scanning} onClick={() => void refresh()}>Upload / refresh{pending.length ? ` (${pending.length} pending)` : ''}</Button>
      {pending.length ? <p className="text-sm">{pending.length} scan(s) are saved on this phone but not confirmed by Supabase. Keep this app open with internet access to upload. Do not clear this site's data.</p> : null}
      {!shift ? <div className="space-y-2 border-y border-border py-6"><h2 className="text-lg">No shift assigned</h2><p>Your supervisor must assign you a route and shift before you can scan.</p></div> : (
        <>
          <section className="space-y-3 border-y border-border py-5">
            <h2 className="text-xl">{shift.routes?.name ?? 'Your patrol'}</h2>
            <p className="text-sm">{formatDateTime(shift.scheduled_start)} – {formatDateTime(shift.scheduled_end)} · Muscat time</p>
            <p className="font-semibold">{complete} / {checkpoints.length} locations verified</p>
            {shift.status === 'scheduled' ? (
              <div className="space-y-3">
                <Field label="Guard on duty"><Input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} autoComplete="name" /></Field>
                <Field label="Employee number (optional)"><Input value={reference} onChange={(event) => setReference(event.target.value)} maxLength={50} /></Field>
                <Button className="min-h-12 w-full" loading={busy} disabled={syncing} onClick={() => void changeShift('start')}>Start patrol</Button>
              </div>
            ) : (
              <>
                <p className="text-sm">On duty: {shift.on_duty_name ?? fullName}</p>
                {!scanning ? <Button className="min-h-14 w-full text-base" icon={ScanLine} loading={busy} disabled={syncing || !inWindow || checkpoints.length === 0} onClick={() => { setActionError(null); setNotice(null); setScanning(true); }}>Scan location</Button> : null}
                {!inWindow ? <p className="text-sm">Scanning is available between the scheduled start and end times.</p> : null}
              </>
            )}
          </section>
          {scanning ? <PatrolScanner onScan={(code, method) => void record(code, method)} onClose={() => setScanning(false)} /> : null}
          <section>
            <h2 className="mb-3 text-lg">Required locations · once this shift</h2>
            {!checkpoints.length ? <p>Your supervisor needs to add locations to the route before creating a replacement shift.</p> : null}
            <ul className="divide-y divide-border">
              {checkpoints.map((checkpoint) => {
                const waiting = pending.some((receipt) => receipt.shiftId === shift.id && receipt.checkpointId === checkpoint.checkpoint_id);
                const label = checkpoint.completed ? `Verified · ${formatTime(checkpoint.scanned_at ?? '')}` : waiting ? 'Pending upload'
                  : checkpoint.validation === 'flagged' ? 'Awaiting supervisor review' : checkpoint.validation === 'rejected' ? 'Rejected — scan again at the location' : 'Not yet visited';
                return <li key={checkpoint.checkpoint_id} className="flex items-center gap-3 py-4">
                  {checkpoint.completed ? <CheckCircle2 className="size-5 shrink-0 text-primary" aria-hidden="true" /> : <MapPin className="size-5 shrink-0 text-primary" aria-hidden="true" />}
                  <div className="min-w-0 flex-1"><p className="font-medium">{checkpoint.sequence}. {checkpoint.checkpoint_name}</p><p className="text-sm text-muted-foreground">{label}</p></div>
                  <a className="shrink-0 py-3 text-sm text-primary underline" aria-label={`Directions to ${checkpoint.checkpoint_name}`} target="_blank" rel="noreferrer" href={`https://www.google.com/maps/dir/?api=1&destination=${checkpoint.latitude},${checkpoint.longitude}`}>Directions</a>
                </li>;
              })}
            </ul>
          </section>
          {shift.status === 'active' ? <Button variant="outline" className="min-h-11 w-full" disabled={busy || scanning || syncing || pending.length > 0} onClick={() => void changeShift('end')}>Finish patrol</Button> : null}
        </>
      )}
      {receipts.length ? <details className="border-t border-border pt-4"><summary className="cursor-pointer font-semibold">Recent scans on this phone</summary><ul className="mt-3 divide-y divide-border">{receipts.slice(0, 20).map((receipt) => <li key={receipt.id} className="space-y-1 py-3 text-sm"><p className="font-medium">{receipt.checkpointName}</p><p>{formatDateTime(receipt.deviceTime)} · {receipt.state === 'pending' ? 'Pending upload' : receipt.validation === 'valid' ? 'Verified' : receipt.validation === 'flagged' ? 'Awaiting review' : 'Rejected'}</p>{receipt.error ? <p>{receipt.error}</p> : null}{receipt.flags?.length ? <p>Checks: {receipt.flags.map((flag) => flag.replaceAll('_', ' ')).join(', ')}</p> : null}</li>)}</ul></details> : null}
    </div>
  );
}

export default function GuardPatrolPage() {
  const { profile, signOut } = useAuth();
  if (!profile) return null;
  return (
    <div className="min-h-full bg-background">
      <header className="bg-primary px-5 py-5 text-white"><div className="mx-auto flex max-w-xl items-center gap-3"><img src="/apple-touch-icon.png" alt="Muscat Bay" className="size-11 rounded-md" /><div><p className="font-semibold">MB Patrol</p><h1 className="text-lg text-white">Guard scanning</h1></div></div></header>
      <main className="mx-auto max-w-xl space-y-6 px-4 py-6 pb-12">
        {profile.role === 'guard' ? <GuardTour key={profile.id} userId={profile.id} fullName={profile.full_name} /> : (
          <section className="space-y-4">
            <Link to="/shifts" className="text-sm text-primary underline">Back to supervisor portal</Link>
            <h2 className="text-xl">Prepare your first phone patrol</h2>
            <p>Guards use this section of the same website. Share this address: <strong className="break-all">{window.location.origin}/guard</strong></p>
            <ol className="list-decimal space-y-3 pl-5">
              <li><Link className="text-primary underline" to="/checkpoints">Register the real checkpoint positions and print their QR labels.</Link> Fix each label at its matching location.</li>
              <li><Link className="text-primary underline" to="/routes">Create a route containing the required locations.</Link></li>
              <li><Link className="text-primary underline" to="/guards">Create a guard account</Link>, then <Link className="text-primary underline" to="/shifts">assign its route and shift</Link>.</li>
              <li>On the guard's phone, install this website using the steps below and sign in with the guard account.</li>
            </ol>
            <p className="text-sm">You are signed in as a supervisor. Visits must be recorded using the assigned guard account.</p>
            <Button onClick={() => void signOut()}>Sign out to use a guard account</Button>
          </section>
        )}
        <InstallPatrol />
        <p className="text-sm text-muted-foreground">Allow camera and precise location access when scanning. GPS is recorded with each scan; this web section does not track guards in the background. <Link className="underline" to="/privacy">Privacy</Link></p>
      </main>
    </div>
  );
}
