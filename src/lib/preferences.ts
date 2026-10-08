import type { ViewMode } from "@/components/books/view-mode-switcher";

/**
 * Every display preference a browser keeps (cookies, through usePreference),
 * in one place: the pages that use one and Settings → Display read its key
 * and default from here. All keys start with PREFERENCE_COOKIE_PREFIX.
 */

/** The sidebar's width in px: collapsed, or dragged between min and max. */
export const SIDEBAR = {
  key: "durtal-sidebar-width",
  expandedKey: "durtal-sidebar-expanded-width",
  compactKey: "durtal-sidebar-compact-expanded",
  expanded: 224,
  collapsed: 56,
  min: 120,
  max: 360,
} as const;

/** A stored sidebar width the sidebar can take, else the expanded width. */
export function sidebarWidth(stored: unknown): number {
  return typeof stored === "number" &&
    (stored === SIDEBAR.collapsed || (stored >= SIDEBAR.min && stored <= SIDEBAR.max))
    ? stored
    : SIDEBAR.expanded;
}

/** An expanded width to restore after collapsing, including older width cookies. */
export function sidebarExpandedWidth(stored: unknown): number {
  const width = sidebarWidth(stored);
  return width === SIDEBAR.collapsed ? SIDEBAR.expanded : width;
}

/** The reading tracker's "I'm at" home on this device: a location id, or "none" (SLN-447). */
export const READING_HOME_KEY = "durtal-reading-home";

/** The reader's typography (font, size, line height, margins, alignment). */
export const READER_SETTINGS_KEY = "durtal-reader-settings";

export const VIEW_MODE_LABELS: Record<ViewMode, string> = {
  grid: "Grid",
  mosaic: "Mosaic",
  list: "List",
  detailed: "Detailed",
  map: "Map",
  timeline: "Timeline",
};

/** Cards per row in a grid view: the range of the size slider. */
export const GRID_SIZES = [2, 3, 4, 5, 6, 7, 8] as const;

export interface ListPreference {
  label: string;
  /** The list's page: its page size is saved per path (perPageCookieName) */
  path: string;
  /** The views the list offers; a saved view outside them shows the fallback */
  view?: { key: string; modes: ViewMode[]; fallback: ViewMode };
  /** Cards per row in the grid view */
  grid?: { key: string; fallback: number };
  /** The columns of the detailed view */
  columns?: { key: string };
}

/** The lists that remember how they look, in sidebar order. */
export const LIST_PREFERENCES = {
  library: {
    label: "Books",
    path: "/library",
    view: { key: "durtal-view-mode", modes: ["grid", "mosaic", "list", "detailed", "timeline"], fallback: "grid" },
    grid: { key: "durtal-grid-columns", fallback: 6 },
    columns: { key: "durtal-column-config" },
  },
  authors: {
    label: "People",
    path: "/people",
    view: {
      key: "durtal-authors-view-mode",
      modes: ["grid", "mosaic", "list", "detailed", "map", "timeline"],
      fallback: "grid",
    },
    grid: { key: "durtal-authors-grid-columns", fallback: 5 },
    columns: { key: "durtal-authors-column-config" },
  },
  publishers: {
    label: "Publishers",
    path: "/publishers",
    view: { key: "durtal-publishers-view-mode", modes: ["grid", "list", "detailed"], fallback: "grid" },
    grid: { key: "durtal-publishers-grid-columns", fallback: 4 },
    columns: { key: "durtal-publishers-column-config" },
  },
  recommenders: {
    label: "Recommenders",
    path: "/recommenders",
    view: { key: "durtal-recommenders-view-mode", modes: ["grid", "list"], fallback: "grid" },
    grid: { key: "durtal-recommenders-grid-columns", fallback: 4 },
  },
  series: {
    label: "Series",
    path: "/series",
    view: { key: "durtal-series-view-mode", modes: ["grid", "list"], fallback: "grid" },
    grid: { key: "durtal-series-grid-columns", fallback: 4 },
  },
  places: {
    label: "Places",
    path: "/places",
    view: { key: "durtal-places-view-mode", modes: ["grid", "list"], fallback: "grid" },
    grid: { key: "durtal-places-grid-columns", fallback: 4 },
  },
  provenance: { label: "Provenance", path: "/provenance" },
  collections: {
    label: "Collections",
    path: "/collections",
    view: { key: "durtal-collections-view-mode", modes: ["grid", "mosaic"], fallback: "grid" },
    grid: { key: "durtal-collections-grid-columns", fallback: 5 },
  },
} satisfies Record<string, ListPreference>;
