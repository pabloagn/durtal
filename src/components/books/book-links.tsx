import {
  BOOK_LINK_SITES,
  parseBookLink,
  type BookLinkField,
} from "@/lib/validations/book-links";

// Monograms stand in for the site logos: "g" for Goodreads, "SG" for The StoryGraph.
const GLYPHS: Record<BookLinkField, React.ReactNode> = {
  goodreadsUrl: (
    <span className="font-serif text-[17px] leading-none -translate-y-[2px]">
      g
    </span>
  ),
  storygraphUrl: (
    <span className="font-sans text-[10px] font-semibold leading-none tracking-tight">
      SG
    </span>
  ),
};

interface BookLinksProps {
  goodreadsUrl?: string | null;
  storygraphUrl?: string | null;
}

/** Compact external links for the book header. Renders nothing when no link is set. */
export function BookLinks({ goodreadsUrl, storygraphUrl }: BookLinksProps) {
  const links = (
    [
      ["goodreadsUrl", goodreadsUrl],
      ["storygraphUrl", storygraphUrl],
    ] as const
  ).flatMap(([field, raw]) => {
    // Re-check on render so a bad stored value never becomes a live link.
    const parsed = parseBookLink(field, raw);
    return parsed.ok && parsed.value ? [{ field, href: parsed.value }] : [];
  });
  if (links.length === 0) return null;

  return (
    <div className="inline-flex items-center gap-1">
      {links.map(({ field, href }) => {
        const label = `Open on ${BOOK_LINK_SITES[field].label}`;
        return (
          <a
            key={field}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={label}
            title={label}
            className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-fg-muted transition-colors hover:bg-bg-tertiary hover:text-fg-primary focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent-rose"
          >
            <span aria-hidden className="inline-flex">
              {GLYPHS[field]}
            </span>
          </a>
        );
      })}
    </div>
  );
}
