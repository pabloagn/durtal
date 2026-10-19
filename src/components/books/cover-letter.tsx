/**
 * The letter a blank cover shows: the title's first letter or digit,
 * uppercased, after any leading quote marks and punctuation ("«Quoted»"
 * shows Q, "études" É, "1984" 1). A title with none shows no letter. An
 * accent written as a separate mark stays on its letter.
 */
export function coverLetter(title: string) {
  const first = title.normalize("NFC").match(/[\p{L}\p{Nd}]\p{M}*/u)?.[0] ?? "";
  const upper = first.toUpperCase();
  // "ß" uppercases to "SS": a letter that would become two stays as written
  return Array.from(upper).length > Array.from(first).length ? first : upper;
}

/**
 * A cover's blank when the book (or film, perfume, painting) has none: the
 * title's first letter in the serif, faint, the same on every page (docs/03,
 * Cards without a photo). Decoration: the title is always in the text beside
 * it. The box it sits in is the `cover` size container, so the letter keeps
 * to the type scale as the box grows: 14px in a thumbnail, 21px from 56px
 * wide, 38px from 120px (a card's cover). Its line is trimmed to the cap
 * height and baseline, so the box centers the capital itself: the serif's
 * line box would put it 0.1em (1.4 to 3.8px) above the middle. The classes
 * are `cover-letter` in globals.css.
 */
export function CoverLetter({ title }: { title: string }) {
  return (
    <span
      aria-hidden="true"
      data-decorative=""
      className="cover-letter"
    >
      {coverLetter(title)}
    </span>
  );
}

/** The blank cover's box: centers the letter and names the `cover` container */
export const COVER_BLANK = "@container/cover flex items-center justify-center";
