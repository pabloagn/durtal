"use client";

import { Pagination, type PaginationData } from "@/components/shared/pagination";
import dynamic from "next/dynamic";
import {
  usePreference,
  useViewModePreference,
} from "@/lib/hooks/use-preference";
import { LIBRARY_VIEW_MODES } from "./view-modes";
import { useLibrarySelection } from "@/lib/hooks/use-library-selection";
import { LibraryView } from "@/components/books/library-view";
import { BulkActionToolbar } from "@/components/books/bulk-action-toolbar";
import { CheckSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CoverCrop } from "@/components/books/book-card";
import { getWorksForTimeline } from "@/lib/actions/work-timeline";
import { useViewData } from "@/lib/hooks/use-view-data";
import { LIST_PREFERENCES } from "@/lib/preferences";
import { ViewStatus } from "@/components/shared/view-status";

// Dynamic import — timeline pulls in canvas + WebGL-adjacent code; skip SSR
const WorkTimeline = dynamic(
  () =>
    import("@/components/timeline/work-timeline").then((m) => ({
      default: m.WorkTimeline,
    })),
  {
    ssr: false,
    loading: () => <ViewStatus label="Loading timeline..." className="h-[400px]" />,
  },
);

// ── Types ────────────────────────────────────────────────────────────────────

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
}

interface LibraryShellProps {
  books: BookItem[];
  /** Search and filters for the timeline, which loads only when shown */
  timelineQuery: Parameters<typeof getWorksForTimeline>[0];
  pagination: PaginationData;
}

// ── Component ────────────────────────────────────────────────────────────────

export function LibraryShell({ books, timelineQuery, pagination }: LibraryShellProps) {
  const [viewMode] = useViewModePreference(
    LIST_PREFERENCES.library.view.key,
    LIBRARY_VIEW_MODES,
    LIST_PREFERENCES.library.view.fallback,
  );
  const [gridColumns] = usePreference(
    LIST_PREFERENCES.library.grid.key,
    LIST_PREFERENCES.library.grid.fallback,
  );

  const selection = useLibrarySelection();

  const allIds = books.map((b) => b.workId);
  const titleMap = new Map(books.map((b) => [b.workId, b.title]));

  const isTimeline = viewMode === "timeline";
  const timelineWorks = useViewData(isTimeline, timelineQuery, getWorksForTimeline);

  return (
    <>
      {/* Select button — hidden in timeline mode */}
      {!isTimeline && (
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
      )}

      {/* Timeline view */}
      {isTimeline && (
        <div className="h-[calc(100vh-220px)] min-h-[400px]">
          {timelineWorks.status === "ready" ? (
            <WorkTimeline works={timelineWorks.data} />
          ) : timelineWorks.status === "error" ? (
            <ViewStatus
              label="Could not load the timeline."
              onRetry={timelineWorks.retry}
              className="h-[400px]"
            />
          ) : (
            <ViewStatus label="Loading timeline..." className="h-[400px]" />
          )}
        </div>
      )}

      {!isTimeline && <Pagination {...pagination} noun="books" compact />}

      {/* Standard list/grid/detailed views */}
      {!isTimeline && (
        <LibraryView
          books={books}
          viewMode={viewMode}
          gridColumns={gridColumns}
          isSelecting={selection.isSelecting}
          selectedIds={selection.selectedIds}
          onSelect={selection.toggleSelection}
        />
      )}

      {!isTimeline && (
        <BulkActionToolbar
          selectedCount={selection.selectionCount}
          selectedIds={selection.selectedIds}
          selectedTitles={titleMap}
          allIds={allIds}
          onSelectAll={selection.selectAll}
          onDeselectAll={selection.deselectAll}
          onExitSelection={selection.exitSelectionMode}
        />
      )}

      {!isTimeline && <Pagination {...pagination} noun="books" />}
    </>
  );
}
