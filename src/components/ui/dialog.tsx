"use client";

import {
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { X, Maximize2, Minimize2 } from "lucide-react";
import { CapAligned } from "@/components/shared/cap-aligned";

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
}

const FIRST_FIELD =
  'input:not([type="hidden"],[type="checkbox"],[type="radio"],[type="file"],[type="range"],[type="color"],[type="button"],[type="submit"]):not(:disabled), textarea:not(:disabled), [contenteditable="true"]';

/**
 * Where focus goes back to when a dialog closes. A dialog opened from a menu
 * item opens after the menu is gone, with focus already on the page body, so
 * the last focused element and the button of the menu that held it are kept
 * here as they happen.
 */
interface FocusOrigin {
  target: HTMLElement;
  menuButton: HTMLElement | null;
}

let lastFocus: FocusOrigin | null = null;

function originOf(target: HTMLElement): FocusOrigin {
  const menu = target.closest('[role="menu"]');
  return {
    target,
    menuButton:
      menu?.parentElement?.querySelector<HTMLElement>('[aria-haspopup="menu"]') ?? null,
  };
}

if (typeof document !== "undefined") {
  document.addEventListener("focusin", (event) => {
    if (event.target instanceof HTMLElement) lastFocus = originOf(event.target);
  });
}

function focusOrigin(): FocusOrigin | null {
  const active = document.activeElement;
  if (active instanceof HTMLElement && active !== document.body) {
    return lastFocus?.target === active ? lastFocus : originOf(active);
  }
  // Focus fell to the body because its element left the page (a menu item).
  // An element still on the page lost focus on purpose: leave it alone.
  return lastFocus && !lastFocus.target.isConnected ? lastFocus : null;
}

/** The control that opened the dialog, else its menu's button, else nothing. */
function returnFocus(origin: FocusOrigin | null) {
  for (const el of [origin?.target, origin?.menuButton]) {
    if (el?.isConnected) {
      el.focus();
      return;
    }
  }
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  className = "",
  expandable = true,
}: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [expanded, setExpanded] = useState(false);

  const handleClose = useCallback(() => onClose(), [onClose]);

  // Runs before the effect below moves focus into the dialog. However the
  // dialog closes (Esc, Cancel, Close, a confirm, or the page unmounting it),
  // focus goes back to the control that opened it. React's development
  // re-run cleans up and runs again at once: the trigger is kept from the
  // first run, and the cleanup that a re-run follows does nothing.
  const origin = useRef<FocusOrigin | null | undefined>(undefined);
  const openRuns = useRef(0);
  useEffect(() => {
    if (!open) return;
    const run = ++openRuns.current;
    if (origin.current === undefined) origin.current = focusOrigin();
    return () => {
      queueMicrotask(() => {
        if (openRuns.current !== run) return;
        const target = origin.current;
        origin.current = undefined;
        returnFocus(target ?? null);
      });
    };
  }, [open]);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      // The browser focuses the header's first button; start in the first
      // field instead, so typing (and Enter to confirm) works at once. With
      // no field, the dialog itself takes the focus.
      (el.querySelector<HTMLElement>(FIRST_FIELD) ?? el).focus();
    }
    if (!open && el.open) el.close();
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
    <dialog
      ref={dialogRef}
      tabIndex={-1}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className={`dialog-enter glass m-auto w-full overflow-hidden border-0 bg-transparent p-0 outline-none open:flex open:flex-col text-fg-primary backdrop:glass-veil transition-[max-width] duration-200 ease-out ${sizeClass}`}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
    >
      {/* Header. The row carries the title's type: the buttons sit on the
          title's cap-height center, also when a description follows */}
      <div className="type-dialog-title flex shrink-0 items-start justify-between px-6 pb-3 pt-5">
        <div className="min-w-0 flex-1">
          <h2 className="type-dialog-title">{title}</h2>
          {description && (
            <p className="mt-1 text-sm text-fg-secondary">{description}</p>
          )}
        </div>
        {/* 44px targets on touch */}
        <CapAligned height={28} coarseHeight={44} className="ml-4">
          <div className="flex items-center gap-1">
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
              onClick={onClose}
              aria-label={`Close ${title}`}
              data-tooltip="Close"
              data-tooltip-keys="esc"
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
      <div className="min-h-0 flex-auto overflow-y-auto px-6 pb-6 pt-3">
        {children}
      </div>
    </dialog>
  );
}
