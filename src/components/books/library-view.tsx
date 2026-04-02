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
import type { CoverCrop } from "./book-card";

interface BookItem {
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
  isSelecting?: boolean;
  selectedIds?: Set<string>;
  onSelect?: (workId: string) => void;
}

const DEFAULT_COLUMN_CONFIG = ALL_COLUMNS.map((c) => ({
  key: c.key,
  visible: c.defaultVisible,
  order: c.defaultOrder,
}));

export function LibraryView({ books, viewMode, gridColumns, isSelecting, selectedIds, onSelect }: LibraryViewProps) {
  const [columnConfig, setColumnConfig] = useLocalStorage(
    "durtal-column-config",
    DEFAULT_COLUMN_CONFIG,
  );

  switch (viewMode) {
    case "grid":
      return (
        <BookGrid
          books={books}
          columns={gridColumns}
          isSelecting={isSelecting}
          selectedIds={selectedIds}
          onSelect={onSelect}
        />
      );
    case "list":
      return (
        <BookList
          books={books}
          isSelecting={isSelecting}
          selectedIds={selectedIds}
          onSelect={onSelect}
        />
      );
    case "detailed":
      return (
        <BookDataTable
          books={books as DetailedBookItem[]}
          columns={columnConfig}
          onColumnsChange={setColumnConfig}
          isSelecting={isSelecting}
          selectedIds={selectedIds}
          onSelect={onSelect}
        />
      );
    case "map":
    case "timeline":
      return null;
  }
}
