"use client";
import { Bookmark, BookmarkCheck } from "lucide-react";
import { ReaderBarItem } from "./reader-bar-item";
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
  return (
    <ReaderBarItem
      label={active ? "Remove bookmark" : "Bookmark this page"}
      keys="b"
      pressed={active}
      disabled={disabled}
      onSelect={onToggle}
      icon={
        <Icon
          className="h-4 w-4"
          strokeWidth={1.5}
          fill={active ? "currentColor" : "none"}
        />
      }
    />
  );
}
