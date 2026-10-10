"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { CapAligned } from "@/components/shared/cap-aligned";

/** Shared collision-aware surface for notes and lookup; only the body scrolls. */
export function AnchoredReaderPopover({
  title,
  anchor,
  keyboard,
  reference,
  children,
  onClose,
  action,
}: {
  title: string;
  anchor: { left: number; right: number; top: number; bottom: number } | null;
  keyboard: boolean;
  reference?: HTMLElement;
  children: ReactNode;
  action?: ReactNode;
  onClose(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const close = useRef(onClose);
  const [position, setPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const popup = ref.current;
    if (!popup) return;
    const position = () => {
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
    position();
    const resize = new ResizeObserver(position);
    resize.observe(popup);
    window.addEventListener("resize", position);
    if (keyboard)
      popup
        .querySelector<HTMLElement>("[data-reader-popover-body]")
        ?.focus({ preventScroll: true });
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close.current();
      }
    };
    const docs = new Set(
      [document, reference?.ownerDocument].filter(
        (doc): doc is Document => !!doc,
      ),
    );
    for (const doc of docs) doc.addEventListener("keydown", escape, true);
    return () => {
      resize.disconnect();
      window.removeEventListener("resize", position);
      for (const doc of docs) doc.removeEventListener("keydown", escape, true);
      popup.hidePopover();
      if (reference?.isConnected) reference.focus({ preventScroll: true });
    };
  }, [anchor, keyboard, reference]);
  return (
    <div
      ref={ref}
      popover="auto"
      role="dialog"
      aria-modal={false}
      aria-labelledby={titleId}
      data-reader-chrome
      data-reader-widget
      data-reader-anchored-popover
      onToggle={(event) => {
        if ((event.nativeEvent as ToggleEvent).newState === "closed")
          close.current();
      }}
      style={position ? { left: position.left, top: position.top } : undefined}
      className="glass fixed inset-x-0 bottom-0 top-auto z-50 m-0 flex max-h-[60dvh] w-full flex-col overflow-hidden border border-glass-border p-0 text-fg-primary md:inset-auto md:max-h-[min(50dvh,360px)] md:w-[420px] md:max-w-[calc(100vw-32px)]"
    >
      <div className="glass-bar type-item-title flex shrink-0 items-start justify-between gap-2 border-b border-glass-border px-4 py-3">
        <h2 id={titleId}>{title}</h2>
        <CapAligned height={32} coarseHeight={44}>
          <div className="flex items-center gap-2">
            {action}
            <button
              type="button"
              aria-label="Close"
              data-tooltip="Close"
              data-tooltip-keys="esc"
              className="action-icon-sm"
              onClick={onClose}
            >
              <X className="h-4 w-4" strokeWidth={1.5} />
            </button>
          </div>
        </CapAligned>
      </div>
      <div
        data-reader-popover-body
        tabIndex={-1}
        className="min-h-0 overflow-y-auto overscroll-contain px-4 py-3 text-base leading-normal outline-none"
      >
        {children}
      </div>
    </div>
  );
}
