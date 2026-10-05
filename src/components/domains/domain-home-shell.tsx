"use client";

import {
  usePreference,
  useViewModePreference,
} from "@/lib/hooks/use-preference";
import { EntityFilters } from "@/components/shared/entity-filters";
import type { ViewMode } from "@/components/books/view-mode-switcher";
import { WORK_DOMAINS } from "@/lib/catalogue/domains";
import type { HomeKind } from "@/lib/catalogue/domain-homes";

const VIEW_MODES: ViewMode[] = ["grid", "mosaic", "list"];

/** Each home's sorts; every sort but the title starts with the newest or best. */
const SORT_OPTIONS: Record<HomeKind, { value: string; label: string }[]> = {
  perfume: [
    { value: "title", label: "Title" },
    { value: "release", label: "Release" },
    { value: "recent", label: "Added" },
    { value: "rating", label: "Rating" },
  ],
  film: [
    { value: "title", label: "Title" },
    { value: "release", label: "Release" },
    { value: "runtime", label: "Runtime" },
    { value: "recent", label: "Added" },
    { value: "rating", label: "Rating" },
  ],
  painting: [
    { value: "title", label: "Title" },
    { value: "created", label: "Date" },
    { value: "recent", label: "Added" },
    { value: "rating", label: "Rating" },
  ],
};

/** The saved view of one home: a cookie per collection, checked against its views. */
export function useHomeView(kind: HomeKind) {
  const name = WORK_DOMAINS[kind].basePath.slice(1);
  const [viewMode, setViewMode] = useViewModePreference(
    `durtal-${name}-view-mode`,
    VIEW_MODES,
    "grid",
  );
  const [gridColumns, setGridColumns] = usePreference(
    `durtal-${name}-grid-columns`,
    4,
  );
  return { viewMode, setViewMode, gridColumns, setGridColumns };
}

/** Search, sort and view controls of a collection home. */
export function DomainHomeFilters({ kind }: { kind: HomeKind }) {
  const view = useHomeView(kind);
  return (
    <EntityFilters
      basePath={WORK_DOMAINS[kind].basePath}
      sortOptions={SORT_OPTIONS[kind]}
      searchPlaceholder={`Search ${WORK_DOMAINS[kind].pluralLabel.toLowerCase()}...`}
      defaultSort="title"
      defaultSortOrders={Object.fromEntries(
        SORT_OPTIONS[kind].map((option) => [
          option.value,
          option.value === "title" ? "asc" : "desc",
        ]),
      )}
      viewMode={view.viewMode}
      gridColumns={view.gridColumns}
      onViewModeChange={view.setViewMode}
      onGridColumnsChange={view.setGridColumns}
      availableViewModes={VIEW_MODES}
    />
  );
}
