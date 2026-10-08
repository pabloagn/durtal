import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { SectionHeading } from "@/components/shared/section-heading";
import { buttonClass } from "@/components/ui/button";
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
      <PageHeader title="eBooks" description="How e-book files reach the catalogue: each run, what it stored and whether it reconciled." />
      <section>
        <SectionHeading title="Ingestion runs" count={total} />
        {runs.length > 0 ? (
          <ul className="divide-y divide-glass-border rounded-sm border border-glass-border bg-bg-secondary" data-run-list="">
            {runs.map((run) => (
              <RunRow key={run.id} run={run} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-fg-secondary">
            No runs yet. The ingest command, run on the machine that holds the files, records each apply here.
          </p>
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
