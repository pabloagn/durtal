"use client";

import {
  usePreference,
  useViewModePreference,
} from "@/lib/hooks/use-preference";
import { LIST_PREFERENCES } from "@/lib/preferences";
import type { HomeKind } from "@/lib/catalogue/domain-homes";

/** Each home's saved view and grid size: Settings → Display shows the same (SLN-925) */
const HOME_LISTS = {
  film: LIST_PREFERENCES.films,
  perfume: LIST_PREFERENCES.perfumes,
  painting: LIST_PREFERENCES.paintings,
} satisfies Record<HomeKind, unknown>;

/** The saved view of one home: a cookie per collection, checked against its views. */
export function useHomeView(kind: HomeKind) {
  const { view, grid } = HOME_LISTS[kind];
  const [viewMode, setViewMode] = useViewModePreference(view.key, view.modes, view.fallback);
  const [gridColumns, setGridColumns] = usePreference(grid.key, grid.fallback);
  return { viewMode, setViewMode, gridColumns, setGridColumns };
}
