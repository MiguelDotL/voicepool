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
    <form onSubmit={handleSubmit} className="flex items-end gap-3">
      <div className="flex-1 min-w-0">
        <label
          htmlFor="account-key"
          className="block text-[11px] uppercase tracking-wider text-gray-500 mb-1.5"
        >
          ElevenLabs API Key
        </label>
        <input
          id="account-key"
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk_..."
          disabled={submitting}
          className="w-full bg-white/[0.02] border border-white/[0.08] rounded-md px-3 py-2 text-sm text-gray-300 placeholder-gray-600 font-mono focus:outline-none focus:border-teal-300/30 focus:ring-1 focus:ring-teal-300/15 disabled:opacity-50 transition-colors"
        />
      </div>

      <button
        type="submit"
        disabled={submitting || !apiKey.trim()}
        className="px-4 py-2 bg-teal-300/10 hover:bg-teal-300/15 border border-teal-300/20 text-teal-200/90 text-sm font-medium rounded-md disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
      >
        {submitting ? "Adding…" : "Add Account"}
      </button>

      {error && (
        <p className="text-red-400 text-xs ml-2 self-center whitespace-nowrap">
          {error}
        </p>
      )}
    </form>
  );
}
