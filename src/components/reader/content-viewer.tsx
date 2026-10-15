"use client";
import { useEffect, useRef, useState } from "react";
import { Minus, Plus, RotateCcw, X } from "lucide-react";
import {
  cleanedTableStyles,
  sanitizedSvg,
  tableForViewer,
  type ReaderMedia,
} from "@/lib/reader/media/content";
import {
  clampZoom,
  fitScale,
  zoomAt,
  type ViewerSize,
  type ZoomState,
} from "@/lib/reader/media/zoom";
import { resolveThemeColors } from "@/lib/reader/presentation";

/** A native fullscreen modal; gesture updates write only one transform per animation frame. */
export function ContentViewer({
  media,
  onClose,
}: {
  media: ReaderMedia;
  onClose(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const command = useRef<(action: string) => void>(() => {});
  // The media that could not be shown; a new one starts afresh
  const [failed, setFailed] = useState<ReaderMedia | null>(null);
  useEffect(() => {
    const modal = dialog.current!;
    const viewport = stage.current!;
    const host = content.current!;
    const abort = new AbortController();
    const origin = document.activeElement as HTMLElement | null;
    const pointers = new Map<number, { x: number; y: number }>();
    let size: ViewerSize = {
      width: viewport.clientWidth || innerWidth,
      height: viewport.clientHeight || innerHeight,
      contentWidth: 1,
      contentHeight: 1,
    };
    let state: ZoomState = { scale: 1, x: 0, y: 0 };
    let loaded = false;
    let frame = 0;
    let url: string | null = null;
    let lastTap = 0;
    let pointerStart: { x: number; y: number; at: number } | null = null;
    const paint = () => {
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          host.style.transform = `translate(calc(-50% + ${state.x}px), calc(-50% + ${state.y}px)) scale(${state.scale})`;
        });
    };
    const reset = () => {
      state = { scale: fitScale(size), x: 0, y: 0 };
      paint();
    };
    const updateSize = () => {
      if (!loaded) return;
      const wasFit = Math.abs(state.scale - fitScale(size)) < 0.001;
      size = {
        ...size,
        width: viewport.clientWidth,
        height: viewport.clientHeight,
      };
      if (wasFit) reset();
      else {
        state = clampZoom(state, size);
        paint();
      }
    };
    const observer = new ResizeObserver(updateSize);
    observer.observe(viewport);
    modal.showModal();
    const focusFrame = requestAnimationFrame(() => {
      modal
        .querySelector<HTMLButtonElement>('[aria-label="Close viewer"]')
        ?.focus();
    });
    const zoom = (scale: number, clientX?: number, clientY?: number) => {
      if (!loaded) return;
      const rect = viewport.getBoundingClientRect();
      state = zoomAt(
        state,
        size,
        scale,
        clientX == null ? 0 : clientX - rect.left - size.width / 2,
        clientY == null ? 0 : clientY - rect.top - size.height / 2,
      );
      paint();
    };
    const toggle = (x: number, y: number) => {
      if (state.scale > fitScale(size) * 1.01) reset();
      else zoom(fitScale(size) * 2, x, y);
    };
    command.current = (action) => {
      if (action === "reset") reset();
      else if (action === "+") zoom(state.scale * 1.25);
      else if (action === "-") zoom(state.scale / 1.25);
    };
    const down = (event: PointerEvent) => {
      if (event.button !== 0) return;
      viewport.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      pointerStart = {
        x: event.clientX,
        y: event.clientY,
        at: performance.now(),
      };
      event.preventDefault();
    };
    const move = (event: PointerEvent) => {
      const previous = pointers.get(event.pointerId);
      if (!previous || !loaded) return;
      const others = [...pointers].filter(([id]) => id !== event.pointerId);
      if (others.length) {
        const other = others[0][1];
        const before = Math.hypot(previous.x - other.x, previous.y - other.y);
        const after = Math.hypot(
          event.clientX - other.x,
          event.clientY - other.y,
        );
        if (before > 0) {
          const midX = (previous.x + other.x) / 2;
          const midY = (previous.y + other.y) / 2;
          zoom((state.scale * after) / before, midX, midY);
          state = clampZoom(
            {
              ...state,
              x: state.x + (event.clientX - previous.x) / 2,
              y: state.y + (event.clientY - previous.y) / 2,
            },
            size,
          );
        }
      } else
        state = clampZoom(
          {
            ...state,
            x: state.x + event.clientX - previous.x,
            y: state.y + event.clientY - previous.y,
          },
          size,
        );
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      paint();
      event.preventDefault();
    };
    const up = (event: PointerEvent) => {
      if (
        event.pointerType === "touch" &&
        pointers.size === 1 &&
        pointerStart &&
        performance.now() - pointerStart.at < 300 &&
        Math.hypot(
          event.clientX - pointerStart.x,
          event.clientY - pointerStart.y,
        ) < 10
      ) {
        const now = performance.now();
        if (now - lastTap < 300) {
          toggle(event.clientX, event.clientY);
          lastTap = 0;
        } else lastTap = now;
      }
      pointers.delete(event.pointerId);
      pointerStart = null;
    };
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      zoom(
        state.scale * Math.exp(-event.deltaY * 0.002),
        event.clientX,
        event.clientY,
      );
    };
    const double = (event: MouseEvent) => {
      event.preventDefault();
      toggle(event.clientX, event.clientY);
    };
    const keys = (event: KeyboardEvent) => {
      if (
        [
          "+",
          "=",
          "-",
          "0",
          "ArrowLeft",
          "ArrowRight",
          "ArrowUp",
          "ArrowDown",
        ].includes(event.key)
      )
        event.preventDefault();
      else return;
      if (event.key === "0") reset();
      else if (event.key === "+" || event.key === "=") zoom(state.scale * 1.25);
      else if (event.key === "-") zoom(state.scale / 1.25);
      else {
        state = clampZoom(
          {
            ...state,
            x:
              state.x +
              (event.key === "ArrowLeft"
                ? size.width * 0.1
                : event.key === "ArrowRight"
                  ? -size.width * 0.1
                  : 0),
            y:
              state.y +
              (event.key === "ArrowUp"
                ? size.height * 0.1
                : event.key === "ArrowDown"
                  ? -size.height * 0.1
                  : 0),
          },
          size,
        );
        paint();
      }
    };
    viewport.addEventListener("pointerdown", down);
    viewport.addEventListener("pointermove", move);
    viewport.addEventListener("pointerup", up);
    viewport.addEventListener("pointercancel", up);
    viewport.addEventListener("wheel", wheel, { passive: false });
    viewport.addEventListener("dblclick", double);
    modal.addEventListener("keydown", keys);
    void (async () => {
      if (media.kind === "table") {
        const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
        const style = document.createElement("style");
        const colors = resolveThemeColors();
        style.textContent =
          cleanedTableStyles(media.element.ownerDocument) +
          `\n:host { color:${colors.text};background:${colors.background}; } table { width:max-content;max-width:none!important; color:${colors.text}!important;background:${colors.background}!important; } td,th { color:inherit!important;background:transparent!important; }`;
        const table = tableForViewer(media.element, document);
        shadow.replaceChildren(style, table);
        size.contentWidth = Math.max(1, table.scrollWidth);
        size.contentHeight = Math.max(1, table.scrollHeight);
      } else {
        let src: string;
        if (media.element.localName === "svg") {
          const blob = new Blob(
            [
              new XMLSerializer().serializeToString(
                sanitizedSvg(media.element),
              ),
            ],
            { type: "image/svg+xml" },
          );
          url = URL.createObjectURL(blob);
          src = url;
        } else {
          // The book's own blob or data URL, shown as is: the reader's
          // policy lets images load from blob: but not fetch() them
          // (connect-src), so a copy through fetch failed in every engine
          const image = media.element as HTMLImageElement;
          src = image.currentSrc || image.src;
          if (!/^(blob:|data:image\/)/i.test(src))
            throw new Error("The image resource is unavailable.");
        }
        const image = document.createElement("img");
        image.src = src;
        image.alt = media.caption;
        image.draggable = false;
        image.style.cssText = "max-width:none;max-height:none;display:block;";
        await image.decode();
        if (abort.signal.aborted) return;
        size.contentWidth = image.naturalWidth;
        size.contentHeight = image.naturalHeight;
        host.replaceChildren(image);
      }
      size.width = viewport.clientWidth || innerWidth;
      size.height = viewport.clientHeight || innerHeight;
      host.style.width = `${size.contentWidth}px`;
      host.style.height = `${size.contentHeight}px`;
      loaded = true;
      reset();
    })().catch(() => {
      if (!abort.signal.aborted) setFailed(media);
    });
    return () => {
      abort.abort();
      observer.disconnect();
      cancelAnimationFrame(focusFrame);
      if (frame) cancelAnimationFrame(frame);
      viewport.removeEventListener("pointerdown", down);
      viewport.removeEventListener("pointermove", move);
      viewport.removeEventListener("pointerup", up);
      viewport.removeEventListener("pointercancel", up);
      viewport.removeEventListener("wheel", wheel);
      viewport.removeEventListener("dblclick", double);
      modal.removeEventListener("keydown", keys);
      if (modal.open) modal.close();
      if (url) URL.revokeObjectURL(url);
      if (media.reference.isConnected)
        media.reference.focus({ preventScroll: true });
      else origin?.focus({ preventScroll: true });
    };
  }, [media]);
  return (
    <dialog
      ref={dialog}
      data-reader-chrome
      aria-label={media.kind === "table" ? "Table viewer" : "Image viewer"}
      className="fixed inset-0 z-50 m-0 h-dvh max-h-none w-screen max-w-none overflow-hidden border-0 bg-bg-primary p-0 text-fg-primary backdrop:bg-black/90"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="absolute inset-x-0 top-0 z-10 flex justify-end gap-1 p-3">
        <button
          type="button"
          aria-label="Zoom out"
          data-tooltip="Zoom out"
          data-tooltip-keys="-"
          className="action-icon-sm"
          onClick={() => command.current("-")}
        >
          <Minus className="h-4 w-4" strokeWidth={1.5} />
        </button>
        <button
          type="button"
          aria-label="Zoom in"
          data-tooltip="Zoom in"
          data-tooltip-keys="+"
          className="action-icon-sm"
          onClick={() => command.current("+")}
        >
          <Plus className="h-4 w-4" strokeWidth={1.5} />
        </button>
        <button
          type="button"
          aria-label="Fit content"
          data-tooltip="Fit content"
          data-tooltip-keys="0"
          className="action-icon-sm"
          onClick={() => command.current("reset")}
        >
          <RotateCcw className="h-4 w-4" strokeWidth={1.5} />
        </button>
        <button
          type="button"
          aria-label="Close viewer"
          data-tooltip="Close viewer"
          data-tooltip-keys="esc"
          className="action-icon-sm"
          onClick={onClose}
        >
          <X className="h-4 w-4" strokeWidth={1.5} />
        </button>
      </div>
      <div
        ref={stage}
        className="absolute inset-x-0 bottom-16 top-16 touch-none overflow-hidden"
      >
        <div
          ref={content}
          className="absolute left-1/2 top-1/2 origin-center"
        />
        {failed === media && (
          <p
            role="alert"
            className="absolute inset-x-4 top-1/2 -translate-y-1/2 text-center text-sm text-fg-secondary"
          >
            {media.kind === "table"
              ? "This table could not be opened."
              : "This image could not be opened."}
          </p>
        )}
      </div>
      {media.caption && (
        <p className="absolute inset-x-4 bottom-4 line-clamp-2 text-center text-sm text-fg-secondary">
          {media.caption}
        </p>
      )}
    </dialog>
  );
}
