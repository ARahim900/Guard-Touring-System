import { createStore, get, set, values } from 'idb-keyval';

export interface PatrolReceipt {
  id: string;
  userId: string;
  shiftId: string;
  checkpointId: string;
  checkpointName: string;
  code: string;
  method: 'qr' | 'barcode';
  deviceTime: string;
  latitude: number;
  longitude: number;
  accuracy: number;
  state: 'pending' | 'synced';
  validation?: 'valid' | 'flagged' | 'rejected';
  flags?: string[];
  serverTime?: string;
  error?: string;
}

const receipts = createStore('mb-patrol-web-receipts', 'receipts');
const snapshots = createStore('mb-patrol-web-shifts', 'shifts');

export async function saveReceipt(receipt: PatrolReceipt): Promise<void> {
  await set(receipt.id, receipt, receipts);
}

export async function readReceipts(userId: string): Promise<PatrolReceipt[]> {
  return (await values<PatrolReceipt>(receipts))
    .filter((receipt) => receipt.userId === userId)
    .sort((a, b) => b.deviceTime.localeCompare(a.deviceTime));
}

export async function cacheShift<T>(userId: string, snapshot: T): Promise<void> {
  await set(userId, snapshot, snapshots);
}

export async function cachedShift<T>(userId: string): Promise<T | undefined> {
  return get<T>(userId, snapshots);
}

export interface ScanVerdict {
  validation: 'valid' | 'flagged' | 'rejected';
  flags: string[];
  server_time: string;
}

// One sync per account in this tab. Retried requests use the original scan ID.
const syncing = new Map<string, Promise<void>>();
export function uploadReceipts(userId: string, send: (receipt: PatrolReceipt) => Promise<ScanVerdict>): Promise<void> {
  const existing = syncing.get(userId);
  if (existing) return existing;
  const task = (async () => {
    for (const receipt of (await readReceipts(userId)).filter((item) => item.state === 'pending').reverse()) {
      try {
        const result = await send(receipt);
        await saveReceipt({ ...receipt, state: 'synced', validation: result.validation, flags: result.flags, serverTime: result.server_time, error: undefined });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Upload failed. Reconnect and retry.';
        await saveReceipt({ ...receipt, error: message });
        throw error;
      }
    }
  })().finally(() => syncing.delete(userId));
  syncing.set(userId, task);
  return task;
}
