import { BookCard } from "./book-card";

interface BookGridItem {
  workId: string;
  title: string;
  authorName: string;
  coverUrl?: string | null;
  publicationYear?: number | null;
  language?: string | null;
  instanceCount: number;
  rating?: number | null;
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
}: {
  books: BookGridItem[];
  columns?: number;
}) {
  const colClass = COL_CLASSES[columns] ?? "grid-cols-6";
  return (
    <div className={`grid gap-4 ${colClass}`}>
      {books.map((book) => (
        <BookCard key={book.workId} {...book} />
      ))}
    </div>
  );
}
