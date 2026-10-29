import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { buttonClass } from "@/components/ui/button";
import { getReviewQueue } from "@/lib/ebooks/review-queue/queries";
import { parseReviewParams, reviewParamsSearch } from "@/lib/ebooks/review-queue/params";
import { DifferencesSection } from "@/components/ebooks/differences-section";
import { DIFFERENCE_FIELDS, type DifferenceField } from "@/lib/ebooks/differences/compare";
import { getDifferences } from "@/lib/ebooks/differences/store";
import { ReviewView } from "./review-view";
import { InstantReviewFilters } from "./instant-review-filters";
import { reviewSummary } from "@/lib/ebooks/review-queue/summary";

export const metadata: Metadata = { title: "Review eBooks" };
/** As the review sections: 20 rows a page keeps the page within its weight after a large load */
const DIFFERENCES_PAGE = 20;
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
  return <div>
    <PageHeader title="Review eBooks" description={reviewSummary(queue.counts)} />
    <InstantReviewFilters languages={queue.languages} />
    <ReviewView queue={queue} params={params} differences={<DifferencesSection page={differences} step={DIFFERENCES_PAGE}
      links={Object.fromEntries(DIFFERENCE_FIELDS.filter((f) => differences.counts[f]).map((f) => [f, differenceHref(f, DIFFERENCES_PAGE)]))}
      moreHref={differences.field && (differences.counts[differences.field] ?? 0) > differences.shown && differences.shown < DIFFERENCES_MAX
        ? differenceHref(differences.field, differences.shown + DIFFERENCES_PAGE) : null} />} />
  </div>;
}
