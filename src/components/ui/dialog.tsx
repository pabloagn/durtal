"use client";

import {
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { X, Maximize2, Minimize2 } from "lucide-react";

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
    if (open && !el.open) el.showModal();
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
  const sizeClass = expanded ? "max-w-5xl" : (className || "max-w-2xl");

  return (
    <dialog
      ref={dialogRef}
      className={`dialog-enter m-auto w-full rounded-md p-0 text-fg-primary border border-glass-border bg-bg-secondary shadow-[0_24px_64px_-12px_rgba(0,0,0,0.7),0_0_0_1px_rgba(125,61,82,0.08)] backdrop:bg-black/60 backdrop:backdrop-blur-lg transition-[max-width] duration-200 ease-out ${sizeClass}`}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-glass-border px-6 py-4">
        <div className="min-w-0 flex-1">
          <h2 className="font-serif text-2xl leading-tight text-fg-primary">
            {title}
          </h2>
          {description && (
            <p className="mt-1 text-sm text-fg-secondary">{description}</p>
          )}
        </div>
        <div className="flex flex-shrink-0 items-center gap-1 ml-4">
          {expandable && (
            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              title={expanded ? "Collapse" : "Expand"}
              className="rounded-sm p-1.5 text-fg-muted transition-colors hover:bg-bg-tertiary hover:text-fg-secondary"
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
            className="rounded-sm p-1.5 text-fg-muted transition-colors hover:bg-bg-tertiary hover:text-fg-secondary"
          >
            <X className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="px-6 pb-6 pt-5">{children}</div>
    </dialog>
  );
}
