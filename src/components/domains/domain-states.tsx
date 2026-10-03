"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Button, buttonClass } from "@/components/ui/button";
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
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <EmptyState
      icon={AlertCircle}
      title="Something went wrong"
      description={`${WORK_DOMAINS[kind].pluralLabel} could not be loaded.`}
      action={
        <div className="flex gap-3">
          <Button onClick={reset}>Try again</Button>
          <Link href="/" className={buttonClass("ghost")}>
            Go to the dashboard
          </Link>
        </div>
      }
    />
  );
}
