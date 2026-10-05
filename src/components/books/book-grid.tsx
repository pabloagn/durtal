import { COL_CLASSES, maxCardWidth } from "@/components/shared/grid-columns";
import { BookCard } from "./book-card";
import type { CoverCrop } from "./book-card";
import type { CardReadingValue } from "@/lib/reading/card";

interface BookGridItem {
  workId: string;
  slug: string;
  title: string;
  authorName: string;
  authorNames?: string[];
  coverUrl?: string | null;
  coverCrop?: CoverCrop | null;
  coverTone?: string | null;
  publicationYear?: number | null;
  language?: string | null;
  instanceCount: number;
  rating?: number | null;
  catalogueStatus?: string | null;
  isRare?: boolean;
  huntAssessedOn?: string | null;
  isPoison?: boolean;
  acquisitionPriority?: string | null;
  primaryEditionId?: string | null;
  hasDigitalEdition?: boolean;
  /** An open reading (SLN-449): the card shows "Reading 44%" */
  reading?: CardReadingValue;
}

export function BookGrid({
  books,
  columns = 6,
  isSelecting = false,
  selectedIds,
  onSelect,
}: {
  books: BookGridItem[];
  columns?: number;
  isSelecting?: boolean;
  selectedIds?: Set<string>;
  onSelect?: (workId: string) => void;
}) {
  const colClass = COL_CLASSES[columns] ?? COL_CLASSES[6];
  // Covers come in a few widths; the browser picks one for the widest card
  const coverSizes = `${maxCardWidth(columns)}px`;
  return (
    <div className="@container">
      <div className={`grid gap-4 ${colClass}`}>
        {books.map((book, i) => (
          <BookCard
            key={book.workId}
            {...book}
            coverSizes={coverSizes}
            coverPriority={i < columns}
            isSelecting={isSelecting}
            isSelected={selectedIds?.has(book.workId) ?? false}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}
