"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "./sidebar";
import { MobileNavBar } from "./mobile-nav-bar";
import { CommandPalette } from "./command-palette";
import { ShortcutsProvider } from "@/components/shortcuts/shortcuts-provider";
import { ReadingDialogsProvider } from "@/components/reading/reading-dialogs-provider";
import { Toaster } from "sonner";
import { usePreference } from "@/lib/hooks/use-preference";
import { SIDEBAR, sidebarWidth } from "@/lib/preferences";
import { lockPageScroll } from "@/lib/utils/scroll-lock";

/** Reader view: /reader/{calibreId} (numeric) — full viewport, no sidebar */
const READER_VIEW_RE = /^\/reader\/\d+/;

/** Below Tailwind `md` the sidebar is a drawer, opened from the phone navigation bar. */
const PHONE_QUERY = "(max-width: 767.98px)";

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isReaderView = READER_VIEW_RE.test(pathname);

  const [commandOpen, setCommandOpen] = useState(false);
  const [compact, setCompact] = useState(false);
  const [phone, setPhone] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef(false);
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

  // The drawer exists below md only: it closes when the screen grows past md
  useEffect(() => {
    const query = window.matchMedia(PHONE_QUERY);
    const update = () => {
      setPhone(query.matches);
      if (!query.matches) setNavOpen(false);
    };
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  // A link in the drawer closes it
  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  // Escape and the backdrop close the drawer and give focus back to the menu button
  const closeNav = useCallback(() => {
    restoreFocusRef.current = true;
    setNavOpen(false);
  }, []);

  const openCommandPalette = useCallback(() => {
    setNavOpen(false);
    setCommandOpen(true);
  }, []);

  // While the drawer is open: Escape closes it and the page behind it does not scroll
  // (the lock goes on html, which scrolls the page; the position stays).
  // The menu button is inert until the drawer closes, so it takes focus after that.
  useEffect(() => {
    if (!navOpen) {
      if (restoreFocusRef.current) menuButtonRef.current?.focus();
      restoreFocusRef.current = false;
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeNav();
    };
    const releaseScroll = lockPageScroll(document.documentElement);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      releaseScroll();
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [navOpen, closeNav]);

  // Reader view: full viewport, no sidebar
  if (isReaderView) {
    return (
      <ShortcutsProvider paletteOpen={commandOpen} onPaletteOpenChange={setCommandOpen}>
        <ReadingDialogsProvider>
          {children}
          <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} />
        </ReadingDialogsProvider>
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
      {/* Reading dialogs from any page: the palette, the hub, the dashboard (SLN-448) */}
      <ReadingDialogsProvider>
        <MobileNavBar
          ref={menuButtonRef}
          navOpen={navOpen}
          onOpenNav={() => setNavOpen(true)}
          onSearch={openCommandPalette}
        />
        {navOpen && (
          <div
            aria-hidden="true"
            className="glass-veil fixed inset-0 z-40 md:hidden"
            onClick={closeNav}
          />
        )}
        <Sidebar
          width={effectiveWidth}
          onWidthChange={setStoredWidth}
          onCommandPalette={openCommandPalette}
          drawer={phone}
          drawerOpen={navOpen}
          onDrawerClose={closeNav}
        />
        <main
          // Below md the page takes the full width, under the phone navigation bar
          className="min-h-dvh pt-12 transition-[margin-left] duration-200 md:ml-(--sidebar-w) md:pt-0"
          style={{ "--sidebar-w": `${effectiveWidth}px` } as React.CSSProperties}
          inert={navOpen}
        >
          <div className="mx-auto max-w-6xl px-4 py-6 md:px-6">{children}</div>
        </main>
        <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} />
      </ReadingDialogsProvider>
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
