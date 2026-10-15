/*
 * The library statistics' pure parts (SLN-742): the buckets of the "When
 * they were written" chart and its labels. Client-safe: no server imports.
 */

export interface YearCount {
  year: number;
  count: number;
}

export interface Bucket {
  /** The first year in the bucket; null for the "Earlier" bucket */
  start: number | null;
  /** The axis and table label: "1957", "1950s", "Before 1800" */
  label: string;
  count: number;
}

/** "1957", or "800 BC" for a year before the common era */
export function yearLabel(year: number): string {
  return year < 0 ? `${-year} BC` : String(year);
}

/** "1950s", or "800s BC" */
export function decadeLabel(decade: number): string {
  return decade < 0 ? `${-decade}s BC` : `${decade}s`;
}

const decadeOf = (year: number) => Math.floor(year / 10) * 10;

/** The year by which `share` of the books were written */
function percentile(years: YearCount[], share: number): number {
  const total = years.reduce((s, y) => s + y.count, 0);
  let seen = 0;
  for (const y of years) {
    seen += y.count;
    if (seen >= total * share) return y.year;
  }
  return years[years.length - 1].year;
}

/** At most this many bars: the oldest books beyond them are one "Earlier" bar or a footnote */
const MAX_YEARS = 200;
const MAX_DECADES = 60;

/**
 * Every year from the first shown to the last book, empty years included, so
 * the bars are a timeline. A library with a few ancient books starts at the
 * decade of its earliest 2% (and at most 200 years back); `earlier` counts
 * the books before that.
 */
export function yearBuckets(years: YearCount[]): { bars: Bucket[]; earlier: number; from: number | null } {
  if (!years.length) return { bars: [], earlier: 0, from: null };
  const sorted = [...years].sort((a, b) => a.year - b.year);
  const last = sorted[sorted.length - 1].year;
  const from = Math.max(sorted[0].year, decadeOf(percentile(sorted, 0.02)), last - MAX_YEARS + 1);
  const counts = new Map(sorted.map((y) => [y.year, y.count]));
  const bars: Bucket[] = [];
  for (let year = from; year <= last; year++) bars.push({ start: year, label: yearLabel(year), count: counts.get(year) ?? 0 });
  const earlier = sorted.filter((y) => y.year < from).reduce((s, y) => s + y.count, 0);
  return { bars, earlier, from };
}

/**
 * Every decade from the first shown to the last, empty ones included. Past
 * 60 decades, the oldest books are one "Before …" bar at the start.
 */
export function decadeBuckets(years: YearCount[]): Bucket[] {
  if (!years.length) return [];
  const counts = new Map<number, number>();
  for (const y of years) counts.set(decadeOf(y.year), (counts.get(decadeOf(y.year)) ?? 0) + y.count);
  const decades = [...counts.keys()].sort((a, b) => a - b);
  const last = decades[decades.length - 1];
  const first = Math.max(decades[0], last - (MAX_DECADES - 1) * 10);
  const bars: Bucket[] = [];
  const earlier = decades.filter((d) => d < first).reduce((s, d) => s + counts.get(d)!, 0);
  if (earlier) bars.push({ start: null, label: `Before ${yearLabel(first)}`, count: earlier });
  for (let decade = first; decade <= last; decade += 10) bars.push({ start: decade, label: decadeLabel(decade), count: counts.get(decade) ?? 0 });
  return bars;
}

/** "312 of 452", as a whole percent of the total: 0 for nothing */
export function percentOf(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

/**
 * The title of the languages, countries and categories section names only
 * the lists it shows (SLN-825): "Languages", "Languages and categories"
 */
export function originsTitle(shown: { languages: boolean; countries: boolean; categories: boolean }): string {
  const words = (["languages", "countries", "categories"] as const).filter((list) => shown[list]);
  const text = words.length > 1 ? `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}` : (words[0] ?? "");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
