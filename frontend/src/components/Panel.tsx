import type { ReactNode } from "react";

interface Props {
  label: string;
  children: ReactNode;
}

// HUD-style container with corner crosshair marks and a small label tab.
export default function Panel({ label, children }: Props) {
  return (
    <div className="relative">
      <span className="absolute -top-px -left-px w-2.5 h-2.5 border-t border-l border-cyan-300/40" />
      <span className="absolute -top-px -right-px w-2.5 h-2.5 border-t border-r border-cyan-300/40" />
      <span className="absolute -bottom-px -left-px w-2.5 h-2.5 border-b border-l border-cyan-300/40" />
      <span className="absolute -bottom-px -right-px w-2.5 h-2.5 border-b border-r border-cyan-300/40" />
      <span className="absolute -top-2 left-3 px-1.5 text-[10px] font-mono uppercase tracking-widest text-cyan-300/60 bg-[#0b0d11]">
        ▸ {label}
      </span>
      <div className="bg-white/[0.015] border border-cyan-300/10">
        {children}
      </div>
    </div>
  );
}
