import Link from "next/link";
import { Pagination, type PaginationData } from "@/components/shared/pagination";
import { FactsRow } from "@/components/shared/facts-row";
import { contributionParts, organizationRoleLabels } from "@/lib/catalogue/organizations";
import type { DirectoryOrganization } from "@/lib/actions/organization-directory";

/**
 * A row of the directory: the name, its roles and country, and what it takes
 * part in across the collections. Nothing is cut: the name wraps, and the
 * roles (the only line that says what the organization is) and the counts
 * wrap between their parts, so no line starts with a separator. On a phone
 * the counts go under the roles; from 640px they sit at the row's end.
 */
function OrganizationRow({ organization: o }: { organization: DirectoryOrganization }) {
  const about = [...organizationRoleLabels(o.roles), ...(o.country ? [o.country] : [])];
  const parts = contributionParts(o.counts);
  const counts = parts.length ? parts : ["Nothing linked yet"];
  return (
    <li>
      {/* One counts line for both layouts (page weight): under 640px it wraps
          to a line of its own under the roles; from 640px it sits at the
          row's end, on the name's baseline */}
      <Link
        href={`/organizations/${o.slug}`}
        className="group flex flex-wrap items-baseline gap-x-4 rounded-sm px-3 py-2.5 transition-colors hover:bg-bg-secondary sm:flex-nowrap"
      >
        <div className="min-w-0 basis-full sm:flex-1 sm:basis-auto">
          <h3 className="type-item-title [overflow-wrap:anywhere] group-hover:text-accent-primary">{o.name}</h3>
          <FactsRow facts={about} small />
        </div>
        <div className="min-w-0 basis-full sm:max-w-[45%] sm:shrink-0 sm:basis-auto">
          <FactsRow facts={counts} small />
        </div>
      </Link>
    </li>
  );
}

/** One page of the directory between its page controls */
export function OrganizationList({
  organizations,
  pagination,
}: {
  organizations: DirectoryOrganization[];
  pagination: PaginationData;
}) {
  return (
    <>
      <Pagination {...pagination} noun="organizations" compact />
      <ul className="-mx-3 mb-6 divide-y divide-glass-border">
        {organizations.map((o) => (
          <OrganizationRow key={o.id} organization={o} />
        ))}
      </ul>
      <Pagination {...pagination} noun="organizations" />
    </>
  );
}
