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
} as const;

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
