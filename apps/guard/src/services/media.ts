// =============================================================================
// Photos: capture, compress, and check gallery photo dates.
// =============================================================================
// Why compress? A modern phone photo is 3–8 MB. On a weak 4G signal that
// takes minutes to upload and eats data. Resizing the longest side to
// 1600 px and saving as JPEG at 70% quality gives ~250–400 KB, still sharp
// enough to read a meter or see damage.
// =============================================================================
import * as Crypto from 'expo-crypto';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import type { DraftAttachment } from '@/offline/outbox';

const MAX_SIDE = 1600;
const QUALITY = 0.7;

async function compress(asset: ImagePicker.ImagePickerAsset): Promise<string> {
  const ctx = ImageManipulator.manipulate(asset.uri);
  const longest = Math.max(asset.width, asset.height);
  if (longest > MAX_SIDE) {
    // Give only one side; the other is scaled to keep the proportions.
    ctx.resize(asset.width >= asset.height ? { width: MAX_SIDE } : { height: MAX_SIDE });
  }
  const image = await ctx.renderAsync();
  const result = await image.saveAsync({ compress: QUALITY, format: SaveFormat.JPEG });
  return result.uri;
}

/**
 * EXIF "DateTimeOriginal" looks like "2026:10:12 21:45:03" and has no time
 * zone. Phones write it in their local time, which for our guards is Muscat
 * (+04:00).
 */
export function parseExifDate(exif: Record<string, unknown> | null | undefined): string | null {
  const raw = (exif?.DateTimeOriginal ?? exif?.DateTimeDigitized ?? exif?.DateTime) as string | undefined;
  if (!raw || typeof raw !== 'string') return null;
  const m = raw.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+04:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export async function takePhoto(): Promise<DraftAttachment | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) throw new Error('Camera access is off. Turn it on in Settings to take photos.');
  const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1, exif: false });
  if (res.canceled || !res.assets[0]) return null;
  return {
    id: Crypto.randomUUID(),
    type: 'photo',
    source: 'camera',
    uri: await compress(res.assets[0]),
    mimeType: 'image/jpeg',
    capturedAt: new Date().toISOString(),
    exifTakenAt: null,
  };
}

/**
 * Pick from the gallery. Allowed, but a photo whose EXIF date is before the
 * shift started (or has no date at all) is FLAGGED for the supervisor.
 * The server repeats this check; the flag here only informs the guard.
 */
export async function pickPhoto(shiftStartIso: string): Promise<DraftAttachment | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new Error('Photo library access is off. Turn it on in Settings.');
  const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1, exif: true });
  if (res.canceled || !res.assets[0]) return null;
  const asset = res.assets[0];
  const exifTakenAt = parseExifDate(asset.exif);
  return {
    id: Crypto.randomUUID(),
    type: 'photo',
    source: 'gallery',
    uri: await compress(asset),
    mimeType: 'image/jpeg',
    capturedAt: new Date().toISOString(),
    exifTakenAt,
    preShift: !exifTakenAt || new Date(exifTakenAt) < new Date(shiftStartIso),
  };
}
