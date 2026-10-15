"use client";

import { useLayoutEffect, useRef, type RefObject } from "react";

/** Focus has nowhere to be: the page, or the dialog itself */
function focusLost(field: HTMLElement): boolean {
  const active = document.activeElement;
  return !active || active === document.body || active === field.closest("dialog");
}

/** A control to go back to: not the page, nor the dialog itself (Safari's click leaves the focus there) */
function canTakeFocus(el: Element | null, field: HTMLElement): el is HTMLElement {
  return (
    el instanceof HTMLElement &&
    el.isConnected &&
    !el.matches(":disabled") &&
    el !== document.body &&
    el !== field.closest("dialog")
  );
}

/**
 * Keeps the focus in a dialog across a busy add (a pasted image URL, a new
 * collection). While `busy`, the field and its button are disabled, and a
 * disabled control drops the focus onto the page: Enter and ⌘Enter then did
 * nothing until Tab. When `busy` ends with the focus lost, it goes back to
 * the control that had it, else to `field`, ready for the next one.
 */
export function useFocusThroughBusy(busy: boolean, field: RefObject<HTMLElement | null>) {
  const had = useRef<Element | null>(null);
  const wasBusy = useRef(busy);
  useLayoutEffect(() => {
    if (busy && !wasBusy.current) had.current = document.activeElement;
    if (!busy && wasBusy.current && field.current && focusLost(field.current)) {
      const back = had.current;
      (canTakeFocus(back, field.current) && field.current.closest("dialog")?.contains(back) ? back : field.current).focus();
    }
    if (!busy) had.current = null;
    wasBusy.current = busy;
  }, [busy, field]);
}
