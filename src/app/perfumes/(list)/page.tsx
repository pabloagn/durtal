import { Suspense } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { DOMAIN_ICONS } from "@/components/shortcuts/section-icons";
import { DomainSwitch } from "@/components/domains/domain-switch";
import { DomainAddLink } from "@/components/domains/domain-add-link";
import { PerfumeFilters } from "@/components/perfumes/perfume-filters";
import { getPerfumeCount } from "@/lib/actions/perfumes";
import type { ListSearchParams } from "@/lib/utils/pagination";
import { PerfumeResults } from "./perfume-results";

export const metadata = { title: "Perfumes" };

/**
 * The perfume home: every fragrance in the catalogue as a contained bottle,
 * with its house and facts; filters by house, perfumer, family, accord, note,
 * concentration, what is held, favourites and release years.
 */
export default async function PerfumesPage({
  searchParams,
}: {
  searchParams: Promise<ListSearchParams>;
}) {
  const params = await searchParams;
  const catalogued = await getPerfumeCount();

  return (
    <>
      <PageHeader
        title="Perfumes"
        actions={<DomainAddLink kind="perfume" />}
        tabs={<DomainSwitch current="perfume" searchParams={params} />}
      />
      {catalogued === 0 ? (
        <EmptyState
          icon={DOMAIN_ICONS.perfume}
          title="No perfumes yet"
          action={<DomainAddLink kind="perfume" />}
        />
      ) : (
        <>
          <PerfumeFilters />
          <Suspense
            key={JSON.stringify(params)}
            fallback={
              <div className="py-16">
                <Spinner />
              </div>
            }
          >
            <PerfumeResults params={params} />
          </Suspense>
        </>
      )}
    </>
  );
}
