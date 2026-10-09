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
        <a href="/library" className={routeFallbackActionClass}>
          Back to library
        </a>
      </RouteFallback>
    </main>
  );
}
