"use client";
import Link from "next/link";
import { BookOpenText } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { NoResults } from "@/components/shared/no-results";
import { Pagination } from "@/components/shared/pagination";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonClass } from "@/components/ui/button";
import { COL_CLASSES, maxCardWidth } from "@/components/shared/grid-columns";
import {
  usePreference,
  useViewModePreference,
} from "@/lib/hooks/use-preference";
import { LIST_PREFERENCES, GRID_SIZES } from "@/lib/preferences";
import type { EbookCardData } from "@/lib/ebooks/library-view";
import type { EbookLibraryCounts } from "@/lib/ebooks/library-queries";
import { clearedListHref, firstPageHref } from "@/lib/utils/list-params";
import { parseEbookLibraryParams } from "@/lib/ebooks/library-params";
import { EbookCard } from "@/components/ebooks/ebook-card";
import { EbookRow } from "@/components/ebooks/ebook-row";
import { EbooksFilters } from "./ebooks-filters";

export function EbooksView({
  books,
  counts,
  page,
  perPage,
}: {
  books: EbookCardData[];
  counts: EbookLibraryCounts;
  page: number;
  perPage: number;
}) {
  const preference = LIST_PREFERENCES.ebooks;
  const [view, setView] = useViewModePreference<"grid" | "list">(
    preference.view.key,
    ["grid", "list"],
    "grid",
  );
  const [savedColumns, setColumns] = usePreference(
    preference.grid.key,
    preference.grid.fallback,
  );
  const columns = GRID_SIZES.some((value) => value === savedColumns)
    ? savedColumns
    : preference.grid.fallback;
  const router = useRouter();
  const search = useSearchParams();
  const params = parseEbookLibraryParams(search);
  // The reader's Back returns to this page as it is: filters, sort and page
  const returnTo = `/ebooks${search.size ? `?${search.toString()}` : ""}`;
  const clearParams = new URLSearchParams(search.toString());
  clearParams.set("perPage", String(perPage));
  const clearedHref = clearedListHref("/ebooks", clearParams);
  const clearHref = params.state === "excluded"
    ? `${clearedHref}${clearedHref.includes("?") ? "&" : "?"}state=excluded`
    : clearedHref;
  const otherFilters =
    params.linked.length > 0 ||
    params.formats.length > 0 ||
    params.languages.length > 0 ||
    params.drm !== null ||
    params.needsReview !== null;
  const filtered = !!params.q || otherFilters;
  function sort(key: string) {
    const next = new URLSearchParams(search.toString());
    next.set("sort", key);
    next.set(
      "order",
      params.sort === key && params.order === "asc" ? "desc" : "asc",
    );
    router.push(firstPageHref("/ebooks", next), { scroll: false });
  }
  return (
    <>
      <EbooksFilters
        counts={counts}
        view={view}
        setView={setView}
        columns={columns}
        setColumns={setColumns}
      />
      {!books.length ? (
        // As every list: the shared views, with their mark and a way on (task 0611)
        filtered ? (
          <NoResults noun="eBooks" search={params.q || null} hasFilters={otherFilters} clearHref={clearHref} />
        ) : counts.active + counts.excluded ? (
          <EmptyState icon={BookOpenText} title="No eBooks found" description="No eBooks match these filters." />
        ) : (
          <EmptyState
            icon={BookOpenText}
            title="No eBooks yet"
            action={
              <Link href="/ebooks/upload" className={buttonClass("secondary")}>
                Upload eBooks
              </Link>
            }
          />
        )
      ) : (
        <>
          <Pagination
            page={page}
            perPage={perPage}
            total={counts.total}
            noun="eBooks"
            compact
          />
          {view === "grid" ? (
            <div className="@container">
              <div
                className={`grid items-stretch gap-4 ${COL_CLASSES[columns]}`}
              >
                {books.map((book) => (
                  <EbookCard
                    key={book.id}
                    book={book}
                    returnTo={returnTo}
                    sizes={`${maxCardWidth(columns)}px`}
                  />
                ))}
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-fg-secondary">
                <caption className="sr-only">eBook library</caption>
                <thead>
                  <tr className="border-b border-glass-border type-caption">
                    <th aria-label="Cover" />
                    {[
                      ["title", "Title"],
                      ["author", "Authors"],
                      ["format", "Formats"],
                      ["language", "Language"],
                      ["size", "Size"],
                      ["linked", "In Durtal"],
                      ["added", "Added"],
                    ].map(([key, label]) => (
                      <th
                        key={key}
                        className="pr-4 pb-2 font-normal"
                        aria-sort={
                          params.sort === key
                            ? params.order === "asc"
                              ? "ascending"
                              : "descending"
                            : "none"
                        }
                      >
                        <button
                          className="touch-hit whitespace-nowrap"
                          onClick={() => sort(key)}
                        >
                          {label}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {books.map((book) => (
                    <EbookRow key={book.id} book={book} returnTo={returnTo} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination
            page={page}
            perPage={perPage}
            total={counts.total}
            noun="eBooks"
          />
        </>
      )}
    </>
  );
}
