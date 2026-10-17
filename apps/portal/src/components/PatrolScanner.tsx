import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser';
import { BarcodeFormat } from '@zxing/library';
import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui';

export function PatrolScanner({ onScan, onClose, fullscreen = false }: {
  onScan: (code: string, method: 'qr' | 'barcode') => void;
  onClose: () => void;
  fullscreen?: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const onScanRef = useRef(onScan);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
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
    let detected = false;
    let controls: IScannerControls | undefined;
    let stream: MediaStream | undefined;
    const stop = () => { controls?.stop(); stream?.getTracks().forEach((track) => track.stop()); };
    const hidden = () => { if (document.hidden) { stop(); setError('Camera paused. Close and reopen the scanner to continue.'); } };
    document.addEventListener('visibilitychange', hidden);
    void (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera is unavailable. Open the secure site in Safari or Chrome.');
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (disposed || document.hidden) { stop(); return; }
        if (!video.current) throw new Error('Camera preview is unavailable. Close and try again.');
        controls = await new BrowserMultiFormatReader().decodeFromStream(stream, video.current, (result, _error, scanner) => {
          if (!result || detected || disposed) return;
          detected = true;
          scanner.stop();
          stop();
          onScanRef.current(result.getText(), result.getBarcodeFormat() === BarcodeFormat.QR_CODE ? 'qr' : 'barcode');
        });
        if (disposed || detected) stop();
        else setReady(true);
      } catch (cause) {
        stop();
        if (disposed) return;
        const name = cause instanceof Error ? cause.name : '';
        setError(name === 'NotAllowedError' ? 'Allow camera access for this site in your browser settings, then reopen the scanner.'
          : name === 'NotFoundError' ? 'No camera was found on this device.'
          : cause instanceof Error ? cause.message : 'Could not open the camera. Close and try again.');
      }
    })();
    return () => { disposed = true; stop(); document.removeEventListener('visibilitychange', hidden); };
  }, []);

  const message = error ?? (ready ? 'Point the camera at the QR code or barcode. Time and GPS are captured automatically. Wait for the verification result.' : 'Opening camera…');
  if (fullscreen) return (
    // Guard patrol: the camera fills the screen so there is nothing else to look for.
    <section role="dialog" aria-modal="true" aria-label="Camera scanner" className="fixed inset-0 z-50 flex flex-col bg-black text-white">
      <header className="flex items-center justify-between gap-3 px-4 pt-[calc(12px+env(safe-area-inset-top))] pb-3">
        <h2 className="text-lg text-white">Scan the location's QR label</h2>
        <button ref={closeButton} type="button" onClick={onClose} aria-label="Close camera" className="flex size-12 items-center justify-center rounded-full bg-white/15"><X className="size-6" aria-hidden="true" /></button>
      </header>
      <div className="relative min-h-0 flex-1">
        <video ref={video} autoPlay muted playsInline className={`absolute inset-0 size-full object-cover ${error ? 'hidden' : ''}`} aria-label="Live camera preview" />
        {!error ? <div aria-hidden="true" className="absolute top-1/2 left-1/2 aspect-square w-[70%] max-w-80 -translate-x-1/2 -translate-y-1/2 rounded-3xl border-4 border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" /> : null}
      </div>
      <div className="px-5 pt-4 pb-[calc(20px+env(safe-area-inset-bottom))]">
        <p role={error ? 'alert' : 'status'} className={error ? 'rounded-xl bg-danger-bg p-4 text-base text-danger-text' : 'text-center text-base text-white/90'}>{error ?? (ready ? 'Hold the QR code inside the frame. Time and GPS are recorded automatically.' : 'Opening camera…')}</p>
        <button type="button" onClick={onClose} className="mt-4 h-12 w-full rounded-xl bg-white/15 text-base font-medium text-white">Cancel</button>
      </div>
    </section>
  );

  return (
    <section aria-label="Camera scanner" className="space-y-3 rounded-lg border border-border bg-white p-4">
      <h2 className="text-lg">Scan the label at this location</h2>
      <video ref={video} autoPlay muted playsInline className={`aspect-square w-full rounded-md bg-primary object-cover ${error ? 'hidden' : ''}`} aria-label="Live camera preview" />
      <p role={error ? 'alert' : 'status'} className={error ? 'rounded-lg border border-danger bg-danger-bg p-4 text-base text-danger-text' : 'text-sm'}>{message}</p>
      <Button className="min-h-11 w-full" variant="outline" onClick={onClose}>Close camera</Button>
    </section>
  );
}
