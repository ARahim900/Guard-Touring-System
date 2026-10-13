import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser';
import { BarcodeFormat } from '@zxing/library';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui';

export function PatrolScanner({ onScan, onClose }: {
  onScan: (code: string, method: 'qr' | 'barcode') => void;
  onClose: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const onScanRef = useRef(onScan);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  onScanRef.current = onScan;

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

  return (
    <section aria-label="Camera scanner" className="space-y-3 rounded-lg border border-border bg-white p-4">
      <h2 className="text-lg">Scan the label at this location</h2>
      <video ref={video} autoPlay muted playsInline className={`aspect-square w-full rounded-md bg-primary object-cover ${error ? 'hidden' : ''}`} aria-label="Live camera preview" />
      <p role={error ? 'alert' : 'status'} className={error ? 'rounded-lg border border-danger bg-danger-bg p-4 text-base text-danger-text' : 'text-sm'}>{error ?? (ready ? 'Point the camera at the QR code or barcode. Time and GPS are captured automatically. Wait for the verification result.' : 'Opening camera…')}</p>
      <Button className="min-h-11 w-full" variant="outline" onClick={onClose}>Close camera</Button>
    </section>
  );
}
