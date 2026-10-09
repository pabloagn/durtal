"use client";
import { useEffect, useRef, useState } from "react";
import type { PositionIndex } from "@/lib/reader/position-index";
import { chapterTicks, unit } from "@/lib/reader/position-index";

export function ProgressScrubber({
  fraction,
  index,
  onCommit,
  onPeek,
}: {
  fraction: number;
  index: PositionIndex;
  onCommit(fraction: number): void;
  onPeek?(active: boolean): void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLSpanElement>(null);
  const fill = useRef<HTMLSpanElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const preview = useRef(fraction);
  const dragging = useRef(false);
  const frame = useRef(0);
  const [peeking, setPeeking] = useState(false);
  const [width, setWidth] = useState(220);
  const [keyboard, setKeyboard] = useState<number | null>(null);
  const rtl = index.info.dir === "rtl";
  const write = (value: number, stay = false) => {
    preview.current = value;
    const px =
      (rtl ? 1 - value : value) * (track.current?.clientWidth ?? width);
    if (thumb.current)
      thumb.current.style.transform = "translateX(" + (px - 6) + "px)";
    if (fill.current)
      fill.current.style.transform = "translateY(-50%) scaleX(" + value + ")";
    track.current?.setAttribute(
      "aria-valuenow",
      String(Math.round(value * 100)),
    );
    track.current?.setAttribute("aria-valuetext", index.preview(value));
    if (bubble.current) {
      bubble.current.textContent = stay
        ? "Release to stay"
        : index.preview(value);
      // Clamp the bubble independently from the thumb so its whole label remains inside the viewport.
      const bubbleWidth = bubble.current.offsetWidth;
      bubble.current.style.transform =
        "translateX(" +
        Math.max(0, Math.min(px - bubbleWidth / 2, width - bubbleWidth)) +
        "px)";
    }
  };
  const cancel = () => {
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    dragging.current = false;
    setPeeking(false);
    setKeyboard(null);
    onPeek?.(false);
    write(fraction);
  };
  useEffect(() => {
    if (track.current) {
      const observer = new ResizeObserver(() =>
        setWidth(track.current?.clientWidth ?? 220),
      );
      observer.observe(track.current);
      return () => observer.disconnect();
    }
  }, []);
  useEffect(() => {
    if (peeking) write(preview.current);
    else if (!dragging.current && keyboard === null) write(fraction);
  });
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && dragging.current) {
        event.preventDefault();
        event.stopPropagation();
        cancel();
      }
    };
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("keydown", escape, true);
      cancelAnimationFrame(frame.current);
    };
  });
  const valueAt = (x: number) => {
    const rect = track.current!.getBoundingClientRect();
    const value = unit((x - rect.left) / Math.max(1, rect.width));
    return rtl ? 1 - value : value;
  };
  const tickFractions = chapterTicks(
    index.contents
      .filter((item) => index.sectionFor(item.href)?.linear !== false)
      .map((item) => index.fraction(item.href)),
    width,
  );
  const value = keyboard ?? fraction;
  return (
    <div
      ref={track}
      role="slider"
      tabIndex={0}
      aria-label="Reading progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      aria-valuetext={index.preview(value)}
      data-reader-widget
      className="relative h-6 min-w-0 flex-1 touch-none outline-none focus-visible:ring-1 focus-visible:ring-accent-primary pointer-coarse:h-11"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        dragging.current = true;
        setKeyboard(null);
        setPeeking(true);
        onPeek?.(true);
        event.currentTarget.setPointerCapture(event.pointerId);
        write(valueAt(event.clientX));
      }}
      onPointerMove={(event) => {
        if (!dragging.current) return;
        const value = valueAt(event.clientX);
        preview.current = value;
        if (frame.current) cancelAnimationFrame(frame.current);
        frame.current = requestAnimationFrame(() => {
          frame.current = 0;
          const rect = track.current!.getBoundingClientRect();
          write(value, event.clientY < rect.top - 64);
        });
      }}
      onPointerUp={(event) => {
        if (!dragging.current) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const stay = event.clientY < rect.top - 64;
        const target = valueAt(event.clientX);
        cancelAnimationFrame(frame.current);
        frame.current = 0;
        dragging.current = false;
        event.currentTarget.releasePointerCapture(event.pointerId);
        setPeeking(false);
        onPeek?.(false);
        write(fraction);
        if (!stay) onCommit(target);
      }}
      onPointerCancel={cancel}
      onLostPointerCapture={() => {
        if (dragging.current) cancel();
      }}
      onBlur={() => {
        if (!dragging.current) cancel();
      }}
      onKeyDown={(event) => {
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        let next: number | null = null;
        const step = event.shiftKey ? 0.1 : 0.01;
        if (event.key === "ArrowLeft")
          next = unit((keyboard ?? fraction) + (rtl ? step : -step));
        if (event.key === "ArrowRight")
          next = unit((keyboard ?? fraction) + (rtl ? -step : step));
        if (event.key === "Home") next = 0;
        if (event.key === "End") next = 1;
        if (next !== null) {
          event.preventDefault();
          setKeyboard(next);
          setPeeking(true);
          onPeek?.(true);
          write(next);
        }
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          cancel();
        }
        if (event.key === "Enter" && keyboard !== null) {
          event.preventDefault();
          const target = keyboard;
          cancel();
          onCommit(target);
        }
      }}
    >
      <span
        aria-hidden
        className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 bg-bg-tertiary"
      />
      <span
        ref={fill}
        aria-hidden
        className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 bg-fg-secondary"
        style={{ transformOrigin: rtl ? "right" : "left" }}
      />
      {tickFractions.map((tick, at) => (
        <span
          key={at}
          aria-hidden
          className="absolute top-1/2 h-1.5 w-px -translate-y-1/2 bg-fg-muted"
          style={{ left: (rtl ? 1 - tick : tick) * 100 + "%" }}
        />
      ))}
      <span
        ref={thumb}
        aria-hidden
        className="absolute left-0 top-1/2 -mt-1.5 h-3 w-3 rounded-[2px] bg-accent-primary"
      />
      <div
        ref={bubble}
        hidden={!peeking}
        className="glass pointer-events-none absolute bottom-full left-0 mb-2 max-w-[min(320px,100%)] overflow-hidden px-3 py-2 text-xs text-fg-primary"
      />
    </div>
  );
}
