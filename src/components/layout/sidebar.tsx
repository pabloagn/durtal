"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useCallback, useEffect, useState } from "react";
import { Search } from "lucide-react";
import { NAV_SECTIONS, isSectionActive } from "@/lib/navigation";
import { SECTION_ICONS } from "@/components/shortcuts/section-icons";
import { GO_TO } from "@/lib/shortcuts/shortcuts";
import { SIDEBAR } from "@/lib/preferences";

export function Sidebar({
  width,
  onWidthChange,
  onCommandPalette,
}: {
  width: number;
  onWidthChange: (width: number) => void;
  onCommandPalette: () => void;
}) {
  const pathname = usePathname();
  const isDragging = useRef(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const [dragging, setDragging] = useState(false);

  const isCollapsed = width <= SIDEBAR.collapsed;

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
      ref={sidebarRef}
      className={`fixed left-0 top-0 z-40 flex h-dvh flex-col border-r border-glass-border bg-bg-secondary/80 backdrop-blur-xl ${
        !dragging ? "transition-[width] duration-200" : ""
      }`}
      style={{ width }}
    >
      {/* Logo */}
      <div className="flex h-14 shrink-0 items-center overflow-hidden px-5">
        <Link
          href="/"
          className="font-serif text-2xl tracking-tight text-fg-primary whitespace-nowrap"
        >
          {isCollapsed ? "D" : "Durtal"}
        </Link>
      </div>

      {/* Search trigger */}
      <div className="shrink-0 overflow-hidden px-3 pb-2">
        <button
          onClick={onCommandPalette}
          // Collapsed, the button is an icon: its tooltip names it
          aria-label={isCollapsed ? "Search" : undefined}
          data-tooltip={isCollapsed ? "Search" : undefined}
          data-tooltip-keys="mod k"
          data-tooltip-side="right"
          className={`flex w-full items-center rounded-sm border border-glass-border bg-bg-primary/50 text-sm text-fg-secondary transition-all duration-150 hover:border-fg-muted/20 hover:text-fg-secondary focus-visible:-outline-offset-1 ${
            isCollapsed ? "justify-center px-0 py-1.5" : "gap-2 px-3 py-1.5"
          }`}
        >
          <Search className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
          {!isCollapsed && (
            <>
              <span>Search...</span>
              <kbd className="ml-auto font-mono text-micro text-fg-secondary">
                <span className="text-micro">&#8984;</span>K
              </kbd>
            </>
          )}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-2">
        <ul className="space-y-0.5">
          {NAV_SECTIONS.map(({ href, label }) => {
            const Icon = SECTION_ICONS[href];
            const isActive = isSectionActive(href, pathname);
            const go = GO_TO.find((g) => g.href === href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  // Collapsed, the link is an icon: its tooltip names it
                  aria-label={isCollapsed ? label : undefined}
                  data-tooltip={isCollapsed ? label : undefined}
                  data-tooltip-keys={go ? `g then ${go.key}` : undefined}
                  data-tooltip-side="right"
                  className={`flex items-center rounded-sm text-sm transition-all duration-150 ${
                    isCollapsed
                      ? "justify-center px-0 py-1.5"
                      : "gap-2.5 px-2.5 py-1.5"
                  } ${
                    isActive
                      ? "bg-accent-plum/80 text-fg-primary border border-accent-rose/10"
                      : "text-fg-secondary border border-transparent hover:bg-bg-tertiary/50 hover:text-fg-primary"
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                  {!isCollapsed && <span className="truncate">{label}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Footer */}
      {!isCollapsed && (
        <div className="shrink-0 border-t border-glass-border px-5 py-3">
          <p className="font-mono text-micro text-fg-secondary">
            catalogue &middot; index &middot; archive
          </p>
        </div>
      )}

      {/* Resize handle */}
      <div
        className="absolute right-0 top-0 z-50 h-full w-1.5 cursor-col-resize select-none hover:bg-accent-plum/30 active:bg-accent-plum/50 transition-colors duration-150"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onDoubleClick={handleDoubleClick}
      />
    </aside>
  );
}
