import { DEFAULT_SEARCH_OPTIONS, type SearchOptions } from "./fold";
const KEY = "durtal-reader-search-options";
export function readSearchOptions(
  storage: Pick<Storage, "getItem"> | null,
): SearchOptions {
  try {
    const value = JSON.parse(storage?.getItem(KEY) ?? "null");
    if (
      value?.v === 1 &&
      [value.wholeWords, value.matchCase, value.matchAccents].every(
        (item) => typeof item === "boolean",
      )
    )
      return {
        wholeWords: value.wholeWords,
        matchCase: value.matchCase,
        matchAccents: value.matchAccents,
      };
  } catch {
    /* A blocked or older store uses the same defaults. */
  }
  return { ...DEFAULT_SEARCH_OPTIONS };
}
export function writeSearchOptions(
  storage: Pick<Storage, "setItem"> | null,
  options: SearchOptions,
) {
  try {
    storage?.setItem(KEY, JSON.stringify({ v: 1, ...options }));
  } catch {
    /* Optional device preference. */
  }
}
