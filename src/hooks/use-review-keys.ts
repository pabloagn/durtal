"use client";

import { useEffect } from "react";
import { isTyping } from "@/lib/shortcuts/shortcuts";

export const REVIEW_KEYS = { j: "Next eBook", k: "Previous eBook", a: "Accept proposal", e: "Keep as eBook",
  x: "Set aside", n: "New book", c: "Choose a book", u: "Undo last decision", o: "Open eBook" } as const;
export type ReviewKey = keyof typeof REVIEW_KEYS;
export function reviewKeyAllowed(event: KeyboardEvent, blocked: boolean): event is KeyboardEvent & { key: ReviewKey } {
  return !blocked && !event.defaultPrevented && !event.repeat && !event.isComposing &&
    !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && !isTyping(event.target) &&
    Object.hasOwn(REVIEW_KEYS, event.key);
}
export function useReviewKeys(callback: (key: ReviewKey) => void, disabled: boolean) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const overlay = document.querySelector('dialog[open], [role="dialog"][aria-modal="true"], [role="menu"], [cmdk-root]');
      if (!reviewKeyAllowed(event, disabled || !!overlay)) return;
      event.preventDefault(); callback(event.key);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [callback, disabled]);
}
