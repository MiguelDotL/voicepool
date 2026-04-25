import type { Account } from "../api";
import AddAccountForm from "./AddAccountForm";

interface Props {
  onAccountAdded: (account: Account) => void;
}

export default function EmptyState({ onAccountAdded }: Props) {
  return (
    <div className="flex flex-col items-center justify-center py-24 px-4">
      <div className="relative mb-6">
        <div className="w-16 h-16 rounded-full bg-teal-300/[0.06] border border-teal-300/15 flex items-center justify-center">
          <span className="w-2.5 h-2.5 rounded-full bg-teal-300/80 shadow-[0_0_10px_rgba(94,234,212,0.4)]" />
        </div>
      </div>
      <h2 className="text-gray-200 text-lg font-medium mb-2 tracking-tight">
        No accounts yet
      </h2>
      <p className="text-gray-500 text-sm mb-8 max-w-md text-center leading-relaxed">
        Add an ElevenLabs account to start monitoring usage across your fleet.
      </p>
      <div className="w-full max-w-2xl bg-white/[0.02] border border-white/[0.05] rounded-lg p-4">
        <AddAccountForm onAccountAdded={onAccountAdded} />
      </div>
    </div>
  );
}
