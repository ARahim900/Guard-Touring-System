// =============================================================================
// Checkpoints: where they are (GPS), their label code (QR/barcode), NFC tag.
// =============================================================================
// Placing a checkpoint accurately matters: scans more than "radius" metres
// away are rejected. Best practice: stand at the checkpoint with a tablet or
// phone, open this page, and press "Use my location"; or click the map.
// =============================================================================
import { Crosshair, MapPin, Pencil, Plus, QrCode, ScanLine, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Circle, Marker } from 'react-leaflet';
import { Link } from 'react-router';
import { toast } from 'sonner';

import { CheckpointQrPreview } from '@/components/CheckpointQrPreview';
import { BaseMap, CheckpointLayer, ClickToPick, FitBounds, icons } from '@/components/PatrolMap';
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Input, Modal, PageHeader, Spinner, Table, Td, Textarea } from '@/components/ui';
import { friendlyError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type { Checkpoint } from '@/lib/types';
import { unwrap, useAsync } from '@/lib/useAsync';

type Form = Omit<Checkpoint, 'id' | 'latitude' | 'longitude' | 'radius_m'> & { id?: string; latitude: string; longitude: string; radius_m: string };

const blank = (code: string): Form => ({ name: '', code, nfc_uid: null, description: null, latitude: '', longitude: '', radius_m: '30', active: true, placed_at: null });

function nextCode(list: Checkpoint[]): string {
  const nums = list.map((c) => Number(c.code.match(/(\d+)$/)?.[1] ?? 0));
  return `MB-CP-${String(Math.max(0, ...nums) + 1).padStart(4, '0')}`;
}

export default function CheckpointsPage() {
  const { data, loading, error, reload } = useAsync(async () => unwrap(await supabase.from('checkpoints').select('id, name, code, nfc_uid, description, latitude, longitude, radius_m, active, placed_at').order('name')) as Checkpoint[], []);
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [locating, setLocating] = useState(false);
  const [qrPreview, setQrPreview] = useState<{ id?: string } | null>(null);
  // Labels are printed for locations in use AND for those not yet placed, so they can be fixed on site.
  const printable = useMemo(() => (data ?? []).filter((checkpoint) => checkpoint.active || !checkpoint.placed_at), [data]);
  const previewCheckpoints = useMemo(() => qrPreview?.id ? (data ?? []).filter((checkpoint) => checkpoint.id === qrPreview.id) : printable, [data, qrPreview, printable]);
  const unplaced = (data ?? []).filter((checkpoint) => !checkpoint.placed_at).length;

  const points = useMemo(() => (data ?? []).filter((c) => c.placed_at && c.active).map((c) => [c.latitude, c.longitude] as [number, number]), [data]);

  function edit(c: Checkpoint) {
    setForm({ ...c, latitude: String(c.latitude), longitude: String(c.longitude), radius_m: String(c.radius_m) });
  }

  function useMyLocation() {
    if (!navigator.geolocation) return toast.error('This browser cannot read your location.');
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setForm((f) => f && { ...f, latitude: pos.coords.latitude.toFixed(7), longitude: pos.coords.longitude.toFixed(7) });
        toast.success(`Position captured (±${Math.round(pos.coords.accuracy)} m).`);
      },
      () => {
        setLocating(false);
        toast.error('Could not read your location. Allow location access, or click the map.');
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  /**
   * Deletes a location with no patrol history. One with history is retired
   * instead (hidden from guards), so past reports stay complete.
   */
  async function remove() {
    if (!form?.id) return;
    if (!window.confirm(`Delete "${form.name}"? Guards will no longer see it. If it has patrol history it is retired instead, so past reports stay complete.`)) return;
    setDeleting(true);
    const { data: outcome, error: deleteError } = await supabase.rpc('delete_checkpoint', { p_id: form.id });
    setDeleting(false);
    if (deleteError) return toast.error(friendlyError(deleteError));
    toast.success(outcome === 'deleted' ? `${form.name} deleted.` : `${form.name} has patrol history, so it was retired (hidden from guards) instead. Past reports keep it.`);
    setForm(null);
    void reload({ silent: true });
  }

  async function save() {
    if (!form) return;
    const lat = Number(form.latitude);
    const lng = Number(form.longitude);
    const radius = Number(form.radius_m);
    if (form.name.trim().length < 2) return toast.error('Enter a checkpoint name.');
    if (!form.code.trim()) return toast.error('Enter a label code.');
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !form.latitude || !form.longitude) return toast.error('Set the position: click the map or use your location.');
    if (!(radius > 0 && radius <= 200)) return toast.error('Radius must be between 1 and 200 metres.');

    setSaving(true);
    const row = {
      name: form.name.trim(),
      code: form.code.trim(),
      nfc_uid: form.nfc_uid?.replace(/[^0-9a-f]/gi, '').toUpperCase() || null,
      description: form.description?.trim() || null,
      latitude: lat,
      longitude: lng,
      radius_m: radius,
      active: form.active,
      // Saving an active location here confirms its position.
      placed_at: form.active ? form.placed_at ?? new Date().toISOString() : form.placed_at,
    };
    const res = form.id ? await supabase.from('checkpoints').update(row).eq('id', form.id) : await supabase.from('checkpoints').insert(row);
    setSaving(false);
    if (res.error) return toast.error(friendlyError(res.error));
    toast.success(form.id ? 'Checkpoint updated.' : 'Checkpoint created.');
    setForm(null);
    void reload({ silent: true });
  }

  const lat = Number(form?.latitude);
  const lng = Number(form?.longitude);
  const hasPos = form && form.latitude !== '' && form.longitude !== '' && Number.isFinite(lat) && Number.isFinite(lng);

  return (
    <>
      <PageHeader
        title="Checkpoints"
        subtitle="Each checkpoint has a printed QR/barcode label and, optionally, an NFC tag."
        actions={
          <>
            <Button variant="outline" icon={QrCode} disabled={!printable.length} onClick={() => setQrPreview({})}>QR codes / print</Button>
            <Link to="/checkpoints/place" className="inline-flex min-h-10 items-center gap-2 rounded-md border border-primary px-4 text-sm font-semibold text-primary hover:bg-muted"><ScanLine className="size-4" aria-hidden="true" />Place locations{unplaced ? ` (${unplaced} to do)` : ''}</Link>
            <Button icon={Plus} onClick={() => setForm(blank(nextCode(data ?? [])))}>New checkpoint</Button>
          </>
        }
      />
      <div className="grid gap-[14px] xl:grid-cols-[1fr_1fr]">
        <Card className="min-w-0">
          <ErrorNote message={error} />
          {loading ? (
            <Spinner />
          ) : !data?.length ? (
            <EmptyState icon={MapPin} title="No checkpoints yet" message="Create your first checkpoint, then print its QR label." />
          ) : (
            <Table head={['Name', 'Code', 'Radius', 'Status', 'QR code', '']}>
              {data.map((c) => (
                <tr key={c.id}>
                  <Td className="font-medium">{c.name}</Td>
                  <Td className="font-mono text-xs">{c.code}</Td>
                  <Td>{c.radius_m} m</Td>
                  <Td>{!c.placed_at ? <Badge label="Not placed" tone="warning" /> : c.active ? <Badge label="Active" tone="success" /> : <Badge label="Retired" />}</Td>
                  <Td><Button size="sm" variant="outline" icon={QrCode} aria-label={`View QR for ${c.name}`} onClick={() => setQrPreview({ id: c.id })}>View QR</Button></Td>
                  <Td className="text-right"><Button size="sm" variant="outline" icon={Pencil} onClick={() => edit(c)}>Edit</Button></Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        <Card className="min-w-0">
          <div className="-m-5">
            <BaseMap satellite className="h-[520px] w-full rounded-lg">
              <FitBounds points={points} />
              <CheckpointLayer checkpoints={(data ?? []).filter((c) => c.active)} />
            </BaseMap>
          </div>
        </Card>
      </div>

      {qrPreview ? <CheckpointQrPreview checkpoints={previewCheckpoints} initialId={qrPreview.id} onClose={() => setQrPreview(null)} /> : null}
      <Modal
        open={Boolean(form)}
        wide
        title={form?.id ? 'Edit checkpoint' : 'New checkpoint'}
        onClose={() => setForm(null)}
        footer={
          <>
            {form?.id ? <Button variant="danger" icon={Trash2} loading={deleting} className="mr-auto" onClick={() => void remove()}>Delete location</Button> : null}
            <Button variant="outline" onClick={() => setForm(null)}>Cancel</Button>
            <Button loading={saving} onClick={() => void save()}>Save</Button>
          </>
        }
      >
        {form ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-3">
              <Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Pump Station 2 – main door" /></Field>
              <Field label="Label code (printed in the QR / barcode)" hint="Must be unique. Changing it means reprinting the label.">
                <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} className="font-mono" />
              </Field>
              <Field label="NFC tag serial (optional)" hint="Only if tags are not written with the code. Android reads the serial; iPhone needs the code written on the tag.">
                <Input value={form.nfc_uid ?? ''} onChange={(e) => setForm({ ...form, nfc_uid: e.target.value })} className="font-mono" placeholder="04A1B2C3D4E5F6" />
              </Field>
              <div className="grid grid-cols-3 gap-2">
                <Field label="Latitude"><Input value={form.latitude} onChange={(e) => setForm({ ...form, latitude: e.target.value })} /></Field>
                <Field label="Longitude"><Input value={form.longitude} onChange={(e) => setForm({ ...form, longitude: e.target.value })} /></Field>
                <Field label="Radius (m)"><Input type="number" min={1} max={200} value={form.radius_m} onChange={(e) => setForm({ ...form, radius_m: e.target.value })} /></Field>
              </div>
              <Button variant="outline" icon={Crosshair} loading={locating} onClick={useMyLocation}>Use my location</Button>
              <Field label="Description / instructions (optional)">
                <Textarea value={form.description ?? ''} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
                Active (untick to retire; history is kept)
              </label>
            </div>
            <div>
              <p className="mb-1 text-sm font-medium">Click the map to set the position</p>
              <BaseMap satellite className="h-[420px] w-full rounded-md" center={hasPos ? [lat, lng] : undefined} zoom={hasPos ? 18 : undefined}>
                <ClickToPick onPick={(la, ln) => setForm((f) => f && { ...f, latitude: la.toFixed(7), longitude: ln.toFixed(7) })} />
                {hasPos ? (
                  <>
                    <Circle center={[lat, lng]} radius={Number(form.radius_m) || 30} pathOptions={{ color: '#4E4456', fillColor: '#A4C5BB', fillOpacity: 0.3 }} />
                    <Marker position={[lat, lng]} icon={icons.checkpoint(form.name || 'New')} />
                  </>
                ) : null}
              </BaseMap>
            </div>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
