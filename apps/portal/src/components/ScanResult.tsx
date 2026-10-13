import { AlertTriangle, CheckCircle2, CloudUpload, XCircle } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui';
import type { PatrolReceipt } from '@/lib/guardOutbox';
import { scanFeedback } from '@/lib/scanFeedback';
import { formatTime } from '@/lib/time';

export function ScanResult({ receipt, onRetry, disabled, announce = false }: {
  receipt: PatrolReceipt; onRetry: () => void; disabled: boolean; announce?: boolean;
}) {
  const card = useRef<HTMLElement>(null);
  const result = scanFeedback(receipt);
  const Icon = result.tone === 'danger' ? XCircle : result.tone === 'success' ? CheckCircle2 : result.tone === 'pending' ? CloudUpload : AlertTriangle;
  const style = result.tone === 'danger' ? 'border-danger bg-danger-bg text-danger-text'
    : result.tone === 'success' ? 'border-secondary bg-secondary-light text-primary' : 'border-amber-300 bg-amber-50 text-amber-950';
  useEffect(() => {
    if (announce) { card.current?.focus({ preventScroll: true }); card.current?.scrollIntoView({ block: 'nearest' }); }
  }, [announce, receipt.id, receipt.state, receipt.validation]);

  return <section ref={card} tabIndex={-1} role={result.tone === 'danger' || result.tone === 'warning' ? 'alert' : 'status'} aria-atomic="true" className={`space-y-4 rounded-2xl border-2 p-5 ${style}`}>
    <div className="flex items-start gap-3"><Icon className="mt-1 size-7 shrink-0" aria-hidden="true" /><div><p className="text-sm font-medium">{receipt.checkpointName}</p><h2 className="mt-1 text-xl font-semibold text-inherit">{result.title}</h2></div></div>
    <p className="text-base">{result.message}</p>
    <p className="text-sm">Scanned {formatTime(receipt.deviceTime)}{receipt.serverTime ? ` · Received ${formatTime(receipt.serverTime)}` : ''} · Muscat time</p>
    {receipt.error && receipt.state === 'pending' ? <p className="text-sm">{receipt.error}</p> : null}
    {result.tone !== 'success' ? <Button className="min-h-12 w-full" variant="primary" disabled={disabled} onClick={onRetry}>{receipt.state === 'pending' ? 'Retry upload' : 'Scan again at the location'}</Button> : null}
  </section>;
}
