"use client";

import { useEffect } from "react";
import { MinimalRoot } from "@/components/layout/minimal-root";
import {
  RouteFallback,
  routeFallbackActionClass,
} from "@/components/shared/route-fallback";

/** A root failure must not need the root's settings or media queries to recover. */
export default function GlobalError({
  error,
  reset,
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
          <button type="button" onClick={reset} className={routeFallbackActionClass}>
            Try again
          </button>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- A root failure needs a fresh document independent of the failed router. */}
          <a href="/" className={routeFallbackActionClass}>
            Go to dashboard
          </a>
        </RouteFallback>
      </main>
    </MinimalRoot>
  );
}
