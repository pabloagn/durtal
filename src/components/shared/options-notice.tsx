"use client";

import { useEffect, useState } from "react";

/** A load this quick shows nothing: no flash of a loading line */
const QUIET_MS = 200;

/**
 * A dialog's word on its lists while they load (SLN-510): nothing for the
 * first moment, then one quiet line; on a failed load, the error with Retry.
 */
export function OptionsNotice({ loading, failed, onRetry }: { loading: boolean; failed: boolean; onRetry: () => void }) {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(() => setLate(true), QUIET_MS);
    return () => {
      clearTimeout(timer);
      setLate(false);
    };
  }, [loading]);
  if (failed)
    return (
      <p role="alert" className="flex items-center gap-2 text-xs text-accent-red-text" data-options-failed="">
        Could not load the lists.
        <button
          type="button"
          onClick={onRetry}
          className="text-fg-secondary underline-offset-2 transition-colors hover:text-fg-primary hover:underline pointer-coarse:-my-3.5 pointer-coarse:py-3.5"
        >
          Retry
        </button>
      </p>
    );
  if (!loading || !late) return null;
  return (
    <p role="status" className="text-xs text-fg-secondary" data-options-loading="">
      Loading the lists…
    </p>
  );
}
