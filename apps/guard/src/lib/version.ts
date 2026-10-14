// Compare dotted version numbers such as "1.0.9" and "1.0.10" part by part
// (as numbers, so 10 is newer than 9). Missing parts count as 0 ("1.1" = "1.1.0").
import * as Application from 'expo-application';
import Constants from 'expo-constants';

function parts(version: string): number[] | null {
  const trimmed = version.trim();
  if (!/^\d+(\.\d+)*$/.test(trimmed)) return null;
  return trimmed.split('.').map(Number);
}

/** True only when both versions are readable and `candidate` is newer than `installed`. */
export function isNewerVersion(candidate: string | null | undefined, installed: string | null | undefined): boolean {
  if (!candidate || !installed) return false;
  const a = parts(candidate);
  const b = parts(installed);
  if (!a || !b) return false;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

/** Version of the app installed on this phone (an EAS Update does not change it). */
export function installedAppVersion(): string | null {
  return Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? null;
}
