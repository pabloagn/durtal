"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Star } from "lucide-react";
import { CapAligned } from "./cap-aligned";
import { formatRating } from "@/lib/utils/rating";

/*
 * The one work rating (SLN-446): 0.5 to 5 in half steps, for books, films,
 * perfumes and paintings. `RatingStars` shows it; `RatingInput` edits it by
 * mouse (half targets), touch (whole-star targets, a second tap for the half,
 * a drag for half steps) and keyboard. Venue ratings are another scale.
 */

type StarSize = 12 | 14 | 16;

const ICON: Record<StarSize, string> = { 12: "h-3 w-3", 14: "h-3.5 w-3.5", 16: "h-4 w-4" };

/** One star: empty (outlined), half (the left half filled) or full */
function StarGlyph({ fill, size }: { fill: 0 | 0.5 | 1; size: StarSize }) {
  const icon = ICON[size];
  return (
    <span className={`relative block ${icon}`} aria-hidden="true" data-fill={fill}>
      {fill < 1 && <Star className={`absolute inset-0 ${icon} text-fg-secondary`} strokeWidth={1.5} fill="none" />}
      {fill > 0 && (
        <span className={`absolute inset-y-0 left-0 overflow-hidden ${fill === 1 ? "w-full" : "w-1/2"}`}>
          <Star className={`block ${icon} text-accent-gold`} strokeWidth={1.5} fill="currentColor" />
        </span>
      )}
    </span>
  );
}

const fillOf = (value: number | null, n: number): 0 | 0.5 | 1 =>
  value === null || value <= n - 1 ? 0 : value >= n ? 1 : 0.5;

/** A rating as five stars, read as "Rated 4.5 out of 5" */
export function RatingStars({ value, size = 12 }: { value: number | null | undefined; size?: StarSize }) {
  const rating = value ?? null;
  return (
    <span
      role="img"
      aria-label={rating === null ? "Not rated" : `Rated ${formatRating(rating)} out of 5`}
      className="flex w-fit gap-0.5"
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <StarGlyph key={n} fill={fillOf(rating, n)} size={size} />
      ))}
    </span>
  );
}

interface Gesture {
  pointerId: number;
  startX: number;
  moved: boolean;
}

/**
 * Edits a rating. A slider for assistive technology; star n is the value n
 * and its left half n - 0.5. Coarse pointers get 44px whole-star targets and
 * a Clear button; the row lets the page scroll vertically.
 */
export function RatingInput({
  value,
  onChange,
  label = "Rating",
  size = 14,
  disabled = false,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  label?: string;
  size?: StarSize;
  disabled?: boolean;
}) {
  const row = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const shown = preview ?? value;

  const commit = (next: number | null) => {
    if (!disabled && next !== value) onChange(next);
  };

  /** The value under a point: the star, or its half when `half` */
  function valueAt(clientX: number, half: boolean) {
    const stars = row.current?.querySelectorAll<HTMLElement>("[data-star]") ?? [];
    for (let i = 0; i < stars.length; i++) {
      const box = stars[i].getBoundingClientRect();
      if (clientX < box.right || i === stars.length - 1) {
        const n = i + 1;
        return half && clientX < box.left + box.width / 2 ? n - 0.5 : n;
      }
    }
    return 5;
  }

  const fine = (e: PointerEvent) => e.pointerType === "mouse";
  const positionless = (e: PointerEvent) => e.clientX === 0 && e.clientY === 0;

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    // An assistive activation (a VoiceOver double tap) may come with no
    // position: it never sets a rating, the slider's keys and swipes do
    if (disabled || e.button > 0 || positionless(e)) return;
    if (fine(e)) {
      const next = valueAt(e.clientX, true);
      commit(next === value ? null : next);
      return;
    }
    gesture.current = { pointerId: e.pointerId, startX: e.clientX, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (disabled) return;
    if (fine(e)) {
      setPreview(valueAt(e.clientX, true));
      return;
    }
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    if (Math.abs(e.clientX - g.startX) > 8) g.moved = true;
    if (g.moved) setPreview(valueAt(e.clientX, true));
  }

  function onPointerUp(e: PointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    if (fine(e) || !g || g.pointerId !== e.pointerId) return;
    if (positionless(e)) return onCancel();
    gesture.current = null;
    setPreview(null);
    if (g.moved) return commit(valueAt(e.clientX, true));
    // A tap: the whole star, then its half, then the whole star again
    const n = valueAt(e.clientX, false);
    commit(value === n ? n - 0.5 : n);
  }

  function onCancel() {
    gesture.current = null;
    setPreview(null);
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    let next: number | null | undefined;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = value === null ? null : Math.max(0.5, value - 0.5);
    else if (e.key === "ArrowRight" || e.key === "ArrowUp") next = value === null ? 0.5 : Math.min(5, value + 0.5);
    else if (e.key === "Home") next = 0.5;
    else if (e.key === "End") next = 5;
    else if (e.key === "Backspace" || e.key === "Delete") next = null;
    else if (/^[1-5]$/.test(e.key)) next = Number(e.key);
    if (next === undefined) return;
    e.preventDefault();
    commit(next);
  }

  const text = value === null ? "Not rated" : `${formatRating(value)} ${value === 1 ? "star" : "stars"}`;
  // The Clear button wraps under the stars where the row is too narrow for both
  return (
    <div className="flex flex-wrap items-start gap-y-6">
      <CapAligned height={24} coarseHeight={44}>
        <div
          ref={row}
          role="slider"
          tabIndex={disabled ? -1 : 0}
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={5}
          aria-valuenow={value ?? 0}
          aria-valuetext={text}
          aria-disabled={disabled || undefined}
          className={`flex select-none rounded-sm ${disabled ? "opacity-60" : "cursor-pointer"}`}
          style={{ touchAction: "pan-y" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onCancel}
          onPointerLeave={(e) => fine(e) && setPreview(null)}
          onKeyDown={onKeyDown}
        >
          {[1, 2, 3, 4, 5].map((n) => (
            <span
              key={n}
              data-star={n}
              className="flex h-6 w-6 items-center justify-center pointer-coarse:h-11 pointer-coarse:w-11"
            >
              <StarGlyph fill={fillOf(shown, n)} size={size} />
            </span>
          ))}
        </div>
      </CapAligned>
      <CapAligned height={44} className="hidden pointer-coarse:block">
        <button
          type="button"
          aria-label="Clear rating"
          data-tooltip="Clear rating"
          disabled={disabled}
          tabIndex={value === null ? -1 : undefined}
          onClick={() => commit(null)}
          className={`h-11 px-2 text-sm text-fg-secondary transition-colors hover:text-fg-primary ${
            value === null ? "invisible" : ""
          }`}
        >
          Clear
        </button>
      </CapAligned>
    </div>
  );
}
