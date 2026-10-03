"use client";

import { useEffect, useState } from "react";
import { isMacPlatform, keyLabel, type Keys } from "@/lib/shortcuts/shortcuts";

/** ⌘ on a Mac, Ctrl elsewhere; a Mac until the browser says otherwise */
export function useIsMac() {
  const [mac, setMac] = useState(true);
  useEffect(() => setMac(isMacPlatform()), []);
  return mac;
}

/** One key cap */
export function Kbd({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={`inline-flex h-5 min-w-5 items-center justify-center rounded-[2px] border border-glass-border bg-bg-tertiary/70 px-1 font-sans text-micro font-medium leading-none text-fg-secondary shadow-[inset_0_-1px_0_rgba(0,0,0,0.4)] ${className}`}
    >
      {children}
    </kbd>
  );
}

/** A shortcut as key caps: "⌘ K", or "G then L" for a sequence */
export function KeyCombo({ keys, then = false }: { keys: Keys; then?: boolean }) {
  const mac = useIsMac();
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      {keys.map((key, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          {then && i > 0 && <span className="text-micro text-fg-secondary">then</span>}
          <Kbd>{keyLabel(key, mac)}</Kbd>
        </span>
      ))}
    </span>
  );
}
