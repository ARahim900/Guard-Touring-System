// Holds the scan between the scanner screen and the report screen.
// A plain module variable is enough: only one scan is in progress at a time,
// and it avoids squeezing objects through URL parameters.
import type { ScanMethod } from '@/lib/types';
import type { Fix } from './location';

export interface ScanDraft {
  scanId: string;
  shiftId: string;
  shiftStart: string;
  checkpoint: { id: string; name: string; latitude: number; longitude: number; radius_m: number };
  method: ScanMethod;
  rawValue: string;
  deviceTime: string;
  fix: Fix | null;
}

let current: ScanDraft | null = null;

export const setScanDraft = (d: ScanDraft) => {
  current = d;
};
export const getScanDraft = () => current;
export const clearScanDraft = () => {
  current = null;
};
