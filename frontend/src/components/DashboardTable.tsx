import { useState, useMemo } from "react";
import type { Account } from "../api";
import AccountRow from "./AccountRow";

interface Props {
  accounts: Account[];
  onDelete: (id: number) => void;
  onRename: (id: number, label: string) => void | Promise<void>;
}

type SortKey = "account" | "usage" | "remaining" | "reset";
type SortDir = "asc" | "desc";

const COLUMNS: { key: SortKey | null; label: string }[] = [
  { key: "account", label: "NODE" },
  { key: "usage", label: "USAGE" },
  { key: "remaining", label: "REMAINING" },
  { key: "reset", label: "CYCLE" },
  { key: null, label: "" },
];

// Accounts without usage get sentinels that always sort to the bottom in asc
// (and to the top in desc — acceptable; they're a small minority).
function sortValue(account: Account, key: SortKey): string | number {
  const u = account.usage;
  switch (key) {
    case "account":
      return account.label.toLowerCase();
    case "usage":
      return u && u.character_limit > 0
        ? u.character_count / u.character_limit
        : Number.POSITIVE_INFINITY;
    case "remaining":
      return u ? u.character_limit - u.character_count : Number.NEGATIVE_INFINITY;
    case "reset":
      return u?.next_reset_unix ?? Number.POSITIVE_INFINITY;
  }
}

export default function DashboardTable({ accounts, onDelete, onRename }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("account");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const sorted = useMemo(() => {
    const copy = [...accounts];
    copy.sort((a, b) => {
      const va = sortValue(a, sortKey);
      const vb = sortValue(b, sortKey);
      if (va < vb) return sortDir === "asc" ? -1 : 1;
      if (va > vb) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return copy;
  }, [accounts, sortKey, sortDir]);

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-cyan-300/15 bg-cyan-300/[0.02]">
            {COLUMNS.map((col) => {
              const active = col.key !== null && col.key === sortKey;
              const arrow = active ? (sortDir === "asc" ? "▲" : "▼") : "";
              return (
                <th
                  key={col.label || "actions"}
                  className="py-2.5 px-4 text-[10px] font-mono font-medium text-gray-500 uppercase tracking-widest"
                >
                  {col.key !== null ? (
                    <button
                      onClick={() => handleSort(col.key!)}
                      className={`inline-flex items-center gap-1.5 uppercase tracking-widest hover:text-cyan-200 transition-colors ${
                        active ? "text-cyan-200" : ""
                      }`}
                    >
                      {col.label}
                      <span className={`w-2 inline-block text-[8px] ${active ? "text-cyan-300" : "text-transparent"}`}>{arrow || "·"}</span>
                    </button>
                  ) : (
                    col.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((account) => (
            <AccountRow
              key={account.id}
              account={account}
              onDelete={onDelete}
              onRename={onRename}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
