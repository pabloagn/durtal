"use client";

import {
  usePreference,
  useViewModePreference,
} from "@/lib/hooks/use-preference";
import type { ViewMode } from "@/components/books/view-mode-switcher";
import { WORK_DOMAINS } from "@/lib/catalogue/domains";
import type { HomeKind } from "@/lib/catalogue/domain-homes";

const VIEW_MODES: ViewMode[] = ["grid", "mosaic", "list"];

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
