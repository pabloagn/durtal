import type { BookInfo, DurtalLocator, TocItem } from "./engine";

export const unit = (n: number) =>
  Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
export function flattenContents(items: readonly TocItem[]): TocItem[] {
  const result: TocItem[] = [];
  const visit = (list: readonly TocItem[]) => {
    for (const item of list) {
      result.push(item);
      visit(item.subitems);
    }
  };
  visit(items);
  return result;
}
export interface IndexedEntry extends TocItem {
  fraction: number;
  indexed: boolean;
}
const lower = (entries: readonly IndexedEntry[], fraction: number) => {
  let left = 0,
    right = entries.length;
  while (left < right) {
    const mid = (left + right) >>> 1;
    if (entries[mid].fraction <= fraction + 1e-9) left = mid + 1;
    else right = mid;
  }
  return left;
};
/** The view's lookups never query a book document. Missing anchors use their section start. */
export class PositionIndex {
  #fractions: Record<string, number>;
  #indexed: Set<string>;
  #sections = new Map<string, number>();
  #textRatios = new Map<string, number>();
  textRatio = 0.5;
  chapters: IndexedEntry[] = [];
  pages: IndexedEntry[] = [];
  constructor(
    readonly info: BookInfo,
    fractions: Record<string, number> = {},
  ) {
    this.#fractions = { ...fractions };
    this.#indexed = new Set(Object.keys(fractions));
    for (const entry of [
      ...flattenContents(info.toc),
      ...flattenContents(info.pageList),
    ])
      if (entry.sectionIndex !== undefined)
        this.#sections.set(entry.href, entry.sectionIndex);
    this.rebuild();
  }
  get contents(): TocItem[] {
    return flattenContents(this.info.toc).some((item) => item.href)
      ? this.info.toc
      : this.info.sections
          .filter((section) => section.linear)
          .map((section) => ({
            href: section.href,
            label: section.label,
            subitems: [],
          }));
  }
  get fallback() {
    return !flattenContents(this.info.toc).some((item) => item.href);
  }
  get fractions() {
    return { ...this.#fractions };
  }
  get complete() {
    return [
      ...flattenContents(this.contents),
      ...flattenContents(this.info.pageList),
    ].every((item) => !item.href || this.#indexed.has(item.href));
  }
  sectionFor(href: string) {
    const index = this.#sections.get(href);
    if (index !== undefined) return this.info.sections[index];
    const path = href.split("#")[0];
    return this.info.sections.find((section) => section.href === path);
  }
  fraction(href: string) {
    return Object.hasOwn(this.#fractions, href)
      ? this.#fractions[href]
      : (this.sectionFor(href)?.start ?? 0);
  }
  set(
    href: string,
    fraction: number,
    sectionLabel?: string,
    textRatio?: number,
  ) {
    this.#fractions[href] = unit(fraction);
    this.#indexed.add(href);
    const section = this.sectionFor(href);
    if (section && textRatio !== undefined && Number.isFinite(textRatio)) {
      this.#textRatios.set(section.href, unit(textRatio));
      this.textRatio = this.info.sections.reduce(
        (sum, item) =>
          sum +
          (item.end - item.start) * (this.#textRatios.get(item.href) ?? 0.5),
        0,
      );
    }
    if (sectionLabel) {
      if (section) section.label = sectionLabel;
    }
  }
  rebuild() {
    const entries = (items: TocItem[]) =>
      flattenContents(items)
        .filter((item) => item.href)
        .map((item) => ({
          ...item,
          fraction: this.fraction(item.href),
          indexed: this.#indexed.has(item.href),
        }))
        .sort((a, b) => a.fraction - b.fraction);
    this.chapters = entries(this.contents).filter(
      (item) => this.sectionFor(item.href)?.linear !== false,
    );
    this.pages = entries(this.info.pageList);
  }
  chapterAt(fraction: number) {
    return (
      this.chapters[Math.max(0, lower(this.chapters, fraction) - 1)] ?? null
    );
  }
  pageAt(fraction: number) {
    return this.pages[lower(this.pages, fraction) - 1] ?? null;
  }
  nextChapter(fraction: number) {
    return this.chapters[lower(this.chapters, fraction)] ?? null;
  }
  chapterEnd(fraction: number) {
    const next = this.nextChapter(fraction);
    const section = this.info.sections.find(
      (section) => section.linear && fraction < section.end - 1e-9,
    );
    return next?.indexed
      ? next.fraction
      : Math.min(next?.fraction || 1, section?.end ?? 1);
  }
  locationAt(fraction: number) {
    return Math.min(
      this.info.locationCount,
      Math.max(
        1,
        Math.floor((unit(fraction) * this.info.linearSize) / 1500) + 1,
      ),
    );
  }
  /** Never interpret the old persisted numeric position field as a new one-based location. */
  locationFor(locator: DurtalLocator) {
    const section = this.info.sections[locator.sectionIndex];
    const fraction = section?.linear
      ? section.start + locator.progression * (section.end - section.start)
      : locator.totalProgression;
    return this.locationAt(fraction);
  }
  positionLabel(fraction: number) {
    const page = this.pageAt(fraction);
    return page
      ? "p. " + page.label
      : "Location " + this.locationAt(fraction).toLocaleString();
  }
  locatorLabel(locator: DurtalLocator) {
    return locator.pageLabel
      ? "p. " + locator.pageLabel
      : "Location " + this.locationFor(locator).toLocaleString();
  }
  preview(fraction: number) {
    return [
      this.chapterAt(fraction)?.label,
      this.positionLabel(fraction),
      Math.round(fraction * 100) + "%",
    ]
      .filter(Boolean)
      .join(" · ");
  }
}

export function chapterTicks(
  items: readonly number[],
  width: number,
): number[] {
  let previous = -Infinity;
  return [...items]
    .sort((a, b) => a - b)
    .filter((fraction) => {
      const px = fraction * width;
      if (px - previous < 4) return false;
      previous = px;
      return true;
    });
}
