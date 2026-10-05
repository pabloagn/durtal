import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { SectionHeading } from "@/components/shared/section-heading";
import { Badge } from "@/components/ui/badge";
import { ReadingTabs } from "@/components/reading/reading-tabs";
import { HubActions } from "@/components/reading/hub-actions";
import { CommitImport, ImportNoteRows, ImportRows, MatchAgain, NotesSectionAction, SectionAction, UndoImport } from "@/components/reading/import/import-client";
import { getImportPreview, SECTION_PAGE } from "@/lib/reading/import/page-data";
import { getImportNotes } from "@/lib/reading/import/notes";
import { IMPORT_SECTION_LABELS, IMPORT_SECTIONS, type ImportSection } from "@/lib/reading/import/match-rules";
import { cannotCarry, commitWords, SOURCE_LABELS, summaryLine } from "@/lib/reading/import/preview-text";
import { rowView } from "@/lib/reading/import/row-view";
import { formatReadingDate } from "@/lib/reading/dates";
import { readingToday } from "@/lib/reading/day";
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
  to_read: "Books on the to-read shelf. Imported, they go to the bottom of Up Next, oldest added first.",
  not_imported: "Books on shelves that are neither read nor to-read stay with the import.",
};

const STATUS_LABEL = { completed: "Imported", pending: "To review", undone: "Undone" } as const;

function one(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

/** The URL that shows 50 more rows of one section (or of the private notes), the other sections as they are */
function moreHref(id: string, params: Params, section: ImportSection | "notes", shown: number) {
  const next = new URLSearchParams();
  for (const s of [...IMPORT_SECTIONS, "notes"]) {
    const v = Number(one(params[s]));
    if (Number.isInteger(v) && v > SECTION_PAGE) next.set(s, String(v));
  }
  next.set(section, String(shown + SECTION_PAGE));
  return `/reading/import/${id}?${next.toString()}#section-${section}`;
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
  // Goodreads private notes (SLN-453), 50 at a time like the sections
  const notes = await getImportNotes(id, Math.min(5000, Math.max(SECTION_PAGE, Number(one(query.notes)) || SECTION_PAGE)));
  const today = await readingToday();
  const commit = commitWords(summary.toImport, summary.pending, summary.toQueue, notes.toImport);
  const carry = cannotCarry(header.source, summary, header.errorLog?.missing ?? []);
  const errors = header.errorLog?.errors ?? [];
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
            <CommitImport importId={id} label={commit.label} disabled={summary.toImport === 0 && summary.toQueue === 0 && notes.toImport === 0} />
            <MatchAgain importId={id} show={summary.noBook > 0} />
            {(header.readings > 0 || header.queued > 0 || header.notes > 0) && (
              <UndoImport importId={id} readings={header.readings} queued={header.queued} notes={header.notes} />
            )}
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
              <ImportRows importId={id} rows={rows.map((row) => rowView(row, today))} />
              {count > rows.length && (
                <Link href={moreHref(id, query, s, rows.length)} scroll={false} className="mt-3 inline-flex h-8 items-center text-sm text-fg-secondary transition-colors hover:text-fg-primary pointer-coarse:h-11" data-import-more={s}>
                  Show {Math.min(SECTION_PAGE, count - rows.length)} more
                </Link>
              )}
            </section>
          );
        })}

        {notes.count > 0 && (
          <section id="section-notes" className="scroll-mt-24" data-import-section="notes">
            <SectionHeading
              title="Private notes"
              count={notes.count}
              description="Goodreads private notes become notes on their books, on the row's latest read."
              action={notes.count > notes.imported ? <NotesSectionAction importId={id} /> : undefined}
            />
            <ImportNoteRows importId={id} rows={notes.rows} />
            {notes.count > notes.rows.length && (
              <Link
                href={moreHref(id, query, "notes", notes.rows.length)}
                scroll={false}
                className="mt-3 inline-flex h-8 items-center text-sm text-fg-secondary transition-colors hover:text-fg-primary pointer-coarse:h-11"
                data-import-more="notes"
              >
                Show {Math.min(SECTION_PAGE, notes.count - notes.rows.length)} more
              </Link>
            )}
          </section>
        )}
      </div>
    </>
  );
}
