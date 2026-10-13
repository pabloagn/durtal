import type { BookInfo, DurtalLocator, TocItem } from "./engine";
import { fractionPercent, locationWords, pageWords, samePlace } from "./place-label";

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
  #sectionRoots = new Map<string, BookInfo["sections"][number]>();
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
    for (const section of info.sections)
      if (!this.#sectionRoots.has(section.href))
        this.#sectionRoots.set(section.href, section);
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
    return this.#sectionRoots.get(path);
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
    if (
      section && textRatio !== undefined && Number.isFinite(textRatio) &&
      this.#textRatios.get(section.href) !== unit(textRatio)
    ) {
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
  /** A page by its label, in the words every view uses (`pageWords`) */
  pageWords(label: string) {
    return pageWords(label, this.info.pageList.at(-1)?.label, this.info.layout === "pre-paginated");
  }
  /** The page or location at a point of the book: "p. 7 of 32", "Location 6 of 16" */
  positionLabel(fraction: number) {
    const page = this.pageAt(fraction);
    return page
      ? this.pageWords(page.label)
      : locationWords(this.locationAt(fraction), this.info.locationCount);
  }
  /** The page or location a place starts on, as the bar, the margins and marks name it */
  locatorLabel(locator: DurtalLocator) {
    return locator.pageLabel
      ? this.pageWords(locator.pageLabel)
      : locationWords(this.locationFor(locator), this.info.locationCount);
  }
  /**
   * The page a contents entry starts on. Page markers usually sit just after
   * the heading they belong to; a marker within half a location of the entry,
   * in its section, is its page, not the page before (SLN-680).
   */
  entryPage(href: string) {
    const fraction = this.fraction(href);
    const section = this.sectionFor(href);
    const next = this.pages[lower(this.pages, fraction)];
    const near = this.info.linearSize > 0 ? 750 / this.info.linearSize : 0;
    if (next && next.fraction - fraction <= near && (!section || this.sectionFor(next.href) === section))
      return next;
    return this.pageAt(fraction);
  }
  preview(fraction: number) {
    const place = this.positionLabel(fraction);
    const chapter = this.chapterAt(fraction)?.label;
    return [
      chapter && !(place && samePlace(chapter, place)) ? chapter : null,
      place,
      fractionPercent(fraction),
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
