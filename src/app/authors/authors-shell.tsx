"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useLocalStorage } from "@/lib/hooks/use-local-storage";
import { EntityFilters } from "@/components/shared/entity-filters";
import { FilterDropdown, type FilterGroup } from "@/components/shared/filter-dropdown";
import { DataTable } from "@/components/shared/data-table";
import { AuthorCard } from "@/components/authors/author-card";
import { AuthorListItem } from "@/components/authors/author-list-item";
import type { ViewMode } from "@/components/books/view-mode-switcher";
import type { ColumnDef } from "@/components/books/column-config-dialog";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";

const SORT_OPTIONS = [
  { value: "name", label: "Name" },
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

export interface AuthorItem {
  id: string;
  slug: string;
  name: string;
  sortName: string | null;
  nationality: string | null;
  birthYear: number | null;
  deathYear: number | null;
  gender: string | null;
  photoUrl: string | null;
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
    case "name":
      return (
        <Link
          href={`/authors/${author.slug}`}
          className="flex items-center gap-2 hover:text-accent-rose"
        >
          <div className="relative flex h-20 w-14 flex-shrink-0 items-center justify-center overflow-hidden rounded-sm bg-bg-tertiary">
            <span className="font-serif text-xs text-fg-muted/40">{author.name[0]}</span>
          </div>
          <span className="truncate">{author.name}</span>
        </Link>
      );
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

export function AuthorsShell({ authors, nationalities }: { authors: AuthorItem[]; nationalities: string[] }) {
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

  const filterGroups: FilterGroup[] = [
    {
      key: "nationality",
      label: "Nationality",
      options: nationalities.map((n) => ({ value: n, label: n })),
    },
  ];

  const activeFilters: Record<string, string[]> = {
    nationality: searchParams.get("nationality")?.split(",").filter(Boolean) ?? [],
  };

  function handleFilterChange(key: string, values: string[]) {
    const params = new URLSearchParams(searchParams.toString());
    if (values.length > 0) {
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
        defaultSortOrders={{ name: "asc", recent: "desc", birth: "asc", works: "desc" }}
        viewMode={viewMode}
        gridColumns={gridColumns}
        onViewModeChange={setViewMode}
        onGridColumnsChange={setGridColumns}
      >
        <FilterDropdown
          groups={filterGroups}
          activeFilters={activeFilters}
          onFilterChange={handleFilterChange}
          onClearAll={handleClearAll}
        />
      </EntityFilters>

      {viewMode === "grid" && (
        <div className={`grid gap-4 ${COL_CLASSES[gridColumns] ?? "grid-cols-5"}`}>
          {authors.map((a) => (
            <AuthorCard
              key={a.id}
              id={a.id}
              slug={a.slug}
              name={a.name}
              nationality={a.nationality}
              birthYear={a.birthYear}
              deathYear={a.deathYear}
              photoUrl={a.photoUrl}
              worksCount={a.worksCount}
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
              nationality={a.nationality}
              birthYear={a.birthYear}
              deathYear={a.deathYear}
              photoUrl={a.photoUrl}
              worksCount={a.worksCount}
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
    </>
  );
}
