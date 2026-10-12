import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { Button, buttonClass } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EBOOK_FORMATS } from "@/lib/ebooks/formats";
import { languageOptions } from "@/lib/utils/language";
import { getReviewQueue } from "@/lib/ebooks/review-queue/queries";
import { parseReviewParams } from "@/lib/ebooks/review-queue/params";
import { ReviewView } from "./review-view";

export const metadata: Metadata = { title: "Review eBooks" };
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
  const queue = await getReviewQueue(params);
  const pending = Object.entries(queue.counts).filter(([key]) => !["automatic", "partially_held", "not_in_durtal"].includes(key))
    .reduce((total, [, count]) => total + count, 0);
  const selectClass = "h-8 w-full rounded-sm border border-glass-border bg-bg-primary/80 px-2 text-xs text-fg-primary pointer-coarse:h-11";
  return <div>
    <PageHeader title="Review eBooks" description={`${pending.toLocaleString()} to review · ${queue.counts.not_in_durtal.toLocaleString()} not in Durtal · ${queue.counts.automatic.toLocaleString()} linked automatically`} />
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
    <ReviewView queue={queue} params={params} />
  </div>;
}
