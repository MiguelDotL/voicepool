import type { Account } from "../api";
import AddAccountForm from "./AddAccountForm";
import SignupPanel from "./SignupPanel";

interface Props {
  onAccountAdded: (account: Account) => void;
}

export default function EmptyState({ onAccountAdded }: Props) {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-4">
      <div className="relative mb-8">
        <div className="w-20 h-20 border border-cyan-300/30 flex items-center justify-center relative">
          <span className="absolute -top-px -left-px w-2.5 h-2.5 border-t border-l border-cyan-300/80" />
          <span className="absolute -top-px -right-px w-2.5 h-2.5 border-t border-r border-cyan-300/80" />
          <span className="absolute -bottom-px -left-px w-2.5 h-2.5 border-b border-l border-cyan-300/80" />
          <span className="absolute -bottom-px -right-px w-2.5 h-2.5 border-b border-r border-cyan-300/80" />
          <span className="hud-blink w-2 h-2 bg-cyan-300 shadow-[0_0_12px_rgba(103,232,249,0.7)]" />
        </div>
      </div>
      <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-cyan-300/40 mb-3">
        ▸ FLEET STATUS · IDLE
      </p>
      <h2 className="text-gray-100 text-lg font-semibold mb-2 tracking-wide uppercase">
        No nodes online
      </h2>
      <p className="text-gray-500 text-sm mb-8 max-w-md text-center leading-relaxed">
        Deploy an ElevenLabs API key to bring a node online and begin telemetry.
      </p>
      <div className="w-full max-w-2xl space-y-4">
        <div className="relative">
          <span className="absolute -top-px -left-px w-2.5 h-2.5 border-t border-l border-cyan-300/40" />
          <span className="absolute -top-px -right-px w-2.5 h-2.5 border-t border-r border-cyan-300/40" />
          <span className="absolute -bottom-px -left-px w-2.5 h-2.5 border-b border-l border-cyan-300/40" />
          <span className="absolute -bottom-px -right-px w-2.5 h-2.5 border-b border-r border-cyan-300/40" />
          <div className="bg-white/[0.015] border border-cyan-300/10">
            <AddAccountForm onAccountAdded={onAccountAdded} />
          </div>
        </div>
        <SignupPanel onAccountAdded={onAccountAdded} />
      </div>
    </div>
  );
}
