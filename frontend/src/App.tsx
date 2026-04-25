import { useState, useEffect, useCallback, useRef } from "react";
import {
  fetchAccounts,
  deleteAccount,
  refreshAccounts,
  type Account,
} from "./api";
import { formatRelativeTime } from "./format";
import AddAccountForm from "./components/AddAccountForm";
import DashboardTable from "./components/DashboardTable";
import EmptyState from "./components/EmptyState";

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

function App() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<number | null>(null);
  const [relativeTime, setRelativeTime] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // --- Load accounts on mount ---
  const loadAccounts = useCallback(async () => {
    try {
      const data = await fetchAccounts();
      setAccounts(data);
    } catch {
      // Silently fail on initial load — empty state will show
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  // --- Refresh handler ---
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const result = await refreshAccounts();
      setAccounts(result.accounts);
      setLastRefreshed(Date.now());
    } catch {
      // Refresh failed — keep existing data
    } finally {
      setRefreshing(false);
    }
  }, []);

  // --- Auto-refresh polling ---
  useEffect(() => {
    pollRef.current = setInterval(() => {
      void handleRefresh();
    }, POLL_INTERVAL_MS);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [handleRefresh]);

  // --- Tick the "last refreshed" display every 15s ---
  useEffect(() => {
    if (lastRefreshed === null) return;

    const tick = () => setRelativeTime(formatRelativeTime(lastRefreshed));
    tick();
    const id = setInterval(tick, 15_000);
    return () => clearInterval(id);
  }, [lastRefreshed]);

  // --- Add account callback ---
  const handleAccountAdded = useCallback((account: Account) => {
    setAccounts((prev) => {
      // Prevent duplicates if a refresh landed between the POST and this update
      if (prev.some((a) => a.id === account.id)) return prev;
      return [...prev, account];
    });
  }, []);

  // --- Delete account callback ---
  const handleDelete = useCallback(async (id: number) => {
    try {
      await deleteAccount(id);
      setAccounts((prev) => prev.filter((a) => a.id !== id));
    } catch {
      // Failed to delete — keep in list
    }
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0e1014] text-gray-400 flex items-center justify-center">
        <span className="text-gray-500 text-sm">Loading...</span>
      </div>
    );
  }

  const hasAccounts = accounts.length > 0;

  return (
    <div className="min-h-screen bg-[#0e1014] text-gray-400">
      {/* Header */}
      <header className="border-b border-white/[0.05] backdrop-blur supports-[backdrop-filter]:bg-[#0e1014]/80 sticky top-0 z-20 px-6 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="w-2 h-2 rounded-full bg-teal-300/70 shadow-[0_0_8px_rgba(94,234,212,0.3)]" />
          <h1 className="text-base font-semibold text-gray-200 tracking-tight">
            voicepool
          </h1>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-gray-500" title="Auto-refreshes every 5 minutes">
            {lastRefreshed !== null ? `Updated ${relativeTime}` : "Auto-refresh: 5m"}
          </span>
          <span className="w-px h-4 bg-white/[0.08]" />
          <button
            onClick={() => void handleRefresh()}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.08] text-gray-300 rounded-md disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <span
              className={`w-3 h-3 inline-block ${refreshing ? "animate-spin" : ""}`}
              aria-hidden
            >
              ↻
            </span>
            {refreshing ? "Refreshing" : "Refresh"}
          </button>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-6xl mx-auto px-6 py-8">
        {hasAccounts ? (
          <div className="space-y-5">
            {/* Add form — compact when accounts exist */}
            <div className="bg-white/[0.02] border border-white/[0.05] rounded-lg p-4">
              <AddAccountForm onAccountAdded={handleAccountAdded} />
            </div>

            {/* Dashboard table */}
            <div className="bg-white/[0.02] border border-white/[0.05] rounded-lg overflow-hidden">
              <DashboardTable
                accounts={accounts}
                onDelete={handleDelete}
              />
            </div>
          </div>
        ) : (
          <EmptyState onAccountAdded={handleAccountAdded} />
        )}
      </main>
    </div>
  );
}

export default App;
