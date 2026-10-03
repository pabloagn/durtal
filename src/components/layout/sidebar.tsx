"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useCallback, useEffect, useState } from "react";
import {
  Library,
  Building2,
  Users,
  Layers,
  MapPin,
  FolderOpen,
  Tags,
  BookOpen,
  BookOpenText,
  Settings,
  Search,
  Archive,
  Route,
  ThumbsUp,
  X,
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: BookOpen },
  { href: "/library", label: "Library", icon: Library },
  { href: "/reader", label: "Reader", icon: BookOpenText },
  { href: "/authors", label: "Authors", icon: Users },
  { href: "/publishers", label: "Publishers", icon: Building2 },
  { href: "/recommenders", label: "Recommenders", icon: ThumbsUp },
  { href: "/series", label: "Series", icon: Layers },
  { href: "/places", label: "Places", icon: MapPin },
  { href: "/provenance", label: "Provenance", icon: Route },
  { href: "/locations", label: "Locations", icon: Archive },
  { href: "/collections", label: "Collections", icon: FolderOpen },
  { href: "/taxonomy", label: "Taxonomy", icon: Tags },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

const SIDEBAR_DEFAULT = 224;
const SIDEBAR_COLLAPSED = 56;
const SIDEBAR_MIN_EXPANDED = 120;
const SIDEBAR_MAX = 360;

/**
 * From md up: the fixed sidebar, resizable and collapsible (`width`).
 * Below md: a drawer over the page, opened from the phone navigation bar.
 * Collapsed styles apply from md up only, so the drawer always shows labels.
 */
export function Sidebar({
  width,
  onWidthChange,
  onCommandPalette,
  mobileOpen,
  onMobileClose,
}: {
  width: number;
  onWidthChange: (width: number) => void;
  onCommandPalette: () => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
}) {
  const pathname = usePathname();
  const isDragging = useRef(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [dragging, setDragging] = useState(false);

  const isCollapsed = width <= SIDEBAR_COLLAPSED;

  // Move focus into the drawer when it opens
  useEffect(() => {
    if (mobileOpen) closeRef.current?.focus();
  }, [mobileOpen]);

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
      if (newWidth < SIDEBAR_MIN_EXPANDED) {
        newWidth = SIDEBAR_COLLAPSED;
      } else if (newWidth > SIDEBAR_MAX) {
        newWidth = SIDEBAR_MAX;
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
    onWidthChange(isCollapsed ? SIDEBAR_DEFAULT : SIDEBAR_COLLAPSED);
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
      className={`fixed left-0 top-0 z-50 flex h-dvh w-64 max-w-[85vw] flex-col border-r border-glass-border bg-bg-secondary/80 backdrop-blur-xl md:visible md:z-40 md:w-(--sidebar-w) md:max-w-none md:translate-x-0 ${
        mobileOpen ? "visible translate-x-0" : "invisible -translate-x-full"
      } ${!dragging ? "transition-[width,translate,visibility] duration-200" : ""}`}
      style={{ "--sidebar-w": `${width}px` } as React.CSSProperties}
    >
      {/* Logo */}
      <div className="flex h-14 shrink-0 items-center overflow-hidden px-5">
        <Link
          href="/"
          onClick={onMobileClose}
          className="font-serif text-2xl tracking-tight text-fg-primary whitespace-nowrap"
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
        <button
          ref={closeRef}
          type="button"
          onClick={onMobileClose}
          aria-label="Close navigation"
          className="-mr-3 ml-auto inline-flex h-11 w-11 items-center justify-center rounded-sm text-fg-secondary transition-colors duration-150 hover:bg-bg-tertiary/50 hover:text-fg-primary md:hidden"
        >
          <X className="h-4 w-4" strokeWidth={1.5} />
        </button>
      </div>

      {/* Search trigger */}
      <div className="shrink-0 overflow-hidden px-3 pb-2">
        <button
          onClick={onCommandPalette}
          className={`flex w-full items-center gap-2 rounded-sm border border-glass-border bg-bg-primary/50 px-3 py-1.5 text-sm text-fg-muted transition-all duration-150 hover:border-fg-muted/20 hover:text-fg-secondary ${
            isCollapsed ? "md:justify-center md:gap-0 md:px-0" : ""
          }`}
        >
          <Search className="h-3.5 w-3.5 shrink-0" />
          <span className={isCollapsed ? "md:hidden" : ""}>Search...</span>
          <kbd
            className={`ml-auto hidden font-mono text-micro text-fg-muted ${
              isCollapsed ? "" : "md:inline"
            }`}
          >
            <span className="text-nano">&#8984;</span>K
          </kbd>
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-2">
        <ul className="space-y-0.5">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const isActive =
              href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <li key={href} className="relative group">
                <Link
                  href={href}
                  onClick={onMobileClose}
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
                {/* Tooltip for collapsed mode */}
                {isCollapsed && (
                  <div className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 hidden -translate-y-1/2 rounded-sm md:block border border-glass-border bg-bg-secondary px-2.5 py-1 text-xs text-fg-primary opacity-0 shadow-lg transition-opacity duration-150 whitespace-nowrap group-hover:opacity-100">
                    {label}
                  </div>
                )}
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
        <p className="font-mono text-micro text-fg-muted">
          catalogue &middot; index &middot; archive
        </p>
      </div>

      {/* Resize handle */}
      <div
        className="absolute right-0 top-0 z-50 hidden h-full w-1.5 cursor-col-resize md:block select-none hover:bg-accent-plum/30 active:bg-accent-plum/50 transition-colors duration-150"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onDoubleClick={handleDoubleClick}
      />
    </aside>
  );
}
