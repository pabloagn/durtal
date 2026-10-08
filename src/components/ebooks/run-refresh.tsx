"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** A running run's page reads its counts again every 10 seconds while the tab is visible */
export function RunRefresh({ every = 10_000 }: { every?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, every);
    return () => clearInterval(timer);
  }, [router, every]);
  return null;
}
