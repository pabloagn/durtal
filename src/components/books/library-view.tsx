"use client";

import { useLocalStorage } from "@/lib/hooks/use-local-storage";
import { BookGrid } from "./book-grid";
import { BookList } from "./book-list";
import {
  BookDataTable,
  ALL_COLUMNS,
  type DetailedBookItem,
} from "./book-data-table";
import type { ViewMode } from "./view-mode-switcher";

interface BookItem {
  workId: string;
  title: string;
  authorName: string;
  coverUrl?: string | null;
  publicationYear?: number | null;
  language?: string | null;
  instanceCount: number;
  rating?: number | null;
  publisher?: string | null;
  binding?: string | null;
  pages?: number | null;
  isbn?: string | null;
  locationName?: string | null;
  format?: string | null;
  condition?: string | null;
  addedDate?: string | null;
}

interface LibraryViewProps {
  books: BookItem[];
  viewMode: ViewMode;
  gridColumns: number;
}

const DEFAULT_COLUMN_CONFIG = ALL_COLUMNS.map((c) => ({
  key: c.key,
  visible: c.defaultVisible,
  order: c.defaultOrder,
}));

export function LibraryView({ books, viewMode, gridColumns }: LibraryViewProps) {
  const [columnConfig, setColumnConfig] = useLocalStorage(
    "durtal-column-config",
    DEFAULT_COLUMN_CONFIG,
  );

  switch (viewMode) {
    case "grid":
      return <BookGrid books={books} columns={gridColumns} />;
    case "list":
      return <BookList books={books} />;
    case "detailed":
      return (
        <BookDataTable
          books={books as DetailedBookItem[]}
          columns={columnConfig}
          onColumnsChange={setColumnConfig}
        />
      );
  }
}
