// =============================================================================
// Outbox: functions that put work INTO the local queue and read it back.
// The sync engine (sync.ts) takes work OUT and uploads it.
// Every item records which guard saved it (guard_id), and is only ever read
// back or uploaded for that same guard.
// =============================================================================
import { Directory, File, Paths } from 'expo-file-system';

import type { SQLiteDatabase } from 'expo-sqlite';

import type { AttachmentSource, AttachmentType, ScanMethod, ScanStatus, ScanValidation } from '@/lib/types';
import { getDb } from './db';

/** Arguments for the submit_scan database function (minus p_device_sent_at, added at upload time). */
export interface ScanPayload {
  p_scan_id: string;
  p_shift_id: string;
  p_checkpoint_id: string;
  p_method: ScanMethod;
  p_raw_value: string;
  p_status: ScanStatus;
  p_note: string | null;
  p_device_time: string;
  p_latitude: number | null;
  p_longitude: number | null;
  p_accuracy_m: number | null;
  p_is_mocked: boolean;
  p_expected_attachments: number;
}

/** A photo or voice memo the guard attached, before it is queued. */
export interface DraftAttachment {
  id: string;
  type: AttachmentType;
  source: AttachmentSource;
  uri: string;
  mimeType: string;
  durationSec?: number;
  capturedAt: string;
  exifTakenAt?: string | null;
  /** UI hint only: gallery photo older than the shift start. The server decides. */
  preShift?: boolean;
}

export interface LocalScan {
  id: string;
  payload: ScanPayload;
  checkpoint_name: string;
  device_time: string;
  status: 'pending' | 'synced' | 'failed';
  attempts: number;
  last_error: string | null;
  validation: ScanValidation | null;
  flags: string[];
  pending_attachments: number;
}

export interface PendingAttachmentRow {
  id: string;
  scan_id: string;
  type: AttachmentType;
  source: AttachmentSource;
  local_uri: string;
  mime_type: string;
  size_bytes: number | null;
  duration_sec: number | null;
  captured_at: string;
  exif_taken_at: string | null;
  attempts: number;
}

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'audio/mp4': 'm4a' };

/**
 * Run SQLite transactions one after another. The app and the background
 * location task share one database connection, and SQLite cannot start a
 * transaction while another is open on the same connection.
 */
let txChain: Promise<unknown> = Promise.resolve();
function serialTx(db: SQLiteDatabase, task: () => Promise<void>): Promise<void> {
  const run = txChain.then(() => db.withTransactionAsync(task));
  txChain = run.catch(() => undefined);
  return run;
}

/**
 * Copy temporary camera/recorder files into the app's permanent document
 * folder. The OS may delete "cache" files at any time, which would lose
 * evidence that has not been uploaded yet.
 */
function persistFile(scanId: string, att: DraftAttachment): { uri: string; size: number } {
  const dir = new Directory(Paths.document, 'outbox', scanId);
  if (!dir.exists) dir.create({ intermediates: true });
  const dest = new File(dir, `${att.id}.${EXT[att.mimeType] ?? 'bin'}`);
  if (dest.exists) dest.delete();
  new File(att.uri).copySync(dest);
  return { uri: dest.uri, size: dest.size };
}

/** Save a scan and its attachments to the outbox in one transaction. */
export async function enqueueScan(guardId: string, payload: ScanPayload, checkpointName: string, attachments: DraftAttachment[]) {
  const db = await getDb();
  const files = attachments.map((a) => ({ att: a, ...persistFile(payload.p_scan_id, a) }));
  const now = new Date().toISOString();

  await serialTx(db, async () => {
    await db.runAsync(
      `INSERT INTO outbox_scans (id, guard_id, payload, checkpoint_name, device_time, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      payload.p_scan_id, guardId, JSON.stringify(payload), checkpointName, payload.p_device_time, now,
    );
    for (const f of files) {
      await db.runAsync(
        `INSERT INTO outbox_attachments
           (id, scan_id, type, source, local_uri, mime_type, size_bytes, duration_sec, captured_at, exif_taken_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        f.att.id, payload.p_scan_id, f.att.type, f.att.source, f.uri, f.att.mimeType, f.size,
        f.att.durationSec ?? null, f.att.capturedAt, f.att.exifTakenAt ?? null,
      );
    }
  });
}

interface ScanDbRow {
  id: string;
  payload: string;
  checkpoint_name: string;
  device_time: string;
  status: LocalScan['status'];
  attempts: number;
  last_error: string | null;
  validation: ScanValidation | null;
  flags: string | null;
  pending_attachments: number;
}

const toLocalScan = (r: ScanDbRow): LocalScan => ({
  ...r,
  payload: JSON.parse(r.payload),
  flags: r.flags ? JSON.parse(r.flags) : [],
});

/** Local scans (any status) whose scan time falls in [from, to). */
export async function listLocalScans(guardId: string, fromIso: string, toIso: string): Promise<LocalScan[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<ScanDbRow>(
    `SELECT s.*, (SELECT COUNT(*) FROM outbox_attachments a WHERE a.scan_id = s.id AND a.status = 'pending') AS pending_attachments
       FROM outbox_scans s
      WHERE s.guard_id = ? AND s.device_time >= ? AND s.device_time < ?
      ORDER BY s.device_time DESC`,
    guardId, fromIso, toIso,
  );
  return rows.map(toLocalScan);
}

/** Scans waiting for upload, oldest first (so the server sees them in order). */
export async function pendingScans(guardId: string): Promise<LocalScan[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<ScanDbRow>(
    `SELECT s.*, 0 AS pending_attachments FROM outbox_scans s WHERE status = 'pending' AND guard_id = ? ORDER BY device_time ASC`,
    guardId,
  );
  return rows.map(toLocalScan);
}

/** Scan ids of this shift already in the outbox (to tick checkpoints off while offline). */
export async function localScanCheckpoints(shiftId: string): Promise<Map<string, LocalScan>> {
  const db = await getDb();
  const rows = await db.getAllAsync<ScanDbRow>(
    `SELECT s.*, 0 AS pending_attachments FROM outbox_scans s WHERE status <> 'failed' AND json_extract(payload, '$.p_shift_id') = ?`,
    shiftId,
  );
  const map = new Map<string, LocalScan>();
  for (const r of rows.map(toLocalScan)) {
    if (r.validation === 'rejected') continue;
    if (!map.has(r.payload.p_checkpoint_id)) map.set(r.payload.p_checkpoint_id, r);
  }
  return map;
}

export async function markScanSynced(id: string, validation: ScanValidation, flags: string[]) {
  const db = await getDb();
  await db.runAsync(
    `UPDATE outbox_scans SET status = 'synced', validation = ?, flags = ?, synced_at = ?, last_error = NULL WHERE id = ?`,
    validation, JSON.stringify(flags), new Date().toISOString(), id,
  );
}

export async function markScanFailed(id: string, error: string) {
  const db = await getDb();
  await db.runAsync(`UPDATE outbox_scans SET status = 'failed', last_error = ? WHERE id = ?`, error, id);
  // Attachments of a failed scan can never upload (their folder needs the scan).
  await db.runAsync(`UPDATE outbox_attachments SET status = 'failed', last_error = ? WHERE scan_id = ?`, error, id);
}

export async function bumpScanAttempt(id: string, error: string) {
  const db = await getDb();
  await db.runAsync(`UPDATE outbox_scans SET attempts = attempts + 1, last_error = ? WHERE id = ?`, error, id);
}

/** Retry a failed scan (Records screen button). */
export async function retryScan(id: string) {
  const db = await getDb();
  await db.runAsync(`UPDATE outbox_scans SET status = 'pending', last_error = NULL WHERE id = ?`, id);
  await db.runAsync(`UPDATE outbox_attachments SET status = 'pending', last_error = NULL WHERE scan_id = ?`, id);
}

/** Attachments whose scan is already on the server. */
export async function uploadableAttachments(guardId: string): Promise<PendingAttachmentRow[]> {
  const db = await getDb();
  return db.getAllAsync<PendingAttachmentRow>(
    `SELECT a.* FROM outbox_attachments a
       JOIN outbox_scans s ON s.id = a.scan_id
      WHERE a.status = 'pending' AND s.status = 'synced' AND s.guard_id = ?
      ORDER BY a.captured_at ASC`,
    guardId,
  );
}

export async function markAttachmentUploaded(id: string) {
  const db = await getDb();
  const row = await db.getFirstAsync<{ local_uri: string }>(`SELECT local_uri FROM outbox_attachments WHERE id = ?`, id);
  await db.runAsync(`UPDATE outbox_attachments SET status = 'synced', last_error = NULL WHERE id = ?`, id);
  // The file is safely on the server now; free the phone's storage.
  if (row) {
    try {
      const f = new File(row.local_uri);
      if (f.exists) f.delete();
    } catch {
      // Not critical: the purge job will try again.
    }
  }
}

export async function bumpAttachmentAttempt(id: string, error: string, permanent: boolean) {
  const db = await getDb();
  await db.runAsync(
    `UPDATE outbox_attachments SET attempts = attempts + 1, last_error = ?, status = CASE WHEN ? THEN 'failed' ELSE status END WHERE id = ?`,
    error, permanent ? 1 : 0, id,
  );
}

export interface PendingCounts {
  scans: number;
  attachments: number;
  pings: number;
  failed: number;
}

export async function pendingCounts(guardId: string): Promise<PendingCounts> {
  const db = await getDb();
  const r = await db.getFirstAsync<PendingCounts>(
    `SELECT
      (SELECT COUNT(*) FROM outbox_scans WHERE status = 'pending' AND guard_id = ?1) AS scans,
      (SELECT COUNT(*) FROM outbox_attachments a JOIN outbox_scans s ON s.id = a.scan_id
        WHERE a.status = 'pending' AND s.guard_id = ?1)                              AS attachments,
      (SELECT COUNT(*) FROM outbox_pings WHERE guard_id = ?1)                        AS pings,
      (SELECT COUNT(*) FROM outbox_scans WHERE status = 'failed' AND guard_id = ?1)  AS failed`,
    guardId,
  );
  return r ?? { scans: 0, attachments: 0, pings: 0, failed: 0 };
}

// ----------------------------------------------------------------- GPS trail
export interface PingInput {
  guard_id: string;
  shift_id: string;
  latitude: number;
  longitude: number;
  accuracy_m: number | null;
  speed_mps: number | null;
  is_mocked: boolean;
  recorded_at: string;
}

export async function addPings(pings: PingInput[]) {
  if (!pings.length) return;
  const db = await getDb();
  await serialTx(db, async () => {
    for (const p of pings) {
      await db.runAsync(
        `INSERT INTO outbox_pings (guard_id, shift_id, latitude, longitude, accuracy_m, speed_mps, is_mocked, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        p.guard_id, p.shift_id, p.latitude, p.longitude, p.accuracy_m, p.speed_mps, p.is_mocked ? 1 : 0, p.recorded_at,
      );
    }
  });
}

export async function takePings(guardId: string, limit = 200) {
  const db = await getDb();
  return db.getAllAsync<PingInput & { id: number; is_mocked: number | boolean }>(
    `SELECT * FROM outbox_pings WHERE guard_id = ? ORDER BY recorded_at ASC LIMIT ?`, guardId, limit,
  );
}

export async function deletePings(ids: number[]) {
  if (!ids.length) return;
  const db = await getDb();
  await db.runAsync(`DELETE FROM outbox_pings WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids);
}

// ----------------------------------------------------------------------- SOS
export interface SosPayload {
  p_shift_id: string | null;
  p_latitude: number | null;
  p_longitude: number | null;
  p_accuracy_m: number | null;
  p_message: string | null;
}

export async function enqueueSos(guardId: string, id: string, payload: SosPayload) {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR IGNORE INTO outbox_sos (id, guard_id, payload, created_at) VALUES (?, ?, ?, ?)`,
    id, guardId, JSON.stringify(payload), new Date().toISOString(),
  );
}

export async function pendingSos(guardId: string) {
  const db = await getDb();
  const rows = await db.getAllAsync<{ id: string; payload: string; created_at: string }>(
    `SELECT * FROM outbox_sos WHERE guard_id = ? ORDER BY created_at`, guardId,
  );
  return rows.map((r) => ({ id: r.id, created_at: r.created_at, payload: JSON.parse(r.payload) as SosPayload }));
}

export async function deleteSos(id: string) {
  const db = await getDb();
  await db.runAsync(`DELETE FROM outbox_sos WHERE id = ?`, id);
}

// ------------------------------------------------------------------ cleanup
/** Delete synced history older than 14 days so the phone does not fill up. */
export async function purgeOldRecords() {
  const db = await getDb();
  const cutoff = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();
  const old = await db.getAllAsync<{ id: string }>(`SELECT id FROM outbox_scans WHERE status = 'synced' AND device_time < ?`, cutoff);
  for (const { id } of old) {
    const dir = new Directory(Paths.document, 'outbox', id);
    try {
      if (dir.exists) dir.delete();
    } catch {
      // ignore: retried next time
    }
    await db.runAsync(`DELETE FROM outbox_attachments WHERE scan_id = ?`, id);
    await db.runAsync(`DELETE FROM outbox_scans WHERE id = ?`, id);
  }
}

/** Wipe everything (used at sign-out after the guard confirms). */
export async function clearOutbox() {
  const db = await getDb();
  await db.execAsync(`DELETE FROM outbox_attachments; DELETE FROM outbox_scans; DELETE FROM outbox_pings; DELETE FROM outbox_sos;`);
  const dir = new Directory(Paths.document, 'outbox');
  try {
    if (dir.exists) dir.delete();
  } catch {
    // ignore
  }
}
