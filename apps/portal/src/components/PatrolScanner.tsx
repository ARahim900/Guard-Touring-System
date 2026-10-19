import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser';
import { BarcodeFormat } from '@zxing/library';
import { CameraOff, RefreshCw, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui';

type CameraError = { title: string; message: string };
function cameraError(cause: unknown): CameraError {
  const name = cause instanceof Error ? cause.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return { title: 'Camera access is blocked', message: 'Allow this site to use your camera, then tap Try again. No scan has been recorded.' };
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return { title: 'No camera found', message: 'Connect a camera or open this page on a phone with a camera, then try again.' };
  if (name === 'NotReadableError' || name === 'TrackStartError') return { title: 'Camera is busy', message: 'Close any other app or browser tab using the camera, then try again.' };
  return { title: 'Camera could not start', message: cause instanceof Error ? cause.message : 'Check your browser camera permissions and try again.' };
}

export function PatrolScanner({ onScan, onClose, fullscreen = false, target }: {
  onScan: (code: string, method: 'qr' | 'barcode') => void;
  onClose: () => void;
  fullscreen?: boolean;
  /** Name of the location the guard tapped, shown above the camera. */
  target?: string;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const onScanRef = useRef(onScan);
  const [error, setError] = useState<CameraError | null>(null);
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  onScanRef.current = onScan;
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (fullscreen) closeButton.current?.focus(); }, [fullscreen]);
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen, onClose]);

  useEffect(() => {
    let disposed = false;
    let paused = false;
    let detected = false;
    let controls: IScannerControls | undefined;
    let stream: MediaStream | undefined;
    const stop = () => { controls?.stop(); stream?.getTracks().forEach((track) => track.stop()); };
    const hidden = () => {
      if (!document.hidden || disposed) return;
      paused = true; stop(); setReady(false);
      setError({ title: 'Camera paused', message: 'The camera stopped when you left this page. Tap Try again when you are ready to scan.' });
    };
    document.addEventListener('visibilitychange', hidden);
    void (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Open the secure site in Safari or Chrome on a device with a camera.');
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (disposed || paused || document.hidden) { stop(); return; }
        if (!video.current) throw new Error('Camera preview is unavailable. Try again.');
        controls = await new BrowserMultiFormatReader().decodeFromStream(stream, video.current, (result, _error, scanner) => {
          if (!result || detected || disposed || paused || document.hidden) return;
          detected = true;
          scanner.stop(); stop();
          onScanRef.current(result.getText(), result.getBarcodeFormat() === BarcodeFormat.QR_CODE ? 'qr' : 'barcode');
        });
        if (disposed || detected || paused) stop();
        else setReady(true);
      } catch (cause) {
        stop();
        if (disposed || paused) return;
        setReady(false); setError(cameraError(cause));
      }
    })();
    return () => { disposed = true; stop(); document.removeEventListener('visibilitychange', hidden); };
  }, [attempt]);

  function retry() {
    setError(null); setReady(false); setAttempt((value) => value + 1);
    closeButton.current?.focus();
  }

  const recovery = error ? <div className="w-full max-w-md space-y-5 rounded-2xl border border-border bg-card p-5 text-foreground shadow-sm">
    <div className="flex size-12 items-center justify-center rounded-xl bg-warning-bg text-warning-text"><CameraOff className="size-6" aria-hidden="true" /></div>
    <div role="alert"><h2 className="text-xl">{error.title}</h2><p className="mt-2 text-base text-muted-foreground">{error.message}</p></div>
    <details className="rounded-lg bg-muted p-3">
      <summary className="min-h-11 cursor-pointer content-center font-medium text-primary">How to allow camera access</summary>
      <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm">
        <li>Open this site's permissions in your browser, usually beside the address bar, and allow Camera.</li>
        <li>If it is still blocked, check your device settings and allow your browser to use the camera.</li>
        <li>Return here and tap Try again. If you opened this link inside another app, open it in Safari or Chrome.</li>
      </ol>
    </details>
    <Button icon={RefreshCw} className="min-h-12 w-full" onClick={retry}>Try again</Button>
    {fullscreen ? <Button variant="outline" className="min-h-12 w-full" onClick={onClose}>Return to patrol</Button> : null}
  </div> : null;

  if (fullscreen) return (
    <section role="dialog" aria-modal="true" aria-label="Camera scanner" className={`fixed inset-0 z-50 flex flex-col ${error ? 'bg-background text-foreground' : 'bg-black text-white'}`}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button, summary, a[href]')].filter((element) => !element.matches(':disabled') && element.getClientRects().length > 0);
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}>
      <header className="flex items-center justify-between gap-3 px-4 pt-[calc(12px+env(safe-area-inset-top))] pb-3">
        <div className="min-w-0">
          <p className={`text-sm ${error ? 'text-muted-foreground' : 'text-white/90'}`}>{target ? 'Scan the QR label at' : 'Scan the location’s QR label'}</p>
          {target ? <h2 className={`break-words text-xl ${error ? 'text-primary' : 'text-white'}`}>{target}</h2> : null}
        </div>
        <button ref={closeButton} type="button" onClick={onClose} aria-label="Close camera" className={`flex size-12 shrink-0 items-center justify-center rounded-full ${error ? 'bg-muted text-primary' : 'bg-white/15'}`}><X className="size-6" aria-hidden="true" /></button>
      </header>
      <div className={error ? 'min-h-0 flex-1 overflow-y-auto px-4 pb-[calc(20px+env(safe-area-inset-bottom))]' : 'relative min-h-0 flex-1 overflow-hidden'}>
        <video ref={video} autoPlay muted playsInline className={`absolute inset-0 size-full object-cover ${error ? 'hidden' : ''}`} aria-label="Live camera preview" />
        {error ? <div className="mx-auto flex min-h-full max-w-md items-center py-4">{recovery}</div> : <div aria-hidden="true" className="absolute top-1/2 left-1/2 aspect-square w-[70%] max-w-80 -translate-x-1/2 -translate-y-1/2 rounded-3xl border-4 border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />}
      </div>
      {!error ? <div className="px-5 pt-4 pb-[calc(20px+env(safe-area-inset-bottom))]">
        <p role="status" className="text-center text-base text-white/90">{ready ? 'Hold the QR code inside the frame. Time and GPS are recorded automatically.' : 'Opening camera…'}</p>
        <button type="button" onClick={onClose} className="mt-4 h-12 w-full rounded-xl bg-white/15 text-base font-medium text-white">Return to patrol</button>
      </div> : null}
    </section>
  );

  return <section aria-label="Camera scanner" className="space-y-3 rounded-lg border border-border bg-card p-4">
    <h2 className="text-lg">Scan the label at this location</h2>
    <video ref={video} autoPlay muted playsInline className={`aspect-square w-full rounded-md bg-primary object-cover ${error ? 'hidden' : ''}`} aria-label="Live camera preview" />
    {recovery ?? <p role="status" className="text-sm">{ready ? 'Point the camera at the QR code or barcode. Wait for the verification result.' : 'Opening camera…'}</p>}
    <button ref={closeButton} type="button" className="min-h-11 w-full rounded-md border border-border bg-card px-4 text-sm font-medium text-primary" onClick={onClose}>Return to location</button>
  </section>;
}
