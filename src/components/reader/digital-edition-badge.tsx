import { BookOpen } from "lucide-react";
import { COVER_CHIP, COVER_CHIP_ICON } from "@/components/books/cover-chip";

/**
 * Small badge overlaid on book cards to indicate a digital
 * edition is available in the Calibre library.
 */
export function DigitalEditionBadge() {
  return (
    <div
      className={COVER_CHIP}
      title="Digital edition available"
    >
      <BookOpen
        className={`${COVER_CHIP_ICON} text-accent-blue`}
        strokeWidth={1.5}
      />
    </div>
  );
}
