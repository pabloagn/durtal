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
  /** Names the trigger and shows as its tooltip */
  label?: string;
  /** The 28px tier for dense rows (an edition card) */
  size?: "sm" | "md";
  /**
   * The FocusKeeper list whose focus comes here once it is empty, when the
   * menu holds that list's Add (a book's linked works)
   */
  focusEmpty?: string;
}

export function EntityActionMenu({
  items,
  align = "end",
  side = "bottom",
  label = "Actions",
  size = "md",
  focusEmpty,
}: EntityActionMenuProps) {
  const defaultItems = items.filter((i) => i.variant !== "destructive");
  const destructiveItems = items.filter((i) => i.variant === "destructive");

  const trigger = (
    <button className={size === "sm" ? "action-icon-sm" : "action-icon"} data-focus-empty={focusEmpty}>
      <MoreHorizontal className="h-4 w-4" strokeWidth={1.5} />
    </button>
  );

  return (
    <DropdownMenu trigger={trigger} label={label} align={align} side={side}>
      {defaultItems.map((item) => (
        <DropdownMenuItem
          key={item.label}
          onClick={item.onClick}
          icon={<item.icon className="h-3.5 w-3.5" strokeWidth={1.5} />}
          shortcut={item.shortcut}
        >
          {item.label}
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
              shortcut={item.shortcut}
            >
              {item.label}
            </DropdownMenuItem>
          ))}
        </>
      )}
    </DropdownMenu>
  );
}
