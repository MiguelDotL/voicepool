import type { Account } from "../api";
import AddAccountForm from "./AddAccountForm";

interface Props {
  onAccountAdded: (account: Account) => void;
}

export default function EmptyState({ onAccountAdded }: Props) {
  return (
    <div className="flex flex-col items-center justify-center py-24 px-4">
      <div className="text-gray-500 text-5xl mb-4">~</div>
      <h2 className="text-gray-300 text-lg font-medium mb-2">
        No accounts yet
      </h2>
      <p className="text-gray-500 text-sm mb-8 max-w-md text-center">
        Add an ElevenLabs account to start monitoring usage across your fleet.
      </p>
      <div className="w-full max-w-2xl">
        <AddAccountForm onAccountAdded={onAccountAdded} />
      </div>
    </div>
  );
}
