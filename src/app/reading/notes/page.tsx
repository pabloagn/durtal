import { Suspense } from "react";
import Link from "next/link";
import { Quote } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeading } from "@/components/shared/section-heading";
import { Pagination } from "@/components/shared/pagination";
import { NoResults, PageOutOfRange } from "@/components/shared/no-results";
import { ReadingTabs } from "@/components/reading/reading-tabs";
import { AddQuoteButton } from "@/components/reading/hub-actions";
import { NoteItemView } from "@/components/reading/note-item";
import { NoteControls } from "@/components/reading/note-controls";
import { getNotesFacets, searchNotes, type NoteWithBook } from "@/lib/actions/reading-notes";
import { NOTES_PER_PAGE, parseNotesQuery } from "@/lib/reading/notes-params";
import { noteWhereText } from "@/lib/reading/notes-text";
import { ordinalRead } from "@/lib/reading/labels";
import { clearedListHref, firstPageHref, hasListQuery } from "@/lib/utils/list-params";
import { toSearchParams, type ListSearchParams } from "@/lib/utils/pagination";
import { NotesFilters } from "./notes-filters";

export const metadata = { title: "Notes" };

const bookHref = (book: NoteWithBook["book"]) => `/library/${book.slug ?? book.id}`;

/** Where the note is; with `withBook`, its book and author first */
function meta(note: NoteWithBook, withBook: boolean) {
  const where = [noteWhereText(note), note.readingOrdinal ? ordinalRead(note.readingOrdinal) : null, note.kind === "note" ? "Note" : null]
    .filter(Boolean)
    .join(" · ");
  if (!withBook) return where;
  return (
    <>
      <Link href={bookHref(note.book)} className="text-fg-primary transition-colors hover:text-accent-rose-text">
        {note.book.title}
      </Link>
      {[note.book.author, where].filter(Boolean).map((part) => ` · ${part}`)}
    </>
  );
}

function Item({ note, withBook }: { note: NoteWithBook; withBook: boolean }) {
  return (
    <li className="border-t border-glass-border py-5 first:border-t-0 first:pt-0">
      <NoteItemView note={note} meta={meta(note, withBook)} controls={<NoteControls note={note} book={note.book} />} />
    </li>
  );
}

/** Notes in their books, for the book sort */
function byBook(items: NoteWithBook[]) {
  const groups: { book: NoteWithBook["book"]; items: NoteWithBook[] }[] = [];
  for (const item of items) {
    if (groups.at(-1)?.book.id !== item.book.id) groups.push({ book: item.book, items: [] });
    groups.at(-1)!.items.push(item);
  }
  return groups;
}

async function NotesResults({ params, total }: { params: ListSearchParams; total: number }) {
  const query = parseNotesQuery(params);
  const search = toSearchParams(params);
  const result = await searchNotes({
    q: query.q,
    workId: query.workId,
    authorId: query.authorId,
    kind: query.kind,
    favourites: query.favourites || undefined,
    year: query.year,
    sort: query.sort,
    order: query.order,
    page: query.page,
  });
  if (result.total === 0)
    return (
      <NoResults
        noun="quotes or notes"
        search={query.q}
        hasFilters={Boolean(query.workId || query.authorId || query.kind || query.favourites || query.year)}
        clearHref={clearedListHref("/reading/notes", search)}
      />
    );
  if (result.items.length === 0) return <PageOutOfRange firstPageHref={firstPageHref("/reading/notes", search)} />;
  const filtered = hasListQuery(search) && result.total !== total;
  return (
    <>
      <p className="mb-6 text-sm text-fg-secondary" data-notes-summary="">
        {filtered ? `${result.total.toLocaleString("en-US")} of ${total.toLocaleString("en-US")}` : `${total.toLocaleString("en-US")} quotes and notes`}
      </p>
      <div id="list-start">
        {query.sort === "book" ? (
          <div className="space-y-10">
            {byBook(result.items).map((group, i) => (
              <section key={`${group.book.id}-${i}`} data-notes-book={group.book.id}>
                <SectionHeading
                  as="h3"
                  title={
                    <Link href={bookHref(group.book)} className="transition-colors hover:text-accent-rose-text">
                      {group.book.title}
                    </Link>
                  }
                  description={group.book.author ?? undefined}
                />
                <ul>
                  {group.items.map((note) => (
                    <Item key={note.id} note={note} withBook={false} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ) : (
          <ul>
            {result.items.map((note) => (
              <Item key={note.id} note={note} withBook />
            ))}
          </ul>
        )}
      </div>
      <div className="mt-8">
        <Pagination page={result.page} perPage={NOTES_PER_PAGE} total={result.total} noun="quotes and notes" />
      </div>
    </>
  );
}

/**
 * The commonplace book (SLN-453): every quote and note, found by a few
 * remembered words (accents and typos forgiven), by book, author, kind,
 * star or year added.
 */
export default async function ReadingNotesPage({ searchParams }: { searchParams: Promise<ListSearchParams> }) {
  const params = await searchParams;
  const facets = await getNotesFacets();
  return (
    <>
      <PageHeader title="Reading" actions={<AddQuoteButton variant="primary" />} tabs={<ReadingTabs />} />
      {facets.total === 0 ? (
        <EmptyState
          icon={Quote}
          title="No quotes yet"
          description="Keep the passages you love and your own notes, with the page and the reading they belong to."
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

