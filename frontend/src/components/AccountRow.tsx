import { useCallback } from "react";
import type { Account } from "../api";
import UsageBar from "./UsageBar";
import { formatNumber, formatResetCountdown } from "../format";

interface Props {
  account: Account;
  onDelete: (id: number) => void;
}

function tierBadgeClass(tier: string): string {
  switch (tier.toLowerCase()) {
    case "free":
      return "bg-gray-700 text-gray-300";
    case "starter":
      return "bg-blue-900/60 text-blue-300";
    case "creator":
      return "bg-purple-900/60 text-purple-300";
    case "pro":
      return "bg-amber-900/60 text-amber-300";
    default:
      return "bg-gray-700 text-gray-300";
  }
}

function statusBadgeClass(status: string): string {
  switch (status.toLowerCase()) {
    case "active":
      return "bg-emerald-900/60 text-emerald-300";
    case "trialing":
      return "bg-blue-900/60 text-blue-300";
    case "overdue":
    case "past_due":
      return "bg-red-900/60 text-red-300";
    default:
      return "bg-gray-700 text-gray-300";
  }
}

export default function AccountRow({ account, onDelete }: Props) {
  const usage = account.usage;

  const handleDelete = useCallback(() => {
    if (window.confirm(`Delete account "${account.label}"?`)) {
      onDelete(account.id);
    }
  }, [account.id, account.label, onDelete]);

  const used = usage?.character_count ?? 0;
  const limit = usage?.character_limit ?? 0;
  const remaining = limit - used;

  return (
    <tr className="border-b border-gray-800 hover:bg-gray-800/50 transition-colors">
      {/* Label */}
      <td className="py-3 px-4 text-sm text-gray-200 font-medium">
        {account.label}
      </td>

      {/* Tier */}
      <td className="py-3 px-4">
        {usage && (
          <span
            className={`inline-block text-xs px-2 py-0.5 rounded font-medium ${tierBadgeClass(usage.tier)}`}
          >
            {usage.tier}
          </span>
        )}
      </td>

      {/* Usage bar */}
      <td className="py-3 px-4 min-w-[160px]">
        {usage ? (
          <UsageBar used={used} limit={limit} />
        ) : (
          <span className="text-gray-500 text-xs">No data</span>
        )}
      </td>

      {/* Characters */}
      <td className="py-3 px-4 text-sm text-gray-300 whitespace-nowrap font-mono">
        {usage
          ? `${formatNumber(used)} / ${formatNumber(limit)}`
          : "--"}
      </td>

      {/* Remaining */}
      <td className="py-3 px-4 text-sm text-gray-400 whitespace-nowrap font-mono">
        {usage ? `${formatNumber(remaining)} left` : "--"}
      </td>

      {/* Reset */}
      <td className="py-3 px-4 text-sm text-gray-400 whitespace-nowrap">
        {usage ? formatResetCountdown(usage.next_reset_unix) : "--"}
      </td>

      {/* Status */}
      <td className="py-3 px-4">
        {usage && (
          <span
            className={`inline-block text-xs px-2 py-0.5 rounded font-medium ${statusBadgeClass(usage.status)}`}
          >
            {usage.status}
          </span>
        )}
      </td>

      {/* Delete */}
      <td className="py-3 px-4 text-right">
        <button
          onClick={handleDelete}
          className="text-gray-500 hover:text-red-400 text-xs transition-colors"
          title={`Delete ${account.label}`}
        >
          Delete
        </button>
      </td>
    </tr>
  );
}
