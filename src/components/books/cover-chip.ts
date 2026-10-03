/**
 * One look for every indicator on a book cover (status, rating, priority,
 * marks, digital edition): the same height, border, background, radius and
 * corner inset, so the corners line up. Sizes follow the card width, with
 * the card's 220px container query.
 */
export const COVER_CHIP =
  "flex h-4 min-w-4 shrink-0 items-center justify-center rounded-[2px] border border-white/15 bg-black/55 backdrop-blur-md @[220px]:h-5 @[220px]:min-w-5";

/** Text chips (status, rating): side padding and small type */
export const COVER_CHIP_TEXT =
  "px-0.5 font-mono text-micro leading-none tracking-wider @[220px]:px-1.5";

/** An icon inside a chip */
export const COVER_CHIP_ICON = "h-2.5 w-2.5 @[220px]:h-3 @[220px]:w-3";

/** The corners: 4px in, 8px on wide cards; chips in a corner sit 4px apart */
export const COVER_CORNER = {
  topLeft:
    "absolute left-1 top-1 flex items-center gap-1 @[220px]:left-2 @[220px]:top-2",
  topRight:
    "absolute right-1 top-1 flex items-center gap-1 @[220px]:right-2 @[220px]:top-2",
  bottomLeft:
    "absolute bottom-1 left-1 flex items-center gap-1 @[220px]:bottom-2 @[220px]:left-2",
} as const;

/** Text color per badge variant; the chip background stays the same */
export const COVER_CHIP_TONE = {
  muted: "text-fg-secondary",
  blue: "text-accent-blue",
  gold: "text-accent-gold",
  rose: "text-accent-rose-text",
  sage: "text-accent-sage",
  red: "text-accent-red-text",
} as const;
