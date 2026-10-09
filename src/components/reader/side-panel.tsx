"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { CapAligned } from "@/components/shared/cap-aligned";

/** One shared drawer. Native modality below 1024px; desktop keeps the book usable. */
export function ReaderSidePanel({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose(): void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const origin = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const focusRun = useRef(0);
  const [modal, setModal] = useState(true);
  useEffect(() => {
    const query = matchMedia("(max-width: 1023px)");
    const update = () => setModal(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const panel = ref.current;
    if (!panel || !open) return;
    if (!origin.current)
      origin.current = document.activeElement as HTMLElement | null;
    if (panel.open) panel.close();
    if (modal) panel.showModal();
    else panel.show();
    (
      panel.querySelector<HTMLElement>(
        '[aria-current="location"], [role="treeitem"]',
      ) ?? panel
    ).focus();
    return () => {
      if (panel.open) panel.close();
    };
  }, [open, modal]);
  useEffect(() => {
    if (!open) return;
    const runRef = focusRun;
    const run = ++runRef.current;
    return () =>
      queueMicrotask(() => {
        if (runRef.current !== run) return;
        if (origin.current?.isConnected)
          origin.current.focus({ preventScroll: true });
        origin.current = null;
      });
  }, [open]);
  if (!open) return null;
  return (
    <dialog
      ref={ref}
      tabIndex={-1}
      aria-labelledby={titleId}
      aria-modal={modal || undefined}
      data-reader-chrome
      data-reader-side-panel
      data-reader-modal={modal || undefined}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.preventDefault();
          onClose();
        }
      }}
      className="glass-bar fixed inset-y-0 left-0 right-auto z-40 m-0 h-dvh max-h-none w-full max-w-none overflow-hidden border-0 border-r border-glass-border bg-transparent p-0 text-fg-primary outline-none backdrop:glass-veil open:flex open:flex-col md:w-[360px]"
    >
      <div className="type-item-title flex shrink-0 items-start justify-between gap-4 px-4 py-4">
        <h2 id={titleId} className="type-item-title min-w-0">
          {title}
        </h2>
        <CapAligned height={32} coarseHeight={44}>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            data-tooltip="Close"
            data-tooltip-keys="esc"
            className="action-icon-sm"
          >
            <X className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </CapAligned>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-4">
        {children}
      </div>
    </dialog>
  );
}
