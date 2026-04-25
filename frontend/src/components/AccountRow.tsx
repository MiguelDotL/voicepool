import { useCallback, useEffect, useRef, useState } from "react";
import type { Account } from "../api";
import UsageBar from "./UsageBar";
import { formatCompact, formatResetCountdown, resetUrgencyClass } from "../format";

interface Props {
  account: Account;
  onDelete: (id: number) => void;
}

export default function AccountRow({ account, onDelete }: Props) {
  const usage = account.usage;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", escHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", escHandler);
    };
  }, [menuOpen]);

  const handleDelete = useCallback(() => {
    setMenuOpen(false);
    if (window.confirm(`Delete account "${account.label}"?`)) {
      onDelete(account.id);
    }
  }, [account.id, account.label, onDelete]);

  const used = usage?.character_count ?? 0;
  const limit = usage?.character_limit ?? 0;
  const remaining = limit - used;
  const pct = usage && limit > 0 ? (used / limit) * 100 : 0;

  return (
    <tr className="group border-b border-white/[0.04] last:border-0 hover:bg-white/[0.03] transition-colors">
      {/* Account */}
      <td className="py-3.5 px-4 text-sm text-gray-200 font-medium">
        {account.label}
      </td>

      {/* Usage: bar + compact characters */}
      <td className="py-3.5 px-4 min-w-[220px]">
        {usage ? (
          <div className="space-y-1.5">
            <UsageBar used={used} limit={limit} />
            <div className="flex items-center justify-between text-[11px] font-mono text-gray-500">
              <span>{formatCompact(used)} <span className="text-gray-600">/</span> {formatCompact(limit)}</span>
              <span className="text-gray-400 tabular-nums">{pct.toFixed(0)}%</span>
            </div>
          </div>
        ) : (
          <span className="text-gray-600 text-xs">No data</span>
        )}
      </td>

      {/* Remaining */}
      <td className="py-3.5 px-4 text-sm text-gray-300 whitespace-nowrap font-mono tabular-nums">
        {usage ? formatCompact(remaining) : "—"}
      </td>

      {/* Resets — color bucketed by urgency */}
      <td
        className={`py-3.5 px-4 text-sm whitespace-nowrap font-mono tabular-nums ${
          usage ? resetUrgencyClass(usage.next_reset_unix) : "text-gray-500"
        }`}
      >
        {usage ? formatResetCountdown(usage.next_reset_unix) : "—"}
      </td>

      {/* Kebab menu — hidden until row hover */}
      <td className="py-3.5 px-4 text-right">
        <div className="relative inline-block" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className={`w-7 h-7 inline-flex items-center justify-center rounded-md text-gray-500 hover:text-gray-200 hover:bg-white/[0.04] text-base leading-none transition-all ${
              menuOpen ? "opacity-100 bg-white/[0.04] text-gray-200" : "opacity-0 group-hover:opacity-100 focus:opacity-100"
            }`}
            title="Account actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            ⋮
          </button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 mt-1.5 z-10 min-w-[140px] bg-[#161821] border border-white/[0.08] rounded-md shadow-xl shadow-black/40 py-1"
            >
              <button
                role="menuitem"
                onClick={handleDelete}
                className="w-full text-left text-xs px-3 py-2 text-rose-300/90 hover:bg-rose-300/10 transition-colors"
              >
                Remove account
              </button>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}
