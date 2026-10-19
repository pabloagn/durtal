import type { SpriteIconName } from "@/components/ui/sprite-icon";

/**
 * A mark's icon on a cover chip, from the icon sprite: Lucide's paths at the
 * chip's size and stroke (`cover-mark`). The gem and the skull are tinted
 * inside, as their Lucide versions were.
 */
export function CoverMark({ name, filled = false, className = "" }: { name: SpriteIconName; filled?: boolean; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={`cover-mark ${className}`}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      fillOpacity={filled ? 0.18 : undefined}
    >
      <use href={`#i-${name}`} />
    </svg>
  );
}
