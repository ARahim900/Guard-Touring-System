// =============================================================================
// Encrypted storage for the login session (GitHub issue #7).
// =============================================================================
// The login session (access + refresh token) must not sit on the phone as
// plain text. This follows Supabase's documented Expo pattern ("LargeSecureStore"):
// * the phone's secure key store (iOS Keychain / Android Keystore, through
//   expo-secure-store) holds a random AES-256 key, and
// * AsyncStorage holds the session encrypted with that key.
// Both are needed because the secure key store only takes small values (about
// 2 KB) and a session is larger. The key is made once, on the first save, and
// then reused; each save uses a new random IV (stored in front of the encrypted
// value). After the first save every save is a single AsyncStorage write, so
// the app being killed mid-save can never leave a key that does not match the
// stored session.
//
// Older app versions saved the session as plain text in AsyncStorage. The first
// read after the update moves it into the encrypted store and deletes the plain
// copy, so guards are not signed out by the update.
//
// The key can be read after the phone has been unlocked once since it was
// switched on (AFTER_FIRST_UNLOCK), so uploads from the background location
// task still work while the phone is locked in a pocket. It is never copied to
// a backup or a new phone (THIS_DEVICE_ONLY): restoring a backup means
// signing in again.
// =============================================================================
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as aesjs from 'aes-js';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const KEY_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

/** AsyncStorage key of the encrypted value (the plain key is the old, unencrypted copy). */
const encryptedKey = (key: string) => `${key}.enc`;
/** Secure store key of the AES key (letters, digits, ".", "-" and "_" only). */
const aesKeyName = (key: string) => `${key}.aes`;

// Run every operation one after another, so a read never sees a half-finished
// first save or sign-out.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

/**
 * The AES key for this storage key, made on first use. A key store that cannot
 * be read right now throws, so an existing key is never replaced by mistake.
 */
async function getOrCreateAesKey(key: string): Promise<Uint8Array> {
  const existing = await SecureStore.getItemAsync(aesKeyName(key), KEY_OPTIONS);
  if (existing) return aesjs.utils.hex.toBytes(existing);
  const aesKey = Crypto.getRandomBytes(32); // 256-bit key
  await SecureStore.setItemAsync(aesKeyName(key), aesjs.utils.hex.fromBytes(aesKey), KEY_OPTIONS);
  return aesKey;
}

async function writeEncrypted(key: string, value: string): Promise<void> {
  const aesKey = await getOrCreateAesKey(key);
  const iv = Crypto.getRandomBytes(16); // new on every save: the key is reused
  const cipher = new aesjs.ModeOfOperation.ctr(aesKey, new aesjs.Counter(iv));
  const encrypted = cipher.encrypt(aesjs.utils.utf8.toBytes(value));
  await AsyncStorage.setItem(encryptedKey(key), `${aesjs.utils.hex.fromBytes(iv)}:${aesjs.utils.hex.fromBytes(encrypted)}`);
}

async function readEncrypted(key: string, stored: string): Promise<string | null> {
  const aesKeyHex = await SecureStore.getItemAsync(aesKeyName(key), KEY_OPTIONS);
  if (!aesKeyHex) return null; // e.g. app data restored from a backup: sign in again
  const [ivHex, encrypted] = stored.split(':');
  if (!ivHex || !encrypted) return null;
  const cipher = new aesjs.ModeOfOperation.ctr(
    aesjs.utils.hex.toBytes(aesKeyHex),
    new aesjs.Counter(aesjs.utils.hex.toBytes(ivHex)),
  );
  const value = aesjs.utils.utf8.fromBytes(cipher.decrypt(aesjs.utils.hex.toBytes(encrypted)));
  // Supabase only stores JSON. Anything else means the key did not match.
  JSON.parse(value);
  return value;
}

async function getItem(key: string): Promise<string | null> {
  const encrypted = await AsyncStorage.getItem(encryptedKey(key));
  if (encrypted) {
    try {
      return await readEncrypted(key, encrypted);
    } catch {
      // Key not readable right now (phone not unlocked since restart) or does
      // not match. Report "no session" without deleting anything; Supabase
      // only deletes a stored session that it can read and finds invalid.
      return null;
    }
  }

  // One-off move of a plain-text session saved by an older app version.
  const plain = await AsyncStorage.getItem(key);
  if (!plain) return null;
  try {
    await writeEncrypted(key, plain);
    await AsyncStorage.removeItem(key);
  } catch {
    // Secure store not available right now: keep the old copy and try again
    // next time, rather than signing the guard out.
  }
  return plain;
}

async function setItem(key: string, value: string): Promise<void> {
  await writeEncrypted(key, value);
  await AsyncStorage.removeItem(key); // never leave an old plain-text copy behind
}

async function removeItem(key: string): Promise<void> {
  await AsyncStorage.multiRemove([encryptedKey(key), key]);
  await SecureStore.deleteItemAsync(aesKeyName(key), KEY_OPTIONS).catch(() => undefined);
}

/** Storage adapter for supabase-js (auth.storage). */
export const secureSessionStorage = {
  getItem: (key: string) => serial(() => getItem(key)),
  setItem: (key: string, value: string) => serial(() => setItem(key, value)),
  removeItem: (key: string) => serial(() => removeItem(key)),
};
