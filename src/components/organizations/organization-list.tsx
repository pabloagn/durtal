import Link from "next/link";
import { Pagination, type PaginationData } from "@/components/shared/pagination";
import { contributionText, organizationRoleText } from "@/lib/catalogue/organizations";
import type { DirectoryOrganization } from "@/lib/actions/organization-directory";

/**
 * A row of the directory: the name, its roles and country, and what it takes
 * part in across the collections. On a phone the counts go under the roles.
 */
function OrganizationRow({ organization: o }: { organization: DirectoryOrganization }) {
  const about = [organizationRoleText(o.roles), o.country].filter(Boolean).join(" · ");
  const counts = contributionText(o.counts) || "Nothing linked yet";
  return (
    <li>
      <Link
        href={`/organizations/${o.slug}`}
        className="group flex items-baseline gap-4 rounded-sm px-3 py-2.5 transition-colors hover:bg-bg-secondary"
      >
        <div className="min-w-0 flex-1">
          <h3 className="type-item-title truncate group-hover:text-accent-rose-text">{o.name}</h3>
          <p className="truncate text-xs text-fg-secondary">{about || " "}</p>
          <p className="truncate text-xs text-fg-secondary sm:hidden">{counts}</p>
        </div>
        <p className="hidden max-w-[45%] shrink-0 truncate text-right text-xs text-fg-secondary sm:block">
          {counts}
        </p>
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
