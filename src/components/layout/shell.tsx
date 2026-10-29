"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "./sidebar";
import { MobileNavBar } from "./mobile-nav-bar";
import { CommandPalette } from "./command-palette";
import { ShortcutsProvider } from "@/components/shortcuts/shortcuts-provider";
import { ReadingDialogsProvider } from "@/components/reading/reading-dialogs-provider";
import { TimerProvider } from "@/components/reading/timer-provider";
import { TimerAlerts } from "@/components/reading/timer-chip";
import { AppToaster } from "./app-toaster";
import { useSidebarPreference } from "@/lib/hooks/use-sidebar-preference";
import { lockPageScroll } from "@/lib/utils/scroll-lock";
import { acquireSurface, hasOpenSurface, type SurfaceLease } from "@/lib/ui/surface-state";

/** Reader view: /reader/{ebookId}, full viewport, no sidebar (the reading view, eBooks sub-issue 3) */
const READER_VIEW_RE = /^\/reader\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\/|$)/i;

/** Below Tailwind `md` the sidebar is a drawer, opened from the phone navigation bar. */
const PHONE_QUERY = "(max-width: 767.98px)";

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isReaderView = READER_VIEW_RE.test(pathname);

  const [commandOpen, setCommandOpen] = useState(false);
  const [phone, setPhone] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef(false);
  const { width: effectiveWidth, desktopWidth, compactWidth, setWidth, toggle } = useSidebarPreference();
  const [widthMotionReady, setWidthMotionReady] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setWidthMotionReady(true));
    return () => cancelAnimationFrame(frame);
  }, []);

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

  // However the palette closes (Esc, a pick, the backdrop), focus goes back
  // to what had it when the palette opened (SLN-477). The opener is read
  // before the palette renders: its field takes focus as it mounts
  const paletteOpener = useRef<HTMLElement | null>(null);
  const paletteLease = useRef<SurfaceLease | null>(null);
  const changePalette = useCallback((next: boolean) => {
    if (next) {
      const el = document.activeElement;
      paletteOpener.current = el instanceof HTMLElement && el !== document.body ? el : null;
      paletteLease.current ??= acquireSurface(() => {
        paletteLease.current?.release();
        paletteLease.current = null;
        setCommandOpen(false);
      });
    } else {
      paletteLease.current?.release();
      paletteLease.current = null;
    }
    setCommandOpen(next);
  }, []);
  useEffect(() => {
    if (commandOpen) return;
    const opener = paletteOpener.current;
    paletteOpener.current = null;
    if (!opener) return;
    // After the palette is gone; a pick that opened a dialog keeps the focus
    const frame = requestAnimationFrame(() => {
      const active = document.activeElement;
      if (!hasOpenSurface() && opener.isConnected && (!active || active === document.body))
        opener.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [commandOpen]);
  useEffect(() => () => { paletteLease.current?.release(); }, []);

  const openCommandPalette = useCallback(() => {
    setNavOpen(false);
    changePalette(true);
  }, [changePalette]);

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
      // Marked handled: the Escape closes the drawer only, not a selection behind it (SLN-531)
      if (e.key === "Escape") {
        e.preventDefault();
        closeNav();
      }
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
      <ShortcutsProvider paletteOpen={commandOpen} onPaletteOpenChange={changePalette}>
        <TimerProvider>
          <ReadingDialogsProvider>
            {children}
            <CommandPalette open={commandOpen} onOpenChange={changePalette} />
            <TimerAlerts />
          </ReadingDialogsProvider>
        </TimerProvider>
        <AppToaster />
      </ShortcutsProvider>
    );
  }

  return (
    <ShortcutsProvider paletteOpen={commandOpen} onPaletteOpenChange={changePalette}>
      {/* Reading dialogs from any page: the palette, the hub, the dashboard (SLN-448); the timer (SLN-451) */}
      <TimerProvider>
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
          desktopWidth={desktopWidth}
          compactWidth={compactWidth}
          widthMotionReady={widthMotionReady}
          onWidthChange={setWidth}
          onToggle={toggle}
          onCommandPalette={openCommandPalette}
          drawer={phone}
          drawerOpen={navOpen}
          onDrawerClose={closeNav}
        />
        <main
          // Below md the page takes the full width, under the phone navigation bar
          className={`sidebar-responsive-width min-h-dvh pt-12 ${widthMotionReady ? "transition-[margin-left] duration-200" : ""} md:ml-(--sidebar-w) md:pt-0 print:ml-0 print:min-h-0 print:pt-0 print:transition-none`}
          style={{ "--sidebar-w-desktop": `${desktopWidth}px`, "--sidebar-w-compact": `${compactWidth}px` } as React.CSSProperties}
          inert={navOpen}
        >
          <div className="mx-auto max-w-6xl px-4 py-6 md:px-6 print:max-w-none print:p-0">{children}</div>
        </main>
        <CommandPalette open={commandOpen} onOpenChange={changePalette} />
        <TimerAlerts />
      </ReadingDialogsProvider>
      </TimerProvider>
      <AppToaster />
    </ShortcutsProvider>
  );
}
