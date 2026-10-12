"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Pagination } from "@/components/shared/pagination";
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
  const clearParams = new URLSearchParams(search.toString());
  clearParams.set("perPage", String(perPage));
  const clearedHref = clearedListHref("/ebooks", clearParams);
  const clearHref = params.state === "excluded"
    ? `${clearedHref}${clearedHref.includes("?") ? "&" : "?"}state=excluded`
    : clearedHref;
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
        <div className="py-12">
          <h2 className="type-item-title">
            {params.q
              ? `No eBook matches “${params.q}”.`
              : counts.active + counts.excluded
                ? "No eBooks match these filters."
                : "No eBooks yet."}
          </h2>
          {(params.q ||
            params.linked.length ||
            params.formats.length ||
            params.languages.length ||
            params.drm !== null ||
            params.needsReview !== null) && (
            <Link
              href={clearHref}
              className="mt-3 inline-block text-sm text-accent-primary touch-hit"
            >
              Clear search and filters
            </Link>
          )}
        </div>
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
                    <EbookRow key={book.id} book={book} />
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
