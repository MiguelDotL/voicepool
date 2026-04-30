import { useState, useCallback, type FormEvent } from "react";
import { addAccount, type Account } from "../api";

interface Props {
  onAccountAdded: (account: Account) => void;
}

export default function AddAccountForm({ onAccountAdded }: Props) {
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!apiKey.trim()) return;

      setError(null);
      setSubmitting(true);
      try {
        const account = await addAccount(apiKey.trim());
        onAccountAdded(account);
        setApiKey("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to add account");
      } finally {
        setSubmitting(false);
      }
    },
    [apiKey, onAccountAdded],
  );

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-3 p-4">
      <div className="flex-1 min-w-0">
        <label
          htmlFor="account-key"
          className="block text-[10px] font-mono uppercase tracking-widest text-cyan-300/50 mb-2"
        >
          ▸ EXISTING ELEVENLABS API KEY
        </label>
        <input
          id="account-key"
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk_••••••••••••"
          disabled={submitting}
          className="w-full bg-[#0b0d11] border border-cyan-300/15 px-3 py-2 text-sm text-gray-200 placeholder-gray-700 font-mono focus:outline-none focus:border-cyan-300/50 focus:ring-1 focus:ring-cyan-300/20 disabled:opacity-50 transition-colors"
        />
      </div>

      <button
        type="submit"
        disabled={submitting || !apiKey.trim()}
        className="group relative px-5 py-2 bg-cyan-300/[0.06] hover:bg-cyan-300/[0.12] border border-cyan-300/30 hover:border-cyan-300/60 text-cyan-100 text-xs font-mono font-medium uppercase tracking-widest disabled:opacity-30 disabled:cursor-not-allowed transition-all whitespace-nowrap"
      >
        {submitting ? "› ATTACHING" : "› ATTACH"}
      </button>

      {error && (
        <p className="text-rose-300/80 text-[11px] font-mono uppercase tracking-wider ml-2 self-center whitespace-nowrap">
          ✕ {error}
        </p>
      )}
    </form>
  );
}
