import type { AnnotationColor, ReaderAnnotation } from "./annotations";
import { normalizeSearchText } from "@/lib/utils/search-text";
import { compareAnnotationTimes } from "./sync/annotation-time";
export type AnnotationTab = "highlights" | "notes" | "bookmarks";
export function annotationCounts(items: readonly ReaderAnnotation[]) {
  const live = items.filter((item) => !item.deletedAt);
  return {
    highlights: live.filter((item) => item.kind === "highlight").length,
    notes: live.filter((item) => item.kind === "highlight" && !!item.note)
      .length,
    bookmarks: live.filter((item) => item.kind === "bookmark").length,
  };
}
export function annotationPanelGroups(
  items: readonly ReaderAnnotation[],
  filter: {
    tab: AnnotationTab;
    color: AnnotationColor | "all";
    query: string;
    order: "book" | "newest";
  },
) {
  const tokens = normalizeSearchText(filter.query).split(" ").filter(Boolean);
  const selected = items.filter(
    (item) =>
      !item.deletedAt &&
      (filter.tab === "bookmarks"
        ? item.kind === "bookmark"
        : item.kind === "highlight" &&
          (filter.tab !== "notes" || !!item.note)) &&
      (filter.color === "all" || item.color === filter.color) &&
      tokens.every((token) =>
        normalizeSearchText(
          `${item.text ?? ""} ${item.note ?? ""} ${item.kind === "bookmark" ? (item.locator.text?.highlight ?? "") : ""}`,
        ).includes(token),
      ),
  );
  selected.sort((a, b) =>
    filter.order === "newest"
      ? compareAnnotationTimes(b.updatedAt, a.updatedAt) ||
        a.id.localeCompare(b.id)
      : a.locator.sectionIndex - b.locator.sectionIndex ||
        a.locator.progression - b.locator.progression ||
        a.id.localeCompare(b.id),
  );
  const groups = new Map<
    string,
    { title: string; orphaned: boolean; items: ReaderAnnotation[] }
  >();
  for (const item of selected) {
    const orphaned = item.anchorState === "orphaned";
    const title = orphaned
      ? "Could not be placed"
      : (item.chapter ?? item.locator.tocLabel ?? "No chapter");
    const key = orphaned ? "orphaned" : title;
    const group = groups.get(key) ?? { title, orphaned, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  return [...groups.values()].sort(
    (a, b) => Number(a.orphaned) - Number(b.orphaned),
  );
}
