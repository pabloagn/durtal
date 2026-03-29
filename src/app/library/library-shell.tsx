"use client";

import { useLocalStorage } from "@/lib/hooks/use-local-storage";
import { useLibrarySelection } from "@/lib/hooks/use-library-selection";
import { LibraryView } from "@/components/books/library-view";
import { BulkActionToolbar } from "@/components/books/bulk-action-toolbar";
import { CheckSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ViewMode } from "@/components/books/view-mode-switcher";
import type { CoverCrop } from "@/components/books/book-card";

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
}

export function LibraryShell({ books }: { books: BookItem[] }) {
  const [viewMode] = useLocalStorage<ViewMode>(
    "durtal-view-mode",
    "grid",
  );
  const [gridColumns] = useLocalStorage(
    "durtal-grid-columns",
    6,
  );

  const selection = useLibrarySelection();

  const allIds = books.map((b) => b.workId);
  const titleMap = new Map(books.map((b) => [b.workId, b.title]));

  return (
    <>
      {/* Select button */}
      <div className="mb-4 flex justify-end">
        <Button
          variant={selection.isSelecting ? "primary" : "ghost"}
          size="sm"
          onClick={() =>
            selection.isSelecting
              ? selection.exitSelectionMode()
              : selection.enterSelectionMode()
          }
        >
          <CheckSquare className="h-3.5 w-3.5" strokeWidth={1.5} />
          {selection.isSelecting ? "Cancel" : "Select"}
        </Button>
      </div>

      <LibraryView
        books={books}
        viewMode={viewMode}
        gridColumns={gridColumns}
        isSelecting={selection.isSelecting}
        selectedIds={selection.selectedIds}
        onSelect={selection.toggleSelection}
      />
      <BulkActionToolbar
        selectedCount={selection.selectionCount}
        selectedIds={selection.selectedIds}
        selectedTitles={titleMap}
        allIds={allIds}
        onSelectAll={selection.selectAll}
        onDeselectAll={selection.deselectAll}
        onExitSelection={selection.exitSelectionMode}
      />
    </>
  );
}
