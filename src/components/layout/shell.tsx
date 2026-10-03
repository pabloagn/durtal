"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "./sidebar";
import { CommandPalette } from "./command-palette";
import { ShortcutsProvider } from "@/components/shortcuts/shortcuts-provider";
import { Toaster } from "sonner";
import { usePreference } from "@/lib/hooks/use-preference";
import { SIDEBAR, sidebarWidth } from "@/lib/preferences";

/** Reader view: /reader/{calibreId} (numeric) — full viewport, no sidebar */
const READER_VIEW_RE = /^\/reader\/\d+/;

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isReaderView = READER_VIEW_RE.test(pathname);

  const [commandOpen, setCommandOpen] = useState(false);
  const [compact, setCompact] = useState(false);
  // A cookie, so the server renders the saved width (Settings, Display)
  const [storedWidth, setStoredWidth] = usePreference<number>(SIDEBAR.key, SIDEBAR.expanded);

  // Preserve the saved desktop width while giving small screens usable content space.
  useEffect(() => {
    const query = window.matchMedia("(max-width: 800px)");
    const update = () => setCompact(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const effectiveWidth = compact ? SIDEBAR.collapsed : sidebarWidth(storedWidth);

  // Reader view: full viewport, no sidebar
  if (isReaderView) {
    return (
      <ShortcutsProvider paletteOpen={commandOpen} onPaletteOpenChange={setCommandOpen}>
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
      </ShortcutsProvider>
    );
  }

  return (
    <ShortcutsProvider paletteOpen={commandOpen} onPaletteOpenChange={setCommandOpen}>
      <Sidebar
        width={effectiveWidth}
        onWidthChange={setStoredWidth}
        onCommandPalette={() => setCommandOpen(true)}
      />
      <main
        className="min-h-dvh transition-[margin-left] duration-200"
        style={{ marginLeft: effectiveWidth }}
      >
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
    </ShortcutsProvider>
  );
}
