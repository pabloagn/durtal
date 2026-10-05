import { Suspense } from "react";
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
import {
  getPaintingCount,
} from "@/lib/actions/paintings";
import type { ListSearchParams } from "@/lib/utils/pagination";
import { PaintingResults } from "./painting-results";

export const metadata = { title: "Paintings" };

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
  const catalogued = await getPaintingCount();

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
          <PaintingFilters />
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
