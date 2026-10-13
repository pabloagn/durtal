"use client";
import { useLayoutEffect, useId, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { CapAligned } from "@/components/shared/cap-aligned";
import { lookupPopoverPosition, type LookupRect } from "@/lib/reader/lookup/placement";

/** Shared collision-aware surface for notes and lookup; only the body scrolls. */
export function AnchoredReaderPopover({
  title,
  anchor,
  keyboard,
  reference,
  children,
  onClose,
  action,
  variant = "note",
  fixedContent,
  dialogLabel,
  closeLabel = "Close",
  avoid,
  initialFocusSelector,
  keyDocument,
  preferBelow = false,
}: {
  title: string;
  anchor: { left: number; right: number; top: number; bottom: number } | null;
  keyboard: boolean;
  reference?: HTMLElement;
  children: ReactNode;
  action?: ReactNode;
  onClose(reason?: "escape" | "outside" | "button"): void;
  variant?: "note" | "lookup";
  fixedContent?: ReactNode;
  dialogLabel?: string;
  closeLabel?: string;
  avoid?: LookupRect | null;
  initialFocusSelector?: string;
  /** A nonmodal lookup keeps gesture focus in the book's document. */
  keyDocument?: Document;
  preferBelow?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const close = useRef(onClose);
  const geometry = useRef({ anchor, avoid, preferBelow });
  const reposition = useRef<() => void>(() => {});
  const [position, setPosition] = useState<{
    left: number;
    top: number;
    width?: number;
    maxHeight?: number;
    minHeight?: number;
  } | null>(null);
  useLayoutEffect(() => {
    close.current = onClose;
  }, [onClose]);
  useLayoutEffect(() => {
    geometry.current = { anchor, avoid, preferBelow };
    reposition.current();
  }, [anchor?.left, anchor?.right, anchor?.top, anchor?.bottom,
    avoid?.left, avoid?.right, avoid?.top, avoid?.bottom, preferBelow]);
  useLayoutEffect(() => {
    const popup = ref.current;
    if (!popup) return;
    const position = () => {
      const { anchor, avoid, preferBelow } = geometry.current;
      if (variant === "lookup") {
        const height = Math.min(popup.scrollHeight, window.innerWidth < 768 ? window.innerHeight / 2 : Math.min(440, window.innerHeight * .6));
        setPosition(lookupPopoverPosition(anchor, avoid ?? null,
          { width: window.innerWidth, height: window.innerHeight }, height, preferBelow));
        return;
      }
      if (window.innerWidth < 768) {
        setPosition(null);
        return;
      }
      const height = popup.getBoundingClientRect().height;
      const width = Math.min(420, window.innerWidth - 32);
      const below = (anchor?.bottom ?? window.innerHeight / 2) + 8;
      const above = (anchor?.top ?? below) - height - 8;
      setPosition({
        left: Math.max(
          16,
          Math.min(
            window.innerWidth - width - 16,
            anchor?.left ?? (window.innerWidth - width) / 2,
          ),
        ),
        top: Math.max(
          16,
          Math.min(
            window.innerHeight - height - 16,
            below + height <= window.innerHeight - 16 ? below : above,
          ),
        ),
      });
    };
    popup.showPopover();
    reposition.current = position;
    position();
    const resize = new ResizeObserver(position);
    resize.observe(popup);
    window.addEventListener("resize", position);
    if (keyboard)
      popup
        .querySelector<HTMLElement>(initialFocusSelector ?? "[data-reader-popover-body]")
        ?.focus({ preventScroll: true });
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented && !event.isComposing) {
        // An expanded language select owns its first Escape.
        if (variant === "lookup" && popup.querySelector('[role="combobox"][aria-expanded="true"]')) return;
        event.preventDefault();
        event.stopPropagation();
        close.current("escape");
      }
    };
    const docs = new Set(
      [document, reference?.ownerDocument, keyDocument].filter(
        (doc): doc is Document => !!doc,
      ),
    );
    for (const doc of docs) doc.addEventListener("keydown", escape, true);
    return () => {
      resize.disconnect();
      reposition.current = () => {};
      window.removeEventListener("resize", position);
      for (const doc of docs) doc.removeEventListener("keydown", escape, true);
      popup.hidePopover();
      if (variant === "note" && reference?.isConnected) reference.focus({ preventScroll: true });
    };
  }, [keyboard, reference, variant, initialFocusSelector, keyDocument]);
  return (
    <div
      ref={ref}
      popover="auto"
      role="dialog"
      aria-modal={false}
      aria-labelledby={dialogLabel ? undefined : titleId}
      aria-label={dialogLabel}
      data-reader-chrome
      data-reader-widget
      data-reader-anchored-popover
      onToggle={(event) => {
        if ((event.nativeEvent as ToggleEvent).newState === "closed")
          close.current("outside");
      }}
      style={position ? { ...position, bottom: variant === "lookup" ? "auto" : undefined } : undefined}
      className={variant === "lookup"
        ? "glass fixed inset-auto z-50 m-0 flex max-h-[min(440px,60vh)] w-[380px] max-w-[calc(100vw-32px)] flex-col overflow-hidden border border-glass-border p-0 text-fg-primary"
        : "glass fixed inset-x-0 bottom-0 top-auto z-50 m-0 flex max-h-[60dvh] w-full flex-col overflow-hidden border border-glass-border p-0 text-fg-primary md:inset-auto md:max-h-[min(50dvh,360px)] md:w-[420px] md:max-w-[calc(100vw-32px)]"}
    >
      <div className="glass-bar relative type-item-title flex shrink-0 items-start justify-between gap-2 border-b border-glass-border px-4 py-3">
        <h2 id={titleId} className={variant === "lookup" ? "lines-1 min-w-0 flex-1" : undefined}>{title}</h2>
        <CapAligned height={32} coarseHeight={44}>
          <div className="flex items-center gap-2">
            {action}
            <button
              type="button"
              aria-label={closeLabel}
              data-tooltip="Close"
              data-tooltip-keys="esc"
              className="action-icon-sm"
              onClick={() => onClose("button")}
            >
              <X className="h-4 w-4" strokeWidth={1.5} />
            </button>
          </div>
        </CapAligned>
      </div>
      {fixedContent}
      <div
        data-reader-popover-body
        tabIndex={-1}
        className={"min-h-0 overflow-y-auto overscroll-contain px-4 py-3 leading-normal outline-none " +
          (variant === "lookup" ? "text-sm" : "text-base")}
      >
        {children}
      </div>
    </div>
  );
}
