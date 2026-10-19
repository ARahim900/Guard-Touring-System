// =============================================================================
// Place locations: give each location its position, then it goes live.
// =============================================================================
// Two ways, both by a supervisor:
// 1. On the map (no site visit): choose a location, tap its spot on the
//    satellite map (drag the pin to adjust) or paste coordinates / a Google
//    Maps link, then save.
// 2. Scan on site: fix the printed label, stand next to it and scan it; the
//    phone's GPS position is saved.
// Guards' scans are later checked against this position (within the
// location's radius, 30 m by default), so the pin must be on the real spot.
// =============================================================================
import { ArrowLeft, CheckCircle2, Map as MapIcon, MapPin, ScanLine, TriangleAlert } from 'lucide-react';
import type { Marker as LeafletMarker } from 'leaflet';
import { useMemo, useState } from 'react';
import { Circle, Marker } from 'react-leaflet';
import { Link } from 'react-router';
import { toast } from 'sonner';

import { BaseMap, CheckpointLayer, ClickToPick, FitBounds, FlyTo, icons } from '@/components/PatrolMap';
import { PatrolScanner } from '@/components/PatrolScanner';
import { Button, Card, ErrorNote, Field, Input, PageHeader, Select, Spinner } from '@/components/ui';
import { parseCoordinates } from '@/lib/coordinates';
import { friendlyError } from '@/lib/errors';
import { captureLocation } from '@/lib/guardPatrol';
import { supabase } from '@/lib/supabase';
import { formatDateTime } from '@/lib/time';
import type { Checkpoint } from '@/lib/types';
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
  const list = useAsync(async () => unwrap(await supabase.from('checkpoints')
    .select('id, name, code, nfc_uid, description, latitude, longitude, radius_m, active, placed_at').order('name')) as Checkpoint[], []);
  const [mode, setMode] = useState<'map' | 'scan'>('map');
  // Deleted locations (kept only for past reports) are never offered for placing.
  const all = (list.data ?? []).filter((c) => c.active || !c.placed_at);
  const remaining = all.filter((c) => !c.placed_at);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link to="/checkpoints" className="inline-flex min-h-11 items-center gap-2 text-sm text-primary"><ArrowLeft className="size-4" aria-hidden="true" />Locations</Link>
      <PageHeader title="Place locations" subtitle="Give each location its exact position. It goes live for guards as soon as it is saved." />
      {list.loading ? <Spinner /> : <p role="status" className="rounded-xl bg-secondary-light px-5 py-4 font-semibold text-primary">{all.length - remaining.length} of {all.length} locations placed</p>}
      <ErrorNote message={list.error} />

      <div role="tablist" aria-label="How to place" className="grid grid-cols-2 gap-2 rounded-xl bg-muted p-1">
        {([['map', 'On the map', MapIcon], ['scan', 'Scan on site', ScanLine]] as const).map(([key, label, Icon]) => (
          <button key={key} role="tab" aria-selected={mode === key} onClick={() => setMode(key)}
            className={`flex min-h-11 items-center justify-center gap-2 rounded-lg text-sm font-semibold ${mode === key ? 'bg-card text-primary shadow-card' : 'text-muted-foreground'}`}>
            <Icon className="size-4" aria-hidden="true" />{label}
          </button>
        ))}
      </div>

      {list.data ? (mode === 'map'
        ? <PlaceOnMap checkpoints={all} onSaved={() => void list.reload({ silent: true })} />
        : <PlaceByScan onPlaced={() => void list.reload({ silent: true })} />) : null}

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

/** Choose a location, tap the satellite map (or paste coordinates), save. */
function PlaceOnMap({ checkpoints, onSaved }: { checkpoints: Checkpoint[]; onSaved: () => void }) {
  // Locations still to place come first in the list.
  const ordered = useMemo(() => [...checkpoints].sort((a, b) => Number(Boolean(a.placed_at)) - Number(Boolean(b.placed_at)) || a.name.localeCompare(b.name)), [checkpoints]);
  const [id, setId] = useState(() => ordered.find((c) => !c.placed_at)?.id ?? ordered[0]?.id ?? '');
  const [pin, setPin] = useState<[number, number] | null>(null);
  const [pasted, setPasted] = useState('');
  const [saving, setSaving] = useState(false);
  const selected = checkpoints.find((c) => c.id === id);
  const placed = checkpoints.filter((c) => c.placed_at && c.active);
  const start = selected?.placed_at ? [selected.latitude, selected.longitude] as [number, number] : null;
  const shown = pin ?? start;

  function choose(next: string) { setId(next); setPin(null); setPasted(''); }

  function usePasted(text: string) {
    setPasted(text);
    const point = parseCoordinates(text);
    if (point) setPin(point);
  }

  async function save() {
    if (!selected || !pin) return;
    setSaving(true);
    const { error } = await supabase.from('checkpoints').update({
      latitude: Number(pin[0].toFixed(7)), longitude: Number(pin[1].toFixed(7)),
      placed_at: new Date().toISOString(), active: true,
      description: selected.description?.startsWith('POSITION NOT SET') ? null : selected.description,
    }).eq('id', selected.id);
    setSaving(false);
    if (error) return toast.error(friendlyError(error));
    toast.success(`${selected.name} is placed and live.`);
    onSaved();
    // Move straight on to the next location still to place.
    const next = ordered.find((c) => !c.placed_at && c.id !== selected.id);
    if (next) choose(next.id); else setPin(null);
  }

  if (!selected) return <p>No locations yet. Add them under Locations first.</p>;
  return (
    <Card>
      <div className="space-y-4">
        <Field label="Location">
          <Select className="min-h-12 text-base" value={id} onChange={(e) => choose(e.target.value)}>
            {ordered.map((c) => <option key={c.id} value={c.id}>{c.name}{c.placed_at ? '' : ' (not placed)'}</option>)}
          </Select>
        </Field>
        <p className="text-sm text-muted-foreground">Zoom right in on the satellite view and tap the exact spot where the label is fixed. Drag the pin to adjust. Guards must be within {selected.radius_m} m of it when they scan.</p>
        <div className="-mx-5">
          <BaseMap satellite className="h-[60vh] min-h-[360px] w-full">
            <FitBounds points={placed.map((c) => [c.latitude, c.longitude] as [number, number])} />
            <FlyTo target={start} />
            <FlyTo target={parseCoordinates(pasted)} />
            <CheckpointLayer checkpoints={placed.filter((c) => c.id !== selected.id)} />
            <ClickToPick onPick={(lat, lng) => { setPin([lat, lng]); setPasted(''); }} />
            {shown ? (
              <>
                <Circle center={shown} radius={selected.radius_m} pathOptions={{ color: '#4E4456', fillColor: '#A4C5BB', fillOpacity: 0.3 }} />
                <Marker position={shown} icon={icons.checkpoint(selected.name)} draggable
                  eventHandlers={{ dragend: (e) => { const p = (e.target as LeafletMarker).getLatLng(); setPin([p.lat, p.lng]); } }} />
              </>
            ) : null}
          </BaseMap>
        </div>
        <Field label="Or paste coordinates or a Google Maps link" hint="In Google Maps, press and hold the spot, then copy the numbers shown (for example 23.54131, 58.63348). Short share links (maps.app.goo.gl) cannot be read.">
          <Input value={pasted} inputMode="decimal" placeholder="23.54131, 58.63348" onChange={(e) => usePasted(e.target.value)} />
        </Field>
        {pasted && !parseCoordinates(pasted) ? <p className="text-sm text-danger-text">These are not coordinates. Copy the two numbers from Google Maps.</p> : null}
        <p className="text-sm">{pin ? `Pin: ${pin[0].toFixed(6)}, ${pin[1].toFixed(6)}` : selected.placed_at ? 'Current position shown. Tap the map to move it.' : 'Tap the map to drop the pin.'}</p>
        <Button className="min-h-12 w-full" icon={CheckCircle2} loading={saving} disabled={!pin} onClick={() => void save()}>Save position and make live</Button>
      </div>
    </Card>
  );
}

/** Fix the label, stand next to it, scan it: the phone's GPS position is saved. */
function PlaceByScan({ onPlaced }: { onPlaced: () => void }) {
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
      if (data.status === 'placed') onPlaced();
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

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Fix the label, stand right next to it in the open, then scan it.</p>
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
    </div>
  );
}
