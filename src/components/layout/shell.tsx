"use client";

import { useState, useEffect, useCallback } from "react";
import { Sidebar } from "./sidebar";
import { CommandPalette } from "./command-palette";
import { Toaster } from "sonner";

export function Shell({ children }: { children: React.ReactNode }) {
  const [commandOpen, setCommandOpen] = useState(false);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();
      setCommandOpen((prev) => !prev);
    }
    if (e.key === "Escape") {
      setCommandOpen(false);
    }
  }, []);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <>
      <Sidebar onCommandPalette={() => setCommandOpen(true)} />
      <main className="ml-56 min-h-dvh">
        <div className="mx-auto max-w-6xl px-6 py-6">{children}</div>
      </main>
      <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} />
      <Toaster
        position="bottom-right"
        toastOptions={{
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
    </>
  );
}
