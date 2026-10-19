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
 *
 * The chip and its icon are one class each (`cover-chip`, `cover-chip-icon`
 * in globals.css), and the book marks draw from the icon sprite
 * (`CoverMark`): a shelf repeats them on every card (SLN-1163).
 */
export const COVER_CHIP = "cover-chip";

/** Text chips (status, rating): side padding and small type */
export const COVER_CHIP_TEXT =
  "px-0.5 font-mono text-micro leading-none tracking-wider @[220px]:px-1.5";

/** An icon inside a chip */
export const COVER_CHIP_ICON = "cover-chip-icon";

/** The corners: 4px in, 8px on wide cards; chips in a corner sit 4px apart (`cover-corner-*` in globals.css) */
export const COVER_CORNER = {
  topLeft: "cover-corner-tl",
  topRight: "cover-corner-tr",
  bottomLeft: "cover-corner-bl",
} as const;

/** Icon color per badge variant: the accent lit for glass (`--color-chip-*`) */
export const COVER_CHIP_TONE = {
  muted: "text-fg-primary",
  blue: "text-chip-blue",
  gold: "text-chip-gold",
  accent: "text-chip-accent",
  sage: "text-chip-sage",
  red: "text-chip-red",
} as const;
