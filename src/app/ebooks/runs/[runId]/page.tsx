import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SectionHeading } from "@/components/shared/section-heading";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { runLength, runPlace, runTime } from "@/components/ebooks/run-row";
import { RunItemRow, shortPath } from "@/components/ebooks/run-item-row";
import { RunRefresh } from "@/components/ebooks/run-refresh";
import { countsLine, reconciliationLine, runStateLabel, RUN_KIND_LABEL } from "@/lib/ebooks/run-text";
import { getRun, runSections, RUN_ROWS_STEP, RUN_SECTIONS, shownRows, type RunSectionKey } from "@/lib/ebooks/runs";
import { isUuid } from "@/lib/utils/uuid";

export const metadata = { title: "Ingestion run" };

type Params = Record<string, string | string[] | undefined>;

/** "Show 50 more" for one section: the URL keeps every other section's rows */
function MoreLink({ params, section, shown, total }: { params: Params; section: string; shown: number; total: number }) {
  const more = Math.min(RUN_ROWS_STEP, total - shown);
  if (more <= 0) return null;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (typeof value === "string") query.set(key, value);
  query.set(section, String(shown + more));
  return (
    <Link href={`?${query}#${section}`} scroll={false} className={`mt-4 ${buttonClass("secondary", "sm")}`}>
      Show {more} more
    </Link>
  );
}

const list = "divide-y divide-glass-border rounded-sm border border-glass-border bg-bg-secondary";

/** One ingestion run (SLN-494): the reconciliation, then its files by outcome. Read only. */
export default async function IngestionRunPage({ params, searchParams }: { params: Promise<{ runId: string }>; searchParams: Promise<Params> }) {
  const [{ runId }, query] = await Promise.all([params, searchParams]);
  if (!isUuid(runId)) notFound();
  const run = await getRun(runId);
  if (!run) notFound();
  const shown = Object.fromEntries(RUN_SECTIONS.map((s) => [s.key, shownRows(query[s.key])])) as Record<RunSectionKey, number>;
  const sections = await runSections(run.id, shown);
  const state = runStateLabel(run);
  const r = run.reconciliation;
  const blocking = r?.exceptions.filter((e) => e.blocking) ?? [];
  const shownExceptions = shownRows(query.exceptions);

  return (
    <>
      <Link
        href="/ebooks/runs"
        className="mb-6 inline-flex items-center gap-1.5 text-xs text-fg-secondary transition-colors hover:text-fg-primary touch-hit"
      >
        <ArrowLeft className="h-3 w-3" strokeWidth={1.5} aria-hidden />
        Ingestion runs
      </Link>
      <PageHeader
        title={`${RUN_KIND_LABEL[run.kind] ?? run.kind}, ${runTime(run.startedAt)}`}
        description={`${runPlace(run)} · ${runLength(run)}`}
        actions={<Badge variant={state.tone}>{state.label}</Badge>}
      />
      {run.state === "running" && <RunRefresh />}

      <div className="mb-10 space-y-1.5 text-sm" data-run-summary="">
        {r && <p className="text-fg-primary">{reconciliationLine(r)}</p>}
        <p className="text-fg-secondary">{countsLine(run.counts)}</p>
        {r && (
          <p className="text-fg-secondary">
            {r.noLongerInInbox.toLocaleString("en-US")} no longer in the inbox (stored and verified) · {r.inFlight.toLocaleString("en-US")} in flight
          </p>
        )}
        {run.state === "running" && <p className="text-fg-secondary">Running: the counts refresh every 10 seconds while this page is open.</p>}
        {run.state === "interrupted" && (
          <p className="text-fg-secondary">
            {run.host ? `Interrupted on ${run.host}; it resumes from there.` : "Interrupted; the upload can be sent again."}
          </p>
        )}
      </div>

      <div className="space-y-10">
        {blocking.length > 0 && (
          <section id="exceptions">
            <SectionHeading title="Reconciliation exceptions" count={blocking.length} description="What keeps the reconciliation from being exact." />
            <ul className={list}>
              {blocking.slice(0, shownExceptions).map((e, i) => (
                <li key={`${e.kind}:${e.path}:${i}`} className="px-4 py-3">
                  <p className="lines-1 text-sm text-fg-primary" data-tooltip={e.path}>
                    {shortPath(e.path, run.roots)}
                  </p>
                  <p className="lines-1 text-xs text-fg-secondary">{e.reason}</p>
                </li>
              ))}
            </ul>
            <MoreLink params={query} section="exceptions" shown={Math.min(shownExceptions, blocking.length)} total={blocking.length} />
          </section>
        )}
        {sections.map((section) => (
          <section key={section.key} id={section.key}>
            <SectionHeading title={section.title} count={section.total} />
            <ul className={list}>
              {section.items.map((item) => (
                <RunItemRow key={item.id} item={item} roots={run.roots} />
              ))}
            </ul>
            <MoreLink params={query} section={section.key} shown={section.items.length} total={section.total} />
          </section>
        ))}
        {sections.length === 0 && blocking.length === 0 && (
          <p className="text-sm text-fg-secondary">
            {run.kind === "verify" ? "A verification checks the stored files; it considers no files on disk." : "This run considered no files."}
          </p>
        )}
      </div>
    </>
  );
}
