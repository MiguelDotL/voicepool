interface Props {
  used: number;
  limit: number;
}

export default function UsageBar({ used, limit }: Props) {
  const remaining = limit - used;
  const pct = limit > 0 ? (used / limit) * 100 : 0;
  const remainingPct = limit > 0 ? (remaining / limit) * 100 : 0;

  let barColor: string;
  if (remainingPct > 50) {
    barColor = "bg-gradient-to-r from-teal-300/55 to-emerald-300/55";
  } else if (remainingPct > 20) {
    barColor = "bg-gradient-to-r from-amber-300/55 to-yellow-200/55";
  } else {
    barColor = "bg-gradient-to-r from-rose-300/55 to-pink-300/55";
  }

  return (
    <div className="w-full bg-white/[0.04] rounded-full h-1.5 overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-500 ease-out ${barColor}`}
        style={{ width: `${Math.min(pct, 100)}%` }}
      />
    </div>
  );
}
