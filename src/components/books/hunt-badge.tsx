import { Gem } from "lucide-react";
import type { HuntAssessment } from "@/lib/constants/hunting";

export function HuntBadge({
  isRare,
  huntAssessedOn,
  cover = false,
}: HuntAssessment & { cover?: boolean }) {
  if (!isRare) return null;
  const label = huntAssessedOn ? `Rare · marked ${huntAssessedOn}` : "Rare";
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center text-accent-gold ${cover ? "h-4 w-4 rounded-[2px] border border-white/15 bg-black/50 backdrop-blur-md @[220px]:h-5 @[220px]:w-5" : ""}`}
      title={label}
      role="img"
      aria-label={label}
    >
      <Gem
        className={
          cover ? "h-2.5 w-2.5 @[220px]:h-3.5 @[220px]:w-3.5" : "h-3.5 w-3.5"
        }
        strokeWidth={1.5}
        fill="currentColor"
        fillOpacity={0.18}
        aria-hidden="true"
      />
    </span>
  );
}
