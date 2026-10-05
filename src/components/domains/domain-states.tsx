"use client";

import { PageHeader } from "@/components/layout/page-header";
import { SectionError } from "@/components/shared/section-error";
import { Spinner } from "@/components/ui/spinner";
import { WORK_DOMAINS } from "@/lib/catalogue/domains";
import type { WorkKind } from "@/lib/catalogue/kinds";
import { DomainAddLink, domainDescription } from "./domain-add-link";

/** A collection home while it loads: its title stays, its records follow. */
export function DomainLoading({ kind }: { kind: WorkKind }) {
  return (
    <>
      <PageHeader
        title={WORK_DOMAINS[kind].pluralLabel}
        description={domainDescription(kind)}
        actions={<DomainAddLink kind={kind} />}
      />
      <div className="flex items-center justify-center py-16">
        <Spinner className="h-6 w-6" />
      </div>
    </>
  );
}

/** A collection page that failed: try again, or leave for the dashboard. */
export function DomainError({
  kind,
  error,
  reset,
}: {
  kind: WorkKind;
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <SectionError
      error={error}
      reset={reset}
      description={`${WORK_DOMAINS[kind].pluralLabel} could not be loaded.`}
      backHref="/"
      backLabel="Go to the dashboard"
    />
  );
}
