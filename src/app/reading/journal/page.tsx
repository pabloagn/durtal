import { Suspense } from "react";
import Link from "next/link";
import { BookMarked, BookText, Headphones, Tablet } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { SectionHeading } from "@/components/shared/section-heading";
import { RatingStars } from "@/components/shared/rating";
import { Pagination } from "@/components/shared/pagination";
import { NoResults, PageOutOfRange } from "@/components/shared/no-results";
import { ReadingTabs } from "@/components/reading/reading-tabs";
import { HubActions, JournalRowMenu, StartBookButton } from "@/components/reading/hub-actions";
import { Cover } from "@/components/reading/hub-cards";
import { getJournalFacets, queryJournal, type JournalRow } from "@/lib/reading/journal";
import { journalGroup, parseJournalQuery } from "@/lib/reading/journal-params";
import { formatReadingSpan, readingDay } from "@/lib/reading/dates";
import type { ReadingFormat } from "@/lib/reading/constants";
import { clearedListHref, firstPageHref, hasListQuery } from "@/lib/utils/list-params";
import { toSearchParams, type ListSearchParams } from "@/lib/utils/pagination";
import { languageName } from "@/lib/utils/language";
import { JournalFilters } from "./journal-filters";

export const metadata = { title: "Reading journal" };

const FORMAT_ICON: Record<ReadingFormat, typeof BookText> = { print: BookText, ebook: Tablet, audio: Headphones };
const FORMAT_LABEL: Record<ReadingFormat, string> = { print: "Print", ebook: "E-book", audio: "Audiobook" };
const OUTCOME: Record<JournalRow["status"], string> = { reading: "Reading", paused: "Paused", finished: "Finished", abandoned: "Abandoned" };

const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

function JournalItem({ row, today }: { row: JournalRow; today: string }) {
  const Icon = FORMAT_ICON[row.format];
  // A translation: the edition's language when it is not the original's
  const translated =
    row.editionLanguage && row.originalLanguage && row.editionLanguage !== row.originalLanguage
      ? (languageName(row.editionLanguage) ?? row.editionLanguage)
      : null;
  const outcome = `${OUTCOME[row.status]}${row.reread ? " · re-read" : ""}`;
  return (
    <li className="flex items-center gap-3 px-3 py-2" data-journal-row={row.id}>
      <Cover s3Key={row.cover} className="h-12 w-8" />
      <div className="min-w-0 flex-1">
        <Link
          href={`/library/${row.slug ?? row.workId}`}
          className="lines-1 block text-sm text-fg-primary transition-colors hover:text-accent-rose-text"
        >
          {row.title}
        </Link>
        <p className="lines-1 text-xs text-fg-secondary">
          {[row.author, formatReadingSpan(row, today), outcome].filter(Boolean).join(" · ")}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {translated && (
          <span className="hidden sm:inline-flex">
            <Badge variant="blue">{translated}</Badge>
          </span>
        )}
        <span className="hidden text-fg-secondary sm:inline-flex" aria-label={FORMAT_LABEL[row.format]} data-tooltip={FORMAT_LABEL[row.format]} role="img">
          <Icon className="h-4 w-4" strokeWidth={1.5} />
        </span>
        <RatingStars value={row.rating} />
        <JournalRowMenu reading={{ workId: row.workId, readingId: row.id, fingerprint: row.fingerprint }} title={row.title} />
      </div>
    </li>
  );
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
  const today = readingDay(new Date());
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
      <p className="mb-4 text-sm text-fg-secondary" data-journal-summary="">
        {[
          count(summary.readings, "reading"),
          `${summary.finished.toLocaleString("en-US")} finished`,
          `${summary.abandoned.toLocaleString("en-US")} abandoned`,
          count(summary.rereads, "re-read"),
        ].join(" · ")}
      </p>
      <div className="space-y-8" id="list-start">
        {grouped(rows, query.sort === "finished").map((group, i) => (
          <section key={`${group.title}-${i}`}>
            {group.title && <SectionHeading as="h3" title={group.title} />}
            <ul className="divide-y divide-glass-border rounded-sm border border-glass-border bg-bg-secondary">
              {group.rows.map((row) => (
                <JournalItem key={row.id} row={row} today={today} />
              ))}
            </ul>
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
