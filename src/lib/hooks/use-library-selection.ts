"use client";

import { useSelection, type Selection } from "./use-selection";

/** The book list's selection (`useSelection`) */
export function useLibrarySelection(): Selection {
  return useSelection();
}
