/** Fetch every matching record, including when the server caps each response.
 * Reject changing result sets instead of downloading a silently incomplete CSV.
 * Callers must use a deterministic order (including a unique ID tie-breaker).
 */
export async function exportRecords<T extends { id: string }>(
  fetchPage: (offset: number, size: number) => Promise<{ rows: T[]; total: number }>,
): Promise<T[]> {
  const records: T[] = [];
  const ids = new Set<string>();
  let expected: number | undefined;
  while (true) {
    const { rows, total } = await fetchPage(records.length, 500);
    if (!Number.isSafeInteger(total) || total < 0) throw new Error('Could not determine the export size. Try again.');
    expected ??= total;
    if (total !== expected || records.length + rows.length > expected ||
      (!rows.length && records.length < expected)) {
      throw new Error('Records changed during export. Please try again.');
    }
    for (const row of rows) {
      if (ids.has(row.id)) throw new Error('Records changed during export. Please try again.');
      ids.add(row.id);
      records.push(row);
    }
    if (records.length === expected) return records;
  }
}
