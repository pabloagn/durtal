"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { WorkMark } from "@/lib/constants/marks";
import { localToday } from "@/lib/constants/hunting";

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
  const [position, setPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const [editing, setEditing] = useState(false);

  function clearTimers() {
    window.clearTimeout(openTimer.current);
    window.clearTimeout(closeTimer.current);
  }

  function open() {
    clearTimers();
    const rect = button.current?.getBoundingClientRect();
    if (!rect) return;
    // Fixed card in a portal, so the hero's overflow never clips it
    const below = rect.bottom + 6;
    const top =
      below + 180 > window.innerHeight ? Math.max(8, rect.top - 186) : below;
    setPosition({
      left: Math.max(
        8,
        Math.min(rect.left - 6, window.innerWidth - CARD_WIDTH - 8),
      ),
      top,
    });
  }

  function close() {
    clearTimers();
    setPosition(null);
    setEditing(false);
  }

  function openSoon() {
    clearTimers();
    if (!position) openTimer.current = window.setTimeout(open, OPEN_DELAY);
  }

  function closeSoon() {
    clearTimers();
    // While the date is being edited, only Escape or an outside click closes
    if (!editing) closeTimer.current = window.setTimeout(close, CLOSE_DELAY);
  }

  useEffect(() => () => clearTimers(), []);

  useEffect(() => {
    if (!position) return;
    function outside(event: PointerEvent) {
      const target = event.target as Node;
      if (!card.current?.contains(target) && !button.current?.contains(target))
        close();
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        close();
        button.current?.focus();
      }
    }
    function moved(event: Event) {
      if (!card.current?.contains(event.target as Node)) close();
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    window.addEventListener("scroll", moved, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("scroll", moved, true);
      window.removeEventListener("resize", close);
    };
  }, [position]);

  const action = marked ? mark.unmarkAction : mark.markAction;

  return (
    <>
      <button
        ref={button}
        type="button"
        disabled={pending}
        aria-pressed={marked}
        aria-busy={pending}
        aria-label={action}
        aria-describedby={position ? cardId : undefined}
        onClick={onToggle}
        onPointerEnter={openSoon}
        onPointerLeave={closeSoon}
        onFocus={(e) => {
          if (e.currentTarget.matches(":focus-visible")) open();
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
        className={`inline-flex h-7 w-7 items-center justify-center rounded-sm transition-colors hover:bg-bg-tertiary focus-visible:outline focus-visible:outline-1 focus-visible:outline-fg-muted disabled:opacity-50 ${marked ? tone : "text-fg-muted/70 hover:text-fg-secondary"}`}
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
            onPointerEnter={clearTimers}
            onPointerLeave={closeSoon}
            onBlur={(e) => {
              const next = e.relatedTarget as Node | null;
              if (
                !card.current?.contains(next) &&
                !button.current?.contains(next)
              )
                closeSoon();
            }}
            className="fixed z-[100] rounded-sm border border-glass-border bg-bg-secondary p-3 shadow-xl"
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
                  className="ml-auto font-mono text-micro text-fg-muted"
                  title={`Marked ${formatMarkDate(date)}`}
                >
                  {formatMarkDate(date)}
                </time>
              )}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-fg-muted">
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
                  className="h-7 min-w-0 flex-1 rounded-sm border border-glass-border bg-bg-primary px-2 font-mono text-xs text-fg-primary [color-scheme:dark] focus:border-fg-muted focus:outline-none"
                />
                <button
                  type="submit"
                  aria-label="Save date"
                  title="Save date"
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
                  className="shrink-0 whitespace-nowrap rounded-sm px-1.5 py-1 text-micro text-fg-muted hover:bg-bg-tertiary hover:text-fg-primary"
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
                  className="-ml-1.5 rounded-sm px-1.5 py-0.5 text-micro text-fg-muted transition-colors hover:bg-bg-tertiary hover:text-fg-primary"
                >
                  Change date
                </button>
              )}
              <button
                type="button"
                disabled={pending}
                onClick={onToggle}
                className="-mr-1.5 ml-auto rounded-sm px-1.5 py-0.5 text-micro text-fg-muted transition-colors hover:bg-bg-tertiary hover:text-fg-primary disabled:opacity-50"
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
