"use client";
import { buttonClass } from "@/components/ui/button";
import { useLayoutEffect, useRef, useState } from "react";
import { acquireSurface } from "@/lib/ui/surface-state";
import type {
  AnnotationColor,
  ReaderAnnotation,
} from "@/lib/reader/annotations";
import { AnnotationSwatches } from "./annotation-swatches";
import { selectionToolbarPosition } from "./selection-toolbar";

export function HighlightMenu({
  annotation,
  rect,
  onEdit,
  onNote,
  onDelete,
  onClose,
  fills,
}: {
  annotation: ReaderAnnotation;
  rect: { left: number; top: number; right: number; bottom: number };
  onEdit(edit: {
    color?: AnnotationColor;
    style?: "highlight" | "underline";
  }): void;
  onNote(): void;
  onDelete(): void;
  onClose(): void;
  fills?: Record<AnnotationColor, string>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 16, top: 16 });
  const [copy, setCopy] = useState<"ready" | "copied" | "failed">("ready");
  const opener = useRef<HTMLElement | null>(null);
  // Escape and Close put focus back on the mark, or the book, as other menus do
  const close = useRef(() => {});
  useLayoutEffect(() => {
    close.current = () => {
      const mark = opener.current;
      onClose();
      if (mark?.isConnected) mark.focus({ preventScroll: true });
    };
  });
  // A surface like the reader's dialogs: Esc closes it from anywhere, also
  // when focus stayed in the book after the click on the mark that opened it
  useLayoutEffect(() => {
    const lease = acquireSurface(() => close.current());
    return () => lease.release();
  }, []);
  useLayoutEffect(() => {
    const place = () => {
      if (ref.current)
        setPosition(
          selectionToolbarPosition(
            rect,
            ref.current.getBoundingClientRect(),
            { width: innerWidth, height: innerHeight },
            false,
          ),
        );
    };
    place();
    const observer = new ResizeObserver(place);
    if (ref.current) observer.observe(ref.current);
    // The mark lives in the book's frame. A click there leaves the page's
    // own focus heuristics thinking the keyboard moved focus, so the first
    // swatch would show its focus tooltip, and that tooltip takes the first
    // Escape (SLN-670). Its focus is visible only when the mark was opened
    // from the keyboard.
    const mark = markInFrame();
    opener.current ??= mark;
    // `focusVisible` is newer than TypeScript's DOM types; browsers without it ignore it
    ref.current?.querySelector<HTMLElement>("button")?.focus({
      preventScroll: true,
      focusVisible: !!mark?.matches(":focus-visible"),
    } as FocusOptions);
    addEventListener("resize", place);
    return () => {
      observer.disconnect();
      removeEventListener("resize", place);
    };
  }, [rect]);
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Highlight actions"
      data-reader-chrome
      data-reader-widget
      className="glass fixed z-50 flex max-w-[calc(100%_-_32px)] flex-wrap items-center gap-1 overflow-hidden p-1 text-sm text-fg-primary"
      style={position}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          close.current();
        }
        if (event.key === "Delete" || event.key === "Backspace") {
          event.preventDefault();
          onDelete();
        }
      }}
    >
      {annotation.style !== "quote" && (
        <>
          <AnnotationSwatches
            color={annotation.color}
            onPick={(color) => onEdit({ color })}
            fills={fills}
          />
          <button
            type="button"
            className={buttonClass("ghost", "sm")}
            onClick={() =>
              onEdit({
                style:
                  annotation.style === "underline" ? "highlight" : "underline",
              })
            }
          >
            {annotation.style === "underline" ? "Highlight" : "Underline"}
          </button>
        </>
      )}
      <button
        type="button"
        className={buttonClass("ghost", "sm")}
        data-tooltip="Edit note"
        data-tooltip-keys="n"
        onClick={onNote}
      >
        Note
      </button>
      <button
        type="button"
        className={buttonClass("ghost", "sm")}
        onClick={() => {
          void navigator.clipboard.writeText(annotation.text ?? "").then(
            () => setCopy("copied"),
            () => setCopy("failed"),
          );
        }}
      >
        {copy === "copied"
          ? "Copied"
          : copy === "failed"
            ? "Copy failed"
            : "Copy"}
      </button>
      <button
        type="button"
        className={buttonClass("danger", "sm")}
        onClick={onDelete}
      >
        Delete
      </button>
      <button
        type="button"
        className={buttonClass("ghost", "sm")}
        onClick={() => close.current()}
      >
        Close
      </button>
    </div>
  );
}

/**
 * The focused element in the book's frame (the reader's view keeps the frame
 * in a shadow root): the mark, else the frame itself. Null when focus is not
 * in a frame.
 */
function markInFrame(): HTMLElement | null {
  let el: Element | null = document.activeElement;
  let frame: HTMLIFrameElement | null = null;
  while (el) {
    if (el.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
    else if (el instanceof HTMLIFrameElement) {
      frame = el;
      try {
        el = el.contentDocument?.activeElement ?? null;
      } catch {
        // A frame from another origin keeps its focus to itself
        el = null;
      }
    } else break;
  }
  if (!frame) return null;
  const doc = frame.contentDocument;
  return el && doc && el !== doc.body && el !== doc.documentElement && "focus" in el ? (el as HTMLElement) : frame;
}
