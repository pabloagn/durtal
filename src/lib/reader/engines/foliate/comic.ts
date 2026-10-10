/** Explicit locale avoids host-language-dependent ordering in stored archives. */
const comicCollator = new Intl.Collator("en", { numeric: true });
export const MAX_COMIC_PAGE_IMAGES = 12;

export function compareComicPaths(a: string, b: string): number {
  const left = a.split("/");
  const right = b.split("/");
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const compared = comicCollator.compare(left[i], right[i]);
    if (compared) return compared;
  }
  // Make numeric/collation ties deterministic too (e.g. 01.png versus 1.png).
  return left.length - right.length || (a < b ? -1 : a > b ? 1 : 0);
}

/** Input is already parsed XML text; this policy neither parses nor loads XML. */
export function comicDirection(
  manga: string | null | undefined,
): "ltr" | "rtl" {
  return manga?.trim() === "YesAndRightToLeft" ? "rtl" : "ltr";
}

/** First image in each immediate folder, in the same order as the sections. */
export function comicFolderContents(
  orderedPaths: readonly string[],
): { label: string; href: string }[] {
  const seen = new Set<string>();
  const contents: { label: string; href: string }[] = [];
  for (const path of orderedPaths) {
    const at = path.lastIndexOf("/");
    if (at <= 0) continue;
    const folder = path.slice(0, at);
    if (seen.has(folder)) continue;
    seen.add(folder);
    contents.push({ label: folder, href: path });
  }
  return contents;
}

/** Pure LRU transition: caller unloads evicted images after a successful load. */
export function touchComicPage(
  recent: readonly number[],
  page: number,
): { recent: number[]; evicted: number[] } {
  if (
    ![page, ...recent].every((n) => Number.isSafeInteger(n) && n >= 0) ||
    new Set(recent).size !== recent.length
  )
    throw new RangeError("Invalid comic page cache");
  const next = recent.filter((index) => index !== page).concat(page);
  const removed = Math.max(0, next.length - MAX_COMIC_PAGE_IMAGES);
  return { recent: next.slice(removed), evicted: next.slice(0, removed) };
}
