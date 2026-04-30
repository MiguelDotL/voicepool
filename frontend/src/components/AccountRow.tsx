import { useCallback, useEffect, useRef, useState } from "react";
import type { Account } from "../api";
import UsageBar from "./UsageBar";
import { formatCompact, formatResetCountdown, resetUrgencyClass } from "../format";

interface Props {
  account: Account;
  onDelete: (id: number) => void;
  onRename: (id: number, label: string) => void | Promise<void>;
}

export default function AccountRow({ account, onDelete, onRename }: Props) {
  const usage = account.usage;
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(account.label);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const commitRename = useCallback(async () => {
    const next = draft.trim();
    setEditing(false);
    if (!next || next === account.label) {
      setDraft(account.label);
      return;
    }
    try {
      await onRename(account.id, next);
    } catch {
      setDraft(account.label);
    }
  }, [draft, account.id, account.label, onRename]);

  const cancelRename = useCallback(() => {
    setDraft(account.label);
    setEditing(false);
  }, [account.label]);

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
    <tr className="group border-b border-cyan-300/[0.06] last:border-0 hover:bg-cyan-300/[0.02] transition-colors">
      {/* Account: hex ID + label */}
      <td className="py-3.5 px-4">
        <div className="flex items-baseline gap-2">
          <span className="text-[10px] font-mono text-cyan-300/40 tabular-nums">
            {`#${account.id.toString(16).toUpperCase().padStart(3, "0")}`}
          </span>
          {editing ? (
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => { void commitRename(); }}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); void commitRename(); }
                else if (e.key === "Escape") { e.preventDefault(); cancelRename(); }
              }}
              className="text-sm text-gray-100 font-medium bg-cyan-300/[0.08] border border-cyan-300/40 px-1 py-0 outline-none focus:border-cyan-300/70 min-w-[200px]"
            />
          ) : (
            <span
              className="text-sm text-gray-100 font-medium cursor-text"
              onDoubleClick={() => setEditing(true)}
              title="Double-click to rename"
            >
              {account.label}
            </span>
          )}
        </div>
      </td>

      {/* Usage: bar + compact characters */}
      <td className="py-3.5 px-4 min-w-[240px]">
        {usage ? (
          <div className="space-y-1.5">
            <UsageBar used={used} limit={limit} />
            <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-gray-500">
              <span className="tabular-nums">
                {formatCompact(used)} <span className="text-gray-600">/</span> {formatCompact(limit)}
              </span>
              <span className="text-cyan-300/70 tabular-nums">{pct.toFixed(0).padStart(2, "0")}%</span>
            </div>
          </div>
        ) : (
          <span className="text-gray-600 text-[10px] font-mono uppercase tracking-widest">[ NO DATA ]</span>
        )}
      </td>

      {/* Remaining */}
      <td className="py-3.5 px-4 text-xs text-gray-200 whitespace-nowrap font-mono tabular-nums uppercase">
        {usage ? formatCompact(remaining) : "—"}
      </td>

      {/* Resets — color bucketed by urgency */}
      <td
        className={`py-3.5 px-4 text-xs whitespace-nowrap font-mono tabular-nums ${
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
            className={`w-7 h-7 inline-flex items-center justify-center text-gray-500 hover:text-cyan-200 hover:bg-cyan-300/[0.06] border border-transparent hover:border-cyan-300/20 text-base leading-none transition-all ${
              menuOpen
                ? "opacity-100 bg-cyan-300/[0.06] text-cyan-200 border-cyan-300/30"
                : "opacity-0 group-hover:opacity-100 focus:opacity-100"
            }`}
            title="Node actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            ⋮
          </button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 mt-1 z-10 min-w-[160px] bg-[#0b0d11] border border-cyan-300/30 shadow-xl shadow-black/60 py-0.5"
            >
              <button
                role="menuitem"
                onClick={handleDelete}
                className="w-full text-left text-[11px] font-mono uppercase tracking-widest px-3 py-2 text-rose-300/80 hover:bg-rose-300/10 hover:text-rose-200 transition-colors"
              >
                ▸ TERMINATE NODE
              </button>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}
