// =============================================================================
// Scan confirmation pop-up: the one clear answer after every scan.
// =============================================================================
// Shown over the whole screen as soon as a label is read, so the guard never
// has to look for the result. Green only for a visit the server verified;
// amber for saved-but-not-uploaded or "needs review"; red for "not counted".
// =============================================================================
import { AlertTriangle, CheckCircle2, CloudUpload, Info, Loader2, ScanLine, XCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { PatrolReceipt } from '@/lib/guardOutbox';
import { scanFeedback } from '@/lib/scanFeedback';
import { formatTime } from '@/lib/time';

export type ConfirmState =
  | { kind: 'checking'; message: string; name?: string }
  | { kind: 'receipt'; receipt: PatrolReceipt }
  | { kind: 'notice'; tone: 'info' | 'danger'; title: string; message: string; name?: string };

type Tone = 'success' | 'pending' | 'warning' | 'danger' | 'info' | 'checking';

const STYLE: Record<Tone, { ring: string; icon: string }> = {
  success: { ring: 'bg-success-text', icon: 'text-white' },
  pending: { ring: 'bg-warning-bg', icon: 'text-warning-text' },
  warning: { ring: 'bg-warning-bg', icon: 'text-warning-text' },
  danger: { ring: 'bg-danger-bg', icon: 'text-danger-text' },
  info: { ring: 'bg-secondary-light', icon: 'text-primary' },
  checking: { ring: 'bg-secondary-light', icon: 'text-primary' },
};
const TITLE: Record<Tone, string> = { success: 'text-success-text', pending: 'text-warning-text', warning: 'text-warning-text', danger: 'text-danger-text', info: 'text-primary', checking: 'text-primary' };
const ICON = { success: CheckCircle2, pending: CloudUpload, warning: AlertTriangle, danger: XCircle, info: Info, checking: Loader2 };

export function ScanConfirm({ state, done, total, canScan, busy, onClose, onScan, onRetryUpload }: {
  state: ConfirmState; done: number; total: number; canScan: boolean; busy: boolean;
  onClose: () => void; onScan: () => void; onRetryUpload: () => void;
}) {
  const primary = useRef<HTMLButtonElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const [held, setHeld] = useState(false);
  const view = describe(state);
  const Icon = ICON[view.tone];

  useEffect(() => { setHeld(false); }, [view.key]);
  // A verified visit closes by itself after 4 seconds, unless the guard touches the pop-up.
  useEffect(() => {
    if (view.tone !== 'success' || held) return;
    const timer = window.setTimeout(() => close.current(), 4000);
    return () => window.clearTimeout(timer);
  }, [view.tone, view.key, held]);

  useEffect(() => {
    if (view.tone === 'checking') return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close.current(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view.tone]);

  useEffect(() => {
    if (view.tone === 'checking') return;
    primary.current?.focus();
    // A short buzz for a verified visit, a double buzz for anything else (Android; iPhone ignores it).
    try { navigator.vibrate?.(view.tone === 'success' ? 120 : [90, 70, 90]); } catch { /* not supported */ }
  }, [view.tone, view.key]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center sm:p-4">
      <div onPointerDown={() => setHeld(true)} onKeyDown={() => setHeld(true)} role={view.tone === 'danger' || view.tone === 'warning' ? 'alertdialog' : 'dialog'} aria-modal="true" aria-labelledby="scan-confirm-title" aria-describedby="scan-confirm-message"
        className="mb-pop w-full max-w-md rounded-t-3xl bg-card px-6 pt-8 pb-[calc(24px+env(safe-area-inset-bottom))] text-center shadow-card sm:rounded-3xl sm:pb-6">
        <div className={`mx-auto flex size-24 items-center justify-center rounded-full ${STYLE[view.tone].ring}`}>
          <Icon className={`size-14 ${STYLE[view.tone].icon} ${view.tone === 'checking' ? 'animate-spin' : ''}`} aria-hidden="true" />
        </div>
        {view.name ? <p className="mt-5 text-lg font-semibold text-foreground">{view.name}</p> : null}
        <h2 id="scan-confirm-title" className={`text-2xl ${view.name ? 'mt-1' : 'mt-5'} ${TITLE[view.tone]}`}>{view.title}</h2>
        <p id="scan-confirm-message" role="status" className="mx-auto mt-3 max-w-sm text-base text-muted-foreground">{view.message}</p>
        {view.meta ? <p className="mt-3 text-sm text-muted-foreground">{view.meta}</p> : null}
        {view.tone === 'success' ? <p className="mt-4 inline-flex rounded-full bg-success-bg px-4 py-2 text-sm font-semibold text-success-text">{done} of {total} verified</p> : null}

        {view.tone === 'checking' ? null : (
          <div className="mt-6 grid gap-3">
            {view.tone === 'pending' ? (
              <button ref={primary} type="button" disabled={busy} onClick={onRetryUpload} className="flex h-14 items-center justify-center gap-2 rounded-xl bg-primary text-base font-semibold text-white disabled:opacity-50">
                {busy ? <Loader2 className="size-5 animate-spin" aria-hidden="true" /> : <CloudUpload className="size-5" aria-hidden="true" />}Retry upload
              </button>
            ) : canScan && done < total ? (
              <button ref={primary} type="button" onClick={onScan} className="flex h-14 items-center justify-center gap-2 rounded-xl bg-primary text-base font-semibold text-white">
                <ScanLine className="size-5" aria-hidden="true" />{view.tone === 'danger' ? 'Scan again' : 'Scan next location'}
              </button>
            ) : null}
            <button ref={view.tone === 'pending' || (canScan && done < total) ? undefined : primary} type="button" onClick={onClose} className="h-12 rounded-xl border border-border text-base font-medium text-primary">
              {done >= total && total > 0 ? 'Finish' : 'Close'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function describe(state: ConfirmState): { tone: Tone; key: string; title: string; message: string; name?: string; meta?: string } {
  if (state.kind === 'checking') return { tone: 'checking', key: 'checking', title: 'Checking…', message: state.message, name: state.name };
  if (state.kind === 'notice') return { tone: state.tone, key: state.title, title: state.title, message: state.message, name: state.name };
  const { receipt } = state;
  const feedback = scanFeedback(receipt);
  const meta = `Scanned ${formatTime(receipt.deviceTime)}${receipt.serverTime ? ` · confirmed ${formatTime(receipt.serverTime)}` : ''} · Muscat time`;
  if (feedback.tone === 'success') return { tone: 'success', key: `${receipt.id}-ok`, title: 'Visit verified', message: 'This location is done for tonight.', name: receipt.checkpointName, meta };
  if (feedback.tone === 'pending') return { tone: 'pending', key: `${receipt.id}-pending`, title: 'Saved on this phone', message: receipt.error ? `Not verified yet. ${receipt.error}` : 'Not verified yet: there is no connection. It uploads by itself; keep the app open.', name: receipt.checkpointName, meta };
  return { tone: feedback.tone, key: `${receipt.id}-${feedback.tone}`, title: feedback.tone === 'danger' ? 'Not counted' : 'Recorded – needs review', message: feedback.message, name: receipt.checkpointName, meta };
}
