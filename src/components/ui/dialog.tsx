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
      className={`dialog-enter glass m-auto w-full border-0 bg-transparent p-0 outline-none text-fg-primary backdrop:glass-veil transition-[max-width] duration-200 ease-out ${sizeClass}`}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
    >
      {/* Header. The row carries the title's type: the buttons sit on the
          title's cap-height center, also when a description follows */}
      <div className="type-section-title flex items-start justify-between border-b border-glass-border px-6 py-4">
        <div className="min-w-0 flex-1">
          <h2 className="type-section-title">{title}</h2>
          {description && (
            <p className="mt-1 text-sm text-fg-secondary">{description}</p>
          )}
        </div>
        <CapAligned height={28} className="ml-4">
          <div className="flex items-center gap-1">
            {expandable && (
              <button
                type="button"
                onClick={() => setExpanded((prev) => !prev)}
                aria-label={expanded ? "Collapse" : "Expand"}
                data-tooltip={expanded ? "Collapse" : "Expand"}
                className="block rounded-sm p-1.5 text-fg-muted transition-colors hover:bg-bg-tertiary hover:text-fg-secondary"
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
              className="block rounded-sm p-1.5 text-fg-muted transition-colors hover:bg-bg-tertiary hover:text-fg-secondary"
            >
              <X className="h-4 w-4" strokeWidth={1.5} />
            </button>
          </div>
        </CapAligned>
      </div>

      {/* Body */}
      <div className="px-6 pb-6 pt-5">{children}</div>
    </dialog>
  );
}
