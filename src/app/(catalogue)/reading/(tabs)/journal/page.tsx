import Link from "next/link";
import { ordinalRead } from "@/lib/reading/labels";
import { Fragment, Suspense } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeading } from "@/components/shared/section-heading";
import { Pagination } from "@/components/shared/pagination";
import { NoResults, PageOutOfRange } from "@/components/shared/no-results";
import { ReadingTabs } from "@/components/reading/reading-tabs";
import { BookMarked } from "lucide-react";
import { HubActions } from "@/components/reading/hub-actions";
import { JournalRows, type JournalItem } from "@/components/reading/reading-tiles";
import { getJournalFacets, queryJournal, journalWork, type JournalRow } from "@/lib/reading/journal";
import { journalGroup, parseJournalQuery } from "@/lib/reading/journal-params";
import { formatReadingSpan } from "@/lib/reading/dates";
import { readingToday } from "@/lib/reading/day";
import { clearedListHref, firstPageHref, exportFilters } from "@/lib/utils/list-params";
import { ExportMenu } from "@/components/shared/export-menu";
import { toSearchParams, type ListSearchParams } from "@/lib/utils/pagination";
import { languageName } from "@/lib/utils/language";
import { JournalFilters } from "./journal-filters";

export const metadata = { title: "Reading journal" };

const OUTCOME: Record<JournalRow["status"], string> = { reading: "Reading", paused: "Paused", finished: "Finished", abandoned: "Abandoned" };

const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** A journal row, as the list takes it */
function journalItem(row: JournalRow, today: string, exactWork = false): JournalItem {
  // A translation: the edition's language when it is not the original's
  const translated =
    row.editionLanguage && row.originalLanguage && row.editionLanguage !== row.originalLanguage
      ? (languageName(row.editionLanguage) ?? row.editionLanguage)
      : null;
  return {
    reading: { workId: row.workId, readingId: row.id, fingerprint: row.fingerprint },
    title: row.title,
    status: row.status,
    href: `/library/${row.slug ?? row.workId}`,
    cover: row.cover,
    author: row.author ? { name: row.author, href: row.authorSlug ? `/people/${row.authorSlug}` : null } : null,
    line: [exactWork ? ordinalRead(row.ordinal) : null, formatReadingSpan(row, today), `${OUTCOME[row.status]}${row.reread ? " · re-read" : ""}`].filter(Boolean).join(" · "),
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
  // With no reading at all, the page draws its own empty state (SLN-842)
  if (summary.readings === 0) {
    return (
      <NoResults
        noun="readings"
        search={query.q}
        hasFilters={Boolean(query.workId || query.invalidWork || query.status.length || query.formats.length || query.yearMin || query.yearMax || query.minRating || query.rereads)}
        clearHref={clearedListHref("/reading/journal", search)}
      />
    );
  }
  if (rows.length === 0) return <PageOutOfRange firstPageHref={firstPageHref("/reading/journal", search)} />;
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-fg-secondary" data-journal-summary="">
          {/* Each count stays whole, its dot after it: the line breaks between
              counts, never at "re- / reads", and never starts with a dot */}
          {[
            count(summary.readings, "reading"),
            `${summary.finished.toLocaleString("en-US")} finished`,
            `${summary.abandoned.toLocaleString("en-US")} abandoned`,
            count(summary.rereads, "re-read"),
          ].map((part, index, parts) => <Fragment key={index}>{index > 0 && " "}<span className="whitespace-nowrap">{part}{index < parts.length - 1 && "\u00a0·"}</span></Fragment>)}
        </p>
        {/* Every reading the filters keep, not only this page. Wrapped under
            the counts on a phone, its label starts at their text edge; at the
            end of their line the margin only narrows the gap */}
        <div className="-ml-2.5">
          <ExportMenu entity="readings" ids={{ filters: exportFilters(search) }} noun="readings" align="end" side="bottom" />
        </div>
      </div>
      {/* A deleted row's focus moves on to the next row (FocusKeeper, SLN-1074) */}
      <div className="space-y-8" id="list-start" data-focus-list="journal">
        {grouped(rows, query.sort === "finished").map((group, i) => (
          <section key={`${group.title}-${i}`}>
            {group.title && <SectionHeading as="h3" title={group.title} />}
            <JournalRows rows={group.rows.map((row) => journalItem(row, today, !!query.workId))} />
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
  const query = parseJournalQuery(params);
  const work = query.workId ? await journalWork(query.workId) : null;
  // The filters' choices come from every reading, not the filtered ones
  const { yearRange, formats } = await getJournalFacets();
  // Every reading has a format: none means no reading at all. Then no
  // toolbar over nothing, even under a stale search, and no second Start a
  // book: the header has it (SLN-842)
  if (formats.length === 0) {
    return (
      <>
        <PageHeader title="Reading" actions={<HubActions />} tabs={<ReadingTabs />} />
        <EmptyState
          icon={BookMarked}
          heading="h2"
          title="No readings yet"
          description="The journal keeps each time you read a book, from its start to its end. Start a book, or log one you read before."
        />
      </>
    );
  }
  return (
    <>
      <PageHeader title="Reading" actions={<HubActions />} tabs={<ReadingTabs />} />
      {(work || query.invalidWork || query.workId) && <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-fg-secondary" data-journal-work="">
        <span>{work ? `Readings of ${work.title}` : "This book is unavailable"}</span>
        {work && <Link href={`/library/${work.slug ?? work.id}#reading`} className="underline underline-offset-2 touch-hit">Back to book history</Link>}
        <Link href="/reading/journal" className="underline underline-offset-2 touch-hit">All books</Link>
      </div>}
      <JournalFilters yearRange={yearRange} formats={formats} />
      <Suspense key={toSearchParams(params).toString()} fallback={<div className="h-96" />}>
        <JournalResults params={params} />
      </Suspense>
    </>
  );
}
