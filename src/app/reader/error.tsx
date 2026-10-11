"use client";

import { useEffect } from "react";
import {
  RouteFallback,
  routeFallbackActionClass,
} from "@/components/shared/route-fallback";

export default function ReaderError({
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
    <main>
      <RouteFallback
        title="This eBook could not be opened"
        description="An unexpected error occurred. Please try again."
      >
        <button type="button" onClick={reset} className={routeFallbackActionClass}>
          Try again
        </button>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- Recovery leaves the failed reader router through a fresh catalogue document. */}
        <a href="/library" className={routeFallbackActionClass}>
          Back to library
        </a>
      </RouteFallback>
    </main>
  );
}
