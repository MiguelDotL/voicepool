interface Props {
  used: number;
  limit: number;
}

const SEGMENTS = 6;

export default function UsageBar({ used, limit }: Props) {
  const remaining = limit - used;
  const remainingPct = limit > 0 ? (remaining / limit) * 100 : 0;
  const usedPct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  const filled = Math.min(SEGMENTS, Math.round((usedPct / 100) * SEGMENTS));

  let onClass: string;
  if (remainingPct > 50) {
    onClass = "bg-cyan-300/80 shadow-[0_0_6px_rgba(103,232,249,0.5)]";
  } else if (remainingPct > 20) {
    onClass = "bg-amber-300/80 shadow-[0_0_6px_rgba(252,211,77,0.5)]";
  } else {
    onClass = "bg-rose-300/56 shadow-[0_0_6px_rgba(253,164,175,0.36)]";
  }
  const offClass = "bg-cyan-300/[0.05] border border-cyan-300/15";

  return (
    <div className="flex gap-[3px]">
      {Array.from({ length: SEGMENTS }).map((_, i) => (
        <span
          key={i}
          className={`flex-1 h-2.5 transition-colors duration-300 ${
            i < filled ? onClass : offClass
          }`}
        />
      ))}
    </div>
  );
}
