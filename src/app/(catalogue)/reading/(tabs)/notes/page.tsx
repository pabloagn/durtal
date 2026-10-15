import { Suspense } from "react";
import { Quote } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/shared/pagination";
import { NoResults, PageOutOfRange } from "@/components/shared/no-results";
import { ReadingTabs } from "@/components/reading/reading-tabs";
import { AddQuoteButton } from "@/components/reading/hub-actions";
import { NotesList, type NotesListRow } from "@/components/reading/notes-list";
import { getNotesFacets, searchNotes, type NoteWithBook } from "@/lib/actions/reading-notes";
import { parseNotesQuery } from "@/lib/reading/notes-params";
import { slimNote } from "@/lib/reading/notes-text";
import { clearedListHref, firstPageHref, hasListQuery, exportFilters } from "@/lib/utils/list-params";
import { ExportMenu } from "@/components/shared/export-menu";
import { toSearchParams, type ListSearchParams } from "@/lib/utils/pagination";
import { NotesFilters } from "./notes-filters";

export const metadata = { title: "Notes" };

/** A note as the list takes it: slim, with its book's link */
function listRow(note: NoteWithBook): NotesListRow {
  return { ...slimNote(note), book: { id: note.book.id, title: note.book.title, author: note.book.author, href: `/library/${note.book.slug ?? note.book.id}` } };
}

async function NotesResults({ params, total }: { params: ListSearchParams; total: number }) {
  const query = parseNotesQuery(params);
  const search = toSearchParams(params);
  const result = await searchNotes({
    q: query.q,
    workId: query.workId,
    authorId: query.authorId,
    editionId: query.editionId,
    translatorId: query.translatorId,
    kind: query.kind,
    favourites: query.favourites || undefined,
    year: query.year,
    sort: query.sort,
    order: query.order,
    page: query.page,
    perPage: query.perPage,
  });
  if (result.total === 0)
    return (
      <NoResults
        noun="quotes or notes"
        search={query.q}
        hasFilters={Boolean(query.workId || query.authorId || query.editionId || query.translatorId || query.kind || query.favourites || query.year)}
        clearHref={clearedListHref("/reading/notes", search)}
      />
    );
  if (result.items.length === 0) return <PageOutOfRange firstPageHref={firstPageHref("/reading/notes", search)} />;
  const filtered = hasListQuery(search) && result.total !== total;
  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-fg-secondary" data-notes-summary="">
          {filtered ? `${result.total.toLocaleString("en-US")} of ${total.toLocaleString("en-US")}` : `${total.toLocaleString("en-US")} quotes and notes`}
        </p>
        {/* Every note the filters keep, not only this page */}
        <ExportMenu entity="reading-notes" ids={{ filters: exportFilters(search) }} noun="quotes and notes" align="end" side="bottom" />
      </div>
      <div id="list-start">
        <NotesList rows={result.items.map(listRow)} byBook={query.sort === "book"} editions={result.noteEditions} />
      </div>
      <div className="mt-8">
        <Pagination page={result.page} perPage={query.perPage} total={result.total} noun="quotes and notes" />
      </div>
    </>
  );
}

/**
 * The commonplace book (SLN-453): every quote and note, found by a few
 * remembered words (accents and typos forgiven), by book, author, kind,
 * star or year added, and by edition or translator (SLN-480).
 */
export default async function ReadingNotesPage({ searchParams }: { searchParams: Promise<ListSearchParams> }) {
  const params = await searchParams;
  // The chosen book's editions feed the Edition filter (SLN-480)
  const facets = await getNotesFacets(parseNotesQuery(params).workId);
  return (
    <>
      <PageHeader title="Reading" actions={<AddQuoteButton variant="primary" />} tabs={<ReadingTabs />} />
      {facets.total === 0 ? (
        <EmptyState
          icon={Quote}
          title="No quotes yet"
          action={<AddQuoteButton variant="secondary" />}
        />
      ) : (
        <>
          <NotesFilters facets={facets} />
          <Suspense key={toSearchParams(params).toString()} fallback={<div className="h-96" />}>
            <NotesResults params={params} total={facets.total} />
          </Suspense>
        </>
      )}
    </>
  );
}

