"use client";

import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { trackDraft, type DraftTracker } from "@/lib/ui/draft-tracker";
import { saveButtonIn } from "@/lib/shortcuts/shortcuts";

/**
 * One rule for closing anything that holds a draft (SLN-631): a dialog, a
 * form page, a step-by-step flow. With no unsaved work it closes at once.
 * With unsaved work it asks first: Save (the form's own save, with its
 * checks), Discard, or Keep editing. Esc, Close, Cancel and a click on the
 * backdrop all ask the same way.
 */
export interface UnsavedGuardOptions {
  /** The element that holds the draft; null while it is not shown */
  root: RefObject<HTMLElement | null>;
  /** The draft is shown: its fields are watched from now */
  active: boolean;
  /** Watch the fields inside `root` (see `trackDraft`) */
  track?: boolean;
  /** The form's own comparison, for state its fields do not show */
  dirty?: boolean;
  /**
   * Save, then close. Without it, the root's save button (the one ⌘Enter
   * presses); null when the form has no save to offer.
   */
  save?: (() => void) | null;
  /** What Discard does: close without saving */
  close: () => void;
}

export interface UnsavedPrompt {
  canSave: boolean;
  save(): void;
  discard(): void;
  keepEditing(): void;
}

export interface UnsavedGuard {
  /** Unsaved work would make a close ask first */
  unsaved(): boolean;
  /**
   * Close, or ask first when there is unsaved work. `discard` runs instead
   * of the close (a Cancel button's own action). True when it asked.
   */
  request(discard?: () => void): boolean;
  /** Shown while asking */
  prompt: UnsavedPrompt | null;
}

/** Cancel buttons carry this mark: a press asks first when work is unsaved */
export const DISMISS = "[data-dismiss]";

/** Danger buttons (Delete) are never a draft's save */
function saveOf(root: HTMLElement | null): HTMLButtonElement | null {
  const button = root ? saveButtonIn(root) : null;
  return button && button.dataset.variant !== "danger" ? button : null;
}

export function useUnsavedGuard({
  root,
  active,
  track = false,
  dirty = false,
  save,
  close,
}: UnsavedGuardOptions): UnsavedGuard {
  const tracker = useRef<DraftTracker | null>(null);
  const latest = useRef({ dirty, save, close });
  useLayoutEffect(() => {
    latest.current = { dirty, save, close };
  });
  const [asking, setAsking] = useState<{
    discard: () => void;
    canSave: boolean;
    focus: Element | null;
  } | null>(null);
  const askingRef = useRef(asking);

  // Watch from the moment the draft shows, before the person can act in it
  useLayoutEffect(() => {
    const element = root.current;
    if (!active || !track || !element) return;
    const watching = trackDraft(element);
    tracker.current = watching;
    return () => {
      watching.stop();
      if (tracker.current === watching) tracker.current = null;
    };
  }, [active, track, root]);

  // A draft closed from elsewhere takes its question with it
  const [wasActive, setWasActive] = useState(active);
  if (wasActive !== active) {
    setWasActive(active);
    if (!active) setAsking(null);
  }
  useLayoutEffect(() => {
    if (!active) askingRef.current = null;
  }, [active]);

  const unsaved = useCallback(
    () => latest.current.dirty || !!tracker.current?.dirty(),
    [],
  );

  const request = useCallback(
    (discard?: () => void) => {
      if (askingRef.current) return true;
      const leave = discard ?? latest.current.close;
      if (!unsaved()) {
        leave();
        return false;
      }
      const { save } = latest.current;
      const next = {
        discard: leave,
        canSave: save === undefined ? !!saveOf(root.current) : !!save,
        focus: document.activeElement,
      };
      askingRef.current = next;
      setAsking(next);
      return true;
    },
    [root, unsaved],
  );

  // A Cancel button asks first; Discard then presses it for real
  const passing = useRef(false);
  useLayoutEffect(() => {
    const element = root.current;
    if (!active || !element) return;
    function onClick(event: MouseEvent) {
      if (passing.current) return;
      const button = (event.target as Element | null)?.closest<HTMLElement>(DISMISS);
      if (!button || !element!.contains(button) || !unsaved()) return;
      event.preventDefault();
      event.stopPropagation();
      request(() => {
        passing.current = true;
        try {
          button.click();
        } finally {
          passing.current = false;
        }
      });
    }
    element.addEventListener("click", onClick, true);
    return () => element.removeEventListener("click", onClick, true);
  }, [active, root, request, unsaved]);

  // Back to the field the person was in, once the question is gone
  const refocus = (target: Element | null) =>
    setTimeout(() => {
      if (target instanceof HTMLElement && target.isConnected) target.focus({ preventScroll: true });
    }, 0);

  const prompt: UnsavedPrompt | null = asking && {
    canSave: asking.canSave,
    save() {
      askingRef.current = null;
      setAsking(null);
      refocus(asking.focus);
      // After the question closes, so the form's own checks show on the form
      setTimeout(() => {
        const { save } = latest.current;
        if (save) save();
        else saveOf(root.current)?.click();
      }, 0);
    },
    discard() {
      askingRef.current = null;
      setAsking(null);
      asking.discard();
    },
    keepEditing() {
      askingRef.current = null;
      setAsking(null);
      refocus(asking.focus);
    },
  };

  return { unsaved, request, prompt };
}
