import { BookOpen } from "lucide-react";
import { COVER_CHIP, COVER_CHIP_ICON, COVER_CHIP_STROKE, COVER_CHIP_TONE } from "@/components/books/cover-chip";

/**
 * Small badge overlaid on book cards to indicate a digital
 * edition is available in the Calibre library.
 */
export function DigitalEditionBadge() {
  return (
    <div
      className={COVER_CHIP}
      role="img"
      aria-label="Digital edition available"
      data-tooltip="Digital edition available"
    >
      <BookOpen
        className={`${COVER_CHIP_ICON} ${COVER_CHIP_TONE.blue}`}
        strokeWidth={COVER_CHIP_STROKE}
        aria-hidden="true"
      />
    </div>
  );
}
