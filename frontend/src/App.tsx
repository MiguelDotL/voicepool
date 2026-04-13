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
      <div className="min-h-screen bg-gray-950 text-gray-300 flex items-center justify-center">
        <span className="text-gray-500 text-sm">Loading...</span>
      </div>
    );
  }

  const hasAccounts = accounts.length > 0;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-300">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-100 tracking-tight">
          voicepool
        </h1>
        <div className="flex items-center gap-4">
          {lastRefreshed !== null && (
            <span className="text-xs text-gray-500">
              Refreshed {relativeTime}
            </span>
          )}
          <span className="text-xs text-gray-600">
            auto-refresh: 5m
          </span>
          <button
            onClick={() => void handleRefresh()}
            disabled={refreshing}
            className="px-3 py-1.5 text-xs bg-gray-800 text-gray-300 rounded hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {refreshing ? "Refreshing..." : "Refresh All"}
          </button>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-6xl mx-auto px-6 py-6">
        {hasAccounts ? (
          <div className="space-y-6">
            {/* Add form — compact when accounts exist */}
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
              <AddAccountForm onAccountAdded={handleAccountAdded} />
            </div>

            {/* Dashboard table */}
            <div className="bg-gray-900 border border-gray-800 rounded-lg">
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
