"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useCallback, useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import { NAV_SECTIONS, isSectionActive } from "@/lib/navigation";
import { SECTION_ICONS } from "@/components/shortcuts/section-icons";
import { GO_TO } from "@/lib/shortcuts/shortcuts";
import { SIDEBAR } from "@/lib/preferences";
import { CapAligned } from "@/components/shared/cap-aligned";

/**
 * From md up: the fixed sidebar, resizable and collapsible (`width`).
 * Below md: a drawer over the page, opened from the phone navigation bar.
 * The collapsed styles apply from md up only, so the drawer always shows
 * labels; the server renders the right layout before `drawer` is known.
 */
export function Sidebar({
  width,
  onWidthChange,
  onCommandPalette,
  drawer,
  drawerOpen,
  onDrawerClose,
}: {
  width: number;
  onWidthChange: (width: number) => void;
  onCommandPalette: () => void;
  /** The screen is below md, so the sidebar is a drawer */
  drawer: boolean;
  drawerOpen: boolean;
  onDrawerClose: () => void;
}) {
  const pathname = usePathname();
  const isDragging = useRef(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [dragging, setDragging] = useState(false);

  const isCollapsed = width <= SIDEBAR.collapsed;
  // An icon rail: its icons need names and tooltips. The drawer shows labels.
  const rail = isCollapsed && !drawer;
  const closeOnClick = drawerOpen ? onDrawerClose : undefined;

  // Focus moves into the drawer when it opens
  useEffect(() => {
    if (drawerOpen) closeRef.current?.focus();
  }, [drawerOpen]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    isDragging.current = true;
    setDragging(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging.current) return;
      let newWidth = e.clientX;

      // Snap logic
      if (newWidth < SIDEBAR.min) {
        newWidth = SIDEBAR.collapsed;
      } else if (newWidth > SIDEBAR.max) {
        newWidth = SIDEBAR.max;
      }

      onWidthChange(newWidth);
    },
    [onWidthChange],
  );

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!isDragging.current) return;
    isDragging.current = false;
    setDragging(false);
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  }, []);

  const handleDoubleClick = useCallback(() => {
    onWidthChange(isCollapsed ? SIDEBAR.expanded : SIDEBAR.collapsed);
  }, [isCollapsed, onWidthChange]);

  // Prevent text selection while dragging
  useEffect(() => {
    if (dragging) {
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";
    } else {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    }
    return () => {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [dragging]);

  return (
    <aside
      id="app-sidebar"
      ref={sidebarRef}
      aria-label="Main navigation"
      // The drawer shows at once when it opens (so it can take focus) and
      // hides after it slides out
      className={`glass-bar fixed left-0 top-0 z-50 flex h-dvh w-64 max-w-[85vw] flex-col border-r border-glass-border md:visible md:z-40 md:w-(--sidebar-w) md:max-w-none md:translate-x-0 ${
        drawerOpen
          ? "visible translate-x-0 transition-[width,translate]"
          : "invisible -translate-x-full transition-[width,translate,visibility]"
      } ${dragging ? "transition-none" : "duration-200"}`}
      style={{ "--sidebar-w": `${width}px` } as React.CSSProperties}
    >
      {/* Logo */}
      <div className="flex h-14 shrink-0 items-center overflow-hidden px-5">
        <div className="flex w-full font-serif text-2xl tracking-tight">
          <Link
            href="/"
            onClick={closeOnClick}
            className="text-fg-primary whitespace-nowrap"
          >
            {isCollapsed ? (
              <>
                <span className="md:hidden">Durtal</span>
                <span className="hidden md:inline">D</span>
              </>
            ) : (
              "Durtal"
            )}
          </Link>
          <CapAligned height={44} className="-mr-3 ml-auto md:hidden">
            <button
              ref={closeRef}
              type="button"
              onClick={onDrawerClose}
              aria-label="Close navigation"
              data-tooltip="Close navigation"
              data-tooltip-keys="escape"
              data-tooltip-side="bottom"
              className="inline-flex h-11 w-11 items-center justify-center rounded-sm text-fg-secondary transition-colors duration-150 hover:bg-bg-tertiary/50 hover:text-fg-primary"
            >
              <X className="h-4 w-4" strokeWidth={1.5} />
            </button>
          </CapAligned>
        </div>
      </div>

      {/* Search trigger */}
      <div className="shrink-0 overflow-hidden px-3 pb-2">
        <button
          onClick={onCommandPalette}
          // Collapsed, the button is an icon: its tooltip names it
          aria-label={rail ? "Search" : undefined}
          data-tooltip={rail ? "Search" : undefined}
          data-tooltip-keys="mod k"
          data-tooltip-side="right"
          className={`flex w-full items-center gap-2 rounded-sm border border-glass-border bg-bg-primary/50 px-3 py-2.5 text-sm text-fg-secondary transition-all duration-150 hover:border-fg-muted/20 hover:text-fg-secondary focus-visible:-outline-offset-1 md:py-1.5 ${
            isCollapsed ? "md:justify-center md:gap-0 md:px-0" : ""
          }`}
        >
          <Search className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
          <span className={isCollapsed ? "md:hidden" : ""}>Search...</span>
          {/* A phone has no keyboard shortcut */}
          <kbd
            className={`ml-auto hidden font-mono text-micro text-fg-secondary ${
              isCollapsed ? "" : "md:inline"
            }`}
          >
            <span className="text-micro">&#8984;</span>K
          </kbd>
        </button>
      </div>

      {/* Navigation: it scrolls when the sections do not fit, in the drawer too */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-3 py-2">
        <ul className="space-y-0.5">
          {NAV_SECTIONS.map(({ href, label }) => {
            const Icon = SECTION_ICONS[href];
            const isActive = isSectionActive(href, pathname);
            const go = GO_TO.find((g) => g.href === href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  onClick={closeOnClick}
                  // Collapsed, the link is an icon: its tooltip names it
                  aria-label={rail ? label : undefined}
                  data-tooltip={rail ? label : undefined}
                  data-tooltip-keys={go ? `g then ${go.key}` : undefined}
                  data-tooltip-side="right"
                  className={`flex items-center gap-2.5 rounded-sm px-2.5 py-2.5 text-sm transition-all duration-150 md:py-1.5 ${
                    isCollapsed ? "md:justify-center md:gap-0 md:px-0" : ""
                  } ${
                    isActive
                      ? "bg-accent-plum/80 text-fg-primary border border-accent-rose/10"
                      : "text-fg-secondary border border-transparent hover:bg-bg-tertiary/50 hover:text-fg-primary"
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                  <span className={`truncate ${isCollapsed ? "md:hidden" : ""}`}>
                    {label}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Footer */}
      <div
        className={`shrink-0 border-t border-glass-border px-5 py-3 ${
          isCollapsed ? "md:hidden" : ""
        }`}
      >
        <p className="font-mono text-micro text-fg-secondary">
          catalogue &middot; index &middot; archive
        </p>
      </div>

      {/* Resize handle */}
      <div
        className="absolute right-0 top-0 z-50 hidden h-full w-1.5 cursor-col-resize select-none hover:bg-accent-plum/30 active:bg-accent-plum/50 transition-colors duration-150 md:block"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onDoubleClick={handleDoubleClick}
      />
    </aside>
  );
}
