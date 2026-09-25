import { Gem } from "lucide-react";
import type { HuntAssessment } from "@/lib/constants/hunting";

export function HuntBadge({ isRare, huntAssessedOn }: HuntAssessment) {
  if (!isRare) return null;
  const label = huntAssessedOn ? `Rare · marked ${huntAssessedOn}` : "Rare";
  return (
    <span
      className="inline-flex shrink-0 items-center text-accent-gold"
      title={label}
      role="img"
      aria-label={label}
    >
      <Gem
        className="h-3.5 w-3.5"
        strokeWidth={1.5}
        fill="currentColor"
        fillOpacity={0.18}
        aria-hidden="true"
      />
    </span>
  );
}
