"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { CapAligned } from "@/components/shared/cap-aligned";
import { captureFocusOrigin, type FocusOrigin } from "@/lib/ui/surface-state";

/** The open panels that leave the book usable (1024px and up), latest last */
const nonModal: { close: () => void }[] = [];

/** Esc from the book or the bars closes the latest such panel: focus can
 * leave a panel that is not modal, and Escape still cancels it */
export function closeLatestReaderPanel(): boolean {
  const latest = nonModal.at(-1);
  latest?.close();
  return !!latest;
}

/** One shared drawer. Native modality below 1024px; desktop keeps the book usable.
 * The settings sheet sits on the right (at the bottom on a phone) and never dims
 * the page, so a change can be judged on the text while it is made (SLN-686). */
export function ReaderSidePanel({
  open,
  title,
  onClose,
  children,
  variant = "drawer",
  side = "left",
}: {
  open: boolean;
  title: string;
  onClose(): void;
  children: ReactNode;
  variant?: "drawer" | "settings";
  /** A drawer moves to the right when what it points to sits under it (SLN-675) */
  side?: "left" | "right";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const origin = useRef<FocusOrigin | null>(null);
  const titleId = useId();
  const focusRun = useRef(0);
  const [viewportWidth, setViewportWidth] = useState<number | null>(null);
  const modal = viewportWidth === null || viewportWidth < 1024;
  const wide = viewportWidth !== null && viewportWidth >= 768;
  useEffect(() => {
    // Match the reader's viewport contract, including scrollbar boundaries.
    const update = () => setViewportWidth(window.innerWidth);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    if (!open || modal) return;
    const entry = { close: () => closeRef.current() };
    nonModal.push(entry);
    return () => {
      const at = nonModal.indexOf(entry);
      if (at >= 0) nonModal.splice(at, 1);
    };
  }, [open, modal]);
  useEffect(() => {
    const panel = ref.current;
    if (!panel || !open) return;
    // Opened from a menu, the item goes with the menu: focus then goes back
    // to the menu's button
    if (!origin.current) origin.current = captureFocusOrigin();
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
        const back = [origin.current?.target, origin.current?.menuButton]
          .find((element) => element?.isConnected);
        back?.focus({ preventScroll: true });
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
      data-reader-settings-sheet={variant === "settings" || undefined}
      data-reader-side-panel-side={variant === "drawer" && wide ? side : undefined}
      style={variant === "drawer" ? {
        top: 0,
        bottom: 0,
        left: wide && side === "right" ? "auto" : 0,
        right: wide && side === "right" ? 0 : "auto",
        margin: 0,
        height: "100dvh",
        maxHeight: "none",
        width: wide ? 360 : "100vw",
      } : wide ? {
        top: 0,
        bottom: 0,
        left: "auto",
        right: 0,
        margin: 0,
        height: "100dvh",
        maxHeight: "none",
        width: 360,
      } : {
        top: "auto",
        bottom: 0,
        left: 0,
        right: 0,
        margin: 0,
        height: "min(60dvh, 560px)",
        maxHeight: "none",
        width: "100vw",
      }}
      className={`glass-bar fixed z-40 m-0 max-h-none max-w-none overflow-hidden border-0 border-glass-border bg-transparent p-0 text-fg-primary outline-none open:flex open:flex-col ${
        variant === "drawer"
          ? `inset-y-0 h-dvh w-screen backdrop:glass-veil ${wide && side === "right" ? "left-auto right-0 border-l" : "left-0 right-auto border-r"}`
          : wide
            ? "inset-y-0 left-auto right-0 h-dvh border-l backdrop:bg-transparent"
            : "inset-x-0 bottom-0 top-auto w-screen rounded-t-md border-t pb-[env(safe-area-inset-bottom)] backdrop:bg-transparent"
      }`}
    >
      <div className="type-item-title flex shrink-0 items-start justify-between gap-4 px-4 py-4">
        <h2 id={titleId} className="type-item-title min-w-0">
          {title}
        </h2>
        <CapAligned height={28} coarseHeight={44}>
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
