import { BookCard } from "./book-card";
import type { CoverCrop } from "./book-card";

interface BookGridItem {
  workId: string;
  slug: string;
  title: string;
  authorName: string;
  coverUrl?: string | null;
  coverCrop?: CoverCrop | null;
  publicationYear?: number | null;
  language?: string | null;
  instanceCount: number;
  rating?: number | null;
  catalogueStatus?: string | null;
  acquisitionPriority?: string | null;
  primaryEditionId?: string | null;
  hasDigitalEdition?: boolean;
}

const COL_CLASSES: Record<number, string> = {
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
  5: "grid-cols-5",
  6: "grid-cols-6",
  7: "grid-cols-7",
  8: "grid-cols-8",
};

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
  const colClass = COL_CLASSES[columns] ?? "grid-cols-6";
  return (
    <div className={`grid gap-4 ${colClass}`}>
      {books.map((book) => (
        <BookCard
          key={book.workId}
          {...book}
          isSelecting={isSelecting}
          isSelected={selectedIds?.has(book.workId) ?? false}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
