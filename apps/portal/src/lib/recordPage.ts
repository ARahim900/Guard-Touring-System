type PageResponse<T> = { data: T[] | null; count: number | null; error: unknown; status: number };

function readPage<T>(result: PageResponse<T>) {
  if (result.error) throw result.error;
  if (result.count === null || !Number.isSafeInteger(result.count) || result.count < 0) {
    throw new Error('Could not load the record count. Try again.');
  }
  return { rows: result.data ?? [], total: result.count };
}

/** Refresh counts when an update removes the last page. Supabase does not
 * expose Content-Range counts on PostgREST's 416 error responses.
 */
export async function loadRecordPage<T>(
  fetchRange: (from: number, to: number) => PromiseLike<PageResponse<T>>,
  offset: number,
  size: number,
) {
  const result = await fetchRange(offset, offset + size - 1);
  if (result.status !== 416 || offset === 0) return readPage(result);
  const firstPage = readPage(await fetchRange(0, size - 1));
  if (firstPage.total <= offset) return { rows: [], total: firstPage.total };
  // New records may have arrived while the count was being refreshed.
  return readPage(await fetchRange(offset, offset + size - 1));
}
