"use client";

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
  return (
    <div className="fixed inset-0 z-50" onMouseDown={onClose}>
      <div
        role="menu"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        className="glass absolute left-1/2 top-[20%] w-80 -translate-x-1/2 overflow-hidden"
      >
        <div className="flex items-center justify-between border-b border-glass-border px-3 py-2 text-xs text-fg-secondary">
          <span className="font-medium">{title}</span>
          <span className="flex items-center gap-1.5">
            <Kbd>Esc</Kbd>
            close
          </span>
        </div>
        <ul className="p-1.5">
          {items.map((item, i) => (
            <li key={item.key}>
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                data-active={i === active || undefined}
                onMouseEnter={() => onActiveChange(i)}
                onClick={() => onPick(i)}
                className="flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-left text-sm text-fg-secondary transition-colors data-[active]:bg-selection-bg/60 data-[active]:text-fg-primary"
              >
                <item.icon className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                {/* The label and its smaller preview share one baseline */}
                <span className="flex min-w-0 flex-1 items-baseline gap-2.5">
                  <span className="shrink-0">{item.label}</span>
                  <span className="min-w-0 flex-1 truncate text-right text-xs text-fg-secondary">
                    {item.hint}
                  </span>
                </span>
                <Kbd>{item.key.toUpperCase()}</Kbd>
              </button>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-4 border-t border-glass-border px-3 py-2 text-micro text-fg-secondary">
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
