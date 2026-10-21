import Link from "next/link";
import { ArrowLeft, History } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SectionHeading } from "@/components/shared/section-heading";
import { buttonClass } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { RunRow } from "@/components/ebooks/run-row";
import { listRuns, RUN_ROWS_STEP, shownRows } from "@/lib/ebooks/runs";

export const metadata = { title: "Ingestion runs" };

/** eBooks › Ingestion runs (SLN-494): every apply, upload batch and verification, newest first. Read only. */
export default async function IngestionRunsPage({ searchParams }: { searchParams: Promise<{ show?: string | string[] }> }) {
  const shown = shownRows((await searchParams).show);
  const { runs, total } = await listRuns(shown);
  const more = Math.min(RUN_ROWS_STEP, total - runs.length);
  return (
    <>
      {/* Under eBooks, titled by what it lists, like a run's own page (SLN-685) */}
      <Link
        href="/ebooks"
        className="mb-6 inline-flex items-center gap-1.5 text-xs text-fg-secondary transition-colors hover:text-fg-primary touch-hit"
      >
        <ArrowLeft className="h-3 w-3" strokeWidth={1.5} aria-hidden />
        eBooks
      </Link>
      <PageHeader title="Ingestion runs" />
      <section>
        <SectionHeading title="All runs" count={total} />
        {runs.length > 0 ? (
          <ul className="divide-y divide-glass-border rounded-sm border border-glass-border bg-bg-secondary" data-run-list="">
            {runs.map((run) => (
              <RunRow key={run.id} run={run} />
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={History}
            title="No runs yet"
            description="Each apply, upload batch and verification is listed here. Applies come from the ingest command, run on the machine that holds the files."
          />
        )}
        {more > 0 && (
          <Link href={`/ebooks/runs?show=${runs.length + more}`} scroll={false} className={`mt-4 ${buttonClass("secondary", "sm")}`}>
            Show {more} more
          </Link>
        )}
      </section>
    </>
  );
}
