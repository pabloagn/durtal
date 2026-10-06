import { Suspense } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeading } from "@/components/shared/section-heading";
import { Pagination } from "@/components/shared/pagination";
import { NoResults, PageOutOfRange } from "@/components/shared/no-results";
import { ReadingTabs } from "@/components/reading/reading-tabs";
import { BookMarked } from "lucide-react";
import { HubActions, StartBookButton } from "@/components/reading/hub-actions";
import { JournalRows, type JournalItem } from "@/components/reading/reading-tiles";
import { getJournalFacets, queryJournal, type JournalRow } from "@/lib/reading/journal";
import { journalGroup, parseJournalQuery } from "@/lib/reading/journal-params";
import { formatReadingSpan } from "@/lib/reading/dates";
import { readingToday } from "@/lib/reading/day";
import { clearedListHref, firstPageHref, hasListQuery, exportFilters } from "@/lib/utils/list-params";
import { ExportMenu } from "@/components/shared/export-menu";
import { toSearchParams, type ListSearchParams } from "@/lib/utils/pagination";
import { languageName } from "@/lib/utils/language";
import { JournalFilters } from "./journal-filters";

export const metadata = { title: "Reading journal" };

const OUTCOME: Record<JournalRow["status"], string> = { reading: "Reading", paused: "Paused", finished: "Finished", abandoned: "Abandoned" };

const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** A journal row, as the list takes it */
function journalItem(row: JournalRow, today: string): JournalItem {
  // A translation: the edition's language when it is not the original's
  const translated =
    row.editionLanguage && row.originalLanguage && row.editionLanguage !== row.originalLanguage
      ? (languageName(row.editionLanguage) ?? row.editionLanguage)
      : null;
  return {
    reading: { workId: row.workId, readingId: row.id, fingerprint: row.fingerprint },
    title: row.title,
    href: `/library/${row.slug ?? row.workId}`,
    cover: row.cover,
    line: [row.author, formatReadingSpan(row, today), `${OUTCOME[row.status]}${row.reread ? " · re-read" : ""}`].filter(Boolean).join(" · "),
    format: row.format,
    translated,
    rating: row.rating,
  };
}

/** Rows in their groups: In progress, each year, Date unknown (for the Finished sort) */
function grouped(rows: JournalRow[], byYear: boolean) {
  if (!byYear) return [{ title: null, rows }];
  const groups: { title: string | null; rows: JournalRow[] }[] = [];
  for (const row of rows) {
    const title = journalGroup(row);
    if (groups.at(-1)?.title !== title) groups.push({ title, rows: [] });
    groups.at(-1)!.rows.push(row);
  }
  return groups;
}

async function JournalResults({ params }: { params: ListSearchParams }) {
  const query = parseJournalQuery(params);
  const { rows, summary } = await queryJournal(query);
  const search = toSearchParams(params);
  const today = await readingToday();
  if (summary.readings === 0) {
    return hasListQuery(search) ? (
      <NoResults
        noun="readings"
        search={query.q}
        hasFilters={Boolean(query.status.length || query.formats.length || query.yearMin || query.yearMax || query.minRating || query.rereads)}
        clearHref={clearedListHref("/reading/journal", search)}
      />
    ) : (
      <EmptyState icon={BookMarked} title="No readings yet" description="Every book you start, finish or log from the past shows here." action={<StartBookButton />} />
    );
  }
  if (rows.length === 0) return <PageOutOfRange firstPageHref={firstPageHref("/reading/journal", search)} />;
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-fg-secondary" data-journal-summary="">
          {[
            count(summary.readings, "reading"),
            `${summary.finished.toLocaleString("en-US")} finished`,
            `${summary.abandoned.toLocaleString("en-US")} abandoned`,
            count(summary.rereads, "re-read"),
          ].join(" · ")}
        </p>
        {/* Every reading the filters keep, not only this page */}
        <ExportMenu entity="readings" ids={{ filters: exportFilters(search) }} noun="readings" align="end" side="bottom" />
      </div>
      <div className="space-y-8" id="list-start">
        {grouped(rows, query.sort === "finished").map((group, i) => (
          <section key={`${group.title}-${i}`}>
            {group.title && <SectionHeading as="h3" title={group.title} />}
            <JournalRows rows={group.rows.map((row) => journalItem(row, today))} />
          </section>
        ))}
      </div>
      <div className="mt-8">
        <Pagination page={query.page} perPage={query.perPage} total={summary.readings} noun="readings" />
      </div>
    </>
  );
}

/** Every reading, newest first, in years (SLN-448) */
export default async function ReadingJournalPage({ searchParams }: { searchParams: Promise<ListSearchParams> }) {
  const params = await searchParams;
  // The filters' choices come from every reading, not the filtered ones
  const { yearRange, formats } = await getJournalFacets();
  return (
    <>
      <PageHeader title="Reading" actions={<HubActions />} tabs={<ReadingTabs />} />
      <JournalFilters yearRange={yearRange} formats={formats} />
      <Suspense key={toSearchParams(params).toString()} fallback={<div className="h-96" />}>
        <JournalResults params={params} />
      </Suspense>
    </>
  );
}
