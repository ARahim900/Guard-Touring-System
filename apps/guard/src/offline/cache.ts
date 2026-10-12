// Read-only copies of server data, kept on the phone so screens still work
// offline (e.g. the Work tab shows today's route in a basement).
// AsyncStorage is a simple key -> text store; we save JSON.
import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIX = 'mbpatrol.cache.';

export async function readCache<T>(key: string): Promise<{ value: T; savedAt: string } | null> {
  try {
    const raw = await AsyncStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as { value: T; savedAt: string }) : null;
  } catch {
    return null;
  }
}

export async function writeCache<T>(key: string, value: T): Promise<void> {
  try {
    await AsyncStorage.setItem(PREFIX + key, JSON.stringify({ value, savedAt: new Date().toISOString() }));
  } catch {
    // A failed cache write is not worth bothering the guard about.
  }
}

export async function clearCache(): Promise<void> {
  const keys = await AsyncStorage.getAllKeys();
  await AsyncStorage.multiRemove(keys.filter((k) => k.startsWith(PREFIX)));
}
