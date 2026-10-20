"use client";

import { useEffect, useRef } from "react";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { CapAligned } from "@/components/shared/cap-aligned";

const ICON_BUTTON =
  "flex h-6 w-6 items-center justify-center rounded-sm text-fg-muted transition-colors hover:bg-bg-tertiary hover:text-fg-primary disabled:pointer-events-none disabled:opacity-40 focus-visible:-outline-offset-2 pointer-coarse:size-11";

/**
 * Move up, Move down and Remove for one row of a credit list (SLN-1131): a
 * book's authors, an edition's contributors, a film's credits, a painting's
 * painters and a perfume's people. The row is `data-credit-row`.
 * Each is named after its person; the row's order is what the form saves.
 */
export function CreditRowControls({
  name,
  first,
  last,
  onMove,
  onRemove,
}: {
  name: string;
  first: boolean;
  last: boolean;
  onMove: (step: -1 | 1) => void;
  onRemove: () => void;
}) {
  // A moved row keeps the focus: React moves a row that goes down out of the
  // page and back, which blurs it, and at an end that way's button turns off,
  // so the focus goes to the other one rather than dropping to the page
  const up = useRef<HTMLButtonElement>(null);
  const down = useRef<HTMLButtonElement>(null);
  const pressed = useRef<-1 | 1 | 0>(0);
  useEffect(() => {
    if (!pressed.current) return;
    const towardsEnd = pressed.current === -1 ? first : last;
    ((pressed.current === -1) !== towardsEnd ? up : down).current?.focus();
    pressed.current = 0;
  });
  const move = (step: -1 | 1) => {
    pressed.current = step;
    onMove(step);
  };
  // A removed row hands the focus to the next row's Remove, else the one
  // before, else the form's name search, else the list's Add
  const remove = (button: HTMLElement) => {
    const row = button.closest("[data-credit-row]");
    const next =
      (row?.nextElementSibling ?? row?.previousElementSibling)?.querySelector<HTMLElement>("[data-credit-remove]") ??
      button.closest("form")?.querySelector<HTMLElement>("[data-credit-search]") ??
      row?.parentElement?.parentElement?.querySelector<HTMLElement>("button[aria-label^='Add']");
    onRemove();
    if (next) requestAnimationFrame(() => next.focus());
  };
  return (
    <CapAligned height={24} coarseHeight={44}>
      <div className="flex items-center">
        <button
          type="button"
          aria-label={`Move ${name} up`}
          data-tooltip="Move up"
          ref={up}
          disabled={first}
          onClick={() => move(-1)}
          className={ICON_BUTTON}
        >
          <ArrowUp className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>
        <button
          type="button"
          aria-label={`Move ${name} down`}
          data-tooltip="Move down"
          ref={down}
          disabled={last}
          onClick={() => move(1)}
          className={ICON_BUTTON}
        >
          <ArrowDown className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>
        <button
          type="button"
          aria-label={`Remove ${name}`}
          data-tooltip="Remove"
          data-credit-remove=""
          onClick={(e) => remove(e.currentTarget)}
          className={ICON_BUTTON}
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>
      </div>
    </CapAligned>
  );
}

/** The list with the row at `index` moved one place up (-1) or down (1) */
export function moveRow<T>(rows: T[], index: number, step: -1 | 1): T[] {
  const to = index + step;
  if (to < 0 || to >= rows.length) return rows;
  const next = [...rows];
  [next[index], next[to]] = [next[to]!, next[index]!];
  return next;
}

/** A credit row: the name wraps in full on its own line on a phone or touch screen */
export const CREDIT_ROW =
  "flex items-start gap-2 rounded-sm border border-glass-border bg-bg-primary px-2.5 py-2 text-sm pointer-coarse:flex-wrap pointer-coarse:leading-11 max-sm:flex-wrap";
export const CREDIT_ROW_NAME =
  "min-w-0 flex-1 whitespace-normal break-words text-fg-primary pointer-coarse:basis-full pointer-coarse:leading-6 max-sm:basis-full";
