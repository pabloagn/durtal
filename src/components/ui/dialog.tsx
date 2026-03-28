"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  className = "",
}: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    const handleClose = () => onClose();
    el.addEventListener("close", handleClose);
    return () => el.removeEventListener("close", handleClose);
  }, [onClose]);

  return (
    <dialog
      ref={dialogRef}
      className={`m-auto w-full max-w-lg rounded-sm p-0 text-fg-primary glass-surface shadow-[0_24px_48px_-12px_rgba(0,0,0,0.5)] backdrop:bg-bg-primary/70 backdrop:backdrop-blur-md ${className}`}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
    >
      <div className="flex items-center justify-between border-b border-glass-border px-5 py-3.5">
        <div>
          <h2 className="font-serif text-xl text-fg-primary">{title}</h2>
          {description && (
            <p className="mt-0.5 text-xs text-fg-secondary">{description}</p>
          )}
        </div>
        <button
          onClick={onClose}
          className="rounded-sm p-1 text-fg-muted transition-colors hover:bg-bg-tertiary/50 hover:text-fg-secondary"
        >
          <X className="h-4 w-4" strokeWidth={1.5} />
        </button>
      </div>
      <div className="p-5">{children}</div>
    </dialog>
  );
}
