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
          className="block text-xs text-gray-400 mb-1"
        >
          API Key
        </label>
        <input
          id="account-key"
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk_..."
          disabled={submitting}
          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-gray-500 disabled:opacity-50"
        />
      </div>

      <button
        type="submit"
        disabled={submitting || !apiKey.trim()}
        className="px-4 py-2 bg-gray-700 text-gray-200 text-sm rounded hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
      >
        {submitting ? "Adding..." : "Add"}
      </button>

      {error && (
        <p className="text-red-400 text-xs ml-2 self-center whitespace-nowrap">
          {error}
        </p>
      )}
    </form>
  );
}
