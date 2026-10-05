"use client";

import { usePreference } from "@/lib/hooks/use-preference";
import { BookGrid } from "./book-grid";
import { BookList } from "./book-list";
import {
  BookDataTable,
  ALL_COLUMNS,
  type DetailedBookItem,
} from "./book-data-table";
import type { ViewMode } from "./view-mode-switcher";
import type { CoverCrop } from "./book-card";
import { LIST_PREFERENCES } from "@/lib/preferences";
import { Mosaic, MosaicImage, mosaicPerRow } from "@/components/shared/mosaic";
import { TitleCard } from "@/components/shared/no-photo";

interface BookItem {
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
  isFavourite?: boolean;
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
  const [columnConfig, setColumnConfig] = usePreference(
    LIST_PREFERENCES.library.columns.key,
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
    case "mosaic":
      return (
        <Mosaic
          aspect={2 / 3}
          perRow={mosaicPerRow(gridColumns)}
          isSelecting={isSelecting}
          selectedIds={selectedIds}
          onSelect={onSelect}
          items={books.map((book) => ({
            key: book.workId,
            href: `/library/${book.slug}`,
            title: book.title,
            subtitle: book.authorNames?.join(", ") || book.authorName || null,
            aspect: 2 / 3,
            media: (
              <MosaicImage
                src={book.coverUrl}
                crop={book.coverCrop}
                tone={book.coverTone}
                fallback={<TitleCard title={book.title} year={book.publicationYear ? String(book.publicationYear) : null} />}
              />
            ),
          }))}
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
