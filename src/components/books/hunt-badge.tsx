import { Gem } from "lucide-react";
import type { HuntAssessment } from "@/lib/constants/hunting";
import { MARKS } from "@/lib/constants/marks";
import { COVER_CHIP, COVER_CHIP_ICON, COVER_CHIP_STROKE, COVER_CHIP_TONE } from "./cover-chip";

export function HuntBadge({
  isRare,
  huntAssessedOn,
  cover = false,
}: HuntAssessment & { cover?: boolean }) {
  if (!isRare) return null;
  const label = huntAssessedOn
    ? `${MARKS.rare.label} · marked ${huntAssessedOn}`
    : MARKS.rare.label;
  return (
    <span
      className={cover ? `${COVER_CHIP_TONE.gold} ${COVER_CHIP}` : "inline-flex shrink-0 items-center justify-center text-accent-gold"}
      data-tooltip={label}
      role="img"
      aria-label={label}
    >
      <Gem
        className={cover ? COVER_CHIP_ICON : "h-3.5 w-3.5"}
        strokeWidth={cover ? COVER_CHIP_STROKE : 1.5}
        fill="currentColor"
        fillOpacity={0.18}
        aria-hidden="true"
      />
    </span>
  );
}
