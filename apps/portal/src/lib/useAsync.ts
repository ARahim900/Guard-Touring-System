// Tiny data-loading hook: runs an async function, tracks loading/error, and
// gives a reload() to call after a change. Enough for an internal portal
// without adding a data-fetching library.
import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';

import { friendlyError } from './errors';

export function useAsync<T>(fn: () => Promise<T>, deps: DependencyList) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps);

  const reload = useCallback(async (opts: { silent?: boolean } = {}) => {
    const id = ++latest.current;
    if (!opts.silent) setLoading(true);
    try {
      const result = await run();
      if (id === latest.current) {
        setData(result);
        setError(null);
      }
    } catch (e) {
      if (id === latest.current) setError(friendlyError(e));
    } finally {
      if (id === latest.current) setLoading(false);
    }
  }, [run]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, loading, error, reload, setData };
}

/** Throw Supabase errors so useAsync can catch them. */
export function unwrap<T>(res: { data: T | null; error: unknown }): T {
  if (res.error) throw res.error;
  return res.data as T;
}
