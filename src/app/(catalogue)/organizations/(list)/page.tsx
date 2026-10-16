import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Landmark } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyIndex } from "@/components/shared/empty-index";
import { Spinner } from "@/components/ui/spinner";
import { NoResults, PageOutOfRange } from "@/components/shared/no-results";
import { OrganizationFilters } from "@/components/organizations/organization-filters";
import { OrganizationList } from "@/components/organizations/organization-list";
import { AddOrganizationButton } from "@/components/organizations/organization-dialog";
import {
  getOrganizationDirectory,
  getOrganizationRoleCounts,
} from "@/lib/actions/organization-directory";
import { DIRECTORY_ROLES, type DirectoryRole } from "@/lib/catalogue/organizations";
import { clearedListHref, firstPageHref } from "@/lib/utils/list-params";
import {
  lastPage,
  pageHref,
  parsePagination,
  toSearchParams,
  type ListSearchParams,
} from "@/lib/utils/pagination";

export const metadata = { title: "Organizations" };

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function directoryQuery(params: ListSearchParams) {
  const role = first(params.role);
  return {
    query: (first(params.q) ?? "").trim().slice(0, 200),
    role: (DIRECTORY_ROLES as readonly string[]).includes(role ?? "")
      ? (role as DirectoryRole)
      : undefined,
  };
}

/** One page of the organizations the URL asks for */
async function DirectoryResults({ params }: { params: ListSearchParams }) {
  const { query, role } = directoryQuery(params);
  const { page, perPage, offset } = parsePagination(params);
  const { rows, total } = await getOrganizationDirectory({ query, role, limit: perPage, offset });
  const current = toSearchParams(params);
  if (total > 0 && page > lastPage(total, perPage))
    redirect(pageHref("/organizations", params, lastPage(total, perPage)));
  if (total === 0)
    return (
      <NoResults
        noun="organizations"
        search={query || null}
        hasFilters={!!role}
        clearHref={clearedListHref("/organizations", current)}
      />
    );
  if (rows.length === 0)
    return <PageOutOfRange firstPageHref={firstPageHref("/organizations", current)} />;
  return <OrganizationList organizations={rows} pagination={{ page, perPage, total }} />;
}

/**
 * Every organization of every collection in one place: publishers and
 * imprints, perfume houses, brands and manufacturers, retailers, production
 * companies and distributors, museums and galleries. Search by name or other
 * name; filter by one role.
 */
export default async function OrganizationsPage({
  searchParams,
}: {
  searchParams: Promise<ListSearchParams>;
}) {
  const params = await searchParams;
  const { query } = directoryQuery(params);
  // A search's counts and, beside them, whether any organization exists at all
  const [counts, all] = await Promise.all([
    getOrganizationRoleCounts(query),
    query ? getOrganizationRoleCounts().then((c) => c.all) : null,
  ]);
  // With none, no toolbar over nothing, even under a stale search: one empty
  // state with one Add (SLN-842)
  if ((all ?? counts.all) === 0) {
    return (
      <EmptyIndex
        title="Organizations"
        icon={Landmark}
        empty="No organizations yet"
        description="An organization is a house, studio, museum or shop behind your works. Add one here; publishers come from your books."
        action={<AddOrganizationButton />}
      />
    );
  }
  return (
    <>
      <PageHeader
        title="Organizations"
        actions={<AddOrganizationButton />}
      />
      <OrganizationFilters counts={counts} />
      <Suspense
        key={JSON.stringify(params)}
        fallback={
          <div className="flex justify-center py-16">
            <Spinner />
          </div>
        }
      >
        <DirectoryResults params={params} />
      </Suspense>
    </>
  );
}
