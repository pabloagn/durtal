"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { RouteFallback } from "@/components/shared/route-fallback";
import { buttonClass } from "@/components/ui/button";

/** The eBook a failed reader was opening, from its address */
const READER_PATH = /^\/reader\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i;

export default function ReaderError({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  // The way back leads to the eBook's own page, or to the library when the
  // address names none (SLN-818)
  const ebookId = READER_PATH.exec(usePathname() ?? "")?.[1];

  return (
    <main>
      <RouteFallback
        title="This eBook could not be opened"
        description="An unexpected error occurred. Please try again."
      >
        {/* A failure on the server is held in the page data, so `reset` alone
            draws it again: Try again opens the book anew (SLN-754) */}
        <button type="button" onClick={() => window.location.reload()} className={buttonClass("primary")}>
          Try again
        </button>
        {/* Recovery leaves the failed reader router through a fresh catalogue document */}
        <a href={ebookId ? `/ebooks/${ebookId}` : "/library"} className={buttonClass("secondary")}>
          {ebookId ? "Back to the eBook" : "Back to library"}
        </a>
      </RouteFallback>
    </main>
  );
}
