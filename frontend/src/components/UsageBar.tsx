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
    barColor = "bg-emerald-500";
  } else if (remainingPct > 20) {
    barColor = "bg-yellow-500";
  } else {
    barColor = "bg-red-500";
  }

  return (
    <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-300 ${barColor}`}
        style={{ width: `${Math.min(pct, 100)}%` }}
      />
    </div>
  );
}
