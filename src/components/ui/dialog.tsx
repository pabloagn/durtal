"use client";

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useId,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { X, Maximize2, Minimize2 } from "lucide-react";
import { CapAligned } from "@/components/shared/cap-aligned";
import { acquireSurface, captureFocusOrigin, restoreFocusOrigin, type FocusOrigin, type SurfaceLease } from "@/lib/ui/surface-state";
import { DialogFocusScope, useDialogFocusScope } from "./dialog-focus-scope";
import { Button } from "./button";
import { useUnsavedGuard, type UnsavedPrompt } from "./unsaved-guard";
import { shortcutProps } from "@/lib/shortcuts/shortcuts";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  /** Tailwind max-width class override. Defaults to "max-w-2xl". */
  className?: string;
  /** Show the expand/collapse toggle. Defaults to true. */
  expandable?: boolean;
  /**
   * The dialog holds a draft: a close (Esc, Close, Cancel, the backdrop)
   * with unsaved changes in its fields asks Save, Discard or Keep editing
   * first. Cancel buttons take `data-dismiss` to ask the same way.
   */
  draft?: boolean;
  /** Unsaved work the fields do not show (picked chips, a list in state) */
  dirty?: boolean;
  /** Save for the question; by default the dialog's save button */
  onSave?: () => void;
  /**
   * A dialog with nothing to save (a viewer, a manager whose every change
   * saves at once) shows a Done button under its body: its main action, so
   * Enter closes it as Esc does (SLN-634).
   */
  done?: boolean;
}

const FIRST_FIELD =
  'input:not([type="hidden"],[type="checkbox"],[type="radio"],[type="file"],[type="range"],[type="color"],[type="button"],[type="submit"]):not(:disabled), textarea:not(:disabled), [contenteditable="true"]';

/** Anything in a dialog's body a person can work with, field or not */
const CONTROL =
  'input:not([type="hidden"]), select, textarea, button, a[href], [contenteditable="true"], [tabindex]:not([tabindex="-1"])';

/**
 * The control a dialog marks to start in (`data-autofocus`), itself or the
 * first control inside it: the first goal under the year, the first date of
 * a past read under its lists (SLN-1094)
 */
function markedStart(el: HTMLElement): HTMLElement | null {
  const mark = el.querySelector<HTMLElement>("[data-autofocus]");
  return mark && (mark.matches(CONTROL) ? mark : mark.querySelector<HTMLElement>(CONTROL));
}

/**
 * The row under a dialog's body that holds its Cancel and Save. Undefined
 * outside a dialog; null until the dialog's row is in the page.
 */
const FooterSlot = createContext<{ slot: HTMLElement | null; shown: (on: boolean) => void } | undefined>(undefined);

/**
 * `outside` for a form that is a page of its own (Add film, Add publisher):
 * the row is a bar pinned to the bottom of the screen while the fields
 * scroll under it, so Save is always in view, as in a dialog (SLN-943). On a
 * phone it runs edge to edge. The form's own spacing sets it off the fields.
 */
export const PINNED_PAGE_FOOTER =
  "pinned-page-footer glass-bar sticky bottom-0 z-10 -mx-4 border-t border-glass-border px-4 py-3 pb-[max(--spacing(3),env(safe-area-inset-bottom))] md:mx-0 md:px-0";

/**
 * A form's Cancel, Save and notice. In a dialog they sit in a row under the
 * scrolling body, always in view, as the dialog's own Done does: the fields
 * scroll, not the footer, and nothing else in the dialog scrolls. Outside a
 * dialog (a form on a page) the row follows the fields. A submit button in
 * the row names its form (`form`), since the row is not inside it.
 */
export function DialogFooter({
  children,
  outside = "mt-5 border-t border-glass-border pt-4",
}: {
  children: ReactNode;
  /** The row's own spacing and rule on a page, where it follows the fields */
  outside?: string;
}) {
  const footer = useContext(FooterSlot);
  const shown = footer?.shown;
  useLayoutEffect(() => {
    if (!shown) return;
    shown(true);
    return () => shown(false);
  }, [shown]);
  const row = <div className="flex flex-wrap items-center justify-end gap-2">{children}</div>;
  if (!footer) return <div className={outside}>{row}</div>;
  return footer.slot ? createPortal(row, footer.slot) : null;
}

/**
 * Where focus goes back to when a dialog closes. A dialog opened from a menu
 * item opens after the menu is gone, with focus already on the page body, so
 * the last focused element and the button of the menu that held it are kept
 * here as they happen.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  className = "",
  expandable = true,
  draft = false,
  dirty,
  onSave,
  done = false,
}: DialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [footerSlot, setFooterSlot] = useState<HTMLDivElement | null>(null);
  const [footers, setFooters] = useState(0);
  const footerShown = useCallback((on: boolean) => setFooters((n) => n + (on ? 1 : -1)), []);
  const scope = useDialogFocusScope();
  const ownLease = useRef<SurfaceLease | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const handleClose = useCallback(() => onClose(), [onClose]);

  const guarded = draft || dirty !== undefined;
  const guard = useUnsavedGuard({
    root: dialogRef,
    active: open && guarded,
    track: draft,
    dirty,
    save: onSave,
    close: onClose,
  });
  const requestClose = () => {
    if (guarded) guard.request();
    else onClose();
  };

  // Runs before the effect below moves focus into the dialog. However the
  // dialog closes (Esc, Cancel, Close, a confirm, or the page unmounting it),
  // focus goes back to the control that opened it. React's development
  // re-run cleans up and runs again at once: the trigger is kept from the
  // first run, and the cleanup that a re-run follows does nothing.
  const origin = useRef<FocusOrigin | null | undefined>(undefined);
  const openRuns = useRef(0);
  useLayoutEffect(() => {
    if (!open || scope) return;
    const run = ++openRuns.current;
    if (origin.current === undefined) origin.current = captureFocusOrigin();
    const lease = acquireSurface(() => closeRef.current());
    ownLease.current = lease;
    return () => {
      lease.release();
      queueMicrotask(() => {
        if (openRuns.current !== run) return;
        const target = origin.current;
        origin.current = undefined;
        restoreFocusOrigin(target ?? null);
      });
    };
  }, [open, scope]);

  // Esc reaches the dialog through its surface: unsaved work asks first
  const unsaved = guard.unsaved, request = guard.request;
  useLayoutEffect(() => {
    const lease = scope ?? ownLease.current;
    if (!open || !guarded || !lease) return;
    return lease.guard(() => unsaved() && request());
  }, [open, guarded, scope, unsaved, request]);

  useLayoutEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      // The browser focuses the header's first button; start in the first
      // field instead, so typing (and Enter to confirm) works at once. With
      // no field, the dialog itself takes the focus.
      (markedStart(el) ?? el.querySelector<HTMLElement>(FIRST_FIELD) ?? el).focus();
    }
    if (!open && el.open) el.close();
  }, [open]);

  // A dialog that loads its fields after it opens (Edit person) starts in
  // the first field once they arrive, unless focus has moved on by then.
  // Only when that field comes first: a dialog that opened with other
  // controls above a late field (Log a past read's lists above its Review
  // editor) stays at its top, as it opened
  useEffect(() => {
    const el = dialogRef.current;
    const body = bodyRef.current;
    if (!open || !el || !body || markedStart(el) || el.querySelector(FIRST_FIELD)) return;
    if (body.querySelector(CONTROL)) return;
    const observer = new MutationObserver(() => {
      if (document.activeElement !== el) {
        if (el.contains(document.activeElement)) observer.disconnect();
        return;
      }
      const first = body.querySelector<HTMLElement>(CONTROL);
      if (!first) return;
      observer.disconnect();
      const marked = markedStart(el);
      if (marked) marked.focus();
      else if (first.matches(FIRST_FIELD)) first.focus();
    });
    observer.observe(el, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [open]);

  // Reset expanded state when dialog closes
  useEffect(() => {
    if (!open) setExpanded(false);
  }, [open]);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    el.addEventListener("close", handleClose);
    return () => el.removeEventListener("close", handleClose);
  }, [handleClose]);

  if (!open) return null;

  // When expanded, override width to max-w-5xl
  const sizeClass = expanded ? "max-w-5xl" : className || "max-w-2xl";

  return (
    <>
    <dialog
      ref={dialogRef}
      tabIndex={-1}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        if ((scope ?? ownLease.current)?.isTop()) requestClose();
      }}
      className={`dialog-enter glass m-auto w-full overflow-hidden border-0 bg-transparent p-0 outline-none open:flex open:flex-col text-fg-primary backdrop:glass-veil transition-[max-width] duration-200 ease-out ${sizeClass}`}
      onClick={(e) => {
        if (e.target === dialogRef.current) requestClose();
      }}
    >
      {/* Header. The row carries the title's type: the buttons sit on the
          title's cap-height center, also when a description follows */}
      <div className="type-dialog-title flex shrink-0 items-start justify-between px-6 pb-3 pt-5">
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="type-dialog-title">{title}</h2>
          {description && (
            <p id={descriptionId} className="mt-1 text-sm text-fg-secondary">{description}</p>
          )}
        </div>
        {/* 44px targets on touch */}
        <CapAligned height={28} coarseHeight={44} className="ml-4">
          <div className="flex items-center gap-1 pointer-coarse:gap-2">
            {expandable && (
              <button
                type="button"
                onClick={() => setExpanded((prev) => !prev)}
                aria-label={expanded ? "Collapse" : "Expand"}
                data-tooltip={expanded ? "Collapse" : "Expand"}
                className="action-icon-sm"
              >
                {expanded ? (
                  <Minimize2 className="h-4 w-4" strokeWidth={1.5} />
                ) : (
                  <Maximize2 className="h-4 w-4" strokeWidth={1.5} />
                )}
              </button>
            )}
            <button
              type="button"
              onClick={requestClose}
              aria-label={`Close ${title}`}
              data-tooltip="Close"
              {...shortcutProps("esc")}
              className="action-icon-sm"
            >
              <X className="h-4 w-4" strokeWidth={1.5} />
            </button>
          </div>
        </CapAligned>
      </div>

      {/* Body. It scrolls, not the dialog: the glass stays behind every
          line, and the header stays in view. It grows from its content
          (flex-auto): from a zero basis, Safari gives it no height */}
      <div ref={bodyRef} className={`min-h-0 flex-auto overflow-y-auto px-6 pt-3 ${done || footers > 0 ? "pb-4" : "pb-6"}`}>
        <FooterSlot.Provider value={{ slot: footerSlot, shown: footerShown }}>{children}</FooterSlot.Provider>
      </div>
      {/* A form's Cancel and Save (DialogFooter): outside the scrolling body */}
      <div ref={setFooterSlot} className="shrink-0 border-t border-glass-border px-6 py-4 empty:hidden" />
      {/* Outside the scrolling body, so it stays in view */}
      {done && (
        <div className="flex shrink-0 justify-end border-t border-glass-border px-6 py-4">
          <Button type="button" variant="primary" onClick={requestClose}>
            Done
          </Button>
        </div>
      )}
    </dialog>
    {guard.prompt && <UnsavedChangesPrompt prompt={guard.prompt} />}
    </>
  );
}

/**
 * The question before unsaved work is closed. Keep editing receives focus;
 * the reader must choose Save or Discard deliberately. Esc keeps editing, with the
 * draft and the focus as they were. It is its own layer: Enter and Esc here
 * never reach the form or the page under it.
 */
export function UnsavedChangesPrompt({ prompt }: { prompt: UnsavedPrompt }) {
  const main = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    main.current?.focus();
  }, []);
  return (
    // Its own surface, also inside a dialog that shares its parent's
    <DialogFocusScope.Provider value={null}>
      <Dialog
        open
        onClose={prompt.keepEditing}
        title="Unsaved changes"
        description={
          prompt.question ??
          (prompt.canSave
            ? "Save your changes before closing?"
            : "Your changes have not been saved. Discard them?")
        }
        className="max-w-sm"
        expandable={false}
      >
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" ref={main} variant="ghost" className="mr-auto" onClick={prompt.keepEditing}>
            Keep editing
          </Button>
          <Button
            type="button"
            variant={prompt.canSave ? "secondary" : "primary"}
            onClick={prompt.discard}
          >
            Discard
          </Button>
          {prompt.canSave && (
            <Button type="button" variant="primary" onClick={prompt.save}>
              Save
            </Button>
          )}
        </div>
      </Dialog>
    </DialogFocusScope.Provider>
  );
}
