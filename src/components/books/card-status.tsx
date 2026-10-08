import { CapAligned } from "@/components/shared/cap-aligned";
import { FAVOURITE_STAR_ID } from "@/components/shared/favourite-star";
import { PRIORITY_CONFIG, STATUS_CONFIG } from "@/lib/constants/catalogue";
import type { AcquisitionPriority, CatalogueStatus } from "@/lib/types";
import { formatRating } from "@/lib/utils/rating";
import { cardReadingLabel, cardReadingTooltip, type CardReadingValue } from "@/lib/reading/card";

/** The dot color per status variant (fills, so the legible interaction and status colours) */
const STATUS_DOT = {
  muted: "bg-fg-secondary",
  blue: "bg-accent-blue",
  gold: "bg-accent-gold",
  accent: "bg-accent-primary",
  sage: "bg-accent-sage",
  red: "bg-accent-red-text",
} as const;

/** The status tooltip: the label, the acquisition priority and the number of copies */
function statusDetails(status?: string | null, priority?: string | null, copies?: number) {
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
  return { info, tooltip: details.join(" · ") };
}

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
  const details = statusDetails(status, priority, copies);
  if (!details) return null;
  return (
    <span
      className="relative z-20 flex min-w-0 gap-1.5 text-micro text-fg-secondary"
      data-tooltip={details.tooltip}
    >
      <CapAligned height={6}>
        <span
          aria-hidden="true"
          className={`block h-1.5 w-1.5 rounded-full ${STATUS_DOT[details.info.variant]}`}
        />
      </CapAligned>
      <span className="truncate">{details.info.label}</span>
    </span>
  );
}

/**
 * A book being read, in the status slot of a card's info row (SLN-449): a
 * blue dot for reading, a secondary one for paused, and "Reading 44%". The
 * tooltip is the status's with the reading after it.
 */
export function CardReading({
  reading,
  status,
  priority,
  copies,
}: {
  reading: CardReadingValue;
  status?: string | null;
  priority?: string | null;
  copies?: number;
}) {
  const details = statusDetails(status, priority, copies);
  return (
    <span
      className="relative z-20 flex min-w-0 gap-1.5 text-micro text-fg-secondary"
      data-tooltip={cardReadingTooltip(details?.tooltip ?? "", reading)}
      data-card-reading={reading.state}
    >
      <CapAligned height={6}>
        <span
          aria-hidden="true"
          className={`block h-1.5 w-1.5 rounded-full ${reading.state === "reading" ? "bg-accent-blue" : "bg-fg-secondary"}`}
        />
      </CapAligned>
      <span className="truncate">{cardReadingLabel(reading)}</span>
    </span>
  );
}

/** A rating out of 5 in a card's info row: a gold star and the number. */
export function CardRating({ rating }: { rating?: number | null }) {
  if (!rating) return null;
  return (
    <span
      className="relative z-20 flex shrink-0 gap-1 font-mono text-micro text-accent-gold"
      role="img"
      aria-label={`Rated ${formatRating(rating)} out of 5`}
      data-tooltip={`Rated ${formatRating(rating)}/5`}
    >
      <CapAligned height={12}>
        {/* The page's star symbol: one path for a grid of 48 cards */}
        <svg className="block h-3 w-3" fill="currentColor" fillOpacity={0.25} aria-hidden="true">
          <use href={`#${FAVOURITE_STAR_ID}`} />
        </svg>
      </CapAligned>
      <span>{formatRating(rating)}</span>
    </span>
  );
}
