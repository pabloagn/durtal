/**
 * A cover's blank when the book (or film, perfume, painting) has none: the
 * title's first letter in the serif, faint, the same on every page (docs/03,
 * Cards without a photo). Decoration: the title is always in the text beside
 * it. The box it sits in is the `cover` size container, so the letter keeps
 * to the type scale as the box grows: 14px in a thumbnail, 21px from 56px
 * wide, 38px from 120px (a card's cover).
 */
export function CoverLetter({ title }: { title: string }) {
  return (
    <span
      aria-hidden="true"
      data-decorative=""
      className="font-serif text-xs leading-none text-fg-muted/30 @[56px]/cover:text-lg @[120px]/cover:text-3xl"
    >
      {Array.from(title.trim())[0] ?? ""}
    </span>
  );
}

/** The blank cover's box: centers the letter and names the `cover` container */
export const COVER_BLANK = "@container/cover flex items-center justify-center";
