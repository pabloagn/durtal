import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { Button, buttonClass } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EBOOK_FORMATS } from "@/lib/ebooks/formats";
import { languageOptions } from "@/lib/utils/language";
import { getReviewQueue } from "@/lib/ebooks/review-queue/queries";
import { parseReviewParams, reviewParamsSearch } from "@/lib/ebooks/review-queue/params";
import { DifferencesSection } from "@/components/ebooks/differences-section";
import { DIFFERENCE_FIELDS, type DifferenceField } from "@/lib/ebooks/differences/compare";
import { getDifferences } from "@/lib/ebooks/differences/store";
import { ReviewView } from "./review-view";

export const metadata: Metadata = { title: "Review eBooks" };
const DIFFERENCES_PAGE = 50;
const DIFFERENCES_MAX = 500;
/** The Differences section's field and how many of its rows are shown; anything else falls back to the first field */
function differenceParams(raw: Record<string, string | string[] | undefined>) {
  const field = typeof raw.difference === "string" && (DIFFERENCE_FIELDS as readonly string[]).includes(raw.difference) ? (raw.difference as DifferenceField) : null;
  const shown = typeof raw.differences === "string" ? Number(raw.differences) : DIFFERENCES_PAGE;
  return { field, shown: Number.isInteger(shown) && shown >= DIFFERENCES_PAGE && shown <= DIFFERENCES_MAX ? shown - (shown % DIFFERENCES_PAGE) : DIFFERENCES_PAGE };
}
export default async function ReviewEbooksPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  let params;
  try { params = parseReviewParams(raw); }
  catch {
    return <div><PageHeader title="Review eBooks" description="One or more filters are invalid." />
      <form action="/ebooks/review" method="get">
        <button className={buttonClass()} type="submit">Clear review filters</button>
      </form></div>;
  }
  const [queue, differences] = await Promise.all([getReviewQueue(params), getDifferences(differenceParams(raw))]);
  const differenceHref = (field: DifferenceField | null, shown: number) => {
    const search = reviewParamsSearch(params);
    if (field) search.set("difference", field);
    if (shown > DIFFERENCES_PAGE) search.set("differences", String(shown));
    return `/ebooks/review?${search.toString()}#review-section-differences`;
  };
  const pending = Object.entries(queue.counts).filter(([key]) => !["automatic", "partially_held", "not_in_durtal"].includes(key))
    .reduce((total, [, count]) => total + count, 0);
  const selectClass = "h-8 w-full rounded-sm border border-glass-border bg-bg-primary/80 px-2 text-xs text-fg-primary pointer-coarse:h-11";
  return <div>
    <PageHeader title="Review eBooks" description={`${(pending + queue.counts.not_in_durtal).toLocaleString()} to review, ${queue.counts.not_in_durtal.toLocaleString()} of them not in Durtal · ${queue.counts.automatic.toLocaleString()} linked automatically · ${queue.counts.partially_held.toLocaleString()} partially held`} />
    <form action="/ebooks/review" method="get" className="mb-8 grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(10rem,2fr)_1fr_1fr_1fr_auto]">
      <Input label="Title or author" name="q" defaultValue={params.filters.q} maxLength={200} type="search" />
      <label className="space-y-1.5"><span className="type-label block">Language</span>
        <select name="language" defaultValue={params.filters.language ?? ""} className={selectClass}>
          <option value="">All languages</option>{languageOptions(params.filters.language).map((language) => <option key={language.value} value={language.value}>{language.label}</option>)}
        </select></label>
      <label className="space-y-1.5"><span className="type-label block">Format</span>
        <select name="format" defaultValue={params.filters.format ?? ""} className={selectClass}>
          <option value="">All formats</option>{EBOOK_FORMATS.map((format) => <option key={format} value={format}>{format.toUpperCase()}</option>)}
        </select></label>
      <label className="space-y-1.5"><span className="type-label block">ISBN</span>
        <select name="hasIsbn" defaultValue={params.filters.hasIsbn ?? ""} className={selectClass}>
          <option value="">Any ISBN</option><option value="yes">Has ISBN</option><option value="no">No ISBN</option>
        </select></label>
      {params.filters.work && <input type="hidden" name="work" value={params.filters.work} />}
      {params.filters.run && <input type="hidden" name="run" value={params.filters.run} />}
      {params.filters.author && <input type="hidden" name="author" value={params.filters.author} />}
      {params.filters.series && <input type="hidden" name="series" value={params.filters.series} />}
      <Button type="submit">Apply filters</Button>
    </form>
    <ReviewView queue={queue} params={params} differences={<DifferencesSection page={differences}
      links={Object.fromEntries(DIFFERENCE_FIELDS.filter((f) => differences.counts[f]).map((f) => [f, differenceHref(f, DIFFERENCES_PAGE)]))}
      moreHref={differences.field && (differences.counts[differences.field] ?? 0) > differences.shown && differences.shown < DIFFERENCES_MAX
        ? differenceHref(differences.field, differences.shown + DIFFERENCES_PAGE) : null} />} />
  </div>;
}
