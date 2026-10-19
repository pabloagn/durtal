"use client";

import { useEffect, useRef } from "react";
import { useSonner } from "sonner";
import { record } from "@/lib/notifications/history";

/** Toast ids restart with each page load: this keeps them apart in the history */
const PAGE = Math.random().toString(36).slice(2, 10);

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Keeps every error and warning toast in the notification history (SLN-567),
 * whichever page or dialog showed it. A pending toast that ends in an error
 * is kept then; one that ends well is not.
 */
export function NotificationRecorder() {
  const { toasts } = useSonner();
  // Sonner makes a new object each time a toast is shown or changed, and keeps
  // the others as they are: each one is recorded once, so a toast shown again
  // under the same id counts again (SLN-1460)
  const seen = useRef(new WeakSet<object>());
  useEffect(() => {
    for (const toast of toasts) {
      if (seen.current.has(toast)) continue;
      seen.current.add(toast);
      if (toast.type !== "error" && toast.type !== "warning") continue;
      const title = text(toast.title);
      if (!title) continue;
      record({
        id: `${PAGE}:${toast.id}`,
        kind: toast.type,
        title,
        description: text(toast.description),
      });
    }
  }, [toasts]);
  return null;
}
