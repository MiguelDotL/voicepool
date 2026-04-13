const numberFormatter = new Intl.NumberFormat("en-US");

export function formatNumber(n: number): string {
  return numberFormatter.format(n);
}

export function formatResetCountdown(unixTimestamp: number): string {
  const now = Date.now() / 1000;
  const diff = unixTimestamp - now;

  if (diff <= 0) {
    return "Resetting...";
  }

  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);

  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    const mins = Math.floor((diff % 3600) / 60);
    return `${hours}h ${mins}m`;
  }
  const mins = Math.floor(diff / 60);
  return `${mins}m`;
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
