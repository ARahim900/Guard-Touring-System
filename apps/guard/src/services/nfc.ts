// =============================================================================
// NFC tag reading.
// =============================================================================
// How checkpoint NFC tags should be prepared (one-off, by a supervisor):
//   Write the checkpoint CODE (e.g. "MB-CP-0001") onto each tag as an NDEF
//   "Text" record, using any free NFC writer app. This works on BOTH iPhone
//   and Android. As a fallback on Android, the tag's serial number (UID) can
//   be stored in the checkpoint's "NFC UID" field instead.
// NFC needs a development/production build; it does not work in Expo Go.
// =============================================================================
import { Platform } from 'react-native';
import NfcManager, { Ndef, NfcTech, type TagEvent } from 'react-native-nfc-manager';

export interface NfcRead {
  /** Text stored on the tag (the checkpoint code), if any. */
  text: string | null;
  /** Tag serial number, upper-case hex without separators (Android). */
  uid: string | null;
}

let started = false;

export async function nfcAvailability(): Promise<'ready' | 'disabled' | 'unsupported'> {
  try {
    const supported = await NfcManager.isSupported();
    if (!supported) return 'unsupported';
    if (!started) {
      await NfcManager.start();
      started = true;
    }
    // iOS has no "NFC off" switch; isEnabled is Android-only.
    if (Platform.OS === 'android' && !(await NfcManager.isEnabled())) return 'disabled';
    return 'ready';
  } catch {
    return 'unsupported';
  }
}

function readText(tag: TagEvent): string | null {
  for (const record of tag.ndefMessage ?? []) {
    try {
      // TNF 1 = "well known" type; type "T" (0x54) = Text record.
      const type = Array.isArray(record.type) ? String.fromCharCode(...record.type) : record.type;
      if (record.tnf === Ndef.TNF_WELL_KNOWN && type === 'T') {
        return Ndef.text.decodePayload(Uint8Array.from(record.payload)).trim();
      }
    } catch {
      // Unreadable record: try the next one.
    }
  }
  return null;
}

/** Wait for the guard to tap a tag. Resolves null if they cancel. */
export async function readNfcTag(): Promise<NfcRead | null> {
  try {
    await NfcManager.requestTechnology(
      Platform.OS === 'ios' ? NfcTech.Ndef : [NfcTech.Ndef, NfcTech.NfcA],
      { alertMessage: 'Hold the top of your iPhone near the checkpoint tag.' },
    );
    const tag = await NfcManager.getTag();
    if (!tag) return null;
    return {
      text: readText(tag),
      uid: tag.id ? tag.id.replace(/[^0-9a-f]/gi, '').toUpperCase() : null,
    };
  } catch {
    return null; // cancelled, timed out, or tag moved away too fast
  } finally {
    await NfcManager.cancelTechnologyRequest().catch(() => undefined);
  }
}

export async function cancelNfc() {
  await NfcManager.cancelTechnologyRequest().catch(() => undefined);
}
