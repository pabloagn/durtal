"use client";

import { useLocalStorage } from "@/lib/hooks/use-local-storage";
import { LibraryFilters } from "./filters";
import { LibraryView } from "@/components/books/library-view";
import type { ViewMode } from "@/components/books/view-mode-switcher";

interface BookItem {
  workId: string;
  slug: string;
  title: string;
  authorName: string;
  coverUrl?: string | null;
  publicationYear?: number | null;
  language?: string | null;
  instanceCount: number;
  rating?: number | null;
  catalogueStatus?: string | null;
}

export function LibraryShell({ books }: { books: BookItem[] }) {
  const [viewMode, setViewMode] = useLocalStorage<ViewMode>(
    "durtal-view-mode",
    "grid",
  );
  const [gridColumns, setGridColumns] = useLocalStorage(
    "durtal-grid-columns",
    6,
  );

  return (
    <>
      <LibraryFilters
        viewMode={viewMode}
        gridColumns={gridColumns}
        onViewModeChange={setViewMode}
        onGridColumnsChange={setGridColumns}
      />
      <LibraryView
        books={books}
        viewMode={viewMode}
        gridColumns={gridColumns}
      />
    </>
  );
}
