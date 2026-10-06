"use client";

import Link from "next/link";
import { forwardRef } from "react";
import { Menu, Search } from "lucide-react";
import { CapAligned } from "@/components/shared/cap-aligned";
import { TimerChip } from "@/components/reading/timer-chip";

const BUTTON =
  "inline-flex h-11 w-11 items-center justify-center rounded-sm text-fg-secondary transition-colors duration-150 hover:bg-bg-tertiary/50 hover:text-fg-primary";

/** The navigation bar below md: the sidebar opens from it as a drawer. */
export const MobileNavBar = forwardRef<
  HTMLButtonElement,
  { navOpen: boolean; onOpenNav: () => void; onSearch: () => void }
>(function MobileNavBar({ navOpen, onOpenNav, onSearch }, menuButtonRef) {
  return (
    <header
      className="glass-bar fixed inset-x-0 top-0 z-40 flex h-12 items-center border-b border-glass-border px-1 print:hidden md:hidden"
      // Behind the open drawer, the bar takes no focus
      inert={navOpen}
    >
      <div className="flex w-full font-serif text-lg tracking-tight">
        <CapAligned height={44}>
          <button
            ref={menuButtonRef}
            type="button"
            onClick={onOpenNav}
            aria-label="Open navigation"
            aria-expanded={navOpen}
            aria-controls="app-sidebar"
            data-tooltip="Open navigation"
            data-tooltip-side="bottom"
            className={BUTTON}
          >
            <Menu className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </CapAligned>
        <Link href="/" className="px-1 text-fg-primary">
          Durtal
        </Link>
        <div className="ml-auto flex">
        {/* The running timer, between the name and Search (SLN-451) */}
        <TimerChip layout="phone" />
        <CapAligned height={44}>
          <button
            type="button"
            onClick={onSearch}
            aria-label="Search"
            data-tooltip="Search"
            data-tooltip-keys="mod k"
            data-tooltip-side="bottom"
            className={BUTTON}
          >
            <Search className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </CapAligned>
        </div>
      </div>
    </header>
  );
});
