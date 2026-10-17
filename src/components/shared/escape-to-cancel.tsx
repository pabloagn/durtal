"use client";

import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { UnsavedChangesPrompt } from "@/components/ui/dialog";
import { useUnsavedGuard } from "@/components/ui/unsaved-guard";
import { hasOpenSurface, isFreeEscape } from "@/lib/ui/surface-state";

/**
 * Pages and in-page editors that take Esc, in the order they opened. The
 * last one opened takes it; one that takes only its own keys (`within`)
 * passes the others to the one before.
 */
const layers: object[] = [];
const takes = new WeakMap<object, (event: KeyboardEvent) => boolean>();

/** A page search owns Escape before this page cancellation layer (shortcuts). */
function pageSearchField(target: EventTarget | null) {
  return (
    target instanceof HTMLInputElement &&
    (target.type === "search" ||
      target.hasAttribute("data-picker") ||
      target.hasAttribute("data-shortcut-search") ||
      /^\s*(search|filter|find)\b/i.test(target.placeholder))
  );
}

/**
 * Esc cancels a form page or a step-by-step flow (Add book, Add film, a
 * publisher's editor), an editor open on a page (notes, a side panel's
 * confirmation) as its Cancel button does (SLN-631). Opened later, an
 * editor or confirmation on the page takes Esc before the page. With unsaved
 * work it asks Save, Discard or Keep editing first, and so does a Cancel
 * button with `data-dismiss` inside `root`. A dialog, menu, list or search
 * field open on the page takes Esc first. Leaving the tab with unsaved work
 * asks the browser's own question.
 *
 * Returns the question, to render with the page.
 */
export function useEscapeToCancel({
  root: given,
  cancel,
  enabled = true,
  track = false,
  dirty,
  save,
  within = false,
  searchEscCancels = false,
}: {
  /** The form or editor; none for a question with nothing to type */
  root?: RefObject<HTMLElement | null>;
  /** What Cancel does */
  cancel: () => void;
  enabled?: boolean;
  /** Watch the fields inside `root` for unsaved work */
  track?: boolean;
  /** The form's own comparison, for state its fields do not show */
  dirty?: boolean;
  /** Save for the question; by default the save button inside `root` */
  save?: (() => void) | null;
  /** Only an Esc from inside `root` (an editor among others on a page) */
  within?: boolean;
  /** A form page may treat its idle search field as part of the form. */
  searchEscCancels?: boolean;
}): ReactNode {
  const none = useRef<HTMLElement | null>(null);
  const root = given ?? none;
  const guard = useUnsavedGuard({ root, active: enabled, track, dirty, save, close: cancel });
  const latest = useRef(guard);
  useLayoutEffect(() => {
    latest.current = guard;
  });

  useEffect(() => {
    if (!enabled) return;
    const layer = {};
    layers.push(layer);
    function onKeyDown(event: KeyboardEvent) {
      if (!isFreeEscape(event) || layers.findLast((l) => takes.get(l)?.(event)) !== layer) return;
      // A dialog or a floating layer on the page closes first
      if (hasOpenSurface() || document.querySelector("dialog[open]")) return;
      if (pageSearchField(event.target) && !searchEscCancels) return;
      event.preventDefault();
      latest.current.request();
    }
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (!latest.current.unsaved()) return;
      event.preventDefault();
      event.returnValue = "";
    }
    takes.set(layer, (event) => !within || !!root.current?.contains(event.target as Node | null));
    // Bubbling: a list or a menu on the page takes its Esc first
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      layers.splice(layers.indexOf(layer), 1);
      takes.delete(layer);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [enabled, within, root, searchEscCancels]);

  return guard.prompt ? <UnsavedChangesPrompt prompt={guard.prompt} /> : null;
}
