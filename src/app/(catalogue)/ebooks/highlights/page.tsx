import { Suspense } from "react";
import { Highlighter } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { NoResults, PageOutOfRange } from "@/components/shared/no-results";
import { Pagination } from "@/components/shared/pagination";
import { HighlightGroup } from "@/components/ebooks/highlight-group";
import {
  GROUPS_PER_PAGE,
  getHighlightBooks,
  getHighlightGroups,
  getHighlightSummary,
  highlightReaderHref,
  parseHighlightParams,
} from "@/lib/ebooks/highlights";
import { ebookCoverImage, ebookPageCoverBase } from "@/lib/ebooks/library-cover";
import { ebookCardData } from "@/lib/ebooks/library-view";
import { clearedListHref, firstPageHref, hasListQuery } from "@/lib/utils/list-params";
import { toSearchParams, type ListSearchParams } from "@/lib/utils/pagination";
import { HighlightsFilters } from "./highlights-filters";

export const metadata = { title: "Highlights" };

const BASE = "/ebooks/highlights";
const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

async function HighlightResults({ search }: { search: ListSearchParams }) {
  const params = parseHighlightParams(search);
  const query = toSearchParams(search);
  const [summary, groups] = await Promise.all([getHighlightSummary(params), getHighlightGroups(params)]);
  if (summary.marks === 0)
    return hasListQuery(query) ? (
      <NoResults
        noun="marks"
        search={params.q || null}
        hasFilters={Boolean(params.colors.length || params.kinds.length || params.ebookId)}
        clearHref={clearedListHref(BASE, query)}
      />
    ) : (
      <EmptyState
        icon={Highlighter}
        title="No highlights yet"
        description="Highlights, notes and bookmarks made in the reader appear here, from every eBook."
      />
    );
  // Filtered to one book, pages count its marks; otherwise books
  if (groups.length === 0 || (params.ebookId && groups[0].marks.length === 0))
    return <PageOutOfRange firstPageHref={firstPageHref(BASE, query)} />;
  const base = ebookPageCoverBase();
  const here = query.size ? `${BASE}?${query}` : BASE;
  return (
    <>
      <p className="mb-6 text-sm text-fg-secondary" data-highlight-summary="">
        {count(summary.marks, "mark")} in {count(summary.books, "eBook")}
      </p>
      <div className="space-y-10" id="list-start">
        {groups.map(({ ebook, total, marks }) => {
          const more = new URLSearchParams(query);
          more.set("ebook", ebook.id);
          more.delete("page");
          return (
            <HighlightGroup
              key={ebook.id}
              book={ebookCardData(ebook, ebookCoverImage(ebook, base))}
              total={total}
              marks={marks}
              readerHref={(markId) => highlightReaderHref(ebook.id, markId, here)}
              moreHref={total > marks.length && !params.ebookId ? `${BASE}?${more}` : null}
            />
          );
        })}
      </div>
      <div className="mt-8">
        {params.ebookId ? (
          <Pagination page={params.page} perPage={params.perPage} total={summary.marks} noun="marks" />
        ) : (
          <Pagination page={params.page} perPage={params.perPage} total={summary.books} noun="eBooks" sizes={[GROUPS_PER_PAGE]} />
        )}
      </div>
    </>
  );
}

/**
 * /ebooks/highlights (SLN-500): every live highlight, note and bookmark of
 * every e-book, grouped by e-book with the newest marks first.
 */
export default async function HighlightsPage({ searchParams }: { searchParams: Promise<ListSearchParams> }) {
  const search = await searchParams;
  const books = await getHighlightBooks();
  return (
    <>
      <PageHeader title="Highlights" description="Every highlight, note and bookmark from your eBooks." />
      <HighlightsFilters books={books} />
      <Suspense key={toSearchParams(search).toString()} fallback={<div className="h-96" />}>
        <HighlightResults search={search} />
      </Suspense>
    </>
  );
}
