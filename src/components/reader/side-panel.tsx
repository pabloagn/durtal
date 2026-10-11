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
  const [viewportWidth, setViewportWidth] = useState<number | null>(null);
  const modal = viewportWidth === null || viewportWidth < 1024;
  useEffect(() => {
    // Match the reader's viewport contract, including scrollbar boundaries.
    const update = () => setViewportWidth(window.innerWidth);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  useEffect(() => {
    const panel = ref.current;
    if (!panel || !open) return;
    if (!origin.current)
      origin.current = document.activeElement as HTMLElement | null;
    // Capture interaction before native close/show can move focus or scroll.
    const active = panel.ownerDocument.activeElement;
    const focused = panel.open && active instanceof HTMLElement && panel.contains(active)
      ? active : null;
    const field = focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement
      ? focused : null;
    const selection = field && field.selectionStart !== null && field.selectionEnd !== null
      ? { start: field.selectionStart, end: field.selectionEnd, direction: field.selectionDirection ?? "none" }
      : null;
    const scroll = panel.open
      ? [panel, ...panel.querySelectorAll("*")].map(element => ({
          element, top: element.scrollTop, left: element.scrollLeft,
        }))
      : [];
    if (panel.open) panel.close();
    if (modal) panel.showModal();
    else panel.show();
    if (focused?.isConnected && panel.contains(focused)) {
      focused.focus({ preventScroll: true });
      if (field && selection)
        field.setSelectionRange(selection.start, selection.end, selection.direction);
    } else {
      (
        panel.querySelector<HTMLElement>(
          '[aria-current="location"], [role="treeitem"]',
        ) ?? panel
      ).focus();
    }
    for (const { element, top, left } of scroll) {
      if (!element.isConnected || !panel.contains(element)) continue;
      element.scrollTop = top;
      element.scrollLeft = left;
    }
  }, [open, modal]);
  useEffect(() => {
    if (!open) return;
    const panel = ref.current;
    const runRef = focusRun;
    const run = ++runRef.current;
    return () => {
      // Genuine dismissal/unmount owns closing; modality changes capture first.
      if (panel?.open) panel.close();
      queueMicrotask(() => {
        if (runRef.current !== run) return;
        if (origin.current?.isConnected)
          origin.current.focus({ preventScroll: true });
        origin.current = null;
      });
    };
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
      style={{
        top: 0,
        bottom: 0,
        left: 0,
        right: "auto",
        margin: 0,
        height: "100dvh",
        maxHeight: "none",
        width: viewportWidth !== null && viewportWidth >= 768 ? 360 : "100vw",
      }}
      className="glass-bar fixed inset-y-0 left-0 right-auto z-40 m-0 h-dvh max-h-none w-screen max-w-none overflow-hidden border-0 border-r border-glass-border bg-transparent p-0 text-fg-primary outline-none backdrop:glass-veil open:flex open:flex-col"
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
