import { Download, Printer, Share2 } from 'lucide-react';
import { useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { Button, ErrorNote, Field, Modal, Select, Spinner } from '@/components/ui';
import { createCheckpointLabel, type LabelCheckpoint } from '@/lib/checkpointLabel';
import { friendlyError } from '@/lib/errors';
import { useAsync } from '@/lib/useAsync';

export function CheckpointQrPreview({ checkpoints, initialId, onClose }: { checkpoints: LabelCheckpoint[]; initialId?: string; onClose: () => void }) {
  const [selectedId, setSelectedId] = useState(initialId ?? checkpoints[0]?.id ?? '');
  const [printAll, setPrintAll] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const { data: labels, loading, error, reload } = useAsync(() => Promise.all(checkpoints.map(createCheckpointLabel)), [checkpoints]);
  const selected = labels?.find((label) => label.id === selectedId);
  const canShare = selected && typeof navigator.canShare === 'function' && navigator.canShare({ files: [selected.file] });
  const printLabels = printAll ? labels ?? [] : selected ? [selected] : [];

  function print(all: boolean) {
    setActionError(null);
    try {
      // Commit the chosen print sheet before the browser captures the document.
      flushSync(() => setPrintAll(all));
      window.print();
    } catch (cause) { setActionError(friendlyError(cause, 'Could not open printing. Save the image and print it from your device.')); }
  }

  async function share() {
    if (!selected) return;
    setActionError(null); setSharing(true);
    try { await navigator.share({ files: [selected.file], title: `${selected.name} · MB Patrol` }); }
    catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') setActionError('Sharing cancelled. You can still use Save image.');
      else setActionError(friendlyError(cause, 'Sharing is unavailable. Use Save image instead.'));
    } finally { setSharing(false); }
  }

  return createPortal(<>
    <Modal open title="QR code preview" onClose={onClose} footer={<Button type="button" variant="outline" className="min-h-11" onClick={onClose}>Close preview</Button>}>
      <div className="space-y-4">
        {checkpoints.length > 1 ? <Field label="Location"><Select value={selectedId} onChange={(event) => { setSelectedId(event.target.value); setPrintAll(false); setActionError(null); }}>{checkpoints.map((checkpoint) => <option key={checkpoint.id} value={checkpoint.id}>{checkpoint.name}</option>)}</Select></Field> : null}
        <ErrorNote message={actionError ?? error} />
        {error ? <Button type="button" variant="outline" onClick={() => void reload()}>Try again</Button> : null}
        {loading ? <Spinner label="Preparing QR labels…" /> : selected ? <>
          <img src={selected.image} alt={`QR label for ${selected.name}, code ${selected.code}`} className="mx-auto h-auto w-full max-w-80 rounded-md" />
          <div className="grid grid-cols-2 gap-3">
            <a href={selected.image} download={selected.file.name} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-primary px-3 py-3 text-sm font-semibold text-white"><Download className="size-4" aria-hidden="true" />Save image</a>
            <Button type="button" variant="outline" icon={Printer} className="min-h-12" onClick={() => print(false)}>Print label</Button>
          </div>
          {canShare ? <Button type="button" variant="secondary" icon={Share2} className="min-h-11 w-full" loading={sharing} onClick={() => void share()}>Share image</Button> : null}
          <p className="text-sm text-muted-foreground">Save image downloads a PNG. On a phone, you can also touch and hold the QR image to see available save options.</p>
          {checkpoints.length > 1 ? <Button type="button" variant="ghost" icon={Printer} className="min-h-11 w-full" onClick={() => print(true)}>Print all {checkpoints.length} labels</Button> : null}
        </> : !error ? <p>No active locations to print.</p> : null}
      </div>
    </Modal>
    {selected ? <div id="qr-label-print" className="hidden print:block">
      <style media="print">{'@page { margin: 12mm; } body > :not(#qr-label-print) { display: none !important; } html, body { height: auto !important; background: white !important; } #qr-label-print { display: block !important; }'}</style>
      <div className="grid grid-cols-2 gap-6">{printLabels.map((label) => <img key={label.id} src={label.image} alt={`QR label for ${label.name}`} className="w-full break-inside-avoid" />)}</div>
    </div> : null}
  </>, document.body);
}
