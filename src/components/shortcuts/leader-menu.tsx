"use client";

import { useEffect, useRef } from "react";
import { CapAligned } from "@/components/shared/cap-aligned";
import type { LucideIcon } from "lucide-react";
import { Kbd } from "@/components/shortcuts/kbd";

export interface LeaderMenuItem {
  key: string;
  label: string;
  icon: LucideIcon;
  /** Muted text before the key cap: what a copy entry copies */
  hint?: string;
}

/**
 * The menu that A ("Add"), G ("Go to"), Y ("Copy") and E ("Edit") open. It stays open until a choice
 * or Esc: press an item's letter, or move with ↑ ↓ and press Enter, or click.
 * The keys are handled by ShortcutsProvider.
 */
export function LeaderMenu({
  title,
  items,
  active,
  onActiveChange,
  onPick,
  onClose,
}: {
  title: string;
  items: LeaderMenuItem[];
  active: number;
  onActiveChange: (index: number) => void;
  onPick: (index: number) => void;
  onClose: () => void;
}) {
  const activeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);
  return (
    <div className="fixed inset-0 z-50" onMouseDown={onClose}>
      <div
        role="menu"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        className="glass absolute left-1/2 top-[20%] flex max-h-[calc(80dvh-8px)] w-max min-w-[min(20rem,calc(100vw-16px))] max-w-[min(36rem,calc(100vw-16px))] -translate-x-1/2 flex-col overflow-hidden"
      >
        <div className="flex items-center shrink-0 justify-between border-b border-glass-border px-3 py-2 text-xs text-fg-secondary">
          <span className="font-medium">{title}</span>
          <span className="flex items-center gap-1.5">
            <Kbd>Esc</Kbd>
            close
          </span>
        </div>
        <ul className="min-h-0 overflow-y-auto overscroll-contain p-1.5">
          {items.map((item, i) => (
            <li key={item.key}>
              <button
                type="button"
                role="menuitem"
                ref={i === active ? activeRef : undefined}
                tabIndex={-1}
                data-active={i === active || undefined}
                onMouseEnter={() => onActiveChange(i)}
                onClick={() => onPick(i)}
                className="flex w-full items-center gap-2.5 rounded-sm px-2 py-2 pointer-coarse:min-h-11 text-left text-sm text-fg-secondary transition-colors data-[active]:bg-selection-bg/60 data-[active]:text-fg-primary"
              >
                <CapAligned height={16}>
                  <item.icon className="h-4 w-4" strokeWidth={1.5} />
                </CapAligned>
                {/* The label and its smaller preview share one baseline */}
                <span className="flex min-w-0 flex-1 items-baseline gap-2.5">
                  <span className="min-w-0 break-words">{item.label}</span>
                  <span className="min-w-0 flex-1 truncate text-right text-xs text-fg-secondary">
                    {item.hint}
                  </span>
                </span>
                <Kbd className="ml-2.5 shrink-0">{item.key.toUpperCase()}</Kbd>
              </button>
            </li>
          ))}
        </ul>
        <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-t border-glass-border px-3 py-2 text-micro text-fg-secondary">
          <span className="flex items-center gap-1.5">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            move
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>↵</Kbd>
            choose
          </span>
          <span>or press a letter</span>
        </div>
      </div>
    </div>
  );
}
