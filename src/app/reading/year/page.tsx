import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ReadingTabs } from "@/components/reading/reading-tabs";
import { PastReadButton } from "@/components/reading/hub-actions";
import { finishedYears } from "@/lib/reading/stats";
import { n } from "@/lib/reading/charts";

export const metadata = { title: "Year in review" };

/** The years with finished books (SLN-456), the newest first, each opening its Year in review */
export default async function ReadingYearsPage() {
  const years = await finishedYears();
  return (
    <>
      <PageHeader title="Year in review" tabs={<ReadingTabs />} />
      {years.length === 0 ? (
        <EmptyState icon={CalendarDays} title="No finished books yet" description="Each year you finish a book gets its review here." action={<PastReadButton />} />
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-4" data-review-years="">
          {years.map((y) => (
            <li key={y.year}>
              <Link
                href={`/reading/year/${y.year}`}
                className="block rounded-sm border border-glass-border bg-bg-secondary px-4 py-4 transition-colors hover:border-accent-primary/30"
                data-review-year={y.year}
              >
                <span className="type-stat block text-fg-primary tabular-nums">{y.year}</span>
                <span className="mt-1 block text-xs text-fg-secondary">
                  <span className="sr-only"> · </span>
                  {n(y.books)} {y.books === 1 ? "book" : "books"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
