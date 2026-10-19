import { useEffect } from 'react';
import { Button } from '@/components/ui';

export const RECORDS_PER_PAGE = 50;

/** Exact server counts keep older records reachable, including after a deletion. */
export function Pagination({ page, total, loading, onPageChange }: {
  page: number; total: number | undefined; loading: boolean; onPageChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil((total ?? 0) / RECORDS_PER_PAGE));
  useEffect(() => {
    if (!loading && total !== undefined && page >= pages) onPageChange(pages - 1);
  }, [loading, total, page, pages, onPageChange]);

  return <nav aria-label="Record pages" className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
    <p className="text-sm text-muted-foreground" role="status">
      {loading ? 'Loading records…' : total === undefined ? 'Record count unavailable' : total === 0 ? '0 records' :
        `${page * RECORDS_PER_PAGE + 1}–${Math.min((page + 1) * RECORDS_PER_PAGE, total)} of ${total} records · Page ${page + 1} of ${pages}`}
    </p>
    <div className="flex gap-2">
      <Button variant="outline" disabled={loading || page === 0} onClick={() => onPageChange(page - 1)}>Previous</Button>
      <Button variant="outline" disabled={loading || total === undefined || page + 1 >= pages} onClick={() => onPageChange(page + 1)}>Next</Button>
    </div>
  </nav>;
}
