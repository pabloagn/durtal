"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { usePreference } from "@/lib/hooks/use-preference";
import {
  Pagination,
  type PaginationData,
} from "@/components/shared/pagination";
import { NoResults, PageOutOfRange } from "@/components/shared/no-results";
import { DataTable } from "@/components/shared/data-table";
import type { ColumnDef } from "@/components/books/column-config-dialog";
import type { ViewMode } from "@/components/books/view-mode-switcher";
import { Badge } from "@/components/ui/badge";
import {
  PublisherCard,
  PublisherListItem,
  type PublisherItem,
} from "@/components/publishers/publisher-card";
import { PublisherFavourite } from "@/components/publishers/favourite-button";
import { clearedListHref, firstPageHref } from "@/lib/utils/list-params";
import {
  PUBLISHER_FILTER_PARAMS,
  PUBLISHER_VIEW_MODES,
} from "./publishers-filters-bar";

const COL_CLASSES: Record<number, string> = {
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
  5: "grid-cols-5",
  6: "grid-cols-6",
  7: "grid-cols-7",
  8: "grid-cols-8",
};

const ALL_COLUMNS: ColumnDef[] = [
  { key: "name", label: "Name", defaultVisible: true, defaultOrder: 0 },
  { key: "kind", label: "Type", defaultVisible: true, defaultOrder: 1 },
  { key: "country", label: "Country", defaultVisible: true, defaultOrder: 2 },
  { key: "parent", label: "Imprint of", defaultVisible: true, defaultOrder: 3 },
  { key: "editions", label: "Editions", defaultVisible: true, defaultOrder: 4 },
  {
    key: "favourite",
    label: "Favourite",
    defaultVisible: true,
    defaultOrder: 5,
  },
  { key: "website", label: "Website", defaultVisible: false, defaultOrder: 6 },
  { key: "added", label: "Added", defaultVisible: false, defaultOrder: 7 },
];

const DEFAULT_COLUMN_CONFIG = ALL_COLUMNS.map((c) => ({
  key: c.key,
  visible: c.defaultVisible,
  order: c.defaultOrder,
}));

function renderCell(p: PublisherItem, key: string) {
  switch (key) {
    case "name":
      return (
        <Link href={`/publishers/${p.slug}`} className="hover:text-accent-rose-text">
          {p.name}
        </Link>
      );
    case "kind":
      return p.kind === "imprint" ? (
        <Badge variant="blue">Imprint</Badge>
      ) : p.kind === "group" ? (
        <Badge variant="gold">Group</Badge>
      ) : (
        "Publisher"
      );
    case "country":
      return p.country ?? "—";
    case "parent":
      return p.parentName ?? "—";
    case "editions":
      return p.editionCount;
    case "favourite":
      return <PublisherFavourite id={p.id} favourite={p.isFavourite} />;
    case "website":
      return p.website ? (
        <a
          href={p.website}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent-rose-text hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          Link
        </a>
      ) : (
        "—"
      );
    case "added":
      return p.createdAt;
    default:
      return "";
  }
}

function sortValue(p: PublisherItem, key: string): string | number {
  if (key === "editions") return p.editionCount;
  if (key === "favourite") return p.isFavourite ? 1 : 0;
  if (key === "kind") return p.kind;
  if (key === "country") return p.country ?? "";
  if (key === "parent") return p.parentName ?? "";
  return p.name;
}

export function PublishersShell({
  publishers,
  pagination,
}: {
  publishers: PublisherItem[];
  pagination: PaginationData;
}) {
  const searchParams = useSearchParams();

  // Written by PublishersFiltersBar; kept in sync through usePreference
  const [storedViewMode] = usePreference<ViewMode>(
    "durtal-publishers-view-mode",
    "grid",
  );
  const viewMode = PUBLISHER_VIEW_MODES.includes(storedViewMode)
    ? storedViewMode
    : "grid";
  const [gridColumns] = usePreference("durtal-publishers-grid-columns", 4);
  const [columnConfig, setColumnConfig] = usePreference(
    "durtal-publishers-column-config",
    DEFAULT_COLUMN_CONFIG,
  );

  if (pagination.total === 0) {
    return (
      <NoResults
        noun="publishers"
        search={searchParams.get("q")}
        hasFilters={PUBLISHER_FILTER_PARAMS.some((key) =>
          searchParams.get(key),
        )}
        clearHref={clearedListHref("/publishers", searchParams)}
      />
    );
  }
  if (publishers.length === 0) {
    return (
      <PageOutOfRange
        firstPageHref={firstPageHref("/publishers", searchParams)}
      />
    );
  }

  return (
    <>
      <Pagination {...pagination} noun="publishers" compact />

      {viewMode === "grid" && (
        <div
          className={`grid gap-4 ${COL_CLASSES[gridColumns] ?? "grid-cols-4"}`}
        >
          {publishers.map((p) => (
            <PublisherCard key={p.id} publisher={p} />
          ))}
        </div>
      )}

      {viewMode === "list" && (
        <div className="space-y-1">
          {publishers.map((p) => (
            <PublisherListItem key={p.id} publisher={p} />
          ))}
        </div>
      )}

      {viewMode === "detailed" && (
        <DataTable
          items={publishers}
          itemKey={(p) => p.id}
          allColumns={ALL_COLUMNS}
          columns={columnConfig}
          onColumnsChange={setColumnConfig}
          renderCell={renderCell}
          getSortValue={sortValue}
          preserveOrder
        />
      )}

      <Pagination {...pagination} noun="publishers" />
    </>
  );
}
