/**
 * One look for every indicator on a cover: the same height, border,
 * background, radius and corner inset, so the corners line up. Sizes follow
 * the card width, with the card's 220px container query.
 *
 * Each chip is glass on the image (`glass-chip`): the cover shows through,
 * blurred and dimmed, and an icon keeps 3:1 and a label 4.5:1 even on a
 * white cover. Labels are `fg-primary`; a tone colors the icon only. Book
 * covers carry
 * only the marks that make a copy special (rare, poison, digital edition);
 * status and rating sit in the card's info row (`CardStatus`).
 */
export const COVER_CHIP =
  "flex h-4 min-w-4 shrink-0 items-center justify-center rounded-[2px] border glass-chip @[220px]:h-5 @[220px]:min-w-5";

/** Text chips (status, rating): side padding and small type */
export const COVER_CHIP_TEXT =
  "px-0.5 font-mono text-micro leading-none tracking-wider @[220px]:px-1.5";

/** An icon inside a chip */
export const COVER_CHIP_ICON = "h-2.5 w-2.5 @[220px]:h-3 @[220px]:w-3";

/**
 * The stroke of a chip icon, in Lucide's 24-unit box: 1.25px at 10px and
 * 1.5px at 12px. The usual 1.5 would draw a faint 0.6px line at this size.
 */
export const COVER_CHIP_STROKE = 3;

/** The corners: 4px in, 8px on wide cards; chips in a corner sit 4px apart */
export const COVER_CORNER = {
  topLeft:
    "absolute left-1 top-1 flex items-center gap-1 @[220px]:left-2 @[220px]:top-2",
  topRight:
    "absolute right-1 top-1 flex items-center gap-1 @[220px]:right-2 @[220px]:top-2",
  bottomLeft:
    "absolute bottom-1 left-1 flex items-center gap-1 @[220px]:bottom-2 @[220px]:left-2",
} as const;

/** Icon color per badge variant: the accent lit for glass (`--color-chip-*`) */
export const COVER_CHIP_TONE = {
  muted: "text-fg-primary",
  blue: "text-chip-blue",
  gold: "text-chip-gold",
  rose: "text-chip-rose",
  sage: "text-chip-sage",
  red: "text-chip-red",
} as const;
