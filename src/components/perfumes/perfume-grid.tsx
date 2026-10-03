"use client";

import { useSearchParams } from "next/navigation";
import { Pagination, type PaginationData } from "@/components/shared/pagination";
import { NoResults, PageOutOfRange } from "@/components/shared/no-results";
import { COL_CLASSES } from "@/components/shared/grid-columns";
import { useHomeView } from "@/components/domains/domain-home-shell";
import { clearedListHref, firstPageHref } from "@/lib/utils/list-params";
import { PerfumeCard, PerfumeRow, type PerfumeCardData } from "./perfume-card";

/** The perfumes of the home in the saved view (grid or list), with paging. */
export function PerfumeGrid({
  perfumes,
  pagination,
  hasFilters,
}: {
  perfumes: PerfumeCardData[];
  pagination: PaginationData;
  hasFilters: boolean;
}) {
  const searchParams = useSearchParams();
  const { viewMode, gridColumns } = useHomeView("perfume");

  if (pagination.total === 0)
    return (
      <NoResults
        noun="perfumes"
        search={searchParams.get("q")}
        hasFilters={hasFilters}
        clearHref={clearedListHref("/perfumes", searchParams)}
      />
    );
  if (perfumes.length === 0)
    return <PageOutOfRange firstPageHref={firstPageHref("/perfumes", searchParams)} />;

  return (
    <>
      <Pagination {...pagination} noun="perfumes" compact />
      {viewMode === "grid" ? (
        <div className="@container">
          <div className={`grid gap-4 ${COL_CLASSES[gridColumns] ?? COL_CLASSES[4]}`}>
            {perfumes.map((perfume) => (
              <PerfumeCard key={perfume.id} perfume={perfume} />
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-1">
          {perfumes.map((perfume) => (
            <PerfumeRow key={perfume.id} perfume={perfume} />
          ))}
        </div>
      )}
      <Pagination {...pagination} noun="perfumes" />
    </>
  );
}
