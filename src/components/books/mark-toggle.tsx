"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { WorkMark } from "@/lib/constants/marks";
import { localToday } from "@/lib/constants/hunting";
import { acquireSurface, handleSurfaceEscape } from "@/lib/ui/surface-state";

const CARD_WIDTH = 248;
const OPEN_DELAY = 250;
const CLOSE_DELAY = 150;

/** "2026-09-25" → "25 Sep 2026", without a time zone shift */
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "2026-09-25" → "25 Sep 2026", the same in every browser and time zone */
export function formatMarkDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

/**
 * A book mark on the book page: the icon alone. Click marks or unmarks.
 * Hover (or keyboard focus) opens a small card with the mark's name, what
 * it means and, for dated marks, the date with "Change date".
 */
export function MarkToggle({
  mark,
  icon: Icon,
  tone,
  marked,
  pending = false,
  onToggle,
  date,
  onDateChange,
}: {
  mark: WorkMark;
  icon: LucideIcon;
  /** Text color class when marked, e.g. "text-accent-gold" */
  tone: string;
  marked: boolean;
  pending?: boolean;
  onToggle: () => void;
  /** The mark's date (YYYY-MM-DD), for dated marks */
  date?: string | null;
  /** Saves a new date; enables "Change date" */
  onDateChange?: (date: string) => void;
}) {
  const cardId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const openTimer = useRef<number | undefined>(undefined);
  const closeTimer = useRef<number | undefined>(undefined);
  const restoringFocus = useRef(false);
  const [position, setPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const [editing, setEditing] = useState(false);

  const clearTimers = useCallback(() => {
    window.clearTimeout(openTimer.current);
    window.clearTimeout(closeTimer.current);
  }, []);

  const open = useCallback(() => {
    clearTimers();
    const rect = button.current?.getBoundingClientRect();
    if (!rect) return;
    // Fixed card in a portal, so the hero's overflow never clips it
    const height = card.current?.getBoundingClientRect().height || 180;
    const below = rect.bottom + 6;
    const top = Math.max(8, Math.min(
      below + height > window.innerHeight - 8 ? rect.top - height - 6 : below,
      window.innerHeight - height - 8,
    ));
    setPosition({
      left: Math.max(
        8,
        Math.min(rect.left - 6, window.innerWidth - CARD_WIDTH - 8),
      ),
      top,
    });
  }, [clearTimers]);

  const close = useCallback(() => {
    clearTimers();
    setPosition(null);
    setEditing(false);
  }, [clearTimers]);

  function openSoon() {
    clearTimers();
    if (!position) openTimer.current = window.setTimeout(open, OPEN_DELAY);
  }

  function closeSoon() {
    clearTimers();
    const active = document.activeElement;
    if (card.current?.contains(active) || (active === button.current && button.current?.matches(":focus-visible"))) return;
    // While the date is being edited, only Escape or an outside click closes
    if (!editing) closeTimer.current = window.setTimeout(close, CLOSE_DELAY);
  }

  useEffect(() => () => clearTimers(), [clearTimers]);

  useLayoutEffect(() => {
    if (!position) return;
    const lease = acquireSurface(() => {
      close();
      restoringFocus.current = true;
      try { button.current?.focus({ preventScroll: true }); }
      finally { restoringFocus.current = false; }
    }, button.current ? { target: button.current, menuButton: null } : null, { blockCommandPalette: true });
    return () => lease.release();
  }, [position, close]);

  useEffect(() => {
    if (!position) return;
    function outside(event: PointerEvent) {
      const target = event.target as Node;
      if (!card.current?.contains(target) && !button.current?.contains(target))
        close();
    }
    function moved(event: Event) {
      if (card.current?.contains(event.target as Node)) return;
      const active = document.activeElement;
      if (card.current?.contains(active) || (active === button.current && button.current?.matches(":focus-visible"))) open();
      else close();
    }
    document.addEventListener("pointerdown", outside);
    window.addEventListener("scroll", moved, true);
    window.addEventListener("resize", moved);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("scroll", moved, true);
      window.removeEventListener("resize", moved);
    };
  }, [position, close, open]);

  const action = marked ? mark.unmarkAction : mark.markAction;

  return (
    <>
      <button
        ref={button}
        type="button"
        // Saving, not disabled: a disabled button drops the focus onto the page
        aria-disabled={pending || undefined}
        aria-pressed={marked}
        aria-busy={pending}
        aria-label={action}
        data-tooltip={action}
        aria-describedby={position ? cardId : undefined}
        onClick={() => {
          if (!pending) onToggle();
        }}
        onPointerEnter={openSoon}
        onPointerLeave={closeSoon}
        onFocus={(e) => {
          if (!restoringFocus.current && e.currentTarget.matches(":focus-visible")) open();
        }}
        onBlur={(e) => {
          if (!card.current?.contains(e.relatedTarget as Node)) closeSoon();
        }}
        onKeyDown={(e) => {
          // Down arrow reaches the card's controls from the keyboard
          if (e.key === "ArrowDown" && position) {
            e.preventDefault();
            card.current?.querySelector<HTMLElement>("button, input")?.focus();
          }
        }}
        className={`inline-flex h-7 w-7 items-center justify-center rounded-sm transition-colors hover:bg-bg-tertiary aria-disabled:opacity-50 pointer-coarse:size-11 ${marked ? tone : "text-fg-muted hover:text-fg-secondary"}`}
      >
        <Icon
          className="h-4 w-4"
          strokeWidth={1.5}
          fill={marked ? "currentColor" : "none"}
          fillOpacity={0.18}
          aria-hidden="true"
        />
      </button>
      {position &&
        createPortal(
          <div
            id={cardId}
            ref={card}
            role="group"
            aria-label={mark.label}
            onKeyDown={(event) => {
              if (event.key === "Escape" && handleSurfaceEscape(event.nativeEvent)) event.stopPropagation();
            }}
            onPointerEnter={clearTimers}
            onFocus={clearTimers}
            onPointerLeave={closeSoon}
            onBlur={(e) => {
              const next = e.relatedTarget as Node | null;
              if (
                !card.current?.contains(next) &&
                !button.current?.contains(next)
              )
                closeSoon();
            }}
            className="glass fixed z-[100] p-3"
            style={{ ...position, width: CARD_WIDTH }}
          >
            {/* Name and date on one line, then what the mark means */}
            <div className="flex items-center gap-2 whitespace-nowrap">
              <Icon
                className={`h-3.5 w-3.5 shrink-0 ${marked ? tone : "text-fg-muted"}`}
                strokeWidth={1.5}
                fill={marked ? "currentColor" : "none"}
                fillOpacity={0.18}
                aria-hidden="true"
              />
              <span className="text-xs font-medium text-fg-primary">
                {mark.label}
              </span>
              {marked && date && (
                <time
                  dateTime={date}
                  className="ml-auto font-mono text-micro text-fg-secondary"
                  data-tooltip={`Marked ${formatMarkDate(date)}`}
                >
                  {formatMarkDate(date)}
                </time>
              )}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-fg-secondary">
              {mark.hint}
            </p>

            {editing && onDateChange && date && (
              <form
                className="mt-2.5 flex items-center gap-1.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  const value = String(
                    new FormData(e.currentTarget).get("date") ?? "",
                  );
                  if (value) onDateChange(value);
                  setEditing(false);
                }}
              >
                <input
                  name="date"
                  type="date"
                  required
                  autoFocus
                  defaultValue={date}
                  aria-label={`${mark.label} date`}
                  className="h-7 min-w-0 flex-1 rounded-sm border border-glass-border bg-bg-primary/80 px-2 font-mono text-xs text-fg-primary [color-scheme:dark] focus:border-accent-primary focus:outline-none pointer-coarse:h-11 pointer-coarse:text-sm"
                />
                <button
                  type="submit"
                  aria-label="Save date"
                  data-tooltip="Save date"
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-sm hover:bg-bg-tertiary ${tone}`}
                >
                  <Check className="h-3.5 w-3.5" strokeWidth={1.5} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onDateChange(localToday());
                    setEditing(false);
                  }}
                  className="shrink-0 whitespace-nowrap rounded-sm px-1.5 py-1 text-micro text-fg-secondary hover:bg-bg-tertiary hover:text-fg-primary"
                >
                  Today
                </button>
              </form>
            )}

            {/* Actions: the same as clicking the icon, plus the date */}
            <div className="mt-2.5 flex items-center gap-1 whitespace-nowrap border-t border-glass-border pt-2">
              {marked && date && onDateChange && !editing && (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="-ml-1.5 rounded-sm px-1.5 py-0.5 text-micro text-fg-secondary transition-colors hover:bg-bg-tertiary hover:text-fg-primary"
                >
                  Change date
                </button>
              )}
              <button
                type="button"
                aria-disabled={pending || undefined}
                onClick={() => {
                  if (!pending) onToggle();
                }}
                className="-mr-1.5 ml-auto rounded-sm px-1.5 py-0.5 text-micro text-fg-secondary transition-colors hover:bg-bg-tertiary hover:text-fg-primary aria-disabled:opacity-50"
              >
                {action}
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
