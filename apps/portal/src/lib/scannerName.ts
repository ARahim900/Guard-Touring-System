// The guard holding the phone. One security login is shared, so the name is
// asked each time the app opens (session storage ends when the app is closed)
// and sent with every scan.
const key = (userId: string) => `mb-scanner-name:${userId}`;

export function readScannerName(userId: string): string | null {
  try { return sessionStorage.getItem(key(userId)); } catch { return null; }
}

export function saveScannerName(userId: string, name: string | null): void {
  try {
    if (name) sessionStorage.setItem(key(userId), name);
    else sessionStorage.removeItem(key(userId));
  } catch { /* storage blocked: the name stays in memory for this screen */ }
}
