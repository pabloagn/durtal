import type { ViewMode } from "@/components/books/view-mode-switcher";

/** The views of the book list; a saved view outside these shows the grid. */
export const LIBRARY_VIEW_MODES: ViewMode[] = [
  "grid",
  "list",
  "detailed",
  "timeline",
];
