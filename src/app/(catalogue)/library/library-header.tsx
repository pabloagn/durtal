import Link from "next/link";
import { ListChecks } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { buttonClass } from "@/components/ui/button";
import { ListPending } from "@/components/shared/list-pending";
import { DomainSwitch } from "@/components/domains/domain-switch";
import { DomainAddLink } from "@/components/domains/domain-add-link";

/**
 * The books list's title, collection tabs and actions. The page and its
 * loading screen draw the same header, so nothing moves when the books arrive.
 */
export function LibraryHeader({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  return (
    <PageHeader
      title="Books"
      tabs={<DomainSwitch current="book" searchParams={searchParams} />}
      actions={
        <>
          <Link
            href="/library/identify"
            className={`${buttonClass("ghost", "sm")} whitespace-nowrap`}
            aria-label="Identify editions"
            data-tooltip="Identify editions"
          >
            <ListChecks className="h-3.5 w-3.5" strokeWidth={1.5} />
            {/* On a phone the icon alone, so the title and both actions share a row */}
            <span className="max-sm:hidden" data-tooltip-label="">Identify editions</span>
          </Link>
          <DomainAddLink kind="book" />
        </>
      }
    />
  );
}

/** Where the books go while they load: the loading screen and the page's own wait */
export const LibraryPending = ListPending;
