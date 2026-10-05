import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { SectionHeading } from "@/components/shared/section-heading";
import { Badge } from "@/components/ui/badge";
import { ReadingTabs } from "@/components/reading/reading-tabs";
import { HubActions } from "@/components/reading/hub-actions";
import { Cover } from "@/components/reading/reading-tiles";
import { CommitImport, ImportRowActions, MatchAgain, SectionAction, UndoImport, type CandidateChoice } from "@/components/reading/import/import-client";
import { getImportPreview, SECTION_PAGE, type PreviewRow } from "@/lib/reading/import/page-data";
import { IMPORT_SECTION_LABELS, IMPORT_SECTIONS, onlyUndated, type ImportSection } from "@/lib/reading/import/match-rules";
import {
  addBookHref,
  cannotCarry,
  commitWords,
  fileLine,
  outcomeWords,
  ratingLine,
  reasonWords,
  SOURCE_LABELS,
  summaryLine,
  writeLine,
} from "@/lib/reading/import/preview-text";
import { formatReadingDate, readingDay } from "@/lib/reading/dates";
import { appTimeZone, calendarDate } from "@/lib/utils/date";
import { isUuid } from "@/lib/utils/uuid";

export const metadata = { title: "Import preview" };

type Params = Record<string, string | string[] | undefined>;

const SECTION_NOTES: Partial<Record<ImportSection, string>> = {
  choose: "Several books, or a weaker match: choose one, or another book.",
  likely: "One book with the same title and author.",
  none: "No book in Durtal. Add it, then the row matches it.",
  exact: "The same Durtal book, Goodreads id or link, or ISBN.",
  present: "Every read of these rows is already in Durtal. Nothing is written for them.",
  cannot: "A rule of the reading tracker is broken. The reason is on each row.",
  not_imported: "Want-to-read books stay with the import: Up next will take them.",
};

const STATUS_LABEL = { completed: "Imported", pending: "To review", undone: "Undone" } as const;

function one(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

/** The URL that shows 50 more rows of one section, the other sections as they are */
function moreHref(id: string, params: Params, section: ImportSection, shown: number) {
  const next = new URLSearchParams();
  for (const s of IMPORT_SECTIONS) {
    const v = Number(one(params[s]));
    if (Number.isInteger(v) && v > SECTION_PAGE) next.set(s, String(v));
  }
  next.set(section, String(shown + SECTION_PAGE));
  return `/reading/import/${id}?${next.toString()}#section-${section}`;
}

function Row({ row, importId, today }: { row: PreviewRow; importId: string; today: string }) {
  const { data, match, book, written } = row;
  const anyway = row.section === "present" && onlyUndated(match.verdicts);
  const what = written ? null : writeLine(data.readings, match.verdicts, today, { anyway: anyway && row.decision === "import" });
  const writes = !written && match.verdicts.some((v) => v.verdict === "new");
  const rating = ratingLine({ section: row.section, fileRating: data.rating, bookRating: book?.rating, useFileRating: row.useFileRating, writes });
  const reason = reasonWords(match);
  const recordsId = !written && match.reason === "Same ISBN" && data.sourceBookId && book?.editionWithoutGoodreads;
  const outcomes = written
    ? [...new Set(written.readings.map((r) => outcomeWords(r.outcome, r.reason)))]
        .map((w) => `${w}${written.readings.filter((r) => outcomeWords(r.outcome, r.reason) === w).length > 1 ? ` (${written.readings.filter((r) => outcomeWords(r.outcome, r.reason) === w).length})` : ""}`)
        .join(" · ")
    : null;
  const candidates: CandidateChoice[] = row.candidates.map((c) => ({
    workId: c.workId,
    label: [c.title, c.author].filter(Boolean).join(", "),
    score: c.byAuthor ? `${Math.round(c.score * 100)}%` : "Same title",
  }));
  const closed = row.section === "cannot" || row.section === "not_imported";
  return (
    <li className="grid gap-x-6 gap-y-2 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)]" data-import-row={row.rowNo} data-import-row-section={row.section}>
      <div className="min-w-0">
        <p className="lines-1 text-sm text-fg-primary" data-import-file-title="">
          {data.title || "No title"}
        </p>
        <p className="lines-1 text-xs text-fg-secondary">{fileLine(data, today)}</p>
      </div>
      <div className="flex min-w-0 items-center gap-3">
        {book ? (
          <>
            <Cover s3Key={book.cover} className="h-12 w-8" />
            <div className="min-w-0">
              <Link href={`/library/${book.slug ?? book.workId}`} className="lines-1 block text-sm text-fg-primary transition-colors hover:text-accent-rose-text" data-import-book={book.workId}>
                {book.title}
              </Link>
              <p className="lines-1 text-xs text-fg-secondary">{[book.author, book.year].filter(Boolean).join(" · ") || "Unknown author"}</p>
            </div>
          </>
        ) : (
          <p className="text-xs text-fg-secondary">{row.section === "choose" ? "Choose a book" : closed ? "" : "Not in Durtal"}</p>
        )}
      </div>
      <div className="min-w-0 space-y-1">
        {reason && (
          <p className="lines-2 text-xs text-fg-secondary" data-import-reason="">
            {reason}
          </p>
        )}
        {outcomes && (
          <p className="text-xs text-fg-primary" data-import-outcome="">
            {outcomes}
          </p>
        )}
        {what && !closed && (
          <p className="text-xs text-fg-primary" data-import-writes="">
            {what}
          </p>
        )}
        {rating && (
          <p className="text-xs text-fg-secondary" data-import-rating-line="">
            {rating.text}
          </p>
        )}
        {recordsId && <p className="text-xs text-fg-secondary">Records Goodreads id {data.sourceBookId} on this edition</p>}
        {[...data.warnings, ...match.warnings].map((w) => (
          <p key={w} className="text-xs text-fg-secondary">
            {w}
          </p>
        ))}
        {!written && !closed && (
          <ImportRowActions
            importId={importId}
            rowNo={row.rowNo}
            title={data.title}
            decision={row.decision}
            canImport={!!book && (row.section !== "present" || anyway)}
            anyway={anyway}
            canChoose={row.section !== "present"}
            candidates={candidates}
            ratingChoice={rating?.choice ? { checked: row.useFileRating } : null}
            addHref={row.section === "none" && !book ? addBookHref(data) : null}
          />
        )}
      </div>
    </li>
  );
}

/** One import's preview and commit (SLN-450) */
export default async function ImportPreviewPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Params> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const query = await searchParams;
  const limits = Object.fromEntries(IMPORT_SECTIONS.map((s) => [s, Number(one(query[s])) || SECTION_PAGE]));
  const preview = await getImportPreview(id, limits);
  if (!preview) notFound();
  const { header, summary, sections } = preview;
  const today = readingDay(new Date());
  const commit = commitWords(summary.toImport, summary.pending);
  const carry = cannotCarry(header.source, summary, header.errorLog?.missing ?? []);
  const errors = header.errorLog?.errors ?? [];
  const unmatched = summary.sections.choose + summary.sections.none;
  const uploaded = formatReadingDate(calendarDate(new Date(header.createdAt), appTimeZone()), "day");

  return (
    <>
      <PageHeader title="Reading" actions={<HubActions />} tabs={<ReadingTabs />} />
      <div className="space-y-10">
        <section data-import-header="">
          <SectionHeading
            title={header.fileName ?? "Reading history"}
            description={`${SOURCE_LABELS[header.source]} export, uploaded ${uploaded}${header.rawKept ? "" : " · Raw file not kept"}`}
            action={<Badge variant={header.status === "completed" ? "sage" : header.status === "pending" ? "gold" : "muted"}>{STATUS_LABEL[header.status]}</Badge>}
          />
          <p className="text-sm text-fg-secondary" data-import-summary="">
            {summaryLine(summary)}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <CommitImport importId={id} label={commit.label} disabled={summary.toImport === 0} />
            <MatchAgain importId={id} show={unmatched > 0} />
            {header.readings > 0 && <UndoImport importId={id} readings={header.readings} />}
            <Link href="/reading/import" className="text-sm text-fg-secondary transition-colors hover:text-fg-primary">
              All imports
            </Link>
          </div>
          {commit.note && (
            <p className="mt-2 text-xs text-fg-secondary" data-import-pending="">
              {commit.note}
            </p>
          )}
        </section>

        {carry.length > 0 && (
          <section className="rounded-sm border border-glass-border bg-bg-secondary px-4 py-4" data-import-carry="">
            <SectionHeading as="h3" title="What this file cannot carry" />
            <ul className="-mt-1 list-disc space-y-1 pl-5 text-sm text-fg-secondary">
              {carry.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
        )}

        {errors.length > 0 && (
          <section data-import-errors="">
            <SectionHeading title="Not written" count={errors.length} description="The last import left these out." />
            <ul className="space-y-1 text-sm text-fg-secondary">
              {errors.slice(0, 50).map((e) => (
                <li key={`${e.rowNo}-${e.reason}`}>
                  Row {e.rowNo}: {e.reason}
                </li>
              ))}
            </ul>
          </section>
        )}

        {IMPORT_SECTIONS.filter((s) => summary.sections[s] > 0).map((s) => {
          const rows = sections[s];
          const count = summary.sections[s];
          const action =
            s === "likely" ? (
              <SectionAction importId={id} section="likely" label="Accept all likely matches" />
            ) : s === "none" ? (
              <SectionAction importId={id} section="none" label="Skip all not in Durtal" />
            ) : undefined;
          return (
            <section key={s} id={`section-${s}`} className="scroll-mt-24" data-import-section={s}>
              <SectionHeading title={IMPORT_SECTION_LABELS[s]} count={count} description={SECTION_NOTES[s]} action={action} />
              <ul className="divide-y divide-glass-border rounded-sm border border-glass-border bg-bg-secondary">
                {rows.map((row) => (
                  <Row key={row.rowNo} row={row} importId={id} today={today} />
                ))}
              </ul>
              {count > rows.length && (
                <Link href={moreHref(id, query, s, rows.length)} scroll={false} className="mt-3 inline-flex h-8 items-center text-sm text-fg-secondary transition-colors hover:text-fg-primary pointer-coarse:h-11" data-import-more={s}>
                  Show {Math.min(SECTION_PAGE, count - rows.length)} more
                </Link>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}
