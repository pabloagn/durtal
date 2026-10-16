/**
 * Icons drawn once and reused (page weight, SLN-381). A card's copy button and
 * actions menu repeat on every card of a list: their Lucide markup, about 380
 * bytes each, became most of /library's HTML. `IconSprite` holds the paths
 * once, in the root layout; `SpriteIcon` points at one. Same Lucide paths,
 * same 1.5px stroke (`sprite-icon` in globals.css).
 */

const ICONS = {
  // lucide: copy
  copy: (
    <>
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </>
  ),
  // lucide: ellipsis-vertical
  "ellipsis-vertical": (
    <>
      <circle cx="12" cy="12" r="1" />
      <circle cx="12" cy="5" r="1" />
      <circle cx="12" cy="19" r="1" />
    </>
  ),
  // The rows of the reading journal and the suggestions (SLN-809)
  // lucide: ellipsis
  ellipsis: (
    <>
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
      <circle cx="5" cy="12" r="1" />
    </>
  ),
  // lucide: list-plus
  "list-plus": <path d="M16 5H3M11 12H3M16 19H3M18 9v6M21 12h-6" />,
  // lucide: clock
  clock: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </>
  ),
  // lucide: book-text
  "book-text": <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20M8 11h8M8 7h6" />,
  // lucide: tablet
  tablet: (
    <>
      <rect width="16" height="20" x="4" y="2" rx="2" ry="2" />
      <line x1="12" x2="12.01" y1="18" y2="18" />
    </>
  ),
  // lucide: headphones
  headphones: <path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3" />,
} as const;

/** Lucide's star, for `RatingStars`: a path, not a symbol, so a `<use>` draws it in the stars' own space */
export const STAR_PATH =
  "M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z";

export type SpriteIconName = keyof typeof ICONS;

/** Once per page, in the root layout */
export function IconSprite() {
  return (
    // Not display:none: some browsers then draw nothing through <use>
    <svg aria-hidden="true" className="absolute h-0 w-0 overflow-hidden">
      {Object.entries(ICONS).map(([name, paths]) => (
        <symbol key={name} id={`i-${name}`} viewBox="0 0 24 24">
          {paths}
        </symbol>
      ))}
      <defs>
        <path id="i-star" d={STAR_PATH} />
        {/* The left half of a star, in the star's own space */}
        <clipPath id="i-star-half">
          <rect width={12} height={24} />
        </clipPath>
      </defs>
    </svg>
  );
}

/** One icon from the sprite; size it with classes, as a Lucide icon */
export function SpriteIcon({ name, className = "" }: { name: SpriteIconName; className?: string }) {
  return (
    <svg aria-hidden="true" className={`sprite-icon ${className}`} viewBox="0 0 24 24">
      <use href={`#i-${name}`} />
    </svg>
  );
}
