import { useState, useEffect, useCallback, useRef } from "react";
import {
  fetchAccounts,
  deleteAccount,
  renameAccount,
  refreshAccounts,
  type Account,
} from "./api";
import { formatRelativeTime } from "./format";
import AddAccountForm from "./components/AddAccountForm";
import DashboardTable from "./components/DashboardTable";
import EmptyState from "./components/EmptyState";
import Panel from "./components/Panel";
import SignupPanel from "./components/SignupPanel";

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

  const handleRename = useCallback(async (id: number, label: string) => {
    await renameAccount(id, label);
    setAccounts((prev) => prev.map((a) => (a.id === id ? { ...a, label } : a)));
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen text-gray-400 flex items-center justify-center">
        <span className="text-gray-500 text-xs font-mono uppercase tracking-widest">
          [ initializing ]
        </span>
      </div>
    );
  }

  const hasAccounts = accounts.length > 0;
  const accountCount = accounts.length.toString().padStart(2, "0");

  return (
    <div className="min-h-screen text-gray-400">
      {/* Header */}
      <header className="border-b border-cyan-300/10 backdrop-blur supports-[backdrop-filter]:bg-[#0b0d11]/85 sticky top-0 z-20 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="hud-blink w-1.5 h-1.5 bg-cyan-300 shadow-[0_0_10px_rgba(103,232,249,0.7)]" />
          <h1 className="text-sm font-semibold text-gray-100 tracking-[0.2em] uppercase">
            VOICEPOOL
          </h1>
          <span className="text-[10px] font-mono text-cyan-300/40 uppercase tracking-wider hidden sm:inline">
            v0.1 · FLEET
          </span>
        </div>
        <div className="flex items-center gap-3 text-[11px] font-mono uppercase tracking-wider">
          <div className="flex items-center gap-2 text-gray-500">
            <span className="text-gray-600">[NODES]</span>
            <span className="text-gray-300 tabular-nums">{accountCount}</span>
          </div>
          <span className="w-px h-4 bg-cyan-300/15" />
          <span
            className="text-gray-500"
            title="Auto-refreshes every 5 minutes"
          >
            {lastRefreshed !== null
              ? `SYNC · ${relativeTime.toUpperCase()}`
              : "AUTO · 5M"}
          </span>
          <span className="w-px h-4 bg-cyan-300/15" />
          <button
            onClick={() => void handleRefresh()}
            disabled={refreshing}
            className="inline-flex items-center gap-2 px-3 py-1.5 bg-cyan-300/[0.04] hover:bg-cyan-300/10 border border-cyan-300/20 hover:border-cyan-300/40 text-cyan-200/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <span
              className={`inline-block ${refreshing ? "animate-spin" : ""}`}
              aria-hidden
            >
              ↻
            </span>
            {refreshing ? "SYNCING" : "REFRESH"}
          </button>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-6xl mx-auto px-6 py-8">
        {hasAccounts ? (
          <div className="space-y-5">
            {/* Add form */}
            <Panel label="ADD NODE">
              <AddAccountForm onAccountAdded={handleAccountAdded} />
            </Panel>

            {/* Signup assistant */}
            <SignupPanel onAccountAdded={handleAccountAdded} />

            {/* Dashboard table */}
            <Panel label="FLEET">
              <DashboardTable
                accounts={accounts}
                onDelete={handleDelete}
                onRename={handleRename}
              />
            </Panel>
          </div>
        ) : (
          <EmptyState onAccountAdded={handleAccountAdded} />
        )}
      </main>
    </div>
  );
}

export default App;
