"use client";

import { createContext, useContext, type ReactNode } from "react";
import { CapAligned } from "@/components/shared/cap-aligned";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";

/** A 16px icon in a 32px button, 44px on touch */
export const READER_BAR_BUTTON =
  "block rounded-sm p-2 text-fg-secondary transition-colors hover:bg-bg-tertiary/50 hover:text-fg-primary disabled:opacity-40 pointer-coarse:p-3.5";

/**
 * Where a reader bar control renders: as an icon button in the top bar, or
 * as a labelled row in the bar's More menu at phone width. The control keeps
 * its own state either way; only its presentation changes.
 */
const ReaderBarPlacement = createContext<"bar" | "menu">("bar");

export function ReaderBarMenuItems({ children }: { children: ReactNode }) {
  return (
    <ReaderBarPlacement.Provider value="menu">{children}</ReaderBarPlacement.Provider>
  );
}

export function useReaderBarPlacement() {
  return useContext(ReaderBarPlacement);
}

/**
 * Focus the bar button a dialog will return to, only for a mouse or the
 * keyboard. WebKit does not focus buttons on a click, so without this a
 * dialog has no opener to restore. A tap must not: the restored focus would
 * leave the button looking pressed, with its tooltip up, after the panel
 * closes on a phone.
 */
export function focusOpener(event: React.MouseEvent<HTMLElement>) {
  // A click from the keyboard has no detail; WebKit's clicks carry no pointer type
  if (event.detail !== 0 && lastPointerType() !== "mouse") return;
  event.currentTarget.focus({ preventScroll: true });
}

let pointerType: string | null = null;
function lastPointerType(): string | null {
  if (pointerType === null && typeof document !== "undefined") {
    pointerType = "mouse";
    document.addEventListener(
      "pointerdown",
      (event) => {
        pointerType = event.pointerType || "mouse";
      },
      { capture: true, passive: true },
    );
  }
  return pointerType;
}
/** Starts watching the pointer before the first bar click needs it */
export function watchReaderPointer() {
  lastPointerType();
}

export function ReaderBarItem({
  label,
  tooltip = label,
  keys,
  icon,
  onSelect,
  disabled,
  pressed,
}: {
  /** The accessible name; also the row's text in the More menu */
  label: string;
  tooltip?: string;
  keys?: string;
  icon: ReactNode;
  onSelect(event?: React.MouseEvent<HTMLElement>): void;
  disabled?: boolean;
  pressed?: boolean;
}) {
  const placement = useReaderBarPlacement();
  if (placement === "menu")
    return (
      <DropdownMenuItem
        icon={icon}
        disabled={disabled}
        shortcut={keys}
        onClick={() => onSelect()}
      >
        {label}
      </DropdownMenuItem>
    );
  return (
    <CapAligned height={32} coarseHeight={44}>
      <button
        type="button"
        onClick={(event) => {
          focusOpener(event);
          onSelect(event);
        }}
        aria-label={label}
        aria-pressed={pressed}
        data-tooltip={tooltip}
        data-tooltip-keys={keys}
        data-tooltip-side="bottom"
        disabled={disabled}
        className={READER_BAR_BUTTON}
      >
        {icon}
      </button>
    </CapAligned>
  );
}
