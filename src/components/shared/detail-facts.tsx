import type { ReactNode } from "react";

/** Compact metadata pairs: labels keep an intrinsic rank, values keep the room. */
export function DetailFacts({ children }: { children: ReactNode }) {
  return (
    <dl className="grid grid-cols-[fit-content(min(40%,9rem))_minmax(0,1fr)] items-baseline gap-x-4 gap-y-2 text-xs leading-relaxed [overflow-wrap:anywhere] [&>dt]:text-fg-secondary [&>dd]:min-w-0 [&>dd]:text-fg-primary">
      {children}
    </dl>
  );
}
