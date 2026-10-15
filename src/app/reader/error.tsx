"use client";

import { useEffect } from "react";
import { RouteFallback } from "@/components/shared/route-fallback";
import { buttonClass } from "@/components/ui/button";

export default function ReaderError({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

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
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- Recovery leaves the failed reader router through a fresh catalogue document. */}
        <a href="/library" className={buttonClass("secondary")}>
          Back to library
        </a>
      </RouteFallback>
    </main>
  );
}
