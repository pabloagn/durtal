import { Skull } from "lucide-react";
import { MARKS } from "@/lib/constants/marks";
import { COVER_CHIP, COVER_CHIP_ICON } from "./cover-chip";

/** Skull shown on poison works, styled like the rare gem (`HuntBadge`). */
export function PoisonBadge({
  isPoison,
  cover = false,
}: {
  isPoison?: boolean;
  cover?: boolean;
}) {
  if (!isPoison) return null;
  const label = `${MARKS.poison.label} · ${MARKS.poison.hint}`;
  return (
    <span
      className={`text-accent-red ${cover ? COVER_CHIP : "inline-flex shrink-0 items-center justify-center"}`}
      data-tooltip={label}
      role="img"
      aria-label={label}
    >
      <Skull
        className={cover ? COVER_CHIP_ICON : "h-3.5 w-3.5"}
        strokeWidth={1.5}
        fill="currentColor"
        fillOpacity={0.18}
        aria-hidden="true"
      />
    </span>
  );
}
