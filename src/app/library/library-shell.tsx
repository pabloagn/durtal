"use client";

import dynamic from "next/dynamic";
import { useLocalStorage } from "@/lib/hooks/use-local-storage";
import { useLibrarySelection } from "@/lib/hooks/use-library-selection";
import { LibraryView } from "@/components/books/library-view";
import { BulkActionToolbar } from "@/components/books/bulk-action-toolbar";
import { CheckSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ViewMode } from "@/components/books/view-mode-switcher";
import type { CoverCrop } from "@/components/books/book-card";
import type { WorkTimelineItem } from "@/lib/actions/work-timeline";

// Dynamic import — timeline pulls in canvas + WebGL-adjacent code; skip SSR
const WorkTimeline = dynamic(
  () =>
    import("@/components/timeline/work-timeline").then((m) => ({
      default: m.WorkTimeline,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[400px] items-center justify-center font-mono text-sm text-fg-muted">
        Loading timeline...
      </div>
    ),
  },
);

// ── Types ────────────────────────────────────────────────────────────────────

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

interface LibraryShellProps {
  books: BookItem[];
  timelineWorks?: WorkTimelineItem[];
  children?: React.ReactNode;
}

// ── Component ────────────────────────────────────────────────────────────────

export function LibraryShell({ books, timelineWorks = [], children }: LibraryShellProps) {
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

  const isTimeline = viewMode === "timeline";

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
          <WorkTimeline works={timelineWorks} />
        </div>
      )}

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

      {!isTimeline && children}
    </>
  );
}
