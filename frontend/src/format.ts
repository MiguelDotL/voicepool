const numberFormatter = new Intl.NumberFormat("en-US");

export function formatNumber(n: number): string {
  return numberFormatter.format(n);
}

export function formatCompact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) {
    const v = n / 1000;
    return `${v >= 100 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, "")}K`;
  }
  const v = n / 1_000_000;
  return `${v >= 100 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, "")}M`;
}

export function formatResetCountdown(unixTimestamp: number): string {
  const now = Date.now() / 1000;
  const diff = unixTimestamp - now;

  if (diff <= 0) {
    return "RESET";
  }

  const pad = (n: number) => n.toString().padStart(2, "0");
  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  const mins = Math.floor((diff % 3600) / 60);

  if (days > 0) {
    return `${days}D ${pad(hours)}H`;
  }
  if (hours > 0) {
    return `${pad(hours)}H ${pad(mins)}M`;
  }
  return `${pad(mins)}M`;
}

// Reset is good news (credits refresh), so the column warms toward cyan as the
// reset approaches. Tuned for monthly-cadence resets.
export function resetUrgencyClass(unixTimestamp: number): string {
  const diff = unixTimestamp - Date.now() / 1000;
  if (diff < 3 * 86400) return "text-cyan-300/90"; // < 3 days — almost there
  if (diff < 7 * 86400) return "text-cyan-300/60"; // 3–7 days — getting close
  if (diff < 14 * 86400) return "text-gray-300"; // 1–2 weeks — mid-cycle
  return "text-gray-500"; // > 2 weeks — long wait
}

export function formatRelativeTime(isoOrMs: string | number): string {
  const then =
    typeof isoOrMs === "string" ? new Date(isoOrMs).getTime() : isoOrMs;
  const diff = Math.floor((Date.now() - then) / 1000);

  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
