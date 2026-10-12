"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * A clear layer under an open menu or lookup that closes it on the first tap
 * outside. The book's frame keeps its own taps from the page, so the layer
 * covers it. The layer stays until that tap's click has landed on it: removed
 * on touch down, the click would fall through and press the button beneath.
 * Portalled to the body, since a glass bar would contain a fixed child.
 */
export function OutsideTapBackdrop({
  open,
  onClose,
  kind,
}: {
  open: boolean;
  onClose(): void;
  /** Names the layer for checks: data-reader-menu-backdrop or data-reader-lookup-backdrop */
  kind: "menu" | "lookup";
}) {
  const [shield, setShield] = useState(false);
  useEffect(() => {
    if (!shield) return;
    // A drag or a long press brings no click
    const timer = setTimeout(() => setShield(false), 700);
    return () => clearTimeout(timer);
  }, [shield]);
  if (!open && !shield) return null;
  return createPortal(
    <div
      aria-hidden
      {...{ [`data-reader-${kind}-backdrop`]: "" }}
      className="fixed inset-0 z-40"
      onPointerDown={() => {
        if (!open) return;
        setShield(true);
        onClose();
      }}
      onClick={() => setShield(false)}
    />,
    document.body,
  );
}
