import { Gem } from "lucide-react";
import type { HuntAssessment } from "@/lib/constants/hunting";
import { MARKS } from "@/lib/constants/marks";
import { COVER_CHIP, COVER_CHIP_ICON } from "./cover-chip";

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
      className={`text-accent-gold ${cover ? COVER_CHIP : "inline-flex shrink-0 items-center justify-center"}`}
      title={label}
      role="img"
      aria-label={label}
    >
      <Gem
        className={cover ? COVER_CHIP_ICON : "h-3.5 w-3.5"}
        strokeWidth={1.5}
        fill="currentColor"
        fillOpacity={0.18}
        aria-hidden="true"
      />
    </span>
  );
}
