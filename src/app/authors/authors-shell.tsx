"use client";

import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { CheckSquare } from "lucide-react";
import { useLocalStorage } from "@/lib/hooks/use-local-storage";
import { useAuthorSelection } from "@/lib/hooks/use-author-selection";
import { DataTable } from "@/components/shared/data-table";
import { NoResults, PageOutOfRange } from "@/components/shared/no-results";
import { AuthorCard } from "@/components/authors/author-card";
import { AuthorListItem } from "@/components/authors/author-list-item";
import { AuthorBulkActionToolbar } from "@/components/authors/author-bulk-action-toolbar";
import { Button } from "@/components/ui/button";
import type { ViewMode } from "@/components/books/view-mode-switcher";
import type { ColumnDef } from "@/components/books/column-config-dialog";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { AuthorMapPoint } from "@/lib/actions/author-map";
import type { AuthorTimelineItem } from "@/lib/actions/author-timeline";
import { clearedListHref, firstPageHref } from "@/lib/utils/list-params";
import { mediaImageStyle, type MediaCrop } from "@/lib/utils/media-style";

interface PaginationData {
  page: number;
  totalPages: number;
  total: number;
  paginationParams: Record<string, string>;
}

const AuthorsMap = dynamic(
  () =>
    import("@/components/authors/authors-map").then((m) => ({
      default: m.AuthorsMap,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center font-mono text-sm text-fg-muted">
        Loading map...
      </div>
    ),
  },
);

const AuthorTimeline = dynamic(
  () =>
    import("@/components/timeline/author-timeline").then((m) => ({
      default: m.AuthorTimeline,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center font-mono text-sm text-fg-muted">
        Loading timeline...
      </div>
    ),
  },
);

const COL_CLASSES: Record<number, string> = {
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
  5: "grid-cols-5",
  6: "grid-cols-6",
  7: "grid-cols-7",
  8: "grid-cols-8",
};

export type PosterCrop = MediaCrop;

export interface AuthorItem {
  id: string;
  slug: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  sortName: string | null;
  nationality: string | null;
  birthYear: number | null;
  deathYear: number | null;
  gender: string | null;
  photoUrl: string | null;
  posterCrop: PosterCrop | null;
  website: string | null;
  bio: string | null;
  worksCount: number;
  createdAt: string;
}

const ALL_AUTHOR_COLUMNS: ColumnDef[] = [
  { key: "name", label: "Name", defaultVisible: true, defaultOrder: 0 },
  { key: "nationality", label: "Nationality", defaultVisible: true, defaultOrder: 1 },
  { key: "years", label: "Years", defaultVisible: true, defaultOrder: 2 },
  { key: "gender", label: "Gender", defaultVisible: false, defaultOrder: 3 },
  { key: "worksCount", label: "Works", defaultVisible: true, defaultOrder: 4 },
  { key: "birthYear", label: "Born", defaultVisible: false, defaultOrder: 5 },
  { key: "deathYear", label: "Died", defaultVisible: false, defaultOrder: 6 },
  { key: "bio", label: "Bio", defaultVisible: false, defaultOrder: 7 },
  { key: "website", label: "Website", defaultVisible: false, defaultOrder: 8 },
  { key: "addedDate", label: "Added", defaultVisible: false, defaultOrder: 9 },
];

const DEFAULT_COLUMN_CONFIG = ALL_AUTHOR_COLUMNS.map((c) => ({
  key: c.key,
  visible: c.defaultVisible,
  order: c.defaultOrder,
}));

function renderAuthorCell(author: AuthorItem, key: string) {
  switch (key) {
    case "name": {
      return (
        <Link
          href={`/authors/${author.slug}`}
          className="flex items-center gap-2 hover:text-accent-rose"
        >
          <div className="relative flex h-20 w-14 flex-shrink-0 items-center justify-center overflow-hidden rounded-sm bg-bg-tertiary">
            {author.photoUrl ? (
              <img
                src={author.photoUrl}
                alt={author.name}
                className="h-full w-full object-cover"
                style={mediaImageStyle(author.posterCrop)}
              />
            ) : (
              <span className="font-serif text-xs text-fg-muted/40">{author.name[0]}</span>
            )}
          </div>
          <span className="truncate">{author.name}</span>
        </Link>
      );
    }
    case "nationality":
      return author.nationality ? (
        <Badge variant="muted">{author.nationality}</Badge>
      ) : (
        "—"
      );
    case "years":
      return author.birthYear
        ? `${author.birthYear}–${author.deathYear ?? ""}`
        : "—";
    case "worksCount":
      return author.worksCount;
    case "gender":
      return author.gender ?? "—";
    case "birthYear":
      return author.birthYear ?? "—";
    case "deathYear":
      return author.deathYear ?? "—";
    case "bio":
      return author.bio ? (
        <span className="line-clamp-1">{author.bio}</span>
      ) : (
        "—"
      );
    case "website":
      return author.website ? (
        <a
          href={author.website}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent-rose hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          Link
        </a>
      ) : (
        "—"
      );
    case "addedDate":
      return author.createdAt;
    default:
      return "";
  }
}

interface AuthorsShellProps {
  authors: AuthorItem[];
  mapAuthors: AuthorMapPoint[];
  timelineAuthors: AuthorTimelineItem[];
  pagination: PaginationData;
}

/** URL params (besides the search term) that filter the author list */
const AUTHOR_FILTER_PARAMS = [
  "nationality",
  "gender",
  "zodiac",
  "alive",
  "birthYearMin",
  "birthYearMax",
  "deathYearMin",
  "deathYearMax",
];

export function AuthorsShell({
  authors,
  mapAuthors,
  timelineAuthors,
  pagination,
}: AuthorsShellProps) {
  const searchParams = useSearchParams();

  // Written by AuthorsFiltersBar; kept in sync through useLocalStorage events
  const [viewMode] = useLocalStorage<ViewMode>(
    "durtal-authors-view-mode",
    "grid",
  );
  const [gridColumns] = useLocalStorage(
    "durtal-authors-grid-columns",
    5,
  );
  const [columnConfig, setColumnConfig] = useLocalStorage(
    "durtal-authors-column-config",
    DEFAULT_COLUMN_CONFIG,
  );

  const selection = useAuthorSelection();
  const allIds = authors.map((a) => a.id);
  const nameMap = new Map(authors.map((a) => [a.id, a.name]));

  const search = searchParams.get("q");
  const hasFilters = AUTHOR_FILTER_PARAMS.some((key) => searchParams.get(key));

  // Nothing matches the search/filters: keep the toolbar (rendered by the
  // page) and show a clear action instead of the results.
  if (pagination.total === 0) {
    return (
      <NoResults
        noun="authors"
        search={search}
        hasFilters={hasFilters}
        clearHref={clearedListHref("/authors", searchParams)}
      />
    );
  }

  // Page number past the last page
  if (authors.length === 0) {
    return <PageOutOfRange firstPageHref={firstPageHref("/authors", searchParams)} />;
  }

  return (
    <>
      {/* Select / Cancel button — hidden in map and timeline views */}
      {viewMode !== "map" && viewMode !== "timeline" && (
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

      {viewMode === "map" && (
        <div className="h-[calc(100vh-220px)] min-h-[400px]">
          <AuthorsMap authors={mapAuthors} />
        </div>
      )}

      {viewMode === "timeline" && (
        <div className="h-[calc(100vh-220px)] min-h-[400px]">
          <AuthorTimeline
            authors={timelineAuthors}
            sortBy={(searchParams.get("sort") ?? "birth") as "name" | "lastName" | "birth" | "works" | "recent"}
            sortOrder={(searchParams.get("order") ?? "asc") as "asc" | "desc"}
          />
        </div>
      )}

      {viewMode === "grid" && (
        <div className={`grid gap-4 ${COL_CLASSES[gridColumns] ?? "grid-cols-5"}`}>
          {authors.map((a) => (
            <AuthorCard
              key={a.id}
              id={a.id}
              slug={a.slug}
              name={a.name}
              firstName={a.firstName}
              lastName={a.lastName}
              nationality={a.nationality}
              birthYear={a.birthYear}
              deathYear={a.deathYear}
              photoUrl={a.photoUrl}
              posterCrop={a.posterCrop}
              worksCount={a.worksCount}
              isSelecting={selection.isSelecting}
              isSelected={selection.isSelected(a.id)}
              onSelect={selection.toggleSelection}
            />
          ))}
        </div>
      )}

      {viewMode === "list" && (
        <div className="space-y-1">
          {authors.map((a) => (
            <AuthorListItem
              key={a.id}
              id={a.id}
              slug={a.slug}
              name={a.name}
              firstName={a.firstName}
              lastName={a.lastName}
              nationality={a.nationality}
              birthYear={a.birthYear}
              deathYear={a.deathYear}
              photoUrl={a.photoUrl}
              posterCrop={a.posterCrop}
              worksCount={a.worksCount}
              isSelecting={selection.isSelecting}
              isSelected={selection.isSelected(a.id)}
              onSelect={selection.toggleSelection}
            />
          ))}
        </div>
      )}

      {viewMode === "detailed" && (
        <DataTable
          items={authors}
          itemKey={(a) => a.id}
          allColumns={ALL_AUTHOR_COLUMNS}
          columns={columnConfig}
          onColumnsChange={setColumnConfig}
          renderCell={renderAuthorCell}
          isSelecting={selection.isSelecting}
          selectedIds={selection.selectedIds}
          onSelect={selection.toggleSelection}
        />
      )}

      <AuthorBulkActionToolbar
        selectedCount={selection.selectionCount}
        selectedIds={selection.selectedIds}
        selectedNames={nameMap}
        allIds={allIds}
        onSelectAll={selection.selectAll}
        onDeselectAll={selection.deselectAll}
        onExitSelection={selection.exitSelectionMode}
      />

      {/* Pagination — hidden in map and timeline views which show all items */}
      {viewMode !== "map" && viewMode !== "timeline" && (
        <>
          {pagination.totalPages > 1 && (
            <div className="mt-8 flex items-center justify-center gap-2">
              {pagination.page > 1 && (
                <Link
                  href={`/authors?${new URLSearchParams({ ...pagination.paginationParams, page: String(pagination.page - 1) })}`}
                >
                  <Button variant="ghost" size="sm">
                    Previous
                  </Button>
                </Link>
              )}
              <span className="font-mono text-xs text-fg-muted">
                {pagination.page} / {pagination.totalPages}
              </span>
              {pagination.page < pagination.totalPages && (
                <Link
                  href={`/authors?${new URLSearchParams({ ...pagination.paginationParams, page: String(pagination.page + 1) })}`}
                >
                  <Button variant="ghost" size="sm">
                    Next
                  </Button>
                </Link>
              )}
            </div>
          )}

          <p className="mt-4 text-center font-mono text-xs text-fg-muted">
            {pagination.total} {pagination.total === 1 ? "author" : "authors"}
          </p>
        </>
      )}
    </>
  );
}
