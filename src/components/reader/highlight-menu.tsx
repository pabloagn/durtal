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
  // A surface like the reader's dialogs: Esc closes it from anywhere, also
  // when focus stayed in the book after the click on the mark that opened it
  const close = useRef(onClose);
  useLayoutEffect(() => { close.current = onClose; });
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
    ref.current
      ?.querySelector<HTMLElement>("button")
      ?.focus({ preventScroll: true });
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
          onClose();
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
        onClick={onClose}
      >
        Close
      </button>
    </div>
  );
}
