const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "short" });

export function relativeTime(timestamp: number, now = Date.now()): string {
  const seconds = timestamp - now / 1000;
  if (!Number.isFinite(seconds) || !Number.isFinite(new Date(timestamp * 1000).getTime())) return "Unknown date";
  for (const [unit, size] of [["year", 31536000], ["month", 2592000], ["day", 86400], ["hour", 3600], ["minute", 60]] as const) {
    if (Math.abs(seconds) >= size) return relative.format(Math.trunc(seconds / size), unit);
  }
  return relative.format(Math.trunc(seconds), "second");
}
