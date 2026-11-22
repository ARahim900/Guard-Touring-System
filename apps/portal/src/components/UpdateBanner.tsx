import { RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { isUpdateReady, onUpdateReady } from '@/lib/updateReady';

/** Offers the new app version on the patrol screens. Saved scans stay on the phone through a reload. */
export function UpdateBanner() {
  const [ready, setReady] = useState(isUpdateReady);
  useEffect(() => onUpdateReady(() => setReady(true)), []);
  if (!ready) return null;
  return (
    <div role="status" className="flex items-center gap-3 rounded-xl border border-info bg-info-bg px-4 py-3 text-info-text">
      <p className="flex-1 text-sm font-medium">A new version of the app is ready. Scans saved on this phone are kept.</p>
      <button type="button" onClick={() => window.location.reload()} className="flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-semibold underline">
        <RefreshCw className="size-4" aria-hidden="true" />Update now
      </button>
    </div>
  );
}
