import { Star } from "lucide-react";
import { CapAligned } from "@/components/shared/cap-aligned";
import { PRIORITY_CONFIG, STATUS_CONFIG } from "@/lib/constants/catalogue";
import type { AcquisitionPriority, CatalogueStatus } from "@/lib/types";

/** The dot color per status variant (fills, so the lighter rose and red) */
const STATUS_DOT = {
  muted: "bg-fg-secondary",
  blue: "bg-accent-blue",
  gold: "bg-accent-gold",
  rose: "bg-accent-rose-text",
  sage: "bg-accent-sage",
  red: "bg-accent-red-text",
} as const;

/**
 * A book's status in a card's info row: a colored dot and the label. The
 * tooltip adds the acquisition priority and the number of copies, which the
 * card no longer shows on the cover.
 */
export function CardStatus({
  status,
  priority,
  copies,
}: {
  status?: string | null;
  priority?: string | null;
  copies?: number;
}) {
  const info = status ? STATUS_CONFIG[status as CatalogueStatus] : null;
  if (!info) return null;
  const priorityLabel =
    priority && priority !== "none"
      ? PRIORITY_CONFIG[priority as AcquisitionPriority]?.label
      : null;
  const details = [
    info.label,
    priorityLabel && `${priorityLabel} priority`,
    copies ? `${copies} ${copies === 1 ? "copy" : "copies"}` : null,
  ].filter(Boolean);
  return (
    <span
      className="flex min-w-0 gap-1.5 text-micro text-fg-secondary"
      data-tooltip={details.join(" · ")}
    >
      <CapAligned height={6}>
        <span
          aria-hidden="true"
          className={`block h-1.5 w-1.5 rounded-full ${STATUS_DOT[info.variant]}`}
        />
      </CapAligned>
      <span className="truncate">{info.label}</span>
    </span>
  );
}

/** A rating out of 5 in a card's info row: a gold star and the number. */
export function CardRating({ rating }: { rating?: number | null }) {
  if (!rating) return null;
  return (
    <span
      className="flex shrink-0 gap-1 font-mono text-micro text-accent-gold"
      role="img"
      aria-label={`Rated ${rating} out of 5`}
      data-tooltip={`Rated ${rating}/5`}
    >
      <CapAligned height={12}>
        <Star
          className="block h-3 w-3"
          strokeWidth={1.5}
          fill="currentColor"
          fillOpacity={0.25}
          aria-hidden="true"
        />
      </CapAligned>
      <span>{rating}</span>
    </span>
  );
}
