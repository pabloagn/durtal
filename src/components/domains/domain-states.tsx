"use client";

import { usePathname } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { SectionError } from "@/components/shared/section-error";
import { Spinner } from "@/components/ui/spinner";
import { WORK_DOMAINS } from "@/lib/catalogue/domains";
import type { WorkKind } from "@/lib/catalogue/kinds";
import { DomainAddLink } from "./domain-add-link";

/** A collection home while it loads: its title stays, its records follow. */
export function DomainLoading({ kind }: { kind: WorkKind }) {
  return (
    <>
      <PageHeader
        title={WORK_DOMAINS[kind].pluralLabel}
        actions={<DomainAddLink kind={kind} />}
      />
      <div className="flex items-center justify-center py-16">
        <Spinner className="h-6 w-6" />
      </div>
    </>
  );
}

/**
 * Whether an address is one record of a collection (`/films/<slug>`), not its
 * list or a page such as `/films/new`. A record's layout checks the record
 * before its page, outside the record's own error view, so a failure there
 * (the database unreachable) lands on the collection's error view.
 */
export function isRecordPath(basePath: string, pathname: string | null) {
  const rest = pathname?.startsWith(`${basePath}/`) ? pathname.slice(basePath.length + 1) : "";
  return !!rest && !rest.includes("/") && !["new", "identify", "import"].includes(rest);
}

/**
 * A collection page that failed: try again, or leave for the dashboard. With
 * `record`, or on a record's address, one of its records failed: it says so,
 * and the way back is the collection's list.
 */
export function DomainError({
  kind,
  error,
  reset,
  record = false,
}: {
  kind: WorkKind;
  error: Error & { digest?: string };
  reset: () => void;
  record?: boolean;
}) {
  const domain = WORK_DOMAINS[kind];
  const pathname = usePathname();
  return record || isRecordPath(domain.basePath, pathname) ? (
    <SectionError
      error={error}
      reset={reset}
      description={`This ${domain.label.toLowerCase()} could not be loaded.`}
      backHref={domain.basePath}
      backLabel={`Back to ${domain.pluralLabel.toLowerCase()}`}
    />
  ) : (
    <SectionError
      error={error}
      reset={reset}
      description={`${domain.pluralLabel} could not be loaded.`}
      backHref="/"
      backLabel="Go to the dashboard"
    />
  );
}
