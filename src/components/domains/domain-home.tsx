import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { DOMAIN_ICONS } from "@/components/shortcuts/section-icons";
import { WORK_DOMAINS } from "@/lib/catalogue/domains";
import { loadDomainHome, type HomeKind } from "@/lib/catalogue/domain-homes";
import {
  lastPage,
  pageHref,
  type ListSearchParams,
} from "@/lib/utils/pagination";
import { DomainSwitch } from "./domain-switch";
import { DomainAddLink, domainDescription } from "./domain-add-link";
import { DomainHomeFilters, DomainHomeShell } from "./domain-home-shell";

/**
 * The home of a collection other than books: its records with search, sort,
 * views and paging. Its layout keeps it unreachable until the collection opens.
 */
export async function DomainHome({
  kind,
  searchParams,
}: {
  kind: HomeKind;
  searchParams: ListSearchParams;
}) {
  const domain = WORK_DOMAINS[kind];
  const { tiles, total, page, perPage, search } = await loadDomainHome(
    kind,
    searchParams,
  );
  if (total > 0 && page > lastPage(total, perPage))
    redirect(
      pageHref(domain.basePath, searchParams, lastPage(total, perPage)),
    );
  const label = domain.label.toLowerCase();

  return (
    <>
      <PageHeader
        title={domain.pluralLabel}
        description={domainDescription(kind)}
        actions={<DomainAddLink kind={kind} />}
        tabs={<DomainSwitch current={kind} searchParams={searchParams} />}
      />
      {total === 0 && !search ? (
        <EmptyState
          icon={DOMAIN_ICONS[kind]}
          title={`No ${domain.pluralLabel.toLowerCase()} yet`}
          description={`Add your first ${label} to get started`}
          action={<DomainAddLink kind={kind} />}
        />
      ) : (
        <>
          <DomainHomeFilters kind={kind} />
          <DomainHomeShell
            kind={kind}
            tiles={tiles}
            pagination={{ page, perPage, total }}
          />
        </>
      )}
    </>
  );
}
