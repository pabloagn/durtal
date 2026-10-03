"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "./sidebar";
import { MobileNavBar } from "./mobile-nav-bar";
import { CommandPalette } from "./command-palette";
import { Toaster } from "sonner";

const SIDEBAR_STORAGE_KEY = "durtal-sidebar-width";
const SIDEBAR_DEFAULT = 224;
const SIDEBAR_COLLAPSED = 56;
/** Tailwind `md`: the sidebar is fixed from here up and a drawer below. */
const DESKTOP_QUERY = "(min-width: 768px)";

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
  const [navOpen, setNavOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT);
  const initializedRef = useRef(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

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

  // Focus goes back to the menu button that opened the drawer
  const closeNav = useCallback(() => {
    if (!navOpen) return;
    setNavOpen(false);
    menuButtonRef.current?.focus();
  }, [navOpen]);

  const openCommandPalette = useCallback(() => {
    setNavOpen(false);
    setCommandOpen(true);
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // In reader view, only handle Cmd+K (let reader handle other keys)
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommandOpen((prev) => !prev);
      }
      if (e.key === "Escape") {
        setCommandOpen(false);
        closeNav();
      }
    },
    [closeNav],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // The drawer only exists below md: close it when the screen grows past it
  useEffect(() => {
    const desktop = window.matchMedia(DESKTOP_QUERY);
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) setNavOpen(false);
    };
    desktop.addEventListener("change", onChange);
    return () => desktop.removeEventListener("change", onChange);
  }, []);

  // The page behind the open drawer does not scroll
  useEffect(() => {
    if (!navOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [navOpen]);

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
      <MobileNavBar
        ref={menuButtonRef}
        navOpen={navOpen}
        onOpenNav={() => setNavOpen(true)}
        onSearch={openCommandPalette}
      />
      {navOpen && (
        <div
          aria-hidden="true"
          className="fixed inset-0 z-40 bg-bg-primary/70 md:hidden"
          onClick={closeNav}
        />
      )}
      <Sidebar
        width={sidebarWidth}
        onWidthChange={handleSidebarWidthChange}
        onCommandPalette={openCommandPalette}
        mobileOpen={navOpen}
        onMobileClose={closeNav}
      />
      <main
        className="min-h-dvh pt-12 transition-[margin-left] duration-200 md:ml-(--sidebar-w) md:pt-0"
        style={{ "--sidebar-w": `${sidebarWidth}px` } as React.CSSProperties}
      >
        <div className="mx-auto max-w-6xl px-4 py-6 md:px-6">{children}</div>
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
