import { CapAligned } from "@/components/shared/cap-aligned";
import {
  BOOK_LINK_SITES,
  parseBookLink,
  type BookLinkField,
} from "@/lib/validations/book-links";

// Monograms stand in for the site logos: "g" for Goodreads, "SG" for The StoryGraph.
const GLYPHS: Record<BookLinkField, React.ReactNode> = {
  goodreadsUrl: (
    <span className="font-serif text-sm leading-none -translate-y-[1.5px]">
      g
    </span>
  ),
  storygraphUrl: (
    <span className="font-sans text-micro font-semibold leading-none tracking-tight">
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

  // The links sit on the cap-height center of the row's text
  return (
    <CapAligned height={28}>
      <div className="flex items-center gap-1">
        {links.map(({ field, href }) => {
          const label = `Open on ${BOOK_LINK_SITES[field].label}`;
          return (
            <a
              key={field}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={label}
              data-tooltip={label}
              className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-fg-secondary transition-colors hover:bg-bg-tertiary hover:text-fg-primary"
            >
              <span aria-hidden className="inline-flex">
                {GLYPHS[field]}
              </span>
            </a>
          );
        })}
      </div>
    </CapAligned>
  );
}
