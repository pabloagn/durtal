import { Suspense } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyIndex } from "@/components/shared/empty-index";
import { Spinner } from "@/components/ui/spinner";
import { DOMAIN_ICONS } from "@/components/shortcuts/section-icons";
import { DomainSwitch } from "@/components/domains/domain-switch";
import { DomainAddLink } from "@/components/domains/domain-add-link";
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
  // Whether any painting exists, read beside the address
  const any = getPaintingCount();
  const params = await searchParams;
  const tabs = <DomainSwitch current="painting" searchParams={params} />;
  // With none, no toolbar over nothing: one empty state with one Add (SLN-842)
  if (!(await any)) {
    return (
      <EmptyIndex
        title="Paintings"
        tabs={tabs}
        icon={DOMAIN_ICONS.painting}
        empty="No paintings yet"
        description="A painting keeps its painters, date and where it hangs. Add one by its title."
        action={<DomainAddLink kind="painting" />}
      />
    );
  }

  return (
    <>
      <PageHeader
        title="Paintings"
        actions={<DomainAddLink kind="painting" />}
        tabs={tabs}
      />
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
  );
}
