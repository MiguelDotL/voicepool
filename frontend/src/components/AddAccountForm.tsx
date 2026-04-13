import { useState, useCallback, type FormEvent } from "react";
import { addAccount, type Account } from "../api";

interface Props {
  onAccountAdded: (account: Account) => void;
}

export default function AddAccountForm({ onAccountAdded }: Props) {
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!label.trim() || !apiKey.trim()) return;

      setError(null);
      setSubmitting(true);
      try {
        const account = await addAccount(label.trim(), apiKey.trim());
        onAccountAdded(account);
        setLabel("");
        setApiKey("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to add account");
      } finally {
        setSubmitting(false);
      }
    },
    [label, apiKey, onAccountAdded],
  );

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-3">
      <div className="flex-1 min-w-0">
        <label
          htmlFor="account-label"
          className="block text-xs text-gray-400 mb-1"
        >
          Label
        </label>
        <input
          id="account-label"
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. burner-01"
          disabled={submitting}
          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-gray-500 disabled:opacity-50"
        />
      </div>

      <div className="flex-[2] min-w-0">
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
        disabled={submitting || !label.trim() || !apiKey.trim()}
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
