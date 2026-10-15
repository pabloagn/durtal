import type { BookInfo, DurtalLocator, TocItem } from "./engine";
import { fractionPercent, locationWords, pageRangeWords, pageWords, samePlace } from "./place-label";

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
  /** Sections with a page marker not yet placed; cached for Contents, which asks per entry */
  #unplaced: Set<unknown> | null = null;
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
    this.#unplaced = null;
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
    this.#unplaced = null;
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
  /**
   * Where a screen starts, as a fraction of the book. A locator's
   * `totalProgression` is where the screen ends (foliate's fraction is the end
   * of the visible spread); its `progression` is the start within the section.
   */
  startFraction(locator: DurtalLocator) {
    const section = this.info.sections[locator.sectionIndex];
    return section?.linear
      ? section.start + locator.progression * (section.end - section.start)
      : locator.totalProgression;
  }
  /** Never interpret the old persisted numeric position field as a new one-based location. */
  locationFor(locator: DurtalLocator) {
    return this.locationAt(this.startFraction(locator));
  }
  /**
   * The page in force at a point, where a page marker just after the point
   * (within a line or two, in the same section) is that point's page: a
   * marker usually sits just after the heading or line it belongs to. At a
   * section's start the file's head comes first, so its first marker within
   * a location (1,500 characters) is the page it opens on.
   */
  pageNear(fraction: number, section = this.sectionAt(fraction)) {
    const next = this.pages[lower(this.pages, fraction)];
    const opening = section && Math.abs(fraction - section.start) < 1e-9;
    const near = this.info.linearSize > 0 ? (opening ? 1500 : 150) / this.info.linearSize : 0;
    if (next && next.fraction - fraction <= near && (!section || this.sectionFor(next.href) === section))
      return next;
    return this.pageAt(fraction);
  }
  sectionAt(fraction: number) {
    return this.info.sections.find(
      (section) => section.linear && fraction >= section.start - 1e-9 && fraction < section.end - 1e-9,
    );
  }
  /**
   * The first and last page a screen shows (SLN-680), by the same rule as the
   * contents (`entryPage`), so opening an entry lands on a screen that names
   * its page. Null without page markers, or before they are all indexed.
   */
  screenPages(locator: DurtalLocator) {
    if (!this.pages.length || !this.complete) return null;
    const start = this.startFraction(locator);
    const first = this.pageNear(start, this.info.sections[locator.sectionIndex]);
    if (!first) return null;
    const end = Math.max(start, locator.totalProgression - 1e-6);
    // The engine names the last page marker on screen (`pageLabel`); the end
    // fraction is measured by layout, the markers by text, so take the later
    const named = locator.pageLabel ? this.pages.find((page) => page.label === locator.pageLabel) : undefined;
    const last = [this.pageAt(end), named].reduce<typeof first | null | undefined>(
      (later, page) => (page && (!later || page.fraction > later.fraction) ? page : later), null);
    return { first, last: last && last.fraction > first.fraction ? last : first };
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
  /** The pages or location a screen shows, as the bar, the margins and search name it */
  locatorLabel(locator: DurtalLocator) {
    const pages = this.screenPages(locator);
    if (pages)
      return pageRangeWords(pages.first.label, pages.last.label, this.info.pageList.at(-1)?.label,
        this.info.layout === "pre-paginated");
    return locator.pageLabel
      ? this.pageWords(locator.pageLabel)
      : locationWords(this.locationFor(locator), this.info.locationCount);
  }
  /** The first page a place shows, by label, for marks and the read-elsewhere offer */
  firstPage(locator: DurtalLocator) {
    return this.screenPages(locator)?.first.label ?? locator.pageLabel ?? null;
  }
  /**
   * The page a contents entry starts on. Page markers usually sit just after
   * the heading they belong to; a marker within a line or two of the entry,
   * in its section, is its page, not the page before (SLN-680).
   */
  entryPage(href: string) {
    const section = this.sectionFor(href);
    // An anchor not yet indexed stands at its section's start, and so does
    // every page marker in it: until they are placed no page is named, rather
    // than the section's last one for every entry (SLN-724)
    this.#unplaced ??= new Set(this.pages.filter((page) => !this.placed(page.href)).map((page) => this.sectionFor(page.href)));
    if (!this.placed(href) || this.#unplaced.has(section)) return null;
    return this.pageNear(this.fraction(href), section);
  }
  /** A file's own start needs no indexing; an anchor inside it does */
  placed(href: string) {
    return this.#indexed.has(href) || !href.includes("#");
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
