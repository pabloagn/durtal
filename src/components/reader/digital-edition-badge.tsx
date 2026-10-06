import { BookOpen } from "lucide-react";
import { COVER_CHIP, COVER_CHIP_ICON, COVER_CHIP_STROKE, COVER_CHIP_TONE } from "@/components/books/cover-chip";

/** The cover mark of a book with an e-book linked to one of its copies */
export function DigitalEditionBadge() {
  return (
    <div
      className={COVER_CHIP}
      role="img"
      aria-label="eBook available"
      data-tooltip="eBook available"
    >
      <BookOpen
        className={`${COVER_CHIP_ICON} ${COVER_CHIP_TONE.blue}`}
        strokeWidth={COVER_CHIP_STROKE}
        aria-hidden="true"
      />
    </div>
  );
}
