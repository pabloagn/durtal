"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useShortcut } from "@/components/shortcuts/shortcuts-provider";
import { setFavourite } from "@/lib/actions/favourites";
import { FAVOURITE_STAR_ID } from "@/components/shared/favourite-star";
import type { FavouriteEntity } from "@/lib/constants/favourites";

/** The keyboard shortcut that toggles the favourite on a detail page */
export const FAVOURITE_SHORTCUT = "f";

/** Registers F for the page while its own favourite star is shown */
function FavouriteShortcut({ run }: { run: () => void }) {
  useShortcut(FAVOURITE_SHORTCUT, "Add to or remove from favourites", run);
  return null;
}

const VARIANTS = {
  /** A 32px target around the 16px star (44px on touch): cards, rows, headers */
  icon: "action-control icon-hit hover:bg-glass-highlight active:bg-bg-tertiary/80",
  /** Legacy detail-page variant, now the same quiet 32px action family. */
  boxed:
    "action-control size-8 hover:bg-glass-highlight active:bg-bg-tertiary/80 pointer-coarse:size-11",
} as const;

/**
 * The favourite star of every item: Lucide `Star` (one shared symbol,
 * `favourite-star.tsx`), 1.5px stroke, 16px, `accent-gold`, filled when on. One click flips it at once and saves; a
 * failed save turns it back and says so.
 *
 * It saves through `setFavourite` for `target`, or through `onToggle` when
 * the item saves its favourite another way (a work's personal curation).
 */
export function FavouriteToggle({
  favourite,
  target,
  onToggle,
  name,
  variant = "icon",
  shortcut = false,
  className = "",
}: {
  favourite: boolean;
  target?: { entity: FavouriteEntity; id: string };
  /** Saves the new state; false when it failed (and the caller said so) */
  onToggle?: (next: boolean) => Promise<boolean>;
  /** The item's name, for screen readers: "Add Dune to favourites" */
  name?: string;
  variant?: keyof typeof VARIANTS;
  /** The page's own item: F toggles it, and the tooltip says so */
  shortcut?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const button = useRef<HTMLButtonElement>(null);
  const [pending, startTransition] = useTransition();
  const [on, setOn] = useState(favourite);
  // A refresh that brings a new value replaces the local one
  const [stored, setStored] = useState(favourite);
  if (stored !== favourite) {
    setStored(favourite);
    setOn(favourite);
  }

  async function save(next: boolean) {
    if (onToggle) return onToggle(next);
    if (!target) return false;
    try {
      await setFavourite(target.entity, target.id, next);
      router.refresh();
      return true;
    } catch {
      toast.error("Could not update the favourite. Try again.");
      return false;
    }
  }

  const tooltip = on ? "Remove from favourites" : "Add to favourites";
  const label = name
    ? on
      ? `Remove ${name} from favourites`
      : `Add ${name} to favourites`
    : tooltip;

  return (
    <>
      {shortcut && <FavouriteShortcut run={() => button.current?.click()} />}
      <button
        ref={button}
        type="button"
        aria-pressed={on}
        aria-label={label}
        data-tooltip={tooltip}
        data-tooltip-keys={shortcut ? FAVOURITE_SHORTCUT : undefined}
        disabled={pending}
        onClick={(event) => {
          // A star inside a clickable card never opens the card
          event.preventDefault();
          event.stopPropagation();
          const next = !on;
          setOn(next);
          startTransition(async () => {
            if (!(await save(next))) setOn(!next);
          });
        }}
        className={`${VARIANTS[variant]} text-accent-gold disabled:opacity-40${className ? ` ${className}` : ""}`}
      >
        <svg
          aria-hidden="true"
          className="block h-4 w-4"
          fill={on ? "currentColor" : "none"}
        >
          <use href={`#${FAVOURITE_STAR_ID}`} />
        </svg>
      </button>
    </>
  );
}
