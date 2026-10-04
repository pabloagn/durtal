"use client";

import { useSelection, type Selection } from "./use-selection";

/** The author list's selection (`useSelection`) */
export function useAuthorSelection(): Selection {
  return useSelection();
}
