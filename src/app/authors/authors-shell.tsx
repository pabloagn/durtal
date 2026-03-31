"use client";

import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { CheckSquare } from "lucide-react";
import { useLocalStorage } from "@/lib/hooks/use-local-storage";
import { useAuthorSelection } from "@/lib/hooks/use-author-selection";
import { EntityFilters } from "@/components/shared/entity-filters";
import { FilterDropdown, type AnyFilterGroup } from "@/components/shared/filter-dropdown";
import { DataTable } from "@/components/shared/data-table";
import { AuthorCard } from "@/components/authors/author-card";
import { AuthorListItem } from "@/components/authors/author-list-item";
import { AuthorBulkActionToolbar } from "@/components/authors/author-bulk-action-toolbar";
import { Button } from "@/components/ui/button";
import type { ViewMode } from "@/components/books/view-mode-switcher";
import type { ColumnDef } from "@/components/books/column-config-dialog";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { ZODIAC_LABELS, ZODIAC_SIGNS } from "@/lib/utils/zodiac";
import type { AuthorMapPoint } from "@/lib/actions/author-map";
import type { AuthorTimelineItem } from "@/lib/actions/author-timeline";

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

const SORT_OPTIONS = [
  { value: "name", label: "Name" },
  { value: "lastName", label: "Last Name" },
  { value: "recent", label: "Recent" },
  { value: "birth", label: "Born" },
  { value: "works", label: "Works" },
];

const COL_CLASSES: Record<number, string> = {
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
  5: "grid-cols-5",
  6: "grid-cols-6",
  7: "grid-cols-7",
  8: "grid-cols-8",
};

export interface PosterCrop {
  x: number;
  y: number;
  zoom: number;
}

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
      const hasCrop = author.posterCrop && (author.posterCrop.x !== 50 || author.posterCrop.y !== 50 || author.posterCrop.zoom !== 100);
      return (
        <Link
          href={`/authors/${author.slug}`}
          className="flex items-center gap-2 hover:text-accent-rose"
        >
          <div className="relative flex h-20 w-14 flex-shrink-0 items-center justify-center overflow-hidden rounded-sm bg-bg-tertiary">
            {author.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={author.photoUrl}
                alt={author.name}
                className="h-full w-full object-cover"
                style={
                  hasCrop
                    ? {
                        objectPosition: `${author.posterCrop!.x}% ${author.posterCrop!.y}%`,
                        transform: `scale(${author.posterCrop!.zoom / 100})`,
                        transformOrigin: `${author.posterCrop!.x}% ${author.posterCrop!.y}%`,
                      }
                    : undefined
                }
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

const AUTHOR_VIEW_MODES: ViewMode[] = ["grid", "list", "detailed", "map", "timeline"];

interface AuthorsShellProps {
  authors: AuthorItem[];
  mapAuthors: AuthorMapPoint[];
  timelineAuthors: AuthorTimelineItem[];
  nationalities: string[];
  genders: string[];
  zodiacSigns: string[];
  birthYearRange: { min: number | null; max: number | null };
  deathYearRange: { min: number | null; max: number | null };
  pagination: PaginationData;
}

export function AuthorsShell({
  authors,
  mapAuthors,
  timelineAuthors,
  nationalities,
  genders,
  zodiacSigns,
  birthYearRange,
  deathYearRange,
  pagination,
}: AuthorsShellProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [viewMode, setViewMode] = useLocalStorage<ViewMode>(
    "durtal-authors-view-mode",
    "grid",
  );
  const [gridColumns, setGridColumns] = useLocalStorage(
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

  // --- Active filter values from URL ---
  const activeFilters: Record<string, string[]> = {
    nationality: searchParams.get("nationality")?.split(",").filter(Boolean) ?? [],
    gender: searchParams.get("gender")?.split(",").filter(Boolean) ?? [],
    zodiac: searchParams.get("zodiac")?.split(",").filter(Boolean) ?? [],
    alive: searchParams.get("alive") ? [searchParams.get("alive")!] : [],
  };

  // Birth year range from URL
  const birthMin = birthYearRange.min ?? 0;
  const birthMax = birthYearRange.max ?? new Date().getFullYear();
  const birthYearMinParam = searchParams.get("birthYearMin");
  const birthYearMaxParam = searchParams.get("birthYearMax");
  const activeBirthRange: [number, number] = [
    birthYearMinParam ? parseInt(birthYearMinParam, 10) : birthMin,
    birthYearMaxParam ? parseInt(birthYearMaxParam, 10) : birthMax,
  ];
  const birthRangeActive =
    activeBirthRange[0] !== birthMin || activeBirthRange[1] !== birthMax;

  // Death year range from URL
  const deathMin = deathYearRange.min ?? 0;
  const deathMax = deathYearRange.max ?? new Date().getFullYear();
  const deathYearMinParam = searchParams.get("deathYearMin");
  const deathYearMaxParam = searchParams.get("deathYearMax");
  const activeDeathRange: [number, number] = [
    deathYearMinParam ? parseInt(deathYearMinParam, 10) : deathMin,
    deathYearMaxParam ? parseInt(deathYearMaxParam, 10) : deathMax,
  ];
  const deathRangeActive =
    activeDeathRange[0] !== deathMin || activeDeathRange[1] !== deathMax;

  const activeRangeCount = (birthRangeActive ? 1 : 0) + (deathRangeActive ? 1 : 0);

  // All 12 zodiac signs in canonical order, plus "Not Available"
  const zodiacOptions: { value: string; label: string }[] = ZODIAC_SIGNS.map(
    (sign) => ({ value: sign, label: ZODIAC_LABELS[sign] }),
  );
  zodiacOptions.push({ value: "__none__", label: "Not Available" });
  // Filter to only signs present in DB + __none__
  const presentSigns = new Set(zodiacSigns);
  const filteredZodiacOptions = zodiacOptions.filter(
    (o) => o.value === "__none__" || presentSigns.has(o.value),
  );

  const filterGroups: AnyFilterGroup[] = [
    {
      key: "nationality",
      label: "Nationality",
      options: nationalities.map((n) => ({ value: n, label: n })),
    },
    ...(genders.length > 0
      ? [
          {
            key: "gender",
            label: "Gender",
            options: genders.map((g) => ({
              value: g,
              label: g.charAt(0).toUpperCase() + g.slice(1),
            })),
          } satisfies AnyFilterGroup,
        ]
      : []),
    ...(filteredZodiacOptions.length > 0
      ? [
          {
            key: "zodiac",
            label: "Zodiac Sign",
            options: filteredZodiacOptions,
          } satisfies AnyFilterGroup,
        ]
      : []),
    {
      key: "alive",
      label: "Status",
      options: [
        { value: "true", label: "Alive" },
        { value: "false", label: "Deceased" },
      ],
    },
    ...(birthYearRange.min != null && birthYearRange.max != null
      ? [
          {
            type: "range" as const,
            key: "birthYear",
            label: "Birth Year",
            min: birthMin,
            max: birthMax,
            value: activeBirthRange,
            onChange: (val: [number, number]) => {
              const params = new URLSearchParams(searchParams.toString());
              if (val[0] !== birthMin) {
                params.set("birthYearMin", String(val[0]));
              } else {
                params.delete("birthYearMin");
              }
              if (val[1] !== birthMax) {
                params.set("birthYearMax", String(val[1]));
              } else {
                params.delete("birthYearMax");
              }
              params.delete("page");
              router.push(`/authors?${params.toString()}`);
            },
          } satisfies AnyFilterGroup,
        ]
      : []),
    ...(deathYearRange.min != null && deathYearRange.max != null
      ? [
          {
            type: "range" as const,
            key: "deathYear",
            label: "Death Year",
            min: deathMin,
            max: deathMax,
            value: activeDeathRange,
            onChange: (val: [number, number]) => {
              const params = new URLSearchParams(searchParams.toString());
              if (val[0] !== deathMin) {
                params.set("deathYearMin", String(val[0]));
              } else {
                params.delete("deathYearMin");
              }
              if (val[1] !== deathMax) {
                params.set("deathYearMax", String(val[1]));
              } else {
                params.delete("deathYearMax");
              }
              params.delete("page");
              router.push(`/authors?${params.toString()}`);
            },
          } satisfies AnyFilterGroup,
        ]
      : []),
  ];

  function handleFilterChange(key: string, values: string[]) {
    const params = new URLSearchParams(searchParams.toString());
    if (key === "alive") {
      // alive is a single-select: only allow one value at a time
      if (values.length > 0) {
        const last = values[values.length - 1];
        params.set("alive", last);
      } else {
        params.delete("alive");
      }
    } else if (values.length > 0) {
      params.set(key, values.join(","));
    } else {
      params.delete(key);
    }
    params.delete("page");
    router.push(`/authors?${params.toString()}`);
  }

  function handleClearAll() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("nationality");
    params.delete("gender");
    params.delete("zodiac");
    params.delete("alive");
    params.delete("birthYearMin");
    params.delete("birthYearMax");
    params.delete("deathYearMin");
    params.delete("deathYearMax");
    params.delete("page");
    router.push(`/authors?${params.toString()}`);
  }

  return (
    <>
      <EntityFilters
        basePath="/authors"
        sortOptions={SORT_OPTIONS}
        searchPlaceholder="Search authors..."
        defaultSort="name"
        defaultSortOrders={{ name: "asc", lastName: "asc", recent: "desc", birth: "asc", works: "desc" }}
        viewMode={viewMode}
        gridColumns={gridColumns}
        onViewModeChange={setViewMode}
        onGridColumnsChange={setGridColumns}
        availableViewModes={AUTHOR_VIEW_MODES}
      >
        <FilterDropdown
          groups={filterGroups}
          activeFilters={activeFilters}
          onFilterChange={handleFilterChange}
          onClearAll={handleClearAll}
          activeRangeCount={activeRangeCount}
        />
      </EntityFilters>

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
