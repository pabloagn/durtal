"use client";

import { useEffect, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AlertCircle } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Button, buttonClass } from "@/components/ui/button";

/**
 * A section of the app that failed to load (its error.tsx): what happened,
 * try again, or leave for a page that works. The tab says something went
 * wrong (a failed page otherwise has no title). The error goes to the console.
 */
export function SectionError({
  error,
  reset,
  description = "An error occurred while loading this page.",
  backHref,
  backLabel,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  description?: string;
  backHref: string;
  backLabel: string;
}) {
  const router = useRouter();
  const [retrying, startRetry] = useTransition();
  useEffect(() => {
    console.error(error);
  }, [error]);
  // A page that failed on the server holds its error in the page data:
  // `reset` alone draws the same error again, so the page is fetched anew
  // first (as Next's own retry does)
  const retry = () =>
    startRetry(() => {
      router.refresh();
      reset();
    });
  return (
    <>
      <title>Something went wrong | Durtal</title>
      <EmptyState
        tone="error"
        icon={AlertCircle}
        title="Something went wrong"
        description={description}
        action={
          <div className="flex gap-3">
            <Button onClick={retry} busy={retrying}>
              Try again
            </Button>
            <Link href={backHref} className={buttonClass("ghost")}>
              {backLabel}
            </Link>
          </div>
        }
      />
    </>
  );
}

/**
 * The error view of a section with a list of its own (task 0612). On the list
 * it leads to the dashboard; on any page under it, back to the list, where
 * the shared view would have offered only the dashboard. On one record (the
 * list's address and one more part that is not one of `pages`) it says that
 * record failed.
 */
export function ListSectionError({
  basePath,
  listDescription,
  recordDescription,
  backLabel,
  pages = [],
  ...props
}: {
  error: Error & { digest?: string };
  reset: () => void;
  basePath: string;
  listDescription: string;
  recordDescription?: string;
  backLabel: string;
  pages?: string[];
}) {
  const pathname = usePathname();
  const rest = pathname?.startsWith(`${basePath}/`) ? pathname.slice(basePath.length + 1) : "";
  if (!rest)
    return <SectionError {...props} description={listDescription} backHref="/" backLabel="Go to the dashboard" />;
  const record = !!recordDescription && !rest.includes("/") && !pages.includes(rest);
  return (
    <SectionError
      {...props}
      description={record ? recordDescription : undefined}
      backHref={basePath}
      backLabel={backLabel}
    />
  );
}
