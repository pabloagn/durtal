"use client";

import { useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
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

/** Lucide's star, drawn once per rating and reused for its five stars */
const STAR_PATH =
  "M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z";

/**
 * A rating as five stars, read as "Rated 4.5 out of 5". One small SVG with
 * the star path once: a list of 48 readings shows 48 of these (SLN-448). It
 * draws what `StarGlyph` draws: `size` px stars 2px apart, the outline in
 * the secondary color, gold filled stars, a half star clipped at its middle.
 */
export function RatingStars({ value, size = 12 }: { value: number | null | undefined; size?: StarSize }) {
  const rating = value ?? null;
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  // In the star's 24-unit space: the 2px gap, and the step from star to star
  const gap = (2 * 24) / size;
  const step = 24 + gap;
  const half = [1, 2, 3, 4, 5].some((n) => fillOf(rating, n) === 0.5);
  return (
    <span role="img" aria-label={rating === null ? "Not rated" : `Rated ${formatRating(rating)} out of 5`} className="flex w-fit">
      <svg
        width={size * 5 + 8}
        height={size}
        viewBox={`0 0 ${step * 5 - gap} 24`}
        fill="none"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="block"
      >
        <defs>
          <path id={`${id}-star`} d={STAR_PATH} />
          {/* The left half of a star, in the star's own space */}
          {half && (
            <clipPath id={`${id}-half`}>
              <rect width={12} height={24} />
            </clipPath>
          )}
        </defs>
        {[1, 2, 3, 4, 5].map((n) => {
          const fill = fillOf(rating, n);
          return (
            <g key={n} data-fill={fill} transform={`translate(${(n - 1) * step} 0)`}>
              {fill < 1 && <use href={`#${id}-star`} stroke="currentColor" className="text-fg-secondary" />}
              {fill > 0 && (
                <use
                  href={`#${id}-star`}
                  stroke="currentColor"
                  fill="currentColor"
                  className="text-accent-gold"
                  clipPath={fill === 0.5 ? `url(#${id}-half)` : undefined}
                />
              )}
            </g>
          );
        })}
      </svg>
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
