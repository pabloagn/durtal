"use client";

import { X } from "lucide-react";
import { Toaster } from "sonner";

/**
 * The app's toasts, on every page and in the reader (SLN-567). Each toast has
 * its own small cross in its top-right corner: it dismisses that toast only,
 * and runs none of its actions. Several toasts stack, at most three in view;
 * pointing at the stack spreads it out and holds every timer.
 */
export function AppToaster() {
  return (
    <Toaster
      position="bottom-right"
      closeButton
      visibleToasts={3}
      icons={{ close: <X className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden /> }}
      toastOptions={{
        closeButtonAriaLabel: "Dismiss",
        style: {
          background: "var(--color-bg-secondary)",
          border: "1px solid var(--color-bg-tertiary)",
          color: "var(--color-fg-primary)",
          fontFamily: "var(--font-sans)",
          fontSize: "0.875rem",
          borderRadius: "var(--radius-sm)",
        },
      }}
    />
  );
}
