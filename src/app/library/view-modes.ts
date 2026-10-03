import type { ViewMode } from "@/components/books/view-mode-switcher";
import { LIST_PREFERENCES } from "@/lib/preferences";

/** The views of the book list; a saved view outside these shows the grid. */
export const LIBRARY_VIEW_MODES: ViewMode[] = LIST_PREFERENCES.library.view.modes;
