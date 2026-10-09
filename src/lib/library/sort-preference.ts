import { LIBRARY_SORTS, type LibrarySort } from "@/lib/reading/filter-params";

export const LIBRARY_SORT_COOKIE = "durtal-library-sort";

export interface LibrarySortPreference {
  sort: LibrarySort;
  order: "asc" | "desc";
}

/** Ignore malformed or obsolete preferences before restoring the list URL. */
export function parseLibrarySortPreference(raw: string | undefined): LibrarySortPreference | undefined {
  if (!raw) return;
  try {
    const value = JSON.parse(decodeURIComponent(raw));
    if (
      value &&
      LIBRARY_SORTS.includes(value.sort) &&
      (value.order === "asc" || value.order === "desc")
    ) return { sort: value.sort, order: value.order };
  } catch {
    // An invalid cookie must not prevent the library from opening.
  }
}
