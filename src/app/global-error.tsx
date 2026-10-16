"use client";

import { useEffect } from "react";
import { MinimalRoot } from "@/components/layout/minimal-root";
import { RouteFallback } from "@/components/shared/route-fallback";
import { buttonClass } from "@/components/ui/button";

/** A root failure must not need the root's settings or media queries to recover. */
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <MinimalRoot>
      <main>
        <RouteFallback
          title="Something went wrong"
          description="An unexpected error occurred. Please try again."
        >
          {/* A failure on the server is held in the page data, so `reset` alone
              draws it again: Try again loads the page anew (SLN-754) */}
          <button type="button" onClick={() => window.location.reload()} className={buttonClass("primary")}>
            Try again
          </button>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- A root failure needs a fresh document independent of the failed router. */}
          <a href="/" className={buttonClass("secondary")}>
            Go to the dashboard
          </a>
        </RouteFallback>
      </main>
    </MinimalRoot>
  );
}
