/** Fixed row geometry keeps the read-only graph and virtualized rows aligned. */
export function visibleHistoryRange(
  count: number,
  scrollTop: number,
  height: number,
  rowHeight: number,
  overscan = 8,
) {
  const start = Math.max(
    0,
    Math.min(count, Math.floor(scrollTop / rowHeight) - overscan),
  );
  const end = Math.min(
    count,
    Math.ceil((scrollTop + height) / rowHeight) + overscan,
  );
  return { start, end: Math.max(start, end) };
}
