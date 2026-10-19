"use client";

import { useEffect, useState } from "react";

/**
 * What a delete would take with it, read each time its dialog opens
 * (SLN-1112): undefined while it loads, null when it could not be read.
 * `key` names the records, so a different selection reads again.
 */
export function useDeleteSummary<T>(open: boolean, key: string, load: () => Promise<T>): T | null | undefined {
  const [summary, setSummary] = useState<{ key: string; value: T | null } | null>(null);
  useEffect(() => {
    if (!open) return;
    let live = true;
    load().then(
      (value) => live && setSummary({ key, value }),
      () => live && setSummary({ key, value: null }),
    );
    return () => {
      live = false;
      setSummary(null);
    };
    // `load` is a fresh closure each render; `key` says what it reads
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, key]);
  return open && summary?.key === key ? summary.value : undefined;
}
