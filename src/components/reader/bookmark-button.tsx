"use client";
import { Bookmark, BookmarkCheck } from "lucide-react";
import { CapAligned } from "@/components/shared/cap-aligned";
export function BookmarkButton({
  active,
  onToggle,
  disabled,
}: {
  active: boolean;
  onToggle(): void;
  disabled?: boolean;
}) {
  const Icon = active ? BookmarkCheck : Bookmark;
  const label = active ? "Remove bookmark" : "Bookmark this page";
  return (
    <CapAligned height={32} coarseHeight={44}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        data-tooltip={label}
        data-tooltip-keys="b"
        data-tooltip-side="bottom"
        disabled={disabled}
        onClick={onToggle}
        className="block rounded-sm p-2 text-fg-secondary hover:bg-bg-tertiary/50 hover:text-fg-primary disabled:opacity-40 pointer-coarse:p-3.5"
      >
        <Icon
          className="h-4 w-4"
          strokeWidth={1.5}
          fill={active ? "currentColor" : "none"}
        />
      </button>
    </CapAligned>
  );
}
