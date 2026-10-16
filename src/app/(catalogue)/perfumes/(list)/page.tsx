import { Suspense } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyIndex } from "@/components/shared/empty-index";
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
  // Whether any perfume exists, read beside the address
  const any = getPerfumeCount();
  const params = await searchParams;
  const tabs = <DomainSwitch current="perfume" searchParams={params} />;
  // With none, no toolbar over nothing: one empty state with one Add (SLN-842)
  if (!(await any)) {
    return (
      <EmptyIndex
        title="Perfumes"
        tabs={tabs}
        icon={DOMAIN_ICONS.perfume}
        empty="No perfumes yet"
        description="A perfume keeps its house, perfumers, notes and the bottles you hold. Add one by its name."
        action={<DomainAddLink kind="perfume" />}
      />
    );
  }

  return (
    <>
      <PageHeader
        title="Perfumes"
        actions={<DomainAddLink kind="perfume" />}
        tabs={tabs}
      />
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
  );
}
