"use client";

import { useCallback, useRef, useState } from "react";

/**
 * Data a control needs only once it opens, such as a filter panel's options:
 * loaded once, on the first sign of use (pointer over the control, focus, or
 * opening it), so the page itself does not carry it. A failed load can start
 * again.
 */
export function useLazyOptions<T>(load: () => Promise<T>) {
  const [value, setValue] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);
  const started = useRef(false);
  const start = useCallback(() => {
    if (started.current) return;
    started.current = true;
    setFailed(false);
    load().then(setValue, () => {
      started.current = false;
      setFailed(true);
    });
  }, [load]);
  return { value, failed, start };
}
