"use client";

import { useSearchParams } from "next/navigation";
import { Pagination, type PaginationData } from "@/components/shared/pagination";
import { NoResults, PageOutOfRange } from "@/components/shared/no-results";
import { COL_CLASSES } from "@/components/shared/grid-columns";
import { useHomeView } from "@/components/domains/domain-home-shell";
import { clearedListHref, firstPageHref } from "@/lib/utils/list-params";
import { PaintingCard, PaintingRow, type PaintingCardData } from "./painting-card";

/** The paintings of the home in the saved view (grid or list), with paging. */
export function PaintingGrid({
  paintings,
  pagination,
  hasFilters,
}: {
  paintings: PaintingCardData[];
  pagination: PaginationData;
  hasFilters: boolean;
}) {
  const searchParams = useSearchParams();
  const { viewMode, gridColumns } = useHomeView("painting");

  if (pagination.total === 0)
    return (
      <NoResults
        noun="paintings"
        search={searchParams.get("q")}
        hasFilters={hasFilters}
        clearHref={clearedListHref("/paintings", searchParams)}
      />
    );
  if (paintings.length === 0)
    return <PageOutOfRange firstPageHref={firstPageHref("/paintings", searchParams)} />;

  return (
    <>
      <Pagination {...pagination} noun="paintings" compact />
      {viewMode === "grid" ? (
        <div className="@container">
          <div className={`grid gap-4 ${COL_CLASSES[gridColumns] ?? COL_CLASSES[4]}`}>
            {paintings.map((painting) => (
              <PaintingCard key={painting.id} painting={painting} />
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-1">
          {paintings.map((painting) => (
            <PaintingRow key={painting.id} painting={painting} />
          ))}
        </div>
      )}
      <Pagination {...pagination} noun="paintings" />
    </>
  );
}
