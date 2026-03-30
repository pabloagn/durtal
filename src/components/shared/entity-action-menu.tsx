"use client";

import { type LucideIcon, MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

export interface EntityActionItem {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  variant?: "default" | "destructive";
  shortcut?: string;
}

interface EntityActionMenuProps {
  items: EntityActionItem[];
  align?: "start" | "center" | "end";
  side?: "top" | "bottom";
}

export function EntityActionMenu({
  items,
  align = "end",
  side = "bottom",
}: EntityActionMenuProps) {
  const defaultItems = items.filter((i) => i.variant !== "destructive");
  const destructiveItems = items.filter((i) => i.variant === "destructive");

  const trigger = (
    <button
      aria-label="Open action menu"
      className="flex h-8 w-8 items-center justify-center rounded-[2px] border border-glass-border bg-bg-tertiary/50 text-fg-muted transition-colors hover:bg-bg-tertiary hover:text-fg-primary focus:outline-none"
    >
      <MoreHorizontal className="h-4 w-4" strokeWidth={1.5} />
    </button>
  );

  return (
    <DropdownMenu trigger={trigger} align={align} side={side}>
      {defaultItems.map((item) => (
        <DropdownMenuItem
          key={item.label}
          onClick={item.onClick}
          icon={<item.icon className="h-3.5 w-3.5" strokeWidth={1.5} />}
        >
          <span className="flex-1">{item.label}</span>
          {item.shortcut && (
            <span className="ml-4 font-mono text-[10px] text-fg-muted">
              {item.shortcut}
            </span>
          )}
        </DropdownMenuItem>
      ))}

      {destructiveItems.length > 0 && (
        <>
          {defaultItems.length > 0 && <DropdownMenuSeparator />}
          {destructiveItems.map((item) => (
            <DropdownMenuItem
              key={item.label}
              onClick={item.onClick}
              variant="danger"
              icon={<item.icon className="h-3.5 w-3.5" strokeWidth={1.5} />}
            >
              <span className="flex-1">{item.label}</span>
              {item.shortcut && (
                <span className="ml-4 font-mono text-[10px] text-accent-red/60">
                  {item.shortcut}
                </span>
              )}
            </DropdownMenuItem>
          ))}
        </>
      )}
    </DropdownMenu>
  );
}
