"use client";

import { useEffect } from "react";

/**
 * Keeps the keyboard focus when the row it was in goes away: a deleted
 * location or copy, a book removed from a collection or from Up next, a
 * dictionary source (focus survey, cause 4). Without it the focus fell to the
 * page body, and the next Tab started again from the top of the page.
 *
 * A list marks itself `data-focus-list="<name>"` and each row
 * `data-focus-row`. Its Add control (or whatever should take the focus once
 * the list is empty) carries `data-focus-empty="<name>"`, anywhere on the
 * page. When a row with the focus in it is removed, the focus moves to the
 * row that took its place, else the row before it, else that control, else
 * the page's heading: to the same control of the row (the next Delete for a
 * Delete) when it has one.
 * A confirmation dialog or a menu in between changes nothing: the control
 * that opened it is the one that counts.
 */

const FOCUSABLE =
  'a[href], button, input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])';

type Place = { list: string; index: number; control: number; verb: string; row: Element };

let place: Place | null = null;

function shown(el: Element): boolean {
  return el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
}

/**
 * What a control does, from the first word of its name ("Delete", "Remove",
 * "More"): rows of one list can hold different controls (the first has no
 * Move earlier, a book with an e-book has Read), so a place by count alone
 * can land on another control
 */
function verb(el: Element): string {
  return (el.getAttribute("aria-label") || el.textContent || "").trim().split(/\s+/)[0].toLowerCase();
}

function controls(row: Element): HTMLElement[] {
  // Not those of a dialog the row holds (its Delete confirmation)
  return [...row.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => shown(el) && !el.matches(":disabled") && !row.contains(el.closest("dialog")),
  );
}

function rows(list: Element): Element[] {
  // Its own rows, not those of a list inside one of them
  return [...list.querySelectorAll("[data-focus-row]")].filter(
    (row) => row.closest("[data-focus-list]") === list,
  );
}

/** Where the focus is, when it is in a row of a list */
function placeOf(el: Element): Place | null {
  const row = el.closest("[data-focus-row]");
  const list = row?.closest("[data-focus-list]");
  if (!row || !list) return null;
  return {
    list: list.getAttribute("data-focus-list") ?? "",
    index: rows(list).indexOf(row),
    control: controls(row).indexOf(el as HTMLElement),
    verb: verb(el),
    row,
  };
}

/** The control to take the focus once `gone`'s row has been removed */
export function focusSuccessor(gone: Place): HTMLElement | null {
  const list = [...document.querySelectorAll(`[data-focus-list]`)].find(
    (el) => el.getAttribute("data-focus-list") === gone.list && shown(el),
  );
  const left = list ? rows(list).filter(shown) : [];
  const row = left[Math.min(gone.index, left.length - 1)];
  if (row) {
    const own = controls(row);
    // The control at the same count when it does the same, else the first
    // that does (Remove after a Remove), else the same count, else the first
    const same = (el?: HTMLElement) => !!el && !!gone.verb && verb(el) === gone.verb;
    if (same(own[gone.control])) return own[gone.control];
    return own.find(same) ?? own[gone.control] ?? own[0] ?? null;
  }
  const empty = [...document.querySelectorAll<HTMLElement>("[data-focus-empty]")].find(
    (el) => el.getAttribute("data-focus-empty") === gone.list && shown(el),
  );
  if (empty) return empty;
  // The list went with its last row (a section that shows only when it has
  // some): the page's heading, so the next Tab goes on from the top of it
  const heading = document.querySelector<HTMLElement>("main h1");
  if (heading && !heading.hasAttribute("tabindex")) heading.tabIndex = -1;
  return heading;
}

function lost(): boolean {
  const active = document.activeElement;
  return !active || active === document.body || !active.isConnected;
}

function rescue() {
  if (!place || place.row.isConnected || !lost()) return;
  // A dialog still open takes the focus back itself when it closes
  if (document.querySelector("dialog[open]")) return;
  const gone = place;
  place = null;
  focusSuccessor(gone)?.focus({ preventScroll: true });
}

export function FocusKeeper() {
  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as Element;
      // A dialog or menu opened from the row (Delete's confirmation, More)
      // keeps the place of the control that opened it
      if (target.closest?.('dialog, [role="menu"]')) return;
      place = placeOf(target);
    };
    let frame = 0;
    const check = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(rescue);
    };
    const observer = new MutationObserver(() => {
      if (place && !place.row.isConnected) check();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("focusin", onFocusIn);
    // A dialog that closes over a row already gone hands the focus to nothing
    document.addEventListener("close", check, true);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("close", check, true);
    };
  }, []);
  return null;
}
