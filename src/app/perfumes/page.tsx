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
import { PerfumeFilters } from "@/components/perfumes/perfume-filters";
import { PerfumeGrid } from "@/components/perfumes/perfume-grid";
import {
  getPerfumeCount,
  getPerfumeFilterOptions,
  getPerfumes,
} from "@/lib/actions/perfumes";
import {
  hasPerfumeFilters,
  perfumeQueryFromParams,
} from "@/lib/catalogue/perfume-params";
import {
  lastPage,
  pageHref,
  parsePagination,
  type ListSearchParams,
} from "@/lib/utils/pagination";

export const metadata = { title: "Perfumes" };

/** One page of the perfumes the URL asks for: its search, filters, sort and page. */
async function PerfumeResults({ params }: { params: ListSearchParams }) {
  const query = perfumeQueryFromParams(params);
  const { page, perPage, offset } = parsePagination(params);
  const [perfumes, total] = await Promise.all([
    getPerfumes({ ...query, limit: perPage, offset }),
    getPerfumeCount(query),
  ]);
  if (total > 0 && page > lastPage(total, perPage))
    redirect(pageHref("/perfumes", params, lastPage(total, perPage)));
  return (
    <PerfumeGrid
      perfumes={perfumes}
      pagination={{ page, perPage, total }}
      hasFilters={hasPerfumeFilters(params)}
    />
  );
}

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
  const [catalogued, options] = await Promise.all([
    getPerfumeCount(),
    getPerfumeFilterOptions(),
  ]);

  return (
    <>
      <PageHeader
        title="Perfumes"
        description={domainDescription("perfume")}
        actions={<DomainAddLink kind="perfume" />}
        tabs={<DomainSwitch current="perfume" searchParams={params} />}
      />
      {catalogued === 0 ? (
        <EmptyState
          icon={DOMAIN_ICONS.perfume}
          title="No perfumes yet"
          description="Add your first perfume: its house, perfumers and notes, then the bottles and samples you keep."
          action={<DomainAddLink kind="perfume" />}
        />
      ) : (
        <>
          <PerfumeFilters options={options} />
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
