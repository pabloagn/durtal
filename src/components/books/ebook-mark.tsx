import { BookOpen } from "lucide-react";
import type { WorkEbookDTO } from "@/lib/ebooks/catalogue-dto";
import { readerEntryPolicy } from "@/lib/reader/entry-policy";
import {
  COVER_CHIP,
  COVER_CHIP_ICON,
  COVER_CHIP_STROKE,
  COVER_CHIP_TONE,
} from "./cover-chip";

/** The page supplies shared availability, never a linked-row count. */
export function EbookMark({ ebook }: { ebook: WorkEbookDTO | null }) {
  if (
    !ebook?.readable ||
    !ebook.readerPath ||
    !readerEntryPolicy(ebook.readerPath, null)
  )
    return null;
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
