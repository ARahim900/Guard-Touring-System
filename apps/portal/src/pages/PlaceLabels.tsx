// =============================================================================
// Place labels on site: fix a printed label, scan it, done.
// =============================================================================
// The phone's GPS position at the moment of the scan becomes the location's
// position, and the location goes live. Guards' scans are later checked
// against this position (within the location's radius, 30 m by default), so
// the supervisor must stand right next to the label, in the open.
// =============================================================================
import { ArrowLeft, CheckCircle2, MapPin, ScanLine, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';

import { PatrolScanner } from '@/components/PatrolScanner';
import { Button, Card, ErrorNote, PageHeader, Spinner } from '@/components/ui';
import { friendlyError } from '@/lib/errors';
import { captureLocation } from '@/lib/guardPatrol';
import { supabase } from '@/lib/supabase';
import { formatDateTime } from '@/lib/time';
import { unwrap, useAsync } from '@/lib/useAsync';

interface PlaceResult {
  status: 'placed' | 'already_placed';
  name: string;
  code: string;
  accuracy_m?: number;
  placed_at?: string;
  distance_m?: number;
}
interface Fix { code: string; latitude: number; longitude: number; accuracy: number }

export default function PlaceLabelsPage() {
  const list = useAsync(async () => unwrap(await supabase.from('checkpoints').select('id, name, code, placed_at').order('name')) as { id: string; name: string; code: string; placed_at: string | null }[], []);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<PlaceResult | null>(null);
  const [lastFix, setLastFix] = useState<Fix | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send(fix: Fix, replace: boolean) {
    setBusy(replace ? 'Moving the location…' : 'Saving the position…');
    try {
      const data = unwrap(await supabase.rpc('place_checkpoint', {
        p_code: fix.code, p_latitude: fix.latitude, p_longitude: fix.longitude, p_accuracy_m: fix.accuracy, p_replace: replace,
      })) as PlaceResult;
      setResult(data);
      if (data.status === 'placed') void list.reload({ silent: true });
    } catch (cause) { setError(friendlyError(cause)); }
    finally { setBusy(null); }
  }

  async function onScan(code: string) {
    setScanning(false); setResult(null); setError(null);
    setBusy('Getting an accurate GPS position…');
    try {
      const position = await captureLocation();
      const fix = { code: code.trim(), latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy };
      setLastFix(fix);
      await send(fix, false);
    } catch (cause) { setError(friendlyError(cause)); setBusy(null); }
  }

  const remaining = (list.data ?? []).filter((c) => !c.placed_at);
  const total = list.data?.length ?? 0;

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <Link to="/checkpoints" className="inline-flex min-h-11 items-center gap-2 text-sm text-primary"><ArrowLeft className="size-4" aria-hidden="true" />Locations</Link>
      <PageHeader title="Place labels on site" subtitle="Fix the label, stand right next to it in the open, then scan it. Its GPS position is saved and the location goes live." />

      {list.loading ? <Spinner /> : <p role="status" className="rounded-xl bg-secondary-light px-5 py-4 font-semibold text-primary">{total - remaining.length} of {total} locations placed</p>}

      {scanning ? <PatrolScanner onScan={(code) => void onScan(code)} onClose={() => setScanning(false)} />
        : <Button className="min-h-14 w-full text-base" icon={ScanLine} disabled={Boolean(busy)} onClick={() => { setResult(null); setError(null); setScanning(true); }}>Scan a label</Button>}

      {busy ? <Spinner label={busy} /> : null}
      <ErrorNote message={error} />

      {result?.status === 'placed' ? (
        <div role="status" className="flex gap-3 rounded-xl border border-success bg-success-bg p-4 text-success-text">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <p><span className="font-semibold">{result.name} is placed and live.</span><br />GPS accuracy ±{result.accuracy_m} m. Scan the next label.</p>
        </div>
      ) : null}

      {result?.status === 'already_placed' && lastFix ? (
        <div role="alert" className="space-y-3 rounded-xl border border-warning bg-warning-bg p-4 text-warning-text">
          <p className="flex gap-3"><TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden="true" /><span><span className="font-semibold">{result.name} was already placed</span>{result.placed_at ? ` on ${formatDateTime(result.placed_at)}` : ''}, {result.distance_m} m from where you are now.</span></p>
          <p className="text-sm">Move it here only if the label has really moved. Guards' scans will then be checked against this new spot.</p>
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setResult(null)}>Keep it where it is</Button>
            <Button disabled={Boolean(busy)} onClick={() => void send(lastFix, true)}>Move it here</Button>
          </div>
        </div>
      ) : null}

      {remaining.length ? (
        <Card title={`Still to place (${remaining.length})`}>
          <ul className="divide-y divide-border">
            {remaining.map((c) => <li key={c.id} className="flex items-center gap-3 py-3"><MapPin className="size-4 text-muted-foreground" aria-hidden="true" /><span className="flex-1">{c.name}</span><span className="font-mono text-xs text-muted-foreground">{c.code}</span></li>)}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
