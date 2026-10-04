import { Suspense } from "react";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { DOMAIN_ICONS } from "@/components/shortcuts/section-icons";
import { DomainSwitch } from "@/components/domains/domain-switch";
import {
  DomainAddLink,
  domainDescription,
} from "@/components/domains/domain-add-link";
import { PaintingFilters } from "@/components/paintings/painting-filters";
import { PaintingGrid } from "@/components/paintings/painting-grid";
import {
  getPaintingCount,
  getPaintingFilterOptions,
  getPaintings,
} from "@/lib/actions/paintings";
import {
  hasPaintingFilters,
  paintingQueryFromParams,
} from "@/lib/catalogue/painting-params";
import {
  lastPage,
  pageHref,
  parsePagination,
  type ListSearchParams,
} from "@/lib/utils/pagination";

export const metadata = { title: "Paintings" };

/** One page of the paintings the URL asks for: its search, filters, sort and page. */
async function PaintingResults({ params }: { params: ListSearchParams }) {
  const query = paintingQueryFromParams(params);
  const { page, perPage, offset } = parsePagination(params);
  const [paintings, total] = await Promise.all([
    getPaintings({ ...query, limit: perPage, offset }),
    getPaintingCount(query),
  ]);
  if (total > 0 && page > lastPage(total, perPage))
    redirect(pageHref("/paintings", params, lastPage(total, perPage)));
  return (
    <PaintingGrid
      paintings={paintings}
      pagination={{ page, perPage, total }}
      hasFilters={hasPaintingFilters(params)}
    />
  );
}

/**
 * The painting home: a gallery of every painting in the catalogue, whole and
 * uncropped, with its painters, date and owner; filters by painter,
 * movement, genre, technique, medium, support, owning institution, current
 * venue, what you own, favourites and date.
 */
export default async function PaintingsPage({
  searchParams,
}: {
  searchParams: Promise<ListSearchParams>;
}) {
  const params = await searchParams;
  const [catalogued, options] = await Promise.all([
    getPaintingCount(),
    getPaintingFilterOptions(),
  ]);

  return (
    <>
      <PageHeader
        title="Paintings"
        description={domainDescription("painting")}
        actions={<DomainAddLink kind="painting" />}
        tabs={<DomainSwitch current="painting" searchParams={params} />}
      />
      {catalogued === 0 ? (
        <EmptyState
          icon={DOMAIN_ICONS.painting}
          title="No paintings yet"
          description="Add your first painting: who painted it and when, then where the original is and any print or copy you own."
          action={<DomainAddLink kind="painting" />}
        />
      ) : (
        <>
          <PaintingFilters options={options} />
          <Suspense
            key={JSON.stringify(params)}
            fallback={
              <div className="py-16">
                <Spinner />
              </div>
            }
          >
            <PaintingResults params={params} />
          </Suspense>
        </>
      )}
    </>
  );
}
