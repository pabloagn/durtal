"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Button, buttonClass } from "@/components/ui/button";

/**
 * A section of the app that failed to load (its error.tsx): what happened,
 * try again, or leave for a page that works. The error goes to the console.
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
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <EmptyState
      icon={AlertCircle}
      title="Something went wrong"
      description={description}
      action={
        <div className="flex gap-3">
          <Button onClick={reset}>Try again</Button>
          <Link href={backHref} className={buttonClass("ghost")}>
            {backLabel}
          </Link>
        </div>
      }
    />
  );
}
