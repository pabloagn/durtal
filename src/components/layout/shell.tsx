"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "./sidebar";
import { CommandPalette } from "./command-palette";
import { Toaster } from "sonner";

const SIDEBAR_STORAGE_KEY = "durtal-sidebar-width";
const SIDEBAR_DEFAULT = 224;
const SIDEBAR_COLLAPSED = 56;

/** Reader view: /reader/{calibreId} (numeric) — full viewport, no sidebar */
const READER_VIEW_RE = /^\/reader\/\d+/;

function getStoredWidth(): number {
  if (typeof window === "undefined") return SIDEBAR_DEFAULT;
  const stored = localStorage.getItem(SIDEBAR_STORAGE_KEY);
  if (stored) {
    const n = parseInt(stored, 10);
    if (!isNaN(n) && (n === SIDEBAR_COLLAPSED || (n >= 120 && n <= 360)))
      return n;
  }
  return SIDEBAR_DEFAULT;
}

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isReaderView = READER_VIEW_RE.test(pathname);

  const [commandOpen, setCommandOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT);
  const initializedRef = useRef(false);

  // Hydrate from localStorage after mount
  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      setSidebarWidth(getStoredWidth());
    }
  }, []);

  const handleSidebarWidthChange = useCallback((width: number) => {
    setSidebarWidth(width);
    localStorage.setItem(SIDEBAR_STORAGE_KEY, String(width));
  }, []);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // In reader view, only handle Cmd+K (let reader handle other keys)
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

  // Reader view: full viewport, no sidebar
  if (isReaderView) {
    return (
      <>
        {children}
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

  return (
    <>
      <Sidebar
        width={sidebarWidth}
        onWidthChange={handleSidebarWidthChange}
        onCommandPalette={() => setCommandOpen(true)}
      />
      <main className="min-h-dvh transition-[margin-left] duration-200" style={{ marginLeft: sidebarWidth }}>
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
