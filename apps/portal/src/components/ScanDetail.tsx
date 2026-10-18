// =============================================================================
// Full evidence for one scan: times, GPS, validation flags, photos, voice memo.
// Photos and audio are in a PRIVATE bucket, so we ask Supabase for "signed
// URLs": temporary links valid for 1 hour, generated only for staff.
// A supervisor can override the automatic verdict, with a mandatory note.
// =============================================================================
import { AlertTriangle, ImageOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Badge, Button, ErrorNote, Field, Select, Spinner, Textarea } from '@/components/ui';
import { friendlyError } from '@/lib/errors';
import { FLAG_LABELS, VALIDATION, guardName } from '@/lib/labels';
import { MEDIA_BUCKET, supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { formatDateTime } from '@/lib/time';
import type { Scan, ScanValidation } from '@/lib/types';
import { unwrap, useAsync } from '@/lib/useAsync';

export function ScanDetail({ scanId, onChanged }: { scanId: string; onChanged?: () => void }) {
  // The security account reads the evidence; only staff can review it.
  const canReview = useAuth().profile?.role !== 'guard';
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [verdict, setVerdict] = useState<ScanValidation>('valid');
  const [reviewNote, setReviewNote] = useState('');
  const [saving, setSaving] = useState(false);

  const { data: scan, loading, error, reload } = useAsync(
    async () =>
      unwrap(
        await supabase
          .from('scans')
          .select('id, shift_id, guard_id, checkpoint_id, method, raw_value, status, note, device_time, server_time, clock_offset_sec, effective_time, latitude, longitude, accuracy_m, is_mocked, distance_m, due_at, is_on_time, validation, flags, expected_attachments, review_note, reviewed_at, review_history, profiles!scans_guard_id_fkey(full_name), shifts!scans_shift_id_fkey(on_duty_name, on_duty_ref), checkpoints(name), scan_attachments(id, type, source, storage_path, size_bytes, duration_sec, captured_at, exif_taken_at, flagged_pre_shift)')
          .eq('id', scanId)
          .single().returns<Scan>(),
      ) as Scan,
    [scanId],
  );

  useEffect(() => {
    if (!scan) return;
    setVerdict(scan.validation);
    setReviewNote(scan.review_note ?? '');
    const paths = (scan.scan_attachments ?? []).map((a) => a.storage_path);
    if (!paths.length) return;
    supabase.storage
      .from(MEDIA_BUCKET)
      .createSignedUrls(paths, 3600)
      .then(({ data, error: urlError }) => {
        if (urlError) { toast.error(friendlyError(urlError)); return; }
        const map: Record<string, string> = {};
        data?.forEach((d) => d.path && d.signedUrl && (map[d.path] = d.signedUrl));
        setUrls(map);
      });
  }, [scan]);

  async function saveReview() {
    if (!reviewNote.trim()) return toast.error('A note is required to override the verdict.');
    setSaving(true);
    const { error: e } = await supabase
      .from('scans')
      .update({ validation: verdict, review_note: reviewNote.trim() })
      .eq('id', scanId);
    setSaving(false);
    if (e) return toast.error(friendlyError(e));
    toast.success('Review saved.');
    void reload({ silent: true });
    onChanged?.();
  }

  if (loading) return <Spinner />;
  if (error || !scan) return <ErrorNote message={error ?? 'Scan not found.'} />;

  const atts = scan.scan_attachments ?? [];
  const missing = Math.max(0, scan.expected_attachments - atts.length);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge {...VALIDATION[scan.validation]} />
        <Badge label={scan.status === 'issue' ? 'Issue found' : 'Normal'} tone={scan.status === 'issue' ? 'danger' : 'neutral'} />
        <Badge label={scan.method.toUpperCase()} tone="brand" />
        {scan.is_on_time === false ? <Badge label="Late" tone="warning" /> : null}
        {scan.flags.filter((f) => f !== 'late').map((f) => <Badge key={f} label={FLAG_LABELS[f] ?? f} tone="warning" />)}
      </div>

      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <Item label="Guard" value={guardName(scan)} />
        <Item label="Checkpoint" value={scan.checkpoints?.name} />
        <Item label="Captured scan time" value={formatDateTime(scan.effective_time)} />
        <Item label="Due" value={scan.due_at ? formatDateTime(scan.due_at) : '–'} />
        <Item label="Phone clock at scan" value={formatDateTime(scan.device_time)} />
        <Item label="Received by server" value={formatDateTime(scan.server_time)} />
        <Item label="Clock difference at upload" value={`${scan.clock_offset_sec} s`} />
        <Item label="Distance from checkpoint" value={scan.distance_m !== null ? `${scan.distance_m} m` : 'No GPS'} />
        <Item label="GPS accuracy" value={scan.accuracy_m !== null ? `±${Math.round(scan.accuracy_m)} m` : '–'} />
        <Item label="Mock location" value={scan.is_mocked ? 'YES (fake GPS app)' : 'No'} />
        <Item label="Scanned value" value={scan.raw_value} />
        {scan.latitude !== null ? (
          <Item
            label="Position"
            value={
              <a className="underline" target="_blank" rel="noreferrer" href={`https://www.openstreetmap.org/?mlat=${scan.latitude}&mlon=${scan.longitude}#map=19/${scan.latitude}/${scan.longitude}`}>
                {scan.latitude.toFixed(6)}, {scan.longitude?.toFixed(6)}
              </a>
            }
          />
        ) : null}
      </dl>

      {scan.note ? <p className="rounded-md bg-muted p-3 text-sm">“{scan.note}”</p> : null}

      <div>
        <p className="mb-2 text-sm font-semibold">Attachments ({atts.length})</p>
        {missing > 0 ? (
          <p className="mb-2 flex items-center gap-2 text-xs text-warning-text">
            <AlertTriangle className="size-4" /> {missing} file(s) still uploading from the guard’s phone.
          </p>
        ) : null}
        <div className="flex flex-wrap gap-3">
          {atts.filter((a) => a.type === 'photo').map((a) => (
            <figure key={a.id} className="w-40">
              {urls[a.storage_path] ? (
                <a href={urls[a.storage_path]} target="_blank" rel="noreferrer">
                  <img src={urls[a.storage_path]} alt="Scan evidence" className="h-32 w-40 rounded-md border border-border object-cover" />
                </a>
              ) : (
                <div className="flex h-32 w-40 items-center justify-center rounded-md bg-muted"><ImageOff className="size-6 text-muted-foreground" /></div>
              )}
              <figcaption className="mt-1 text-xs text-muted-foreground">
                {a.source === 'gallery' ? 'From gallery' : 'Camera'}
                {a.flagged_pre_shift ? <span className="block font-semibold text-warning-text">Taken before shift{a.exif_taken_at ? ` (${formatDateTime(a.exif_taken_at)})` : ' (no date)'}</span> : null}
              </figcaption>
            </figure>
          ))}
        </div>
        {atts.filter((a) => a.type === 'audio').map((a) => (
          <div key={a.id} className="mt-3">
            <p className="text-xs text-muted-foreground">Voice memo · {Math.round(a.duration_sec ?? 0)} s · {formatDateTime(a.captured_at)}</p>
            {urls[a.storage_path] ? <audio controls src={urls[a.storage_path]} className="mt-1 w-full" /> : null}
          </div>
        ))}
      </div>

      {!canReview ? (scan.review_note ? <p className="rounded-md border border-border p-3 text-sm"><span className="font-semibold">Supervisor note: </span>{scan.review_note}</p> : null) : <div className="rounded-md border border-border p-3">
        <p className="mb-2 text-sm font-semibold">Supervisor review</p>
        {scan.reviewed_at ? <p className="mb-2 text-xs text-muted-foreground">Last reviewed {formatDateTime(scan.reviewed_at)}</p> : null}
        <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
          <Field label="Verdict">
            <Select value={verdict} onChange={(e) => setVerdict(e.target.value as ScanValidation)}>
              <option value="valid">Valid</option>
              <option value="flagged">Flagged</option>
              <option value="rejected">Rejected</option>
            </Select>
          </Field>
          <Field label="Reason (required)">
            <Textarea value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} placeholder="e.g. GPS drift in pump room; CCTV confirms visit." />
          </Field>
        </div>
        {scan.review_history.length > 0 ? <ul className="my-3 space-y-2 text-sm">{scan.review_history.map((review, index) => <li key={`${review.reviewed_at}:${index}`}>{formatDateTime(review.reviewed_at)} · {review.previous_verdict} → {review.verdict}: {review.reason}</li>)}</ul> : null}
        <div className="mt-2 flex justify-end">
          <Button size="sm" loading={saving} onClick={() => void saveReview()}>Save review</Button>
        </div>
      </div>}
    </div>
  );
}

function Item({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b border-border py-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value ?? '–'}</dd>
    </div>
  );
}
